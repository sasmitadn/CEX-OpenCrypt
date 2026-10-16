import React, { useState, useEffect, useRef } from 'react';
import { authApi, marketApi, walletApi, orderApi, setAuthToken, getAuthToken } from './api';
import FullscreenAssets from './components/FullscreenAssets';
import AdminDashboard from './components/AdminDashboard';
import OnboardingHero from './components/OnboardingHero';
import SearchableMarketSelector from './components/SearchableMarketSelector';
import CandlestickChart from './components/CandlestickChart';

export default function App() {
  // Navigation View: 'TRADE' | 'ASSETS' | 'ADMIN'
  const [viewMode, setViewMode] = useState('TRADE');

  const [user, setUser] = useState(null);
  const [markets, setMarkets] = useState([]);
  const [selectedMarket, setSelectedMarket] = useState('BTC_USDT');
  const [depth, setDepth] = useState({ bids: [], asks: [] });
  
  // Progress bar ONLY for initial market change/load
  const [isInitialMarketLoad, setIsInitialMarketLoad] = useState(false);
  const isFirstLoadRef = useRef(true);

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
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authName, setAuthName] = useState('');
  const [authError, setAuthError] = useState('');

  // 1. Initial Load & Route Sync
  useEffect(() => {
    checkAuth();
    loadMarkets();

    const path = window.location.pathname.toLowerCase();
    const hash = window.location.hash.toLowerCase();
    if (hash === '#admin' || path.includes('admin')) {
      setViewMode('ADMIN');
    } else if (hash === '#assets') {
      setViewMode('ASSETS');
    }

    const handleHashChange = () => {
      const currentHash = window.location.hash.toLowerCase();
      if (currentHash === '#admin') setViewMode('ADMIN');
      else if (currentHash === '#assets') setViewMode('ASSETS');
      else if (currentHash === '#trade' || !currentHash) setViewMode('TRADE');
    };

    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  // When currency / pair changes: trigger initial progressbar
  useEffect(() => {
    setIsInitialMarketLoad(true);
    loadDepth(selectedMarket, true);
    loadRecentTrades(selectedMarket);

    // Background polling interval: does NOT trigger progress bar
    const interval = setInterval(() => {
      loadDepth(selectedMarket, false);
      loadRecentTrades(selectedMarket);
    }, 2500);

    return () => clearInterval(interval);
  }, [selectedMarket]);

  useEffect(() => {
    if (user) {
      if (user.role === 'ADMIN') {
        setViewMode('ADMIN');
        window.location.hash = '#admin';
      } else {
        loadWallets();
        loadUserOrders();
      }
    }
  }, [user, selectedMarket]);

  async function checkAuth() {
    if (!getAuthToken()) return;
    try {
      const res = await authApi.me();
      if (res.success) {
        setUser(res.data);
      }
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

  async function loadDepth(symbol, isInitial = false) {
    try {
      const res = await marketApi.getDepth(symbol);
      if (res.success) {
        setDepth(res.data);
        if (res.data.bids.length > 0 && orderType === 'LIMIT' && isFirstLoadRef.current) {
          setPrice(res.data.bids[0][0]);
          isFirstLoadRef.current = false;
        }
      }
    } catch (err) {
      // offline / mock depth
    } finally {
      if (isInitial) {
        setTimeout(() => setIsInitialMarketLoad(false), 450);
      }
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
        setAuthEmail('');
        setAuthPassword('');
        setAuthName('');
        loadWallets();
        
        // Auto-detect role: if user is admin and was on #admin, stay or open admin
        if (res.data.user?.role === 'ADMIN' && window.location.hash === '#admin') {
          setViewMode('ADMIN');
        }
      }
    } catch (err) {
      setAuthError(err.message || 'Authentication failed. Please check credentials.');
    }
  }

  function handleLogout() {
    authApi.logout().catch(() => {});
    setAuthToken(null);
    setUser(null);
    setWallets([]);
    setOrders([]);
    if (viewMode === 'ADMIN') {
      setViewMode('TRADE');
      window.location.hash = '#trade';
    }
  }

  // Switch View Mode with Hash Sync
  function switchView(mode) {
    if (user?.role === 'ADMIN') {
      setViewMode('ADMIN');
      window.location.hash = '#admin';
      return;
    }
    setViewMode(mode);
    if (mode === 'ADMIN') window.location.hash = '#admin';
    else if (mode === 'ASSETS') window.location.hash = '#assets';
    else window.location.hash = '#trade';
  }

  // Handle Order Placement
  async function handleOrderSubmit(e) {
    e.preventDefault();
    if (!user) {
      setAuthMode('login');
      setShowAuthModal(true);
      return;
    }
    if (user?.role === 'ADMIN') {
      setFormError('Administrator accounts are restricted from trading. Please use a trader account.');
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
        setFormSuccess(`Order ${orderSide} (${orderType}) executed successfully!`);
        loadWallets();
        loadUserOrders();
        loadDepth(selectedMarket, false);
      }
    } catch (err) {
      setFormError(err.message || 'Failed to place order.');
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
      alert('Failed to cancel order: ' + err.message);
    }
  }

  // Current Market Details & Fee Calculation
  const [baseCoin, quoteCoin] = selectedMarket.split('_');
  const baseWallet = wallets.find((w) => w.currency === baseCoin) || { balance: '0', locked: '0' };
  const quoteWallet = wallets.find((w) => w.currency === quoteCoin) || { balance: '0', locked: '0' };

  const currentMarket = markets.find((m) => m.symbol === selectedMarket) || {};
  const makerFeeRate = parseFloat(currentMarket.maker_fee_rate || '0.0015'); // 0.15%
  const takerFeeRate = parseFloat(currentMarket.taker_fee_rate || '0.0025'); // 0.25%

  const highestBid = depth.bids.length > 0 ? Number(depth.bids[0][0]) : null;
  const lowestAsk = depth.asks.length > 0 ? Number(depth.asks[0][0]) : null;
  const midPrice = highestBid && lowestAsk ? (highestBid + lowestAsk) / 2 : (highestBid || lowestAsk || 65000);

  // Auto calculate order notional & fees
  const orderPriceNumeric = orderType === 'LIMIT' ? (parseFloat(price) || 0) : midPrice;
  const orderQtyNumeric = parseFloat(quantity) || 0;
  const rawNotional = orderPriceNumeric * orderQtyNumeric;

  // If LIMIT -> Maker fee, If MARKET -> Taker fee
  const activeFeeRate = orderType === 'LIMIT' ? makerFeeRate : takerFeeRate;
  const feeTypeLabel = orderType === 'LIMIT' ? 'Maker' : 'Taker';
  const estimatedFeeAmount = rawNotional * activeFeeRate;
  
  // Total calculated with fee
  const totalWithFee = orderSide === 'BUY'
    ? (rawNotional + estimatedFeeAmount)
    : Math.max(0, rawNotional - estimatedFeeAmount);

  // Hitung volume maksimum untuk visual depth bar (hijau/merah)
  const maxAskVolume = Math.max(
    ...depth.asks.slice(0, 15).map(([_, v]) => Number(v) || 0),
    0.001
  );
  const maxBidVolume = Math.max(
    ...depth.bids.slice(0, 15).map(([_, v]) => Number(v) || 0),
    0.001
  );

  const userOpenPrices = new Set(
    orders
      .filter((o) => o.status === 'OPEN' || o.status === 'PENDING' || o.status === 'PARTIALLY_FILLED')
      .map((o) => Number(o.price).toFixed(2))
  );

  const spread = (highestBid && lowestAsk && lowestAsk >= highestBid) ? (lowestAsk - highestBid) : 0;
  const spreadPct = highestBid && lowestAsk && lowestAsk > 0 ? ((spread / lowestAsk) * 100).toFixed(2) : '0.00';

  return (
    <div className="cex-app-wrapper">
      {/* 1. Consistent Top Navigation Bar across all views */}
      <header className="cex-header">
        <div className="header-left">
          <div className="cex-logo" onClick={() => switchView('TRADE')} style={{ cursor: 'pointer' }}>
            <span className="logo-icon">⚡</span>
            <span className="logo-text">CEX OPENCRYPT</span>
            <span className="logo-badge">PRO</span>
          </div>

          {/* Searchable Market Dropdown Selector (Only for Traders / Non-Admin) */}
          {(!user || user.role !== 'ADMIN') && (
            <SearchableMarketSelector
              markets={markets}
              selectedMarket={selectedMarket}
              onSelectMarket={(sym) => setSelectedMarket(sym)}
            />
          )}

          {/* Primary View Navigation */}
          <nav className="header-nav-links">
            {(!user || user.role !== 'ADMIN') ? (
              <>
                <button
                  className={`nav-link ${viewMode === 'TRADE' ? 'active' : ''}`}
                  onClick={() => switchView('TRADE')}
                >
                  Spot Trade
                </button>
                <button
                  className={`nav-link ${viewMode === 'ASSETS' ? 'active' : ''}`}
                  onClick={() => {
                    if (!user) {
                      setAuthMode('login');
                      setShowAuthModal(true);
                    } else {
                      switchView('ASSETS');
                    }
                  }}
                >
                  Assets & Portfolio
                </button>
              </>
            ) : (
              <div className="admin-portal-header-pill">
                <span className="admin-portal-shield">🛡️</span>
                <span className="admin-portal-text">Exchange Administration Portal</span>
              </div>
            )}
          </nav>
        </div>

        <div className="header-right">
          {user ? (
            <div className="user-profile-bar">
              <div className="user-info-pill">
                <span className="user-email-text">{user.email}</span>
                <span className={`user-role-tag role-${(user.role || 'TRADER').toLowerCase()}`}>
                  {user.role || 'TRADER'}
                </span>
              </div>
              <button className="btn-logout" onClick={handleLogout}>
                Sign Out
              </button>
            </div>
          ) : (
            <div className="auth-actions-group">
              <button
                className="btn-signin-nav"
                onClick={() => {
                  setAuthMode('login');
                  setShowAuthModal(true);
                }}
              >
                Sign In
              </button>
              <button
                className="btn-register-nav"
                onClick={() => {
                  setAuthMode('register');
                  setShowAuthModal(true);
                }}
              >
                Register
              </button>
            </div>
          )}
        </div>
      </header>

      {/* 2. MAIN VIEW CONTROLLER */}

      {/* VIEW A: FULLSCREEN ASSETS & BALANCES */}
      {viewMode === 'ASSETS' && (
        <FullscreenAssets
          user={user}
          wallets={wallets}
          onRefreshWallets={loadWallets}
          onBackToTrade={() => switchView('TRADE')}
        />
      )}

      {/* VIEW B: ADMIN PORTAL (/admin) - Auto-detected for Admin */}
      {viewMode === 'ADMIN' && (
        <>
          {user && user.role === 'ADMIN' ? (
            <AdminDashboard
              user={user}
              onBackToTrade={() => switchView('TRADE')}
            />
          ) : (
            <div className="admin-gatekeeper-container">
              <div className="admin-gate-card">
                <div className="gate-icon">🛡️</div>
                <h2>Administrator Access Required</h2>
                <p>
                  This portal is restricted to authorized exchange administrators. Please sign in with an administrator account to continue.
                </p>
                <button
                  className="btn-primary-glow"
                  onClick={() => {
                    setAuthMode('login');
                    setShowAuthModal(true);
                  }}
                >
                  Sign In with Admin Account
                </button>
                <button className="btn-text-back" onClick={() => switchView('TRADE')}>
                  ← Return to Spot Trade
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* VIEW C: SPOT TRADING VIEW */}
      {viewMode === 'TRADE' && (
        <div className="trade-page-container">
          {/* Onboarding Presentation for Non-Logged In Users */}
          {!user && (
            <OnboardingHero
              onLoginClick={() => {
                setAuthMode('login');
                setShowAuthModal(true);
              }}
              onRegisterClick={() => {
                setAuthMode('register');
                setShowAuthModal(true);
              }}
            />
          )}

          <div className="main-layout">
            {/* Kolom 1: Order Book */}
            <div className="cex-panel orderbook-panel">
              <div className="panel-header">
                <div className="panel-title-group">
                  <span>Order Book</span>
                  <span className="market-symbol-sub">{selectedMarket}</span>
                </div>
                <div className="live-status-pill">
                  <span className="live-dot-pulse"></span>
                  <span>L2 DEPTH</span>
                </div>
              </div>

              {/* Progress Bar ONLY shows when first time changing currency / initial load */}
              <div className="orderbook-progress-track">
                <div className={`orderbook-progress-bar ${isInitialMarketLoad ? 'loading' : ''}`} />
              </div>

              <div className="orderbook-scroll-content">
                {/* Header Asks */}
                <div className="orderbook-sub-header ask-sub-header">
                  <span>🔴 SELL / ASKS</span>
                  <span className="sub-count">Top 12</span>
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
                          No sell orders in queue. Place a SELL order to provide liquidity.
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
                              background: `linear-gradient(to left, rgba(246, 70, 93, 0.22) ${pct}%, transparent ${pct}%)`,
                            }}
                            title={`Click to input price: $${numP.toFixed(2)} (Size: ${numV.toFixed(4)} ${baseCoin})`}
                          >
                            <td className="price-ask">
                              {numP.toFixed(2)}
                              {isUserOrder && <span className="user-order-dot">● You</span>}
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
                  <div className="mid-price-row">
                    <span className="mid-price-val">
                      ${highestBid ? highestBid.toFixed(2) : (lowestAsk ? lowestAsk.toFixed(2) : '65,000.00')}
                    </span>
                    <span className="trend-arrow">
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
                  <span className="sub-count">Top 12</span>
                </div>

                {/* Bids (Beli - Hijau) */}
                <table className="orderbook-table">
                  <tbody>
                    {depth.bids.length === 0 ? (
                      <tr>
                        <td colSpan="3" className="orderbook-empty">
                          No buy orders in queue. Place a BUY order to provide liquidity.
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
                              background: `linear-gradient(to left, rgba(14, 203, 129, 0.22) ${pct}%, transparent ${pct}%)`,
                            }}
                            title={`Click to input price: $${numP.toFixed(2)} (Size: ${numV.toFixed(4)} ${baseCoin})`}
                          >
                            <td className="price-bid">
                              {numP.toFixed(2)}
                              {isUserOrder && <span className="user-order-dot">● You</span>}
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
            <div className="middle-column-container">
              {/* Chart Header Card */}
              <div className="cex-panel chart-mockup-panel">
                <div className="chart-header-row">
                  <div>
                    <h2 className="chart-pair-title">
                      {selectedMarket.replace('_', ' / ')}
                    </h2>
                    <div className="chart-live-price">
                      ${
                        depth?.bids?.length > 0 && depth?.asks?.length > 0
                          ? (
                            (parseFloat(depth.bids[0][0]) + parseFloat(depth.asks[0][0])) / 2
                          ).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                          : (currentMarket.last_price || '65,000.00')
                      }
                    </div>
                  </div>
                  <div className="chart-metrics-24h">
                    <div>Maker Fee: <strong>{(makerFeeRate * 100).toFixed(2)}%</strong></div>
                    <div>Taker Fee: <strong>{(takerFeeRate * 100).toFixed(2)}%</strong></div>
                    <div>Engine: <strong>C++ Microsecond</strong></div>
                  </div>
                </div>

                {/* Interactive Multi-Timeframe Candlestick & Volume Chart */}
                <CandlestickChart
                  symbol={selectedMarket}
                  currentPrice={
                    depth?.bids?.length > 0 && depth?.asks?.length > 0
                      ? (parseFloat(depth.bids[0][0]) + parseFloat(depth.asks[0][0])) / 2
                      : currentMarket.last_price
                  }
                />

                <div className="chart-footer-stream">
                  <div className="matching-engine-badge">
                    ⚡ C++ In-Memory Engine | Sub-10µs Execution | Redis Stream
                  </div>
                  <div className="recent-trades-preview">
                    <span className="preview-label">Live Trades:</span>
                    {recentTrades.slice(0, 4).map((t, i) => (
                      <span key={i} className={`mini-trade ${t.side === 'BUY' ? 'text-buy' : 'text-sell'}`}>
                        ${parseFloat(t.price).toFixed(2)} ({parseFloat(t.quantity).toFixed(3)})
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              {/* User Orders & History */}
              <div className="cex-panel orders-history-panel">
                <div className="panel-header">
                  <div className="panel-title-group">
                    <span>Open Orders & Order History</span>
                    {user && <span className="user-id-sub">Account #{user.id}</span>}
                  </div>
                  {user && (
                    <button className="btn-xs-refresh" onClick={loadUserOrders}>
                      Refresh
                    </button>
                  )}
                </div>

                <div className="table-responsive-box">
                  <table className="orderbook-table orders-table">
                    <thead>
                      <tr>
                        <th>Time</th>
                        <th>Pair</th>
                        <th>Side</th>
                        <th>Type</th>
                        <th>Price</th>
                        <th>Quantity</th>
                        <th>Status</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {orders.length === 0 ? (
                        <tr>
                          <td colSpan="8" className="orders-empty-cell">
                            {user ? 'No active orders for this pair.' : 'Please sign in to view and manage your orders.'}
                          </td>
                        </tr>
                      ) : (
                        orders.map((ord) => (
                          <tr key={ord.uuid} className="orderbook-row">
                            <td className="text-dim">{new Date(ord.created_at).toLocaleTimeString()}</td>
                            <td><strong>{ord.symbol}</strong></td>
                            <td className={ord.side === 'BUY' ? 'price-bid font-bold' : 'price-ask font-bold'}>
                              {ord.side}
                            </td>
                            <td className="text-dim">{ord.type || 'LIMIT'}</td>
                            <td>{Number(ord.price).toFixed(2)}</td>
                            <td>{Number(ord.quantity).toFixed(4)}</td>
                            <td>
                              <span className={`status-pill status-${ord.status.toLowerCase()}`}>
                                {ord.status}
                              </span>
                            </td>
                            <td>
                              {['OPEN', 'PENDING', 'PARTIALLY_FILLED'].includes(ord.status) && (
                                <button
                                  className="btn-cancel-order"
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

            {/* Kolom 3: Order Form with Auto Fee Calculation */}
            <div className="cex-panel order-form-panel">
              <div className="panel-header">
                <span>Place Order</span>
                <span className="order-form-sub">Spot Trading</span>
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
                <div className="tabs-switch secondary-switch">
                  <button
                    type="button"
                    className={`tab-btn ${orderType === 'LIMIT' ? 'active' : ''}`}
                    onClick={() => setOrderType('LIMIT')}
                  >
                    Limit (Maker)
                  </button>
                  <button
                    type="button"
                    className={`tab-btn ${orderType === 'MARKET' ? 'active' : ''}`}
                    onClick={() => setOrderType('MARKET')}
                  >
                    Market (Taker)
                  </button>
                </div>

                {/* Available Balance display */}
                <div className="form-available-row">
                  <span>Available:</span>
                  <strong className="available-amount">
                    {orderSide === 'BUY'
                      ? `${Number(quoteWallet.balance || 0).toFixed(2)} ${quoteCoin}`
                      : `${Number(baseWallet.balance || 0).toFixed(4)} ${baseCoin}`}
                  </strong>
                </div>

                {/* Price Field */}
                {orderType === 'LIMIT' ? (
                  <div className="form-field">
                    <label className="field-label">Order Price ({quoteCoin})</label>
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
                ) : (
                  <div className="market-price-indicator">
                    <span className="field-label">Market Execution Price:</span>
                    <strong className="indicator-price">
                      Best Available Market Price (≈ ${midPrice.toFixed(2)})
                    </strong>
                  </div>
                )}

                {/* Quantity Field */}
                <div className="form-field">
                  <label className="field-label">Order Quantity ({baseCoin})</label>
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

                {/* Auto Calculated Fees & Total Breakdown */}
                <div className="order-fee-calculation-box">
                  <div className="calc-row">
                    <span>Order Notional:</span>
                    <strong className="calc-val">${rawNotional.toFixed(2)} {quoteCoin}</strong>
                  </div>
                  <div className="calc-row fee-highlight-row">
                    <span className="fee-type-badge">
                      Est. {feeTypeLabel} Fee ({(activeFeeRate * 100).toFixed(2)}%):
                    </span>
                    <span className="fee-amount">${estimatedFeeAmount.toFixed(4)} {quoteCoin}</span>
                  </div>
                  <div className="calc-row total-row">
                    <span>{orderSide === 'BUY' ? 'Estimated Total Required:' : 'Estimated Net Proceeds:'}</span>
                    <strong className="total-val-highlight">
                      ${totalWithFee.toFixed(2)} {quoteCoin}
                    </strong>
                  </div>
                </div>

                {formError && (
                  <div className="form-alert alert-error">
                    {formError}
                  </div>
                )}
                {formSuccess && (
                  <div className="form-alert alert-success">
                    {formSuccess}
                  </div>
                )}

                {user?.role === 'ADMIN' && (
                  <div className="admin-trade-restricted-banner">
                    🛡️ Administrator accounts are restricted from spot trading by compliance policy.
                  </div>
                )}

                <button
                  type="submit"
                  className={`action-btn ${orderSide.toLowerCase()}`}
                  disabled={isSubmitting || user?.role === 'ADMIN'}
                >
                  {user?.role === 'ADMIN'
                    ? 'Trading Disabled (Admin Account)'
                    : isSubmitting
                    ? 'Executing Order...'
                    : user
                    ? `${orderSide} ${baseCoin}`
                    : `Sign In to ${orderSide}`}
                </button>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* 3. PRODUCTION AUTHENTICATION MODAL (ZERO DEMO BUTTONS) */}
      {showAuthModal && (
        <div className="modal-overlay" onClick={() => setShowAuthModal(false)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span>{authMode === 'login' ? 'Sign In to Your Account' : 'Create Exchange Account'}</span>
              <button className="close-btn" onClick={() => setShowAuthModal(false)}>✕</button>
            </div>
            <form className="modal-body" onSubmit={handleAuthSubmit}>
              <div className="tabs-switch">
                <button
                  type="button"
                  className={`tab-btn ${authMode === 'login' ? 'active' : ''}`}
                  onClick={() => setAuthMode('login')}
                >
                  Sign In
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
                    className="cex-input modal-input"
                    placeholder="Enter your legal full name"
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
                  className="cex-input modal-input"
                  placeholder="name@example.com"
                  value={authEmail}
                  onChange={(e) => setAuthEmail(e.target.value)}
                  required
                />
              </div>

              <div className="form-field">
                <label className="field-label">Password</label>
                <input
                  type="password"
                  className="cex-input modal-input"
                  placeholder="Enter your secure password"
                  value={authPassword}
                  onChange={(e) => setAuthPassword(e.target.value)}
                  required
                />
              </div>

              {authError && (
                <div className="form-alert alert-error">{authError}</div>
              )}

              <button type="submit" className="btn-primary" style={{ width: '100%', padding: '12px', marginTop: '6px' }}>
                {authMode === 'login' ? 'Sign In' : 'Create Account'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
