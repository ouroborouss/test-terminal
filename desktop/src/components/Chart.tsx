import { useEffect, useRef, useState, RefObject } from 'react';
import {
  createChart, IChartApi, ISeriesApi, IPriceLine,
  CandlestickSeries, CandlestickData, Time, ColorType, LineStyle,
} from 'lightweight-charts';
import { useStore } from '../store';
import { useSettings } from '../settings';

// Re-create chart when container div is (re)mounted
function useChart(containerRef: RefObject<HTMLDivElement | null>) {
  const chartRef  = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: '#141417' },
        textColor: '#6b6b78',
        fontSize: 11,
        fontFamily: 'Inter, system-ui, sans-serif',
      },
      grid: {
        vertLines: { color: '#1e1e24' },
        horzLines: { color: '#1e1e24' },
      },
      crosshair: {
        vertLine: { color: '#3b82f6', labelBackgroundColor: '#1e3a5f' },
        horzLine: { color: '#3b82f6', labelBackgroundColor: '#1e3a5f' },
      },
      rightPriceScale: { borderColor: '#2a2a30' },
      timeScale: { borderColor: '#2a2a30', timeVisible: true, secondsVisible: false },
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor:         '#22c55e',
      downColor:       '#ef4444',
      borderUpColor:   '#22c55e',
      borderDownColor: '#ef4444',
      wickUpColor:     '#22c55e',
      wickDownColor:   '#ef4444',
    });

    chartRef.current  = chart;
    seriesRef.current = series;

    return () => {
      chart.remove();
      chartRef.current  = null;
      seriesRef.current = null;
    };
  // re-run whenever the container element changes (e.g. after hidden→visible toggle)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerRef.current]);

  return { chartRef, seriesRef };
}

type Interval = '1m' | '3m' | '5m' | '15m' | '30m' | '1h' | '2h' | '4h' | '6h' | '12h' | '1d' | '1w';
const INTERVALS: Interval[] = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '12h', '1d', '1w'];

async function fetchBinanceCandles(symbol: string, interval: Interval): Promise<CandlestickData[]> {
  const res = await fetch(
    `https://api.binance.com/api/v3/klines?symbol=${symbol}USDT&interval=${interval}&limit=300`
  );
  const data = await res.json();
  if (!Array.isArray(data)) throw new Error('Bad response');
  return data.map((k: unknown[]) => ({
    time: Math.floor(Number(k[0]) / 1000) as Time,
    open:  parseFloat(k[1] as string),
    high:  parseFloat(k[2] as string),
    low:   parseFloat(k[3] as string),
    close: parseFloat(k[4] as string),
  }));
}

async function fetchHyperliquidCandles(coin: string, interval: Interval): Promise<CandlestickData[]> {
  const intervalMs: Record<Interval, number> = {
    '1m': 60_000, '3m': 180_000, '5m': 300_000, '15m': 900_000, '30m': 1_800_000,
    '1h': 3_600_000, '2h': 7_200_000, '4h': 14_400_000, '6h': 21_600_000,
    '12h': 43_200_000, '1d': 86_400_000, '1w': 604_800_000,
  };
  const endTime = Date.now();
  const startTime = endTime - intervalMs[interval] * 300;

  const res = await fetch('https://api.hyperliquid.xyz/info', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'candleSnapshot', req: { coin, interval, startTime, endTime } }),
  });
  const data = await res.json();
  if (!Array.isArray(data) || data.length === 0) throw new Error('Empty');
  return data.map((k: Record<string, unknown>) => ({
    time: Math.floor(Number(k.t) / 1000) as Time,
    open:  parseFloat(k.o as string),
    high:  parseFloat(k.h as string),
    low:   parseFloat(k.l as string),
    close: parseFloat(k.c as string),
  }));
}

