import path from 'path';
import fs from 'fs';

const dataDir = path.join(__dirname, '../../data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

// ── Types ─────────────────────────────────────────────────────────────────────

export interface WatchlistItem {
  id: number;
  symbol: string;
  market: 'crypto' | 'stock';
  added_at: number;
}

export interface Position {
  id: number;
  symbol: string;
  market: string;
  exchange: string;
  side: 'long' | 'short';
  size: number;
  entry_price: number;
  current_price?: number;
  pnl?: number;
  liquidation_price?: number;
  opened_at: number;
}

interface Store {
  watchlist: WatchlistItem[];
  positions: Position[];
  expo_tokens: string[];
  _nextId: number;
}

// ── JSON file store ───────────────────────────────────────────────────────────

const dbPath = path.join(dataDir, 'terminal.json');

function load(): Store {
  try {
    return JSON.parse(fs.readFileSync(dbPath, 'utf8'));
  } catch {
    return { watchlist: [], positions: [], expo_tokens: [], _nextId: 1 };
  }
}

function save(store: Store) {
  fs.writeFileSync(dbPath, JSON.stringify(store, null, 2));
}

// ── Watchlist ─────────────────────────────────────────────────────────────────

export const getWatchlist = (): WatchlistItem[] => load().watchlist;

export const addToWatchlist = (symbol: string, market: 'crypto' | 'stock') => {
  const store = load();
  const s = symbol.toUpperCase();
  if (store.watchlist.some(w => w.symbol === s)) return;
  store.watchlist.unshift({ id: store._nextId++, symbol: s, market, added_at: Date.now() });
  save(store);
};

export const removeFromWatchlist = (symbol: string) => {
  const store = load();
  store.watchlist = store.watchlist.filter(w => w.symbol !== symbol.toUpperCase());
  save(store);
};

// ── Positions ─────────────────────────────────────────────────────────────────

export const getPositions = (): Position[] => load().positions;

export const upsertPosition = (data: {
  symbol: string; market: string; exchange: string;
  side: string; size: number; entry_price: number;
  current_price?: number; pnl?: number; liquidation_price?: number;
}) => {
  const store = load();
  const idx = store.positions.findIndex(
    p => p.symbol === data.symbol && p.exchange === data.exchange
  );
  const pos: Position = {
    id: idx >= 0 ? store.positions[idx].id : store._nextId++,
    symbol: data.symbol,
    market: data.market,
    exchange: data.exchange,
    side: data.side as 'long' | 'short',
    size: data.size,
    entry_price: data.entry_price,
    current_price: data.current_price,
    pnl: data.pnl,
    liquidation_price: data.liquidation_price,
    opened_at: idx >= 0 ? store.positions[idx].opened_at : Date.now(),
  };
  if (idx >= 0) store.positions[idx] = pos;
  else store.positions.unshift(pos);
  save(store);
};

export const removePosition = (id: number) => {
  const store = load();
  store.positions = store.positions.filter(p => p.id !== id);
  save(store);
};

// ── Expo tokens ───────────────────────────────────────────────────────────────

export const saveExpoToken = (token: string) => {
  const store = load();
  if (!store.expo_tokens.includes(token)) {
    store.expo_tokens.push(token);
    save(store);
  }
};

export const getExpoTokens = (): string[] => load().expo_tokens;
