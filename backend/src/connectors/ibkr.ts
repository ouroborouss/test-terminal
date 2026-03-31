import { IBApi, EventName, ErrorCode, Contract, SecType, Order as IBOrder, OrderAction, OrderType as IBOrderType, TimeInForce } from '@stoqey/ib';

// ── Connection ────────────────────────────────────────────────────────────────

const PORT      = parseInt(process.env.IBKR_PORT ?? '7496');
const HOST      = process.env.IBKR_HOST ?? '127.0.0.1';
const CLIENT_ID = parseInt(process.env.IBKR_CLIENT_ID ?? '1');
const ACCOUNT   = process.env.IBKR_ACCOUNT ?? 'All';

let ib: IBApi | null = null;
let connected = false;
let connectingPromise: Promise<void> | null = null;

function createApi(): IBApi {
  return new IBApi({ host: HOST, port: PORT, clientId: CLIENT_ID });
}

export function getConnectionStatus() {
  return connected;
}

export function connect(): Promise<void> {
  if (connectingPromise) return connectingPromise;
  if (connected && ib) return Promise.resolve();

  connectingPromise = new Promise((resolve, reject) => {
    ib = createApi();

    const timeout = setTimeout(() => {
      connectingPromise = null;
      reject(new Error(`IBKR connection timeout — is IBKR Desktop open with API enabled on port ${PORT}?`));
    }, 8000);

    ib.once(EventName.connected, () => {
      connected = true;
      clearTimeout(timeout);
      connectingPromise = null;
      console.log(`[IBKR] Connected to ${HOST}:${PORT}`);
      resolve();
    });

    ib.on(EventName.error, (err: Error, code: ErrorCode, reqId: number) => {
      // Code 2104/2106 = market data farm connected (informational, not errors)
      if (code === 2104 || code === 2106 || code === 2108 || code === 2158) return;
      if (reqId === -1) console.warn(`[IBKR] ${err.message} (code ${code})`);
    });

    ib.on(EventName.disconnected, () => {
      connected = false;
      ib = null;
      console.warn('[IBKR] Disconnected — will reconnect on next request');
    });

    ib.connect();
  });

  return connectingPromise;
}

async function api(): Promise<IBApi> {
  if (!connected || !ib) await connect();
  return ib!;
}

// ── Account Summary ───────────────────────────────────────────────────────────

export interface AccountSummary {
  accountId: string;
  netLiquidation?: number;
  totalCash?: number;
  availableFunds?: number;
  grossPosition?: number;
  currency: string;
}

export function getAccountSummary(): Promise<AccountSummary> {
  return new Promise(async (resolve, reject) => {
    const client = await api().catch(reject);
    if (!client) return;

    const reqId = Math.floor(Math.random() * 10000) + 1;
    const tags = 'NetLiquidation,TotalCashValue,AvailableFunds,GrossPositionValue';
    const data: Record<string, string> = {};
    let accountId = '';

    const timeout = setTimeout(() => {
      client.off(EventName.accountSummary, onData);
      client.off(EventName.accountSummaryEnd, onEnd);
      if (Object.keys(data).length > 0) {
        resolve(buildSummary(accountId, data));
      } else {
        reject(new Error('Account summary timeout'));
      }
    }, 6000);

    function buildSummary(acct: string, d: Record<string, string>): AccountSummary {
      return {
        accountId: acct,
        netLiquidation: d.NetLiquidation ? parseFloat(d.NetLiquidation) : undefined,
        totalCash: d.TotalCashValue ? parseFloat(d.TotalCashValue) : undefined,
        availableFunds: d.AvailableFunds ? parseFloat(d.AvailableFunds) : undefined,
        grossPosition: d.GrossPositionValue ? parseFloat(d.GrossPositionValue) : undefined,
        currency: d.currency ?? 'USD',
      };
    }

    function onData(_reqId: number, acct: string, tag: string, value: string, currency: string) {
      console.log(`[IBKR] accountSummary acct=${acct} tag=${tag} value=${value}`);
      // If a specific account is configured, only collect data from that account
      if (ACCOUNT !== 'All' && acct !== ACCOUNT) return;
      accountId = acct;
      data[tag] = value;
      if (currency) data.currency = currency;
    }

    function onEnd(_reqId: number) {
      console.log(`[IBKR] accountSummaryEnd reqId=${_reqId} expected=${reqId} data=`, data);
      clearTimeout(timeout);
      client.off(EventName.accountSummary, onData);
      client.off(EventName.accountSummaryEnd, onEnd);
      client.cancelAccountSummary(reqId);
      resolve(buildSummary(accountId, data));
    }

    client.on(EventName.accountSummary, onData);
    client.on(EventName.accountSummaryEnd, onEnd);

    try {
      client.reqAccountSummary(reqId, 'All', tags);
    } catch (e) {
      clearTimeout(timeout);
      reject(e);
    }
  });
}

