import { create } from 'zustand';

export interface TradeSize {
  binance: number;
  hyperliquid: number;
  ibkr: number;
}

export interface Settings {
  // Quick Trade
  defaultExchange: 'binance' | 'hyperliquid' | 'ibkr';
  tradeSizes: TradeSize;
  tradeSizes2: TradeSize;
  defaultOrderType: 'market' | 'limit';
  requireConfirmation: boolean;

  // Mouse shortcuts
  mouse4Action: 'buy' | 'sell' | 'none';
  mouse5Action: 'buy' | 'sell' | 'none';

  // Overlay
  overlayTimeoutSecs: number;

  // News filters
  watchlistOnly: boolean;
  blockedKeywords: string[];
  disabledSources: string[];

  // Hyperliquid
  hlLeverage: number;
  hlCrossMargin: boolean;

  // IBKR
  ibkrEnabled: boolean;

  // Test mode
  testMode: boolean;

  // VIP alerts
  vipKeywords: string[];
  vipSources: string[];
  vipSound: boolean;

  // AI
  anthropicApiKey: string;
}

interface SettingsStore extends Settings {
  set: (patch: Partial<Settings>) => void;
  addBlockedKeyword: (kw: string) => void;
  removeBlockedKeyword: (kw: string) => void;
  toggleSource: (source: string) => void;
  addVipKeyword: (kw: string) => void;
  removeVipKeyword: (kw: string) => void;
  addVipSource: (src: string) => void;
  removeVipSource: (src: string) => void;
}

const STORAGE_KEY = 'fd_terminal_settings';

function loadFromStorage(): Partial<Settings> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
  } catch {
    return {};
  }
}

function saveToStorage(s: Settings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

const defaults: Settings = {
  defaultExchange: 'hyperliquid',
  tradeSizes: { binance: 100, hyperliquid: 100, ibkr: 10 },
  tradeSizes2: { binance: 500, hyperliquid: 500, ibkr: 5 },
  defaultOrderType: 'market',
  requireConfirmation: false,
  mouse4Action: 'buy',
  mouse5Action: 'sell',
  overlayTimeoutSecs: 12,
  watchlistOnly: false,
  blockedKeywords: [],
  disabledSources: [],
  hlLeverage: 5,
  hlCrossMargin: true,
  ibkrEnabled: false,
  testMode: false,
  vipKeywords: [],
  vipSources: [],
  vipSound: true,
  anthropicApiKey: '',
};

export const useSettings = create<SettingsStore>((set, get) => ({
  ...defaults,
  ...loadFromStorage(),

  set: (patch) => {
    set(patch);
    saveToStorage({ ...get(), ...patch });
  },

  addBlockedKeyword: (kw) => {
    const keywords = [...get().blockedKeywords, kw.toLowerCase().trim()].filter(Boolean);
    set({ blockedKeywords: keywords });
    saveToStorage({ ...get(), blockedKeywords: keywords });
  },

  removeBlockedKeyword: (kw) => {
    const keywords = get().blockedKeywords.filter(k => k !== kw);
    set({ blockedKeywords: keywords });
    saveToStorage({ ...get(), blockedKeywords: keywords });
  },

  toggleSource: (source) => {
    const disabled = get().disabledSources;
    const next = disabled.includes(source)
      ? disabled.filter(s => s !== source)
      : [...disabled, source];
    set({ disabledSources: next });
    saveToStorage({ ...get(), disabledSources: next });
  },

  addVipKeyword: (kw) => {
    const keywords = [...new Set([...get().vipKeywords, kw.toLowerCase().trim()])].filter(Boolean);
    set({ vipKeywords: keywords });
    saveToStorage({ ...get(), vipKeywords: keywords });
  },
  removeVipKeyword: (kw) => {
    const keywords = get().vipKeywords.filter(k => k !== kw);
    set({ vipKeywords: keywords });
    saveToStorage({ ...get(), vipKeywords: keywords });
  },
  addVipSource: (src) => {
    const sources = [...new Set([...get().vipSources, src])];
    set({ vipSources: sources });
    saveToStorage({ ...get(), vipSources: sources });
  },
  removeVipSource: (src) => {
    const sources = get().vipSources.filter(s => s !== src);
    set({ vipSources: sources });
    saveToStorage({ ...get(), vipSources: sources });
  },
}));
