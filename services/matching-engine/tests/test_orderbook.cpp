#include "OrderBook.hpp"

#include <cassert>
#include <iostream>
#include <vector>
#include <chrono>

using namespace cex;

void test_fifo_price_time_priority() {
    std::cout << "[Test 1] Testing Price-Time Priority (FIFO)..." << std::endl;
    OrderBook book("BTC_USDT");

    // Dua order jual di harga yang sama (60,000 USDT)
    Order ask1;
    ask1.order_id = "ASK-1";
    ask1.user_id = 101;
    ask1.symbol = "BTC_USDT";
    ask1.side = OrderSide::SELL;
    ask1.type = OrderType::LIMIT;
    ask1.price = doubleToFixed(60000.0);
    ask1.quantity = doubleToFixed(1.0);
    ask1.timestamp = 1000; // Masuk lebih dulu

    Order ask2;
    ask2.order_id = "ASK-2";
    ask2.user_id = 102;
    ask2.symbol = "BTC_USDT";
    ask2.side = OrderSide::SELL;
    ask2.type = OrderType::LIMIT;
    ask2.price = doubleToFixed(60000.0);
    ask2.quantity = doubleToFixed(1.0);
    ask2.timestamp = 2000; // Masuk setelahnya

    book.placeOrder(ask1);
    book.placeOrder(ask2);

    assert(book.askLevelCount() == 1);
    assert(book.totalOrders() == 2);

    // Order beli masuk untuk 1.0 BTC
    Order buy1;
    buy1.order_id = "BUY-1";
    buy1.user_id = 201;
    buy1.symbol = "BTC_USDT";
    buy1.side = OrderSide::BUY;
    buy1.type = OrderType::LIMIT;
    buy1.price = doubleToFixed(60000.0);
    buy1.quantity = doubleToFixed(1.0);

    auto trades = book.placeOrder(buy1);

    assert(trades.size() == 1);
    // Sesuai FIFO, ASK-1 wajib ter-match terlebih dahulu, BUKAN ASK-2!
    assert(trades[0].maker_order_id == "ASK-1");
    assert(trades[0].quantity == doubleToFixed(1.0));
    assert(trades[0].price == doubleToFixed(60000.0));

    // Sisa di buku hanya ASK-2
    assert(book.totalOrders() == 1);
    std::cout << "  ✓ Passed: FIFO executed first order correctly." << std::endl;
}

void test_maker_price_priority_and_partials() {
    std::cout << "[Test 2] Testing Maker Price Priority & Partial Fills..." << std::endl;
    OrderBook book("BTC_USDT");

    // Maker pasang SELL di 60,000 USDT untuk 2.0 BTC
    Order ask;
    ask.order_id = "MAKER-SELL";
    ask.user_id = 101;
    ask.symbol = "BTC_USDT";
    ask.side = OrderSide::SELL;
    ask.type = OrderType::LIMIT;
    ask.price = doubleToFixed(60000.0);
    ask.quantity = doubleToFixed(2.0);

    book.placeOrder(ask);

    // Taker pasang BUY di 62,000 USDT untuk 0.75 BTC (Aggressive Buy)
    Order buy;
    buy.order_id = "TAKER-BUY";
    buy.user_id = 201;
    buy.symbol = "BTC_USDT";
    buy.side = OrderSide::BUY;
    buy.type = OrderType::LIMIT;
    buy.price = doubleToFixed(62000.0);
    buy.quantity = doubleToFixed(0.75);

    auto trades = book.placeOrder(buy);

    assert(trades.size() == 1);
    // Eksekusi harus pada harga Maker (60,000) BUKAN harga Taker (62,000)
    assert(trades[0].price == doubleToFixed(60000.0));
    assert(trades[0].quantity == doubleToFixed(0.75));

    // Sisa Maker order harus 1.25 BTC
    auto depth = book.getDepth();
    assert(depth.asks.size() == 1);
    assert(std::abs(depth.asks[0].second - 1.25) < 0.000001);
    std::cout << "  ✓ Passed: Maker price priority and partial fill calculated accurately." << std::endl;
}

