# Panduan Menjalankan & Menggunakan Centralized Crypto Exchange (CEX)

Dokumen ini berisi panduan lengkap untuk menjalankan seluruh ekosistem backend dan frontend CEX dalam **satu perintah (`docker compose up --build`)**, memahami arsitektur microservices yang terhubung, dan menguji siklus perdagangan (*Deposit ➔ Lock ➔ Match ➔ Settle ➔ Withdraw*).

---

## 🏛️ Arsitektur & Peran Setiap Service

Ekosistem CEX terdiri dari 8 service microservices yang saling terintegrasi dalam satu jaringan internal (`cex_network`):

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                        FRONTEND UI (React.js + Vite - Port 3000)                       │
│     Trading Desk, Dynamic Red/Green Orderbook Depth, User Order Markers, Wallets       │
└───────────────────────────────────────────┬────────────────────────────────────────────┘
                                            │ HTTP REST / JSON
                                            ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                   LARAVEL OCTANE BACKEND API (FrankenPHP - Port 8000)                  │
│       - Auth (Sanctum), Markets, Wallets, Balance Locking (lockForUpdate)              │
│       - Endpoint Order Placement (POST /api/v1/orders) ➔ Status OPEN di Order Book     │
└───────────────┬───────────────────────────┬────────────────────────────┬───────────────┘
                │                           │                            │
         Publishes to                       │ Reads/Writes               │
        'order_stream'                      ▼                            │
                │                 ┌─────────────────────┐                │
                ▼                 │ PostgreSQL 16 DB    │                │
     ┌──────────────────────┐     │ (Ledger, Accounts,  │                │
     │  C++ MATCHING ENGINE │     │  Trades, Orders)    │                │
     │ (In-Memory Orderbook)│     └─────────────────────┘                │
     │ Latency < 10 µs      │               ▲                            │
     └──────────┬───────────┘               │                            │
                │                           │                            │
          Publishes to                      │                            │
         'trades_queue'                     │                            │
                │                           │                            │
                ▼                           ▼                            ▼
