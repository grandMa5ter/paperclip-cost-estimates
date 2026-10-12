import { test } from 'node:test';
import assert from 'node:assert/strict';
import plugin, { createPriceStore } from '../src/worker.ts';
const body = JSON.stringify({
  'claude-example': { litellm_provider: 'anthropic', input_cost_per_token: .000004, output_cost_per_token: .00002 },
  'gpt-example': { litellm_provider: 'openai', input_cost_per_token: .000002, output_cost_per_token: .00001 },
});
function fakeContext() {
  const state = new Map(), data = new Map(), actions = new Map();
  return { state: { get: async key => state.get(key.stateKey) ?? null,
    set: async (key, value) => state.set(key.stateKey, value) },
    jobs: { register() {} }, events: { on() {} }, config: { get: async () => ({enabled:false}) }, data: { register: (key, handler) => data.set(key, handler) },
    actions: { register: (key, handler) => actions.set(key, handler) },
    companies: { get: async companyId => ({ id: companyId }) },
    db: { namespace:'plugin_paperclip_cost_estimates_5379273a75', query: async () => [] }, handlers: { data, actions }, stored: state };
}
test('failed feed refresh preserves the saved snapshot and reports stale pricing', async t => {
  const ctx = fakeContext();
  t.mock.method(globalThis, 'fetch', async () => new Response(body));
  const store = createPriceStore(ctx);
  const saved = await store.refresh();
  ctx.stored.set('prices-latest', { ...saved, fetchedAt: '2020-01-01T00:00:00Z' });
  globalThis.fetch = async () => { throw new Error('offline'); };
  const result = await store.get();
  assert.equal(result.snapshot.sha256, saved.sha256);
  assert.match(result.warning, /last saved/);
  await assert.rejects(createPriceStore(fakeContext()).get(), /Prices unavailable/);
});
test('disabled connector does not write native financial data', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response(body));
  const ctx = fakeContext();
  await plugin.definition.setup(ctx);
  const companyId = '11111111-1111-1111-1111-111111111111';
  const report = await ctx.handlers.data.get('status')({ companyId });
  assert.equal(report.enabled, false);
  const result = await ctx.handlers.actions.get('sync')({ companyId }, {actor:{type:'user'}, companyId});
  assert.equal(result.processed, 0);
  assert.equal(ctx.stored.size, 0);
});
test('agents cannot invoke the manual price refresh action', async () => {
  const ctx = fakeContext();
  await plugin.definition.setup(ctx);
  await assert.rejects(ctx.handlers.actions.get('refresh-prices')({}, { actor: { type: 'agent' } }), /board user/);
});
