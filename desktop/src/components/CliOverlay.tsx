import { useState, useEffect, useRef } from 'react';

const BACKEND = 'http://localhost:3000';
const STORAGE_KEY = 'fd_terminal_settings';

declare global {
  interface Window {
    electronAPI?: {
      dismissCli: () => void;
    };
  }
}

function getSettings() {
  try {
    return {
      defaultExchange: 'hyperliquid',
      tradeSizes: { binance: 100, hyperliquid: 100, ibkr: 10 },
      hlLeverage: 10,
      hlCrossMargin: true,
      ...JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}'),
    };
  } catch {
    return {
      defaultExchange: 'hyperliquid',
      tradeSizes: { binance: 100, hyperliquid: 100, ibkr: 10 },
      hlLeverage: 10,
      hlCrossMargin: true,
    };
  }
}

async function fetchPrice(coin: string): Promise<number | undefined> {
  try {
    const res = await fetch('https://api.hyperliquid.xyz/info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'allMids' }),
    });
    const mids = await res.json() as Record<string, string>;
    const raw = mids[coin];
    return raw ? parseFloat(raw) : undefined;
  } catch {
    return undefined;
  }
}

function dismiss() {
  window.electronAPI?.dismissCli();
}

// Parse: "l BTC", "long BTC 500", "s eth", "short ETH 200"
function parseCommand(raw: string): { isBuy: boolean; coin: string; size?: number } | null {
  const parts = raw.trim().toLowerCase().split(/\s+/);
  if (parts.length < 2) return null;

  const [cmd, coinRaw, sizeRaw] = parts;
  const isBuy = cmd === 'l' || cmd === 'long' || cmd === 'b' || cmd === 'buy';
  const isSell = cmd === 's' || cmd === 'short' || cmd === 'sell';
  if (!isBuy && !isSell) return null;

  const coin = coinRaw.toUpperCase();
  const size = sizeRaw ? parseFloat(sizeRaw) : undefined;
  if (size !== undefined && isNaN(size)) return null;

  return { isBuy, coin, size };
}

export function CliOverlay() {
  const [value, setValue] = useState('');
  const [status, setStatus] = useState<{ msg: string; ok: boolean } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const focus = () => {
      setValue('');
      setStatus(null);
      setTimeout(() => inputRef.current?.focus(), 50);
    };
    window.addEventListener('focus', focus);
    focus();
    return () => window.removeEventListener('focus', focus);
  }, []);

  const execute = async () => {
    const parsed = parseCommand(value);
    if (!parsed) {
      setStatus({ msg: 'e.g.  l BTC  or  s ETH 500', ok: false });
      return;
    }

    const { isBuy, coin, size } = parsed;
    const settings = getSettings();
    const exchange = settings.defaultExchange;
    const usdSize = size ?? (settings.tradeSizes[exchange as keyof typeof settings.tradeSizes] ?? 100);

    setStatus({ msg: `${isBuy ? 'LONG' : 'SHORT'} ${coin}...`, ok: true });

    try {
      let endpoint: string;
      let body: Record<string, unknown>;

      if (exchange === 'hyperliquid') {
        const price = await fetchPrice(coin);
        if (!price) { setStatus({ msg: `No price for ${coin}`, ok: false }); return; }
        const coinQty = usdSize / price;
        endpoint = '/order/hyperliquid';
        body = {
          coin,
          isBuy,
          sz: coinQty,
          limitPx: price,
          orderType: 'market',
          leverage: settings.hlLeverage,
          crossMargin: settings.hlCrossMargin,
        };
      } else if (exchange === 'binance') {
        // Binance market orders use quoteOrderQty (USD) directly
        endpoint = '/order/binance';
        body = { symbol: coin + 'USDT', side: isBuy ? 'BUY' : 'SELL', type: 'MARKET', quoteOrderQty: usdSize };
      } else {
        endpoint = '/order/ibkr';
        body = { symbol: coin, side: isBuy ? 'BUY' : 'SELL', orderType: 'MARKET', quantity: usdSize, tif: 'DAY' };
      }

      const res = await fetch(`${BACKEND}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (res.ok) {
        setStatus({ msg: `${isBuy ? 'LONG' : 'SHORT'} ${coin} $${usdSize} ✓`, ok: true });
        setTimeout(dismiss, 1400);
      } else {
        setStatus({ msg: `Error: ${data.error ?? 'unknown'}`, ok: false });
      }
    } catch {
      setStatus({ msg: 'Request failed', ok: false });
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') execute();
    if (e.key === 'Escape') dismiss();
  };

  return (
    <div className="cli-banner">
      <span className="cli-prefix">&gt;</span>
      <input
        ref={inputRef}
        className="cli-input"
        value={value}
        onChange={e => { setValue(e.target.value); setStatus(null); }}
        onKeyDown={onKeyDown}
        placeholder="l BTC · s ETH 500 · Esc to close"
        spellCheck={false}
        autoComplete="off"
      />
      {status && (
        <span className={`cli-status ${status.ok ? 'ok' : 'err'}`}>{status.msg}</span>
      )}
    </div>
  );
}
