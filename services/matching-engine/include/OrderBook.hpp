#pragma once

#include "Order.hpp"
#include "Trade.hpp"
#include "PriceLevel.hpp"

#include <map>
#include <unordered_map>
#include <vector>
#include <optional>
#include <string>
#include <functional>
#include <chrono>

namespace cex {

class OrderBook {
public:
    explicit OrderBook(std::string symbol);

    const std::string& getSymbol() const { return symbol_; }

    /**
     * Memproses order baru (LIMIT atau MARKET) dan mengembalikan daftar trade yang ter-match
     */
    std::vector<Trade> placeOrder(Order taker_order);

    /**
     * Membatalkan order aktif dari orderbook dalam kompleksitas O(1)
     */
    bool cancelOrder(const std::string& order_id, Order& canceled_order);

    /**
     * Dapatkan harga terbaik (Best Bid & Best Ask)
     */
    std::optional<int64_t> getBestBid() const;
    std::optional<int64_t> getBestAsk() const;

    /**
     * Dapatkan snapshot kedalaman order book (bids dan asks: [price, volume])
     */
    struct DepthSnapshot {
        std::string symbol;
        std::vector<std::pair<double, double>> bids; // [price, volume]
        std::vector<std::pair<double, double>> asks; // [price, volume]
        int64_t timestamp;
    };

    DepthSnapshot getDepth(size_t limit = 20) const;

    /**
     * Statistik buku order
     */
    size_t totalOrders() const { return order_map_.size(); }
    size_t bidLevelCount() const { return bids_.size(); }
    size_t askLevelCount() const { return asks_.size(); }

private:
    std::string symbol_;

    // 1. Level Harga Bids: Diurutkan dari harga tertinggi ke terendah (std::greater)
    std::map<int64_t, PriceLevel, std::greater<int64_t>> bids_;

    // 2. Level Harga Asks: Diurutkan dari harga terendah ke tertinggi (std::less)
    std::map<int64_t, PriceLevel, std::less<int64_t>> asks_;

    // 3. Order Lookup Table: order_id -> { price, side, iterator } untuk O(1) cancel order
    struct OrderLocation {
        int64_t price;
        OrderSide side;
        std::list<Order>::iterator iter;
    };
    std::unordered_map<std::string, OrderLocation> order_map_;

    // Helper functions
    std::vector<Trade> matchBuyOrder(Order& taker_order);
    std::vector<Trade> matchSellOrder(Order& taker_order);
    std::string generateTradeId();
    int64_t currentTimestampMs() const;
};

} // namespace cex
