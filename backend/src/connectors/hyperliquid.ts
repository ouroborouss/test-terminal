import WebSocket from 'ws';
import axios from 'axios';
import https from 'https';
import { ethers } from 'ethers';
import { encode } from '@msgpack/msgpack';
import { broadcast } from '../ws/server';

const BASE_URL = 'https://api.hyperliquid.xyz';
const WS_URL = 'wss://api.hyperliquid.xyz/ws';

// Persistent HTTPS agent — reuses TCP connections to HL (no handshake per order)
const hlAgent = new https.Agent({ keepAlive: true, maxSockets: 8 });
const hlAxios = axios.create({ httpsAgent: hlAgent });

// Cached wallet — created once, not per-order
let _wallet: ethers.Wallet | null = null;
function getWallet(privateKey: string): ethers.Wallet {
  if (!_wallet || _wallet.privateKey !== privateKey) _wallet = new ethers.Wallet(privateKey);
  return _wallet;
}

let ws: WebSocket | null = null;
let subscribedCoins: string[] = [];
let intentionalClose = false;

// ── Price streaming ───────────────────────────────────────────────────────────

export function subscribePrices(coins: string[]) {
  if (coins.length === 0) return;
  subscribedCoins = coins;

  // Tear down existing connection cleanly
  if (ws) {
    intentionalClose = true;
    ws.terminate();
    ws = null;
  }
  intentionalClose = false;

  ws = new WebSocket(WS_URL);

  ws.on('open', () => {
    ws!.send(JSON.stringify({ method: 'subscribe', subscription: { type: 'allMids' } }));
  });

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.channel === 'allMids' && msg.data?.mids) {
        for (const coin of subscribedCoins) {
          if (msg.data.mids[coin]) {
            broadcast({
              type: 'price',
              payload: { exchange: 'hyperliquid', symbol: coin, price: parseFloat(msg.data.mids[coin]), time: Date.now() },
            });
          }
        }
      }
    } catch {}
  });

  ws.on('close', () => {
    if (intentionalClose) return;
    setTimeout(() => {
      if (!intentionalClose) subscribePrices(subscribedCoins);
    }, 5000);
  });

  ws.on('error', () => {
    // Suppress — close handler will reconnect
  });
}

// ── Asset index ───────────────────────────────────────────────────────────────

let assetIndex: Record<string, number> = {};
let szDecimals: Record<string, number> = {};   // per-asset lot size precision

export async function loadAssetIndex() {
  const res = await axios.post(`${BASE_URL}/info`, { type: 'meta' });
  const universe: { name: string; szDecimals: number }[] = res.data?.universe ?? [];
  assetIndex  = Object.fromEntries(universe.map((a, i) => [a.name, i]));
  szDecimals  = Object.fromEntries(universe.map(a => [a.name, a.szDecimals ?? 2]));
  console.log(`[Hyperliquid] Loaded ${universe.length} assets`);
}

export function getAssetList(): string[] {
  return Object.keys(assetIndex);
}

// ── Signing (EIP-712 + msgpack) ───────────────────────────────────────────────

const EIP712_DOMAIN = {
  chainId: 1337,
  name: 'Exchange',
  verifyingContract: '0x0000000000000000000000000000000000000000',
  version: '1',
};

const AGENT_TYPES = {
  Agent: [
    { name: 'source',       type: 'string'  },
    { name: 'connectionId', type: 'bytes32' },
  ],
};

function actionHash(action: unknown, vaultAddress: string | null, nonce: number): string {
  const msgpackBytes = encode(action);
  const nonceBuf = Buffer.alloc(8);
  nonceBuf.writeBigUInt64BE(BigInt(nonce));

  const parts: Buffer[] = [Buffer.from(msgpackBytes), nonceBuf];
  if (vaultAddress) {
    parts.push(Buffer.from([1]));
    parts.push(Buffer.from(vaultAddress.replace('0x', ''), 'hex'));
  } else {
    parts.push(Buffer.from([0]));
  }

  return ethers.keccak256(Buffer.concat(parts));
}

async function signL1Action(wallet: ethers.Wallet, action: unknown, nonce: number): Promise<{ r: string; s: string; v: number }> {
  const connId = actionHash(action, null, nonce);
  const sig = await wallet.signTypedData(EIP712_DOMAIN, AGENT_TYPES, { source: 'a', connectionId: connId });
  const { r, s, v } = ethers.Signature.from(sig);
  return { r, s, v };
}

// ── Order execution ───────────────────────────────────────────────────────────

function floatToWire(x: number): string {
  if (x === 0) return '0';
  return x.toPrecision(5).replace(/\.?0+$/, '');
}

// Round sz DOWN to the asset's lot size (szDecimals)
function roundSz(sz: number, coin: string): number {
  const dec = szDecimals[coin] ?? 2;
  const factor = Math.pow(10, dec);
  return Math.floor(sz * factor) / factor;
}

// Cache leverage per coin — only call updateLeverage when it actually changes
const _levCache: Record<string, { lev: number; cross: boolean }> = {};

