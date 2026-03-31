import { useEffect } from 'react';
import { useStore } from '../store';

declare global {
  interface Window {
    electronAPI?: {
      showOverlay: (news: unknown) => void;
      dismissOverlay: () => void;
      onOverlayNews: (cb: (news: unknown) => void) => () => void;
      onMouseBtnBuy: (cb: () => void) => () => void;
      onMouseBtnSell: (cb: () => void) => () => void;
      dismissCli: () => void;
    };
  }
}

export function NewsBanner() {
  const { bannerNews, dismissBanner } = useStore();

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    dismissBanner();
  };

  // Auto-dismiss after 8 seconds
  useEffect(() => {
    if (!bannerNews) return;
    const timer = setTimeout(dismissBanner, 8000);
    return () => clearTimeout(timer);
  }, [bannerNews]);

  // Mouse button trade is handled in App.tsx (has access to quickTrade + prices)

  if (!bannerNews) return null;

  return (
    <div className="news-banner" onContextMenu={handleContextMenu}>
      <div className="news-banner-source">{bannerNews.source}</div>
      <div className="news-banner-title">{bannerNews.title}</div>
      {bannerNews.symbols && bannerNews.symbols.length > 0 && (
        <div className="news-banner-symbols">
          {bannerNews.symbols.map(s => (
            <span key={s} className="news-banner-symbol">{s}</span>
          ))}
        </div>
      )}
      <div className="news-banner-hint">Right-click to dismiss</div>
    </div>
  );
}
