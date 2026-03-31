import { useEffect, useState } from 'react';

export type ChangeMap = Record<string, number>;

interface BinanceTick {
  symbol: string;
  priceChangePercent: string;
  lastPrice: string;
}

export type PriceMap = Record<string, number>;

async function fetchBinanceTicker(symbols: string[]): Promise<{ changes: ChangeMap; prices: PriceMap }> {
  const res = await fetch('https://api.binance.com/api/v3/ticker/24hr');
  const data: BinanceTick[] = await res.json();
  const changes: ChangeMap = {};
  const prices: PriceMap = {};
  for (const item of data) {
    const sym = item.symbol.endsWith('USDT') ? item.symbol.slice(0, -4) : item.symbol;
    if (symbols.includes(sym)) {
      changes[sym] = parseFloat(item.priceChangePercent);
      prices[sym]  = parseFloat(item.lastPrice);
    }
  }
  return { changes, prices };
}

async function fetchHyperliquidChanges(symbols: string[]): Promise<ChangeMap> {
  const res = await fetch('https://api.hyperliquid.xyz/info', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'metaAndAssetCtxs' }),
  });
  const [meta, ctxs] = await res.json();
  const map: ChangeMap = {};
  const universe: { name: string }[] = meta?.universe ?? [];
  universe.forEach((asset, i) => {
    if (!symbols.includes(asset.name)) return;
    const ctx = ctxs[i];
    const prev = parseFloat(ctx?.prevDayPx ?? '0');
    const mark = parseFloat(ctx?.markPx ?? '0');
    if (prev > 0 && mark > 0) {
      map[asset.name] = ((mark - prev) / prev) * 100;
    }
  });
  return map;
}

export function use24hrChange(symbols: string[]): { changes: ChangeMap; restPrices: PriceMap } {
  const [changes, setChanges] = useState<ChangeMap>({});
  const [restPrices, setRestPrices] = useState<PriceMap>({});

  useEffect(() => {
    if (symbols.length === 0) return;

    const fetchAll = async () => {
      try {
        const { changes: binanceChanges, prices: binancePrices } = await fetchBinanceTicker(symbols);
        // For symbols not found on Binance, try Hyperliquid
        const missing = symbols.filter(s => binanceChanges[s] === undefined);
        const hl = missing.length > 0 ? await fetchHyperliquidChanges(missing) : {};
        setChanges({ ...binanceChanges, ...hl });
        setRestPrices(binancePrices);
      } catch {}
    };

    fetchAll();
    const timer = setInterval(fetchAll, 30_000);
    return () => clearInterval(timer);
  }, [symbols.join(',')]);

  return { changes, restPrices };
}