function getPriceFormat(price: number) {
  if (price >= 1000)   return { type: 'price' as const, precision: 2,  minMove: 0.01 };
  if (price >= 1)      return { type: 'price' as const, precision: 4,  minMove: 0.0001 };
  if (price >= 0.01)   return { type: 'price' as const, precision: 6,  minMove: 0.000001 };
  if (price >= 0.0001) return { type: 'price' as const, precision: 8,  minMove: 0.00000001 };
  return               { type: 'price' as const, precision: 10, minMove: 0.0000000001 };
}

const INTERVAL_SECS: Record<Interval, number> = {
  '1m': 60, '3m': 180, '5m': 300, '15m': 900, '30m': 1800,
  '1h': 3600, '2h': 7200, '4h': 14400, '6h': 21600,
  '12h': 43200, '1d': 86400, '1w': 604800,
};

const REFRESH_MS: Record<Interval, number> = {
  '1m': 30_000, '3m': 60_000, '5m': 60_000, '15m': 120_000, '30m': 120_000,
  '1h': 300_000, '2h': 300_000, '4h': 600_000, '6h': 600_000,
  '12h': 600_000, '1d': 600_000, '1w': 3_600_000,
};

export function Chart() {
  const { selectedSymbol, setSelectedSymbol, prices, watchlist, positions, fundingRates } = useStore();
  const { testMode, tradeSizes, defaultExchange, addTestPosition, hlLeverage, hlCrossMargin } = useSettings();
  const containerRef = useRef<HTMLDivElement>(null);
  const { chartRef, seriesRef } = useChart(containerRef);
  const lastCandleRef = useRef<CandlestickData | null>(null);
  const priceLineRef = useRef<IPriceLine | null>(null);
  const [interval, setIntervalVal] = useState<Interval>('5m');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [symbolInput, setSymbolInput] = useState('');
  const [tradeStatus, setTradeStatus] = useState<string | null>(null);
  const [allTickers, setAllTickers] = useState<string[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);

  const activeSymbol = selectedSymbol;

  const [stockTickers, setStockTickers] = useState<string[]>([]);

  // Load all available tickers from backend
  useEffect(() => {
    fetch('http://localhost:3000/tickers')
      .then(r => r.json())
      .then((data: { hyperliquid: string[]; binance: string[]; stocks?: string[] }) => {
        const combined = [...new Set([...(data.hyperliquid ?? []), ...(data.binance ?? [])])].sort();
        setAllTickers(combined);
        setStockTickers(data.stocks ?? []);
      })
      .catch(() => {});
  }, []);

  const cryptoSet = new Set(allTickers); // Hyperliquid + Binance known crypto
  const isStock = (sym: string) => {
    const wItem = watchlist.find(w => w.symbol === sym);
    if (wItem) return wItem.market === 'stock';   // watchlist is authoritative
    if (cryptoSet.has(sym)) return false;          // known crypto ticker → never stock
    return stockTickers.includes(sym);             // only then check SEC list
  };

  const dropdownItems = symbolInput.length >= 1
    ? [...new Set([...stockTickers, ...allTickers])].filter(t => t.toUpperCase().startsWith(symbolInput.toUpperCase())).slice(0, 20)
    : watchlist.slice(0, 12).map(w => w.symbol);

  const loadSymbol = (sym: string, market: 'crypto' | 'stock') => {
    setSelectedSymbol({ symbol: sym.toUpperCase(), market });
    setSymbolInput('');
    setError(null);
  };

  // Quick trade from chart toolbar
  const chartTrade = async (isBuy: boolean) => {
    if (!activeSymbol) return;
    const sym = activeSymbol.symbol;
    const usdSize = tradeSizes[defaultExchange as keyof typeof tradeSizes] ?? 100;
    const price = prices[sym] ?? prices[sym + 'USDT'];
    if (!price) { setTradeStatus('No price — wait'); setTimeout(() => setTradeStatus(null), 2000); return; }
    const coinQty = usdSize / price;   // always USD → coins, never raw size
    setTradeStatus('...');
    if (testMode) {
      addTestPosition({ symbol: sym, market: 'crypto', exchange: `${defaultExchange} [TEST]`,
        side: isBuy ? 'long' : 'short', size: coinQty, entry_price: price ?? 0, current_price: price, pnl: 0 });
      setTradeStatus(`[TEST] ${isBuy ? 'LONG' : 'SHORT'} $${usdSize}`);
    } else {
      try {
        const body = defaultExchange === 'hyperliquid'
          ? { coin: sym, isBuy, sz: coinQty, limitPx: price, orderType: 'market', leverage: hlLeverage, crossMargin: hlCrossMargin }
          : { symbol: sym + 'USDT', side: isBuy ? 'BUY' : 'SELL', type: 'MARKET', quantity: coinQty };
        const res = await fetch(`http://localhost:3000/order/${defaultExchange}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        setTradeStatus(res.ok ? `${isBuy ? 'Long' : 'Short'} sent` : `Error: ${data.error}`);
      } catch { setTradeStatus('Failed'); }
    }
    setTimeout(() => setTradeStatus(null), 3000);
  };

  // Load candles — extracted so we can call it on interval too
  const loadCandles = async (sym: { symbol: string; market: string }, iv: Interval, isInitial: boolean) => {
    if (!seriesRef.current) return;
    if (isInitial) { setLoading(true); setError(null); lastCandleRef.current = null; }

    try {
      let candles: CandlestickData[];
      if (sym.market === 'crypto') {
        try {
          candles = await fetchHyperliquidCandles(sym.symbol, iv);
        } catch {
          candles = await fetchBinanceCandles(sym.symbol, iv);
        }
      } else {
        const res = await fetch(`http://localhost:3000/ibkr/candles?symbol=${sym.symbol}&interval=${iv}`);
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: 'Failed' }));
          if (isInitial) setError(err.error ?? 'Could not load stock chart');
          if (isInitial) setLoading(false);
          return;
        }
        candles = await res.json();
      }
      seriesRef.current?.setData(candles);
      if (isInitial) chartRef.current?.timeScale().fitContent();
      if (candles.length > 0) {
        lastCandleRef.current = candles[candles.length - 1];
        // Set precision based on actual price magnitude
        const lastPrice = candles[candles.length - 1].close;
        seriesRef.current?.applyOptions({ priceFormat: getPriceFormat(lastPrice) });
      }
    } catch {
      if (isInitial) setError(`Could not load ${sym.symbol}`);
    }
    if (isInitial) setLoading(false);
  };

  // Load + auto-refresh
  useEffect(() => {
    if (!activeSymbol) return;

    loadCandles(activeSymbol, interval, true);

    const timer = setInterval(() => {
      loadCandles(activeSymbol, interval, false);
    }, REFRESH_MS[interval]);

    return () => clearInterval(timer);
  }, [activeSymbol?.symbol, activeSymbol?.market, interval]);

  // Live price tick — updates the current candle in-place
  useEffect(() => {
    if (!activeSymbol || !seriesRef.current || !lastCandleRef.current) return;

    const price = prices[activeSymbol.symbol] ?? prices[activeSymbol.symbol + 'USDT'];
    if (!price) return;

    const secs = INTERVAL_SECS[interval];
    const candleTime = (Math.floor(Date.now() / 1000 / secs) * secs) as Time;
    const last = lastCandleRef.current;
    const isNewCandle = (candleTime as number) > (last.time as number);

    const updated: CandlestickData = {
      time: candleTime,
      open:  isNewCandle ? price : last.open,
      high:  isNewCandle ? price : Math.max(last.high, price),
      low:   isNewCandle ? price : Math.min(last.low,  price),
      close: price,
    };

    try {
      seriesRef.current.update(updated);
      lastCandleRef.current = updated;
    } catch {}
  }, [prices, activeSymbol, interval]);

  // Position entry line
  useEffect(() => {
    if (!seriesRef.current || !activeSymbol) return;
    const pos = positions.find(p => p.symbol === activeSymbol.symbol);

    // Remove old line
    if (priceLineRef.current) {
      try { seriesRef.current.removePriceLine(priceLineRef.current); } catch {}
      priceLineRef.current = null;
    }

    if (pos) {
      priceLineRef.current = seriesRef.current.createPriceLine({
        price: pos.entry_price,
        color: pos.side === 'long' ? '#22c55e' : '#ef4444',
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: `${pos.side.toUpperCase()} ${pos.size}`,
      });
    }
  }, [positions, activeSymbol?.symbol]);

  return (
    <div className="chart-panel">
      <div className="chart-toolbar">
        {/* Inline symbol search with autocomplete */}
        <form
          className="chart-symbol-form"
          onSubmit={e => {
            e.preventDefault();
            const s = symbolInput.trim().toUpperCase();
            if (s) {
              loadSymbol(s, isStock(s) ? 'stock' : 'crypto');
              setShowDropdown(false);
            }
          }}
        >
          <input
            className="chart-symbol-input"
            value={symbolInput}
            onChange={e => { setSymbolInput(e.target.value.toUpperCase()); setShowDropdown(true); }}
            onFocus={() => setShowDropdown(true)}
            onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
            placeholder={activeSymbol?.symbol ?? 'Symbol...'}
          />
          {showDropdown && dropdownItems.length > 0 && (
            <div className="chart-autocomplete">
              {symbolInput.length === 0 && <div className="chart-autocomplete-header">Watchlist</div>}
              {dropdownItems.map(t => (
                <button
                  key={t}
                  className="chart-autocomplete-item"
                  onMouseDown={() => {
                    loadSymbol(t, isStock(t) ? 'stock' : 'crypto');
                    setSymbolInput('');
                    setShowDropdown(false);
                  }}
                >
                  {t}
                  {isStock(t) && <span className="chart-autocomplete-badge">STK</span>}
                </button>
              ))}
            </div>
          )}
        </form>

        <div className="chart-intervals">
          {INTERVALS.map(iv => (
            <button
              key={iv}
              className={`chart-interval-btn ${interval === iv ? 'active' : ''}`}
              onClick={() => setIntervalVal(iv)}
            >{iv}</button>
          ))}
        </div>

        {activeSymbol && (() => {
          const rate = fundingRates[activeSymbol.symbol];
          if (rate == null) return null;
          const pct = rate * 100;
          const pos = positions.find(p => p.symbol === activeSymbol.symbol);
          const posVal = pos ? pos.size * (pos.current_price ?? pos.entry_price) : null;
          const payout = posVal != null ? posVal * rate * (pos!.side === 'long' ? -1 : 1) : null;
          const color = pct >= 0 ? 'var(--red)' : 'var(--green)'; // positive rate = longs pay = bad for longs
          return (
            <div className="chart-funding">
              <span className="chart-funding-label">FR</span>
              <span className="chart-funding-rate" style={{ color }}>
                {pct >= 0 ? '+' : ''}{pct.toFixed(4)}%
              </span>
              {payout != null && (
                <span className="chart-funding-payout" style={{ color: payout >= 0 ? 'var(--green)' : 'var(--red)' }}>
                  {payout >= 0 ? '+' : ''}${payout.toFixed(3)}/8h
                </span>
              )}
            </div>
          );
        })()}
        {(loading || tradeStatus) && (
          <span className="chart-loading">{tradeStatus ?? 'Loading...'}</span>
        )}
      </div>

      {/* Container always rendered so chart instance persists */}
      <div className="chart-container-wrap">
        {error && <div className="chart-error-overlay">{error}</div>}
        {!activeSymbol && !error && (
          <div className="chart-placeholder">Enter a symbol above or pick from your watchlist</div>
        )}
        <div ref={containerRef} className="chart-container" />
      </div>
    </div>
  );
}