// ── Positions ─────────────────────────────────────────────────────────────────

export interface IBPosition {
  accountId: string;
  symbol: string;
  secType: string;
  side: 'long' | 'short';
  size: number;
  avgCost: number;
  marketValue?: number;
  pnl?: number;
}

export function getPositions(): Promise<IBPosition[]> {
  return new Promise(async (resolve, reject) => {
    const client = await api().catch(reject);
    if (!client) return;

    const positions: IBPosition[] = [];

    const timeout = setTimeout(() => {
      client.off(EventName.position, onPos);
      client.off(EventName.positionEnd, onEnd);
      resolve(positions);
    }, 6000);

    function onPos(accountId: string, contract: Contract, pos: number, avgCost: number) {
      if (pos === 0) return;
      if (ACCOUNT !== 'All' && accountId !== ACCOUNT) return;
      positions.push({
        accountId,
        symbol: contract.symbol ?? '',
        secType: contract.secType ?? '',
        side: pos > 0 ? 'long' : 'short',
        size: Math.abs(pos),
        avgCost,
      });
    }

    function onEnd() {
      clearTimeout(timeout);
      client.off(EventName.position, onPos);
      client.off(EventName.positionEnd, onEnd);
      client.cancelPositions();
      resolve(positions);
    }

    client.on(EventName.position, onPos);
    client.on(EventName.positionEnd, onEnd);

    try {
      client.reqPositions();
    } catch (e) {
      clearTimeout(timeout);
      reject(e);
    }
  });
}

// ── Market Price Snapshot ─────────────────────────────────────────────────────
// Returns last price for each symbol using a one-shot snapshot request

// ── Yahoo Finance price fetcher ───────────────────────────────────────────────
// Uses Yahoo Finance v7 quote endpoint — no API key, works for US/OTC/international stocks

const _priceCache = new Map<string, { price: number; ts: number }>();
const PRICE_CACHE_TTL = 2 * 60 * 1000; // 2 minutes

// .ST=Stockholm  .L=London  .OL=Oslo  .HE=Helsinki  .CO=Copenhagen  .OB/.PK=OTC/Pink
const SUFFIXES = ['', '.ST', '.L', '.OL', '.HE', '.CO', '.OB', '.PK'];

const YAHOO_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json',
};

