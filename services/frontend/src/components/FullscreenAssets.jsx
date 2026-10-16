import React, { useState, useEffect } from 'react';
import { walletApi } from '../api';
import QrCodeCard from './QrCodeCard';

const DEFAULT_COIN_NETWORKS = {
  BTC: [{ network: 'BTC', name: 'Bitcoin Network', confirmation_blocks: 2 }],
  ETH: [
    { network: 'ETH', name: 'Ethereum (ERC-20 / Sepolia)', confirmation_blocks: 12 },
    { network: 'ARB', name: 'Arbitrum One (L2)', confirmation_blocks: 1 },
  ],
  USDT: [
    { network: 'ETH', name: 'Ethereum (ERC-20)', confirmation_blocks: 12 },
    { network: 'ARB', name: 'Arbitrum One', confirmation_blocks: 1 },
    { network: 'MATIC', name: 'Polygon PoS', confirmation_blocks: 64 },
    { network: 'BNB', name: 'BNB Smart Chain (BEP-20)', confirmation_blocks: 15 },
    { network: 'AVAX', name: 'Avalanche C-Chain', confirmation_blocks: 1 },
  ],
  ARB: [
    { network: 'ARB', name: 'Arbitrum One', confirmation_blocks: 1 },
    { network: 'ETH', name: 'Ethereum (ERC-20)', confirmation_blocks: 12 },
  ],
  MATIC: [
    { network: 'MATIC', name: 'Polygon PoS', confirmation_blocks: 64 },
    { network: 'ETH', name: 'Ethereum (ERC-20)', confirmation_blocks: 12 },
  ],
  BNB: [
    { network: 'BNB', name: 'BNB Smart Chain (BEP-20)', confirmation_blocks: 15 },
  ],
  AVAX: [
    { network: 'AVAX', name: 'Avalanche C-Chain', confirmation_blocks: 1 },
  ],
};

const COIN_ICONS = {
  BTC: '₿',
  ETH: 'Ξ',
  USDT: '₮',
  ARB: '▲',
  MATIC: '⬡',
  BNB: '◈',
  AVAX: '🔺',
};

