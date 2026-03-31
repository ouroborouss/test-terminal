import { useRef, useEffect } from 'react';

export interface PnlCardData {
  symbol: string;
  exchange: string;
  side: 'long' | 'short';
  size: number;
  entryPrice: number;
  exitPrice?: number;
  currentPrice?: number;
  pnl?: number;
  isOpen: boolean;
  time?: number;
}

function drawPnlCard(canvas: HTMLCanvasElement, d: PnlCardData) {
  const ctx = canvas.getContext('2d')!;
  const W = canvas.width;
  const H = canvas.height;

  const pnl = d.pnl ?? 0;
  const isPos = pnl >= 0;
  const accent = isPos ? '#22c55e' : '#ef4444';
  const accentDim = isPos ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)';

  // Background
  ctx.fillStyle = '#0d0d0f';
  ctx.fillRect(0, 0, W, H);

  // Border
  ctx.strokeStyle = accent;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(0.75, 0.75, W - 1.5, H - 1.5);

  // Top accent line
  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, W, 3);

  // Branding
  ctx.font = '600 10px Inter, -apple-system, sans-serif';
  ctx.fillStyle = '#6b6b78';
  ctx.fillText('FD TERMINAL', 22, 30);

  ctx.textAlign = 'right';
  ctx.font = '500 10px Inter, -apple-system, sans-serif';
  ctx.fillText(d.isOpen ? 'OPEN POSITION' : 'TRADE', W - 22, 30);
  ctx.textAlign = 'left';

  // Symbol
  ctx.font = 'bold 40px Inter, -apple-system, sans-serif';
  ctx.fillStyle = '#e8e8ea';
  ctx.fillText(d.symbol, 22, 88);

  // Side badge
  const sideText = d.side.toUpperCase();
  ctx.font = 'bold 11px Inter, -apple-system, sans-serif';
  const badgeW = ctx.measureText(sideText).width + 16;
  const badgeX = W - badgeW - 22;
  ctx.fillStyle = accentDim;
  ctx.fillRect(badgeX, 63, badgeW, 22);
  ctx.fillStyle = accent;
  ctx.fillText(sideText, badgeX + 8, 77);

  // Separator
  ctx.fillStyle = '#2a2a30';
  ctx.fillRect(22, 103, W - 44, 1);

  // Labels
  ctx.font = '400 11px Inter, -apple-system, sans-serif';
  ctx.fillStyle = '#6b6b78';
  ctx.fillText('Entry', 22, 126);
  ctx.fillText(d.isOpen ? 'Current' : 'Exit', 170, 126);
  ctx.fillText('Size', 318, 126);

  // Values
  const fmt = (n: number) =>
    n >= 1 ? `$${n.toLocaleString('en', { maximumFractionDigits: 4 })}` : `$${n.toPrecision(4)}`;

  ctx.font = '600 13px "JetBrains Mono", "Courier New", monospace';
  ctx.fillStyle = '#e8e8ea';
  ctx.fillText(fmt(d.entryPrice), 22, 149);
  const secondPx = d.exitPrice ?? d.currentPrice;
  ctx.fillText(secondPx ? fmt(secondPx) : '—', 170, 149);
  ctx.fillText(String(d.size), 318, 149);

  // PnL strip
  ctx.fillStyle = accentDim;
  ctx.fillRect(0, 165, W, 58);

  // PnL amount
  const pnlStr = `${isPos ? '+' : ''}$${Math.abs(pnl).toFixed(2)}`;
  ctx.font = 'bold 32px "JetBrains Mono", "Courier New", monospace';
  ctx.fillStyle = accent;
  ctx.fillText(pnlStr, 22, 207);

  // PnL percentage
  if (d.entryPrice && secondPx) {
    const pct = ((secondPx - d.entryPrice) / d.entryPrice) * 100 * (d.side === 'long' ? 1 : -1);
    const pctStr = `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
    ctx.font = '600 16px "JetBrains Mono", "Courier New", monospace';
    ctx.textAlign = 'right';
    ctx.fillText(pctStr, W - 22, 207);
    ctx.textAlign = 'left';
  }

  // Footer
  ctx.fillStyle = '#2a2a30';
  ctx.fillRect(0, 224, W, 1);

  ctx.font = '400 11px Inter, -apple-system, sans-serif';
  ctx.fillStyle = '#6b6b78';
  const date = new Date(d.time ?? Date.now()).toLocaleDateString('en', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
  ctx.fillText(`${d.exchange.toUpperCase()}  ·  ${date}`, 22, 249);
}

export function PnlCard({ data, onClose }: { data: PnlCardData; onClose: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (canvasRef.current) drawPnlCard(canvasRef.current, data);
  }, [data]);

  const download = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const link = document.createElement('a');
    link.download = `${data.symbol}_pnl.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  };

  return (
    <div className="pnlcard-overlay" onClick={onClose}>
      <div className="pnlcard-modal" onClick={e => e.stopPropagation()}>
        <canvas ref={canvasRef} width={480} height={270} className="pnlcard-canvas" />
        <div className="pnlcard-actions">
          <button className="btn" onClick={download}>↓ Download PNG</button>
          <button className="btn-icon" onClick={onClose}>✕</button>
        </div>
      </div>
    </div>
  );
}
