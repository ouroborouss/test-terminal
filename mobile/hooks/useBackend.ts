import { useEffect } from 'react';
import { useStore } from '../store';

// Change this to your PC's local IP when on same network
// or your VPS/Tailscale address for remote access
const BACKEND_HOST = 'http://192.168.1.100:3000';
const WS_HOST = 'ws://192.168.1.100:8080';

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