// Reusable Copy Button with visual feedback
export function CopyButton({ text, label = 'Copy', copiedLabel = 'Copied!', className = '' }) {
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

// Reusable Address/Hash Display with inline Copy button
export function AddressWithCopy({ address, prefixLength = 10, suffixLength = 6, showFull = false }) {
  if (!address) return <span className="text-dim">—</span>;
  const display = showFull
    ? address
    : address.length > prefixLength + suffixLength
    ? `${address.slice(0, prefixLength)}...${address.slice(-suffixLength)}`
    : address;

  return (
    <div className="address-with-copy-wrapper" title={address}>
      <span className="mono-address">{display}</span>
      <CopyButton text={address} label="Copy" copiedLabel="Copied" className="btn-copy-tiny" />
    </div>
  );
}

export default function FullscreenAssets({ user, wallets, onRefreshWallets, onBackToTrade }) {
  // Main tabs: OVERVIEW, DEPOSIT, WITHDRAW, TRANSFER, HISTORY, PROFILE
  const [activeTab, setActiveTab] = useState('OVERVIEW');
  // History sub-tabs: WITHDRAWALS, DEPOSITS, TRANSFERS
  const [historySubTab, setHistorySubTab] = useState('DEPOSITS');

  const [selectedCurrency, setSelectedCurrency] = useState('BTC');
  const [selectedNetwork, setSelectedNetwork] = useState('BTC');

  // Deposit state
  const [depositAddress, setDepositAddress] = useState('');
  const [isLoadingAddress, setIsLoadingAddress] = useState(false);
  const [addressError, setAddressError] = useState('');

  // Withdraw state
  const [withdrawAddress, setWithdrawAddress] = useState('');
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [isSubmittingWithdraw, setIsSubmittingWithdraw] = useState(false);
  const [withdrawMessage, setWithdrawMessage] = useState({ type: '', text: '' });

  // Internal Transfer state
  const [transferRecipient, setTransferRecipient] = useState('');
  const [transferAmount, setTransferAmount] = useState('');
  const [transferMemo, setTransferMemo] = useState('');
  const [isSubmittingTransfer, setIsSubmittingTransfer] = useState(false);
  const [transferMessage, setTransferMessage] = useState({ type: '', text: '' });

  // History state
  const [userWithdrawals, setUserWithdrawals] = useState([]);
  const [userDeposits, setUserDeposits] = useState([]);
  const [userTransfers, setUserTransfers] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const isAdmin = user?.role === 'ADMIN';

  // Synchronize network when currency changes
  useEffect(() => {
    const curWallet = wallets.find((w) => w.currency === selectedCurrency);
    const networks =
      curWallet && curWallet.networks && curWallet.networks.length > 0
        ? curWallet.networks
        : DEFAULT_COIN_NETWORKS[selectedCurrency] || [{ network: selectedCurrency, name: selectedCurrency }];

    if (networks && networks.length > 0) {
      const exists = networks.some((n) => n.network === selectedNetwork);
      if (!exists) {
        setSelectedNetwork(networks[0].network);
      }
    }
  }, [selectedCurrency, wallets]);

  // Fetch deposit address when DEPOSIT tab is opened
  useEffect(() => {
    if (activeTab === 'DEPOSIT' && selectedCurrency && selectedNetwork && !isAdmin) {
      fetchDepositAddress(selectedCurrency, selectedNetwork);
    }
  }, [activeTab, selectedCurrency, selectedNetwork, isAdmin]);

  // Load history data when HISTORY tab or sub-tabs are opened
  useEffect(() => {
    if (activeTab === 'HISTORY') {
      if (historySubTab === 'WITHDRAWALS') loadWithdrawalHistory();
      else if (historySubTab === 'DEPOSITS') loadDepositHistory();
      else if (historySubTab === 'TRANSFERS') loadTransferHistory();
    }
  }, [activeTab, historySubTab]);

  async function loadWithdrawalHistory() {
    setLoadingHistory(true);
    try {
      const res = await walletApi.getUserWithdrawals();
      if (res.success) setUserWithdrawals(res.data);
    } catch (err) {
      console.warn('Failed to load withdrawal history:', err);
    } finally {
      setLoadingHistory(false);
    }
  }

  async function loadDepositHistory() {
    setLoadingHistory(true);
    try {
      const res = await walletApi.getUserDeposits();
      if (res.success) setUserDeposits(res.data);
    } catch (err) {
      console.warn('Failed to load deposit history:', err);
    } finally {
      setLoadingHistory(false);
    }
  }

  async function loadTransferHistory() {
    setLoadingHistory(true);
    try {
      const res = await walletApi.getUserTransfers();
      if (res.success) setUserTransfers(res.data);
    } catch (err) {
      console.warn('Failed to load transfer history:', err);
    } finally {
      setLoadingHistory(false);
    }
  }

  async function fetchDepositAddress(curr, net) {
    if (isAdmin) return;
    setIsLoadingAddress(true);
    setAddressError('');
    try {
      const res = await walletApi.getDepositAddress(curr, net);
      if (res.success && res.data) {
        setDepositAddress(res.data.address);
      }
    } catch (err) {
      setAddressError(err.message || 'Failed to generate deposit address');
    } finally {
      setIsLoadingAddress(false);
    }
  }

  // Handle Withdraw Submit
  async function handleWithdrawSubmit(e) {
    e.preventDefault();
    if (isAdmin) {
      setWithdrawMessage({ type: 'error', text: 'Administrators are restricted from withdrawing funds.' });
      return;
    }
    if (!withdrawAddress || !withdrawAmount || Number(withdrawAmount) <= 0) {
      setWithdrawMessage({ type: 'error', text: 'Please enter a valid destination address and amount.' });
      return;
    }

    setIsSubmittingWithdraw(true);
    setWithdrawMessage({ type: '', text: '' });
    try {
      const res = await walletApi.withdraw(
        selectedCurrency,
        selectedNetwork,
        withdrawAddress,
        withdrawAmount
      );
      if (res.success) {
        setWithdrawMessage({
          type: 'success',
          text: `Withdrawal request for ${withdrawAmount} ${selectedCurrency} submitted successfully. Awaiting compliance review.`,
        });
        setWithdrawAddress('');
        setWithdrawAmount('');
        onRefreshWallets();
        if (historySubTab === 'WITHDRAWALS') loadWithdrawalHistory();
      }
    } catch (err) {
      setWithdrawMessage({ type: 'error', text: err.message || 'Withdrawal request failed' });
    } finally {
      setIsSubmittingWithdraw(false);
    }
  }

  // Handle Internal Transfer Submit
  async function handleTransferSubmit(e) {
    e.preventDefault();
    if (isAdmin) {
      setTransferMessage({ type: 'error', text: 'Administrators are restricted from transferring funds.' });
      return;
    }
    if (!transferRecipient.trim()) {
      setTransferMessage({ type: 'error', text: 'Please enter recipient email or user ID.' });
      return;
    }
    if (!transferAmount || Number(transferAmount) <= 0) {
      setTransferMessage({ type: 'error', text: 'Please enter a valid transfer amount.' });
      return;
    }

    setIsSubmittingTransfer(true);
    setTransferMessage({ type: '', text: '' });
    try {
      const res = await walletApi.transferInternal(
        selectedCurrency,
        transferRecipient.trim(),
        transferAmount,
        transferMemo.trim() || undefined
      );
      if (res.success) {
        setTransferMessage({
          type: 'success',
          text: `Instant internal transfer of ${transferAmount} ${selectedCurrency} completed successfully! Recipient received funds immediately with 0 fee.`,
        });
        setTransferRecipient('');
        setTransferAmount('');
        setTransferMemo('');
        onRefreshWallets();
        if (historySubTab === 'TRANSFERS') loadTransferHistory();
      }
    } catch (err) {
      setTransferMessage({ type: 'error', text: err.message || 'Internal transfer failed' });
    } finally {
      setIsSubmittingTransfer(false);
    }
  }

  // Calculate estimated total portfolio in USDT
  const totalUsdtEstimate = wallets.reduce((acc, w) => {
    const total = parseFloat(w.total) || 0;
    if (w.currency === 'USDT') return acc + total;
    if (w.currency === 'BTC') return acc + total * 65000;
    if (w.currency === 'ETH') return acc + total * 3500;
    if (w.currency === 'BNB') return acc + total * 600;
    if (w.currency === 'AVAX') return acc + total * 28;
    if (w.currency === 'ARB') return acc + total * 0.85;
    if (w.currency === 'MATIC') return acc + total * 0.55;
    return acc + total;
  }, 0);

  const btcEstimate = totalUsdtEstimate / 65000;

  const currentWallet = wallets.find((w) => w.currency === selectedCurrency) || {};
  const currentNetworks =
    currentWallet.networks && currentWallet.networks.length > 0
      ? currentWallet.networks
      : DEFAULT_COIN_NETWORKS[selectedCurrency] || [
          { network: selectedCurrency, name: selectedCurrency, confirmation_blocks: 2 },
        ];

  return (
    <div className="fullscreen-assets-view">
      {/* Top Header Bar */}
      <div className="assets-top-nav">
        <div className="nav-left">
          <button className="btn-back" onClick={onBackToTrade}>
            ← Back to Spot Trade
          </button>
          <div className="assets-title-group">
            <h1 className="assets-main-title">Assets & Portfolio</h1>
            <div className="user-nav-meta">
              <span className="user-email-badge">{user?.email}</span>
              {isAdmin && <span className="admin-status-badge">ADMINISTRATOR</span>}
            </div>
          </div>
        </div>

        <div className="nav-tabs-pill">
          <button
            className={`tab-btn ${activeTab === 'OVERVIEW' ? 'active' : ''}`}
            onClick={() => setActiveTab('OVERVIEW')}
          >
            Overview
          </button>
          <button
            className={`tab-btn ${activeTab === 'DEPOSIT' ? 'active' : ''}`}
            onClick={() => setActiveTab('DEPOSIT')}
          >
            Deposit
          </button>
          <button
            className={`tab-btn ${activeTab === 'WITHDRAW' ? 'active' : ''}`}
            onClick={() => setActiveTab('WITHDRAW')}
          >
            Withdraw
          </button>
          <button
            className={`tab-btn ${activeTab === 'TRANSFER' ? 'active' : ''}`}
            onClick={() => setActiveTab('TRANSFER')}
          >
            Internal Transfer
          </button>
          <button
            className={`tab-btn ${activeTab === 'HISTORY' ? 'active' : ''}`}
            onClick={() => setActiveTab('HISTORY')}
          >
            History
          </button>
          <button
            className={`tab-btn ${activeTab === 'PROFILE' ? 'active' : ''}`}
            onClick={() => setActiveTab('PROFILE')}
          >
            Profile
          </button>
        </div>
      </div>

      {/* OVERVIEW TAB */}
      {activeTab === 'OVERVIEW' && (
        <div className="assets-overview-container">
          {/* Portfolio Metric Card */}
          <div className="portfolio-metric-card">
            <div className="metric-left">
              <span className="metric-label">Estimated Total Net Worth</span>
              <div className="metric-numbers">
                <span className="metric-value-usdt">
                  ${totalUsdtEstimate.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
                <span className="metric-currency">USDT</span>
                <span className="metric-value-btc">≈ {btcEstimate.toFixed(6)} BTC</span>
              </div>
              <p className="metric-desc">Real-time asset valuation across all integrated blockchain networks.</p>
            </div>

            <div className="metric-actions">
              {!isAdmin ? (
                <>
                  <button
                    className="btn-action-primary"
                    onClick={() => {
                      setSelectedCurrency('BTC');
                      setActiveTab('DEPOSIT');
                    }}
                  >
                    Deposit Funds
                  </button>
                  <button
                    className="btn-action-secondary"
                    onClick={() => {
                      setSelectedCurrency('USDT');
                      setActiveTab('WITHDRAW');
                    }}
                  >
                    Request Withdraw
                  </button>
                  <button
                    className="btn-action-accent"
                    onClick={() => {
                      setSelectedCurrency('USDT');
                      setActiveTab('TRANSFER');
                    }}
                  >
                    Internal Transfer
                  </button>
                </>
              ) : (
                <div className="admin-actions-notice">
                  <span>🛡️ Financial Operations Locked for Admin</span>
                </div>
              )}
              <button
                className="btn-action-outline"
                onClick={onRefreshWallets}
                title="Refresh balances"
              >
                Refresh
              </button>
            </div>
          </div>

          {/* Asset List Grid/Table */}
          <div className="assets-table-card">
            <div className="table-header-row">
              <h2 className="table-title">Multi-Chain Balances</h2>
              <span className="table-subtitle">Select any asset to view deposit address, withdraw, or transfer internally</span>
            </div>

            <div className="table-wrapper">
              <table className="assets-table">
                <thead>
                  <tr>
                    <th>Asset</th>
                    <th>Name</th>
                    <th>Available Balance</th>
                    <th>Locked (In Orders)</th>
                    <th>Total Balance</th>
                    <th>Supported Networks</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {wallets.map((w) => {
                    const networks =
                      w.networks && w.networks.length > 0
                        ? w.networks
                        : DEFAULT_COIN_NETWORKS[w.currency] || [];

                    return (
                      <tr key={w.currency} className="asset-row">
                        <td className="asset-coin-cell">
                          <span className="coin-icon-circle">{COIN_ICONS[w.currency] || '●'}</span>
                          <span className="coin-code">{w.currency}</span>
                        </td>
                        <td className="asset-name-cell">{w.name}</td>
                        <td className="asset-number-cell available">
                          {parseFloat(w.balance).toLocaleString('en-US', { maximumFractionDigits: 8 })}
                        </td>
                        <td className="asset-number-cell locked">
                          {parseFloat(w.locked).toLocaleString('en-US', { maximumFractionDigits: 8 })}
                        </td>
                        <td className="asset-number-cell total">
                          {parseFloat(w.total).toLocaleString('en-US', { maximumFractionDigits: 8 })}
                        </td>
                        <td className="networks-cell">
                          <div className="network-pills-list">
                            {networks.map((n) => (
                              <span key={n.network} className="network-tag" title={n.name}>
                                {n.network}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="actions-cell">
                          {!isAdmin ? (
                            <>
                              <button
                                className="btn-sm btn-deposit"
                                onClick={() => {
                                  setSelectedCurrency(w.currency);
                                  setActiveTab('DEPOSIT');
                                }}
                              >
                                Deposit
                              </button>
                              <button
                                className="btn-sm btn-withdraw"
                                onClick={() => {
                                  setSelectedCurrency(w.currency);
                                  setActiveTab('WITHDRAW');
                                }}
                              >
                                Withdraw
                              </button>
                              <button
                                className="btn-sm btn-transfer"
                                onClick={() => {
                                  setSelectedCurrency(w.currency);
                                  setActiveTab('TRANSFER');
                                }}
                              >
                                Transfer
                              </button>
                            </>
                          ) : (
                            <span className="text-dim text-xs">Admin View Only</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* DEPOSIT TAB */}
      {activeTab === 'DEPOSIT' && (
        <div className="fullscreen-pane deposit-pane">
          {isAdmin ? (
            <div className="admin-restricted-view">
              <div className="admin-restriction-card">
                <div className="restriction-icon">🛡️</div>
                <h3>Deposit Disabled for Administrator</h3>
                <p>
                  As an <strong>Administrator</strong>, you are strictly restricted from depositing funds or generating personal deposit addresses according to exchange segregation policies.
                </p>
                <div className="restriction-badge">Role: SYSTEM ADMINISTRATOR</div>
              </div>
            </div>
          ) : (
            <>
              <div className="pane-sidebar">
                <h3 className="sidebar-step-title">1. Select Asset</h3>
                <div className="coin-selection-list">
                  {wallets.map((w) => (
                    <div
                      key={w.currency}
                      className={`coin-select-card ${selectedCurrency === w.currency ? 'selected' : ''}`}
                      onClick={() => setSelectedCurrency(w.currency)}
                    >
                      <span className="card-coin-icon">{COIN_ICONS[w.currency] || '●'}</span>
                      <div className="card-coin-info">
                        <span className="card-code">{w.currency}</span>
                        <span className="card-name">{w.name}</span>
                      </div>
                      <span className="card-balance">{parseFloat(w.balance).toFixed(4)}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="pane-main-content">
                <div className="deposit-card-box">
                  <div className="box-header">
                    <h2 className="box-title">Deposit {selectedCurrency}</h2>
                    <p className="box-desc">
                      Deposit addresses are derived per network. Always ensure you are transferring via the selected network.
                    </p>
                  </div>

                  {/* Step 2: Select Network FIRST */}
                  <div className="network-selector-section">
                    <label className="section-label">
                      <span className="step-num">Step 2:</span> Select Deposit Network (Required First)
                    </label>
                    <div className="network-buttons-grid">
                      {currentNetworks.map((n) => (
                        <button
                          key={n.network}
                          type="button"
                          className={`network-select-btn ${selectedNetwork === n.network ? 'active' : ''}`}
                          onClick={() => setSelectedNetwork(n.network)}
                        >
                          <span className="net-title">{n.network}</span>
                          <span className="net-sub">{n.name}</span>
                          {n.confirmation_blocks && (
                            <span className="net-conf">{n.confirmation_blocks} Confirmations</span>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Step 3: Address & Barcode Result */}
                  <div className="deposit-result-section">
                    <label className="section-label">
                      <span className="step-num">Step 3:</span> Deposit Address & Barcode
                    </label>

                    {isLoadingAddress ? (
                      <div className="loading-address-box">
                        <div className="spinner"></div>
                        <p>Generating verified address for {selectedCurrency} on {selectedNetwork}...</p>
                      </div>
                    ) : addressError ? (
                      <div className="error-box">
                        <span>⚠️ {addressError}</span>
                        <button onClick={() => fetchDepositAddress(selectedCurrency, selectedNetwork)}>Retry</button>
                      </div>
                    ) : (
                      <div className="address-display-wrapper">
                        <QrCodeCard
                          address={depositAddress}
                          network={selectedNetwork}
                          currency={selectedCurrency}
                        />

                        {depositAddress && (
                          <div className="quick-copy-bar">
                            <span className="quick-copy-label">Deposit Address:</span>
                            <span className="quick-copy-text">{depositAddress}</span>
                            <CopyButton text={depositAddress} label="Copy Address" copiedLabel="Address Copied!" />
                          </div>
                        )}

                        <div className="deposit-notice-box">
                          <h4>Deposit Guidelines & Safety:</h4>
                          <ul>
                            <li>
                              Send only <strong>{selectedCurrency}</strong> to this specific address. Sending other assets will cause permanent loss.
                            </li>
                            <li>
                              Selected Network: <strong>{selectedNetwork}</strong>. Ensure your source wallet uses this matching network.
                            </li>
                            <li>
                              Transactions require confirmation blocks before crediting your available balance.
                            </li>
                          </ul>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* WITHDRAW TAB */}
      {activeTab === 'WITHDRAW' && (
        <div className="fullscreen-pane withdraw-pane">
          {isAdmin ? (
            <div className="admin-restricted-view">
              <div className="admin-restriction-card">
                <div className="restriction-icon">🛡️</div>
                <h3>Withdrawal Disabled for Administrator</h3>
                <p>
                  As an <strong>Administrator</strong>, you are strictly restricted from requesting withdrawals according to exchange segregation policies.
                </p>
                <div className="restriction-badge">Role: SYSTEM ADMINISTRATOR</div>
              </div>
            </div>
          ) : (
            <>
              <div className="pane-sidebar">
                <h3 className="sidebar-step-title">1. Select Asset</h3>
                <div className="coin-selection-list">
                  {wallets.map((w) => (
                    <div
                      key={w.currency}
                      className={`coin-select-card ${selectedCurrency === w.currency ? 'selected' : ''}`}
                      onClick={() => setSelectedCurrency(w.currency)}
                    >
                      <span className="card-coin-icon">{COIN_ICONS[w.currency] || '●'}</span>
                      <div className="card-coin-info">
                        <span className="card-code">{w.currency}</span>
                        <span className="card-name">{w.name}</span>
                      </div>
                      <span className="card-balance">{parseFloat(w.balance).toFixed(4)}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="pane-main-content">
                <form className="withdraw-card-box" onSubmit={handleWithdrawSubmit}>
                  <div className="box-header">
                    <h2 className="box-title">Withdraw {selectedCurrency}</h2>
                    <p className="box-desc">
                      Select destination network, input recipient address and amount. All withdrawals undergo automated risk checks.
                    </p>
                  </div>

                  {withdrawMessage.text && (
                    <div className={`message-banner ${withdrawMessage.type}`}>
                      {withdrawMessage.text}
                    </div>
                  )}

                  {/* Step 2: Select Network FIRST */}
                  <div className="form-group-section">
                    <label className="section-label">
                      <span className="step-num">Step 2:</span> Select Withdrawal Network (Required First)
                    </label>
                    <div className="network-buttons-grid">
                      {currentNetworks.map((n) => (
                        <button
                          key={n.network}
                          type="button"
                          className={`network-select-btn ${selectedNetwork === n.network ? 'active' : ''}`}
                          onClick={() => setSelectedNetwork(n.network)}
                        >
                          <span className="net-title">{n.network}</span>
                          <span className="net-sub">{n.name}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Recipient Address */}
                  <div className="form-group">
                    <label className="form-label">Recipient Destination Address ({selectedNetwork})</label>
                    <input
                      type="text"
                      className="input-field"
                      placeholder={`Enter ${selectedNetwork} compatible address (e.g. ${
                        selectedNetwork === 'BTC' ? '1... or bc1...' : '0x...'
                      })`}
                      value={withdrawAddress}
                      onChange={(e) => setWithdrawAddress(e.target.value)}
                      required
                    />
                  </div>

                  {/* Amount */}
                  <div className="form-group">
                    <div className="label-with-balance">
                      <label className="form-label">Withdrawal Amount</label>
                      <span className="available-hint">
                        Available: <strong>{parseFloat(currentWallet.balance || 0).toFixed(6)} {selectedCurrency}</strong>
                      </span>
                    </div>
                    <div className="amount-input-group">
                      <input
                        type="number"
                        step="any"
                        className="input-field"
                        placeholder="0.00"
                        value={withdrawAmount}
                        onChange={(e) => setWithdrawAmount(e.target.value)}
                        required
                      />
                      <button
                        type="button"
                        className="btn-max-fill"
                        onClick={() => setWithdrawAmount(currentWallet.balance || '0')}
                      >
                        MAX
                      </button>
                    </div>
                  </div>

                  {/* Fee and Summary */}
                  <div className="withdraw-summary-box">
                    <div className="summary-row">
                      <span>Network Transaction Fee:</span>
                      <span className="fee-val">0.001 {selectedCurrency}</span>
                    </div>
                    <div className="summary-row net-row">
                      <span>Estimated Net Receive:</span>
                      <span className="net-val">
                        {Math.max(0, (parseFloat(withdrawAmount) || 0) - 0.001).toFixed(6)} {selectedCurrency}
                      </span>
                    </div>
                  </div>

                  <button
                    type="submit"
                    className="btn-submit-withdraw"
                    disabled={isSubmittingWithdraw}
                  >
                    {isSubmittingWithdraw ? 'Submitting Request...' : `Submit ${selectedCurrency} Withdrawal`}
                  </button>
                </form>
              </div>
            </>
          )}
        </div>
      )}

      {/* INTERNAL TRANSFER TAB */}
      {activeTab === 'TRANSFER' && (
        <div className="fullscreen-pane transfer-pane">
          {isAdmin ? (
            <div className="admin-restricted-view">
              <div className="admin-restriction-card">
                <div className="restriction-icon">🛡️</div>
                <h3>Internal Transfer Disabled for Administrator</h3>
                <p>
                  As an <strong>Administrator</strong>, you are strictly restricted from transferring funds between accounts according to exchange segregation policies.
                </p>
                <div className="restriction-badge">Role: SYSTEM ADMINISTRATOR</div>
              </div>
            </div>
          ) : (
            <>
              <div className="pane-sidebar">
                <h3 className="sidebar-step-title">1. Select Asset</h3>
                <div className="coin-selection-list">
                  {wallets.map((w) => (
                    <div
                      key={w.currency}
                      className={`coin-select-card ${selectedCurrency === w.currency ? 'selected' : ''}`}
                      onClick={() => setSelectedCurrency(w.currency)}
                    >
                      <span className="card-coin-icon">{COIN_ICONS[w.currency] || '●'}</span>
                      <div className="card-coin-info">
                        <span className="card-code">{w.currency}</span>
                        <span className="card-name">{w.name}</span>
                      </div>
                      <span className="card-balance">{parseFloat(w.balance).toFixed(4)}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="pane-main-content">
                <form className="transfer-card-box" onSubmit={handleTransferSubmit}>
                  <div className="box-header">
                    <h2 className="box-title">Internal Transfer (Between CEX Users)</h2>
                    <p className="box-desc">
                      Transfer crypto directly to another registered CEX account instantly with <strong>0% fee</strong> and zero on-chain gas costs.
                    </p>
                  </div>

                  <div className="instant-transfer-callout">
                    <div className="callout-icon">⚡</div>
                    <div className="callout-body">
                      <strong>Off-Chain Instant Settlement:</strong> Transferred funds are credited to the recipient immediately through cryptographic ledger atomic mutation.
                    </div>
                  </div>

                  {transferMessage.text && (
                    <div className={`message-banner ${transferMessage.type}`}>
                      {transferMessage.text}
                    </div>
                  )}

                  {/* Recipient Field */}
                  <div className="form-group">
                    <label className="form-label">Recipient User Email or User ID</label>
                    <input
                      type="text"
                      className="input-field"
                      placeholder="e.g. user@cex.com or user ID (e.g. 2)"
                      value={transferRecipient}
                      onChange={(e) => setTransferRecipient(e.target.value)}
                      required
                    />
                    <span className="field-hint">Enter the recipient's registered email address or numeric User ID.</span>
                  </div>

                  {/* Amount */}
                  <div className="form-group">
                    <div className="label-with-balance">
                      <label className="form-label">Transfer Amount ({selectedCurrency})</label>
                      <span className="available-hint">
                        Available: <strong>{parseFloat(currentWallet.balance || 0).toFixed(6)} {selectedCurrency}</strong>
                      </span>
                    </div>
                    <div className="amount-input-group">
                      <input
                        type="number"
                        step="any"
                        className="input-field"
                        placeholder="0.00"
                        value={transferAmount}
                        onChange={(e) => setTransferAmount(e.target.value)}
                        required
                      />
                      <button
                        type="button"
                        className="btn-max-fill"
                        onClick={() => setTransferAmount(currentWallet.balance || '0')}
                      >
                        MAX
                      </button>
                    </div>
                  </div>

                  {/* Optional Memo */}
                  <div className="form-group">
                    <label className="form-label">Transfer Note / Memo (Optional)</label>
                    <input
                      type="text"
                      className="input-field"
                      placeholder="e.g. Payment for design services, dinner split, etc."
                      value={transferMemo}
                      onChange={(e) => setTransferMemo(e.target.value)}
                      maxLength={250}
                    />
                  </div>

                  {/* Summary Box */}
                  <div className="withdraw-summary-box">
                    <div className="summary-row">
                      <span>Internal Transfer Fee:</span>
                      <span className="fee-val text-success">0.00 {selectedCurrency} (FREE)</span>
                    </div>
                    <div className="summary-row net-row">
                      <span>Recipient Receives:</span>
                      <span className="net-val">
                        {(parseFloat(transferAmount) || 0).toFixed(6)} {selectedCurrency}
                      </span>
                    </div>
                  </div>

                  <button
                    type="submit"
                    className="btn-submit-transfer"
                    disabled={isSubmittingTransfer}
                  >
                    {isSubmittingTransfer ? 'Processing Transfer...' : `Transfer ${selectedCurrency} Instantly`}
                  </button>
                </form>
              </div>
            </>
          )}
        </div>
      )}

      {/* TRANSACTION HISTORY TAB (WITH SUB-TABS) */}
      {activeTab === 'HISTORY' && (
        <div className="assets-history-container">
          <div className="history-header-card">
            <div className="header-text-group">
              <h2 className="table-title">Financial Transaction History</h2>
              <p className="table-subtitle">
                Comprehensive audit trail of your deposits, withdrawals, and internal transfers.
              </p>
            </div>

            {/* Sub-Tabs for History */}
            <div className="history-subtabs-pill">
              <button
                type="button"
                className={`subtab-btn ${historySubTab === 'DEPOSITS' ? 'active' : ''}`}
                onClick={() => setHistorySubTab('DEPOSITS')}
              >
                Deposit History
              </button>
              <button
                type="button"
                className={`subtab-btn ${historySubTab === 'WITHDRAWALS' ? 'active' : ''}`}
                onClick={() => setHistorySubTab('WITHDRAWALS')}
              >
                Withdrawal History
              </button>
              <button
                type="button"
                className={`subtab-btn ${historySubTab === 'TRANSFERS' ? 'active' : ''}`}
                onClick={() => setHistorySubTab('TRANSFERS')}
              >
                Internal Transfers
              </button>
              <button
                className="btn-refresh-sub"
                onClick={() => {
                  if (historySubTab === 'DEPOSITS') loadDepositHistory();
                  else if (historySubTab === 'WITHDRAWALS') loadWithdrawalHistory();
                  else if (historySubTab === 'TRANSFERS') loadTransferHistory();
                }}
                title="Refresh current list"
              >
                🔄 Refresh
              </button>
            </div>
          </div>

          {/* SUBTAB 1: DEPOSITS */}
          {historySubTab === 'DEPOSITS' && (
            <div className="table-wrapper">
              <table className="assets-table history-table">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Asset</th>
                    <th>Network</th>
                    <th>Destination Address</th>
                    <th>Amount</th>
                    <th>Confirmations</th>
                    <th>Status</th>
                    <th>Tx Hash</th>
                  </tr>
                </thead>
                <tbody>
                  {loadingHistory ? (
                    <tr>
                      <td colSpan="8" className="text-center empty-cell">
                        Loading deposit history...
                      </td>
                    </tr>
                  ) : userDeposits.length === 0 ? (
                    <tr>
                      <td colSpan="8" className="text-center empty-cell">
                        No blockchain deposits recorded yet.
                      </td>
                    </tr>
                  ) : (
                    userDeposits.map((d) => (
                      <tr key={d.uuid} className="history-row">
                        <td className="time-cell">
                          {d.created_at ? new Date(d.created_at).toLocaleString() : '—'}
                        </td>
                        <td className="coin-cell">
                          <span className="coin-pill">{d.currency}</span>
                        </td>
                        <td className="network-cell">
                          <span className="network-pill-sm">{d.network}</span>
                        </td>
                        <td className="address-cell">
                          <AddressWithCopy address={d.to_address} />
                        </td>
                        <td className="number-cell font-bold text-success">
                          +{parseFloat(d.amount).toFixed(4)}
                        </td>
                        <td className="number-cell text-muted">
                          {d.confirmations} / {d.required_confirmations}
                        </td>
                        <td>
                          <span className={`status-badge status-${(d.status || '').toLowerCase()}`}>
                            {d.status}
                          </span>
                        </td>
                        <td className="details-cell">
                          {d.tx_hash ? (
                            <AddressWithCopy address={d.tx_hash} prefixLength={8} suffixLength={6} />
                          ) : (
                            <span className="text-dim">—</span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* SUBTAB 2: WITHDRAWALS */}
          {historySubTab === 'WITHDRAWALS' && (
            <div className="table-wrapper">
              <table className="assets-table history-table">
                <thead>
                  <tr>
                    <th>Request Time</th>
                    <th>Asset</th>
                    <th>Network</th>
                    <th>Destination Address</th>
                    <th>Amount</th>
                    <th>Fee</th>
                    <th>Net Received</th>
                    <th>Status</th>
                    <th>Review Details / Tx</th>
                  </tr>
                </thead>
                <tbody>
                  {loadingHistory ? (
                    <tr>
                      <td colSpan="9" className="text-center empty-cell">
                        Loading withdrawal history...
                      </td>
                    </tr>
                  ) : userWithdrawals.length === 0 ? (
                    <tr>
                      <td colSpan="9" className="text-center empty-cell">
                        No withdrawal requests recorded yet.
                      </td>
                    </tr>
                  ) : (
                    userWithdrawals.map((w) => (
                      <tr key={w.uuid} className="history-row">
                        <td className="time-cell">
                          {w.created_at ? new Date(w.created_at).toLocaleString() : '—'}
                        </td>
                        <td className="coin-cell">
                          <span className="coin-pill">{w.currency}</span>
                        </td>
                        <td className="network-cell">
                          <span className="network-pill-sm">{w.network}</span>
                        </td>
                        <td className="address-cell">
                          <AddressWithCopy address={w.to_address} />
                        </td>
                        <td className="number-cell">{parseFloat(w.amount).toFixed(4)}</td>
                        <td className="number-cell text-muted">{parseFloat(w.fee).toFixed(4)}</td>
                        <td className="number-cell font-bold text-success">
                          {parseFloat(w.net_amount).toFixed(4)}
                        </td>
                        <td>
                          <span className={`status-badge status-${(w.status || '').toLowerCase()}`}>
                            {w.status}
                          </span>
                        </td>
                        <td className="details-cell">
                          {w.status === 'REJECTED' && (
                            <div className="rejection-box" title={w.rejection_reason || 'Rejection reason'}>
                              <span className="rejection-label">Rejected:</span>
                              <span className="rejection-text">{w.rejection_reason || 'Compliance policy review'}</span>
                            </div>
                          )}
                          {w.status === 'COMPLETED' && w.tx_hash && (
                            <AddressWithCopy address={w.tx_hash} prefixLength={8} suffixLength={6} />
                          )}
                          {w.status === 'PENDING_APPROVAL' && (
                            <span className="text-dim text-sm">Under Compliance Review</span>
                          )}
                          {w.status === 'APPROVED' && (
                            <span className="text-success text-sm">Approved (Queued on Chain)</span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* SUBTAB 3: INTERNAL TRANSFERS */}
          {historySubTab === 'TRANSFERS' && (
            <div className="table-wrapper">
              <table className="assets-table history-table">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Type</th>
                    <th>Counterparty</th>
                    <th>Asset</th>
                    <th>Amount</th>
                    <th>Note / Memo</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {loadingHistory ? (
                    <tr>
                      <td colSpan="7" className="text-center empty-cell">
                        Loading internal transfer history...
                      </td>
                    </tr>
                  ) : userTransfers.length === 0 ? (
                    <tr>
                      <td colSpan="7" className="text-center empty-cell">
                        No internal transfers recorded yet.
                      </td>
                    </tr>
                  ) : (
                    userTransfers.map((t) => (
                      <tr key={t.uuid} className="history-row">
                        <td className="time-cell">
                          {t.created_at ? new Date(t.created_at).toLocaleString() : '—'}
                        </td>
                        <td>
                          <span className={`transfer-direction-pill ${t.direction === 'OUT' ? 'sent' : 'received'}`}>
                            {t.direction === 'OUT' ? '↗ SENT' : '↙ RECEIVED'}
                          </span>
                        </td>
                        <td className="counterparty-cell">
                          <div className="counterparty-info">
                            <span className="cp-email">{t.counterparty_email}</span>
                            <CopyButton text={t.counterparty_email} label="Copy" copiedLabel="Copied" className="btn-copy-tiny" />
                          </div>
                        </td>
                        <td className="coin-cell">
                          <span className="coin-pill">{t.currency}</span>
                        </td>
                        <td className={`number-cell font-bold ${t.direction === 'OUT' ? 'text-sell' : 'text-buy'}`}>
                          {t.direction === 'OUT' ? '-' : '+'}{parseFloat(t.amount).toFixed(4)}
                        </td>
                        <td className="memo-cell">
                          <span className="memo-text">{t.memo || '—'}</span>
                        </td>
                        <td>
                          <span className="status-badge status-completed">
                            {t.status}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* PROFILE TAB */}
      {activeTab === 'PROFILE' && (
        <div className="profile-container">
          <div className="profile-hero-card">
            <div className="profile-avatar-circle">
              {user?.name ? user.name.slice(0, 2).toUpperCase() : 'CX'}
            </div>
            <div className="profile-hero-details">
              <div className="profile-name-row">
                <h2 className="profile-name">{user?.name || 'CEX Account'}</h2>
                <span className={`profile-role-badge ${isAdmin ? 'admin-badge' : 'trader-badge'}`}>
                  {isAdmin ? '🛡️ Super Administrator' : '✓ Verified Trader'}
                </span>
                <span className="profile-status-badge">Active</span>
              </div>
              <p className="profile-hero-sub">
                Official CEX cryptographic account and compliance identity.
              </p>
            </div>
          </div>

          {/* Administrator Restriction Alert Banner */}
          {isAdmin && (
            <div className="admin-profile-alert">
              <div className="alert-icon">⚠️</div>
              <div className="alert-content">
                <h4>Administrator Account Restrictions Active</h4>
                <p>
                  This account has administrator privileges. In accordance with platform security protocols and strict separation of powers, <strong>administrator accounts are strictly prohibited from trading in spot markets, initiating cryptocurrency deposits, or executing withdrawals</strong>.
                </p>
                <div className="alert-guideline">
                  To perform trading or financial transactions, please switch to or register a standard trader account.
                </div>
              </div>
            </div>
          )}

          {/* Profile Details Grid */}
          <div className="profile-details-grid">
            <div className="profile-card">
              <h3 className="card-section-title">Account Identifiers</h3>
              <div className="profile-item-row">
                <span className="item-label">User ID (Internal):</span>
                <div className="item-value-with-copy">
                  <span className="item-val-highlight">#{user?.id}</span>
                  <CopyButton text={String(user?.id)} label="Copy ID" copiedLabel="Copied!" className="btn-copy-tiny" />
                </div>
              </div>
              <div className="profile-item-row">
                <span className="item-label">Email Address:</span>
                <div className="item-value-with-copy">
                  <span className="item-val-text">{user?.email}</span>
                  <CopyButton text={user?.email || ''} label="Copy Email" copiedLabel="Copied!" className="btn-copy-tiny" />
                </div>
              </div>
              <div className="profile-item-row">
                <span className="item-label">User Role:</span>
                <span className="item-val-text font-bold">{user?.role || 'TRADER'}</span>
              </div>
              <div className="profile-item-row">
                <span className="item-label">Account Status:</span>
                <span className="item-val-text text-success font-bold">{user?.status || 'ACTIVE'}</span>
              </div>
            </div>

            <div className="profile-card">
              <h3 className="card-section-title">Compliance & Security Privileges</h3>
              <div className="profile-item-row">
                <span className="item-label">KYC Verification:</span>
                <span className="item-val-badge">Level {user?.kyc_level || 2} (Enhanced Due Diligence)</span>
              </div>
              <div className="profile-item-row">
                <span className="item-label">Spot Trading:</span>
                <span className={`item-val-text ${isAdmin ? 'text-sell font-bold' : 'text-buy font-bold'}`}>
                  {isAdmin ? '❌ Restricted (Admin Account)' : '✓ Enabled'}
                </span>
              </div>
              <div className="profile-item-row">
                <span className="item-label">On-Chain Deposits:</span>
                <span className={`item-val-text ${isAdmin ? 'text-sell font-bold' : 'text-buy font-bold'}`}>
                  {isAdmin ? '❌ Restricted (Admin Account)' : '✓ Enabled (Multi-Chain)'}
                </span>
              </div>
              <div className="profile-item-row">
                <span className="item-label">On-Chain Withdrawals:</span>
                <span className={`item-val-text ${isAdmin ? 'text-sell font-bold' : 'text-buy font-bold'}`}>
                  {isAdmin ? '❌ Restricted (Admin Account)' : '✓ Enabled (Up to $500,000 / day)'}
                </span>
              </div>
              <div className="profile-item-row">
                <span className="item-label">Internal CEX Transfers:</span>
                <span className={`item-val-text ${isAdmin ? 'text-sell font-bold' : 'text-buy font-bold'}`}>
                  {isAdmin ? '❌ Restricted (Admin Account)' : '✓ Enabled (0% Fee, Instant)'}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
