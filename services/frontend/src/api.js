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
};

export const walletApi = {
  getWallets: () => apiRequest('/wallets'),
  getDepositAddress: (currency, network) => apiRequest('/wallets/deposit-address', { method: 'POST', body: JSON.stringify({ currency, network }) }),
  withdraw: (currency, network, to_address, amount) => apiRequest('/wallets/withdraw', { method: 'POST', body: JSON.stringify({ currency, network, to_address, amount }) }),
  faucet: (currency, amount) => apiRequest('/wallets/faucet', { method: 'POST', body: JSON.stringify({ currency, amount }) }),
};

export const orderApi = {
  getOrders: (symbol) => apiRequest(`/orders${symbol ? `?symbol=${symbol}` : ''}`),
  placeOrder: (orderData) => apiRequest('/orders', { method: 'POST', body: JSON.stringify(orderData) }),
  cancelOrder: (uuid) => apiRequest(`/orders/${uuid}`, { method: 'DELETE' }),
};
