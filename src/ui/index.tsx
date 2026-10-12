import React, { useState } from 'react';
import { usePluginData, usePluginAction, type PluginPageProps } from '@paperclipai/plugin-sdk/ui';
type Row = { id: string; name: string; usd: number; tokens: number; events: number; unpricedEvents: number };
type Report = {
  total: { usd: number; tokens: number; events: number; unpricedEvents: number; contextPricingEvents: number };
  projects: Row[]; tasks: Row[]; agents: Row[]; models: Row[];
  pricing: { source: string; fetchedAt: string; sha256: string; warning: string | null };
};
const dollars = (usd: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(usd);
const number = (count: number) => new Intl.NumberFormat('en-US').format(count);
const cell: React.CSSProperties = { padding: '10px 12px', textAlign: 'left', borderBottom: '1px solid var(--border, #8884)' };
const control: React.CSSProperties = { padding: '8px 12px', background: 'transparent', color: 'inherit', border: '1px solid var(--border, #8884)', borderRadius: 6 };

export function EstimatesPage({ context }: PluginPageProps) {
  const [range, setRange] = useState('month');
  const [group, setGroup] = useState<'projects' | 'tasks' | 'agents' | 'models'>('projects');
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const { data, loading, error, refresh } = usePluginData<Report>('report', { companyId: context.companyId, range });
  const refreshPrices = usePluginAction('refresh-prices');
  const rows = data?.[group] ?? [];
  async function updatePrices() {
    setBusy(true); setMessage('');
    try { await refreshPrices({ companyId: context.companyId }); await refresh(); }
    catch (err) { setMessage(err instanceof Error ? err.message : 'Price refresh failed'); }
    finally { setBusy(false); }
  }
  return <main style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }}>
    <h1 style={{ fontSize: 26, fontWeight: 650 }}>Cost Estimates</h1>
    <p style={{ opacity: .8, marginTop: 8 }}>What Claude and Codex work would cost at current standard API token prices.</p>
    <p style={{ opacity: .8, marginTop: 8 }}>Estimates are separate from subscription fees, billed spend and budget limits.</p>
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', margin: '24px 0' }}>
      <select aria-label="Date range" value={range} onChange={e => setRange(e.target.value)} style={control}>
        <option value="month">This month (UTC)</option><option value="week">Last 7 days</option><option value="all">All recorded history</option>
      </select>
      <select aria-label="Group estimates by" value={group} onChange={e => setGroup(e.target.value as typeof group)} style={control}>
        <option value="projects">By project</option><option value="tasks">By task</option><option value="agents">By agent</option><option value="models">By model</option>
      </select>
      <button style={control} onClick={() => refresh()} disabled={loading}>Refresh usage</button>
      <button style={control} onClick={updatePrices} disabled={busy}>{busy ? 'Updating prices…' : 'Update prices'}</button>
    </div>
    {loading && <p role="status">Loading recorded usage…</p>}
    {(error || message) && <p role="alert">{error?.message ?? message}</p>}
    {data && <>
      <div style={{ display: 'flex', gap: 36, flexWrap: 'wrap', padding: 20, border: '1px solid var(--border, #8884)', borderRadius: 8 }}>
        <div><p>Estimated API equivalent</p><strong style={{ fontSize: 28 }}>{dollars(data.total.usd)}</strong></div>
        <div><p>Recorded tokens</p><strong style={{ fontSize: 28 }}>{number(data.total.tokens)}</strong></div>
        <div><p>Usage records without prices</p><strong style={{ fontSize: 28 }}>{number(data.total.unpricedEvents)}</strong></div>
      </div>
      {data.pricing.warning && <p role="alert" style={{ marginTop: 16 }}>{data.pricing.warning}</p>}
      {data.total.unpricedEvents > 0 && <p style={{ marginTop: 16 }}>The total is incomplete: {number(data.total.unpricedEvents)} usage records could not be priced.</p>}
      <div style={{ overflowX: 'auto', marginTop: 24 }}><table style={{ borderCollapse: 'collapse', width: '100%' }}>
        <thead><tr>{['Name', 'Estimated USD', 'Tokens', 'Usage records', 'Unpriced'].map(title => <th key={title} style={cell}>{title}</th>)}</tr></thead>
        <tbody>{rows.map(row => <tr key={row.id}>
          <td style={cell}>{row.name?.trim() || 'No task recorded'}</td><td style={cell}>{dollars(row.usd)}{row.unpricedEvents ? ' (partial)' : ''}</td>
          <td style={cell}>{number(row.tokens)}</td><td style={cell}>{number(row.events)}</td><td style={cell}>{number(row.unpricedEvents)}</td>
        </tr>)}</tbody>
      </table></div>
      {!rows.length && <p style={{ marginTop: 16 }}>No recorded Claude or Codex usage in this period.</p>}
      <p style={{ marginTop: 24, opacity: .75 }}>Includes ordinary input, cached input and output. Cache writes, tools, service-tier premiums and per-request context surcharges are excluded.</p>
      <p style={{ marginTop: 8, opacity: .75 }}>Past usage is valued at this snapshot’s prices. Recorded usage may omit work that did not produce a token receipt.</p>
      <p style={{ marginTop: 8, opacity: .75 }}><a href={data.pricing.source} target="_blank" rel="noreferrer">LiteLLM price snapshot</a> fetched {new Date(data.pricing.fetchedAt).toLocaleString()} · SHA-256 {data.pricing.sha256.slice(0, 12)}</p>
    </>}
  </main>;
}
