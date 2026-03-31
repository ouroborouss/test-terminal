import { useEffect } from 'react';
import { useStore } from '../store';

const BACKEND_HOST = process.env.EXPO_PUBLIC_BACKEND_HOST ?? '';
const WS_HOST = process.env.EXPO_PUBLIC_WS_HOST ?? '';

export function useBackend() {
  const { addNews, setWatchlist, setPositions, updatePrice } = useStore();

  useEffect(() => {
    let ws: WebSocket;
    let reconnectTimer: ReturnType<typeof setTimeout>;

    function connect() {
      ws = new WebSocket(WS_HOST);

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          switch (msg.type) {
            case 'news':
              addNews(msg.payload);
              break;
            case 'watchlist_update':
              setWatchlist(msg.payload);
              break;
            case 'positions_update':
              setPositions(msg.payload);
              break;
            case 'price':
              updatePrice(msg.payload.symbol, msg.payload.price);
              break;
          }
        } catch {}
      };

      ws.onclose = () => {
        reconnectTimer = setTimeout(connect, 3000);
      };
    }

    connect();

    fetch(`${BACKEND_HOST}/watchlist`)
      .then(r => r.json()).then(setWatchlist).catch(() => {});
    fetch(`${BACKEND_HOST}/positions`)
      .then(r => r.json()).then(setPositions).catch(() => {});

    return () => {
      clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, []);
}

export const BACKEND_HOST_EXPORT = BACKEND_HOST;
