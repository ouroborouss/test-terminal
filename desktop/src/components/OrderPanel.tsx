import { useState, useEffect } from 'react';
import { useSettings } from '../settings';
import { useStore } from '../store';

type Exchange = 'binance' | 'hyperliquid' | 'ibkr';
type Side = 'BUY' | 'SELL';
type OrderType = 'MARKET' | 'LIMIT';
type Mode = 'order' | 'twap';

export function OrderPanel() {
  const settings = useSettings();
  const { twapJobs, removeTwapJob: removeTwapJobStore, addTradeHistory, prices } = useStore();
  const [mode, setMode] = useState<Mode>('order');
  const [exchange, setExchange] = useState<Exchange>(settings.defaultExchange as Exchange);
  const [symbol, setSymbol] = useState('');
  const [side, setSide] = useState<Side>('BUY');
  const [orderType, setOrderType] = useState<OrderType>(settings.defaultOrderType.toUpperCase() as OrderType);
  const [quantity, setQuantity] = useState(String(settings.tradeSizes[settings.defaultExchange as keyof typeof settings.tradeSizes] ?? ''));
  const [price, setPrice] = useState('');
  const [twapInterval, setTwapInterval] = useState('30');
  const [twapOrders, setTwapOrders] = useState('5');
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    setQuantity(String(settings.tradeSizes[exchange] ?? ''));
  }, [exchange]);

  useEffect(() => {
    const onBuy = () => setSide('BUY');
    const onSell = () => setSide('SELL');
    window.addEventListener('shortcut-buy', onBuy);
    window.addEventListener('shortcut-sell', onSell);
    return () => {
      window.removeEventListener('shortcut-buy', onBuy);
      window.removeEventListener('shortcut-sell', onSell);
    };
  }, []);

  // Convert USD size → coin quantity using live price; returns null if price unknown
  const usdToCoins = (usd: number): number | null => {
    const sym = symbol.toUpperCase();
    const px = prices[sym] ?? prices[sym + 'USDT'];
    return px ? usd / px : null;
  };

  const coinHint = (() => {
    const usd = parseFloat(quantity);
    if (!usd || !symbol) return null;
    const sym = symbol.toUpperCase();
    const px = prices[sym] ?? prices[sym + 'USDT'];
    if (!px) return null;
    const qty = usd / px;
    return qty < 0.0001 ? qty.toExponential(3) : qty.toPrecision(4);
  })();

  const submitOrder = async () => {
    if (!symbol || !quantity) return;

    const sym = symbol.toUpperCase();
    const usd = parseFloat(quantity);
    const coinQty = usdToCoins(usd);
    if (coinQty === null && exchange !== 'ibkr') {
      setStatus('Price not available — wait for feed');
      setTimeout(() => setStatus(null), 3000);
      return;
    }
    const qty = coinQty ?? usd; // ibkr: user enters quantity directly
    setStatus('Sending...');
    const endpoint = `/order/${exchange}`;
    let body: Record<string, unknown>;

    if (exchange === 'binance') {
      body = {
        symbol: sym + 'USDT',
        side,
        type: orderType,
        quantity: qty,
        ...(orderType === 'LIMIT' && price ? { price: parseFloat(price) } : {}),
      };
    } else if (exchange === 'hyperliquid') {
      body = {
        coin: sym,
        isBuy: side === 'BUY',
        sz: qty,
        limitPx: price ? parseFloat(price) : 0,
        orderType: orderType === 'MARKET' ? 'market' : 'limit',
      };
    } else {
      body = {
        symbol: sym,
        side,
        orderType,
        quantity: qty,
        tif: 'DAY',
        ...(orderType === 'LIMIT' && price ? { price: parseFloat(price) } : {}),
      };
    }

    try {
      const res = await fetch(`http://localhost:3000${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.ok) {
        setStatus('Order sent');
        addTradeHistory({
          id: `trade_${Date.now()}_${Math.random().toString(36).slice(2)}`,
          time: Date.now(),
          symbol: sym,
          exchange,
          side: side === 'BUY' ? 'long' : 'short',
          size: coinQty,
          price: prices[sym] ?? prices[sym + 'USDT'] ?? 0,
          status: 'ok',
        });
      } else {
        setStatus(`Error: ${data.error}`);
      }
    } catch {
      setStatus('Failed to send order');
    }
    setTimeout(() => setStatus(null), 4000);
  };

  const submitTwap = async () => {
    if (!symbol || !quantity) return;
    setStatus('Starting TWAP...');
    try {
      const res = await fetch('http://localhost:3000/order/twap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          coin: symbol.toUpperCase(),
          isBuy: side === 'BUY',
          sz: usdToCoins(parseFloat(quantity)),
          intervalSecs: parseInt(twapInterval) || 30,
          totalOrders: parseInt(twapOrders) || 5,
        }),
      });
      const data = await res.json();
      setStatus(res.ok ? `TWAP started` : `Error: ${data.error}`);
    } catch {
      setStatus('Backend unreachable');
    }
    setTimeout(() => setStatus(null), 4000);
  };

  const cancelTwap = async (jobId: string) => {
    await fetch(`http://localhost:3000/order/twap/${jobId}`, { method: 'DELETE' });
    removeTwapJobStore(jobId);
  };

  return (
    <div className="order-panel">
      <div className="panel-header">
        Order
        <div className="order-mode-tabs">
          <button className={`order-mode-tab ${mode === 'order' ? 'active' : ''}`} onClick={() => setMode('order')}>Order</button>
          <button className={`order-mode-tab ${mode === 'twap' ? 'active' : ''}`} onClick={() => setMode('twap')}>TWAP</button>
        </div>
      </div>
      <div className="order-form">
        <select value={exchange} onChange={e => setExchange(e.target.value as Exchange)} className="select">
          <option value="binance">Binance</option>
          <option value="hyperliquid">Hyperliquid</option>
          <option value="ibkr">IBKR</option>
        </select>
        <input
          value={symbol}
          onChange={e => setSymbol(e.target.value.toUpperCase())}
          placeholder="Symbol"
          className="input"
        />
        <div className="side-buttons">
          <button className={`btn btn-buy ${side === 'BUY' ? 'active' : ''}`} onClick={() => setSide('BUY')}>BUY</button>
          <button className={`btn btn-sell ${side === 'SELL' ? 'active' : ''}`} onClick={() => setSide('SELL')}>SELL</button>
        </div>

        {mode === 'order' ? (
          <>
            <select value={orderType} onChange={e => setOrderType(e.target.value as OrderType)} className="select">
              <option value="MARKET">Market</option>
              <option value="LIMIT">Limit</option>
            </select>
            <div className="order-size-row">
              <span className="order-size-prefix">$</span>
              <input value={quantity} onChange={e => setQuantity(e.target.value)} placeholder="Size (USD)" type="number" className="input" />
            </div>
            {coinHint && <div className="order-qty-hint">≈ {coinHint} {symbol}</div>}
            {orderType === 'LIMIT' && (
              <input value={price} onChange={e => setPrice(e.target.value)} placeholder="Limit price" type="number" className="input" />
            )}
            <button onClick={submitOrder} className={`btn btn-submit ${side === 'BUY' ? 'btn-buy' : 'btn-sell'}`}>
              {side} {symbol || '—'}
            </button>
          </>
        ) : (
          <>
            <div className="order-size-row">
              <span className="order-size-prefix">$</span>
              <input value={quantity} onChange={e => setQuantity(e.target.value)} placeholder="Total USD size" type="number" className="input" />
            </div>
            <div className="twap-fields">
              <input value={twapOrders} onChange={e => setTwapOrders(e.target.value)} placeholder="Orders" type="number" className="input" title="Number of orders" />
              <input value={twapInterval} onChange={e => setTwapInterval(e.target.value)} placeholder="Interval (s)" type="number" className="input" title="Seconds between orders" />
            </div>
            <div className="twap-hint">
              {coinHint && parseInt(twapOrders) > 0 && parseFloat(quantity) > 0
                ? `${parseInt(twapOrders)} orders × $${(parseFloat(quantity)/parseInt(twapOrders)).toFixed(0)} every ${twapInterval}s`
                : 'Enter size, orders, interval'}
            </div>
            <button onClick={submitTwap} className={`btn btn-submit ${side === 'BUY' ? 'btn-buy' : 'btn-sell'}`}>
              TWAP {side} {symbol || '—'}
            </button>
            {twapJobs.length > 0 && (
              <div className="twap-jobs">
                {twapJobs.map(job => (
                  <div key={job.jobId} className="twap-job">
                    <span>{job.isBuy ? '▲' : '▼'} {job.coin} {job.fired}/{job.totalOrders}</span>
                    <button className="twap-job-cancel" onClick={() => cancelTwap(job.jobId)} title="Cancel TWAP">✕</button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {status && <div className="order-status">{status}</div>}
      </div>
    </div>
  );
}
