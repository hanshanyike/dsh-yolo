import { defineConfig } from 'tsdown'

// YOLO host-side build config (client bundle has its own config below).
//   entry: one per host plugin + the bare-package entry (src/index.ts) that
//   `dsh-plugin-yolo` (package main) resolves to for the ClientModuleRegistry.
//   external: host provides @deepseek-ai/* at runtime — bundling them creates
//   shared chunks whose `createRequire('../package.json')` breaks at runtime.
export default defineConfig({
  entry: [
    'src/index.ts',
    'src/storage/index.ts',
    'src/memory/index.ts',
    'src/extract/index.ts',
    'src/reminder/index.ts',
    'src/ui/index.ts',
  ],
  format: 'esm',
  platform: 'node',
  outDir: 'dist/src',
  clean: true,
  external: [/^@deepseek-ai\//],
  outExtensions: () => ({ dts: '.d.ts' }),
})
