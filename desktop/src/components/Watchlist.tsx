import { useState } from 'react';
import { useStore } from '../store';
import { use24hrChange } from '../hooks/use24hrChange';

function formatPrice(price: number): string {
  if (price >= 1000)  return `$${price.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  if (price >= 1)     return `$${price.toLocaleString(undefined, { maximumFractionDigits: 4 })}`;
  if (price >= 0.01)  return `$${price.toFixed(6)}`;
  // Very small prices (e.g. PEPE, SHIB)
  return `$${price.toFixed(8).replace(/\.?0+$/, '')}`;
}

const CRYPTO_REGEX = /^[A-Z0-9]{2,10}$/;
const STOCK_REGEX  = /^[A-Z]{1,5}$/;

function validateSymbol(symbol: string, market: 'crypto' | 'stock'): string | null {
  const s = symbol.toUpperCase().trim();
  if (!s) return 'Enter a symbol';
  if (market === 'crypto' && !CRYPTO_REGEX.test(s)) return 'Crypto: 2–10 letters/numbers';
  if (market === 'stock'  && !STOCK_REGEX.test(s))  return 'Stock: 1–5 letters only';
  return null;
}

export function Watchlist() {
  const { watchlist, prices, selectedSymbol, setSelectedSymbol } = useStore();
  const [input, setInput] = useState('');
  const [market, setMarket] = useState<'crypto' | 'stock'>('crypto');
  const [error, setError] = useState<string | null>(null);

  const cryptoSymbols = watchlist.filter(w => w.market === 'crypto').map(w => w.symbol);
  const { changes, restPrices } = use24hrChange(cryptoSymbols);

  const addSymbol = async () => {
    const err = validateSymbol(input, market);
    if (err) { setError(err); return; }
    setError(null);
    await fetch('http://localhost:3000/watchlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol: input.toUpperCase().trim(), market }),
    });
    setInput('');
  };

  const removeSymbol = async (symbol: string) => {
    await fetch(`http://localhost:3000/watchlist/${symbol}`, { method: 'DELETE' });
  };

  return (
    <div className="watchlist">
      <div className="panel-header">Watchlist</div>
      <div className="watchlist-add">
        <input
          value={input}
          onChange={e => { setInput(e.target.value); setError(null); }}
          onKeyDown={e => e.key === 'Enter' && addSymbol()}
          placeholder="Symbol..."
          className={`input ${error ? 'input-error' : ''}`}
        />
        <select value={market} onChange={e => { setMarket(e.target.value as 'crypto' | 'stock'); setError(null); }} className="select">
          <option value="crypto">Crypto</option>
          <option value="stock">Stock</option>
        </select>
        <button onClick={addSymbol} className="btn btn-sm">Add</button>
      </div>
      {error && <div className="watchlist-error">{error}</div>}
      <div className="watchlist-list">
        {watchlist.map(item => {
          const price = prices[item.symbol + 'USDT'] ?? prices[item.symbol] ?? restPrices[item.symbol];
          const change = item.market === 'crypto' ? changes[item.symbol] : undefined;
          return (
            <div
              key={item.id}
              className={`watchlist-row ${selectedSymbol?.symbol === item.symbol ? 'selected' : ''}`}
              onClick={() => setSelectedSymbol({ symbol: item.symbol, market: item.market })}
            >
              <div className="watchlist-row-left">
                <span className="watchlist-symbol">{item.symbol}</span>
                {change !== undefined && (
                  <span className={`watchlist-change ${change >= 0 ? 'positive' : 'negative'}`}>
                    {change >= 0 ? '+' : ''}{change.toFixed(2)}%
                  </span>
                )}
              </div>
              <div className="watchlist-row-right">
                <span className="watchlist-price">
                  {price ? formatPrice(price) : '—'}
                </span>
                <button
                  className="btn-icon"
                  onClick={e => { e.stopPropagation(); removeSymbol(item.symbol); }}
                >✕</button>
              </div>
            </div>
          );
        })}
        {watchlist.length === 0 && (
          <div className="empty-state">Add symbols to watch</div>
        )}
      </div>
    </div>
  );
}
