// API Client for CEX
const API_BASE = '/api/v1';

export const getAuthToken = () => localStorage.getItem('cex_token');
export const setAuthToken = (token) => {
  if (token) localStorage.setItem('cex_token', token);
  else localStorage.removeItem('cex_token');
};

export async function apiRequest(endpoint, options = {}) {
  const token = getAuthToken();
  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    ...(options.headers || {}),
  };

  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers,
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.message || data.error || `HTTP error ${response.status}`);
  }

  return data;
}

export const authApi = {
  login: (email, password) => apiRequest('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  register: (name, email, password) => apiRequest('/auth/register', { method: 'POST', body: JSON.stringify({ name, email, password }) }),
  logout: () => apiRequest('/auth/logout', { method: 'POST' }),
  me: () => apiRequest('/auth/me'),
};

export const marketApi = {
  getMarkets: () => apiRequest('/markets'),
  getDepth: (symbol) => apiRequest(`/markets/${symbol}/depth`),
  getTrades: (symbol) => apiRequest(`/markets/${symbol}/trades`),
  getCandles: (symbol, timeframe = '1m', limit = 150) =>
    apiRequest(`/markets/${symbol}/candles?timeframe=${timeframe}&limit=${limit}`),
};

export const walletApi = {
  getWallets: () => apiRequest('/wallets'),
  getUserWithdrawals: () => apiRequest('/wallets/withdrawals'),
  getUserDeposits: () => apiRequest('/wallets/deposits'),
  transferInternal: (currency, recipient, amount, memo) =>
    apiRequest('/wallets/transfer-internal', { method: 'POST', body: JSON.stringify({ currency, recipient, amount, memo }) }),
  getUserTransfers: () => apiRequest('/wallets/transfers'),
  getDepositAddress: (currency, network) => apiRequest('/wallets/deposit-address', { method: 'POST', body: JSON.stringify({ currency, network }) }),
  withdraw: (currency, network, to_address, amount) => apiRequest('/wallets/withdraw', { method: 'POST', body: JSON.stringify({ currency, network, to_address, amount }) }),
  faucet: (currency, amount) => apiRequest('/wallets/faucet', { method: 'POST', body: JSON.stringify({ currency, amount }) }),
};

export const orderApi = {
  getOrders: (symbol) => apiRequest(`/orders${symbol ? `?symbol=${symbol}` : ''}`),
  placeOrder: (orderData) => apiRequest('/orders', { method: 'POST', body: JSON.stringify(orderData) }),
  cancelOrder: (uuid) => apiRequest(`/orders/${uuid}`, { method: 'DELETE' }),
};

export const adminApi = {
  getOverview: () => apiRequest('/admin/overview'),
  getWithdrawals: (status) => apiRequest(`/admin/withdrawals${status ? `?status=${status}` : ''}`),
  approveWithdrawal: (uuid) => apiRequest(`/admin/withdrawals/${uuid}/approve`, { method: 'POST' }),
  rejectWithdrawal: (uuid, reason) => apiRequest(`/admin/withdrawals/${uuid}/reject`, { method: 'POST', body: JSON.stringify({ reason }) }),
  getTransactions: (limit) => apiRequest(`/admin/transactions${limit ? `?limit=${limit}` : ''}`),
  getUsers: () => apiRequest('/admin/users'),
  updateUserStatus: (id, status) => apiRequest(`/admin/users/${id}/status`, { method: 'POST', body: JSON.stringify({ status }) }),
  getCurrencies: () => apiRequest('/admin/currencies'),
  createCurrency: (data) => apiRequest('/admin/currencies', { method: 'POST', body: JSON.stringify(data) }),
  updateCurrency: (id, data) => apiRequest(`/admin/currencies/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteCurrency: (id) => apiRequest(`/admin/currencies/${id}`, { method: 'DELETE' }),
  getPairs: () => apiRequest('/admin/pairs'),
  createPair: (data) => apiRequest('/admin/pairs', { method: 'POST', body: JSON.stringify(data) }),
  updatePair: (id, data) => apiRequest(`/admin/pairs/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deletePair: (id) => apiRequest(`/admin/pairs/${id}`, { method: 'DELETE' }),
  updatePairFees: (id, makerFeeRate, takerFeeRate) => apiRequest(`/admin/pairs/${id}/fees`, { method: 'PUT', body: JSON.stringify({ maker_fee_rate: makerFeeRate, taker_fee_rate: takerFeeRate }) }),
};

