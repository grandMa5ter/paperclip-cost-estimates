import { build } from 'esbuild';
import { createPluginBundlerPresets } from '@paperclipai/plugin-sdk/bundlers';
const { esbuild } = createPluginBundlerPresets({ uiEntry: 'src/ui/index.tsx', sourcemap: false });
await Promise.all(Object.values(esbuild).filter(Boolean).map(options => build(options)));
