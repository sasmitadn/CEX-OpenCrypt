#pragma once

#include "Order.hpp"
#include <string>
#include <cstdint>

namespace cex {

struct Trade {
    std::string trade_id;
    std::string symbol;
    std::string maker_order_id;
    std::string taker_order_id;
    uint64_t maker_user_id{0};
    uint64_t taker_user_id{0};
    int64_t price{0};           // Execution price (Maker's price) in fixed-point
    int64_t quantity{0};        // Executed quantity in fixed-point
    int64_t quote_amount{0};    // (price * quantity) / FIXED_SCALE
    OrderSide maker_side{OrderSide::SELL};
    int64_t timestamp{0};

    double get_price_double() const {
        return fixedToDouble(price);
    }

    double get_quantity_double() const {
        return fixedToDouble(quantity);
    }

    double get_quote_amount_double() const {
        return fixedToDouble(quote_amount);
    }
};

} // namespace cex
