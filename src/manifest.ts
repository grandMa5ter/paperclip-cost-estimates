import type { PaperclipPluginManifestV1 } from '@paperclipai/plugin-sdk';
const manifest: PaperclipPluginManifestV1 = {
  id: 'paperclip-cost-estimates', apiVersion: 1, version: '0.2.0',
  displayName: 'Subscription Cost Connector', author: 'grandMa5ter', categories: ['automation'],
  description: 'Feed labelled API-equivalent subscription valuations into Paperclip native cost events and budget enforcement.',
  capabilities: ['ui.page.register', 'database.namespace.read', 'database.namespace.migrate', 'costs.read', 'companies.read',
    'database.namespace.write', 'events.subscribe', 'secrets.read-ref', 'instance.settings.register',
    'plugin.state.read', 'plugin.state.write', 'http.outbound', 'jobs.schedule'],
  entrypoints: { worker: 'dist/worker.js', ui: 'dist/ui' },
  database: { migrationsDir: 'migrations', coreReadTables: ['cost_events', 'projects', 'issues', 'agents'] },
  instanceConfigSchema: { type: 'object', properties: {
    enabled: { type: 'boolean', default: false, description: 'Enable native valuation and historical backfill.' },
    apiBase: { type: 'string', description: 'Paperclip API origin; HTTPS or private/loopback HTTP.' },
    apiToken: { type: 'object', properties: { type: { const: 'secret_ref' }, secretId: { type: 'string' }, version: { type: 'string' } },
      required: ['type', 'secretId'], additionalProperties: false, description: 'Native secret reference to a board API token.' },
  }, additionalProperties: false },
  jobs: [{ jobKey: 'refresh-prices', displayName: 'Refresh public model prices', schedule: '17 2 * * *' },
    { jobKey: 'sync-native-costs', displayName: 'Reconcile native subscription valuations', schedule: '* * * * *' }],
  ui: { slots: [{ type: 'page', id: 'connector', displayName: 'Cost Connector',
    exportName: 'ConnectorPage', routePath: 'cost-estimates' },
    { type: 'settingsPage', id: 'connector-settings', displayName: 'Cost Connector', exportName: 'ConnectorPage' }] },
};
export default manifest;
