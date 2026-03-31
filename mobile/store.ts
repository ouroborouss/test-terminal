import { create } from 'zustand';

export interface NewsItem {
  id: string;
  title: string;
  body?: string;
  source: string;
  url?: string;
  time: number;
  symbols?: string[];
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
}

interface TerminalState {
  news: NewsItem[];
  watchlist: WatchlistItem[];
  positions: Position[];
  prices: Record<string, number>;

  addNews: (item: NewsItem) => void;
  setWatchlist: (items: WatchlistItem[]) => void;
  setPositions: (items: Position[]) => void;
  updatePrice: (symbol: string, price: number) => void;
}

export const useStore = create<TerminalState>((set) => ({
  news: [],
  watchlist: [],
  positions: [],
  prices: {},

  addNews: (item) =>
    set((s) => ({ news: [item, ...s.news].slice(0, 100) })),
  setWatchlist: (items) => set({ watchlist: items }),
  setPositions: (items) => set({ positions: items }),
  updatePrice: (symbol, price) =>
    set((s) => ({ prices: { ...s.prices, [symbol]: price } })),
}));
