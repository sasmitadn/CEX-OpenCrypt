#include "OrderBook.hpp"
#include "RedisClient.hpp"

#include <iostream>
#include <memory>
#include <unordered_map>
#include <csignal>
#include <atomic>
#include <thread>
#include <sstream>
#include <iomanip>

static std::atomic<bool> g_running{true};

void signalHandler(int signum) {
    std::cout << "\n[Matching Engine] Caught signal " << signum << ". Shutting down..." << std::endl;
    g_running = false;
}

std::string formatJsonTrade(const cex::Trade& trade) {
    std::ostringstream ss;
    ss << "{"
       << "\"event\":\"trade_matched\","
       << "\"trade_id\":\"" << trade.trade_id << "\","
       << "\"symbol\":\"" << trade.symbol << "\","
       << "\"maker_order_id\":\"" << trade.maker_order_id << "\","
       << "\"taker_order_id\":\"" << trade.taker_order_id << "\","
       << "\"maker_user_id\":" << trade.maker_user_id << ","
       << "\"taker_user_id\":" << trade.taker_user_id << ","
       << "\"price\":\"" << std::fixed << std::setprecision(8) << trade.get_price_double() << "\","
       << "\"quantity\":\"" << std::fixed << std::setprecision(8) << trade.get_quantity_double() << "\","
       << "\"quote_amount\":\"" << std::fixed << std::setprecision(8) << trade.get_quote_amount_double() << "\","
       << "\"maker_side\":\"" << (trade.maker_side == cex::OrderSide::BUY ? "BUY" : "SELL") << "\","
       << "\"timestamp\":" << trade.timestamp
       << "}";
    return ss.str();
}

int main(int argc, char* argv[]) {
    (void)argc;
    (void)argv;
    std::signal(SIGINT, signalHandler);
    std::signal(SIGTERM, signalHandler);

    std::cout << "=====================================================" << std::endl;
    std::cout << "        C++ HIGH-PERFORMANCE MATCHING ENGINE         " << std::endl;
    std::cout << "=====================================================" << std::endl;

    const char* redis_host_env = std::getenv("REDIS_HOST");
    const char* redis_port_env = std::getenv("REDIS_PORT");
    const char* redis_pass_env = std::getenv("REDIS_PASSWORD");

    std::string redis_host = redis_host_env ? redis_host_env : "127.0.0.1";
    int redis_port = redis_port_env ? std::stoi(redis_port_env) : 6379;
    std::string redis_pass = redis_pass_env ? redis_pass_env : "secretredis";

    std::cout << "[Matching Engine] Connecting to Redis at " << redis_host << ":" << redis_port << "..." << std::endl;

    cex::RedisClient redis(redis_host, redis_port, redis_pass);
    if (!redis.connect()) {
        std::cerr << "[Matching Engine] Warning: Failed to connect to Redis initially. Running in local standalone mode." << std::endl;
    } else {
        std::cout << "[Matching Engine] Connected to Redis successfully." << std::endl;
    }

    // In-memory orderbooks per trading symbol (e.g. BTC_USDT, ETH_USDT)
    std::unordered_map<std::string, std::unique_ptr<cex::OrderBook>> books;
    books["BTC_USDT"] = std::make_unique<cex::OrderBook>("BTC_USDT");
    books["ETH_USDT"] = std::make_unique<cex::OrderBook>("ETH_USDT");

    std::cout << "[Matching Engine] Order Books initialized for BTC_USDT and ETH_USDT." << std::endl;
    std::cout << "[Matching Engine] Listening for incoming orders on Redis stream: 'order_stream'..." << std::endl;

    std::string last_stream_id = "$"; // Read only newly arriving events

    while (g_running) {
        if (!redis.isConnected()) {
            std::this_thread::sleep_for(std::chrono::seconds(2));
            redis.connect();
            continue;
        }

        // Baca batch order baru dari stream 'order_stream'
        auto messages = redis.xreadGroupOrStream("order_stream", last_stream_id, 1000);

        for (const auto& msg : messages) {
            last_stream_id = msg.id;

            const auto& f = msg.fields;
            auto it_symbol = f.find("symbol");
            auto it_side = f.find("side");
            auto it_type = f.find("type");
            auto it_price = f.find("price");
            auto it_qty = f.find("quantity");
            auto it_order_id = f.find("order_uuid");
            auto it_user_id = f.find("user_id");

            if (it_symbol == f.end() || it_side == f.end() || it_qty == f.end() || it_order_id == f.end()) {
                continue;
            }

            std::string symbol = it_symbol->second;
            if (books.find(symbol) == books.end()) {
                books[symbol] = std::make_unique<cex::OrderBook>(symbol);
            }

            cex::Order order;
            order.order_id = it_order_id->second;
            order.user_id = it_user_id != f.end() ? std::stoull(it_user_id->second) : 1;
            order.symbol = symbol;
            order.side = cex::stringToSide(it_side->second);
            order.type = it_type != f.end() ? cex::stringToType(it_type->second) : cex::OrderType::LIMIT;
            order.price = it_price != f.end() ? cex::stringToFixed(it_price->second) : 0;
            order.quantity = cex::stringToFixed(it_qty->second);
            order.filled_quantity = 0;
            order.timestamp = std::chrono::duration_cast<std::chrono::milliseconds>(
                std::chrono::system_clock::now().time_since_epoch()
            ).count();

            // Eksekusi In-Memory Order Matching (Latensi Mikrodetik)
            auto start = std::chrono::high_resolution_clock::now();
            auto trades = books[symbol]->placeOrder(order);
            auto elapsed_us = std::chrono::duration_cast<std::chrono::microseconds>(
                std::chrono::high_resolution_clock::now() - start
            ).count();

            std::cout << "[Matching Engine] Matched Order #" << order.order_id 
                      << " (" << it_side->second << " " << it_qty->second << " " << symbol 
                      << ") in " << elapsed_us << " µs -> " << trades.size() << " trades." << std::endl;

            // Publikasikan setiap trade ke Redis stream & pub-sub
            for (const auto& trade : trades) {
                std::string jsonPayload = formatJsonTrade(trade);

                // 1. Pub/Sub untuk realtime UI / WebSocket gateway
                redis.publish("trades:matched", jsonPayload);

                // 2. Queue list 'trades_queue' untuk konsumsi RPOP/BRPOP Laravel
                redis.lpush("trades_queue", jsonPayload);

                // 3. Stream 'trade_stream' untuk konsumsi stream Laravel
                std::unordered_map<std::string, std::string> streamFields = {
                    {"event", "trade_matched"},
                    {"trade_id", trade.trade_id},
                    {"symbol", trade.symbol},
                    {"maker_order_id", trade.maker_order_id},
                    {"taker_order_id", trade.taker_order_id},
                    {"maker_user_id", std::to_string(trade.maker_user_id)},
                    {"taker_user_id", std::to_string(trade.taker_user_id)},
                    {"price", std::to_string(trade.get_price_double())},
                    {"quantity", std::to_string(trade.get_quantity_double())},
                    {"quote_amount", std::to_string(trade.get_quote_amount_double())},
                    {"maker_side", trade.maker_side == cex::OrderSide::BUY ? "BUY" : "SELL"},
                    {"timestamp", std::to_string(trade.timestamp)},
                };
                redis.xadd("trade_stream", streamFields);
            }
        }
    }

    std::cout << "[Matching Engine] Graceful shutdown complete." << std::endl;
    return 0;
}
