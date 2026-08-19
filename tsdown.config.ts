import { defineConfig } from 'tsdown'

// YOLO build config.
// host bundle:   src/index.ts -> dist/index.js   (Node, ESM)
// client bundle: client/index.ts -> dist/client/index.js (browser, ESM, self-contained)
export default defineConfig({
  entry: ['src/index.ts', 'client/index.ts'],
  format: 'esm',
  platform: 'node',
  clean: true,
  // Client bundle must be self-contained (dsh bundle-purity gate forbids cross-plugin value imports).
  // React/recharts are devDependencies and bundled in, not declared as peer.
  outExtensions: () => ({ dts: '.d.ts' }),
})
