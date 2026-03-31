import 'dotenv/config';
import express from 'express';
import { startWsServer, broadcast } from './ws/server';
import { connectTreeNews } from './connectors/treenews';
import { connectCustomFeed } from './connectors/customfeed';
import { subscribePrices as binancePrices, getPositions as binanceBalances } from './connectors/binance';
import {
  subscribePrices as hyperliquidPrices,
  getPositions as hlPositions,
  loadAssetIndex,
  getAssetList as hlAssetList,
  placeOrder as hlOrder,
  placeTpSl as hlTpSl,
} from './connectors/hyperliquid';
import {
  startKeepalive,
  getPositions as ibkrPositions,
  placeOrder as ibkrOrder,
  getAccountSummary as ibkrAccountSummary,
  getConnectionStatus as ibkrConnected,
  getYahooCandles as stockCandles,
  getMarketPrices as ibkrPrices,
} from './connectors/ibkr';
import { placeOrder as binanceOrder } from './connectors/binance';
import {
  getWatchlist, addToWatchlist, removeFromWatchlist,
  getPositions, upsertPosition, removePosition,
  saveExpoToken,
} from './db';

const HTTP_PORT = parseInt(process.env.HTTP_PORT ?? '3000');
const WS_PORT   = parseInt(process.env.WS_PORT   ?? '8080');

// Normalize HL wallet address — API is case-sensitive, requires lowercase
const HL_WALLET = process.env.HYPERLIQUID_WALLET_ADDRESS?.toLowerCase();

