#pragma once

#include <string>
#include <cstdint>
#include <cmath>

namespace cex {

// Fixed-point scale for 8 decimal places: 1.0 = 100,000,000
constexpr int64_t FIXED_SCALE = 100000000LL;

inline int64_t doubleToFixed(double val) {
    return static_cast<int64_t>(std::round(val * FIXED_SCALE));
}

inline double fixedToDouble(int64_t fixedVal) {
    return static_cast<double>(fixedVal) / FIXED_SCALE;
}

inline int64_t stringToFixed(const std::string& str) {
    if (str.empty()) return 0;
    try {
        double d = std::stod(str);
        return doubleToFixed(d);
    } catch (...) {
        return 0;
    }
}

enum class OrderSide {
    BUY,
    SELL
};

enum class OrderType {
    LIMIT,
    MARKET
};

enum class OrderStatus {
    PENDING,
    OPEN,
    PARTIALLY_FILLED,
    FILLED,
    CANCELED,
    REJECTED
};

inline std::string sideToString(OrderSide side) {
    return side == OrderSide::BUY ? "BUY" : "SELL";
}

inline OrderSide stringToSide(const std::string& sideStr) {
    return (sideStr == "BUY" || sideStr == "buy") ? OrderSide::BUY : OrderSide::SELL;
}

inline std::string typeToString(OrderType type) {
    return type == OrderType::LIMIT ? "LIMIT" : "MARKET";
}

inline OrderType stringToType(const std::string& typeStr) {
    return (typeStr == "MARKET" || typeStr == "market") ? OrderType::MARKET : OrderType::LIMIT;
}

struct Order {
    std::string order_id;
    uint64_t user_id{0};
    std::string symbol;
    OrderSide side{OrderSide::BUY};
    OrderType type{OrderType::LIMIT};
    int64_t price{0};           // Fixed point (scaled 10^8)
    int64_t quantity{0};        // Fixed point (scaled 10^8)
    int64_t filled_quantity{0}; // Fixed point (scaled 10^8)
    int64_t timestamp{0};       // Epoch milliseconds for FIFO priority

    int64_t remaining_quantity() const {
        return quantity > filled_quantity ? (quantity - filled_quantity) : 0;
    }

    bool is_filled() const {
        return filled_quantity >= quantity;
    }

    double get_price_double() const {
        return fixedToDouble(price);
    }

    double get_quantity_double() const {
        return fixedToDouble(quantity);
    }

    double get_remaining_double() const {
        return fixedToDouble(remaining_quantity());
    }
};

} // namespace cex