┌──────────────────────────────┐ ┌──────────────────────┐ ┌───────────────────────────────┐
│  LARAVEL SETTLEMENT WORKER   │ │  LARAVEL SCHEDULER   │ │   NODE.JS BLOCKCHAIN WORKER   │
│ (php artisan cex:settle-trades)│ (php artisan schedule:work)│  - HD Wallet (Master xPub)    │
│ - Lock Maker & Taker Orders  │ │ - Cron Background    │ │  - Deposit Scanner (EVM Logs) │
│ - Swap Balances in Ledger    │ │ - Token Pruning      │ │  - Withdrawal Dispatcher      │
│ - Deduct Exchange Fee        │ │ - Health Heartbeat   │ │  - Port 50052 (gRPC)          │
└──────────────────────────────┘ └──────────────────────┘ └───────────────────────────────┘
```

---

## ⚡ Cara Menjalankan Semua Service dalam 1 Perintah

### 1. Salin File Environment
Buka terminal di root direktori project (`/Users/sasmitadn/Dev/CEX`):
```bash
cp .env.example .env
```

### 2. Jalankan Seluruh Sistem dengan Docker Compose
Cukup jalankan satu perintah:
```bash
docker compose up --build -d
```
> Docker akan membangun image C++ Matching Engine, Node.js Worker, Laravel Octane, dan React Vite, lalu menjalankannya di background.

### 3. Inisialisasi Database & Seeder (Hanya di Awal)
Setelah container berjalan, jalankan migrasi database dan buat data pasar demo:
```bash
docker compose exec laravel-api php artisan migrate:fresh --seed
```
*Perintah ini akan membuat pasangan koin `BTC_USDT`, `ETH_USDT`, token `USDT`, `BTC`, `ETH`, dan akun trader demo.*

---

## 🔑 Kredensial Akun Demo Bawaan

| Parameter | Nilai |
| :--- | :--- |
| **Email** | `trader@cex.com` |
| **Password** | `password123` |
| **Saldo Awal Demo** | **100,000 USDT**, **2.5 BTC**, **25 ETH** |

---

## 🖥️ Cara Mengakses & Menggunakan Aplikasi

Buka browser Anda dan akses:
👉 **[http://localhost:3000](http://localhost:3000)**

### 1. Login Akun
- Klik tombol **Login / Register** di pojok kanan atas.
- Masukkan email `trader@cex.com` dan password `password123`.
- Anda akan langsung masuk dan melihat ringkasan saldo akun.

### 2. Melihat Harga Pasar & Order Book Realtime
- Pada header bagian atas, pilih pasangan perdagangan (misal: **BTC/USDT** atau **ETH/USDT**).
- Kolom kiri menampilkan **Order Book Depth**:
  - **Asks (Merah):** Order jual pasif yang sedang mengantre di memori.
  - **Bids (Hijau):** Order beli pasif yang sedang mengantre di memori.
  - Klik baris harga mana pun di Order Book untuk otomatis mengisinya ke formulir order.

### 3. Memasang Limit Order & Market Order
Pada panel **Place Order** di sisi kanan:
1. Pilih tab **BUY** atau **SELL**.
2. Pilih tipe order:
   - **Limit:** Tentukan harga (*Price*) dan jumlah (*Quantity*). Total dana yang dibutuhkan akan dihitung otomatis.
   - **Market:** Order akan langsung mencocokkan harga terbaik di Order Book.
3. Klik tombol **BUY BTC** / **SELL BTC**:
   - Saldo Anda akan dikunci (*Balance Locking*) via `lockForUpdate()`.
   - Order diterbangkan ke Redis Stream `order_stream`.
   - C++ Matching Engine mencocokkan transaksi secara *in-memory* dalam hitungan mikrodetik.
   - Hasil match dikirim ke `trades_queue` dan dieksekusi oleh Laravel Settlement Worker.
   - Saldo Anda terupdate secara otomatis dan akurat.

### 4. Mengelola Dompet (Deposit & Faucet Demo)
- Klik tombol **💼 Assets / Wallets** di navbar.
- Muncul modal aset yang menampilkan:
  - **Available:** Saldo yang bebas digunakan untuk trading atau withdraw.
  - **Locked:** Saldo yang sedang ditahan di dalam antrean order aktif atau pending withdrawal.
  - **Total:** Akumulasi saldo riil.
- **Deposit On-Chain:** Klik tombol **Deposit** pada aset tertentu untuk melihat alamat deposit publik yang dihasilkan dari Master xPub.
- **Tambah Saldo Cepat (+Faucet):** Klik tombol **+Faucet** untuk langsung mengkreditkan saldo demo (1,000 USDT / 0.5 BTC) tanpa perlu menunggu konfirmasi blockchain.

### 5. Melakukan Penarikan Dana (Withdrawal)
- Pada modal **Assets / Wallets**, terdapat formulir **Request Withdrawal**:
  1. Pilih koin (misal: `USDT`).
  2. Masukkan alamat tujuan (`Destination Address`).
  3. Masukkan nominal (`Amount`).
  4. Klik **Submit Withdrawal**.
- Saldo + fee akan langsung dipindahkan dari `balance` ke `locked_balance` (mencegah *double-spending*).
- Status transaksi akan masuk ke antrean untuk ditandatangani dan disiarkan oleh **Blockchain Worker**.

### 6. Membatalkan Order (Cancel Order)
- Pada tabel **Open Orders & Order History** di bagian bawah tengah:
- Klik tombol merah **Cancel** pada order yang berstatus `OPEN` atau `PENDING`.
- C++ Engine dan Laravel akan membatalkan order secara atomik dan mengembalikan dana yang terkunci ke saldo aktif Anda.

---

## 🛠️ Cheat Sheet Perintah Monitoring & Debugging

| Kebutuhan | Perintah Terminal |
| :--- | :--- |
| **Melihat status semua container** | `docker compose ps` |
| **Melihat log realtime C++ Matching Engine** | `docker compose logs -f matching-engine` |
| **Melihat log realtime Settlement Worker** | `docker compose logs -f settlement-worker` |
| **Melihat log realtime Blockchain Worker** | `docker compose logs -f blockchain-worker` |
| **Melihat antrean trade di Redis** | `docker compose exec redis redis-cli -a secretredis llen trades_queue` |
| **Melihat order stream di Redis** | `docker compose exec redis redis-cli -a secretredis xlen order_stream` |
| **Masuk ke database PostgreSQL** | `docker compose exec postgres psql -U cex_user -d cex_db` |
| **Menjalankan test backend Laravel** | `docker compose exec laravel-api php artisan test` |
| **Mematikan semua service** | `docker compose down` |

---

## 🔒 Catatan Keamanan Finansial Arsitektur
1. **Tidak Ada Floating Point:** Seluruh saldo, order, fee, dan mutasi dihitung menggunakan **BCMath** pada Laravel dan **Fixed-Point Scaling ($10^8$)** pada C++ Matching Engine.
2. **Pessimistic Locking:** Setiap mutasi saldo diapit oleh `DB::transaction()` dan `lockForUpdate()`, menjamin tidak ada saldo negatif walau dihantam jutaan transaksi konkuren.
3. **Double-Entry Ledger:** Setiap sen pergerakan dana dicatat berpasangan (Debit dan Kredit) di tabel `ledger_entries` sebagai audit trail kepatuhan bursa teregulasi.
