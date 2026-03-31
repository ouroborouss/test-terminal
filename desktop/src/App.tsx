import { useState, useRef, useCallback, useEffect } from 'react';
import { useBackend } from './hooks/useBackend';
import { NewsFeed } from './components/NewsFeed';
import { Watchlist } from './components/Watchlist';
import { Positions } from './components/Positions';
import { OrderPanel } from './components/OrderPanel';
import { Settings } from './components/Settings';
import { Chart } from './components/Chart';
import { useSettings } from './settings';
import { useStore } from './store';
import './App.css';

type SidebarView = 'none' | 'settings' | 'order';

function fmtSize(n: number): string {
  if (n >= 1_000_000) return `${n / 1_000_000}M`;
  if (n >= 1_000) return `${n / 1_000}K`;
  return String(n);
}

export default function App() {
  useBackend();
  const [sidebarView, setSidebarView] = useState<SidebarView>('none');
  const [tradeStatus, setTradeStatus] = useState<string | null>(null);
  const [posHeight, setPosHeight] = useState(220);
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef<{ startY: number; startH: number } | null>(null);

  const onResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = { startY: e.clientY, startH: posHeight };
    setIsDragging(true);
    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const delta = dragRef.current.startY - ev.clientY;
      setPosHeight(Math.max(80, Math.min(600, dragRef.current.startH + delta)));
    };
    const onUp = () => {
      dragRef.current = null;
      setIsDragging(false);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [posHeight]);
  const { testMode, set: setSettings, defaultExchange, tradeSizes, tradeSizes2, hlLeverage, hlCrossMargin } = useSettings();
  const { selectedSymbol, bannerNews, prices, addTestPosition } = useStore();

  const toggle = (view: SidebarView) =>
    setSidebarView(v => v === view ? 'none' : view);

  const sym = selectedSymbol?.symbol ?? '';
  const price = sym ? (prices[sym] ?? prices[sym + 'USDT']) : undefined;

  // quickTrade accepts an optional symbol override (used by mouse-button shortcuts)
  const quickTrade = async (isBuy: boolean, size: number, symOverride?: string) => {
    const tradeSym = symOverride ?? sym;
    if (!tradeSym) return;
    const tradePrice = prices[tradeSym] ?? prices[tradeSym + 'USDT'];
    if (!tradePrice) { setTradeStatus('No price — wait'); setTimeout(() => setTradeStatus(null), 2000); return; }
    const coinQty = size / tradePrice;   // always USD → coins, never raw size
    setTradeStatus('...');

    if (testMode) {
      addTestPosition({
        symbol: tradeSym, market: 'crypto',
        exchange: `${defaultExchange} [TEST]`,
        side: isBuy ? 'long' : 'short',
        size: coinQty, entry_price: tradePrice,
        current_price: tradePrice, pnl: 0,
      });
      setTradeStatus(`[TEST] ${isBuy ? 'L' : 'S'} ${tradeSym} $${size}`);
      setTimeout(() => setTradeStatus(null), 2000);
      return;
    }

    let endpoint: string;
    let body: Record<string, unknown>;

    if (defaultExchange === 'hyperliquid') {
      endpoint = '/order/hyperliquid';
      body = { coin: tradeSym, isBuy, sz: coinQty, limitPx: tradePrice, orderType: 'market', leverage: hlLeverage, crossMargin: hlCrossMargin };
    } else if (defaultExchange === 'binance') {
      endpoint = '/order/binance';
      body = { symbol: tradeSym + 'USDT', side: isBuy ? 'BUY' : 'SELL', type: 'MARKET', quantity: coinQty };
    } else {
      endpoint = '/order/ibkr';
      body = { symbol: tradeSym, side: isBuy ? 'BUY' : 'SELL', orderType: 'MARKET', quantity: coinQty, tif: 'DAY' };
    }

    try {
      const res = await fetch(`http://localhost:3000${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      setTradeStatus(res.ok ? `${isBuy ? 'Long' : 'Short'} sent` : `Error: ${data.error}`);
    } catch {
      setTradeStatus('Failed');
    }
    setTimeout(() => setTradeStatus(null), 3000);
  };

  const size1 = tradeSizes[defaultExchange as keyof typeof tradeSizes] ?? 100;
  const size2 = tradeSizes2[defaultExchange as keyof typeof tradeSizes2] ?? 500;

  // Mouse button shortcuts — trade the banner symbol (primary), else chart symbol
  useEffect(() => {
    const getBannerSym = () => bannerNews?.symbols?.[0] ?? undefined;
    const unBuy  = window.electronAPI?.onMouseBtnBuy(()  => quickTrade(true,  size1, getBannerSym()));
    const unSell = window.electronAPI?.onMouseBtnSell(() => quickTrade(false, size1, getBannerSym()));
    return () => { unBuy?.(); unSell?.(); };
  }, [bannerNews, size1, prices, defaultExchange]);

  return (
    <div className="app">
      <header className="titlebar">
        <span className="titlebar-name">FD Terminal</span>
        {sym && <span className="titlebar-symbol">{sym}</span>}
        {sym && (
          <div className="titlebar-trade-btns">
            <button className="tb-long" onClick={() => quickTrade(true, size1)} title={`Long $${size1}`}>{fmtSize(size1)}</button>
            <button className="tb-long" onClick={() => quickTrade(true, size2)} title={`Long $${size2}`}>{fmtSize(size2)}</button>
            <span className="titlebar-trade-sep" />
            <button className="tb-short" onClick={() => quickTrade(false, size1)} title={`Short $${size1}`}>{fmtSize(size1)}</button>
            <button className="tb-short" onClick={() => quickTrade(false, size2)} title={`Short $${size2}`}>{fmtSize(size2)}</button>
          </div>
        )}
        {tradeStatus && <span className="titlebar-trade-status">{tradeStatus}</span>}
        <div className="titlebar-right">
          <button
            className="titlebar-test-btn"
            onClick={() => fetch('http://localhost:3000/test/news', { method: 'POST' })}
            title="Send test notification"
          >test notif</button>
          <button
            className={`titlebar-testmode-btn ${testMode ? 'active' : ''}`}
            onClick={() => setSettings({ testMode: !testMode })}
            title="Toggle test mode — simulates trades without sending to exchange"
          >{testMode ? 'TEST MODE ON' : 'test mode'}</button>
          <button
            className={`titlebar-icon-btn ${sidebarView === 'order' ? 'active' : ''}`}
            onClick={() => toggle('order')}
            title="Order Panel / Watchlist"
          >+</button>
          <button
            className={`titlebar-icon-btn ${sidebarView === 'settings' ? 'active' : ''}`}
            onClick={() => toggle('settings')}
            title="Settings"
          >⚙</button>
        </div>
      </header>

      <div className="layout">
        {sidebarView !== 'none' && (
          <aside className="sidebar-left">
            {sidebarView === 'settings'
              ? <Settings onClose={() => setSidebarView('none')} />
              : <>
                  <Watchlist />
                  <OrderPanel />
                </>
            }
          </aside>
        )}
        <div className="main-left">
          <div className="chart-area">
            <Chart />
          </div>
          <div
            className={`resize-handle ${isDragging ? 'dragging' : ''}`}
            onMouseDown={onResizeStart}
          />
          <div className="positions-wrapper" style={{ height: posHeight }}>
            <Positions />
          </div>
        </div>
        <div className="news-right">
          <NewsFeed />
        </div>
      </div>
    </div>
  );
}