// Fetch a single ticker via Yahoo Finance v8/chart (no crumb required)
async function yahooSingle(ticker: string): Promise<{ price: number; currency: string } | null> {
  try {
    // Do NOT encode the ticker — Yahoo Finance requires raw = for FX tickers like SEKUSD=X
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=5d`;
    const res = await fetch(url, { headers: YAHOO_HEADERS });
    if (!res.ok) return null;
    const data = await res.json() as {
      chart?: {
        result?: Array<{
          meta?: { regularMarketPrice?: number; chartPreviousClose?: number; previousClose?: number; currency?: string };
          indicators?: { quote?: Array<{ close?: (number | null)[] }> };
        }>;
      };
    };
    const result = data?.chart?.result?.[0];
    if (!result) return null;
    const meta = result.meta ?? {};
    const currency = meta.currency ?? 'USD';

    // Try in priority order: live price → previous close → last non-null close in candle data
    let price = meta.regularMarketPrice ?? 0;
    if (price <= 0) price = meta.chartPreviousClose ?? meta.previousClose ?? 0;
    if (price <= 0) {
      const closes = result.indicators?.quote?.[0]?.close ?? [];
      const last = [...closes].reverse().find(c => c != null && c > 0);
      price = last ?? 0;
    }

    if (price <= 0) return null;
    return { price, currency };
  } catch { return null; }
}

async function yahooQuote(tickers: string[]): Promise<Record<string, { price: number; currency: string }>> {
  if (!tickers.length) return {};
  const results = await Promise.all(tickers.map(async t => ({ t, r: await yahooSingle(t) })));
  const out: Record<string, { price: number; currency: string }> = {};
  for (const { t, r } of results) {
    if (r) out[t] = r;
  }
  return out;
}

export async function getMarketPrices(symbols: string[]): Promise<Record<string, number>> {
  if (!symbols.length) return {};

  const prices: Record<string, number> = {};

  // ── Serve from cache ──────────────────────────────────────────────────────
  const uncached: string[] = [];
  for (const sym of symbols) {
    const hit = _priceCache.get(sym);
    if (hit && Date.now() - hit.ts < PRICE_CACHE_TTL) prices[sym] = hit.price;
    else uncached.push(sym);
  }
  if (!uncached.length) return prices;

  // Lazy FX rate fetchers
  const fxCache: Record<string, number> = {};
  const getFx = async (pair: string, fallback: number): Promise<number> => {
    if (fxCache[pair]) return fxCache[pair];
    const fx = await yahooQuote([`${pair}=X`]);
    fxCache[pair] = fx[`${pair}=X`]?.price ?? fallback;
    return fxCache[pair];
  };

  let remaining = [...uncached];

  for (const suffix of SUFFIXES) {
    if (!remaining.length) break;
    const tickers = remaining.map(s => `${s}${suffix}`);
    const result  = await yahooQuote(tickers);

    for (const [yTicker, { price, currency }] of Object.entries(result)) {
      const baseSym = yTicker.replace(/\.(ST|L|OL|HE|CO|OB|PK)$/i, '');
      if (prices[baseSym]) continue;

      let usdPrice = price;
      if      (currency === 'GBp') usdPrice = (price / 100) * await getFx('GBPUSD', 1.27);
      else if (currency === 'GBP') usdPrice = price          * await getFx('GBPUSD', 1.27);
      else if (currency === 'SEK') usdPrice = price          * await getFx('SEKUSD', 0.092);
      else if (currency === 'NOK') usdPrice = price          * await getFx('NOKUSD', 0.091);
      else if (currency === 'DKK') usdPrice = price          * await getFx('DKKUSD', 0.14);
      else if (currency === 'EUR') usdPrice = price          * await getFx('EURUSD', 1.08);

      if (usdPrice > 0) prices[baseSym] = usdPrice;
    }

    remaining = remaining.filter(s => !prices[s]);
  }

  // ── Update cache ──────────────────────────────────────────────────────────
  for (const sym of uncached) {
    if (prices[sym]) _priceCache.set(sym, { price: prices[sym], ts: Date.now() });
    else console.warn(`[Yahoo] No price found for ${sym} (tried: ${SUFFIXES.map(s => sym + s).join(', ')})`);
  }

  return prices;
}

// ── Historical Candles via Yahoo Finance ──────────────────────────────────────

export interface Candle {
  time: number; // unix seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

const YAHOO_CHART_MAP: Record<string, { yInterval: string; range: string }> = {
  '1m':  { yInterval: '1m',  range: '1d'  },
  '3m':  { yInterval: '5m',  range: '2d'  },
  '5m':  { yInterval: '5m',  range: '5d'  },
  '15m': { yInterval: '15m', range: '5d'  },
  '30m': { yInterval: '30m', range: '1mo' },
  '1h':  { yInterval: '60m', range: '1mo' },
  '2h':  { yInterval: '60m', range: '3mo' },
  '4h':  { yInterval: '60m', range: '6mo' },
  '6h':  { yInterval: '1d',  range: '6mo' },
  '12h': { yInterval: '1d',  range: '1y'  },
  '1d':  { yInterval: '1d',  range: '2y'  },
  '1w':  { yInterval: '1wk', range: '5y'  },
};

export async function getYahooCandles(symbol: string, interval: string): Promise<Candle[]> {
  const { yInterval, range } = YAHOO_CHART_MAP[interval] ?? { yInterval: '1d', range: '1y' };

  for (const suffix of SUFFIXES) {
    const ticker = `${symbol}${suffix}`;
    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=${yInterval}&range=${range}`;
      const res = await fetch(url, { headers: YAHOO_HEADERS });
      if (!res.ok) continue;
      const data = await res.json() as {
        chart?: { result?: Array<{
          timestamp?: number[];
          indicators?: { quote?: Array<{ open?: (number|null)[]; high?: (number|null)[]; low?: (number|null)[]; close?: (number|null)[]; volume?: (number|null)[] }> };
        }> };
      };
      const result = data?.chart?.result?.[0];
      if (!result) continue;

      const timestamps = result.timestamp ?? [];
      const q = result.indicators?.quote?.[0] ?? {};
      const candles: Candle[] = [];

      for (let i = 0; i < timestamps.length; i++) {
        const o = q.open?.[i], h = q.high?.[i], l = q.low?.[i], c = q.close?.[i];
        if (o == null || h == null || l == null || c == null) continue;
        candles.push({ time: timestamps[i], open: o, high: h, low: l, close: c, volume: q.volume?.[i] ?? 0 });
      }

      if (candles.length > 0) {
        console.log(`[Yahoo] Loaded ${candles.length} candles for ${ticker}`);
        return candles;
      }
    } catch { continue; }
  }

  throw new Error(`No chart data found for ${symbol} on Yahoo Finance`);
}

