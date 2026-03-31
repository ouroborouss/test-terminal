import { useState, useRef, useEffect } from 'react';
import { useStore } from '../store';
import { useSettings } from '../settings';

type LineType = 'cmd' | 'ok' | 'err' | 'info';
interface ConsoleLine { type: LineType; text: string; }

export function Console() {
  const [lines, setLines] = useState<ConsoleLine[]>([
    { type: 'info', text: 'FD Terminal CLI — type "help" for commands' },
  ]);
  const [input, setInput] = useState('');
  const [cmdHistory, setCmdHistory] = useState<string[]>([]);
  const [histIdx, setHistIdx] = useState(-1);
  const outputRef = useRef<HTMLDivElement>(null);
  const { prices, positions, tradeHistory, addTradeHistory } = useStore();
  const settings = useSettings();

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [lines]);

  const append = (newLines: ConsoleLine[]) => {
    setLines(prev => [...prev, ...newLines].slice(-300));
  };

  const run = async (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) return;

    setCmdHistory(h => [trimmed, ...h].slice(0, 50));
    setHistIdx(-1);
    append([{ type: 'cmd', text: `> ${trimmed}` }]);

    const parts = trimmed.split(/\s+/);
    const cmd = parts[0].toLowerCase();
    const exchange = settings.defaultExchange;
    const defaultSz = settings.tradeSizes[exchange as keyof typeof settings.tradeSizes] ?? 1;

    switch (cmd) {
      case 'long':
      case 'short': {
        const sym = parts[1]?.toUpperCase();
        const usdSz = parseFloat(parts[2] ?? '') || defaultSz;
        if (!sym) { append([{ type: 'err', text: `Usage: ${cmd} <symbol> [usd_size]` }]); break; }
        const px = prices[sym] ?? prices[sym + 'USDT'];
        const sz = px ? usdSz / px : usdSz;
        try {
          const res = await fetch('http://localhost:3000/order/hyperliquid', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ coin: sym, isBuy: cmd === 'long', sz, limitPx: 0, orderType: 'market' }),
          });
          const data = await res.json();
          if (res.ok) {
            append([{ type: 'ok', text: `${cmd.toUpperCase()} $${usdSz} ${sym} (${sz.toPrecision(4)} coins) — sent` }]);
            addTradeHistory({
              id: `trade_${Date.now()}_${Math.random().toString(36).slice(2)}`,
              time: Date.now(), symbol: sym, exchange,
              side: cmd === 'long' ? 'long' : 'short',
              size: sz, price: px ?? 0, status: 'ok',
            });
          } else append([{ type: 'err', text: `Error: ${data.error}` }]);
        } catch { append([{ type: 'err', text: 'Backend unreachable' }]); }
        break;
      }

      case 'tp':
      case 'sl': {
        const sym = parts[1]?.toUpperCase();
        const px = parseFloat(parts[2] ?? '');
        if (!sym || !px) { append([{ type: 'err', text: `Usage: ${cmd} <symbol> <price>` }]); break; }
        const pos = positions.find(p => p.symbol === sym);
        if (!pos) { append([{ type: 'err', text: `No open position for ${sym}` }]); break; }
        try {
          const res = await fetch('http://localhost:3000/order/hyperliquid/tpsl', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ coin: sym, isBuy: pos.side === 'short', sz: pos.size, triggerPx: px, tpsl: cmd }),
          });
          const data = await res.json();
          if (res.ok) append([{ type: 'ok', text: `${cmd.toUpperCase()} set for ${sym} @ $${px}` }]);
          else append([{ type: 'err', text: `Error: ${data.error}` }]);
        } catch { append([{ type: 'err', text: 'Backend unreachable' }]); }
        break;
      }

      case 'close': {
        const sym = parts[1]?.toUpperCase();
        const targets = sym === 'ALL'
          ? positions
          : positions.filter(p => p.symbol === sym);
        if (targets.length === 0) { append([{ type: 'err', text: sym ? `No position for ${sym}` : 'No open positions' }]); break; }
        for (const pos of targets) {
          try {
            const exitPx = prices[pos.symbol] ?? prices[pos.symbol + 'USDT'] ?? 0;
            const res = await fetch('http://localhost:3000/order/hyperliquid', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ coin: pos.symbol, isBuy: pos.side === 'short', sz: pos.size, limitPx: 0, orderType: 'market', reduceOnly: true }),
            });
            const data = await res.json();
            if (res.ok) {
              append([{ type: 'ok', text: `Closed ${pos.symbol} (${pos.side})` }]);
              const lastOpen = tradeHistory.find(t => t.symbol === pos.symbol && !t.isClose && t.status === 'ok');
              const pnl = lastOpen && exitPx
                ? (exitPx - lastOpen.price) * pos.size * (pos.side === 'long' ? 1 : -1)
                : undefined;
              addTradeHistory({
                id: `trade_${Date.now()}_${Math.random().toString(36).slice(2)}`,
                time: Date.now(), symbol: pos.symbol, exchange,
                side: pos.side, size: pos.size, price: exitPx,
                entryPrice: lastOpen?.price, isClose: true, pnl, status: 'ok',
              });
            } else append([{ type: 'err', text: `${pos.symbol}: ${data.error}` }]);
          } catch { append([{ type: 'err', text: `${pos.symbol}: Backend unreachable` }]); }
        }
        break;
      }

      case 'price': {
        const sym = parts[1]?.toUpperCase();
        if (!sym) { append([{ type: 'err', text: 'Usage: price <symbol>' }]); break; }
        const p = prices[sym] ?? prices[sym + 'USDT'];
        append([{ type: 'info', text: p ? `${sym}: $${p.toLocaleString(undefined, { maximumFractionDigits: 8 })}` : `${sym}: no price data` }]);
        break;
      }

      case 'pos': {
        if (positions.length === 0) { append([{ type: 'info', text: 'No open positions' }]); break; }
        append(positions.map(p => ({
          type: 'info' as LineType,
          text: `${p.symbol.padEnd(8)} ${p.side.toUpperCase().padEnd(6)} sz:${p.size}  entry:$${p.entry_price}  pnl:${p.pnl != null ? `$${p.pnl.toFixed(2)}` : '—'}`,
        })));
        break;
      }

      case 'twap': {
        // twap long BTC 0.1 30 5
        const dir = parts[1]?.toLowerCase();
        const sym = parts[2]?.toUpperCase();
        const sz = parseFloat(parts[3] ?? '');
        const intervalSecs = parseInt(parts[4] ?? '');
        const totalOrders = parseInt(parts[5] ?? '');
        if (!['long', 'short'].includes(dir) || !sym || !sz || !intervalSecs || !totalOrders) {
          append([{ type: 'err', text: 'Usage: twap long|short <sym> <size> <intervalSecs> <orders>' }]);
          break;
        }
        try {
          const res = await fetch('http://localhost:3000/order/twap', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ coin: sym, isBuy: dir === 'long', sz, intervalSecs, totalOrders }),
          });
          const data = await res.json();
          if (res.ok) append([{ type: 'ok', text: `TWAP started — ${totalOrders}x ${(sz/totalOrders).toPrecision(4)} ${sym} every ${intervalSecs}s [${data.jobId}]` }]);
          else append([{ type: 'err', text: `Error: ${data.error}` }]);
        } catch { append([{ type: 'err', text: 'Backend unreachable' }]); }
        break;
      }

      case 'cancel': {
        const jobId = parts[1];
        if (!jobId) { append([{ type: 'err', text: 'Usage: cancel <jobId>' }]); break; }
        try {
          const res = await fetch(`http://localhost:3000/order/twap/${jobId}`, { method: 'DELETE' });
          if (res.ok) append([{ type: 'ok', text: `TWAP ${jobId} cancelled` }]);
          else append([{ type: 'err', text: 'Job not found' }]);
        } catch { append([{ type: 'err', text: 'Backend unreachable' }]); }
        break;
      }

      case 'history': {
        if (tradeHistory.length === 0) { append([{ type: 'info', text: 'No trade history' }]); break; }
        append(tradeHistory.slice(0, 20).map(e => ({
          type: (e.status === 'ok' ? 'ok' : 'err') as LineType,
          text: `${new Date(e.time).toLocaleTimeString()}  ${e.side.toUpperCase().padEnd(6)} ${e.size} ${e.symbol.padEnd(8)} [${e.exchange}]${e.note ? `  ${e.note}` : ''}`,
        })));
        break;
      }

      case 'help':
        append([
          { type: 'info', text: 'Commands:' },
          { type: 'info', text: '  long <sym> [sz]                     — market buy (HL)' },
          { type: 'info', text: '  short <sym> [sz]                    — market sell (HL)' },
          { type: 'info', text: '  close <sym|all>                     — reduce-only close' },
          { type: 'info', text: '  tp <sym> <price>                    — set take profit' },
          { type: 'info', text: '  sl <sym> <price>                    — set stop loss' },
          { type: 'info', text: '  price <sym>                         — show current price' },
          { type: 'info', text: '  pos                                 — list open positions' },
          { type: 'info', text: '  twap long|short <sym> <sz> <ivl> <n> — TWAP order' },
          { type: 'info', text: '  cancel <jobId>                      — cancel TWAP job' },
          { type: 'info', text: '  history                             — recent trades' },
          { type: 'info', text: '  clear                               — clear console' },
        ]);
        break;

      case 'clear':
        setLines([]);
        break;

      default:
        append([{ type: 'err', text: `Unknown command: ${cmd}. Type "help" for a list.` }]);
    }
  };

  return (
    <div className="console">
      <div className="panel-header">Console</div>
      <div className="console-output" ref={outputRef}>
        {lines.map((line, i) => (
          <div key={i} className={`console-line console-line--${line.type}`}>{line.text}</div>
        ))}
      </div>
      <div className="console-input-row">
        <span className="console-prompt">›</span>
        <input
          className="console-input"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              run(input);
              setInput('');
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              const idx = Math.min(histIdx + 1, cmdHistory.length - 1);
              setHistIdx(idx);
              if (cmdHistory[idx]) setInput(cmdHistory[idx]);
            } else if (e.key === 'ArrowDown') {
              e.preventDefault();
              const idx = histIdx - 1;
              if (idx < 0) { setHistIdx(-1); setInput(''); }
              else { setHistIdx(idx); setInput(cmdHistory[idx]); }
            }
          }}
          placeholder="Type a command..."
          spellCheck={false}
          autoComplete="off"
        />
      </div>
    </div>
  );
}
