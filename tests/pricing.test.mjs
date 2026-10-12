import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePrices, estimate, summarise, validateRange } from '../src/pricing.mjs';
const body = JSON.stringify({
  'claude-example': { litellm_provider: 'anthropic', input_cost_per_token: 0.000004,
    output_cost_per_token: 0.000020, cache_read_input_token_cost: 0.0000002 },
  'gpt-example': { litellm_provider: 'openai', input_cost_per_token: 0.000002,
    output_cost_per_token: 0.000010, cache_read_input_token_cost: 0.0000001,
    input_cost_per_token_above_272k_tokens: 0.000004 },
  'azure/gpt-example': { litellm_provider: 'azure', input_cost_per_token: 999, output_cost_per_token: 999 },
});
const snapshot = parsePrices(body);
const row = { provider: 'anthropic', model: 'claude-example', input_tokens: '100000',
  cached_input_tokens: '500000', output_tokens: '20000', events: '2',
  project_id: 'project-a', project_name: 'Project A', issue_id: 'task-a', issue_name: 'Task A',
  agent_id: 'agent-a', agent_name: 'Agent A' };
test('cached input is charged once, at its own rate, separately from ordinary input', () => {
  assert.ok(Math.abs(estimate(row, snapshot).usd - 0.90) < 1e-10);
  assert.equal(estimate(row, snapshot).tokens, 620000);
});
test('unknown models and unavailable cache rates remain unpriced', () => {
  assert.equal(estimate({ ...row, model: 'unknown' }, snapshot).usd, null);
  const prices = structuredClone(snapshot);
  prices.models['anthropic:claude-example'].cacheRead = null;
  assert.equal(estimate(row, prices).usd, null);
});
test('partial totals retain unknown usage and consistent attribution', () => {
  const report = summarise([row, { ...row, model: 'unknown' }], snapshot);
  assert.equal(report.total.events, 4);
  assert.equal(report.total.unpricedEvents, 2);
  assert.equal(report.total.tokens, 1240000);
  assert.equal(report.projects[0].usd, report.tasks[0].usd);
  assert.equal(report.projects[0].usd, report.total.usd);
});
test('feed validation rejects empty or one-provider data and never imports cloud aliases', () => {
  assert.throws(() => parsePrices('{}'), /usable/);
  assert.throws(() => parsePrices('{'), SyntaxError);
  assert.equal(Object.keys(snapshot.models).length, 2);
  assert.equal(snapshot.models['openai:gpt-example'].contextPricing, true);
  assert.equal(snapshot.sha256.length, 64);
});
test('negative, nonfinite and unsafe token totals are rejected', () => {
  for (const count of [-1, Infinity, 'oops', Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => estimate({ ...row, input_tokens: count }, snapshot), /Invalid/);
  }
});
test('company and range validation uses UTC month boundaries and rejects arbitrary SQL inputs', () => {
  const companyId = '11111111-1111-1111-1111-111111111111';
  assert.equal(validateRange({ companyId }, new Date('2026-10-12T12:00:00Z')).from, '2026-10-01T00:00:00.000Z');
  assert.throws(() => validateRange({ companyId: "' OR 1=1" }), /company/);
  assert.throws(() => validateRange({ companyId, range: 'custom' }), /range/);
});
export { body, snapshot };
