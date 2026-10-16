import React, { useState, useEffect, useRef } from 'react';
import { marketApi } from '../api';

export const TIMEFRAME_OPTIONS = [
  { key: '1m', label: '1m', value: '1m', desc: '1 Minute' },
  { key: '5m', label: '5m', value: '5m', desc: '5 Minutes' },
  { key: '15m', label: '15m', value: '15m', desc: '15 Minutes' },
  { key: '30m', label: '30m', value: '30m', desc: '30 Minutes' },
  { key: '1j', label: '1j', value: '1j', desc: '1 Jam (1 Hour)' },
  { key: '4j', label: '4j', value: '4j', desc: '4 Jam (4 Hours)' },
  { key: '1d', label: '1d', value: '1d', desc: '1 Day' },
  { key: '1w', label: '1w', desc: '1 Week' },
  { key: '1M', label: '1m (Bulan)', value: '1M', desc: '1 Month' },
  { key: '1y', label: '1y', value: '1y', desc: '1 Year' },
];

export default function CandlestickChart({ symbol, currentPrice }) {
  const [selectedTimeframe, setSelectedTimeframe] = useState('15m');
  const [candles, setCandles] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hoveredCandle, setHoveredCandle] = useState(null);

  const canvasRef = useRef(null);
  const containerRef = useRef(null);

  // Load candles whenever symbol or timeframe changes
  useEffect(() => {
    loadCandles();
  }, [symbol, selectedTimeframe]);

  // Periodic polling for fresh candles
  useEffect(() => {
    const timer = setInterval(() => {
      loadCandles(false);
    }, 4000);
    return () => clearInterval(timer);
  }, [symbol, selectedTimeframe]);

  async function loadCandles(showSpinner = true) {
    if (showSpinner) setIsLoading(true);
    try {
      const res = await marketApi.getCandles(symbol, selectedTimeframe, 80);
      if (res.success && res.data && res.data.candles) {
        setCandles(res.data.candles);
      }
    } catch (err) {
      console.warn('Failed to load candles:', err);
    } finally {
      if (showSpinner) setIsLoading(false);
    }
  }

  // Draw Candlestick & Volume Chart on Canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || candles.length === 0) return;

    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const width = container.clientWidth;
    const height = container.clientHeight;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    ctx.scale(dpr, dpr);

    // Layout configuration
    const paddingRight = 65; // Price axis on right
    const paddingBottom = 26; // Timestamp axis
    const paddingTop = 28; // Header info
    const plotWidth = width - paddingRight;
    const plotHeight = height - paddingBottom - paddingTop;

    const candlePlotHeight = plotHeight * 0.76;
    const volumePlotHeight = plotHeight * 0.22;
    const volumeTop = paddingTop + candlePlotHeight + 6;

    // Clear background
    ctx.fillStyle = '#0c1017';
    ctx.fillRect(0, 0, width, height);

    // Calculate Min & Max for Price and Volume
    let minPrice = Infinity;
    let maxPrice = -Infinity;
    let maxVolume = 0.0001;

    candles.forEach((c) => {
      if (c.low < minPrice) minPrice = c.low;
      if (c.high > maxPrice) maxPrice = c.high;
      if (c.volume > maxVolume) maxVolume = c.volume;
    });

    // Add 2% padding to price range
    const priceRange = Math.max(maxPrice - minPrice, maxPrice * 0.005);
    minPrice -= priceRange * 0.02;
    maxPrice += priceRange * 0.02;

    const numCandles = candles.length;
    const candleSlotWidth = plotWidth / numCandles;
    const candleBodyWidth = Math.max(2, candleSlotWidth * 0.7);

    // Gridlines (Horizontal Price lines)
    ctx.strokeStyle = '#1b2333';
    ctx.lineWidth = 1;
    ctx.font = '10px JetBrains Mono, monospace';
    ctx.fillStyle = '#64748b';

    const numPriceLines = 5;
    for (let i = 0; i <= numPriceLines; i++) {
      const p = minPrice + (priceRange / numPriceLines) * i;
      const y = paddingTop + candlePlotHeight - ((p - minPrice) / priceRange) * candlePlotHeight;

      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(plotWidth, y);
      ctx.stroke();

      // Price label on right
      ctx.textAlign = 'left';
      ctx.fillText(
        p > 100 ? p.toFixed(2) : p.toFixed(4),
        plotWidth + 8,
        y + 3
      );
    }

    // Grid separator for Volume sub-panel
    ctx.beginPath();
    ctx.moveTo(0, volumeTop - 4);
    ctx.lineTo(plotWidth, volumeTop - 4);
    ctx.stroke();

    // Draw Candles & Volume Bars
    candles.forEach((c, i) => {
      const x = i * candleSlotWidth + candleSlotWidth / 2;
      const isUp = c.close >= c.open;
      const color = isUp ? '#0ecb81' : '#f6465d';

      // 1. Candlestick Wick (High to Low)
      const yHigh = paddingTop + candlePlotHeight - ((c.high - minPrice) / priceRange) * candlePlotHeight;
      const yLow = paddingTop + candlePlotHeight - ((c.low - minPrice) / priceRange) * candlePlotHeight;

      ctx.strokeStyle = color;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(x, yHigh);
      ctx.lineTo(x, yLow);
      ctx.stroke();

      // 2. Candlestick Body (Open to Close)
      const yOpen = paddingTop + candlePlotHeight - ((c.open - minPrice) / priceRange) * candlePlotHeight;
      const yClose = paddingTop + candlePlotHeight - ((c.close - minPrice) / priceRange) * candlePlotHeight;
      const bodyTop = Math.min(yOpen, yClose);
      const bodyHeight = Math.max(1.5, Math.abs(yClose - yOpen));

      ctx.fillStyle = color;
      ctx.fillRect(x - candleBodyWidth / 2, bodyTop, candleBodyWidth, bodyHeight);

      // 3. Volume Bar
      const vHeight = (c.volume / maxVolume) * volumePlotHeight;
      const vY = volumeTop + volumePlotHeight - vHeight;
      ctx.fillStyle = isUp ? 'rgba(14, 203, 129, 0.35)' : 'rgba(246, 70, 93, 0.35)';
      ctx.fillRect(x - candleBodyWidth / 2, vY, candleBodyWidth, vHeight);

      // Timestamp markings at interval
      if (i % Math.max(1, Math.floor(numCandles / 6)) === 0) {
        ctx.fillStyle = '#64748b';
        ctx.textAlign = 'center';
        const d = new Date(c.time * 1000);
        let timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        if (['1d', '1w', '1M', '1y'].includes(selectedTimeframe)) {
          timeStr = `${d.getMonth() + 1}/${d.getDate()}`;
        }
        ctx.fillText(timeStr, x, height - 8);
      }
    });

    // Draw Current Price Line
    const activePrice = parseFloat(currentPrice) || (candles[candles.length - 1]?.close ?? 0);
    if (activePrice >= minPrice && activePrice <= maxPrice) {
      const activeY = paddingTop + candlePlotHeight - ((activePrice - minPrice) / priceRange) * candlePlotHeight;

      ctx.strokeStyle = 'rgba(59, 130, 246, 0.7)';
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(0, activeY);
      ctx.lineTo(plotWidth, activeY);
      ctx.stroke();
      ctx.setLineDash([]);

      // Current Price Badge on Right Axis
      ctx.fillStyle = '#2563eb';
      ctx.fillRect(plotWidth + 2, activeY - 9, paddingRight - 4, 18);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 10px JetBrains Mono, monospace';
      ctx.textAlign = 'left';
      ctx.fillText(
        activePrice > 100 ? activePrice.toFixed(2) : activePrice.toFixed(4),
        plotWidth + 6,
        activeY + 3
      );
    }
  }, [candles, currentPrice, selectedTimeframe]);

  // Handle Mouse Hover / Crosshair inspection
  function handleMouseMove(e) {
    const container = containerRef.current;
    if (!container || candles.length === 0) return;

    const rect = container.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const paddingRight = 65;
    const plotWidth = container.clientWidth - paddingRight;

    if (mouseX >= 0 && mouseX <= plotWidth) {
      const candleSlotWidth = plotWidth / candles.length;
      const index = Math.min(candles.length - 1, Math.max(0, Math.floor(mouseX / candleSlotWidth)));
      setHoveredCandle(candles[index]);
    } else {
      setHoveredCandle(null);
    }
  }

  function handleMouseLeave() {
    setHoveredCandle(null);
  }

  // Active display candle (hovered or last candle)
  const displayCandle = hoveredCandle || (candles.length > 0 ? candles[candles.length - 1] : null);
  const changePct = displayCandle && displayCandle.open > 0
    ? (((displayCandle.close - displayCandle.open) / displayCandle.open) * 100).toFixed(2)
    : '0.00';
  const isUp = displayCandle ? displayCandle.close >= displayCandle.open : true;

  return (
    <div className="trading-chart-container">
      {/* Top Toolbar: Timeframe selector buttons & Live OHLCV Inspector */}
      <div className="chart-toolbar">
        <div className="timeframe-buttons-row">
          <span className="toolbar-label">Timeframe:</span>
          {TIMEFRAME_OPTIONS.map((tf) => (
            <button
              key={tf.key}
              type="button"
              className={`tf-button ${selectedTimeframe === tf.value ? 'active' : ''}`}
              onClick={() => setSelectedTimeframe(tf.value)}
              title={tf.desc}
            >
              {tf.label}
            </button>
          ))}
        </div>

        {/* Live Candle OHLCV Readout */}
        {displayCandle && (
          <div className="ohlcv-inspect-bar">
            <span className="inspect-item">
              <span className="lbl">O:</span>
              <span className="val">{displayCandle.open > 100 ? displayCandle.open.toFixed(2) : displayCandle.open.toFixed(4)}</span>
            </span>
            <span className="inspect-item">
              <span className="lbl">H:</span>
              <span className="val">{displayCandle.high > 100 ? displayCandle.high.toFixed(2) : displayCandle.high.toFixed(4)}</span>
            </span>
            <span className="inspect-item">
              <span className="lbl">L:</span>
              <span className="val">{displayCandle.low > 100 ? displayCandle.low.toFixed(2) : displayCandle.low.toFixed(4)}</span>
            </span>
            <span className="inspect-item">
              <span className="lbl">C:</span>
              <span className={`val ${isUp ? 'text-buy' : 'text-sell'}`}>
                {displayCandle.close > 100 ? displayCandle.close.toFixed(2) : displayCandle.close.toFixed(4)}
              </span>
            </span>
            <span className="inspect-item">
              <span className="lbl">Vol:</span>
              <span className="val">{displayCandle.volume.toFixed(2)}</span>
            </span>
            <span className={`inspect-change-badge ${isUp ? 'change-up' : 'change-down'}`}>
              {isUp ? '+' : ''}{changePct}%
            </span>
          </div>
        )}
      </div>

      {/* Chart Canvas Area */}
      <div
        className="canvas-interactive-wrapper"
        ref={containerRef}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        {isLoading && (
          <div className="chart-loading-overlay">
            <div className="spinner"></div>
            <span>Updating {selectedTimeframe} chart...</span>
          </div>
        )}
        <canvas ref={canvasRef} className="candlestick-canvas" />
      </div>
    </div>
  );
}
