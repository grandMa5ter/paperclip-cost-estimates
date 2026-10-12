import type { PluginContext } from '@paperclipai/plugin-sdk';
import { estimate } from './pricing.mjs';
export const ESTIMATE_BILLER = 'api-equivalent-estimate';
export const BILLING_PREFIX = 'api-equivalent:';
export type SourceCost = Record<string, any>;
type Valuation = { source_id: string; company_id: string; billing_code: string; status: string;
  cost_cents: number; payload: Record<string, any>; pricing_sha256: string; native_id: string | null };

export function apiOrigin(value: unknown) {
  if (typeof value !== 'string') throw new Error('Paperclip API origin is required');
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Use an API origin without credentials or paths');
  const privateHost = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\]|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/.test(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && privateHost)) throw new Error('Use HTTPS, or private/loopback HTTP');
  return url.origin;
}
export function prepareValuation(row: SourceCost, snapshot: any) {
  if (!['openai', 'anthropic'].includes(row.provider) || row.billing_type !== 'subscription_included' ||
      Number(row.cost_cents) !== 0 || row.biller === ESTIMATE_BILLER) return null;
  const cost = estimate(row, snapshot);
  if (!cost.tokens || cost.usd === null) return null;
  const cents = Math.round(cost.usd * 100);
  const payload = { agentId: row.agent_id, issueId: row.issue_id, projectId: row.project_id,
    goalId: row.goal_id, heartbeatRunId: row.heartbeat_run_id,
    billingCode: `${BILLING_PREFIX}${row.id}`, provider: row.provider, model: row.model,
    biller: ESTIMATE_BILLER, billingType: 'fixed', costStatus: 'reported', costCents: cents,
    inputTokens: 0, cachedInputTokens: 0, outputTokens: 0,
    occurredAt: new Date(row.occurred_at).toISOString() };
  return { sourceId: row.id, companyId: row.company_id, payload, snapshotHash: snapshot.sha256 };
}
export function matchesNative(native: SourceCost, payload: SourceCost) {
  return native.billing_code === payload.billingCode && native.biller === ESTIMATE_BILLER &&
    native.billing_type === 'fixed' && Number(native.cost_cents) === payload.costCents &&
    native.agent_id === payload.agentId && native.model === payload.model && native.provider === payload.provider &&
    (native.issue_id ?? null) === (payload.issueId ?? null) && (native.project_id ?? null) === (payload.projectId ?? null) &&
    (native.heartbeat_run_id ?? null) === (payload.heartbeatRunId ?? null) &&
    [native.input_tokens, native.cached_input_tokens, native.output_tokens].every(v => Number(v) === 0);
}
export async function sendNativeCost(origin: string, companyId: string, token: string, payload: SourceCost) {
  const response = await fetch(`${origin}/api/companies/${companyId}/cost-events`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload), redirect: 'error', signal: AbortSignal.timeout(15000),
  });
  if (response.status !== 201) throw new Error(`Native cost write returned HTTP ${response.status}`);
  const result = await response.json() as SourceCost;
  if (typeof result.id !== 'string') throw new Error('Native cost receipt has no ID');
  return result.id;
}
export function createConnector(ctx: PluginContext, prices: { get: () => Promise<{ snapshot: any }> }) {
  const table = `${ctx.db.namespace}.valuations`;
  const SOURCES = `SELECT c.* FROM public.cost_events c WHERE c.company_id = $1
    AND c.provider IN ('openai','anthropic') AND c.billing_type = 'subscription_included'
    AND c.cost_cents = 0 AND c.input_tokens + c.cached_input_tokens + c.output_tokens > 0
    AND NOT EXISTS (SELECT 1 FROM ${table} v WHERE v.source_id = c.id)
    ORDER BY c.occurred_at, c.id LIMIT $2`;
  async function reconcile(record: Valuation) {
    const existing = await ctx.db.query<SourceCost>('SELECT * FROM public.cost_events WHERE company_id = $1 AND billing_code = $2', [record.company_id, record.billing_code]);
    if (existing.length > 1 || (existing.length === 1 && !matchesNative(existing[0], record.payload))) throw new Error('Native valuation conflict; connector stopped without another write');
    if (!existing.length) return false;
    await ctx.db.execute(`UPDATE ${table} SET status = 'written', native_id = $2, updated_at = now() WHERE source_id = $1`, [record.source_id, existing[0].id]);
    return true;
  }
  async function process(record: Valuation, origin: string, token: string) {
    if (record.status === 'written' || record.status === 'below-cent') return;
    if (await reconcile(record)) return;
    // The native API has no idempotency key. An uncertain POST is never resent.
    if (record.status !== 'prepared') {
      await ctx.db.execute(`UPDATE ${table} SET status = 'uncertain', updated_at = now() WHERE source_id = $1 AND status <> 'written'`, [record.source_id]);
      return;
    }
    const claimed = await ctx.db.execute(`UPDATE ${table} SET status = 'sending', updated_at = now() WHERE source_id = $1 AND status = 'prepared'`, [record.source_id]);
    if (!claimed.rowCount) return;
    try {
      const nativeId = await sendNativeCost(origin, record.company_id, token, record.payload);
      await ctx.db.execute(`UPDATE ${table} SET status = 'written', native_id = $2, updated_at = now() WHERE source_id = $1`, [record.source_id, nativeId]);
    } catch {
      await ctx.db.execute(`UPDATE ${table} SET status = 'uncertain', updated_at = now() WHERE source_id = $1 AND status <> 'written'`, [record.source_id]);
      if (!await reconcile(record)) throw new Error('Native write outcome uncertain; retained for reconciliation without retry');
    }
  }
  let active = Promise.resolve();
  function serial<T>(run: () => Promise<T>): Promise<T> {
    const result = active.then(run, run);
    active = result.then(() => undefined, () => undefined);
    return result;
  }
  async function sync(companyId: string, limit = 50) {
    return serial(async () => {
      const config = await ctx.config.get(companyId);
      if (config.enabled !== true) return { enabled: false, processed: 0 };
      const origin = apiOrigin(config.apiBase);
      if (!config.apiToken || typeof config.apiToken !== 'object') throw new Error('Configure a native API token secret reference');
      const token = await ctx.secrets.resolve(config.apiToken as any, { companyId, configPath: 'apiToken' });
      const { snapshot } = await prices.get();
      const sources = await ctx.db.query<SourceCost>(SOURCES, [companyId, limit]);
      for (const row of sources) {
        const value = prepareValuation(row, snapshot);
        if (!value) continue;
        await ctx.db.execute(`INSERT INTO ${table} (source_id, company_id, billing_code, status, cost_cents, payload, pricing_sha256)
          VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7) ON CONFLICT (source_id) DO NOTHING`,
          [value.sourceId, companyId, value.payload.billingCode, value.payload.costCents ? 'prepared' : 'below-cent', value.payload.costCents, JSON.stringify(value.payload), value.snapshotHash]);
      }
      const pending = await ctx.db.query<Valuation>(`SELECT * FROM ${table} WHERE company_id = $1 AND status IN ('prepared','sending','uncertain') ORDER BY updated_at LIMIT $2`, [companyId, limit]);
      for (const record of pending) await process(record, origin, token);
      return { enabled: true, processed: sources.length };
    });
  }
  async function status(companyId: string) {
    const config = await ctx.config.get(companyId);
    const states = await ctx.db.query(`SELECT status, count(*)::int AS records FROM ${table} WHERE company_id = $1 GROUP BY status`, [companyId]);
    const remaining = await ctx.db.query<{ records: number }>(`SELECT count(*)::int AS records FROM public.cost_events c
      WHERE c.company_id = $1 AND c.provider IN ('openai','anthropic') AND c.billing_type = 'subscription_included'
      AND c.cost_cents = 0 AND c.input_tokens + c.cached_input_tokens + c.output_tokens > 0
      AND NOT EXISTS (SELECT 1 FROM ${table} v WHERE v.source_id = c.id)`, [companyId]);
    return { enabled: config.enabled === true, states, remaining: remaining[0]?.records ?? 0 };
  }
  return { sync, status };
}
