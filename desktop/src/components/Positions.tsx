import { useState } from 'react';
import { useStore, TradeEntry } from '../store';
import { useSettings } from '../settings';
import { PnlCard, PnlCardData } from './PnlCard';
import { Balances } from './Balances';

function fmtFundingPayout(pos: { size: number; current_price?: number; entry_price: number; side: 'long' | 'short' }, rate: number | undefined) {
  if (rate == null) return '—';
  const posVal = pos.size * (pos.current_price ?? pos.entry_price);
  // Positive rate → longs pay shorts (negative for longs). Negative rate → shorts pay longs.
  const payout = posVal * rate * (pos.side === 'long' ? -1 : 1);
  const color = payout >= 0 ? 'var(--green)' : 'var(--red)';
  return <span style={{ color }}>{payout >= 0 ? '+' : ''}${payout.toFixed(3)}/8h</span>;
}

function fmt(price: number) {
  if (price === 0) return '—';
  if (price >= 1) return `$${price.toLocaleString(undefined, { maximumFractionDigits: 4 })}`;
  return `$${price.toPrecision(4)}`;
}

function TpSlForm({ posId, coin, size, side, currentPrice }: { posId: number; coin: string; size: number; side: 'long' | 'short'; currentPrice?: number }) {
  const prices = useStore(s => s.prices);
  const [tp, setTp] = useState('');
  const [sl, setSl] = useState('');
  const [status, setStatus] = useState<string | null>(null);

  const sendTpSl = async (tpsl: 'tp' | 'sl', px: string) => {
    const triggerPx = parseFloat(px);
    if (!triggerPx) return;
    setStatus('Setting...');
    try {
      const res = await fetch('http://localhost:3000/order/hyperliquid/tpsl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ coin, isBuy: side === 'short', sz: size, triggerPx, tpsl }),
      });
      const data = await res.json();
      if (res.ok) { setStatus(`${tpsl.toUpperCase()} set`); if (tpsl === 'tp') setTp(''); else setSl(''); }
      else setStatus(`Error: ${data.error}`);
    } catch { setStatus('Failed'); }
    setTimeout(() => setStatus(null), 3000);
  };

  const sendLimitClose = async () => {
    const px = prices[coin] ?? prices[coin + 'USDT'] ?? currentPrice;
    if (!px) { setStatus('No price data'); setTimeout(() => setStatus(null), 2000); return; }
    setStatus('Closing...');
    try {
      const res = await fetch('http://localhost:3000/order/hyperliquid', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ coin, isBuy: side === 'short', sz: size, limitPx: px, orderType: 'limit', reduceOnly: true }),
      });
      const data = await res.json();
      if (res.ok) setStatus(`Limit close @ $${px.toLocaleString()}`);
      else setStatus(`Error: ${data.error}`);
    } catch { setStatus('Failed'); }
    setTimeout(() => setStatus(null), 3000);
  };

  return (
    <tr key={`tpsl-${posId}`} className="tpsl-row">
      <td colSpan={11}>
        <div className="tpsl-form">
          <div className="tpsl-field">
            <span className="tpsl-label tp">TP</span>
            <input className="tpsl-input" value={tp} onChange={e => setTp(e.target.value)} placeholder="Price" type="number" />
            <button className="tpsl-set" onClick={() => sendTpSl('tp', tp)}>Set</button>
          </div>
          <div className="tpsl-field">
            <span className="tpsl-label sl">SL</span>
            <input className="tpsl-input" value={sl} onChange={e => setSl(e.target.value)} placeholder="Price" type="number" />
            <button className="tpsl-set" onClick={() => sendTpSl('sl', sl)}>Set</button>
          </div>
          <div className="tpsl-field">
            <button className="tpsl-set tpsl-lmt-close" onClick={sendLimitClose}>
              Limit Close{prices[coin] ?? prices[coin + 'USDT'] ? ` @ $${(prices[coin] ?? prices[coin + 'USDT'])!.toLocaleString(undefined, { maximumFractionDigits: 4 })}` : ''}
            </button>
          </div>
          {status && <span className="tpsl-status">{status}</span>}
        </div>
      </td>
    </tr>
  );
}

function sideClass(entry: TradeEntry) {
  if (entry.isClose) return 'trade-close';
  return `side ${entry.side}`;
}

function sideLabel(entry: TradeEntry) {
  if (entry.isClose) return 'CLOSE';
  return entry.side.toUpperCase();
}

