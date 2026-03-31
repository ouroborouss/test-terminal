import { app, BrowserWindow, globalShortcut, ipcMain, screen } from 'electron';
import path from 'path';

// Crisp rendering on HiDPI / Windows scaling
app.commandLine.appendSwitch('enable-features', 'HighDPISupport');
app.commandLine.appendSwitch('disable-gpu-vsync');

const isDev = !app.isPackaged;

let mainWindow: BrowserWindow | null = null;
let overlayWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1200,
    minHeight: 700,
    backgroundColor: '#0d0d0f',
    title: 'FD Terminal',
    icon: path.join(__dirname, '../../assets/icon.png'),
    titleBarStyle: 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:1420');
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.webContents.on('did-finish-load', () => {
    const scale = screen.getPrimaryDisplay().scaleFactor;
    mainWindow?.webContents.setZoomFactor(scale);
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

function createOverlay() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const overlayW = 540;
  const overlayH = 160;

  overlayWindow = new BrowserWindow({
    width: overlayW,
    height: overlayH,
    x: Math.floor((width - overlayW) / 2),
    y: height - overlayH - 24,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    focusable: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    overlayWindow.loadURL('http://localhost:1420/overlay.html');
  } else {
    overlayWindow.loadFile(path.join(__dirname, '../dist/overlay.html'));
  }

  overlayWindow.webContents.on('did-finish-load', () => {
    const scale = screen.getPrimaryDisplay().scaleFactor;
    overlayWindow?.webContents.setZoomFactor(scale);
  });

  overlayWindow.on('closed', () => { overlayWindow = null; });
}

// Main window sends news → relay to overlay and show it
ipcMain.on('show-overlay', (_event, news) => {
  if (!overlayWindow) return;
  overlayWindow.webContents.send('overlay-news', news);
  overlayWindow.showInactive();
});

// Overlay requests dismiss
ipcMain.on('dismiss-overlay', () => {
  overlayWindow?.hide();
});

app.setName('FD Terminal');

let cliWindow: BrowserWindow | null = null;

function createCli() {
  const { width } = screen.getPrimaryDisplay().workAreaSize;
  const cliW = 480;
  const cliH = 64;

  cliWindow = new BrowserWindow({
    width: cliW,
    height: cliH,
    x: Math.floor((width - cliW) / 2),
    y: 80,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    focusable: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    cliWindow.loadURL('http://localhost:1420/cli.html');
  } else {
    cliWindow.loadFile(path.join(__dirname, '../dist/cli.html'));
  }

  cliWindow.webContents.on('did-finish-load', () => {
    const scale = screen.getPrimaryDisplay().scaleFactor;
    cliWindow?.webContents.setZoomFactor(scale);
  });

  cliWindow.on('blur', () => cliWindow?.hide());
  cliWindow.on('closed', () => { cliWindow = null; });
}

ipcMain.on('dismiss-cli', () => cliWindow?.hide());

app.whenReady().then(() => {
  createWindow();
  createOverlay();
  createCli();

  // Mouse side buttons via AHK remap
  globalShortcut.register('F13', () => {
    mainWindow?.webContents.send('mouse-btn-buy');
    overlayWindow?.webContents.send('mouse-btn-buy');
  });
  globalShortcut.register('F14', () => {
    mainWindow?.webContents.send('mouse-btn-sell');
    overlayWindow?.webContents.send('mouse-btn-sell');
  });

  // Keyboard trade shortcuts
  globalShortcut.register('CommandOrControl+Alt+6', () => {
    mainWindow?.webContents.send('mouse-btn-buy');
    overlayWindow?.webContents.send('mouse-btn-buy');
  });
  globalShortcut.register('CommandOrControl+Alt+2', () => {
    mainWindow?.webContents.send('mouse-btn-sell');
    overlayWindow?.webContents.send('mouse-btn-sell');
  });

  // CLI banner toggle
  globalShortcut.register('CommandOrControl+Alt+L', () => {
    if (!cliWindow) return;
    if (cliWindow.isVisible()) {
      cliWindow.hide();
    } else {
      cliWindow.showInactive();
      cliWindow.focus();
    }
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (mainWindow === null) createWindow();
});
