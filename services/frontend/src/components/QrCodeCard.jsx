import React, { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';

export default function QrCodeCard({ address, network, currency }) {
  const canvasRef = useRef(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (canvasRef.current && address) {
      QRCode.toCanvas(
        canvasRef.current,
        address,
        {
          width: 180,
          margin: 1,
          color: {
            dark: '#0b0e14',
            light: '#ffffff',
          },
        },
        (error) => {
          if (error) console.error('QR code render error:', error);
        }
      );
    }
  }, [address]);

  const handleCopy = () => {
    if (!address) return;
    navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="qr-container">
      <div className="qr-canvas-wrapper">
        <canvas ref={canvasRef} className="qr-canvas" />
      </div>
      <div className="qr-info">
        <div className="qr-badge">
          <span className="network-pill">{network}</span>
          <span className="currency-pill">{currency}</span>
        </div>
        <div className="address-box">
          <span className="address-text">{address}</span>
          <button type="button" className={`btn-copy ${copied ? 'copied' : ''}`} onClick={handleCopy}>
            {copied ? '✓ Copied' : 'Copy Address'}
          </button>
        </div>
        <p className="qr-caption">Scan this barcode with your mobile wallet app</p>
      </div>
    </div>
  );
}
