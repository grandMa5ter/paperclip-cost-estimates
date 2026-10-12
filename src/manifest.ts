import type { PaperclipPluginManifestV1 } from '@paperclipai/plugin-sdk';
const manifest: PaperclipPluginManifestV1 = {
  id: 'paperclip-cost-estimates', apiVersion: 1, version: '0.1.0',
  displayName: 'Cost Estimates', author: 'grandMa5ter', categories: ['ui'],
  description: 'Claude and Codex token valuation at current LiteLLM standard API rates. Separate from billed spend and budget enforcement.',
  capabilities: ['ui.page.register', 'database.namespace.read', 'database.namespace.migrate', 'costs.read', 'companies.read',
    'plugin.state.read', 'plugin.state.write', 'http.outbound', 'jobs.schedule'],
  entrypoints: { worker: 'dist/worker.js', ui: 'dist/ui' },
  database: { migrationsDir: 'migrations', coreReadTables: ['cost_events', 'projects', 'issues', 'agents'] },
  jobs: [{ jobKey: 'refresh-prices', displayName: 'Refresh public model prices', schedule: '17 2 * * *' }],
  ui: { slots: [{ type: 'page', id: 'estimates', displayName: 'Cost Estimates',
    exportName: 'EstimatesPage', routePath: 'cost-estimates' }] },
};
export default manifest;
