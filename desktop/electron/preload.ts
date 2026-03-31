import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  // Main window → show overlay with news
  showOverlay: (news: unknown) => ipcRenderer.send('show-overlay', news),

  // Overlay → dismiss itself
  dismissOverlay: () => ipcRenderer.send('dismiss-overlay'),

  // Overlay receives news
  onOverlayNews: (cb: (news: unknown) => void) => {
    ipcRenderer.on('overlay-news', (_e, news) => cb(news));
    return () => ipcRenderer.removeAllListeners('overlay-news');
  },

  // Mouse button shortcuts (both windows)
  onMouseBtnBuy: (cb: () => void) => {
    ipcRenderer.on('mouse-btn-buy', cb);
    return () => ipcRenderer.removeListener('mouse-btn-buy', cb);
  },
  onMouseBtnSell: (cb: () => void) => {
    ipcRenderer.on('mouse-btn-sell', cb);
    return () => ipcRenderer.removeListener('mouse-btn-sell', cb);
  },

  // CLI banner
  dismissCli: () => ipcRenderer.send('dismiss-cli'),
});
