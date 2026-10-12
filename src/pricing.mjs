import { createHash } from 'node:crypto';
export const PRICE_URL = 'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json';
export const PRICE_TTL_MS = 24 * 60 * 60 * 1000;

function rate(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

export function parsePrices(body, fetchedAt = new Date().toISOString()) {
  const raw = JSON.parse(body);
  const models = {};
  for (const [model, entry] of Object.entries(raw)) {
    if (!entry || typeof entry !== 'object' || !['openai', 'anthropic'].includes(entry.litellm_provider)) continue;
    // Only direct first-party entries. Do not accidentally price a gateway or cloud deployment.
    if (model.includes('/')) continue;
    const input = rate(entry.input_cost_per_token);
    const output = rate(entry.output_cost_per_token);
    if (input === null || output === null) continue;
    models[`${entry.litellm_provider}:${model}`] = {
      input, output, cacheRead: rate(entry.cache_read_input_token_cost),
      cacheWrite: rate(entry.cache_creation_input_token_cost),
      contextPricing: Object.keys(entry).some(key => /cost.*above_\d|above_\d.*cost/.test(key)),
    };
  }
  if (!Object.keys(models).some(key => key.startsWith('openai:')) ||
      !Object.keys(models).some(key => key.startsWith('anthropic:'))) {
    throw new Error('Public feed does not contain usable OpenAI and Anthropic prices. Previous snapshot retained.');
  }
  return { source: PRICE_URL, fetchedAt, sha256: createHash('sha256').update(body).digest('hex'), models };
}

function count(value) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new Error('Invalid recorded token count');
  return number;
}

export function estimate(row, snapshot) {
  const input = count(row.input_tokens), cached = count(row.cached_input_tokens), output = count(row.output_tokens);
  const prices = snapshot.models[`${row.provider}:${row.model}`];
  if (!prices) return { usd: null, reason: 'Model price unavailable', tokens: input + cached + output };
  if (cached && prices.cacheRead === null) return { usd: null, reason: 'Cached-input price unavailable', tokens: input + cached + output };
  // Paperclip normalizes ordinary input separately from cached input. Never subtract it twice.
  return { usd: input * prices.input + cached * (prices.cacheRead ?? 0) + output * prices.output,
    reason: null, tokens: input + cached + output, contextPricing: prices.contextPricing };
}

export function summarise(rows, snapshot) {
  const groups = { projects: new Map(), tasks: new Map(), agents: new Map(), models: new Map() };
  const total = { usd: 0, tokens: 0, events: 0, unpricedEvents: 0, contextPricingEvents: 0 };
  const add = (target, key, name, row, cost) => {
    const value = target.get(key) ?? { id: key, name, usd: 0, tokens: 0, events: 0, unpricedEvents: 0 };
    value.usd += cost.usd ?? 0;
    value.tokens += cost.tokens;
    value.events += count(row.events);
    value.unpricedEvents += cost.usd === null ? count(row.events) : 0;
    target.set(key, value);
  };
  for (const row of rows) {
    const cost = estimate(row, snapshot);
    total.usd += cost.usd ?? 0; total.tokens += cost.tokens; total.events += count(row.events);
    total.unpricedEvents += cost.usd === null ? count(row.events) : 0;
    total.contextPricingEvents += cost.contextPricing ? count(row.events) : 0;
    add(groups.projects, row.project_id ?? 'unassigned', row.project_name ?? 'No project recorded', row, cost);
    add(groups.tasks, row.issue_id ?? 'unassigned', row.issue_name ?? 'No task recorded', row, cost);
    add(groups.agents, row.agent_id, row.agent_name ?? row.agent_id, row, cost);
    add(groups.models, `${row.provider}:${row.model}`, `${row.provider} / ${row.model}`, row, cost);
  }
  return { total, ...Object.fromEntries(Object.entries(groups).map(([key, values]) =>
    [key, [...values.values()].sort((a, b) => b.usd - a.usd)])) };
}

export function validateRange(params, now = new Date()) {
  if (typeof params.companyId !== 'string' || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(params.companyId)) {
    throw new Error('A valid active company ID is required');
  }
  const range = params.range ?? 'month';
  if (!['month', 'week', 'all'].includes(range)) throw new Error('Unsupported date range');
  const from = range === 'all' ? '1970-01-01T00:00:00.000Z' : range === 'week'
    ? new Date(now.getTime() - 7 * 86400000).toISOString()
    : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  return { companyId: params.companyId, from, to: now.toISOString() };
}
