# Paperclip Subscription Cost Connector

Fetch Claude and Codex prices from LiteLLM and feed subscription usage valuations
into **Paperclip's native cost events**. Paperclip then owns cost summaries,
agent/project attribution, monthly spend and budget enforcement.

Version **0.2.0** replaces the separate calculator shipped in 0.1.0. The plugin
page now shows connection/sync status and links to native **Audit → Costs**.
No Paperclip server or adapter patches are required.

## Native accounting

For an original subscription-included cost event with recorded tokens and zero
cost, the connector posts a supplementary cost event through:

```text
POST /api/companies/{companyId}/cost-events
```

The supplementary event:

- Retains provider, model, agent, task, project, goal, run and occurrence time.
- Has **zero extra tokens**, retaining the original usage counters once.
- Uses biller `api-equivalent-estimate` and billing code `api-equivalent:<source-event-id>`.
- Uses the native `fixed` billing type for this supplied nominal valuation.
- Rounds the valuation to cents per source event, as required by native accounting.

Native Costs, Providers, Billers, project/task totals and monthly budget counters
all consume these cost events. **These valuations consume native dollar budgets**
and can trigger the normal warnings and hard stops. Original records remain
unchanged. Existing metered/API charges are not repriced or duplicated.

The current host supports cost statuses `reported` and `unpriced`; it has no
separate estimated-cost status for native budget accounting. The supplied
valuation therefore uses `reported`, while its dedicated biller and billing code
identify its estimated basis. It is an API-equivalent planning amount, not a
provider invoice or an additional subscription charge. Account-level subscription
fees remain in the native finance ledger.

## Install

Requires Node.js 24.11+ and Paperclip's Plugin SDK. Developed and verified with
Paperclip / SDK **2026.1005.0**. Check compatibility before upgrading your host.

```sh
git clone https://github.com/grandMa5ter/paperclip-cost-estimates.git
cd paperclip-cost-estimates
npm ci
npm run typecheck
npm test
npm run build
paperclipai plugin install --local "$PWD"
```

Local installs need the checkout to remain at that path. Build and validate a new
versioned directory before replacing a running installation. `npm pack` produces
a distributable package; an npm-registry release is not currently promised.

To replace 0.1.0 with 0.2.0 using the supported local-install workflow, ordinary
uninstall then reinstall retains the plugin's namespaced state. Do not use
`--force`, which purges state. The new version requests additional secret-reference,
event-subscription and plugin-namespace write capabilities for native integration.

## Connect

Create a company-scoped native encrypted secret containing a Paperclip **board
API token** authorized to report costs for that company. Configure the plugin in
that company with this JSON, using your server origin and secret UUID:

```json
{
  "enabled": true,
  "apiBase": "http://localhost:3100",
  "apiToken": {
    "type": "secret_ref",
    "secretId": "<native-secret-uuid>",
    "version": "latest"
  }
}
```

Never put a token itself in plugin configuration or Git. The worker resolves the
bound secret through the official SDK for each batch. Credentials are sent only
to the configured Paperclip API origin. Public HTTP origins, URL credentials,
paths, query strings and redirects are rejected; private/loopback HTTP and HTTPS
are supported. The LiteLLM fetch never receives this token or your usage data.

Once enabled, historical subscription events are backfilled in batches of 50.
New usage triggers event-driven sync, and a one-minute job catches missed events.
The status page at `/<company-prefix>/cost-estimates` shows remaining and completed
records. **Sync next batch** lets a board user request a batch manually. Use native
**Costs** and **Budgets** for all financial totals and controls.

## Deduplication and failure recovery

Each source event has one durable row in the plugin's private `valuations` table,
with the exact payload, pricing snapshot hash, processing state and native receipt
ID. Concurrent claims are atomic. Repeated delivery, worker restart and backfill
do not repost completed valuations. Connector-generated events are not input
usage, so they cannot create a pricing loop.

The host's native cost API has no idempotency key. Before sending, the connector
checks for its deterministic billing code. If the response is lost after the
event was accepted, it reconciles the native row and records its receipt.
**An uncertain write without a native receipt is never resent automatically.**
It remains visible for operator reconciliation. This also applies to a crash
after claiming a record but before the network request. Unknown models are left
unvalued until a usable price becomes available.

Disable stops future valuation without changing original usage or existing native
cost history. Native historical valuations remain part of native budgets; disable
and uninstall do not reverse them.

```sh
paperclipai plugin disable paperclip-cost-estimates
paperclipai plugin uninstall paperclip-cost-estimates
```

## Pricing basis

Prices come from the [LiteLLM public price file](https://github.com/BerriAI/litellm/blob/main/model_prices_and_context_window.json).
The feed refreshes daily at 02:17 UTC and when an accessed snapshot is over 24 hours
old. Snapshots retain source URL, fetch time and SHA-256. Failed refresh retains
the prior snapshot; unavailable initial prices prevent valuation.

```text
USD = ordinary input × input_cost_per_token
    + cached input × cache_read_input_token_cost
    + output × output_cost_per_token
```

These rates are already USD per token. Paperclip ordinary-input and cached-input
counters are separate. Only exact first-party OpenAI/Anthropic models are matched.
Cache writes, paid tools, regional uplifts, service-tier premiums and per-request
context surcharges are excluded. Token receipts may omit some work. These limits
can understate a future API invoice. All figures are USD.

Each valuation keeps the rate snapshot used when first processed. Price refresh
does not rewrite historical native valuations. Per-event cent rounding means a
native total can differ slightly from rounding an aggregate calculator total.

## Development and upgrades

```sh
npm run typecheck
npm test
npm run build
npm pack
```

Tests cover cached-token arithmetic, native payload attribution, zero extra tokens,
API/connector-event exclusion, concurrent/repeated/restarted sync, lost-response
recovery and refusal to retry uncertain writes. Worker/native-table reads and
private-table mutations use the official SDK. Native financial writes use the
public cost-event API so all native accounting and budget hooks execute.

Paperclip plugins are trusted code in the current runtime. This project imports
no server internals and never writes native tables directly. Before a host upgrade,
validate the SDK build, plugin health, native cost totals and sync behavior. The
connector can be disabled independently of core agent execution.

License: MIT. Independent of Paperclip and LiteLLM.
