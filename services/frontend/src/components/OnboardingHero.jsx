import React, { useState, useEffect } from 'react';

const ONBOARDING_SLIDES = [
  {
    tag: 'ULTRA-LOW LATENCY MATCHING',
    title: 'Sub-Millisecond In-Memory Execution',
    description:
      'Engineered with a high-throughput C++ order book utilizing Red-Black tree price levels and dual-ended priority queues. Orders execute with sub-10 microsecond latency and zero execution slippage.',
    badge: '< 10µs Order Matching',
    stat: '100,000+ TPS',
    statLabel: 'Engine Capacity',
  },
  {
    tag: 'MULTI-CHAIN NATIVE CUSTODY',
    title: 'Enterprise Cross-Chain Liquidity',
    description:
      'Direct on-chain connectivity and deterministic HD Wallet address generation supporting Bitcoin (BTC), Ethereum (ETH), Arbitrum (ARB), Polygon (MATIC), BNB Chain, and Avalanche (AVAX).',
    badge: '6+ Blockchains Connected',
    stat: '0x & Base58',
    statLabel: 'Multi-Network Native',
  },
  {
    tag: 'FINANCIAL ACCURACY GUARANTEE',
    title: 'Pessimistic-Locked Double-Entry Ledger',
    description:
      'Every satoshi and wei is strictly accounted for. Our transactional balance ledger uses database-level pessimistic locking (SELECT FOR UPDATE) to completely eliminate double-spending risks.',
    badge: 'Double-Entry Accounting',
    stat: '100% Verifiable',
    statLabel: 'Balance Integrity',
  },
];

export default function OnboardingHero({ onLoginClick, onRegisterClick }) {
  const [currentSlide, setCurrentSlide] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentSlide((prev) => (prev + 1) % ONBOARDING_SLIDES.length);
    }, 5000);
    return () => clearInterval(timer);
  }, []);

  const slide = ONBOARDING_SLIDES[currentSlide];

  return (
    <div className="onboarding-hero">
      <div className="onboarding-glow"></div>
      
      <div className="onboarding-slide-container">
        <div className="slide-content-left">
          <div className="slide-tag">
            <span className="live-dot"></span>
            <span>{slide.tag}</span>
          </div>

          <h1 className="onboarding-title">{slide.title}</h1>

          <p className="onboarding-subtitle">{slide.description}</p>

          <div className="slide-stat-row">
            <div className="stat-pill">
              <span className="stat-number">{slide.stat}</span>
              <span className="stat-caption">{slide.statLabel}</span>
            </div>
            <div className="badge-pill">
              <span className="badge-icon">🛡️</span>
              <span>{slide.badge}</span>
            </div>
          </div>

          <div className="onboarding-actions">
            <button className="btn-primary-glow" onClick={onLoginClick}>
              Sign In to Trade
            </button>
            <button className="btn-outline-glow" onClick={onRegisterClick}>
              Create Account
            </button>
          </div>

          {/* Slide Indicator Dots */}
          <div className="slide-dots-wrapper">
            {ONBOARDING_SLIDES.map((_, idx) => (
              <button
                key={idx}
                type="button"
                className={`slide-dot ${currentSlide === idx ? 'active' : ''}`}
                onClick={() => setCurrentSlide(idx)}
                aria-label={`Slide ${idx + 1}`}
              />
            ))}
          </div>
        </div>

        <div className="slide-visual-right">
          <div className="engine-architecture-card">
            <div className="card-top-header">
              <span className="traffic-dot red"></span>
              <span className="traffic-dot yellow"></span>
              <span className="traffic-dot green"></span>
              <span className="terminal-title">engine://matching-core:active</span>
            </div>
            <div className="card-terminal-body">
              <div className="term-line"><span className="term-kw">STATUS:</span> <span className="term-ok">OPTIMAL</span></div>
              <div className="term-line"><span className="term-kw">L2 DEPTH:</span> <span>RED-BLACK MAP ACTIVE</span></div>
              <div className="term-line"><span className="term-kw">NETWORKS:</span> <span>BTC | ETH | ARB | MATIC | BNB | AVAX</span></div>
              <div className="term-line"><span className="term-kw">SETTLEMENT:</span> <span>LARAVEL OCTANE + REDIS</span></div>
              <div className="term-line highlight"><span className="term-kw">&gt;&gt;</span> <span>ORDER PIPELINE READY FOR TRADING</span></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
