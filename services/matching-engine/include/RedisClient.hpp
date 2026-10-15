#pragma once

#include <string>
#include <vector>
#include <unordered_map>
#include <functional>
#include <optional>
#include <cstdint>

namespace cex {

class RedisClient {
public:
    RedisClient(std::string host, int port, std::string password = "");
    ~RedisClient();

    bool connect();
    void disconnect();
    bool isConnected() const { return sock_fd_ >= 0; }

    // Eksekusi command Redis umum
    bool ping();
    bool publish(const std::string& channel, const std::string& message);
    bool lpush(const std::string& key, const std::string& value);
    std::string xadd(const std::string& stream, const std::unordered_map<std::string, std::string>& fields);

    // Stream Reader struct
    struct StreamMessage {
        std::string id;
        std::unordered_map<std::string, std::string> fields;
    };

    std::vector<StreamMessage> xreadGroupOrStream(
        const std::string& stream,
        const std::string& last_id = "$",
        int block_ms = 1000
    );

private:
    std::string host_;
    int port_;
    std::string password_;
    int sock_fd_{-1};

    bool sendRaw(const std::string& data);
    std::string readResponse();
    std::string buildCommand(const std::vector<std::string>& args);
    std::vector<std::string> parseRespArray(const std::string& resp);
};

} // namespace cex
