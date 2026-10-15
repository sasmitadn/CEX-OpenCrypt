FROM dunglas/frankenphp:latest

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    curl \
    unzip \
    libpq-dev \
    libzip-dev \
    zip \
    && rm -rf /var/lib/apt/lists/*

# Install essential PHP extensions for financial CEX:
# - bcmath: vital for arbitrary precision crypto decimal math
# - pcntl & sockets: required by Octane and networking
# - pdo_pgsql: PostgreSQL connection
# - redis: Redis extension
# - zip: standard file handling
RUN install-php-extensions \
    bcmath \
    pcntl \
    sockets \
    pdo_pgsql \
    redis \
    zip

# Install Composer
COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

WORKDIR /app

# Expose Octane FrankenPHP port
EXPOSE 8000

# Default command: start Octane with FrankenPHP
CMD ["php", "artisan", "octane:frankenphp", "--host=0.0.0.0", "--port=8000"]
