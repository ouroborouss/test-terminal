# FD Terminal

Multi-exchange news trading terminal built for speed. Monitors live news feeds, displays breaking news alerts, and executes trades on Hyperliquid, Binance, and IBKR from a single interface.

## Features

- Live news feed with breaking news overlay
- One-click and keyboard shortcut trading
- Hyperliquid perpetuals, Binance spot/futures, IBKR stocks
- TWAP execution
- Price charts (crypto + stocks)
- React Native mobile companion app

## Setup

### 1. Install dependencies

```bash
npm install
cd backend && npm install
cd ../desktop && npm install
cd ../mobile && npm install
```

### 2. Configure environment

```bash
cd backend
cp .env.example .env
# Fill in your API keys in backend/.env

cd ../mobile
cp .env.example .env
# Set your backend IP in mobile/.env
```

### 3. Run

```bash
# From repo root
npm run dev
```

Backend runs on `localhost:3000` (HTTP) and `localhost:8080` (WebSocket).

## Stack

| Layer | Tech |
|---|---|
| Backend | Node.js, TypeScript, Express |
| Desktop | Electron, React, Vite, Zustand |
| Charts | lightweight-charts |
| Mobile | Expo, React Native |