// Keep IBKR-based candles as legacy fallback (unused by default)
export function getHistoricalCandles(symbol: string, _interval: string): Promise<Candle[]> {
  return Promise.reject(new Error(`IBKR candles disabled — use Yahoo Finance for ${symbol}`));
}

// ── Place Order ───────────────────────────────────────────────────────────────

let nextOrderId = -1;

function getNextOrderId(client: IBApi): Promise<number> {
  if (nextOrderId > 0) return Promise.resolve(nextOrderId++);
  return new Promise((resolve) => {
    client.once(EventName.nextValidId, (id: number) => {
      nextOrderId = id + 1;
      resolve(id);
    });
    client.reqIds();
  });
}

export interface IBOrderRequest {
  symbol: string;
  secType?: 'STK' | 'FUT' | 'OPT';
  exchange?: string;
  currency?: string;
  side: 'BUY' | 'SELL';
  orderType: 'MARKET' | 'LIMIT';
  quantity: number;
  price?: number;
  tif?: 'DAY' | 'GTC' | 'IOC';
}

export async function placeOrder(req: IBOrderRequest): Promise<{ orderId: number }> {
  const client = await api();
  const orderId = await getNextOrderId(client);

  const contract: Contract = {
    symbol: req.symbol,
    secType: (req.secType ?? 'STK') as SecType,
    exchange: req.exchange ?? 'SMART',
    currency: req.currency ?? 'USD',
  };

  const order: IBOrder = {
    action: req.side as OrderAction,
    orderType: req.orderType === 'MARKET' ? IBOrderType.MKT : IBOrderType.LMT,
    totalQuantity: req.quantity,
    tif: (req.tif ?? 'DAY') as TimeInForce,
    ...(req.orderType === 'LIMIT' && req.price ? { lmtPrice: req.price } : {}),
  };

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Order placement timeout')), 8000);

    client.once(EventName.openOrder, (oid: number) => {
      if (oid !== orderId) return;
      clearTimeout(timeout);
      resolve({ orderId });
    });

    try {
      client.placeOrder(orderId, contract, order);
    } catch (e) {
      clearTimeout(timeout);
      reject(e);
    }
  });
}

// ── Keepalive (no-op for socket API — connection is persistent) ───────────────
export function startKeepalive() {
  // Try to connect at startup; auto-reconnects on next request if dropped
  connect().catch(err => console.warn(`[IBKR] Initial connect failed: ${err.message}`));
}

// Legacy exports so index.ts compiles without changes
export const tickleSession = () => Promise.resolve();
