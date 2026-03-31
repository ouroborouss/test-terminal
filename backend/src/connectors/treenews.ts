import WebSocket from 'ws';
import { broadcast } from '../ws/server';
import { sendPushNotification } from '../notifications/expo';

const WS_URL = 'wss://news.treeofalpha.com/ws';

export interface NewsItem {
  type: 'news';
  id: string;
  title: string;
  body?: string;
  source: string;
  url?: string;
  time: number;
  symbols?: string[];
  image?: string;
}

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

export function connectTreeNews(apiKey: string) {
  if (ws) ws.terminate();

  ws = new WebSocket(`${WS_URL}?api_key=${apiKey}`);

  ws.on('open', () => {
    console.log('[TreeNews] Connected');
  });

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());

      // Debug: log structure of every incoming message to the backend console
      console.log('[TreeNews] raw:', JSON.stringify({
        type: msg.type, source: msg.source,
        en: msg.en?.slice?.(0, 80),
        title: msg.title?.slice?.(0, 80),
        body: msg.body?.slice?.(0, 80),
        suggestions: msg.suggestions,
        keys: Object.keys(msg),
      }));

      // Skip ping / heartbeat / non-news frames
      if (!msg.title && !msg.en && !msg.body) return;

      // Strip HTML tags from body before using it as a fallback title
      const stripHtml = (s: string) => s.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

      // For social posts, msg.title is the account name "Foo (@FooBar)" and the actual
      // content is in msg.body. Detect this pattern and use body as the headline instead.
      const isAccountTitle = /\(@\w+\)/.test(msg.title ?? '');
      let rawTitle: string;
      if (msg.en) {
        rawTitle = msg.en;
      } else if (isAccountTitle) {
        // Social post: title = account name, content is in body
        const bodyText = msg.body ? stripHtml(msg.body) : '';
        rawTitle = bodyText || (msg.image ? '[Image]' : '');
      } else {
        rawTitle = msg.title || (msg.body ? stripHtml(msg.body) : '');
      }
      const title = rawTitle.trim();
      if (!title) return; // still empty after all fallbacks — skip

      // Strip base64 images — they can be several MB and crash the renderer.
      // Only keep plain https:// image URLs.
      const image = typeof msg.image === 'string' && msg.image.startsWith('http')
        ? msg.image
        : undefined;

      // Filter suggestions to valid-looking ticker symbols only (2-10 uppercase letters/digits)
      const rawSymbols: string[] = msg.suggestions ?? msg.symbols ?? [];
      const symbols = rawSymbols.filter(s => /^[A-Z0-9]{2,10}$/.test(s));

      const news: NewsItem = {
        type:    'news',
        id:      msg._id ?? msg.id ?? `tree_${Date.now()}`,
        title,
        body:    msg.body ?? undefined,
        source:  isAccountTitle ? (msg.title ?? msg.source ?? 'TreeNews') : (msg.source ?? 'TreeNews'),
        url:     msg.url ?? undefined,
        time:    msg.time ?? Date.now(),
        symbols,
        image,
      };

      // Broadcast to all connected desktop/mobile clients
      broadcast({ type: 'news', payload: news });

      // Push notification to iPhone
      sendPushNotification({
        title: news.source,
        body:  news.title,
        data:  { newsId: news.id },
      });
    } catch (err) {
      console.error('[TreeNews] Parse error:', err);
    }
  });

  ws.on('close', () => {
    console.log('[TreeNews] Disconnected, reconnecting in 3s...');
    reconnectTimer = setTimeout(() => connectTreeNews(apiKey), 3000);
  });

  ws.on('error', (err) => {
    console.error('[TreeNews] Error:', err.message);
  });
}

export function disconnectTreeNews() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  if (ws) ws.terminate();
}
