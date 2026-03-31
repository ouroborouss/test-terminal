import { create } from 'zustand';

export interface NewsItem {
  id: string;
  title: string;
  body?: string;
  source: string;
  url?: string;
  time: number;
  symbols?: string[];
  image?: string;
}

export interface WatchlistItem {
  id: number;
  symbol: string;
  market: 'crypto' | 'stock';
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
  funding_rate?: number;
}

export interface PriceMap {
  [symbol: string]: number;
}

export interface HlOrder {
  coin: string;
  side: 'B' | 'A';
  limitPx: string;
  sz: string;
  origSz: string;
  oid: number;
  timestamp: number;
  orderType: string;
  reduceOnly: boolean;
  tif: string;
}

export interface HlFill {
  coin: string;
  px: string;
  sz: string;
  side: 'B' | 'A';
  time: number;
  dir: string;
  closedPnl: string;
  fee: string;
  oid: number;
  tid: number;
}

export interface TwapJob {
  jobId: string;
  coin: string;
  isBuy: boolean;
  fired: number;
  totalOrders: number;
}

export interface TradeEntry {
  id: string;
  time: number;
  symbol: string;
  exchange: string;
  side: 'long' | 'short';
  size: number;
  price: number;        // execution price
  entryPrice?: number;  // for close trades: original entry (enables PnL calc)
  isClose?: boolean;
  pnl?: number;
  status: 'ok' | 'error';
  note?: string;
}

interface TerminalState {
  news: NewsItem[];
  bannerNews: NewsItem | null;
  watchlist: WatchlistItem[];
  positions: Position[];
  testPositions: Position[];
  prices: PriceMap;
  selectedSymbol: { symbol: string; market: 'crypto' | 'stock' } | null;
  fundingRates: Record<string, number>;
  twapJobs: TwapJob[];
  tradeHistory: TradeEntry[];
  hlOrders: HlOrder[];
  hlFills: HlFill[];

  addNews: (item: NewsItem) => void;
  dismissBanner: () => void;
  setWatchlist: (items: WatchlistItem[]) => void;
  setPositions: (items: Position[]) => void;
  addTestPosition: (pos: Omit<Position, 'id'>) => void;
  clearTestPositions: () => void;
  updatePrice: (symbol: string, price: number) => void;
  setFundingRates: (rates: Record<string, number>) => void;
  setSelectedSymbol: (s: { symbol: string; market: 'crypto' | 'stock' } | null) => void;
  setTwapJob: (job: TwapJob) => void;
  removeTwapJob: (jobId: string) => void;
  addTradeHistory: (entry: TradeEntry) => void;
  setHlOrders: (orders: HlOrder[]) => void;
  setHlFills: (fills: HlFill[]) => void;
}

export const useStore = create<TerminalState>((set) => ({
  news: [],
  bannerNews: null,
  watchlist: [],
  positions: [],
  testPositions: [],
  fundingRates: {},
  prices: {},
  selectedSymbol: null,
  twapJobs: [],
  tradeHistory: [],
  hlOrders: [],
  hlFills: [],

  addNews: (item) => {
    // Strip any base64 image data before storing — large payloads crash the renderer
    const safe = item.image?.startsWith('http') ? item : { ...item, image: undefined };
    set((s) => {
      if (s.news.some(n => n.id === safe.id)) return s; // deduplicate
      return {
        news: [safe, ...s.news].slice(0, 200),
        bannerNews: safe,
      };
    });
  },

  dismissBanner: () => set({ bannerNews: null }),

  setWatchlist: (items) => set({ watchlist: items }),
  setPositions: (items) => set({ positions: items }),
  addTestPosition: (pos) =>
    set((s) => ({
      testPositions: [{ ...pos, id: Date.now() }, ...s.testPositions],
    })),
  clearTestPositions: () => set({ testPositions: [] }),
  updatePrice: (symbol, price) =>
    set((s) => ({ prices: { ...s.prices, [symbol]: price } })),
  setFundingRates: (rates) => set({ fundingRates: rates }),
  setSelectedSymbol: (s) => set({ selectedSymbol: s }),
  setTwapJob: (job) =>
    set((s) => ({
      twapJobs: s.twapJobs.some(j => j.jobId === job.jobId)
        ? s.twapJobs.map(j => j.jobId === job.jobId ? job : j)
        : [...s.twapJobs, job],
    })),
  removeTwapJob: (jobId) =>
    set((s) => ({ twapJobs: s.twapJobs.filter(j => j.jobId !== jobId) })),
  addTradeHistory: (entry) =>
    set((s) => ({ tradeHistory: [entry, ...s.tradeHistory].slice(0, 100) })),
  setHlOrders: (orders) => set({ hlOrders: orders }),
  setHlFills:  (fills)  => set({ hlFills: fills }),
}));
