import { useEffect } from 'react';
import { useStore } from '../store';

const WS_URL = 'ws://localhost:8080';

export function useBackend() {
  const { addNews, setWatchlist, setPositions, updatePrice, setFundingRates, setTwapJob, removeTwapJob, setHlOrders, setHlFills } = useStore();

  useEffect(() => {
    let ws: WebSocket;
    let reconnectTimer: ReturnType<typeof setTimeout>;

    function connect() {
      ws = new WebSocket(WS_URL);

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          switch (msg.type) {
            case 'news':
              addNews(msg.payload);
              window.electronAPI?.showOverlay(msg.payload);
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
            case 'funding_rates':
              setFundingRates(msg.payload);
              break;
            case 'twap_progress':
              setTwapJob(msg.payload);
              break;
            case 'twap_done':
              removeTwapJob(msg.payload.jobId);
              break;
            case 'hl_orders':
              setHlOrders(msg.payload);
              break;
            case 'hl_fills':
              setHlFills(msg.payload);
              break;
          }
        } catch {}
      };

      ws.onclose = () => {
        reconnectTimer = setTimeout(connect, 3000);
      };
    }

    connect();

    // Load initial data
    fetch('http://localhost:3000/watchlist')
      .then(r => r.json()).then(setWatchlist).catch(() => {});
    fetch('http://localhost:3000/positions')
      .then(r => r.json()).then(setPositions).catch(() => {});

    return () => {
      clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, []);
}
