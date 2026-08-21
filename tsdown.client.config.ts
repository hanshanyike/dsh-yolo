import { defineConfig } from 'tsdown'

// YOLO browser-side build config — SEPARATE from the host config on purpose.
// dsh loads client bundles as classic <script> tags through
// `window.__ModuleLoader__.load({ id, factory })`: the factory is CJS-shaped
// (`module.exports`), so the bundle MUST be CJS, not ESM (`export {}` does not
// execute in a classic script and the factory returns an empty exports object
// → "loaded without registering"). `scripts/wrap-client.mjs` (post-build) adds
// the __ModuleLoader__ wrapper plus a `process` shim for React's CJS entry.
export default defineConfig({
  entry: ['client/index.ts'],
  format: 'cjs',
  platform: 'browser',
  outDir: 'dist/client',
  outExtensions: () => ({ js: '.mjs' }),
  clean: false,
})