function PnlCell({ pnl }: { pnl?: number }) {
  if (pnl == null) return <td>—</td>;
  return (
    <td className={pnl >= 0 ? 'pnl-positive' : 'pnl-negative'}>
      {pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}
    </td>
  );
}

export function Positions() {
  const { positions, testPositions, clearTestPositions, fundingRates, tradeHistory, twapJobs, removeTwapJob, setSelectedSymbol, hlOrders, hlFills } = useStore();
  const testMode = useSettings(s => s.testMode);
  const [tab, setTab] = useState<'open' | 'orders' | 'history' | 'balances'>('open');
  const [expandedTpSl, setExpandedTpSl] = useState<number | null>(null);
  const [shareData, setShareData] = useState<PnlCardData | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const all = [...testPositions, ...positions];
  const [closingId, setClosingId] = useState<number | null>(null);

  const toggleCollapse = (group: string) =>
    setCollapsed(prev => { const n = new Set(prev); n.has(group) ? n.delete(group) : n.add(group); return n; });

  const cryptoPositions = all.filter(p => p.market === 'crypto' || p.exchange === 'hyperliquid' || p.exchange?.toLowerCase().includes('binance') || p.exchange?.toLowerCase().includes('test'));
  const stockPositions  = all.filter(p => p.market === 'stock'  || p.exchange === 'ibkr');

  const closeIbkr = async (pos: typeof positions[0]) => {
    setClosingId(pos.id);
    try {
      await fetch('http://localhost:3000/order/ibkr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: pos.symbol,
          side: pos.side === 'long' ? 'SELL' : 'BUY',
          orderType: 'MARKET',
          quantity: pos.size,
          tif: 'DAY',
        }),
      });
    } catch {}
    setClosingId(null);
  };

  const cancelTwap = async (jobId: string) => {
    try {
      await fetch(`http://localhost:3000/order/twap/${jobId}`, { method: 'DELETE' });
      removeTwapJob(jobId);
    } catch {}
  };

  return (
    <div className="positions">
      <div className="panel-header">
        <div className="positions-tabs">
          <button
            className={`positions-tab ${tab === 'open' ? 'active' : ''}`}
            onClick={() => setTab('open')}
          >Positions{all.length > 0 ? ` (${all.length})` : ''}</button>
          <button
            className={`positions-tab ${tab === 'orders' ? 'active' : ''}`}
            onClick={() => setTab('orders')}
          >Orders{twapJobs.length > 0 ? ` (${twapJobs.length})` : ''}</button>
          <button
            className={`positions-tab ${tab === 'history' ? 'active' : ''}`}
            onClick={() => setTab('history')}
          >History{tradeHistory.length > 0 ? ` (${tradeHistory.length})` : ''}</button>
          <button
            className={`positions-tab ${tab === 'balances' ? 'active' : ''}`}
            onClick={() => setTab('balances')}
          >Balances</button>
        </div>
        {tab === 'open' && testPositions.length > 0 && (
          <button className="positions-clear-test" onClick={clearTestPositions} title="Clear test positions">
            clear test
          </button>
        )}
      </div>

      {tab === 'open' && (
        <div className="positions-open">
          {/* ── Stocks ─────────────────────────────────────────────────── */}
          {stockPositions.length > 0 && (
            <>
              <div className="pos-group-header" onClick={() => toggleCollapse('stocks')}>
                <span className="pos-group-arrow">{collapsed.has('stocks') ? '▶' : '▼'}</span>
                <span className="pos-group-label">Stocks</span>
                <span className="pos-group-count">{stockPositions.length}</span>
              </div>
              {!collapsed.has('stocks') && (
                <table className="positions-table">
                  <thead>
                    <tr>
                      <th>Symbol</th>
                      <th>Exchange</th>
                      <th>Side</th>
                      <th>Size</th>
                      <th>Entry</th>
                      <th>Current</th>
                      <th>PnL</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {stockPositions.map(pos => {
                      const isTest = testPositions.some(t => t.id === pos.id);
                      return (
                        <tr key={pos.id} className={isTest ? 'position-test' : ''}>
                          <td className="symbol pos-symbol-link" onClick={() => setSelectedSymbol({ symbol: pos.symbol, market: 'stock' })} title={`Load ${pos.symbol} chart`}>
                            {pos.symbol}{isTest && <span className="test-badge">TEST</span>}
                          </td>
                          <td className="exchange">{pos.exchange}</td>
                          <td className={`side ${pos.side}`}>{pos.side.toUpperCase()}</td>
                          <td>{pos.size}</td>
                          <td>{fmt(pos.entry_price)}</td>
                          <td>{pos.current_price != null ? fmt(pos.current_price) : '—'}</td>
                          <PnlCell pnl={pos.pnl} />
                          <td className="pos-actions">
                            <button className="tpsl-btn tpsl-close" onClick={() => closeIbkr(pos)} disabled={closingId === pos.id}>
                              {closingId === pos.id ? '...' : 'Close'}
                            </button>
                            {!isTest && (
                              <button className="tpsl-btn" onClick={() => setShareData({
                                symbol: pos.symbol, exchange: pos.exchange, side: pos.side,
                                size: pos.size, entryPrice: pos.entry_price,
                                currentPrice: pos.current_price, pnl: pos.pnl, isOpen: true, time: Date.now(),
                              })}>Share</button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </>
          )}

          {/* ── Separator ──────────────────────────────────────────────── */}
          {stockPositions.length > 0 && cryptoPositions.length > 0 && (
            <div className="pos-section-divider" />
          )}

          {/* ── Crypto ─────────────────────────────────────────────────── */}
          {cryptoPositions.length > 0 && (
            <>
              <div className="pos-group-header" onClick={() => toggleCollapse('crypto')}>
                <span className="pos-group-arrow">{collapsed.has('crypto') ? '▶' : '▼'}</span>
                <span className="pos-group-label">Crypto</span>
                <span className="pos-group-count">{cryptoPositions.length}</span>
              </div>
              {!collapsed.has('crypto') && (
                <table className="positions-table">
                  <thead>
                    <tr>
                      <th>Symbol</th>
                      <th>Exchange</th>
                      <th>Side</th>
                      <th>Size</th>
                      <th>Entry</th>
                      <th>Current</th>
                      <th>Liq.</th>
                      <th>Funding</th>
                      <th>PnL</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {cryptoPositions.map(pos => {
                      const isTest = testPositions.some(t => t.id === pos.id);
                      const isHl = pos.exchange === 'hyperliquid' && !isTest;
                      const expanded = expandedTpSl === pos.id;
                      return (
                        <>
                          <tr key={pos.id} className={isTest ? 'position-test' : ''}>
                            <td className="symbol pos-symbol-link" onClick={() => setSelectedSymbol({ symbol: pos.symbol, market: 'crypto' })} title={`Load ${pos.symbol} chart`}>
                              {pos.symbol}{isTest && <span className="test-badge">TEST</span>}
                            </td>
                            <td className="exchange">{pos.exchange}</td>
                            <td className={`side ${pos.side}`}>{pos.side.toUpperCase()}</td>
                            <td>{pos.size}</td>
                            <td>{fmt(pos.entry_price)}</td>
                            <td>{pos.current_price != null ? fmt(pos.current_price) : '—'}</td>
                            <td className={pos.liquidation_price ? 'liq-price' : ''}>{pos.liquidation_price ? fmt(pos.liquidation_price) : '—'}</td>
                            <td>{fmtFundingPayout(pos, fundingRates[pos.symbol])}</td>
                            <PnlCell pnl={pos.pnl} />
                            <td className="pos-actions">
                              {isHl && (
                                <button className={`tpsl-btn ${expanded ? 'active' : ''}`} onClick={() => setExpandedTpSl(expanded ? null : pos.id)}>TP/SL</button>
                              )}
                              {!isTest && (
                                <button className="tpsl-btn" onClick={() => setShareData({
                                  symbol: pos.symbol, exchange: pos.exchange, side: pos.side,
                                  size: pos.size, entryPrice: pos.entry_price,
                                  currentPrice: pos.current_price, pnl: pos.pnl, isOpen: true, time: Date.now(),
                                })}>Share</button>
                              )}
                            </td>
                          </tr>
                          {isHl && expanded && (
                            <TpSlForm posId={pos.id} coin={pos.symbol} size={pos.size} side={pos.side} currentPrice={pos.current_price} />
                          )}
                        </>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </>
          )}

          {all.length === 0 && (
            <div className="positions-empty">{testMode ? 'Fire a test trade to simulate a position' : 'No open positions'}</div>
          )}
        </div>
      )}

      {tab === 'history' && (
        <table className="positions-table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Symbol</th>
              <th>Side</th>
              <th>Size</th>
              <th>Price</th>
              <th>Direction</th>
              <th>Closed PnL</th>
              <th>Fee</th>
            </tr>
          </thead>
          <tbody>
            {hlFills.map(f => {
              const pnl = parseFloat(f.closedPnl);
              return (
                <tr key={f.tid}>
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)' }}>
                    {new Date(f.time).toLocaleTimeString()}
                  </td>
                  <td className="symbol pos-symbol-link" onClick={() => setSelectedSymbol({ symbol: f.coin, market: 'crypto' })}>{f.coin}</td>
                  <td className={`side ${f.side === 'B' ? 'long' : 'short'}`}>{f.side === 'B' ? 'BUY' : 'SELL'}</td>
                  <td>{parseFloat(f.sz).toPrecision(4)}</td>
                  <td>{fmt(parseFloat(f.px))}</td>
                  <td style={{ color: 'var(--text-muted)', fontSize: 11 }}>{f.dir}</td>
                  <td className={pnl !== 0 ? (pnl > 0 ? 'pnl-positive' : 'pnl-negative') : ''}>
                    {pnl !== 0 ? `${pnl > 0 ? '+' : ''}$${pnl.toFixed(2)}` : '—'}
                  </td>
                  <td style={{ color: 'var(--text-muted)', fontSize: 11 }}>${parseFloat(f.fee).toFixed(3)}</td>
                </tr>
              );
            })}
            {hlFills.length === 0 && (
              <tr><td colSpan={8} className="empty-state">No fill history</td></tr>
            )}
          </tbody>
        </table>
      )}

      {tab === 'orders' && (
        <table className="positions-table">
          <thead>
            <tr>
              <th>Symbol</th>
              <th>Side</th>
              <th>Type</th>
              <th>Size</th>
              <th>Price</th>
              <th>Filled</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {hlOrders.map(o => {
              const filled = parseFloat(o.origSz) - parseFloat(o.sz);
              const pct = parseFloat(o.origSz) > 0 ? (filled / parseFloat(o.origSz) * 100).toFixed(0) : '0';
              return (
                <tr key={o.oid}>
                  <td className="symbol pos-symbol-link" onClick={() => setSelectedSymbol({ symbol: o.coin, market: 'crypto' })}>{o.coin}</td>
                  <td className={`side ${o.side === 'B' ? 'long' : 'short'}`}>{o.side === 'B' ? 'BUY' : 'SELL'}</td>
                  <td style={{ color: 'var(--text-muted)', fontSize: 11 }}>{o.orderType} {o.reduceOnly ? '(reduce)' : ''}</td>
                  <td>{parseFloat(o.sz).toPrecision(4)}</td>
                  <td>{fmt(parseFloat(o.limitPx))}</td>
                  <td style={{ color: 'var(--text-muted)', fontSize: 11 }}>{pct}%</td>
                  <td className="pos-actions">
                    <button className="tpsl-btn tpsl-close" onClick={async () => {
                      await fetch('http://localhost:3000/order/hyperliquid/cancel', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ coin: o.coin, oid: o.oid }),
                      });
                    }}>Cancel</button>
                  </td>
                </tr>
              );
            })}
            {twapJobs.map(job => (
              <tr key={job.jobId}>
                <td className="symbol">{job.coin}</td>
                <td className={`side ${job.isBuy ? 'long' : 'short'}`}>{job.isBuy ? 'BUY' : 'SELL'}</td>
                <td style={{ color: 'var(--text-muted)', fontSize: 11 }}>TWAP</td>
                <td>—</td>
                <td>—</td>
                <td style={{ color: 'var(--text-muted)', fontSize: 11 }}>{job.fired}/{job.totalOrders}</td>
                <td className="pos-actions">
                  <button className="tpsl-btn" onClick={() => cancelTwap(job.jobId)}>Cancel</button>
                </td>
              </tr>
            ))}
            {hlOrders.length === 0 && twapJobs.length === 0 && (
              <tr><td colSpan={7} className="empty-state">No active orders</td></tr>
            )}
          </tbody>
        </table>
      )}

      {tab === 'balances' && (
        <div style={{ flex: 1, overflow: 'auto' }}>
          <Balances />
        </div>
      )}

      {shareData && <PnlCard data={shareData} onClose={() => setShareData(null)} />}
    </div>
  );
}
