import React, { useState, useEffect } from 'react';
import { adminApi } from '../api';

const SUPPORTED_NETWORKS = [
  { id: 'ALL', name: 'All Networks', badge: '🌐 Global' },
  { id: 'BNB', name: 'BNB Smart Chain (BEP-20)', badge: 'BNB' },
  { id: 'ETH', name: 'Ethereum (ERC-20)', badge: 'ETH' },
  { id: 'ARB', name: 'Arbitrum One (L2)', badge: 'ARB' },
  { id: 'MATIC', name: 'Polygon PoS', badge: 'MATIC' },
  { id: 'AVAX', name: 'Avalanche C-Chain', badge: 'AVAX' },
  { id: 'BTC', name: 'Bitcoin Network', badge: 'BTC' },
];

function CopyButton({ text, label = 'Copy', copiedLabel = 'Copied!', className = '' }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = (e) => {
    e.stopPropagation();
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      type="button"
      className={`btn-inline-copy ${copied ? 'copied' : ''} ${className}`}
      onClick={handleCopy}
      title={`Copy "${text}"`}
    >
      <span className="copy-icon">{copied ? '✓' : '📋'}</span>
      <span>{copied ? copiedLabel : label}</span>
    </button>
  );
}

export default function AdminDashboard({ user, onBackToTrade }) {
  const [activeTab, setActiveTab] = useState('WITHDRAWALS'); // WITHDRAWALS, TAX_SETTINGS, TRANSACTIONS, USERS, CURRENCIES
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [notification, setNotification] = useState({ type: '', text: '' });

  // Data states
  const [withdrawals, setWithdrawals] = useState([]);
  const [withdrawFilter, setWithdrawFilter] = useState('ALL');
  const [pairs, setPairs] = useState([]);
  const [feeInputs, setFeeInputs] = useState({}); // { [pairId]: { makerPercent, takerPercent } }
  const [transactions, setTransactions] = useState({ trades: [], deposits: [], withdrawals: [] });
  const [usersList, setUsersList] = useState([]);
  const [currenciesList, setCurrenciesList] = useState([]);

  // Tax & Trading Pairs CRUD states
  const [showAddPairModal, setShowAddPairModal] = useState(false);
  const [editingPair, setEditingPair] = useState(null);
  const [isSubmittingPair, setIsSubmittingPair] = useState(false);
  const [pairSearch, setPairSearch] = useState('');
  const [pairQuoteFilter, setPairQuoteFilter] = useState('ALL');

  const [newPairForm, setNewPairForm] = useState({
    base_currency_id: '',
    quote_currency_id: '',
    maker_fee_percent: '0.100',
    taker_fee_percent: '0.200',
    min_order_quantity: '1.0',
    min_order_notional: '5.0',
    price_precision: 4,
    quantity_precision: 2,
    status: 'TRADING',
  });

  const [editPairForm, setEditPairForm] = useState({
    maker_fee_percent: '0.100',
    taker_fee_percent: '0.200',
    min_order_quantity: '1.0',
    min_order_notional: '5.0',
    price_precision: 4,
    quantity_precision: 2,
    status: 'TRADING',
  });

  // Currencies CRUD states
  const [networkFilter, setNetworkFilter] = useState('ALL');
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingCurrency, setEditingCurrency] = useState(null);
  const [isSubmittingCoin, setIsSubmittingCoin] = useState(false);

  const [newCoinForm, setNewCoinForm] = useState({
    network: 'BNB',
    code: '',
    name: '',
    contract_address: '',
    decimals: 18,
    min_deposit: '1.0',
    min_withdraw: '5.0',
    withdraw_fee: '1.0',
    is_deposit_enabled: true,
    is_withdraw_enabled: true,
    is_trading_enabled: true,
    status: 'ACTIVE',
  });

  const [editForm, setEditForm] = useState({
    name: '',
    contract_address: '',
    decimals: 18,
    min_deposit: '0',
    min_withdraw: '0',
    withdraw_fee: '0',
    is_deposit_enabled: true,
    is_withdraw_enabled: true,
    is_trading_enabled: true,
    status: 'ACTIVE',
  });

  useEffect(() => {
    loadOverview();
    loadTabContent(activeTab);
  }, [activeTab]);

  async function loadOverview() {
    try {
      const res = await adminApi.getOverview();
      if (res.success) setOverview(res.data);
    } catch (err) {
      console.error('Failed to load overview:', err);
    }
  }

  async function loadTabContent(tab) {
    setLoading(true);
    try {
      if (tab === 'WITHDRAWALS') {
        const res = await adminApi.getWithdrawals(withdrawFilter === 'ALL' ? null : withdrawFilter);
        if (res.success) setWithdrawals(res.data);
      } else if (tab === 'TAX_SETTINGS') {
        const res = await adminApi.getPairs();
        if (res.success) {
          setPairs(res.data);
          const initial = {};
          res.data.forEach((p) => {
            initial[p.id] = {
              makerPercent: (parseFloat(p.maker_fee_rate || 0) * 100).toFixed(3),
              takerPercent: (parseFloat(p.taker_fee_rate || 0) * 100).toFixed(3),
            };
          });
          setFeeInputs(initial);
        }
        if (currenciesList.length === 0) {
          const cRes = await adminApi.getCurrencies();
          if (cRes.success) setCurrenciesList(cRes.data);
        }
      } else if (tab === 'TRANSACTIONS') {
        const res = await adminApi.getTransactions(50);
        if (res.success) setTransactions(res.data);
      } else if (tab === 'USERS') {
        const res = await adminApi.getUsers();
        if (res.success) setUsersList(res.data);
      } else if (tab === 'CURRENCIES') {
        const res = await adminApi.getCurrencies();
        if (res.success) setCurrenciesList(res.data);
      }
    } catch (err) {
      showNotice('error', err.message || 'Failed to fetch tab data');
    } finally {
      setLoading(false);
    }
  }

  function showNotice(type, text) {
    setNotification({ type, text });
    setTimeout(() => setNotification({ type: '', text: '' }), 4000);
  }

  // Handle Approve Withdrawal
  async function handleApproveWithdrawal(uuid) {
    try {
      const res = await adminApi.approveWithdrawal(uuid);
      if (res.success) {
        showNotice('success', `Withdrawal approved & dispatched to blockchain queue! Tx: ${res.data.tx_hash || 'Dispatched'}`);
        loadTabContent('WITHDRAWALS');
        loadOverview();
      }
    } catch (err) {
      showNotice('error', err.message || 'Failed to approve withdrawal');
    }
  }

  // Handle Reject Withdrawal
  async function handleRejectWithdrawal(uuid) {
    const reason = prompt('Enter rejection reason (Funds will be refunded to user):', 'Compliance policy check failed');
    if (!reason) return;
    try {
      const res = await adminApi.rejectWithdrawal(uuid, reason);
      if (res.success) {
        showNotice('success', 'Withdrawal rejected and user balance refunded successfully.');
        loadTabContent('WITHDRAWALS');
        loadOverview();
      }
    } catch (err) {
      showNotice('error', err.message || 'Failed to reject withdrawal');
    }
  }

  // Handle Save Pair Fee
  async function handleSavePairFee(pairId) {
    const inputs = feeInputs[pairId];
    if (!inputs) return;
    const makerRate = (parseFloat(inputs.makerPercent) / 100).toFixed(6);
    const takerRate = (parseFloat(inputs.takerPercent) / 100).toFixed(6);

    try {
      const res = await adminApi.updatePairFees(pairId, makerRate, takerRate);
      if (res.success) {
        showNotice('success', `Trading fees for pair updated! Maker: ${inputs.makerPercent}%, Taker: ${inputs.takerPercent}%`);
        loadTabContent('TAX_SETTINGS');
      }
    } catch (err) {
      showNotice('error', err.message || 'Failed to update fee rates');
    }
  }

  // Handle Create Trading Pair Submit
  async function handleCreatePairSubmit(e) {
    e.preventDefault();
    if (!newPairForm.base_currency_id || !newPairForm.quote_currency_id) {
      showNotice('error', 'Please select both Base Currency and Quote / Pair Currency.');
      return;
    }
    if (newPairForm.base_currency_id === newPairForm.quote_currency_id) {
      showNotice('error', 'Base Currency and Quote Currency must be different.');
      return;
    }

    setIsSubmittingPair(true);
    try {
      const res = await adminApi.createPair({
        base_currency_id: parseInt(newPairForm.base_currency_id),
        quote_currency_id: parseInt(newPairForm.quote_currency_id),
        maker_fee_percent: parseFloat(newPairForm.maker_fee_percent),
        taker_fee_percent: parseFloat(newPairForm.taker_fee_percent),
        min_order_quantity: parseFloat(newPairForm.min_order_quantity || 1.0),
        min_order_notional: parseFloat(newPairForm.min_order_notional || 5.0),
        price_precision: parseInt(newPairForm.price_precision || 4),
        quantity_precision: parseInt(newPairForm.quantity_precision || 2),
        status: newPairForm.status || 'TRADING',
      });
      if (res.success) {
        showNotice('success', `Trading pair ${res.data?.symbol || ''} created successfully!`);
        setShowAddPairModal(false);
        setNewPairForm({
          base_currency_id: '',
          quote_currency_id: '',
          maker_fee_percent: '0.100',
          taker_fee_percent: '0.200',
          min_order_quantity: '1.0',
          min_order_notional: '5.0',
          price_precision: 4,
          quantity_precision: 2,
          status: 'TRADING',
        });
        loadTabContent('TAX_SETTINGS');
      }
    } catch (err) {
      showNotice('error', err.message || 'Failed to create trading pair');
    } finally {
      setIsSubmittingPair(false);
    }
  }

  // Handle Open Edit Pair Modal
  function handleOpenEditPair(p) {
    setEditingPair(p);
    setEditPairForm({
      maker_fee_percent: (parseFloat(p.maker_fee_rate || 0) * 100).toFixed(3),
      taker_fee_percent: (parseFloat(p.taker_fee_rate || 0) * 100).toFixed(3),
      min_order_quantity: p.min_order_quantity || '1.0',
      min_order_notional: p.min_order_notional || '5.0',
      price_precision: p.price_precision ?? 4,
      quantity_precision: p.quantity_precision ?? 2,
      status: p.status || 'TRADING',
    });
  }

  // Handle Update Pair Submit
  async function handleUpdatePairSubmit(e) {
    e.preventDefault();
    if (!editingPair) return;

    setIsSubmittingPair(true);
    try {
      const res = await adminApi.updatePair(editingPair.id, {
        maker_fee_percent: parseFloat(editPairForm.maker_fee_percent),
        taker_fee_percent: parseFloat(editPairForm.taker_fee_percent),
        min_order_quantity: parseFloat(editPairForm.min_order_quantity),
        min_order_notional: parseFloat(editPairForm.min_order_notional),
        price_precision: parseInt(editPairForm.price_precision),
        quantity_precision: parseInt(editPairForm.quantity_precision),
        status: editPairForm.status,
      });
      if (res.success) {
        showNotice('success', `Trading pair ${editingPair.symbol} configuration updated successfully!`);
        setEditingPair(null);
        loadTabContent('TAX_SETTINGS');
      }
    } catch (err) {
      showNotice('error', err.message || 'Failed to update trading pair');
    } finally {
      setIsSubmittingPair(false);
    }
  }

  // Handle Delete Pair
  async function handleDeletePair(p) {
    if (p.is_core) {
      showNotice('error', `Core pillar pair ${p.symbol} is protected and cannot be deleted.`);
      return;
    }
    const confirmed = window.confirm(
      `Are you sure you want to delete trading pair ${p.symbol}? All active orders in this pair will be removed.`
    );
    if (!confirmed) return;

    try {
      const res = await adminApi.deletePair(p.id);
      if (res.success) {
        showNotice('success', `Trading pair ${p.symbol} successfully deleted.`);
        loadTabContent('TAX_SETTINGS');
      }
    } catch (err) {
      showNotice('error', err.message || 'Failed to delete trading pair');
    }
  }

  // Handle Toggle User Status
  async function handleToggleUserStatus(userId, currentStatus) {
    const newStatus = currentStatus === 'ACTIVE' ? 'FROZEN' : 'ACTIVE';
    try {
      const res = await adminApi.updateUserStatus(userId, newStatus);
      if (res.success) {
        showNotice('success', `User status changed to ${newStatus}`);
        loadTabContent('USERS');
      }
    } catch (err) {
      showNotice('error', err.message || 'Failed to update user status');
    }
  }

  // Currency CRUD Handlers
  async function handleCreateCoinSubmit(e) {
    e.preventDefault();
    if (!newCoinForm.code || !newCoinForm.name) {
      showNotice('error', 'Token symbol and name are required.');
      return;
    }

    setIsSubmittingCoin(true);
    try {
      const res = await adminApi.createCurrency(newCoinForm);
      if (res.success) {
        showNotice('success', `Token ${newCoinForm.code} successfully deployed on ${newCoinForm.network} network!`);
        setShowAddModal(false);
        setNewCoinForm({
          network: 'BNB',
          code: '',
          name: '',
          contract_address: '',
          decimals: 18,
          min_deposit: '1.0',
          min_withdraw: '5.0',
          withdraw_fee: '1.0',
          is_deposit_enabled: true,
          is_withdraw_enabled: true,
          is_trading_enabled: true,
          status: 'ACTIVE',
        });
        loadTabContent('CURRENCIES');
      }
    } catch (err) {
      showNotice('error', err.message || 'Failed to add new coin');
    } finally {
      setIsSubmittingCoin(false);
    }
  }

  function openEditCurrencyModal(currency) {
    setEditingCurrency(currency);
    const contract = currency.networks?.[0]?.contract_address || '';
    setEditForm({
      name: currency.name,
      contract_address: contract,
      decimals: currency.decimals,
      min_deposit: currency.min_deposit,
      min_withdraw: currency.min_withdraw,
      withdraw_fee: currency.withdraw_fee,
      is_deposit_enabled: currency.is_deposit_enabled,
      is_withdraw_enabled: currency.is_withdraw_enabled,
      is_trading_enabled: currency.is_trading_enabled,
      status: currency.status,
    });
  }

  async function handleUpdateCoinSubmit(e) {
    e.preventDefault();
    if (!editingCurrency) return;

    setIsSubmittingCoin(true);
    try {
      const res = await adminApi.updateCurrency(editingCurrency.id, editForm);
      if (res.success) {
        showNotice('success', `Currency ${editingCurrency.code} updated successfully.`);
        setEditingCurrency(null);
        loadTabContent('CURRENCIES');
      }
    } catch (err) {
      showNotice('error', err.message || 'Failed to update currency');
    } finally {
      setIsSubmittingCoin(false);
    }
  }

  async function handleDeleteCoin(currency) {
    if (currency.is_pillar) {
      showNotice('error', `Pillar currency ${currency.code} cannot be deleted.`);
      return;
    }
    const confirmed = window.confirm(`Are you sure you want to completely remove token "${currency.code}" and its markets/wallets from CEX?`);
    if (!confirmed) return;

    try {
      const res = await adminApi.deleteCurrency(currency.id);
      if (res.success) {
        showNotice('success', `Token ${currency.code} deleted successfully.`);
        loadTabContent('CURRENCIES');
      }
    } catch (err) {
      showNotice('error', err.message || 'Failed to delete token');
    }
  }

  // Filter currencies by network
  const filteredCurrencies = currenciesList.filter((c) => {
    if (networkFilter === 'ALL') return true;
    const networks = c.networks || [];
    return networks.some((n) => n.network === networkFilter);
  });

  // Calculate count per network
  const getNetworkCoinCount = (netId) => {
    if (netId === 'ALL') return currenciesList.length;
    return currenciesList.filter((c) => (c.networks || []).some((n) => n.network === netId)).length;
  };

  // Tax & Trading Pair Filtering
  const availableQuotes = ['ALL', ...Array.from(new Set(pairs.map((p) => p.quote).filter(Boolean)))];
  const filteredPairs = pairs.filter((p) => {
    if (pairQuoteFilter !== 'ALL' && p.quote !== pairQuoteFilter) return false;
    if (pairSearch.trim()) {
      const q = pairSearch.toLowerCase();
      const matchSymbol = p.symbol?.toLowerCase().includes(q);
      const matchBase = p.base?.toLowerCase().includes(q);
      const matchQuote = p.quote?.toLowerCase().includes(q);
      const matchName = (p.base_name || '').toLowerCase().includes(q) || (p.quote_name || '').toLowerCase().includes(q);
      return matchSymbol || matchBase || matchQuote || matchName;
    }
    return true;
  });

  return (
    <div className="admin-portal-view">
      {/* Top Admin Nav */}
      <div className="admin-top-nav">
        <div className="admin-nav-left">
          {user?.role !== 'ADMIN' && (
            <button className="btn-back" onClick={onBackToTrade}>
              ← Back to Spot Trade
            </button>
          )}
          <div className="admin-title-badge-group">
            <h1 className="admin-title">CEX Administration & Settlement Control</h1>
            <span className="admin-role-badge">SUPER ADMIN PORTAL</span>
          </div>
        </div>

        <div className="admin-user-info">
          <span className="admin-email">{user?.email || 'admin@gmail.com'}</span>
          <span className="badge-online">LIVE MASTER NODE</span>
        </div>
      </div>

      {notification.text && (
        <div className={`toast-notification ${notification.type}`}>
          {notification.type === 'success' ? '✓' : '⚠️'} {notification.text}
        </div>
      )}

      {/* Metrics Bar */}
      {overview && (
        <div className="admin-overview-grid">
          <div className="admin-metric-card">
            <span className="metric-label">Registered Traders</span>
            <span className="metric-val">{overview.total_users}</span>
            <span className="metric-sub">KYC active accounts</span>
          </div>
          <div className="admin-metric-card highlight-metric">
            <span className="metric-label">Pending Withdrawals</span>
            <span className="metric-val text-warning">{overview.pending_withdrawals}</span>
            <span className="metric-sub">Action required</span>
          </div>
          <div className="admin-metric-card">
            <span className="metric-label">Completed Withdrawals</span>
            <span className="metric-val text-success">{overview.completed_withdrawals}</span>
            <span className="metric-sub">Settled on-chain</span>
          </div>
          <div className="admin-metric-card">
            <span className="metric-label">Total Trades Settled</span>
            <span className="metric-val">{overview.total_trades}</span>
            <span className="metric-sub">{overview.total_orders} total orders</span>
          </div>
          <div className="admin-metric-card">
            <span className="metric-label">Total Trading Volume</span>
            <span className="metric-val text-primary">
              ${parseFloat(overview.total_volume_usdt || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })}
            </span>
            <span className="metric-sub">USDT equivalent</span>
          </div>
        </div>
      )}

      {/* Admin Tabs */}
      <div className="admin-tabs-bar">
        <button
          className={`admin-tab-btn ${activeTab === 'WITHDRAWALS' ? 'active' : ''}`}
          onClick={() => setActiveTab('WITHDRAWALS')}
        >
          📤 Withdrawal Requests {overview?.pending_withdrawals ? `(${overview.pending_withdrawals})` : ''}
        </button>
        <button
          className={`admin-tab-btn ${activeTab === 'TAX_SETTINGS' ? 'active' : ''}`}
          onClick={() => setActiveTab('TAX_SETTINGS')}
        >
          ⚙️ Maker & Taker Tax / Fee Settings
        </button>
        <button
          className={`admin-tab-btn ${activeTab === 'TRANSACTIONS' ? 'active' : ''}`}
          onClick={() => setActiveTab('TRANSACTIONS')}
        >
          📜 All Transactions & Trades
        </button>
        <button
          className={`admin-tab-btn ${activeTab === 'USERS' ? 'active' : ''}`}
          onClick={() => setActiveTab('USERS')}
        >
          👥 User Directory & Details
        </button>
        <button
          className={`admin-tab-btn ${activeTab === 'CURRENCIES' ? 'active' : ''}`}
          onClick={() => setActiveTab('CURRENCIES')}
        >
          🌐 Supported Currencies & Networks ({currenciesList.length})
        </button>
      </div>

      {/* Content Area */}
      <div className="admin-content-card">
        {loading ? (
          <div className="admin-loading-box">
            <div className="spinner"></div>
            <p>Loading administration data...</p>
          </div>
        ) : (
          <>
            {/* 1. WITHDRAWALS TAB */}
            {activeTab === 'WITHDRAWALS' && (
              <div className="tab-pane-withdrawals">
                <div className="pane-filter-bar">
                  <div className="filter-group">
                    <span>Status Filter:</span>
                    {['ALL', 'PENDING_APPROVAL', 'COMPLETED', 'REJECTED'].map((st) => (
                      <button
                        key={st}
                        className={`filter-chip ${withdrawFilter === st ? 'active' : ''}`}
                        onClick={() => {
                          setWithdrawFilter(st);
                          adminApi.getWithdrawals(st === 'ALL' ? null : st).then((res) => {
                            if (res.success) setWithdrawals(res.data);
                          });
                        }}
                      >
                        {st}
                      </button>
                    ))}
                  </div>
                  <button
                    className="btn-refresh-admin"
                    onClick={() => loadTabContent('WITHDRAWALS')}
                  >
                    🔄 Refresh
                  </button>
                </div>

                <div className="table-responsive">
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th>ID</th>
                        <th>User</th>
                        <th>Coin / Net</th>
                        <th>Destination Address</th>
                        <th>Amount</th>
                        <th>Fee</th>
                        <th>Net</th>
                        <th>Status</th>
                        <th>Time</th>
                        <th style={{ textAlign: 'right' }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {withdrawals.length === 0 ? (
                        <tr>
                          <td colSpan="10" className="text-center empty-cell">
                            No withdrawal requests found for this filter.
                          </td>
                        </tr>
                      ) : (
                        withdrawals.map((w) => (
                          <tr key={w.uuid}>
                            <td>#{w.id}</td>
                            <td>
                              <div className="user-subcell">
                                <span className="font-bold">{w.user?.name || 'Trader'}</span>
                                <span className="text-dim text-xs">{w.user?.email}</span>
                              </div>
                            </td>
                            <td>
                              <span className="coin-tag">{w.currency?.code}</span>
                              <span className="net-tag">{w.network}</span>
                            </td>
                            <td>
                              <div className="addr-cell">
                                <span className="address-hash" title={w.to_address}>
                                  {w.to_address.slice(0, 10)}...{w.to_address.slice(-6)}
                                </span>
                                <CopyButton text={w.to_address} label="Copy" copiedLabel="Copied" className="btn-copy-tiny" />
                              </div>
                            </td>
                            <td className="font-bold">{parseFloat(w.amount).toFixed(4)}</td>
                            <td className="text-dim">{parseFloat(w.fee).toFixed(4)}</td>
                            <td className="text-success font-bold">{parseFloat(w.net_amount).toFixed(4)}</td>
                            <td>
                              <span className={`status-badge status-${(w.status || '').toLowerCase()}`}>
                                {w.status}
                              </span>
                            </td>
                            <td className="text-xs text-dim">
                              {w.created_at ? new Date(w.created_at).toLocaleString() : '—'}
                            </td>
                            <td style={{ textAlign: 'right' }}>
                              {w.status === 'PENDING_APPROVAL' ? (
                                <div className="btn-action-group">
                                  <button
                                    className="btn-approve"
                                    onClick={() => handleApproveWithdrawal(w.uuid)}
                                  >
                                    ✓ Approve
                                  </button>
                                  <button
                                    className="btn-reject"
                                    onClick={() => handleRejectWithdrawal(w.uuid)}
                                  >
                                    ✕ Reject
                                  </button>
                                </div>
                              ) : (
                                <span className="text-dim text-xs">Processed</span>
                              )}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* 2. TAX & FEE SETTINGS TAB */}
            {activeTab === 'TAX_SETTINGS' && (
              <div className="tab-pane-tax">
                <div className="tax-pane-header-box">
                  <div className="pane-header-text">
                    <h3 className="section-title">Trading Pair Tax & Percentage Configuration</h3>
                    <p className="section-desc">
                      Configure maker (order provider) & taker (order consumer) trading fee percentages, create dynamic trading pairs with custom base & quote currencies, and set order limits.
                    </p>
                  </div>
                  <button
                    type="button"
                    className="btn-add-pair-primary"
                    onClick={() => {
                      if (currenciesList.length === 0) {
                        adminApi.getCurrencies().then((r) => r.success && setCurrenciesList(r.data));
                      }
                      setShowAddPairModal(true);
                    }}
                  >
                    + Add New Trading Pair
                  </button>
                </div>

                {/* Search & Filter Bar */}
                <div className="pair-filter-bar">
                  <div className="pair-search-wrapper">
                    <span className="search-icon">🔍</span>
                    <input
                      type="text"
                      className="pair-search-input"
                      placeholder="Search pair symbol or currency (e.g. BTC, ETH, USDT)..."
                      value={pairSearch}
                      onChange={(e) => setPairSearch(e.target.value)}
                    />
                    {pairSearch && (
                      <button
                        type="button"
                        className="clear-search-btn"
                        onClick={() => setPairSearch('')}
                      >
                        ✕
                      </button>
                    )}
                  </div>

                  <div className="quote-filter-pills">
                    <span className="quote-filter-label">Quote Asset:</span>
                    {availableQuotes.map((q) => (
                      <button
                        key={q}
                        type="button"
                        className={`quote-pill-btn ${pairQuoteFilter === q ? 'active' : ''}`}
                        onClick={() => setPairQuoteFilter(q)}
                      >
                        {q}
                      </button>
                    ))}
                    <span className="pair-count-badge">
                      {filteredPairs.length} of {pairs.length} pairs
                    </span>
                  </div>
                </div>

                {/* Pairs Grid */}
                <div className="tax-grid">
                  {filteredPairs.length === 0 ? (
                    <div className="empty-pairs-box">
                      <p className="empty-text">No trading pairs matched your search or quote filter.</p>
                      <button
                        type="button"
                        className="btn-reset-filters"
                        onClick={() => {
                          setPairSearch('');
                          setPairQuoteFilter('ALL');
                        }}
                      >
                        Reset Filters
                      </button>
                    </div>
                  ) : (
                    filteredPairs.map((p) => {
                      const currentInputs = feeInputs[p.id] || {
                        makerPercent: (parseFloat(p.maker_fee_rate || 0) * 100).toFixed(3),
                        takerPercent: (parseFloat(p.taker_fee_rate || 0) * 100).toFixed(3),
                      };
                      return (
                        <div key={p.id} className="pair-tax-card">
                          <div className="pair-card-header">
                            <div className="pair-title-box">
                              <span className="pair-symbol-title">{p.symbol}</span>
                              <span className="pair-sub-names">{p.base_name || p.base} / {p.quote_name || p.quote}</span>
                            </div>
                            <div className="pair-badges-group">
                              {p.is_core ? (
                                <span className="pair-pillar-badge" title="Pillar market pair required by system">🛡️ Core</span>
                              ) : (
                                <span className="pair-custom-badge" title="Dynamic custom market pair">✨ Custom</span>
                              )}
                              <span className={`pair-status-badge ${p.status.toLowerCase()}`}>{p.status}</span>
                            </div>
                          </div>

                          <div className="tax-inputs-row">
                            <div className="fee-input-field">
                              <label className="fee-field-label">Maker Tax / Fee (%)</label>
                              <div className="input-with-addon">
                                <input
                                  type="number"
                                  step="0.001"
                                  min="0"
                                  max="10"
                                  className="input-fee"
                                  value={currentInputs.makerPercent}
                                  onChange={(e) =>
                                    setFeeInputs({
                                      ...feeInputs,
                                      [p.id]: { ...currentInputs, makerPercent: e.target.value },
                                    })
                                  }
                                />
                                <span className="input-addon">%</span>
                              </div>
                            </div>

                            <div className="fee-input-field">
                              <label className="fee-field-label">Taker Tax / Fee (%)</label>
                              <div className="input-with-addon">
                                <input
                                  type="number"
                                  step="0.001"
                                  min="0"
                                  max="10"
                                  className="input-fee"
                                  value={currentInputs.takerPercent}
                                  onChange={(e) =>
                                    setFeeInputs({
                                      ...feeInputs,
                                      [p.id]: { ...currentInputs, takerPercent: e.target.value },
                                    })
                                  }
                                />
                                <span className="input-addon">%</span>
                              </div>
                            </div>
                          </div>

                          <div className="card-meta">
                            <div className="meta-line">
                              <span className="meta-lbl">Min Order:</span>
                              <span className="meta-val">{p.min_order_quantity} {p.base}</span>
                            </div>
                            <div className="meta-line">
                              <span className="meta-lbl">Min Notional:</span>
                              <span className="meta-val">${p.min_order_notional} {p.quote}</span>
                            </div>
                            <div className="meta-line">
                              <span className="meta-lbl">Precision:</span>
                              <span className="meta-val">P:{p.price_precision} | Q:{p.quantity_precision}</span>
                            </div>
                          </div>

                          <div className="pair-card-actions">
                            <button
                              type="button"
                              className="btn-save-fee"
                              onClick={() => handleSavePairFee(p.id)}
                            >
                              Save Fee Settings
                            </button>
                            <div className="pair-btn-row">
                              <button
                                type="button"
                                className="btn-edit-pair"
                                onClick={() => handleOpenEditPair(p)}
                                title="Edit Trading Limits & Precisions"
                              >
                                ✏️ Edit Limits
                              </button>
                              {!p.is_core ? (
                                <button
                                  type="button"
                                  className="btn-delete-pair"
                                  onClick={() => handleDeletePair(p)}
                                  title="Delete Trading Pair"
                                >
                                  🗑️ Delete
                                </button>
                              ) : (
                                <span className="core-lock-hint" title="Core market pairs are protected">🔒 Protected</span>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            )}

            {/* 3. ALL TRANSACTIONS TAB */}
            {activeTab === 'TRANSACTIONS' && (
              <div className="tab-pane-transactions">
                <div className="pane-header-box">
                  <h3 className="section-title">Global Transaction Audit Trail</h3>
                  <p className="section-desc">Real-time ledger entries, matching engine trade executions, and blockchain deposit events.</p>
                </div>

                <div className="transactions-tables-wrapper">
                  <h4 className="sub-table-title">Recent Matched Trades</h4>
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th>Trade ID</th>
                        <th>Pair</th>
                        <th>Execution Price</th>
                        <th>Quantity</th>
                        <th>Quote Notional</th>
                        <th>Maker Tax</th>
                        <th>Taker Tax</th>
                        <th>Time</th>
                      </tr>
                    </thead>
                    <tbody>
                      {transactions.trades?.length === 0 ? (
                        <tr><td colSpan="8" className="text-center empty-cell">No trades executed yet.</td></tr>
                      ) : (
                        transactions.trades?.map((t) => (
                          <tr key={t.uuid || t.id}>
                            <td>#{t.id}</td>
                            <td className="font-bold">{t.pair}</td>
                            <td>${parseFloat(t.price).toFixed(2)}</td>
                            <td>{parseFloat(t.quantity).toFixed(4)}</td>
                            <td className="font-bold text-success">${parseFloat(t.total).toFixed(2)}</td>
                            <td className="text-dim">${parseFloat(t.maker_fee).toFixed(4)}</td>
                            <td className="text-dim">${parseFloat(t.taker_fee).toFixed(4)}</td>
                            <td className="text-xs text-dim">{new Date(t.time).toLocaleString()}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* 4. USERS DIRECTORY TAB */}
            {activeTab === 'USERS' && (
              <div className="tab-pane-users">
                <div className="table-responsive">
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th>User ID</th>
                        <th>Name</th>
                        <th>Email</th>
                        <th>Role</th>
                        <th>KYC Level</th>
                        <th>Wallets Initialized</th>
                        <th>Account Status</th>
                        <th>Registered Date</th>
                        <th style={{ textAlign: 'right' }}>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {usersList.map((u) => (
                        <tr key={u.id}>
                          <td>#{u.id}</td>
                          <td className="font-bold">{u.name}</td>
                          <td>{u.email}</td>
                          <td>
                            <span className={`role-badge ${u.role === 'ADMIN' ? 'role-admin' : 'role-trader'}`}>
                              {u.role || 'TRADER'}
                            </span>
                          </td>
                          <td>Level {u.kyc_level}</td>
                          <td>{u.wallets_count} Wallets</td>
                          <td>
                            <span className={`status-badge ${u.status === 'ACTIVE' ? 'status-completed' : 'status-rejected'}`}>
                              {u.status}
                            </span>
                          </td>
                          <td>{new Date(u.created_at).toLocaleDateString()}</td>
                          <td style={{ textAlign: 'right' }}>
                            {u.role !== 'ADMIN' && (
                              <button
                                className={`btn-sm ${u.status === 'ACTIVE' ? 'btn-danger' : 'btn-approve'}`}
                                onClick={() => handleToggleUserStatus(u.id, u.status)}
                              >
                                {u.status === 'ACTIVE' ? 'Freeze Account' : 'Activate Account'}
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* 5. CURRENCIES & NETWORKS CRUD TAB */}
            {activeTab === 'CURRENCIES' && (
              <div className="tab-pane-currencies">
                {/* Header with Add Button */}
                <div className="currencies-header-bar">
                  <div className="pane-header-box">
                    <h3 className="section-title">Supported Currencies & Dynamic Multi-Chain Matrix</h3>
                    <p className="section-desc">
                      Categorized network overview. Pillar core assets are system-protected, while custom ERC-20/BEP-20 tokens and meme coins can be added dynamically with contract addresses.
                    </p>
                  </div>
                  <button
                    className="btn-add-coin-primary"
                    onClick={() => setShowAddModal(true)}
                  >
                    + Add New Token / Meme Coin
                  </button>
                </div>

                {/* Categorization by Network */}
                <div className="network-category-pills">
                  {SUPPORTED_NETWORKS.map((net) => {
                    const count = getNetworkCoinCount(net.id);
                    return (
                      <button
                        key={net.id}
                        type="button"
                        className={`net-cat-pill ${networkFilter === net.id ? 'active' : ''}`}
                        onClick={() => setNetworkFilter(net.id)}
                      >
                        <span className="net-pill-name">{net.name}</span>
                        <span className="net-pill-count">{count}</span>
                      </button>
                    );
                  })}
                </div>

                {/* Matrix Grid of Coins */}
                <div className="currencies-matrix-grid">
                  {filteredCurrencies.map((c) => {
                    const networks = c.networks || [];
                    const primaryNet = networks[0] || {};
                    const isPillar = c.is_pillar;

                    return (
                      <div key={c.id} className={`currency-matrix-card ${isPillar ? 'pillar-card' : 'custom-coin-card'}`}>
                        <div className="card-top">
                          <div className="coin-id-box">
                            <span className="coin-code-lg">{c.code}</span>
                            <span className="coin-name-sub">{c.name}</span>
                          </div>
                          <div className="badge-group-top">
                            {isPillar ? (
                              <span className="pillar-badge" title="Core native exchange asset - Protected against deletion">
                                🛡️ Pillar Asset
                              </span>
                            ) : (
                              <span className="custom-token-badge">
                                ✨ Custom Token
                              </span>
                            )}
                            <span className={`coin-status-badge ${c.status.toLowerCase()}`}>
                              {c.status}
                            </span>
                          </div>
                        </div>

                        {/* Specs */}
                        <div className="matrix-specs">
                          <div className="spec-item">
                            <span className="spec-lbl">Decimals:</span>
                            <span className="spec-val">{c.decimals}</span>
                          </div>
                          <div className="spec-item">
                            <span className="spec-lbl">Min Deposit:</span>
                            <span className="spec-val">{parseFloat(c.min_deposit)} {c.code}</span>
                          </div>
                          <div className="spec-item">
                            <span className="spec-lbl">Min Withdraw:</span>
                            <span className="spec-val">{parseFloat(c.min_withdraw)} {c.code}</span>
                          </div>
                          <div className="spec-item">
                            <span className="spec-lbl">Withdraw Fee:</span>
                            <span className="spec-val">{parseFloat(c.withdraw_fee)} {c.code}</span>
                          </div>
                          <div className="spec-item">
                            <span className="spec-lbl">Deposits:</span>
                            <span className={`spec-val ${c.is_deposit_enabled ? 'text-success' : 'text-danger'}`}>
                              {c.is_deposit_enabled ? '✓ Enabled' : '✕ Disabled'}
                            </span>
                          </div>
                          <div className="spec-item">
                            <span className="spec-lbl">Trading:</span>
                            <span className={`spec-val ${c.is_trading_enabled ? 'text-success' : 'text-danger'}`}>
                              {c.is_trading_enabled ? '✓ Enabled' : '✕ Disabled'}
                            </span>
                          </div>
                        </div>

                        {/* Connected Networks & Contract Address */}
                        <div className="card-networks-list">
                          <span className="net-header-label">Network Deployments & Contracts:</span>
                          <div className="networks-chips-row">
                            {networks.map((n) => (
                              <div key={n.network} className="network-full-chip">
                                <div className="net-info-left">
                                  <span className="net-symbol">{n.network}</span>
                                  <span className="net-fullname">{n.name}</span>
                                </div>
                                {n.contract_address ? (
                                  <div className="contract-box">
                                    <span className="contract-addr" title={n.contract_address}>
                                      {n.contract_address.slice(0, 8)}...{n.contract_address.slice(-6)}
                                    </span>
                                    <CopyButton text={n.contract_address} label="Copy" copiedLabel="Copied" className="btn-copy-tiny" />
                                  </div>
                                ) : (
                                  <span className="native-coin-label">Native Blockchain Asset</span>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* Action buttons */}
                        <div className="currency-card-actions">
                          <button
                            type="button"
                            className="btn-edit-coin"
                            onClick={() => openEditCurrencyModal(c)}
                          >
                            ✏️ Edit Parameters
                          </button>
                          {!isPillar ? (
                            <button
                              type="button"
                              className="btn-delete-coin"
                              onClick={() => handleDeleteCoin(c)}
                            >
                              🗑️ Delete
                            </button>
                          ) : (
                            <span className="pillar-protected-note" title="Core native network asset">
                              🔒 Protected
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* MODAL 1: ADD NEW TOKEN / COIN */}
      {showAddModal && (
        <div className="modal-overlay" onClick={() => setShowAddModal(false)}>
          <div className="modal-card modal-lg" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title-box">
                <h3 className="modal-title">Deploy New Token / Meme Coin</h3>
                <p className="modal-subtitle">Add custom ERC-20, BEP-20, or multi-chain tokens dynamically into exchange ledger</p>
              </div>
              <button className="btn-close-modal" onClick={() => setShowAddModal(false)}>✕</button>
            </div>

            <form onSubmit={handleCreateCoinSubmit} className="modal-form">
              <div className="form-grid-2">
                <div className="form-field">
                  <label className="field-label">Target Blockchain Network *</label>
                  <select
                    className="modal-select"
                    value={newCoinForm.network}
                    onChange={(e) => setNewCoinForm({ ...newCoinForm, network: e.target.value })}
                    required
                  >
                    <option value="BNB">BNB Smart Chain (BEP-20)</option>
                    <option value="ETH">Ethereum (ERC-20 / Sepolia)</option>
                    <option value="ARB">Arbitrum One (L2)</option>
                    <option value="MATIC">Polygon PoS</option>
                    <option value="AVAX">Avalanche C-Chain</option>
                    <option value="BTC">Bitcoin Network</option>
                  </select>
                </div>

                <div className="form-field">
                  <label className="field-label">Token Code / Ticker (Uppercase) *</label>
                  <input
                    type="text"
                    className="modal-input"
                    placeholder="e.g. PEPE, SHIB, FLOKI"
                    value={newCoinForm.code}
                    onChange={(e) => setNewCoinForm({ ...newCoinForm, code: e.target.value.toUpperCase() })}
                    maxLength={20}
                    required
                  />
                </div>
              </div>

              <div className="form-grid-2">
                <div className="form-field">
                  <label className="field-label">Token Full Name *</label>
                  <input
                    type="text"
                    className="modal-input"
                    placeholder="e.g. Pepe Meme Token"
                    value={newCoinForm.name}
                    onChange={(e) => setNewCoinForm({ ...newCoinForm, name: e.target.value })}
                    required
                  />
                </div>

                <div className="form-field">
                  <label className="field-label">Smart Contract Address (0x...)</label>
                  <input
                    type="text"
                    className="modal-input"
                    placeholder="0x... (Leave blank for native coin)"
                    value={newCoinForm.contract_address}
                    onChange={(e) => setNewCoinForm({ ...newCoinForm, contract_address: e.target.value })}
                  />
                </div>
              </div>

              <div className="form-grid-4">
                <div className="form-field">
                  <label className="field-label">Decimals</label>
                  <input
                    type="number"
                    min="0"
                    max="36"
                    className="modal-input"
                    value={newCoinForm.decimals}
                    onChange={(e) => setNewCoinForm({ ...newCoinForm, decimals: parseInt(e.target.value) || 18 })}
                    required
                  />
                </div>

                <div className="form-field">
                  <label className="field-label">Min Deposit</label>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    className="modal-input"
                    value={newCoinForm.min_deposit}
                    onChange={(e) => setNewCoinForm({ ...newCoinForm, min_deposit: e.target.value })}
                    required
                  />
                </div>

                <div className="form-field">
                  <label className="field-label">Min Withdrawal</label>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    className="modal-input"
                    value={newCoinForm.min_withdraw}
                    onChange={(e) => setNewCoinForm({ ...newCoinForm, min_withdraw: e.target.value })}
                    required
                  />
                </div>

                <div className="form-field">
                  <label className="field-label">Withdraw Fee</label>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    className="modal-input"
                    value={newCoinForm.withdraw_fee}
                    onChange={(e) => setNewCoinForm({ ...newCoinForm, withdraw_fee: e.target.value })}
                    required
                  />
                </div>
              </div>

              {/* Toggles */}
              <div className="form-toggles-row">
                <label className="toggle-checkbox-label">
                  <input
                    type="checkbox"
                    checked={newCoinForm.is_deposit_enabled}
                    onChange={(e) => setNewCoinForm({ ...newCoinForm, is_deposit_enabled: e.target.checked })}
                  />
                  <span>Enable On-Chain Deposits</span>
                </label>
                <label className="toggle-checkbox-label">
                  <input
                    type="checkbox"
                    checked={newCoinForm.is_withdraw_enabled}
                    onChange={(e) => setNewCoinForm({ ...newCoinForm, is_withdraw_enabled: e.target.checked })}
                  />
                  <span>Enable On-Chain Withdrawals</span>
                </label>
                <label className="toggle-checkbox-label">
                  <input
                    type="checkbox"
                    checked={newCoinForm.is_trading_enabled}
                    onChange={(e) => setNewCoinForm({ ...newCoinForm, is_trading_enabled: e.target.checked })}
                  />
                  <span>Auto-Create USDT Spot Trading Market</span>
                </label>
              </div>

              <div className="modal-actions-bar">
                <button
                  type="button"
                  className="btn-modal-cancel"
                  onClick={() => setShowAddModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-modal-submit"
                  disabled={isSubmittingCoin}
                >
                  {isSubmittingCoin ? 'Deploying Token...' : 'Deploy Token to Network'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: EDIT COIN / TOKEN PARAMETERS */}
      {editingCurrency && (
        <div className="modal-overlay" onClick={() => setEditingCurrency(null)}>
          <div className="modal-card modal-lg" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title-box">
                <h3 className="modal-title">Edit {editingCurrency.code} Parameters</h3>
                <span className="modal-subtitle">
                  {editingCurrency.is_pillar
                    ? 'Pillar Asset: Core symbol & network are locked. Adjust limits and fees freely.'
                    : 'Custom Token: Adjust metadata, smart contract address, fees, and operational states.'}
                </span>
              </div>
              <button className="btn-close-modal" onClick={() => setEditingCurrency(null)}>✕</button>
            </div>

            <form onSubmit={handleUpdateCoinSubmit} className="modal-form">
              <div className="form-grid-2">
                <div className="form-field">
                  <label className="field-label">Token Name</label>
                  <input
                    type="text"
                    className="modal-input"
                    value={editForm.name}
                    onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                    disabled={editingCurrency.is_pillar}
                    required
                  />
                </div>

                <div className="form-field">
                  <label className="field-label">Smart Contract Address</label>
                  <input
                    type="text"
                    className="modal-input"
                    value={editForm.contract_address}
                    onChange={(e) => setEditForm({ ...editForm, contract_address: e.target.value })}
                    disabled={editingCurrency.is_pillar}
                    placeholder="0x..."
                  />
                </div>
              </div>

              <div className="form-grid-4">
                <div className="form-field">
                  <label className="field-label">Decimals</label>
                  <input
                    type="number"
                    min="0"
                    max="36"
                    className="modal-input"
                    value={editForm.decimals}
                    onChange={(e) => setEditForm({ ...editForm, decimals: parseInt(e.target.value) || 18 })}
                    disabled={editingCurrency.is_pillar}
                    required
                  />
                </div>

                <div className="form-field">
                  <label className="field-label">Min Deposit</label>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    className="modal-input"
                    value={editForm.min_deposit}
                    onChange={(e) => setEditForm({ ...editForm, min_deposit: e.target.value })}
                    required
                  />
                </div>

                <div className="form-field">
                  <label className="field-label">Min Withdrawal</label>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    className="modal-input"
                    value={editForm.min_withdraw}
                    onChange={(e) => setEditForm({ ...editForm, min_withdraw: e.target.value })}
                    required
                  />
                </div>

                <div className="form-field">
                  <label className="field-label">Withdraw Fee</label>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    className="modal-input"
                    value={editForm.withdraw_fee}
                    onChange={(e) => setEditForm({ ...editForm, withdraw_fee: e.target.value })}
                    required
                  />
                </div>
              </div>

              <div className="form-grid-2">
                <div className="form-field">
                  <label className="field-label">Operational Status</label>
                  <select
                    className="modal-select"
                    value={editForm.status}
                    onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}
                  >
                    <option value="ACTIVE">ACTIVE</option>
                    <option value="MAINTENANCE">MAINTENANCE</option>
                    <option value="DISABLED">DISABLED</option>
                  </select>
                </div>
              </div>

              {/* Toggles */}
              <div className="form-toggles-row">
                <label className="toggle-checkbox-label">
                  <input
                    type="checkbox"
                    checked={editForm.is_deposit_enabled}
                    onChange={(e) => setEditForm({ ...editForm, is_deposit_enabled: e.target.checked })}
                  />
                  <span>Allow Deposits</span>
                </label>
                <label className="toggle-checkbox-label">
                  <input
                    type="checkbox"
                    checked={editForm.is_withdraw_enabled}
                    onChange={(e) => setEditForm({ ...editForm, is_withdraw_enabled: e.target.checked })}
                  />
                  <span>Allow Withdrawals</span>
                </label>
                <label className="toggle-checkbox-label">
                  <input
                    type="checkbox"
                    checked={editForm.is_trading_enabled}
                    onChange={(e) => setEditForm({ ...editForm, is_trading_enabled: e.target.checked })}
                  />
                  <span>Allow Spot Trading</span>
                </label>
              </div>

              <div className="modal-actions-bar">
                <button
                  type="button"
                  className="btn-modal-cancel"
                  onClick={() => setEditingCurrency(null)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-modal-submit"
                  disabled={isSubmittingCoin}
                >
                  {isSubmittingCoin ? 'Saving Changes...' : 'Save Parameters'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 3. ADD DYNAMIC TRADING PAIR MODAL */}
      {showAddPairModal && (
        <div className="modal-backdrop" onClick={() => setShowAddPairModal(false)}>
          <div className="modal-card modal-lg" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-header-text">
                <h3 className="modal-title">+ Add Dynamic Trading Pair</h3>
                <p className="modal-sub">
                  Select Base and Quote (Pair) currencies from registered tokens, configure maker & taker tax percentages, and establish order limits.
                </p>
              </div>
              <button
                type="button"
                className="btn-modal-close"
                onClick={() => setShowAddPairModal(false)}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreatePairSubmit} className="modal-form">
              {/* Currency Selectors */}
              <div className="form-grid-2">
                <div className="form-field">
                  <label className="field-label">
                    Base Currency (Asset To Trade) <span className="text-danger">*</span>
                  </label>
                  <select
                    className="modal-select"
                    value={newPairForm.base_currency_id}
                    onChange={(e) =>
                      setNewPairForm({ ...newPairForm, base_currency_id: e.target.value })
                    }
                    required
                  >
                    <option value="">-- Choose Base Currency --</option>
                    {currenciesList.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.code} — {c.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-field">
                  <label className="field-label">
                    Quote / Pair Currency (Pricing Asset) <span className="text-danger">*</span>
                  </label>
                  <select
                    className="modal-select"
                    value={newPairForm.quote_currency_id}
                    onChange={(e) =>
                      setNewPairForm({ ...newPairForm, quote_currency_id: e.target.value })
                    }
                    required
                  >
                    <option value="">-- Choose Quote Currency --</option>
                    {currenciesList.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.code} — {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Dynamic Symbol Preview */}
              {newPairForm.base_currency_id && newPairForm.quote_currency_id && (
                <div className={`pair-preview-banner ${newPairForm.base_currency_id === newPairForm.quote_currency_id ? 'has-error' : ''}`}>
                  {newPairForm.base_currency_id === newPairForm.quote_currency_id ? (
                    <span className="preview-error-text">⚠️ Base and Quote currency cannot be the same.</span>
                  ) : (
                    <div className="preview-content">
                      <span className="preview-label">Generated Symbol:</span>
                      <span className="preview-symbol-badge">
                        {currenciesList.find((c) => String(c.id) === String(newPairForm.base_currency_id))?.code}
                        {currenciesList.find((c) => String(c.id) === String(newPairForm.quote_currency_id))?.code}
                      </span>
                      <span className="preview-sub">
                        ({currenciesList.find((c) => String(c.id) === String(newPairForm.base_currency_id))?.code} priced in{' '}
                        {currenciesList.find((c) => String(c.id) === String(newPairForm.quote_currency_id))?.code})
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* Tax & Fee Inputs */}
              <div className="form-grid-2">
                <div className="form-field">
                  <label className="field-label">Maker Tax / Fee (%)</label>
                  <div className="input-with-addon">
                    <input
                      type="number"
                      step="0.001"
                      min="0"
                      max="10"
                      className="input-fee"
                      value={newPairForm.maker_fee_percent}
                      onChange={(e) =>
                        setNewPairForm({ ...newPairForm, maker_fee_percent: e.target.value })
                      }
                      required
                    />
                    <span className="input-addon">%</span>
                  </div>
                  <span className="field-hint">Default: 0.100% for limit order makers</span>
                </div>

                <div className="form-field">
                  <label className="field-label">Taker Tax / Fee (%)</label>
                  <div className="input-with-addon">
                    <input
                      type="number"
                      step="0.001"
                      min="0"
                      max="10"
                      className="input-fee"
                      value={newPairForm.taker_fee_percent}
                      onChange={(e) =>
                        setNewPairForm({ ...newPairForm, taker_fee_percent: e.target.value })
                      }
                      required
                    />
                    <span className="input-addon">%</span>
                  </div>
                  <span className="field-hint">Default: 0.200% for market order takers</span>
                </div>
              </div>

              {/* Min Qty & Min Notional */}
              <div className="form-grid-2">
                <div className="form-field">
                  <label className="field-label">Min Order Quantity</label>
                  <input
                    type="number"
                    step="any"
                    min="0.00000001"
                    className="modal-input"
                    value={newPairForm.min_order_quantity}
                    onChange={(e) =>
                      setNewPairForm({ ...newPairForm, min_order_quantity: e.target.value })
                    }
                    placeholder="e.g. 1.0 or 0.001"
                    required
                  />
                  <span className="field-hint">Minimum base asset amount per order</span>
                </div>

                <div className="form-field">
                  <label className="field-label">Min Order Notional</label>
                  <input
                    type="number"
                    step="any"
                    min="0.01"
                    className="modal-input"
                    value={newPairForm.min_order_notional}
                    onChange={(e) =>
                      setNewPairForm({ ...newPairForm, min_order_notional: e.target.value })
                    }
                    placeholder="e.g. 5.0"
                    required
                  />
                  <span className="field-hint">Minimum total trade value (price * qty)</span>
                </div>
              </div>

              {/* Precisions & Status */}
              <div className="form-grid-3">
                <div className="form-field">
                  <label className="field-label">Price Precision (Decimals)</label>
                  <input
                    type="number"
                    min="0"
                    max="8"
                    className="modal-input"
                    value={newPairForm.price_precision}
                    onChange={(e) =>
                      setNewPairForm({ ...newPairForm, price_precision: e.target.value })
                    }
                    required
                  />
                </div>

                <div className="form-field">
                  <label className="field-label">Qty Precision (Decimals)</label>
                  <input
                    type="number"
                    min="0"
                    max="8"
                    className="modal-input"
                    value={newPairForm.quantity_precision}
                    onChange={(e) =>
                      setNewPairForm({ ...newPairForm, quantity_precision: e.target.value })
                    }
                    required
                  />
                </div>

                <div className="form-field">
                  <label className="field-label">Initial Status</label>
                  <select
                    className="modal-select"
                    value={newPairForm.status}
                    onChange={(e) =>
                      setNewPairForm({ ...newPairForm, status: e.target.value })
                    }
                  >
                    <option value="TRADING">TRADING (Active)</option>
                    <option value="HALTED">HALTED</option>
                    <option value="CANCEL_ONLY">CANCEL_ONLY</option>
                  </select>
                </div>
              </div>

              <div className="modal-actions-bar">
                <button
                  type="button"
                  className="btn-modal-cancel"
                  onClick={() => setShowAddPairModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-modal-submit"
                  disabled={isSubmittingPair}
                >
                  {isSubmittingPair ? 'Creating Pair...' : 'Create Trading Pair'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 4. EDIT TRADING PAIR LIMITS & TAX MODAL */}
      {editingPair && (
        <div className="modal-backdrop" onClick={() => setEditingPair(null)}>
          <div className="modal-card modal-lg" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-header-text">
                <h3 className="modal-title">Edit Trading Pair: {editingPair.symbol}</h3>
                <p className="modal-sub">
                  Adjust fee percentages, order limits, precision points, and operational status for {editingPair.symbol}.
                </p>
              </div>
              <button
                type="button"
                className="btn-modal-close"
                onClick={() => setEditingPair(null)}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleUpdatePairSubmit} className="modal-form">
              {/* Fee Rates */}
              <div className="form-grid-2">
                <div className="form-field">
                  <label className="field-label">Maker Tax / Fee (%)</label>
                  <div className="input-with-addon">
                    <input
                      type="number"
                      step="0.001"
                      min="0"
                      max="10"
                      className="input-fee"
                      value={editPairForm.maker_fee_percent}
                      onChange={(e) =>
                        setEditPairForm({ ...editPairForm, maker_fee_percent: e.target.value })
                      }
                      required
                    />
                    <span className="input-addon">%</span>
                  </div>
                </div>

                <div className="form-field">
                  <label className="field-label">Taker Tax / Fee (%)</label>
                  <div className="input-with-addon">
                    <input
                      type="number"
                      step="0.001"
                      min="0"
                      max="10"
                      className="input-fee"
                      value={editPairForm.taker_fee_percent}
                      onChange={(e) =>
                        setEditPairForm({ ...editPairForm, taker_fee_percent: e.target.value })
                      }
                      required
                    />
                    <span className="input-addon">%</span>
                  </div>
                </div>
              </div>

              {/* Min Qty & Min Notional */}
              <div className="form-grid-2">
                <div className="form-field">
                  <label className="field-label">Min Order Quantity ({editingPair.base})</label>
                  <input
                    type="number"
                    step="any"
                    min="0.00000001"
                    className="modal-input"
                    value={editPairForm.min_order_quantity}
                    onChange={(e) =>
                      setEditPairForm({ ...editPairForm, min_order_quantity: e.target.value })
                    }
                    required
                  />
                </div>

                <div className="form-field">
                  <label className="field-label">Min Order Notional ({editingPair.quote})</label>
                  <input
                    type="number"
                    step="any"
                    min="0.01"
                    className="modal-input"
                    value={editPairForm.min_order_notional}
                    onChange={(e) =>
                      setEditPairForm({ ...editPairForm, min_order_notional: e.target.value })
                    }
                    required
                  />
                </div>
              </div>

              {/* Precisions & Status */}
              <div className="form-grid-3">
                <div className="form-field">
                  <label className="field-label">Price Precision</label>
                  <input
                    type="number"
                    min="0"
                    max="8"
                    className="modal-input"
                    value={editPairForm.price_precision}
                    onChange={(e) =>
                      setEditPairForm({ ...editPairForm, price_precision: e.target.value })
                    }
                    required
                  />
                </div>

                <div className="form-field">
                  <label className="field-label">Quantity Precision</label>
                  <input
                    type="number"
                    min="0"
                    max="8"
                    className="modal-input"
                    value={editPairForm.quantity_precision}
                    onChange={(e) =>
                      setEditPairForm({ ...editPairForm, quantity_precision: e.target.value })
                    }
                    required
                  />
                </div>

                <div className="form-field">
                  <label className="field-label">Market Status</label>
                  <select
                    className="modal-select"
                    value={editPairForm.status}
                    onChange={(e) =>
                      setEditPairForm({ ...editPairForm, status: e.target.value })
                    }
                  >
                    <option value="TRADING">TRADING (Active)</option>
                    <option value="HALTED">HALTED</option>
                    <option value="CANCEL_ONLY">CANCEL_ONLY</option>
                  </select>
                </div>
              </div>

              <div className="modal-actions-bar">
                <button
                  type="button"
                  className="btn-modal-cancel"
                  onClick={() => setEditingPair(null)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-modal-submit"
                  disabled={isSubmittingPair}
                >
                  {isSubmittingPair ? 'Saving Changes...' : 'Save Parameters'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
