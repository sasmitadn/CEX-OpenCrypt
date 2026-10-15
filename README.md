# Centralized Crypto Exchange (CEX) Infrastructure

Template arsitektur microservices untuk Centralized Crypto Exchange (CEX) dengan **Laravel Octane (FrankenPHP)**, **PostgreSQL**, **Redis**, **Blockchain Worker**, dan **gRPC Inter-service Communication** (C++, Node.js, Laravel).

---

## 🏛️ Arsitektur Sistem

```
┌────────────────────────────────────────────────────────────────────────┐
│                              CLIENT                                    │
│             Web UI / Mobile Apps (REST & WebSocket)                   │
└──────────────────┬───────────────────────────────▲─────────────────────┘
                   │ HTTP / REST                   │ WSS (Orderbook/Ticker)
                   ▼                               │
        ┌──────────────────────┐        ┌───────────────────────┐
        │  Laravel Octane API  │        │ Node.js Realtime GW   │
        │   (Port 8000)        │        │   (WebSocket 3001)    │
        └──────────┬───────────┘        └──────────▲────────────┘
                   │                               │
        ┌──────────┴───────────────────────────────┴────────────┐
        │                 gRPC & Redis Pub/Sub                  │
        └──────▲───────────────────────▲─────────────────▲──────┘
               │ gRPC                  │                 │ gRPC / Events
               ▼                       ▼                 ▼
     ┌──────────────────┐    ┌──────────────────┐  ┌──────────────────┐
     │   C++ Matching   │    │  Redis 7 Cluster │  │Blockchain Worker │
     │      Engine      │    │ (Cache & Streams)│  │ (Deposit/Sweeper)│
     │   (Port 50051)   │    └────────▲─────────┘  │   (Port 50052)   │
     └─────────┬────────┘             │            └─────────┬────────┘
               │                      │                      │
               └──────────────┐       │       ┌──────────────┘
                              ▼       ▼       ▼
                        ┌───────────────────────────┐
                        │    PostgreSQL 16 Database │
                        │  (Ledger, Balance, Users) │
                        └───────────────────────────┘
```

---

## 📁 Struktur Direktori

```text
.
├── docker-compose.yml          # Definisi service container
├── .env.example                # Template konfigurasi environment
├── proto/                      # Shared gRPC Protobuf definitions
│   └── exchange.proto          # Schema order matching & blockchain RPC
├── services/
│   ├── laravel-api/            # Core REST API (Laravel Octane FrankenPHP)
│   │   └── Dockerfile
│   ├── blockchain-worker/      # EVM / BTC Scanner & Withdrawal Service
│   │   ├── Dockerfile
│   │   ├── package.json
│   │   └── src/index.js
│   ├── matching-engine/        # (Future) C++ Low-Latency Orderbook Engine
│   └── realtime-gateway/       # (Future) Node.js / Go WebSocket Server
└── README.md
```

---

## 🚀 Panduan Memulai (Step-by-Step)

### Langkah 1: Siapkan Konfigurasi Environment
Salin file `.env.example` ke `.env`:
```bash
cp .env.example .env
```

### Langkah 2: Inisialisasi Project Laravel
Jika Anda belum memiliki file Laravel di `services/laravel-api/`:

1. Buat project Laravel baru di direktori tersebut:
   ```bash
   composer create-project laravel/laravel services/laravel-api
   ```
2. Salin `Dockerfile` kembali ke `services/laravel-api/Dockerfile` jika tertimpa.
3. Install Laravel Octane di dalam project Laravel:
   ```bash
   cd services/laravel-api
   composer require laravel/octane
   php artisan octane:install --server=frankenphp
   cd ../..
   ```

### Langkah 3: Jalankan Container dengan Docker Compose
Build dan jalankan seluruh container di background:
```bash
docker compose up -d --build
```

Periksa status container:
```bash
docker compose ps
```

Lihat log container:
```bash
docker compose logs -f
```

---

## 🔗 Setup gRPC Antar Komponen (C++, Node.js, Laravel)

Semua service terhubung dalam satu docker network (`cex_network`), sehingga bisa berkomunikasi menggunakan **internal DNS**:
- `matching-engine:50051` (C++)
- `blockchain-worker:50052` (Node.js)
- `laravel-api:8000` (Laravel)
- `redis:6379`
- `postgres:5432`

File kontrak gRPC tersimpan di `./proto/exchange.proto`.

