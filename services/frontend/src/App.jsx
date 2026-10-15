import React, { useState, useEffect } from 'react';
import { authApi, marketApi, walletApi, orderApi, setAuthToken, getAuthToken } from './api';

export default function App() {
  const [user, setUser] = useState(null);
  const [markets, setMarkets] = useState([]);
  const [selectedMarket, setSelectedMarket] = useState('BTC_USDT');
  const [depth, setDepth] = useState({ bids: [], asks: [] });
  const [wallets, setWallets] = useState([]);
  const [orders, setOrders] = useState([]);
  const [recentTrades, setRecentTrades] = useState([]);

  // Order Form State
  const [orderSide, setOrderSide] = useState('BUY'); // BUY or SELL
  const [orderType, setOrderType] = useState('LIMIT'); // LIMIT or MARKET
  const [price, setPrice] = useState('65000.00');
  const [quantity, setQuantity] = useState('0.1');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [formSuccess, setFormSuccess] = useState('');

  // Modals
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authMode, setAuthMode] = useState('login'); // login or register
  const [authEmail, setAuthEmail] = useState('trader@cex.com');
  const [authPassword, setAuthPassword] = useState('password123');
  const [authName, setAuthName] = useState('Pro Trader');
  const [authError, setAuthError] = useState('');

  const [showWalletModal, setShowWalletModal] = useState(false);
  const [depositAddress, setDepositAddress] = useState(null);
  const [withdrawCurrency, setWithdrawCurrency] = useState('USDT');
  const [withdrawAddress, setWithdrawAddress] = useState('');
  const [withdrawAmount, setWithdrawAmount] = useState('50');
  const [withdrawStatus, setWithdrawStatus] = useState('');

  // 1. Initial Load & Auth Check
  useEffect(() => {
    checkAuth();
    loadMarkets();
    const interval = setInterval(() => {
      loadDepth(selectedMarket);
      loadRecentTrades(selectedMarket);
    }, 2000);
    return () => clearInterval(interval);
  }, [selectedMarket]);

  useEffect(() => {
    if (user) {
      loadWallets();
      loadUserOrders();
    }
  }, [user, selectedMarket]);

  async function checkAuth() {
    if (!getAuthToken()) return;
    try {
      const res = await authApi.me();
      if (res.success) setUser(res.data);
    } catch {
      setAuthToken(null);
      setUser(null);
    }
  }

  async function loadMarkets() {
    try {
      const res = await marketApi.getMarkets();
      if (res.success && res.data.length > 0) {
        setMarkets(res.data);
      }
    } catch (err) {
      console.warn('Failed to load markets:', err.message);
    }
  }

  async function loadDepth(symbol) {
    try {
      const res = await marketApi.getDepth(symbol);
      if (res.success) {
        setDepth(res.data);
        if (res.data.bids.length > 0 && orderType === 'LIMIT' && !price) {
          setPrice(res.data.bids[0][0]);
        }
      }
    } catch (err) {
      // offline / mock depth
    }
  }

  async function loadRecentTrades(symbol) {
    try {
      const res = await marketApi.getTrades(symbol);
      if (res.success) setRecentTrades(res.data);
    } catch {
      // ignore
    }
  }

  async function loadWallets() {
    try {
      const res = await walletApi.getWallets();
      if (res.success) setWallets(res.data);
    } catch {
      // ignore
    }
  }

  async function loadUserOrders() {
    try {
      const res = await orderApi.getOrders(selectedMarket);
      if (res.success) setOrders(res.data);
    } catch {
      // ignore
    }
  }

  // Handle Auth
  async function handleAuthSubmit(e) {
    e.preventDefault();
    setAuthError('');
    try {
      let res;
      if (authMode === 'login') {
        res = await authApi.login(authEmail, authPassword);
      } else {
        res = await authApi.register(authName, authEmail, authPassword);
      }
      if (res.success) {
        setAuthToken(res.data.token);
        setUser(res.data.user);
        setShowAuthModal(false);
        loadWallets();
      }
    } catch (err) {
      setAuthError(err.message);
    }
  }

  function handleLogout() {
    authApi.logout().catch(() => { });
    setAuthToken(null);
    setUser(null);
    setWallets([]);
    setOrders([]);
  }

  // Handle Order Placement
  async function handleOrderSubmit(e) {
    e.preventDefault();
    if (!user) {
      setShowAuthModal(true);
      return;
    }
    setFormError('');
    setFormSuccess('');
    setIsSubmitting(true);

    try {
      const payload = {
        symbol: selectedMarket,
        side: orderSide,
        type: orderType,
        quantity: quantity,
        price: orderType === 'LIMIT' ? price : null,
      };

      const res = await orderApi.placeOrder(payload);
      if (res.success) {
        setFormSuccess(`Order ${orderSide} berhasil dibuat!`);
        loadWallets();
        loadUserOrders();
        loadDepth(selectedMarket);
      }
    } catch (err) {
      setFormError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  }

  // Cancel Order
  async function handleCancelOrder(uuid) {
    try {
      await orderApi.cancelOrder(uuid);
      loadUserOrders();
      loadWallets();
    } catch (err) {
      alert('Gagal membatalkan order: ' + err.message);
    }
  }

  // Handle Faucet
  async function handleFaucet(currency, amount) {
    try {
      const res = await walletApi.faucet(currency, amount);
      if (res.success) {
        alert(res.message);
        loadWallets();
      }
    } catch (err) {
      alert(err.message);
    }
  }

  // Get Deposit Address
  async function handleGetDepositAddress(currency) {
    try {
      const res = await walletApi.getDepositAddress(currency, 'SEPOLIA');
      if (res.success) setDepositAddress(res.data);
    } catch (err) {
      alert(err.message);
    }
  }

  // Handle Withdraw
  async function handleWithdrawSubmit(e) {
    e.preventDefault();
    setWithdrawStatus('');
    try {
      const res = await walletApi.withdraw(withdrawCurrency, 'SEPOLIA', withdrawAddress, withdrawAmount);
      if (res.success) {
        setWithdrawStatus('Penarikan dana berhasil diajukan!');
        loadWallets();
      }
    } catch (err) {
      setWithdrawStatus('Error: ' + err.message);
    }
  }

  // Current pair info
  const [baseCoin, quoteCoin] = selectedMarket.split('_');
  const baseWallet = wallets.find((w) => w.currency === baseCoin) || { balance: '0', locked: '0' };
  const quoteWallet = wallets.find((w) => w.currency === quoteCoin) || { balance: '0', locked: '0' };

  // Hitung volume maksimum untuk visual depth bar (hijau/merah)
  const maxAskVolume = Math.max(
    ...depth.asks.slice(0, 15).map(([_, v]) => Number(v) || 0),
    0.001
  );
  const maxBidVolume = Math.max(
    ...depth.bids.slice(0, 15).map(([_, v]) => Number(v) || 0),
    0.001
  );

  // Catat harga order aktif milik user yang sedang login
  const userOpenPrices = new Set(
    orders
      .filter((o) => o.status === 'OPEN' || o.status === 'PENDING' || o.status === 'PARTIALLY_FILLED')
      .map((o) => Number(o.price).toFixed(2))
  );

  const highestBid = depth.bids.length > 0 ? Number(depth.bids[0][0]) : null;
  const lowestAsk = depth.asks.length > 0 ? Number(depth.asks[0][0]) : null;
  const spread = (highestBid && lowestAsk && lowestAsk >= highestBid) ? (lowestAsk - highestBid) : 0;
  const spreadPct = highestBid && lowestAsk && lowestAsk > 0 ? ((spread / lowestAsk) * 100).toFixed(2) : '0.00';

  return (
    <div>
      {/* 1. Header */}
      <header className="cex-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '30px' }}>
          <div className="cex-logo">
            <span>⚡ CEX CORE</span>
            <span className="logo-badge">ULTRA FAST</span>
          </div>

          <div className="market-ticker-bar">
            {markets.map((m) => (
              <div
                key={m.symbol}
                className={`ticker-item ${selectedMarket === m.symbol ? 'active' : ''}`}
                onClick={() => setSelectedMarket(m.symbol)}
              >
                <span style={{ fontWeight: 600 }}>{m.symbol.replace('_', '/')}</span>
                <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-buy)' }}>
                  ${Number(m.last_price).toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="nav-actions">
          {user ? (
            <>
              <button className="btn-secondary" onClick={() => setShowWalletModal(true)}>
                💼 Assets / Wallets
              </button>
              <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                {user.email}
              </div>
              <button className="btn-secondary" style={{ padding: '6px 12px' }} onClick={handleLogout}>
                Logout
              </button>
            </>
          ) : (
            <button className="btn-primary" onClick={() => setShowAuthModal(true)}>
              Login / Register
            </button>
          )}
        </div>
      </header>

      {/* 2. Main Exchange Layout */}
      <div className="main-layout">
        {/* Kolom 1: Order Book */}
        <div className="cex-panel">
          <div className="panel-header">
            <span>Order Book</span>
            <span style={{ color: 'var(--text-dim)', fontSize: '0.75rem' }}>{selectedMarket}</span>
          </div>

          <div style={{ flex: 1, overflowY: 'auto' }}>
            {/* Header Asks */}
            <div className="orderbook-sub-header ask-sub-header">
              <span>🔴 SELL / ASKS</span>
              <span style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>Top 12</span>
            </div>

            {/* Asks (Jual - Merah) */}
            <table className="orderbook-table">
              <thead>
                <tr>
                  <th>Price ({quoteCoin})</th>
                  <th>Size ({baseCoin})</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {depth.asks.length === 0 ? (
                  <tr>
                    <td colSpan="3" className="orderbook-empty">
                      Belum ada antrean jual. Buat order SELL untuk menambah likuiditas!
                    </td>
                  </tr>
                ) : (
                  depth.asks.slice(0, 12).reverse().map(([p, v], i) => {
                    const numP = Number(p);
                    const numV = Number(v);
                    const pct = Math.min(100, Math.max(6, Math.round((numV / maxAskVolume) * 100)));
                    const isUserOrder = userOpenPrices.has(numP.toFixed(2));

                    return (
                      <tr
                        key={`ask-${i}-${p}`}
                        className={`orderbook-row ask-row ${isUserOrder ? 'user-order-active' : ''}`}
                        onClick={() => {
                          setPrice(numP.toFixed(2));
                          setQuantity(numV.toFixed(4));
                        }}
                        style={{
                          background: `linear-gradient(to left, rgba(239, 68, 68, 0.22) ${pct}%, transparent ${pct}%)`,
                        }}
                        title={`Klik untuk memasukkan harga: $${numP.toFixed(2)} (Ukuran: ${numV.toFixed(4)} ${baseCoin})`}
                      >
                        <td className="price-ask">
                          {numP.toFixed(2)}
                          {isUserOrder && <span className="user-order-dot" title="Order aktif milik Anda">● Anda</span>}
                        </td>
                        <td>{numV.toFixed(4)}</td>
                        <td>{(numP * numV).toFixed(2)}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>

            {/* Mid Price & Spread */}
            <div className="mid-market-price">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                <span className="price-bid" style={{ fontSize: '1.25rem' }}>
                  ${highestBid ? highestBid.toFixed(2) : (lowestAsk ? lowestAsk.toFixed(2) : '65,000.00')}
                </span>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>
                  {lowestAsk && highestBid ? (lowestAsk >= highestBid ? '▲' : '▼') : '—'}
                </span>
              </div>
              <div className="spread-info">
                Spread: ${spread.toFixed(2)} ({spreadPct}%)
              </div>
            </div>

            {/* Header Bids */}
            <div className="orderbook-sub-header bid-sub-header">
              <span>🟢 BUY / BIDS</span>
              <span style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>Top 12</span>
            </div>

            {/* Bids (Beli - Hijau) */}
            <table className="orderbook-table">
              <tbody>
                {depth.bids.length === 0 ? (
                  <tr>
                    <td colSpan="3" className="orderbook-empty">
                      Belum ada antrean beli. Buat order BUY untuk menambah likuiditas!
                    </td>
                  </tr>
                ) : (
                  depth.bids.slice(0, 12).map(([p, v], i) => {
                    const numP = Number(p);
                    const numV = Number(v);
                    const pct = Math.min(100, Math.max(6, Math.round((numV / maxBidVolume) * 100)));
                    const isUserOrder = userOpenPrices.has(numP.toFixed(2));

                    return (
                      <tr
                        key={`bid-${i}-${p}`}
                        className={`orderbook-row bid-row ${isUserOrder ? 'user-order-active' : ''}`}
                        onClick={() => {
                          setPrice(numP.toFixed(2));
                          setQuantity(numV.toFixed(4));
                        }}
                        style={{
                          background: `linear-gradient(to left, rgba(16, 185, 129, 0.22) ${pct}%, transparent ${pct}%)`,
                        }}
                        title={`Klik untuk memasukkan harga: $${numP.toFixed(2)} (Ukuran: ${numV.toFixed(4)} ${baseCoin})`}
                      >
                        <td className="price-bid">
                          {numP.toFixed(2)}
                          {isUserOrder && <span className="user-order-dot" title="Order aktif milik Anda">● Anda</span>}
                        </td>
                        <td>{numV.toFixed(4)}</td>
                        <td>{(numP * numV).toFixed(2)}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Kolom 2: Chart & User Orders Table */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {/* Chart Header Mockup */}
          <div className="cex-panel" style={{ height: '360px', padding: '20px', position: 'relative' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h2 style={{ fontSize: '1.5rem', fontWeight: 700 }}>
                  {selectedMarket.replace('_', ' / ')}
                </h2>
                <div style={{ color: 'var(--color-buy)', fontFamily: 'var(--font-mono)', fontSize: '1.8rem', fontWeight: 800 }}>
                  ${
                    depth?.bids?.length > 0 && depth?.asks?.length > 0
                      ? (
                        (parseFloat(depth.bids[0][0]) + parseFloat(depth.asks[0][0])) / 2
                      ).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                      : '-'
                  }
                </div>
              </div>
              <div style={{ display: 'flex', gap: '12px', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                <div>24h High: <strong style={{ color: 'var(--text-main)' }}>$67,400.00</strong></div>
                <div>24h Low: <strong style={{ color: 'var(--text-main)' }}>$63,800.00</strong></div>
                <div>24h Vol: <strong style={{ color: 'var(--text-main)' }}>1,420.50 BTC</strong></div>
              </div>
            </div>

            {/* Interactive Grid Canvas simulation */}
            <div style={{
              flex: 1,
              marginTop: '20px',
              border: '1px dashed var(--border-color)',
              borderRadius: '8px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'radial-gradient(circle at center, rgba(59, 130, 246, 0.08) 0%, transparent 70%)',
              color: 'var(--text-dim)',
              fontFamily: 'var(--font-mono)'
            }}>
              [ Realtime In-Memory Order Engine: Latency &lt; 10 µs | C++ Matching Active ]
            </div>
          </div>

          {/* User Orders & Trade History */}
          <div className="cex-panel" style={{ flex: 1, minHeight: '260px' }}>
            <div className="panel-header">
              <span>Open Orders & Order History</span>
              {user && <span style={{ color: 'var(--text-dim)' }}>User #{user.id}</span>}
            </div>

            <div style={{ overflowX: 'auto', padding: '8px' }}>
              <table className="orderbook-table" style={{ textAlign: 'left' }}>
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Pair</th>
                    <th>Side</th>
                    <th>Price</th>
                    <th>Quantity</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.length === 0 ? (
                    <tr>
                      <td colSpan="7" style={{ textAlign: 'center', padding: '30px', color: 'var(--text-dim)' }}>
                        {user ? 'Belum ada order aktif.' : 'Silakan login untuk melihat riwayat order.'}
                      </td>
                    </tr>
                  ) : (
                    orders.map((ord) => (
                      <tr key={ord.uuid} className="orderbook-row">
                        <td style={{ color: 'var(--text-dim)' }}>{new Date(ord.created_at).toLocaleTimeString()}</td>
                        <td><strong>{ord.symbol}</strong></td>
                        <td className={ord.side === 'BUY' ? 'price-bid' : 'price-ask'}>{ord.side}</td>
                        <td>{Number(ord.price).toFixed(2)}</td>
                        <td>{Number(ord.quantity).toFixed(4)}</td>
                        <td>
                          <span style={{
                            padding: '2px 6px',
                            borderRadius: '4px',
                            fontSize: '0.75rem',
                            background: ord.status === 'FILLED' ? 'var(--color-buy-bg)' : 'var(--border-color)',
                            color: ord.status === 'FILLED' ? 'var(--color-buy)' : 'var(--text-muted)'
                          }}>
                            {ord.status}
                          </span>
                        </td>
                        <td>
                          {['OPEN', 'PENDING', 'PARTIALLY_FILLED'].includes(ord.status) && (
                            <button
                              style={{ background: 'transparent', border: '1px solid var(--color-sell)', color: 'var(--color-sell)', borderRadius: '4px', padding: '2px 8px', cursor: 'pointer' }}
                              onClick={() => handleCancelOrder(ord.uuid)}
                            >
                              Cancel
                            </button>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Kolom 3: Order Form */}
        <div className="cex-panel">
          <div className="panel-header">
            <span>Place Order</span>
            <span style={{ color: 'var(--text-dim)', fontSize: '0.8rem' }}>Spot Trading</span>
          </div>

          <form className="order-form-container" onSubmit={handleOrderSubmit}>
            {/* BUY / SELL Switch */}
            <div className="tabs-switch">
              <button
                type="button"
                className={`tab-btn ${orderSide === 'BUY' ? 'active buy' : ''}`}
                onClick={() => setOrderSide('BUY')}
              >
                BUY {baseCoin}
              </button>
              <button
                type="button"
                className={`tab-btn ${orderSide === 'SELL' ? 'active sell' : ''}`}
                onClick={() => setOrderSide('SELL')}
              >
                SELL {baseCoin}
              </button>
            </div>

            {/* LIMIT / MARKET Switch */}
            <div className="tabs-switch">
              <button
                type="button"
                className={`tab-btn ${orderType === 'LIMIT' ? 'active' : ''}`}
                onClick={() => setOrderType('LIMIT')}
              >
                Limit
              </button>
              <button
                type="button"
                className={`tab-btn ${orderType === 'MARKET' ? 'active' : ''}`}
                onClick={() => setOrderType('MARKET')}
              >
                Market
              </button>
            </div>

            {/* Available Balance display */}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              <span>Available:</span>
              <strong style={{ color: 'var(--text-main)', fontFamily: 'var(--font-mono)' }}>
                {orderSide === 'BUY'
                  ? `${Number(quoteWallet.balance).toFixed(2)} ${quoteCoin}`
                  : `${Number(baseWallet.balance).toFixed(4)} ${baseCoin}`}
              </strong>
            </div>

            {/* Price Field (for Limit order) */}
            {orderType === 'LIMIT' && (
              <div className="form-field">
                <label className="field-label">Order Price</label>
                <div className="input-group">
                  <input
                    type="number"
                    step="any"
                    className="cex-input"
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    required
                  />
                  <span className="input-suffix">{quoteCoin}</span>
                </div>
              </div>
            )}

            {/* Quantity Field */}
            <div className="form-field">
              <label className="field-label">Quantity</label>
              <div className="input-group">
                <input
                  type="number"
                  step="any"
                  className="cex-input"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  required
                />
                <span className="input-suffix">{baseCoin}</span>
              </div>
            </div>

            {/* Total Order Notional */}
            {orderType === 'LIMIT' && (
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', padding: '6px 0', borderTop: '1px solid var(--border-color)' }}>
                <span style={{ color: 'var(--text-muted)' }}>Total:</span>
                <strong style={{ fontFamily: 'var(--font-mono)' }}>
                  {(Number(price || 0) * Number(quantity || 0)).toFixed(2)} {quoteCoin}
                </strong>
              </div>
            )}

            {formError && (
              <div style={{ padding: '8px 12px', background: 'var(--color-sell-bg)', color: 'var(--color-sell)', borderRadius: '6px', fontSize: '0.8rem' }}>
                {formError}
              </div>
            )}
            {formSuccess && (
              <div style={{ padding: '8px 12px', background: 'var(--color-buy-bg)', color: 'var(--color-buy)', borderRadius: '6px', fontSize: '0.8rem' }}>
                {formSuccess}
              </div>
            )}

            <button
              type="submit"
              className={`action-btn ${orderSide.toLowerCase()}`}
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Placing Order...' : `${orderSide} ${baseCoin}`}
            </button>
          </form>
        </div>
      </div>

      {/* 3. Modal Wallet / Assets */}
      {showWalletModal && (
        <div className="modal-overlay" onClick={() => setShowWalletModal(false)}>
          <div className="modal-box" style={{ maxWidth: '640px' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span>💼 Wallet & Balances</span>
              <button className="close-btn" onClick={() => setShowWalletModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              {/* Balances List */}
              <table className="orderbook-table" style={{ textAlign: 'left' }}>
                <thead>
                  <tr>
                    <th>Asset</th>
                    <th>Available</th>
                    <th>Locked</th>
                    <th>Total</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {wallets.map((w) => (
                    <tr key={w.currency} className="orderbook-row">
                      <td><strong>{w.currency}</strong></td>
                      <td style={{ color: 'var(--color-buy)' }}>{Number(w.balance).toFixed(4)}</td>
                      <td style={{ color: 'var(--text-dim)' }}>{Number(w.locked).toFixed(4)}</td>
                      <td><strong>{Number(w.total).toFixed(4)}</strong></td>
                      <td>
                        <button
                          className="btn-secondary"
                          style={{ padding: '3px 8px', fontSize: '0.75rem', marginRight: '4px' }}
                          onClick={() => handleGetDepositAddress(w.currency)}
                        >
                          Deposit
                        </button>
                        <button
                          className="btn-secondary"
                          style={{ padding: '3px 8px', fontSize: '0.75rem' }}
                          onClick={() => handleFaucet(w.currency, w.currency === 'USDT' ? '1000' : '0.5')}
                        >
                          +Faucet
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Deposit Address Box */}
              {depositAddress && (
                <div style={{ padding: '12px', background: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: '8px' }}>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                    Alamat Deposit ({depositAddress.currency} - {depositAddress.network}):
                  </div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.9rem', color: 'var(--color-primary)', wordBreak: 'break-all', marginTop: '4px' }}>
                    {depositAddress.address}
                  </div>
                </div>
              )}

              {/* Withdrawal Box */}
              <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '12px' }}>
                <h4 style={{ fontSize: '0.9rem', marginBottom: '8px' }}>Request Withdrawal</h4>
                <form onSubmit={handleWithdrawSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <select
                      className="cex-input"
                      style={{ width: '100px' }}
                      value={withdrawCurrency}
                      onChange={(e) => setWithdrawCurrency(e.target.value)}
                    >
                      <option value="USDT">USDT</option>
                      <option value="BTC">BTC</option>
                      <option value="ETH">ETH</option>
                    </select>
                    <input
                      type="text"
                      placeholder="Destination Address (0x...)"
                      className="cex-input"
                      value={withdrawAddress}
                      onChange={(e) => setWithdrawAddress(e.target.value)}
                      required
                    />
                    <input
                      type="number"
                      step="any"
                      placeholder="Amount"
                      className="cex-input"
                      style={{ width: '120px' }}
                      value={withdrawAmount}
                      onChange={(e) => setWithdrawAmount(e.target.value)}
                      required
                    />
                  </div>
                  {withdrawStatus && <div style={{ fontSize: '0.8rem', color: 'var(--color-primary)' }}>{withdrawStatus}</div>}
                  <button type="submit" className="btn-primary" style={{ alignSelf: 'flex-end' }}>
                    Submit Withdrawal
                  </button>
                </form>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 4. Modal Login / Register */}
      {showAuthModal && (
        <div className="modal-overlay" onClick={() => setShowAuthModal(false)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span>{authMode === 'login' ? 'Login Trader' : 'Register Account'}</span>
              <button className="close-btn" onClick={() => setShowAuthModal(false)}>✕</button>
            </div>
            <form className="modal-body" onSubmit={handleAuthSubmit}>
              <div className="tabs-switch">
                <button
                  type="button"
                  className={`tab-btn ${authMode === 'login' ? 'active' : ''}`}
                  onClick={() => setAuthMode('login')}
                >
                  Login
                </button>
                <button
                  type="button"
                  className={`tab-btn ${authMode === 'register' ? 'active' : ''}`}
                  onClick={() => setAuthMode('register')}
                >
                  Register
                </button>
              </div>

              {authMode === 'register' && (
                <div className="form-field">
                  <label className="field-label">Full Name</label>
                  <input
                    type="text"
                    className="cex-input"
                    value={authName}
                    onChange={(e) => setAuthName(e.target.value)}
                    required
                  />
                </div>
              )}

              <div className="form-field">
                <label className="field-label">Email Address</label>
                <input
                  type="email"
                  className="cex-input"
                  value={authEmail}
                  onChange={(e) => setAuthEmail(e.target.value)}
                  required
                />
              </div>

              <div className="form-field">
                <label className="field-label">Password</label>
                <input
                  type="password"
                  className="cex-input"
                  value={authPassword}
                  onChange={(e) => setAuthPassword(e.target.value)}
                  required
                />
              </div>

              {authError && (
                <div style={{ color: 'var(--color-sell)', fontSize: '0.8rem' }}>{authError}</div>
              )}

              <button type="submit" className="btn-primary" style={{ width: '100%', padding: '12px' }}>
                {authMode === 'login' ? 'Sign In' : 'Create Account'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