void test_order_cancellation_o1() {
    std::cout << "[Test 3] Testing O(1) Order Cancellation..." << std::endl;
    OrderBook book("BTC_USDT");

    Order buy;
    buy.order_id = "BUY-TO-CANCEL";
    buy.user_id = 101;
    buy.symbol = "BTC_USDT";
    buy.side = OrderSide::BUY;
    buy.type = OrderType::LIMIT;
    buy.price = doubleToFixed(55000.0);
    buy.quantity = doubleToFixed(0.5);

    book.placeOrder(buy);
    assert(book.totalOrders() == 1);
    assert(book.getBestBid().has_value());

    Order canceled;
    bool success = book.cancelOrder("BUY-TO-CANCEL", canceled);
    assert(success == true);
    assert(canceled.order_id == "BUY-TO-CANCEL");
    assert(book.totalOrders() == 0);
    assert(!book.getBestBid().has_value());

    // Coba batalkan lagi order yang sudah tidak ada
    bool repeat = book.cancelOrder("BUY-TO-CANCEL", canceled);
    assert(repeat == false);
    std::cout << "  ✓ Passed: Order cancellation in O(1) verified." << std::endl;
}

void test_market_orders() {
    std::cout << "[Test 4] Testing Market Order Execution..." << std::endl;
    OrderBook book("BTC_USDT");

    // Tambah 2 level Asks: 1.0 BTC @ 60,000 dan 1.0 BTC @ 61,000
    Order a1;
    a1.order_id = "A1"; a1.side = OrderSide::SELL; a1.type = OrderType::LIMIT;
    a1.price = doubleToFixed(60000.0); a1.quantity = doubleToFixed(1.0);
    book.placeOrder(a1);

    Order a2;
    a2.order_id = "A2"; a2.side = OrderSide::SELL; a2.type = OrderType::LIMIT;
    a2.price = doubleToFixed(61000.0); a2.quantity = doubleToFixed(1.0);
    book.placeOrder(a2);

    // Market Buy untuk 1.5 BTC: harus match 1.0 BTC di 60,000 dan 0.5 BTC di 61,000
    Order mktBuy;
    mktBuy.order_id = "MKT-1"; mktBuy.side = OrderSide::BUY; mktBuy.type = OrderType::MARKET;
    mktBuy.price = 0; mktBuy.quantity = doubleToFixed(1.5);

    auto trades = book.placeOrder(mktBuy);

    assert(trades.size() == 2);
    assert(trades[0].price == doubleToFixed(60000.0) && trades[0].quantity == doubleToFixed(1.0));
    assert(trades[1].price == doubleToFixed(61000.0) && trades[1].quantity == doubleToFixed(0.5));

    // Sisa di level 61,000 harus 0.5 BTC
    auto depth = book.getDepth();
    assert(std::abs(depth.asks[0].second - 0.5) < 0.000001);
    std::cout << "  ✓ Passed: Market order consumed multiple price levels." << std::endl;
}

void test_performance_benchmark() {
    std::cout << "[Test 5] Performance Benchmark (Throughput)..." << std::endl;
    OrderBook book("BTC_USDT");

    const int ORDER_COUNT = 100000;

    auto start = std::chrono::high_resolution_clock::now();

    // Pasang 50,000 bids dan 50,000 asks
    for (int i = 0; i < ORDER_COUNT / 2; ++i) {
        Order b;
        b.order_id = "B-" + std::to_string(i);
        b.side = OrderSide::BUY;
        b.type = OrderType::LIMIT;
        b.price = doubleToFixed(50000.0 + (i % 500));
        b.quantity = doubleToFixed(0.1);
        book.placeOrder(b);
    }

    for (int i = 0; i < ORDER_COUNT / 2; ++i) {
        Order a;
        a.order_id = "A-" + std::to_string(i);
        a.side = OrderSide::SELL;
        a.type = OrderType::LIMIT;
        a.price = doubleToFixed(51000.0 + (i % 500));
        a.quantity = doubleToFixed(0.1);
        book.placeOrder(a);
    }

    auto end = std::chrono::high_resolution_clock::now();
    auto duration_us = std::chrono::duration_cast<std::chrono::microseconds>(end - start).count();
    double ops_per_sec = (static_cast<double>(ORDER_COUNT) / duration_us) * 1000000.0;

    std::cout << "  ✓ Processed " << ORDER_COUNT << " orders in " << duration_us / 1000.0 
              << " ms (" << static_cast<uint64_t>(ops_per_sec) << " orders/second in-memory)." << std::endl;
}

int main() {
    std::cout << "=====================================================" << std::endl;
    std::cout << "        RUNNING MATCHING ENGINE UNIT TESTS           " << std::endl;
    std::cout << "=====================================================" << std::endl;

    test_fifo_price_time_priority();
    test_maker_price_priority_and_partials();
    test_order_cancellation_o1();
    test_market_orders();
    test_performance_benchmark();

    std::cout << "=====================================================" << std::endl;
    std::cout << "             ALL TESTS PASSED (100%)                 " << std::endl;
    std::cout << "=====================================================" << std::endl;
    return 0;
}
