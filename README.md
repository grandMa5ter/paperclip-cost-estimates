# Paperclip Cost Estimates

A self-contained Paperclip plugin that values recorded Claude and Codex work
at current standard API token prices from LiteLLM. It adds a **Cost Estimates**
company page with project, task, agent and model breakdowns.

**No Paperclip core patches, adapter changes or budget changes are required.**
The plugin queries existing usage records through the official Plugin SDK and
stores public price snapshots in its own namespaced state. It does not write
cost events, finance events or budget policies.

## Install

Requires Node.js 24.11 or later and Paperclip with the public Plugin SDK.
Version 0.1.0 is developed against Paperclip / SDK **2026.1005.0**. Compatibility
with other releases must be verified before upgrading.

```sh
git clone https://github.com/grandMa5ter/paperclip-cost-estimates.git
cd paperclip-cost-estimates
npm ci
npm run typecheck
npm test
npm run build
paperclipai plugin install --local "$PWD"
paperclipai plugin list
```

Open your company's **Cost Estimates** plugin page at
`/<company-prefix>/cost-estimates` (for example, `/ACME/cost-estimates`). Select this month (UTC), the
last seven days, or all recorded history. **Refresh usage** reads new usage;
**Update prices** fetches a new public pricing snapshot. Prices refresh daily at
02:17 UTC and on report access when the stored snapshot is over 24 hours old.

Local-path installs need this checkout to remain at its installed path. Avoid
editing a running installation: build and validate a versioned release directory,
then install it using the same command. `npm pack` also produces a distributable
package. This repository does not currently promise an npm-registry release.

```sh
paperclipai plugin disable paperclip-cost-estimates
paperclipai plugin uninstall paperclip-cost-estimates
```

Disable stops the plugin without touching native usage or budgets. The ordinary
uninstall workflow retains plugin state according to Paperclip's lifecycle rules.

## What the number means

This is **current-price API-equivalent token valuation**, including subscription
and API usage. It is not an invoice, subscription allocation, or an estimate of
remaining subscription quota. Past usage is repriced using the displayed current
snapshot; it is not historical billing.

For each exact provider/model match:

```text
estimated USD = ordinary input tokens × input USD/token
              + cached input tokens × cache-read USD/token
              + output tokens × output USD/token
```

Paperclip's normalized ordinary-input and cached-input counters are separate.
Cached tokens are charged once at the cached-input rate. The report uses only
first-party `openai` and `anthropic` entries; it does not guess an unknown model's
rate from another model or silently price cloud/gateway variants.

Missing model or cache-read rates produce **unpriced** usage and an explicitly
partial total. Usage without a token receipt is not reconstructed. Project/task
attribution follows the IDs retained on native cost events; unattributed work
appears in a separate row.

### Estimation limits

The native cost ledger does not expose all billable categories or per-request
boundaries. This version therefore excludes cache writes, paid tools, fast or
other service-tier premiums, regional uplifts and per-request context surcharges.
Those exclusions can understate API-equivalent cost. Request thresholds cannot
be applied correctly to token totals aggregated across multiple requests.

All figures are USD. Totals retain fractional cents until display. They never
consume native dollar budgets or pause agents.

## Pricing source and resilience

- [LiteLLM public pricing file](https://github.com/BerriAI/litellm/blob/main/model_prices_and_context_window.json)
- Direct feed: `https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json`
- Input: `input_cost_per_token`; output: `output_cost_per_token`;
  cache read: `cache_read_input_token_cost`.
- Feed prices are already USD per token. Do not divide them by one million again.

Downloads have a 15-second timeout and an 8 MiB size limit. A snapshot is accepted
only when it has usable prices for both providers. Each snapshot carries its
source URL, retrieval time and SHA-256. Distinct snapshots are retained under
their hashes. If refresh fails, the previous snapshot remains usable and the page
shows a warning. If no snapshot exists, the report fails visibly.

The feed is community-maintained. Compare rates with official provider pricing
before using the figures for commercial quotes. No prompts, usage counts or
project names are sent to LiteLLM or GitHub: the plugin only downloads public data.

## Permissions and upgrade isolation

The manifest requests a UI page, read access to native cost/project/task/agent
tables, company lookup, plugin-owned state read/write, outbound HTTP and scheduled
jobs. The SDK also requires namespace migration permission when declaring core
table reads; there are no SQL migrations or usage tables. The manual
price-refresh action requires an authenticated board user.
There are no agent execution, credential-read, native finance-write or
budget-write capabilities.

Paperclip plugins currently run as trusted code. Manifest capabilities are not
a general sandbox. This plugin uses only the published SDK worker/UI interfaces
and declared read-only table access; it does not import Paperclip server internals.

Before a Paperclip update, run typecheck, tests and build against the intended SDK,
then verify plugin health and the reporting page. If an upstream SDK contract
changes, disable this plugin while adapting it. The company's core execution and
budget behavior remain independent of the estimate page.

## Development

```sh
npm ci
npm run typecheck
npm test
npm run build
npm pack
```

Tests cover cached-token arithmetic, unknown prices, partial attribution, invalid
inputs, failed feed refresh, read-only SQL and manual action authorization.

License: MIT. This project is independent of Paperclip and LiteLLM.
