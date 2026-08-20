import { defineConfig } from 'tsdown'

// YOLO build config — one entry per plugin (each is an independent dsh plugin)
// plus the browser client bundle.
//   host plugins:  src/{storage,memory,extract,reminder,ui}/index.ts -> dist/src/*/index.mjs
//   client bundle: client/index.ts -> dist/client/index.mjs (browser, ESM, self-contained)
// Runtime dev loads these from source via cordis.dev.yml (file:// URLs); dist is
// for release when the package is installed into a dsh profile (cordis.bundle.yml).
export default defineConfig({
  entry: [
    'src/storage/index.ts',
    'src/memory/index.ts',
    'src/extract/index.ts',
    'src/reminder/index.ts',
    'src/ui/index.ts',
    'client/index.ts',
  ],
  format: 'esm',
  platform: 'node',
  clean: true,
  // Client bundle must be self-contained (dsh bundle-purity gate forbids cross-plugin value imports).
  // React is a devDependency and bundled in, not declared as peer.
  outExtensions: () => ({ dts: '.d.ts' }),
})