async function updateLeverage(wallet: ethers.Wallet, idx: number, coin: string, leverage: number, isCross: boolean) {
  const cached = _levCache[coin];
  if (cached?.lev === leverage && cached?.cross === isCross) return; // already set, skip round-trip
  const nonce = Date.now();
  const action = { type: 'updateLeverage', asset: idx, isCross, leverage };
  const signature = await signL1Action(wallet, action, nonce);
  const res = await axios.post(`${BASE_URL}/exchange`, { action, nonce, signature });
  if (res.data?.status === 'ok') _levCache[coin] = { lev: leverage, cross: isCross };
  console.log(`[HL] setLeverage ${coin} ${leverage}x cross=${isCross}:`, res.data?.status);
}

export async function placeOrder(params: {
  privateKey: string;
  coin: string;
  isBuy: boolean;
  sz: number;
  limitPx: number;   // pass live price from frontend — backend skips allMids fetch
  orderType: 'market' | 'limit';
  reduceOnly?: boolean;
  leverage?: number;
  crossMargin?: boolean;
}) {
  const wallet = new ethers.Wallet(params.privateKey);
  const idx = assetIndex[params.coin];
  if (idx === undefined) throw new Error(`Unknown asset: ${params.coin}`);

  // Round sz to asset's lot size and validate
  const sz = roundSz(params.sz, params.coin);
  const dec = szDecimals[params.coin] ?? 2;
  const minSz = Math.pow(10, -dec);
  if (sz < minSz) {
    throw new Error(`Size too small for ${params.coin}: need at least ${minSz} (got ${params.sz.toFixed(dec + 2)}). Increase your trade size in Settings.`);
  }

  // Set leverage — skipped if unchanged (cached), runs in parallel with price logic
  const leverage = params.leverage ?? 5;
  const isCross = params.crossMargin ?? true;
  const levPromise = updateLeverage(wallet, idx, params.coin, leverage, isCross);

  // Use limitPx from frontend if provided (frontend has live price already)
  // Only fall back to allMids fetch if limitPx is 0/missing
  let px = params.limitPx;
  if (params.orderType === 'market' && !(px > 0)) {
    try {
      const mids = await axios.post(`${BASE_URL}/info`, { type: 'allMids' });
      const mid = parseFloat(mids.data?.[params.coin] ?? '0');
      px = mid > 0 ? (params.isBuy ? mid * 1.03 : mid * 0.97) : 0;
    } catch { px = 0; }
  } else if (params.orderType === 'market' && px > 0) {
    // Apply slippage to the frontend price
    px = params.isBuy ? px * 1.03 : px * 0.97;
  }

  await levPromise; // ensure leverage is set before order

  const order = {
    a: idx,
    b: params.isBuy,
    p: floatToWire(px),
    s: floatToWire(sz),
    r: params.reduceOnly ?? false,
    t: params.orderType === 'market'
      ? { limit: { tif: 'Ioc' } }   // Hyperliquid market = IOC limit
      : { limit: { tif: 'Gtc' } },
  };

  const action = { type: 'order', orders: [order], grouping: 'na' };
  const signature = await signL1Action(wallet, action, nonce);

  const res = await axios.post(`${BASE_URL}/exchange`, { action, nonce, signature });
  return res.data;
}

// ── Cancel order ─────────────────────────────────────────────────────────────

export async function cancelOrder(params: { privateKey: string; coin: string; oid: number }) {
  const wallet = new ethers.Wallet(params.privateKey);
  const idx = assetIndex[params.coin];
  if (idx === undefined) throw new Error(`Unknown asset: ${params.coin}`);
  const nonce = Date.now();
  const action = { type: 'cancel', cancels: [{ a: idx, o: params.oid }] };
  const signature = await signL1Action(wallet, action, nonce);
  const res = await axios.post(`${BASE_URL}/exchange`, { action, nonce, signature });
  return res.data;
}

// ── TP/SL orders ─────────────────────────────────────────────────────────────

export async function placeTpSl(params: {
  privateKey: string;
  coin: string;
  isBuy: boolean;      // direction to CLOSE (opposite of position side)
  sz: number;
  triggerPx: number;
  tpsl: 'tp' | 'sl';
}) {
  const wallet = new ethers.Wallet(params.privateKey);
  const idx = assetIndex[params.coin];
  if (idx === undefined) throw new Error(`Unknown asset: ${params.coin}`);
  const nonce = Date.now();

  const order = {
    a: idx,
    b: params.isBuy,
    p: floatToWire(params.triggerPx),
    s: floatToWire(params.sz),
    r: true,
    t: { trigger: { isMarket: true, triggerPx: floatToWire(params.triggerPx), tpsl: params.tpsl } },
  };

  const action = { type: 'order', orders: [order], grouping: 'na' };
  const signature = await signL1Action(wallet, action, nonce);
  const res = await axios.post(`${BASE_URL}/exchange`, { action, nonce, signature });
  return res.data;
}

// ── Positions ─────────────────────────────────────────────────────────────────

export async function getPositions(walletAddress: string) {
  const res = await axios.post(`${BASE_URL}/info`, { type: 'clearinghouseState', user: walletAddress });
  return res.data?.assetPositions ?? [];
}
