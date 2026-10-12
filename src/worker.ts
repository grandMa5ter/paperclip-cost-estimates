import { definePlugin, runWorker, type PluginContext } from '@paperclipai/plugin-sdk';
import { PRICE_URL, PRICE_TTL_MS, parsePrices, validateRange } from './pricing.mjs';
import { createConnector } from './connector.ts';
const latestKey = { scopeKind: 'instance' as const, stateKey: 'prices-latest' };
type Snapshot = ReturnType<typeof parsePrices>;

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
    const connector = createConnector(ctx, prices);
    ctx.jobs.register('refresh-prices', async () => { await prices.refresh(); });
    ctx.jobs.register('sync-native-costs', async () => {
      for (const company of await ctx.companies.list()) await connector.sync(company.id);
    });
    ctx.events.on('cost_event.created', async event => {
      if (!event.entityId) return;
      const original = await ctx.db.query(`SELECT id FROM public.cost_events WHERE company_id = $1 AND id = $2 AND billing_type = 'subscription_included' AND cost_cents = 0`, [event.companyId, event.entityId]);
      if (original.length) await connector.sync(event.companyId);
    });
    ctx.data.register('status', async params => {
      const range = validateRange(params);
      if (!await ctx.companies.get(range.companyId)) throw new Error('Company unavailable');
      return connector.status(range.companyId);
    });
    ctx.actions.register('sync', async (params, context) => {
      if (context.actor.type !== 'user') throw new Error('Only a board user can run a native cost sync');
      const { companyId } = validateRange(params);
      if (context.companyId !== companyId) throw new Error('Company does not match the authenticated scope');
      const limit = params.limit ?? 50;
      if (!Number.isInteger(limit) || Number(limit) < 1 || Number(limit) > 50) throw new Error('Batch limit must be between 1 and 50');
      return connector.sync(companyId, Number(limit));
    });
    ctx.actions.register('refresh-prices', async (_params, context) => {
      if (context.actor.type !== 'user') throw new Error('Only a board user can refresh prices');
      const snapshot = await prices.refresh();
      return { fetchedAt: snapshot.fetchedAt, sha256: snapshot.sha256 };
    });
  },
  async onHealth() { return { status: 'ok', message: 'Subscription valuations feed native Paperclip cost events.' }; },
});
export default plugin;
runWorker(plugin, import.meta.url);
