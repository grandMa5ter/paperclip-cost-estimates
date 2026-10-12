import React, { useState } from 'react';
import { usePluginData, usePluginAction, type PluginPageProps } from '@paperclipai/plugin-sdk/ui';
type Status = { enabled: boolean; remaining: number; states: {status: string; records: number}[] };
export function ConnectorPage({ context }: PluginPageProps) {
  const { data, loading, error, refresh } = usePluginData<Status>('status', { companyId: context.companyId });
  const sync = usePluginAction('sync');
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  async function syncNow() {
    setBusy(true); setMessage('');
    try { await sync({ companyId: context.companyId }); await refresh(); }
    catch (e) { setMessage(e instanceof Error ? e.message : 'Sync failed'); }
    finally { setBusy(false); }
  }
  return <section style={{padding:24,maxWidth:900}}>
    <h1 style={{fontSize:26,fontWeight:650}}>Subscription Cost Connector</h1>
    <p style={{margin:'16px 0'}}>Costs and budgets are managed in Paperclip’s native Audit pages.</p>
    <a href={`/${context.companyPrefix}/costs`} style={{textDecoration:'underline'}}>Open native Costs</a>
    <p style={{margin:'16px 0'}}>API-equivalent subscription valuations appear under biller <strong>api-equivalent-estimate</strong>. They consume native dollar budgets.</p>
    {loading && <p>Loading connector status…</p>}
    {(error || message) && <p role="alert">{error?.message ?? message}</p>}
    {data && <>
      <p>Connector: {data.enabled ? 'Enabled' : 'Disabled; configure it in plugin settings'}</p>
      <p>Usage records awaiting valuation: {data.remaining}</p>
      <ul>{data.states.map(row=><li key={row.status}>{row.status}: {row.records}</li>)}</ul>
      {data.states.some(row=>row.status==='uncertain') && <p role="alert">An uncertain native write requires reconciliation. It will not be resent automatically.</p>}
      <button onClick={syncNow} disabled={busy || !data.enabled} style={{padding:8,margin:'16px 0',border:'1px solid #888',borderRadius:6}}>{busy ? 'Syncing…' : 'Sync next batch'}</button>
    </>}
    <p>Native cost records retain task, project, agent and run attribution. Additional token counts are zero; original usage remains unchanged.</p>
  </section>;
}
