# Multi-stage Dockerfile for C++ Matching Engine
FROM alpine:3.20 AS builder

RUN apk add --no-cache \
    build-base \
    cmake \
    git

WORKDIR /app

COPY CMakeLists.txt ./
COPY include/ ./include/
COPY src/ ./src/
COPY tests/ ./tests/

RUN cmake -B build -DCMAKE_BUILD_TYPE=Release && \
    cmake --build build --target matching_engine

# Production Runner Image (Minimal Alpine ~10MB)
FROM alpine:3.20

RUN apk add --no-cache libstdc++

WORKDIR /app

COPY --from=builder /app/build/matching_engine /app/matching_engine

ENV REDIS_HOST=redis \
    REDIS_PORT=6379 \
    REDIS_PASSWORD=secretredis

CMD ["/app/matching_engine"]