const app = express();
app.use(express.json());
app.use((_req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

// ── Watchlist ─────────────────────────────────────────────────────────────────
app.get('/watchlist', (_, res) => res.json(getWatchlist()));

app.post('/watchlist', (req, res) => {
  const { symbol, market } = req.body;
  const s = String(symbol ?? '').toUpperCase().trim();
  const cryptoOk = market === 'crypto' && /^[A-Z0-9]{2,10}$/.test(s);
  const stockOk  = market === 'stock'  && /^[A-Z]{1,5}$/.test(s);
  if (!cryptoOk && !stockOk) {
    res.status(400).json({ error: 'Invalid symbol' });
    return;
  }
  addToWatchlist(s, market);
  const list = getWatchlist();
  broadcast({ type: 'watchlist_update', payload: list });
  refreshPriceSubscriptions();
  res.json({ ok: true });
});

app.delete('/watchlist/:symbol', (req, res) => {
  removeFromWatchlist(req.params.symbol);
  broadcast({ type: 'watchlist_update', payload: getWatchlist() });
  res.json({ ok: true });
});

// ── Positions ─────────────────────────────────────────────────────────────────
app.get('/positions', (_, res) => res.json(getPositions()));

app.delete('/positions/:id', (req, res) => {
  removePosition(parseInt(req.params.id));
  broadcast({ type: 'positions_update', payload: getPositions() });
  res.json({ ok: true });
});

// ── Expo push token ───────────────────────────────────────────────────────────
app.post('/register-push-token', (req, res) => {
  const { token } = req.body;
  if (token) saveExpoToken(token);
  res.json({ ok: true });
});

// ── Order execution ───────────────────────────────────────────────────────────
app.post('/order/binance', async (req, res) => {
  try {
    const result = await binanceOrder({
      apiKey: process.env.BINANCE_API_KEY!,
      apiSecret: process.env.BINANCE_API_SECRET!,
      ...req.body,
    });
    res.json(result);
    setTimeout(syncPositions, 600);
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

app.post('/order/hyperliquid', async (req, res) => {
  try {
    const result = await hlOrder({
      privateKey: process.env.HYPERLIQUID_PRIVATE_KEY!,
      ...req.body,
    });
    console.log('[HL] order result:', JSON.stringify(result));
    // Hyperliquid always returns HTTP 200 — check both top-level and nested statuses
    const nestedError = result?.response?.data?.statuses?.find((s: { error?: string }) => s.error)?.error;
    if (result?.status === 'err' || nestedError) {
      res.status(400).json({ error: nestedError ?? result.response ?? 'Order rejected by Hyperliquid' });
    } else {
      res.json(result);
      setTimeout(syncPositions, 600);  // show new position immediately
    }
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

app.post('/order/ibkr', async (req, res) => {
  try {
    const result = await ibkrOrder(req.body);
    res.json(result);
    setTimeout(syncPositions, 1500);  // IBKR needs a moment to register
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// ── Cancel HL order ───────────────────────────────────────────────────────────
app.post('/order/hyperliquid/cancel', async (req, res) => {
  try {
    const { coin, oid } = req.body;
    const { cancelOrder: hlCancel } = await import('./connectors/hyperliquid');
    const result = await hlCancel({ privateKey: process.env.HYPERLIQUID_PRIVATE_KEY!, coin, oid });
    res.json(result);
    setTimeout(syncPositions, 600);
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// ── TWAP orders ───────────────────────────────────────────────────────────────
const twapJobs = new Map<string, ReturnType<typeof setInterval>>();

app.post('/order/twap', async (req, res) => {
  try {
    const { coin, isBuy, sz, intervalSecs, totalOrders } = req.body;
    if (!coin || !(sz > 0) || !(intervalSecs > 0) || !(totalOrders > 0)) {
      res.status(400).json({ error: 'Invalid TWAP params' });
      return;
    }
    const jobId = `twap_${Date.now()}`;
    const perOrderSz = sz / totalOrders;
    let fired = 0;
    let interval: ReturnType<typeof setInterval> | undefined;

    const fireOne = async () => {
      try {
        await hlOrder({
          privateKey: process.env.HYPERLIQUID_PRIVATE_KEY!,
          coin,
          isBuy,
          sz: perOrderSz,
          limitPx: 0,
          orderType: 'market',
        });
        fired++;
        if (fired >= totalOrders) {
          if (interval) clearInterval(interval);
          twapJobs.delete(jobId);
          broadcast({ type: 'twap_done', payload: { jobId } });
        } else {
          broadcast({ type: 'twap_progress', payload: { jobId, coin, isBuy, fired, totalOrders } });
        }
      } catch (err) {
        console.warn('[TWAP] Order failed:', (err as Error).message);
      }
    };

    await fireOne();
    if (fired < totalOrders) {
      interval = setInterval(fireOne, intervalSecs * 1000);
      twapJobs.set(jobId, interval);
    }

    res.json({ ok: true, jobId, totalOrders, intervalSecs });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

app.delete('/order/twap/:jobId', (req, res) => {
  const interval = twapJobs.get(req.params.jobId);
  if (!interval) { res.status(404).json({ error: 'Job not found' }); return; }
  clearInterval(interval);
  twapJobs.delete(req.params.jobId);
  broadcast({ type: 'twap_done', payload: { jobId: req.params.jobId } });
  res.json({ ok: true });
});

// ── TP/SL orders ──────────────────────────────────────────────────────────────
app.post('/order/hyperliquid/tpsl', async (req, res) => {
  try {
    const result = await hlTpSl({
      privateKey: process.env.HYPERLIQUID_PRIVATE_KEY!,
      ...req.body,
    });
    res.json(result);
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// ── Balances ──────────────────────────────────────────────────────────────────
app.get('/balances', async (_req, res) => {
  const result: Record<string, unknown> = {};

  // Hyperliquid
  if (HL_WALLET) {
    try {
      const r = await fetch('https://api.hyperliquid.xyz/info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'clearinghouseState', user: HL_WALLET }),
      });
      const json = await r.json() as Record<string, Record<string, string>>;
      result.hyperliquid = {
        configured: true,
        wallet: HL_WALLET,
        accountValue: parseFloat(json.crossMarginSummary?.accountValue ?? '0'),
        withdrawable: parseFloat(json.withdrawable as unknown as string ?? '0'),
        marginUsed: parseFloat(json.marginSummary?.totalMarginUsed ?? '0'),
        positionNotional: parseFloat(json.crossMarginSummary?.totalNtlPos ?? '0'),
      };
    } catch (err) {
      result.hyperliquid = { configured: true, error: (err as Error).message };
    }
  } else {
    result.hyperliquid = { configured: false };
  }

  // Binance
  if (process.env.BINANCE_API_KEY && process.env.BINANCE_API_SECRET) {
    try {
      const balances = await binanceBalances(
        process.env.BINANCE_API_KEY,
        process.env.BINANCE_API_SECRET,
      );
      result.binance = {
        configured: true,
        balances: balances.map((b: { asset: string; free: string; locked: string }) => ({
          asset: b.asset,
          free: parseFloat(b.free),
          locked: parseFloat(b.locked),
        })),
      };
    } catch (err) {
      result.binance = { configured: true, error: (err as Error).message };
    }
  } else {
    result.binance = { configured: false };
  }

  // IBKR
  if (process.env.IBKR_ENABLED === 'true') {
    try {
      const summary = await ibkrAccountSummary();
      result.ibkr = {
        configured: true,
        accountId: summary.accountId,
        netLiquidation: summary.netLiquidation,
        totalCash: summary.totalCash,
        availableFunds: summary.availableFunds,
        grossPosition: summary.grossPosition,
        currency: summary.currency,
      };
    } catch (err) {
      result.ibkr = { configured: true, connected: ibkrConnected(), error: (err as Error).message };
    }
  } else {
    result.ibkr = { configured: false };
  }

  res.json(result);
});

// ── Yahoo Finance raw debug ───────────────────────────────────────────────────
app.get('/yahoo/debug', async (req, res) => {
  const { symbol } = req.query as { symbol?: string };
  if (!symbol) return res.status(400).json({ error: 'symbol required' });
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`;
    const r = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36', 'Accept': 'application/json' },
    });
    const data = await r.json();
    res.json({ status: r.status, data });
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── IBKR debug ────────────────────────────────────────────────────────────────
app.get('/ibkr/candles', async (req, res) => {
  const { symbol, interval = '5m' } = req.query as { symbol?: string; interval?: string };
  if (!symbol) return res.status(400).json({ error: 'symbol required' });
  try {
    const candles = await stockCandles(symbol.toUpperCase(), interval);
    res.json(candles);
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get('/ibkr/debug', async (_req, res) => {
  const out: Record<string, unknown> = { connected: ibkrConnected() };
  try {
    out.summary = await ibkrAccountSummary();
  } catch (e: unknown) {
    out.summary_error = (e as Error).message;
  }
  try {
    out.positions = await ibkrPositions();
  } catch (e: unknown) {
    out.positions_error = (e as Error).message;
  }
  res.json(out);
});

app.get('/ibkr/prices', async (req, res) => {
  const { symbols } = req.query as { symbols?: string };
  if (!symbols) return res.status(400).json({ error: 'symbols required (comma-separated)' });
  const symList = symbols.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
  try {
    const prices = await ibkrPrices(symList);
    res.json({ symbols: symList, prices });
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── Test news broadcast ───────────────────────────────────────────────────────
const TEST_TWEETS = [
  { title: 'BREAKING: $BTC just broke $100k resistance, traders rushing to buy the breakout', symbols: ['BTC'] },
  { title: 'JUST IN: Binance lists $HYPE — withdrawals enabled immediately', symbols: ['HYPE', 'BNB'] },
  { title: 'WHALE ALERT: 50,000 $ETH moved from Coinbase to unknown wallet', symbols: ['ETH'] },
  { title: 'BREAKING: SEC approves spot $SOL ETF, trading begins Monday', symbols: ['SOL'] },
  { title: '$PEPE up 40% in the last hour as memecoin season kicks off', symbols: ['PEPE', 'BTC'] },
  { title: 'URGENT: Major exchange halts $BTC and $ETH withdrawals citing "technical issues"', symbols: ['BTC', 'ETH'] },
  { title: 'BlackRock increases $BTC holdings by 12,000 coins this week', symbols: ['BTC'] },
  { title: 'BREAKING: Hyperliquid TVL hits $2B, $HYPE surges 15%', symbols: ['HYPE'] },
  { title: '$ETH developers confirm Pectra upgrade going live next week', symbols: ['ETH'] },
  { title: 'JUST IN: US Treasury announces new crypto regulations targeting DeFi', symbols: ['BTC', 'ETH', 'SOL'] },
];

const TEST_SOURCES = ['Twitter', 'Telegram', 'Reuters', 'Bloomberg Crypto', 'The Block'];

app.post('/test/news', (_req, res) => {
  const tweet = TEST_TWEETS[Math.floor(Math.random() * TEST_TWEETS.length)];
  const source = TEST_SOURCES[Math.floor(Math.random() * TEST_SOURCES.length)];
  const news = {
    id: `test_${Date.now()}`,
    title: tweet.title,
    source,
    symbols: tweet.symbols,
    time: Date.now(),
  };
  broadcast({ type: 'news', payload: news });
  res.json({ ok: true, news });
});

// ── US stock ticker list (loaded once from SEC EDGAR) ─────────────────────────
let usStockTickers: string[] = [];

async function loadUsStockTickers() {
  try {
    const r = await fetch('https://www.sec.gov/files/company_tickers.json', {
      headers: { 'User-Agent': 'trading-terminal/1.0' },
    });
    const data = await r.json() as Record<string, { ticker: string; title: string }>;
    usStockTickers = [...new Set(Object.values(data).map(c => c.ticker.toUpperCase()))].sort();
    console.log(`[Stocks] Loaded ${usStockTickers.length} US stock tickers from SEC EDGAR`);
  } catch (err) {
    console.warn('[Stocks] Failed to load SEC ticker list:', (err as Error).message);
  }
}

// ── Tickers ───────────────────────────────────────────────────────────────────
app.get('/tickers', async (_req, res) => {
  const hl = hlAssetList();

  let binance: string[] = [];
  try {
    const r = await fetch('https://fapi.binance.com/fapi/v1/exchangeInfo');
    const data = await r.json() as { symbols: { symbol: string; status: string; baseAsset: string }[] };
    binance = data.symbols
      .filter(s => s.status === 'TRADING')
      .map(s => s.baseAsset.toUpperCase());
  } catch {
    // Binance unreachable — return HL only
  }

  res.json({ hyperliquid: hl, binance, stocks: usStockTickers });
});

// ── Settings ──────────────────────────────────────────────────────────────────
app.post('/settings/ibkr', async (req, res) => {
  const { enabled } = req.body;
  if (enabled) {
    startKeepalive();
    console.log('[IBKR] Enabled via settings');
  } else {
    console.log('[IBKR] Disabled via settings');
  }
  res.json({ ok: true });
});

// ── Price subscription helper ─────────────────────────────────────────────────
function refreshPriceSubscriptions() {
  const watchlist = getWatchlist() as { symbol: string; market: string }[];
  const watchlistCrypto = watchlist.filter(w => w.market === 'crypto').map(w => w.symbol);
  // Also include any open HL/Binance position coins so prices are always live
  const positionCrypto = (getPositions() as { symbol: string; market: string }[])
    .filter(p => p.market === 'crypto')
    .map(p => p.symbol);
  const cryptoSymbols = [...new Set([...watchlistCrypto, ...positionCrypto])];
  if (cryptoSymbols.length > 0) {
    if (process.env.BINANCE_API_KEY) binancePrices(cryptoSymbols.map(s => s + 'USDT'));
    hyperliquidPrices(cryptoSymbols);
  }
}

// ── Periodic position sync ────────────────────────────────────────────────────
async function syncPositions() {
  try {
    if (HL_WALLET) {
      const hlPos = await hlPositions(HL_WALLET);
      const activeHlSymbols = new Set<string>();

      for (const p of hlPos) {
        const pos = p.position;
        if (parseFloat(pos.szi) === 0) continue;
        activeHlSymbols.add(pos.coin);
        upsertPosition({
          symbol: pos.coin,
          market: 'crypto',
          exchange: 'hyperliquid',
          side: parseFloat(pos.szi) > 0 ? 'long' : 'short',
          size: Math.abs(parseFloat(pos.szi)),
          entry_price: parseFloat(pos.entryPx ?? '0'),
          current_price: parseFloat(pos.markPx ?? '0'),
          pnl: parseFloat(pos.unrealizedPnl ?? '0'),
          liquidation_price: pos.liquidationPx ? parseFloat(pos.liquidationPx) : undefined,
        });
      }

      // Remove any HL positions that are no longer open
      for (const dbPos of getPositions()) {
        if (dbPos.exchange === 'hyperliquid' && !activeHlSymbols.has(dbPos.symbol)) {
          removePosition(dbPos.id);
        }
      }
    }
  } catch (err) {
    console.warn('[Sync] Hyperliquid positions failed:', (err as Error).message);
  }

  if (process.env.IBKR_ENABLED === 'true' && ibkrConnected()) {
    try {
      const ibkrPos = await ibkrPositions();
      const activeIbkrSymbols = new Set<string>();

      const stockSymbols = ibkrPos.filter(p => p.secType === 'STK').map(p => p.symbol);
      const livePrice = stockSymbols.length ? await ibkrPrices(stockSymbols).catch(() => ({} as Record<string,number>)) : {};

      for (const p of ibkrPos) {
        activeIbkrSymbols.add(p.symbol);
        const currentPrice = livePrice[p.symbol];
        const pnl = currentPrice != null
          ? (currentPrice - p.avgCost) * p.size * (p.side === 'long' ? 1 : -1)
          : undefined;
        upsertPosition({
          symbol: p.symbol,
          market: p.secType === 'STK' ? 'stock' : 'crypto',
          exchange: 'ibkr',
          side: p.side,
          size: p.size,
          entry_price: p.avgCost,
          current_price: currentPrice,
          pnl,
        });
      }

      // Remove IBKR positions no longer open
      for (const dbPos of getPositions()) {
        if (dbPos.exchange === 'ibkr' && !activeIbkrSymbols.has(dbPos.symbol)) {
          removePosition(dbPos.id);
        }
      }
    } catch {
      // IBKR may not be running — silent fail
    }
  }

  broadcast({ type: 'positions_update', payload: getPositions() });
  refreshPriceSubscriptions();

  // Sync HL open orders + fill history
  if (HL_WALLET) {
    try {
      const [ordersRes, fillsRes] = await Promise.all([
        fetch('https://api.hyperliquid.xyz/info', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'openOrders', user: HL_WALLET }),
        }),
        fetch('https://api.hyperliquid.xyz/info', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'userFills', user: HL_WALLET }),
        }),
      ]);
      const orders = await ordersRes.json();
      const fills  = await fillsRes.json();
      broadcast({ type: 'hl_orders', payload: Array.isArray(orders) ? orders : [] });
      broadcast({ type: 'hl_fills',  payload: Array.isArray(fills)  ? fills.slice(0, 200) : [] });
    } catch (err) {
      console.warn('[Sync] HL orders/fills failed:', (err as Error).message);
    }
  }
}

// ── Funding rate sync ────────────────────────────────────────────────────────
async function syncFundingRates() {
  try {
    const res = await fetch('https://api.hyperliquid.xyz/info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'metaAndAssetCtxs' }),
    });
    const [meta, ctxs] = await res.json() as [{ universe: { name: string }[] }, { funding: string }[]];
    const rates: Record<string, number> = {};
    (meta?.universe ?? []).forEach((asset, i) => {
      const funding = parseFloat(ctxs[i]?.funding ?? '0');
      if (funding !== 0) rates[asset.name] = funding;
    });
    broadcast({ type: 'funding_rates', payload: rates });
  } catch (err) {
    console.warn('[FundingRates] Failed:', (err as Error).message);
  }
}

// ── Start ─────────────────────────────────────────────────────────────────────
startWsServer(WS_PORT);
app.listen(HTTP_PORT, () => console.log(`[HTTP] Listening on port ${HTTP_PORT}`));

if (process.env.TREE_NEWS_API_KEY) {
  connectTreeNews(process.env.TREE_NEWS_API_KEY);
} else {
  console.warn('[TreeNews] No API key set — skipping');
}

if (process.env.CUSTOM_FEED_PASSWORD) {
  connectCustomFeed(process.env.CUSTOM_FEED_PASSWORD);
} else {
  console.warn('[CustomFeed] No password set — skipping');
}

if (process.env.IBKR_ENABLED === 'true') {
  startKeepalive();
} else {
  console.warn('[IBKR] Disabled — set IBKR_ENABLED=true to enable');
}

loadAssetIndex().catch(err => console.warn('[Hyperliquid] Asset index failed:', err.message));
loadUsStockTickers();

refreshPriceSubscriptions();

// Sync positions every 5 seconds
syncPositions();
setInterval(syncPositions, 5_000);

// Sync funding rates every 60 seconds
syncFundingRates();
setInterval(syncFundingRates, 60_000);

console.log('[Terminal] Backend running');
