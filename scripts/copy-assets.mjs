// Post-build asset copy — tsdown only bundles TS; runtime assets read via
// import.meta.url (db.ts loads schema.sql next to itself) must be copied into
// the build output so the built plugin works from dist.
//   src/storage/schema.sql -> dist/src/storage/schema.sql

import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')

const assets = [
  ['src/storage/schema.sql', 'dist/src/storage/schema.sql'],
]

for (const [src, dest] of assets) {
  const from = join(ROOT, src)
  const to = join(ROOT, dest)
  mkdirSync(dirname(to), { recursive: true })
  copyFileSync(from, to)
  console.log(`[copy-assets] ${src} -> ${dest}`)
}
