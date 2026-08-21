import { defineConfig } from 'tsdown'

// YOLO browser-side build config — SEPARATE from the host config on purpose.
// dsh loads client bundles as classic <script> tags through
// `window.__ModuleLoader__.load({ id, factory })`: the factory is CJS-shaped
// (`module.exports`), so the bundle MUST be CJS, not ESM (`export {}` does not
// execute in a classic script and the factory returns an empty exports object
// → "loaded without registering"). `scripts/wrap-client.mjs` (post-build) adds
// the __ModuleLoader__ wrapper plus a `process` shim.
//
// react / react/jsx-runtime are EXTERNAL: the host client module table seeds
// them (official bundles require('react') the same way), so components using
// hooks share the host's single React instance — bundling a second copy breaks
// hooks ("Invalid hook call").
export default defineConfig({
  entry: ['client/index.ts'],
  format: 'cjs',
  platform: 'browser',
  outDir: 'dist/client',
  outExtensions: () => ({ js: '.mjs' }),
  clean: false,
  external: [/^react(\/|$)/],
})
