import WebSocket from 'ws';
import axios from 'axios';
import crypto from 'crypto';
import { broadcast } from '../ws/server';

const BASE_URL = 'https://api.binance.com';
const WS_BASE = 'wss://stream.binance.com:9443/ws';

let priceWs: WebSocket | null = null;
let subscribedSymbols: string[] = [];

function sign(query: string, secret: string) {
  return crypto.createHmac('sha256', secret).update(query).digest('hex');
}

// Price streaming
export function subscribePrices(symbols: string[]) {
  subscribedSymbols = symbols;
  if (priceWs) priceWs.terminate();

  const streams = symbols.map(s => `${s.toLowerCase()}@aggTrade`).join('/');
  priceWs = new WebSocket(`${WS_BASE}/${streams}`);

  priceWs.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      broadcast({
        type: 'price',
        payload: {
          exchange: 'binance',
          symbol: msg.s,
          price: parseFloat(msg.p),
          time: msg.T,
        },
      });
    } catch {}
  });

  priceWs.on('close', () => {
    setTimeout(() => subscribePrices(subscribedSymbols), 3000);
  });

  priceWs.on('error', (err) => console.error('[Binance] WS error:', err.message));
}

// Order execution
export async function placeOrder(params: {
  apiKey: string;
  apiSecret: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  type: 'MARKET' | 'LIMIT';
  quantity: number;
  price?: number;
}) {
  const { apiKey, apiSecret, symbol, side, type, quantity, price } = params;
  const timestamp = Date.now();

  let query = `symbol=${symbol}&side=${side}&type=${type}&quantity=${quantity}&timestamp=${timestamp}`;
  if (type === 'LIMIT' && price) {
    query += `&price=${price}&timeInForce=GTC`;
  }

  const signature = sign(query, apiSecret);

  const res = await axios.post(
    `${BASE_URL}/api/v3/order?${query}&signature=${signature}`,
    null,
    { headers: { 'X-MBX-APIKEY': apiKey } }
  );

  return res.data;
}

// Account positions
export async function getPositions(apiKey: string, apiSecret: string) {
  const timestamp = Date.now();
  const query = `timestamp=${timestamp}`;
  const signature = sign(query, apiSecret);

  const res = await axios.get(
    `${BASE_URL}/api/v3/account?${query}&signature=${signature}`,
    { headers: { 'X-MBX-APIKEY': apiKey } }
  );

  return res.data.balances.filter((b: { free: string; locked: string }) =>
    parseFloat(b.free) > 0 || parseFloat(b.locked) > 0
  );
}
