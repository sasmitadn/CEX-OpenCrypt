#include "RedisClient.hpp"

#include <sys/types.h>
#include <sys/socket.h>
#include <netinet/in.h>
#include <arpa/inet.h>
#include <netdb.h>
#include <unistd.h>
#include <cstring>
#include <sstream>
#include <iostream>

namespace cex {

RedisClient::RedisClient(std::string host, int port, std::string password)
    : host_(std::move(host)), port_(port), password_(std::move(password)) {}

RedisClient::~RedisClient() {
    disconnect();
}

bool RedisClient::connect() {
    disconnect();

    struct addrinfo hints{}, *res = nullptr;
    hints.ai_family = AF_INET;
    hints.ai_socktype = SOCK_STREAM;

    std::string portStr = std::to_string(port_);
    if (getaddrinfo(host_.c_str(), portStr.c_str(), &hints, &res) != 0 || !res) {
        std::cerr << "[RedisClient] DNS resolution failed for " << host_ << std::endl;
        return false;
    }

    sock_fd_ = socket(res->ai_family, res->ai_socktype, res->ai_protocol);
    if (sock_fd_ < 0) {
        freeaddrinfo(res);
        return false;
    }

    // Set timeout 3 detik
    struct timeval tv;
    tv.tv_sec = 3;
    tv.tv_usec = 0;
    setsockopt(sock_fd_, SOL_SOCKET, SO_RCVTIMEO, (const char*)&tv, sizeof tv);
    setsockopt(sock_fd_, SOL_SOCKET, SO_SNDTIMEO, (const char*)&tv, sizeof tv);

    if (::connect(sock_fd_, res->ai_addr, res->ai_addrlen) < 0) {
        freeaddrinfo(res);
        close(sock_fd_);
        sock_fd_ = -1;
        return false;
    }
    freeaddrinfo(res);

    // Auth jika ada password
    if (!password_.empty()) {
        std::string cmd = buildCommand({"AUTH", password_});
        sendRaw(cmd);
        std::string resp = readResponse();
        if (resp.find("+OK") == std::string::npos) {
            std::cerr << "[RedisClient] AUTH failed: " << resp << std::endl;
            disconnect();
            return false;
        }
    }

    return true;
}

void RedisClient::disconnect() {
    if (sock_fd_ >= 0) {
        close(sock_fd_);
        sock_fd_ = -1;
    }
}

std::string RedisClient::buildCommand(const std::vector<std::string>& args) {
    std::ostringstream ss;
    ss << "*" << args.size() << "\r\n";
    for (const auto& arg : args) {
        ss << "$" << arg.length() << "\r\n" << arg << "\r\n";
    }
    return ss.str();
}

bool RedisClient::sendRaw(const std::string& data) {
    if (sock_fd_ < 0) return false;
    size_t total = 0;
    while (total < data.length()) {
        ssize_t sent = send(sock_fd_, data.c_str() + total, data.length() - total, 0);
        if (sent <= 0) {
            disconnect();
            return false;
        }
        total += sent;
    }
    return true;
}

std::string RedisClient::readResponse() {
    if (sock_fd_ < 0) return "";
    char buffer[4096];
    ssize_t n = recv(sock_fd_, buffer, sizeof(buffer) - 1, 0);
    if (n <= 0) {
        return "";
    }
    buffer[n] = '\0';
    return std::string(buffer, n);
}

bool RedisClient::ping() {
    if (!isConnected() && !connect()) return false;
    sendRaw(buildCommand({"PING"}));
    std::string resp = readResponse();
    return resp.find("+PONG") != std::string::npos;
}

bool RedisClient::publish(const std::string& channel, const std::string& message) {
    if (!isConnected() && !connect()) return false;
    sendRaw(buildCommand({"PUBLISH", channel, message}));
    std::string resp = readResponse();
    return resp.rfind(":", 0) == 0; // Integer reply :<subscribers>
}

bool RedisClient::lpush(const std::string& key, const std::string& value) {
    if (!isConnected() && !connect()) return false;
    sendRaw(buildCommand({"LPUSH", key, value}));
    std::string resp = readResponse();
    return resp.rfind(":", 0) == 0;
}

std::string RedisClient::xadd(const std::string& stream, const std::unordered_map<std::string, std::string>& fields) {
    if (!isConnected() && !connect()) return "";

    std::vector<std::string> args = {"XADD", stream, "*"};
    for (const auto& [k, v] : fields) {
        args.push_back(k);
        args.push_back(v);
    }

    sendRaw(buildCommand(args));
    std::string resp = readResponse();
    // Parse bulk string: $19\r\n1700000000000-0\r\n
    if (resp.rfind("$", 0) == 0) {
        size_t first = resp.find("\r\n");
        if (first != std::string::npos) {
            size_t second = resp.find("\r\n", first + 2);
            if (second != std::string::npos) {
                return resp.substr(first + 2, second - (first + 2));
            }
        }
    }
    return "";
}

std::vector<RedisClient::StreamMessage> RedisClient::xreadGroupOrStream(
    const std::string& stream,
    const std::string& last_id,
    int block_ms
) {
    std::vector<StreamMessage> messages;
    if (!isConnected() && !connect()) return messages;

    std::vector<std::string> args = {
        "XREAD",
        "BLOCK", std::to_string(block_ms),
        "STREAMS", stream, last_id
    };

    sendRaw(buildCommand(args));
    std::string resp = readResponse();
    if (resp.empty() || resp == "$-1\r\n") {
        return messages; // Timeout atau tidak ada data
    }

    // Simple parser for Redis stream responses
    std::vector<std::string> tokens;
    size_t pos = 0;
    while ((pos = resp.find("\r\n")) != std::string::npos) {
        std::string line = resp.substr(0, pos);
        resp.erase(0, pos + 2);
        if (!line.empty() && line[0] != '*' && line[0] != '$') {
            tokens.push_back(line);
        }
    }

    // Pattern in tokens: [stream_name, id, key1, val1, key2, val2, ...]
    if (tokens.size() >= 3) {
        size_t idx = 1;
        while (idx < tokens.size()) {
            if (tokens[idx].find('-') != std::string::npos) {
                StreamMessage msg;
                msg.id = tokens[idx++];
                while (idx + 1 < tokens.size() && tokens[idx].find('-') == std::string::npos) {
                    msg.fields[tokens[idx]] = tokens[idx + 1];
                    idx += 2;
                }
                messages.push_back(msg);
            } else {
                idx++;
            }
        }
    }

    return messages;
}

} // namespace cex
