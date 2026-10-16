import React, { useState, useRef, useEffect } from 'react';

const COIN_ICONS = {
  BTC: '₿',
  ETH: 'Ξ',
  USDT: '₮',
  ARB: '▲',
  MATIC: '⬡',
  BNB: '◈',
  AVAX: '🔺'
};

export default function SearchableMarketSelector({ markets, selectedMarket, onSelectMarket }) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const dropdownRef = useRef(null);
  const searchInputRef = useRef(null);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Focus search input when opened
  useEffect(() => {
    if (isOpen && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [isOpen]);

  const currentPair = markets.find((m) => m.symbol === selectedMarket) || {
    symbol: selectedMarket,
    last_price: '65000.00',
  };

  const [baseCoin, quoteCoin] = selectedMarket.split('_');

  const filteredMarkets = markets.filter((m) => {
    const q = searchQuery.toLowerCase().trim();
    return m.symbol.toLowerCase().includes(q) || (m.base && m.base.toLowerCase().includes(q));
  });

  return (
    <div className="market-selector-wrapper" ref={dropdownRef}>
      <button
        type="button"
        className={`market-selector-trigger ${isOpen ? 'active' : ''}`}
        onClick={() => setIsOpen(!isOpen)}
      >
        <span className="pair-icon-badge">{COIN_ICONS[baseCoin] || '●'}</span>
        <div className="trigger-info">
          <span className="trigger-pair-title">{baseCoin}/{quoteCoin}</span>
          <span className="trigger-price">
            ${Number(currentPair.last_price || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        </div>
        <span className={`trigger-chevron ${isOpen ? 'rotated' : ''}`}>▾</span>
      </button>

      {isOpen && (
        <div className="market-dropdown-menu">
          <div className="dropdown-search-box">
            <span className="search-icon">🔍</span>
            <input
              ref={searchInputRef}
              type="text"
              className="dropdown-search-input"
              placeholder="Search coin or pair (e.g. BTC, ETH)..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button
                type="button"
                className="clear-search-btn"
                onClick={() => setSearchQuery('')}
              >
                ✕
              </button>
            )}
          </div>

          <div className="dropdown-list-header">
            <span>Market Pair</span>
            <span>Last Price (USDT)</span>
          </div>

          <div className="dropdown-items-scroll">
            {filteredMarkets.length === 0 ? (
              <div className="dropdown-empty">No trading pairs found for "{searchQuery}"</div>
            ) : (
              filteredMarkets.map((m) => {
                const [b, q] = m.symbol.split('_');
                const isSelected = m.symbol === selectedMarket;
                return (
                  <div
                    key={m.symbol}
                    className={`dropdown-pair-item ${isSelected ? 'selected' : ''}`}
                    onClick={() => {
                      onSelectMarket(m.symbol);
                      setIsOpen(false);
                      setSearchQuery('');
                    }}
                  >
                    <div className="item-pair-left">
                      <span className="item-coin-icon">{COIN_ICONS[b] || '●'}</span>
                      <div className="item-symbols">
                        <span className="item-base">{b}</span>
                        <span className="item-quote">/{q}</span>
                      </div>
                    </div>
                    <div className="item-pair-right">
                      <span className="item-price">
                        ${Number(m.last_price || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                      <span className="item-fee-pill">
                        Fee: {(parseFloat(m.maker_fee_rate || 0.001) * 100).toFixed(2)}%
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
