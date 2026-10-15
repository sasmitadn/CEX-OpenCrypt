cmake_minimum_required(VERSION 3.16)
project(MatchingEngine CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Optimization flags for microsecond latency
add_compile_options(-O3 -Wall -Wextra -pthread)

include_directories(include)

# 1. Main Matching Engine Daemon
add_executable(matching_engine
    src/main.cpp
    src/OrderBook.cpp
    src/RedisClient.cpp
)

# 2. Unit Test & Benchmark Executable
add_executable(test_orderbook
    tests/test_orderbook.cpp
    src/OrderBook.cpp
)
