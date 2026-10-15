#include "OrderBook.hpp"
#include <algorithm>
#include <atomic>
#include <sstream>
#include <iomanip>

namespace cex {

static std::atomic<uint64_t> g_trade_sequence{1};

OrderBook::OrderBook(std::string symbol) : symbol_(std::move(symbol)) {}

int64_t OrderBook::currentTimestampMs() const {
    return std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::system_clock::now().time_since_epoch()
    ).count();
}

std::string OrderBook::generateTradeId() {
    std::ostringstream ss;
    ss << "TRD-" << currentTimestampMs() << "-" << g_trade_sequence.fetch_add(1);
    return ss.str();
}

std::optional<int64_t> OrderBook::getBestBid() const {
    if (bids_.empty()) return std::nullopt;
    return bids_.begin()->first;
}

std::optional<int64_t> OrderBook::getBestAsk() const {
    if (asks_.empty()) return std::nullopt;
    return asks_.begin()->first;
}

std::vector<Trade> OrderBook::placeOrder(Order taker_order) {
    if (taker_order.timestamp == 0) {
        taker_order.timestamp = currentTimestampMs();
    }

    if (taker_order.side == OrderSide::BUY) {
        return matchBuyOrder(taker_order);
    } else {
        return matchSellOrder(taker_order);
    }
}

std::vector<Trade> OrderBook::matchBuyOrder(Order& taker_order) {
    std::vector<Trade> executed_trades;

    // 1. Eksekusi pencocokan (Match against Asks: mulai dari harga terendah)
    while (taker_order.remaining_quantity() > 0 && !asks_.empty()) {
        auto it_best_ask = asks_.begin();
        int64_t best_ask_price = it_best_ask->first;

        // Jika LIMIT order dan harga beli < harga jual terbaik, spread tidak crossed -> berhenti matching
        if (taker_order.type == OrderType::LIMIT && taker_order.price < best_ask_price) {
            break;
        }

        PriceLevel& level = it_best_ask->second;

        // Konsumsi antrean order pada level harga ini secara FIFO (First-In, First-Out)
        while (!level.orders.empty() && taker_order.remaining_quantity() > 0) {
            Order& maker_order = level.orders.front();

            int64_t match_qty = std::min(taker_order.remaining_quantity(), maker_order.remaining_quantity());
            int64_t exec_price = maker_order.price; // Maker Price Priority!
            int64_t quote_amount = (match_qty * exec_price) / FIXED_SCALE;

            // Buat record Trade
            Trade trade;
            trade.trade_id = generateTradeId();
            trade.symbol = symbol_;
            trade.maker_order_id = maker_order.order_id;
            trade.taker_order_id = taker_order.order_id;
            trade.maker_user_id = maker_order.user_id;
            trade.taker_user_id = taker_order.user_id;
            trade.price = exec_price;
            trade.quantity = match_qty;
            trade.quote_amount = quote_amount;
            trade.maker_side = OrderSide::SELL;
            trade.timestamp = currentTimestampMs();

            executed_trades.push_back(trade);

            // Update status & kuantitas order
            maker_order.filled_quantity += match_qty;
            taker_order.filled_quantity += match_qty;
            level.total_volume -= match_qty;

            // Jika maker order terisi penuh, hapus dari buku dan lookup map
            if (maker_order.is_filled()) {
                order_map_.erase(maker_order.order_id);
                level.orders.pop_front();
            }
        }

        // Jika seluruh order pada level harga ini telah habis, hapus level dari map
        if (level.orders.empty()) {
            asks_.erase(it_best_ask);
        }
    }

    // 2. Jika masih ada sisa kuantitas pada LIMIT order: masukkan ke antrean Bids (Resting Order)
    if (taker_order.type == OrderType::LIMIT && taker_order.remaining_quantity() > 0) {
        auto& level = bids_[taker_order.price];
        level.price = taker_order.price;
        level.total_volume += taker_order.remaining_quantity();

        level.orders.push_back(taker_order);
        auto order_it = std::prev(level.orders.end());

        // Simpan iterator ke lookup table untuk pembatalan O(1)
        order_map_[taker_order.order_id] = { taker_order.price, OrderSide::BUY, order_it };
    }

    return executed_trades;
}

