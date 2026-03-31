import { useState, useEffect, useCallback } from 'react';

interface HlData {
  configured: boolean;
  wallet?: string;
  accountValue?: number;
  withdrawable?: number;
  marginUsed?: number;
  positionNotional?: number;
  error?: string;
}

interface BinanceData {
  configured: boolean;
  balances?: { asset: string; free: number; locked: number }[];
  error?: string;
}

interface IbkrData {
  configured: boolean;
  accountId?: string;
  netLiquidation?: number;
  totalCash?: number;
  availableFunds?: number;
  grossPosition?: number;
  currency?: string;
  error?: string;
}

interface BalancesData {
  hyperliquid?: HlData;
  binance?: BinanceData;
  ibkr?: IbkrData;
}

function fmtUsd(n: number | undefined) {
  if (n == null) return '—';
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtAsset(n: number, asset: string) {
  const stable = ['USDT', 'USDC', 'BUSD', 'DAI', 'TUSD', 'FDUSD'];
  if (stable.includes(asset)) return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (n >= 1) return n.toLocaleString(undefined, { maximumFractionDigits: 6 });
  return n.toPrecision(4);
}

function StatusDot({ ok }: { ok: boolean }) {
  return <span className={`balance-dot ${ok ? 'balance-dot--ok' : 'balance-dot--off'}`} />;
}

function Row({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="balance-row">
      <span className="balance-key">{label}</span>
      <span className={`balance-value${accent ? ' balance-value--accent' : ''}`}>{value}</span>
    </div>
  );
}

function ExchangeCard({ title, dot, wallet, children }: {
  title: string;
  dot: boolean;
  wallet?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="balance-exchange">
      <div className="balance-exchange-header">
        <StatusDot ok={dot} />
        <span className="balance-exchange-name">{title}</span>
        {wallet && <span className="balance-wallet">{wallet}</span>}
      </div>
      {children}
    </div>
  );
}

export function Balances({ onClose }: { onClose?: () => void }) {
  const [data, setData] = useState<BalancesData | null>(null);
  const [loading, setLoading] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('http://localhost:3000/balances');
      if (res.ok) {
        setData(await res.json());
        setUpdatedAt(new Date());
      }
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, []);

  const hl = data?.hyperliquid;
  const bn = data?.binance;
  const ib = data?.ibkr;

  return (
    <div className="balances-panel">
      <div className="settings-header">
        <span>Balances</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button className="btn-icon" onClick={refresh} title="Refresh" style={{ fontSize: 14 }}>
            {loading ? '…' : '↻'}
          </button>
          {onClose && <button className="btn-icon" onClick={onClose}>✕</button>}
        </div>
      </div>

      <div className="balances-body">
        {updatedAt && (
          <div className="balance-updated">Updated {updatedAt.toLocaleTimeString()}</div>
        )}

        {/* Hyperliquid */}
        <ExchangeCard
          title="Hyperliquid"
          dot={!!(hl?.configured && !hl.error)}
          wallet={hl?.wallet ? `${hl.wallet.slice(0, 6)}…${hl.wallet.slice(-4)}` : undefined}
        >
          {!hl ? (
            <div className="balance-loading">Loading...</div>
          ) : !hl.configured ? (
            <div className="balance-unconfigured">HYPERLIQUID_WALLET_ADDRESS not set</div>
          ) : hl.error ? (
            <div className="balance-error">{hl.error}</div>
          ) : (
            <>
              <Row label="Account Value"     value={fmtUsd(hl.accountValue)} accent />
              <Row label="Withdrawable"      value={fmtUsd(hl.withdrawable)} />
              <Row label="Margin Used"       value={fmtUsd(hl.marginUsed)} />
              <Row label="Open Notional"     value={fmtUsd(hl.positionNotional)} />
            </>
          )}
        </ExchangeCard>

        {/* Binance */}
        <ExchangeCard title="Binance" dot={!!(bn?.configured && !bn.error)}>
          {!bn ? (
            <div className="balance-loading">Loading...</div>
          ) : !bn.configured ? (
            <div className="balance-unconfigured">BINANCE_API_KEY not set</div>
          ) : bn.error ? (
            <div className="balance-error">{bn.error}</div>
          ) : bn.balances?.length === 0 ? (
            <div className="balance-unconfigured">No assets with balance</div>
          ) : (
            <div className="balance-asset-list">
              {bn.balances?.map(b => (
                <div key={b.asset} className="balance-asset">
                  <span className="balance-asset-name">{b.asset}</span>
                  <span className="balance-asset-free">{fmtAsset(b.free, b.asset)}</span>
                  {b.locked > 0 && (
                    <span className="balance-asset-locked">{fmtAsset(b.locked, b.asset)} locked</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </ExchangeCard>

        {/* IBKR */}
        <ExchangeCard
          title="IBKR"
          dot={!!(ib?.configured && !ib.error)}
          wallet={ib?.accountId}
        >
          {!ib ? (
            <div className="balance-loading">Loading...</div>
          ) : !ib.configured ? (
            <div className="balance-unconfigured">IBKR_ENABLED not set to true</div>
          ) : ib.error ? (
            <div className="balance-error">{ib.error}</div>
          ) : (
            <>
              <Row label={`Net Liquidation (${ib.currency ?? 'USD'})`} value={fmtUsd(ib.netLiquidation)} accent />
              <Row label="Total Cash"        value={fmtUsd(ib.totalCash)} />
              <Row label="Available Funds"   value={fmtUsd(ib.availableFunds)} />
              <Row label="Gross Position"    value={fmtUsd(ib.grossPosition)} />
            </>
          )}
        </ExchangeCard>
      </div>
    </div>
  );
}
