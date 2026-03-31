import { useState, useEffect, useCallback } from 'react';

interface NewsItem {
  id: string;
  title: string;
  source: string;
  symbols?: string[];
  time: number;
}

interface ElectronSettings {
  defaultExchange: string;
  tradeSizes: { binance: number; hyperliquid: number; ibkr: number };
  defaultOrderType: string;
  requireConfirmation: boolean;
  mouse4Action: 'buy' | 'sell' | 'none';
  mouse5Action: 'buy' | 'sell' | 'none';
  overlayTimeoutSecs: number;
}

const BACKEND = 'http://localhost:3000';
const STORAGE_KEY = 'fd_terminal_settings';
const SOUND_KEY = 'fd_terminal_sound';

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString('en-GB', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
}

function playNotifSound() {
  try {
    const dataUrl = localStorage.getItem(SOUND_KEY);
    if (!dataUrl) return;
    const audio = new Audio(dataUrl);
    audio.volume = 0.7;
    audio.play();
  } catch {}
}

function getSettings(): ElectronSettings {
  try {
    return {
      defaultExchange: 'hyperliquid',
      tradeSizes: { binance: 100, hyperliquid: 100, ibkr: 10 },
      defaultOrderType: 'market',
      requireConfirmation: false,
      mouse4Action: 'buy',
      mouse5Action: 'sell',
      overlayTimeoutSecs: 12,
      ...JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}'),
    };
  } catch {
    return {
      defaultExchange: 'hyperliquid',
      tradeSizes: { binance: 100, hyperliquid: 100, ibkr: 10 },
      defaultOrderType: 'market',
      requireConfirmation: false,
      mouse4Action: 'buy',
      mouse5Action: 'sell',
      overlayTimeoutSecs: 12,
    };
  }
}

declare global {
  interface Window {
    electronAPI?: {
      dismissOverlay: () => void;
      onOverlayNews: (cb: (news: unknown) => void) => () => void;
      onMouseBtnBuy: (cb: () => void) => () => void;
      onMouseBtnSell: (cb: () => void) => () => void;
    };
  }
}

export function OverlayBanner() {
  const [news, setNews] = useState<NewsItem | null>(null);
  const [actionLabel, setActionLabel] = useState<string | null>(null);

  const dismiss = useCallback(() => {
    setNews(null);
    setActionLabel(null);
    window.electronAPI?.dismissOverlay();
  }, []);

  useEffect(() => {
    const unlisten = window.electronAPI?.onOverlayNews((payload) => {
      setNews(payload as NewsItem);
      setActionLabel(null);
      playNotifSound();
    });
    return () => unlisten?.();
  }, []);

  // Auto-dismiss
  useEffect(() => {
    if (!news) return;
    const timeout = getSettings().overlayTimeoutSecs;
    if (timeout === 0) return;
    const t = setTimeout(dismiss, timeout * 1000);
    return () => clearTimeout(t);
  }, [news, dismiss]);

  const executeOrder = useCallback(async (side: 'BUY' | 'SELL') => {
    const settings = getSettings();
    const symbol = news?.symbols?.[0];
    if (!symbol) { setActionLabel(side); return; }

    const exchange = settings.defaultExchange;
    const size = settings.tradeSizes[exchange as keyof typeof settings.tradeSizes] ?? 0;

    setActionLabel(`${side} ${symbol}...`);

    try {
      let endpoint = `/order/${exchange}`;
      let body: Record<string, unknown>;

      if (exchange === 'hyperliquid') {
        body = { coin: symbol, isBuy: side === 'BUY', sz: size, limitPx: 0, orderType: 'market' };
      } else if (exchange === 'binance') {
        body = { symbol: symbol + 'USDT', side, type: 'MARKET', quantity: size };
      } else {
        body = { symbol, side, orderType: 'MKT', quantity: size, tif: 'DAY' };
      }

      const res = await fetch(`${BACKEND}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      setActionLabel(res.ok ? `${side} ${symbol} ✓` : `${side} failed`);
    } catch {
      setActionLabel('Order failed');
    }
  }, [news]);

  useEffect(() => {
    const onBuy = () => {
      const action = getSettings().mouse4Action;
      if (action === 'none') return;
      executeOrder(action === 'buy' ? 'BUY' : 'SELL');
    };
    const onSell = () => {
      const action = getSettings().mouse5Action;
      if (action === 'none') return;
      executeOrder(action === 'buy' ? 'BUY' : 'SELL');
    };

    const unBuy = window.electronAPI?.onMouseBtnBuy(onBuy);
    const unSell = window.electronAPI?.onMouseBtnSell(onSell);
    return () => { unBuy?.(); unSell?.(); };
  }, [executeOrder]);

  if (!news) return null;

  const isBuy = actionLabel?.includes('BUY');
  const isSell = actionLabel?.includes('SELL');

  return (
    <div className="overlay" onContextMenu={(e) => { e.preventDefault(); dismiss(); }}>
      <div className="overlay-header">
        <span className="overlay-source">{news.source}</span>
        <span className="overlay-time">{formatTime(news.time)}</span>
      </div>
      <div className="overlay-title">{news.title}</div>
      {news.symbols && news.symbols.length > 0 && (
        <div className="overlay-symbols">
          {news.symbols.map(s => (
            <span key={s} className="overlay-ticker">{s}</span>
          ))}
        </div>
      )}
      {actionLabel && (
        <div className={`overlay-action ${isBuy ? 'buy' : isSell ? 'sell' : ''}`}>
          {actionLabel}
        </div>
      )}
    </div>
  );
}
