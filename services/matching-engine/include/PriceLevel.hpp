#pragma once

#include "Order.hpp"
#include <list>
#include <cstdint>

namespace cex {

struct PriceLevel {
    int64_t price{0};
    int64_t total_volume{0};       // Total remaining volume at this price level
    std::list<Order> orders;       // FIFO queue of resting orders at this price

    explicit PriceLevel(int64_t p = 0) : price(p), total_volume(0) {}

    bool empty() const {
        return orders.empty();
    }

    size_t order_count() const {
        return orders.size();
    }
};

} // namespace cex