### 1. Generate Kode gRPC untuk Laravel (PHP)
Dockerfile `laravel-api` sudah dilengkapi compiler `protobuf-compiler` dan extension `grpc` + `protobuf`.

Untuk meng-generate class PHP dari `proto`:
```bash
docker compose exec laravel-api protoc \
  --proto_path=/app/proto \
  --php_out=/app/app/Grpc \
  --grpc_out=/app/app/Grpc \
  --plugin=protoc-gen-grpc=/usr/local/bin/grpc_php_plugin \
  /app/proto/exchange.proto
```

Lalu tambahkan package gRPC di Laravel:
```bash
docker compose exec laravel-api composer require grpc/grpc google/protobuf
```

### 2. Memanggil Matching Engine (C++) dari Laravel via gRPC
Buat client gRPC di Laravel:
```php
use App\Grpc\Exchange\MatchingEngineServiceClient;
use App\Grpc\Exchange\OrderRequest;
use Grpc\ChannelCredentials;

$client = new MatchingEngineServiceClient(
    env('MATCHING_ENGINE_GRPC_HOST', 'matching-engine:50051'),
    ['credentials' => ChannelCredentials::createInsecure()]
);

$request = new OrderRequest([
    'order_id'   => (string) Str::uuid(),
    'user_id'    => auth()->id(),
    'symbol'     => 'BTC_USDT',
    'side'       => 'BUY',
    'order_type' => 'LIMIT',
    'price'      => '65000.50',
    'quantity'   => '0.25',
    'timestamp'  => now()->getTimestampMs(),
]);

[$response, $status] = $client->PlaceOrder($request)->wait();
```

---

## 💡 Best Practices Krusial dalam Membangun CEX

### 1. Presisi Angka Kripto (WAJIB: Hindari Float!)
> **JANGAN PERNAH** menggunakan tipe data `float` atau `double` untuk balance, harga, atau order kripto karena risiko *floating point precision error*.
- **Di Database (PostgreSQL):** Gunakan `NUMERIC(36, 18)` (36 digit total, 18 digit desimal).
- **Di Laravel (PHP):** Gunakan fungsi bawaan `bcmath` (`bcadd`, `bcsub`, `bcmul`, `bcdiv`, `bccomp`) atau package seperti `brick/math`.
- **Di gRPC:** Kirim harga dan kuantitas dalam format **string** atau **fixed-point integer** (misal satuan Satoshi / Wei).

### 2. Double-Entry Accounting Ledger
Seluruh transaksi saldo (deposit, withdrawal, trading, fee, lock/freeze order) harus dicatat dengan prinsip double-entry ledger:
- Saldo akun adalah **hasil agregasi (SUM)** dari riwayat mutasi jurnal, bukan sekadar mengedit field `balance` langsung di database.
- Terapkan database locking (`SELECT ... FOR UPDATE`) atau optimistic locking jika memutasi saldo.

### 3. Arsitektur Matching Engine (C++)
- Matching Engine harus berjalan **100% in-memory** (menggunakan Red-Black Tree / B-Tree atau SkipList) untuk mencapai throughput > 100.000 trades/detik.
- State matching engine di-backup secara real-time via event log / journal ke Redis Streams atau Kafka.

### 4. Blockchain Worker & Keamanan Wallet
- **Deposit:** Scan block header baru dari RPC node, filter transaksi ke address deposit user. Berikan status `CONFIRMING` (misal 12 konfirmasi) sebelum mengkredit balance ke akun user.
- **Cold/Hot Wallet:** Pisahkan dana:
  - **Hot Wallet (5-10% dana):** Terhubung ke Blockchain Worker otomatis untuk melayani withdrawal kecil.
  - **Cold Wallet (90-95% dana):** Disimpan offline (Multisig / Hardware Security Module) untuk keamanan dari ancaman eksploitasi.

---

## 🛠️ Perintah Berguna

| Aksi | Perintah |
| :--- | :--- |
| **Menjalankan semua service** | `docker compose up -d` |
| **Mematikan semua service** | `docker compose down` |
| **Melihat status service** | `docker compose ps` |
| **Masuk ke shell Laravel** | `docker compose exec laravel-api bash` |
| **Jalankan Artisan Laravel** | `docker compose exec laravel-api php artisan <command>` |
| **Masuk ke Redis CLI** | `docker compose exec redis redis-cli -a secretredis` |
| **Masuk ke PostgreSQL CLI** | `docker compose exec postgres psql -U cex_user -d cex_db` |
