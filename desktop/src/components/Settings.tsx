import { useState } from 'react';
import { useSettings } from '../settings';

const EXCHANGES = ['binance', 'hyperliquid', 'ibkr'] as const;
const TIMEOUT_OPTIONS = [3, 5, 8, 12, 20, 30, 0]; // 0 = never
const SOUND_KEY = 'fd_terminal_sound';

export function Settings({ onClose }: { onClose: () => void }) {
  const s = useSettings();
  const [newKeyword, setNewKeyword] = useState('');
  const [newVipKeyword, setNewVipKeyword] = useState('');
  const [newVipSource, setNewVipSource] = useState('');
  const [ibkrStatus, setIbkrStatus] = useState<string | null>(null);
  const [soundName, setSoundName] = useState<string>(
    localStorage.getItem(SOUND_KEY) ? 'Custom sound loaded' : 'No sound set'
  );

  const handleSoundUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      localStorage.setItem(SOUND_KEY, reader.result as string);
      setSoundName(file.name);
      // Preview
      new Audio(reader.result as string).play().catch(() => {});
    };
    reader.readAsDataURL(file);
  };

  const clearSound = () => {
    localStorage.removeItem(SOUND_KEY);
    setSoundName('No sound set');
  };

  const toggleIbkr = async (enabled: boolean) => {
    s.set({ ibkrEnabled: enabled });
    setIbkrStatus('Updating...');
    try {
      const res = await fetch('http://localhost:3000/settings/ibkr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      setIbkrStatus(res.ok ? (enabled ? 'IBKR connected' : 'IBKR disabled') : 'Failed');
    } catch {
      setIbkrStatus('Backend unreachable');
    }
    setTimeout(() => setIbkrStatus(null), 3000);
  };

  return (
    <div className="settings-panel">
      <div className="settings-header">
        <span>Settings</span>
        <button className="btn-icon" onClick={onClose}>✕</button>
      </div>

      <div className="settings-body">

        {/* ── Quick Trade ─────────────────────────────── */}
        <section className="settings-section">
          <div className="settings-section-title">Quick Trade</div>

          <div className="settings-row">
            <label>Default Exchange</label>
            <select className="select" value={s.defaultExchange}
              onChange={e => s.set({ defaultExchange: e.target.value as typeof s.defaultExchange })}>
              {EXCHANGES.map(ex => <option key={ex} value={ex}>{ex}</option>)}
            </select>
          </div>

          <div className="settings-row">
            <label>Order Type</label>
            <select className="select" value={s.defaultOrderType}
              onChange={e => s.set({ defaultOrderType: e.target.value as 'market' | 'limit' })}>
              <option value="market">Market</option>
              <option value="limit">Limit</option>
            </select>
          </div>

          <div className="settings-row">
            <label>Require Confirmation</label>
            <input type="checkbox" checked={s.requireConfirmation}
              onChange={e => s.set({ requireConfirmation: e.target.checked })} />
          </div>

          <div className="settings-subsection">Size 1 — Large (USD)</div>
          {EXCHANGES.map(ex => (
            <div className="settings-row" key={ex}>
              <label>{ex.charAt(0).toUpperCase() + ex.slice(1)}</label>
              <input type="number" className="input input-sm"
                value={s.tradeSizes[ex]}
                onChange={e => s.set({ tradeSizes: { ...s.tradeSizes, [ex]: parseFloat(e.target.value) || 0 } })}
              />
            </div>
          ))}

          <div className="settings-subsection">Size 2 — Small (USD)</div>
          {EXCHANGES.map(ex => (
            <div className="settings-row" key={ex}>
              <label>{ex.charAt(0).toUpperCase() + ex.slice(1)}</label>
              <input type="number" className="input input-sm"
                value={s.tradeSizes2[ex]}
                onChange={e => s.set({ tradeSizes2: { ...s.tradeSizes2, [ex]: parseFloat(e.target.value) || 0 } })}
              />
            </div>
          ))}
        </section>

        {/* ── Mouse Shortcuts ─────────────────────────── */}
        <section className="settings-section">
          <div className="settings-section-title">Mouse Shortcuts</div>

          <div className="settings-row">
            <label>Mouse Button 4 (Back)</label>
            <select className="select" value={s.mouse4Action}
              onChange={e => s.set({ mouse4Action: e.target.value as 'buy' | 'sell' | 'none' })}>
              <option value="buy">Buy</option>
              <option value="sell">Sell</option>
              <option value="none">None</option>
            </select>
          </div>

          <div className="settings-row">
            <label>Mouse Button 5 (Forward)</label>
            <select className="select" value={s.mouse5Action}
              onChange={e => s.set({ mouse5Action: e.target.value as 'buy' | 'sell' | 'none' })}>
              <option value="buy">Buy</option>
              <option value="sell">Sell</option>
              <option value="none">None</option>
            </select>
          </div>

          <div className="settings-hint">
            Requires AutoHotkey remap.ahk to be running.<br />
            Mouse 4 → F13 · Mouse 5 → F14
          </div>
        </section>

        {/* ── Overlay ─────────────────────────────────── */}
        <section className="settings-section">
          <div className="settings-section-title">Overlay Banner</div>

          <div className="settings-row">
            <label>Auto-dismiss</label>
            <select className="select" value={s.overlayTimeoutSecs}
              onChange={e => s.set({ overlayTimeoutSecs: parseInt(e.target.value) })}>
              {TIMEOUT_OPTIONS.map(t => (
                <option key={t} value={t}>{t === 0 ? 'Never' : `${t}s`}</option>
              ))}
            </select>
          </div>

          <div className="settings-subsection">Notification Sound</div>
          <div className="settings-row">
            <span className="settings-hint" style={{ flex: 1, marginTop: 0 }}>{soundName}</span>
            <button className="btn btn-sm" onClick={clearSound}>Clear</button>
          </div>
          <label className="btn btn-sm" style={{ cursor: 'pointer', textAlign: 'center' }}>
            Upload sound
            <input type="file" accept="audio/*" style={{ display: 'none' }} onChange={handleSoundUpload} />
          </label>
        </section>

        {/* ── News Filters ─────────────────────────────── */}
        <section className="settings-section">
          <div className="settings-section-title">News Filters</div>

          <div className="settings-row">
            <label>Watchlist symbols only</label>
            <input type="checkbox" checked={s.watchlistOnly}
              onChange={e => s.set({ watchlistOnly: e.target.checked })} />
          </div>

          <div className="settings-subsection">Blocked Keywords</div>
          <div className="settings-tags">
            {s.blockedKeywords.map(kw => (
              <span key={kw} className="settings-tag">
                {kw}
                <button onClick={() => s.removeBlockedKeyword(kw)}>✕</button>
              </span>
            ))}
          </div>
          <div className="settings-row">
            <input className="input input-sm" placeholder="Add keyword..."
              value={newKeyword}
              onChange={e => setNewKeyword(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && newKeyword.trim()) {
                  s.addBlockedKeyword(newKeyword);
                  setNewKeyword('');
                }
              }}
            />
            <button className="btn btn-sm" onClick={() => {
              if (newKeyword.trim()) { s.addBlockedKeyword(newKeyword); setNewKeyword(''); }
            }}>Add</button>
          </div>

          <div className="settings-subsection">Sources</div>
          {['Tree News', 'Custom Feed'].map(src => (
            <div className="settings-row" key={src}>
              <label>{src}</label>
              <input type="checkbox"
                checked={!s.disabledSources.includes(src)}
                onChange={() => s.toggleSource(src)} />
            </div>
          ))}
        </section>

        {/* ── VIP Alerts ───────────────────────────────── */}
        <section className="settings-section">
          <div className="settings-section-title">VIP Alerts</div>

          <div className="settings-row">
            <label>Play sound for VIP</label>
            <input type="checkbox" checked={s.vipSound}
              onChange={e => s.set({ vipSound: e.target.checked })} />
          </div>

          <div className="settings-subsection">VIP Keywords</div>
          <div className="settings-hint">News items containing these words are highlighted and trigger a priority alert.</div>
          <div className="settings-tags">
            {s.vipKeywords.map(kw => (
              <span key={kw} className="settings-tag settings-tag--vip">
                {kw}
                <button onClick={() => s.removeVipKeyword(kw)}>✕</button>
              </span>
            ))}
          </div>
          <div className="settings-row">
            <input className="input input-sm" placeholder="Add VIP keyword..."
              value={newVipKeyword}
              onChange={e => setNewVipKeyword(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && newVipKeyword.trim()) {
                  s.addVipKeyword(newVipKeyword); setNewVipKeyword('');
                }
              }}
            />
            <button className="btn btn-sm" onClick={() => {
              if (newVipKeyword.trim()) { s.addVipKeyword(newVipKeyword); setNewVipKeyword(''); }
            }}>Add</button>
          </div>

          <div className="settings-subsection">VIP Sources</div>
          <div className="settings-tags">
            {s.vipSources.map(src => (
              <span key={src} className="settings-tag settings-tag--vip">
                {src}
                <button onClick={() => s.removeVipSource(src)}>✕</button>
              </span>
            ))}
          </div>
          <div className="settings-row">
            <input className="input input-sm" placeholder="Add VIP source..."
              value={newVipSource}
              onChange={e => setNewVipSource(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && newVipSource.trim()) {
                  s.addVipSource(newVipSource); setNewVipSource('');
                }
              }}
            />
            <button className="btn btn-sm" onClick={() => {
              if (newVipSource.trim()) { s.addVipSource(newVipSource); setNewVipSource(''); }
            }}>Add</button>
          </div>
        </section>

        {/* ── AI ───────────────────────────────────────── */}
        <section className="settings-section">
          <div className="settings-section-title">AI Assistant</div>
          <div className="settings-hint">Anthropic API key for AI tweet summarization.</div>
          <div className="settings-row">
            <input className="input input-sm" type="password" placeholder="sk-ant-..."
              value={s.anthropicApiKey}
              onChange={e => s.set({ anthropicApiKey: e.target.value })}
            />
          </div>
        </section>

        {/* ── Hyperliquid ──────────────────────────────── */}
        <section className="settings-section">
          <div className="settings-section-title">Hyperliquid</div>

          <div className="settings-row">
            <label>Leverage</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input
                type="range" min={1} max={50} step={1}
                value={s.hlLeverage}
                onChange={e => s.set({ hlLeverage: parseInt(e.target.value) })}
                style={{ width: 100 }}
              />
              <span style={{ minWidth: 36, fontWeight: 600, color: 'var(--accent)' }}>{s.hlLeverage}x</span>
            </div>
          </div>

          <div className="settings-row">
            <label>Margin Mode</label>
            <select className="select" value={s.hlCrossMargin ? 'cross' : 'isolated'}
              onChange={e => s.set({ hlCrossMargin: e.target.value === 'cross' })}>
              <option value="cross">Cross</option>
              <option value="isolated">Isolated</option>
            </select>
          </div>

          <div className="settings-hint">
            Leverage is set on the asset before each order.
          </div>
        </section>

        {/* ── IBKR ─────────────────────────────────────── */}
        <section className="settings-section">
          <div className="settings-section-title">IBKR</div>

          <div className="settings-row">
            <label>Enable IBKR</label>
            <input type="checkbox" checked={s.ibkrEnabled}
              onChange={e => toggleIbkr(e.target.checked)} />
          </div>

          {ibkrStatus && <div className="settings-status">{ibkrStatus}</div>}

          <div className="settings-hint">
            Requires IBKR Desktop to be open and logged in.<br />
            Connects to Client Portal API at localhost:5000.
          </div>
        </section>

      </div>
    </div>
  );
}
