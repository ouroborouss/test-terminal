import { useState, useEffect, useRef } from 'react';
import { useStore } from '../store';
import { useSettings } from '../settings';

// ── AI Summarizer ─────────────────────────────────────────────────────────────

async function aiSummarize(text: string, apiKey: string): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 100,
      messages: [{
        role: 'user',
        content: `Summarize for a trader in ONE concise sentence (max 120 chars), focusing on price impact and actionability:\n\n${text}`,
      }],
    }),
  });
  if (!res.ok) throw new Error(`API ${res.status}`);
  const data = await res.json();
  return (data.content?.[0]?.text ?? '').trim();
}

// ── Order execution ───────────────────────────────────────────────────────────

async function executeOrder(
  symbol: string,
  isBuy: boolean,
  settings: ReturnType<typeof useSettings>,
  testMode: boolean,
  addTestPosition: (pos: Parameters<ReturnType<typeof useStore>['addTestPosition']>[0]) => void,
  currentPrice?: number,
): Promise<string> {
  const exchange = settings.defaultExchange;
  const size = settings.tradeSizes[exchange as keyof typeof settings.tradeSizes] ?? 100;

  // Convert USD size to coin quantity
  const coinQty = currentPrice ? size / currentPrice : size;

  if (testMode) {
    addTestPosition({
      symbol,
      market: 'crypto',
      exchange: `${exchange} [TEST]`,
      side: isBuy ? 'long' : 'short',
      size: coinQty,
      entry_price: currentPrice ?? 0,
      current_price: currentPrice,
      pnl: 0,
    });
    return `[TEST] ${isBuy ? 'LONG' : 'SHORT'} $${size} ${symbol}`;
  }

  let endpoint: string;
  let body: Record<string, unknown>;

  if (exchange === 'binance') {
    endpoint = '/order/binance';
    body = { symbol: symbol + 'USDT', side: isBuy ? 'BUY' : 'SELL', type: 'MARKET', quantity: coinQty };
  } else if (exchange === 'hyperliquid') {
    endpoint = '/order/hyperliquid';
    body = { coin: symbol, isBuy, sz: coinQty, limitPx: 0, orderType: 'market' };
  } else {
    endpoint = '/order/ibkr';
    body = { symbol, side: isBuy ? 'BUY' : 'SELL', orderType: 'MARKET', quantity: coinQty, tif: 'DAY' };
  }

  const res = await fetch(`http://localhost:3000${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return res.ok ? `${isBuy ? 'Long' : 'Short'} sent` : `Error: ${data.error}`;
}

// ── Ticker buttons ────────────────────────────────────────────────────────────

function TickerButtons({ symbol }: { symbol: string }) {
  const settings = useSettings();
  const testMode = useSettings(s => s.testMode);
  const { addTestPosition, addTradeHistory, prices, setSelectedSymbol } = useStore();
  const [status, setStatus] = useState<string | null>(null);

  const fire = async (isBuy: boolean) => {
    setStatus('...');
    const currentPrice = prices[symbol] ?? prices[symbol + 'USDT'];
    try {
      const msg = await executeOrder(symbol, isBuy, settings, testMode, addTestPosition, currentPrice);
      setStatus(msg);
      if (!testMode && !msg.startsWith('Error')) {
        const exchange = settings.defaultExchange;
        const usdSize = settings.tradeSizes[exchange as keyof typeof settings.tradeSizes] ?? 0;
        addTradeHistory({
          id: `trade_${Date.now()}_${Math.random().toString(36).slice(2)}`,
          time: Date.now(),
          symbol,
          exchange,
          side: isBuy ? 'long' : 'short',
          size: currentPrice ? usdSize / currentPrice : usdSize,
          price: currentPrice ?? 0,
          status: 'ok',
        });
      }
    } catch {
      setStatus('Failed');
    }
    setTimeout(() => setStatus(null), 3000);
  };

  return (
    <span className="ticker-group">
      <button
        className="ticker-tag ticker-tag-link"
        onClick={() => setSelectedSymbol({ symbol, market: 'crypto' })}
        title={`Load ${symbol} chart`}
      >{symbol}</button>
      <button className="ticker-btn ticker-btn-long" onClick={() => fire(true)}>L</button>
      <button className="ticker-btn ticker-btn-short" onClick={() => fire(false)}>S</button>
      {status && <span className="ticker-status">{status}</span>}
    </span>
  );
}

// ── Sound ────────────────────────────────────────────────────────────────────

const SOUND_KEY = 'fd_terminal_sound';

function playSound() {
  const src = localStorage.getItem(SOUND_KEY);
  if (src) new Audio(src).play().catch(() => {});
}

// ── News Feed ─────────────────────────────────────────────────────────────────

export function NewsFeed() {
  const news = useStore(s => s.news);
  const watchlist = useStore(s => s.watchlist);
  const { watchlistOnly, blockedKeywords, disabledSources, vipKeywords, vipSources, vipSound, anthropicApiKey } = useSettings();
  const prevCountRef = useRef(0);

  const [summaries, setSummaries] = useState<Record<string, string>>({});
  const [summarizingIds, setSummarizingIds] = useState<string[]>([]);

  const watchlistSymbols = new Set(watchlist.map(w => w.symbol));

  const isVip = (item: typeof news[0]) => {
    const lower = item.title.toLowerCase();
    return vipKeywords.some(kw => lower.includes(kw)) || vipSources.includes(item.source);
  };

  const filtered = news.filter(item => {
    if (disabledSources.includes(item.source)) return false;
    if (blockedKeywords.some(kw => item.title.toLowerCase().includes(kw))) return false;
    if (watchlistOnly && item.symbols) {
      if (!item.symbols.some(s => watchlistSymbols.has(s))) return false;
    }
    return true;
  });

  // Sound for new VIP items
  useEffect(() => {
    if (!vipSound) return;
    const newItems = filtered.slice(0, filtered.length - prevCountRef.current);
    if (prevCountRef.current > 0 && newItems.some(isVip)) playSound();
    prevCountRef.current = filtered.length;
  }, [filtered.length]);

  // Auto-summarize long items
  useEffect(() => {
    if (!anthropicApiKey) return;
    for (const item of filtered) {
      const text = item.body ?? '';
      if (text.length < 280) continue;
      if (summaries[item.id] || summarizingIds.includes(item.id)) continue;

      setSummarizingIds(prev => [...prev, item.id]);
      aiSummarize(text, anthropicApiKey)
        .then(summary => {
          setSummaries(prev => ({ ...prev, [item.id]: summary }));
        })
        .catch(() => {})
        .finally(() => {
          setSummarizingIds(prev => prev.filter(id => id !== item.id));
        });
    }
  }, [filtered.map(i => i.id).join(','), anthropicApiKey]);

  return (
    <div className="news-feed">
      <div className="panel-header">
        News Feed
        {filtered.length !== news.length && (
          <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--text-muted)' }}>
            ({filtered.length}/{news.length})
          </span>
        )}
      </div>
      <div className="news-list">
        {filtered.map(item => {
          const vip = isVip(item);
          const summary = summaries[item.id];
          const isSummarizing = summarizingIds.includes(item.id);
          return (
            <div key={item.id} className={`news-item ${vip ? 'news-item--vip' : ''}`}>
              <div className="news-item-meta">
                <span className="news-source">{item.source}</span>
                {vip && <span className="vip-badge">VIP</span>}
                <span className="news-time">
                  {new Date(item.time).toLocaleTimeString()}
                </span>
              </div>
              {item.title !== '[Image]' && (
                <div className="news-item-title">{item.title}</div>
              )}
              {item.image && (
                <img
                  className="news-item-image"
                  src={item.image}
                  alt=""
                  onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                />
              )}
              {(summary || isSummarizing) && (
                <div className="news-ai-summary">
                  <span className="news-ai-badge">AI</span>
                  {isSummarizing
                    ? <span className="news-ai-loading">summarizing...</span>
                    : summary}
                </div>
              )}
              {item.symbols && item.symbols.length > 0 && (
                <div className="news-item-symbols">
                  {item.symbols.map(s => (
                    <TickerButtons key={s} symbol={s} />
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div className="empty-state">
            {news.length > 0 ? 'All news filtered out' : 'Waiting for news...'}
          </div>
        )}
      </div>
    </div>
  );
}