std::vector<Trade> OrderBook::matchSellOrder(Order& taker_order) {
    std::vector<Trade> executed_trades;

    // 1. Eksekusi pencocokan (Match against Bids: mulai dari harga tertinggi)
    while (taker_order.remaining_quantity() > 0 && !bids_.empty()) {
        auto it_best_bid = bids_.begin();
        int64_t best_bid_price = it_best_bid->first;

        // Jika LIMIT order dan harga jual > harga beli tertinggi, spread tidak crossed -> berhenti matching
        if (taker_order.type == OrderType::LIMIT && taker_order.price > best_bid_price) {
            break;
        }

        PriceLevel& level = it_best_bid->second;

        // Konsumsi antrean order pada level harga ini secara FIFO (First-In, First-Out)
        while (!level.orders.empty() && taker_order.remaining_quantity() > 0) {
            Order& maker_order = level.orders.front();

            int64_t match_qty = std::min(taker_order.remaining_quantity(), maker_order.remaining_quantity());
            int64_t exec_price = maker_order.price; // Maker Price Priority!
            int64_t quote_amount = (match_qty * exec_price) / FIXED_SCALE;

            Trade trade;
            trade.trade_id = generateTradeId();
            trade.symbol = symbol_;
            trade.maker_order_id = maker_order.order_id;
            trade.taker_order_id = taker_order.order_id;
            trade.maker_user_id = maker_order.user_id;
            trade.taker_user_id = taker_order.user_id;
            trade.price = exec_price;
            trade.quantity = match_qty;
            trade.quote_amount = quote_amount;
            trade.maker_side = OrderSide::BUY;
            trade.timestamp = currentTimestampMs();

            executed_trades.push_back(trade);

            maker_order.filled_quantity += match_qty;
            taker_order.filled_quantity += match_qty;
            level.total_volume -= match_qty;

            if (maker_order.is_filled()) {
                order_map_.erase(maker_order.order_id);
                level.orders.pop_front();
            }
        }

        if (level.orders.empty()) {
            bids_.erase(it_best_bid);
        }
    }

    // 2. Jika masih ada sisa kuantitas pada LIMIT order: masukkan ke antrean Asks (Resting Order)
    if (taker_order.type == OrderType::LIMIT && taker_order.remaining_quantity() > 0) {
        auto& level = asks_[taker_order.price];
        level.price = taker_order.price;
        level.total_volume += taker_order.remaining_quantity();

        level.orders.push_back(taker_order);
        auto order_it = std::prev(level.orders.end());

        order_map_[taker_order.order_id] = { taker_order.price, OrderSide::SELL, order_it };
    }

    return executed_trades;
}

bool OrderBook::cancelOrder(const std::string& order_id, Order& canceled_order) {
    auto it = order_map_.find(order_id);
    if (it == order_map_.end()) {
        return false;
    }

    const OrderLocation& loc = it->second;
    canceled_order = *(loc.iter);

    if (loc.side == OrderSide::BUY) {
        auto level_it = bids_.find(loc.price);
        if (level_it != bids_.end()) {
            level_it->second.total_volume -= loc.iter->remaining_quantity();
            level_it->second.orders.erase(loc.iter);
            if (level_it->second.orders.empty()) {
                bids_.erase(level_it);
            }
        }
    } else {
        auto level_it = asks_.find(loc.price);
        if (level_it != asks_.end()) {
            level_it->second.total_volume -= loc.iter->remaining_quantity();
            level_it->second.orders.erase(loc.iter);
            if (level_it->second.orders.empty()) {
                asks_.erase(level_it);
            }
        }
    }

    order_map_.erase(it);
    return true;
}

OrderBook::DepthSnapshot OrderBook::getDepth(size_t limit) const {
    DepthSnapshot snapshot;
    snapshot.symbol = symbol_;
    snapshot.timestamp = currentTimestampMs();

    size_t count = 0;
    for (const auto& [price, level] : bids_) {
        if (count++ >= limit) break;
        snapshot.bids.emplace_back(fixedToDouble(price), fixedToDouble(level.total_volume));
    }

    count = 0;
    for (const auto& [price, level] : asks_) {
        if (count++ >= limit) break;
        snapshot.asks.emplace_back(fixedToDouble(price), fixedToDouble(level.total_volume));
    }

    return snapshot;
}

} // namespace cex
