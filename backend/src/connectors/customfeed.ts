import WebSocket from 'ws';
import { broadcast } from '../ws/server';
import { sendPushNotification } from '../notifications/expo';

const WS_URL = 'ws://3.66.89.194:8080';

export interface CustomFeedItem {
  type: 'news';
  id: string;
  title: string;
  body?: string;
  source: string;
  url?: string;
  time: number;
  symbols?: string[];
}

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

function normalise(msg: Record<string, unknown>): CustomFeedItem {
  return {
    type: 'news',
    id: String(msg.id ?? msg._id ?? Date.now()),
    title: String(msg.title ?? msg.headline ?? msg.text ?? msg.body ?? ''),
    body: msg.body ? String(msg.body) : undefined,
    source: String(msg.source ?? msg.feed ?? 'Custom Feed'),
    url: msg.url ? String(msg.url) : undefined,
    time: Number(msg.time ?? msg.timestamp ?? msg.ts ?? Date.now()),
    symbols: Array.isArray(msg.symbols) ? msg.symbols.map(String)
           : Array.isArray(msg.coins)   ? msg.coins.map(String)
           : Array.isArray(msg.tickers) ? msg.tickers.map(String)
           : undefined,
  };
}

export function connectCustomFeed(password: string) {
  if (ws) ws.terminate();

  ws = new WebSocket(WS_URL);

  let authenticated = false;

  ws.on('open', () => {
    console.log('[CustomFeed] Connected, authenticating...');
    ws!.send(password);
  });

  ws.on('message', (data) => {
    try {
      const text = data.toString().trim();
      if (!text) return;

      if (!authenticated) {
        authenticated = true;
        return;
      }

      const raw = JSON.parse(text);

      // Skip auth acknowledgement messages
      if (raw.type === 'auth' || raw.status === 'ok' || raw.authenticated) return;

      const news = normalise(raw);
      if (!news.title) return;

      broadcast({ type: 'news', payload: news });

      sendPushNotification({
        title: news.source,
        body: news.title,
        data: { newsId: news.id },
      });
    } catch {}
  });

  ws.on('close', (code, reason) => {
    console.log(`[CustomFeed] Disconnected — code: ${code}, reason: ${reason.toString() || 'none'}`);
    reconnectTimer = setTimeout(() => connectCustomFeed(password), 3000);
  });

  ws.on('error', (err) => console.error('[CustomFeed] Error:', err.message));
}

export function disconnectCustomFeed() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  if (ws) ws.terminate();
}
