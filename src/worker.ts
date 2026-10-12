import { definePlugin, runWorker, type PluginContext } from '@paperclipai/plugin-sdk';
import { PRICE_URL, PRICE_TTL_MS, parsePrices, summarise, validateRange } from './pricing.mjs';
const latestKey = { scopeKind: 'instance' as const, stateKey: 'prices-latest' };
type Snapshot = ReturnType<typeof parsePrices>;

export const REPORT_SQL = `SELECT c.provider, c.model, c.project_id, p.name AS project_name,
 c.issue_id, concat(i.identifier, ' ', i.title) AS issue_name, c.agent_id, a.name AS agent_name,
 sum(c.input_tokens)::text AS input_tokens, sum(c.cached_input_tokens)::text AS cached_input_tokens,
 sum(c.output_tokens)::text AS output_tokens, count(*)::text AS events
 FROM public.cost_events c
 LEFT JOIN public.projects p ON p.id = c.project_id AND p.company_id = c.company_id
 LEFT JOIN public.issues i ON i.id = c.issue_id AND i.company_id = c.company_id
 LEFT JOIN public.agents a ON a.id = c.agent_id AND a.company_id = c.company_id
 WHERE c.company_id = $1 AND c.occurred_at >= $2 AND c.occurred_at <= $3
 AND c.provider IN ('openai', 'anthropic')
 GROUP BY c.provider, c.model, c.project_id, p.name, c.issue_id, i.identifier, i.title, c.agent_id, a.name`;

export function createPriceStore(ctx: PluginContext) {
  let pending: Promise<Snapshot> | null = null;
  async function refresh(): Promise<Snapshot> {
    if (pending) return pending;
    pending = (async () => {
      const response = await fetch(PRICE_URL, { signal: AbortSignal.timeout(15000), redirect: 'error' });
      if (!response.ok) throw new Error(`Public pricing feed returned HTTP ${response.status}`);
      // Bound downloads rather than trusting a Content-Length header.
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      for await (const chunk of response.body!) {
        bytes += chunk.byteLength;
        if (bytes > 8 * 1024 * 1024) throw new Error('Pricing feed exceeds 8 MiB');
        chunks.push(chunk);
      }
      const body = Buffer.concat(chunks).toString('utf8');
      const snapshot = parsePrices(body);
      await ctx.state.set({ ...latestKey, stateKey: `prices-${snapshot.sha256}` }, snapshot);
      await ctx.state.set(latestKey, snapshot);
      return snapshot;
    })();
    try { return await pending; } finally { pending = null; }
  }
  async function get() {
    const saved = await ctx.state.get(latestKey) as Snapshot | null;
    if (saved && Date.now() - Date.parse(saved.fetchedAt) < PRICE_TTL_MS) return { snapshot: saved, warning: null };
    try { return { snapshot: await refresh(), warning: null }; }
    catch {
      if (!saved) throw new Error('Prices unavailable. Retry when the public feed is reachable.');
      return { snapshot: saved, warning: 'Price refresh failed; using the last saved snapshot.' };
    }
  }
  return { get, refresh };
}

const plugin = definePlugin({
  async setup(ctx) {
    const prices = createPriceStore(ctx);
    ctx.jobs.register('refresh-prices', async () => { await prices.refresh(); });
    ctx.data.register('report', async params => {
      const range = validateRange(params);
      if (!await ctx.companies.get(range.companyId)) throw new Error('Company unavailable');
      const { snapshot, warning } = await prices.get();
      const rows = await ctx.db.query(REPORT_SQL, [range.companyId, range.from, range.to]);
      const report = summarise(rows, snapshot);
      return { ...report, range, pricing: { source: snapshot.source, fetchedAt: snapshot.fetchedAt,
        sha256: snapshot.sha256, warning }, basis: 'Current standard API prices; ordinary input, cached input and output only.' };
    });
    ctx.actions.register('refresh-prices', async (_params, context) => {
      if (context.actor.type !== 'user') throw new Error('Only a board user can refresh prices');
      const snapshot = await prices.refresh();
      return { fetchedAt: snapshot.fetchedAt, sha256: snapshot.sha256 };
    });
  },
  async onHealth() { return { status: 'ok', message: 'Read-only cost estimates; no budget or billing mutations.' }; },
});
export default plugin;
runWorker(plugin, import.meta.url);
