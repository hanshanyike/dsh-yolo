// Post-build wrapper for the YOLO client bundle (M6).
//
// dsh serves client bundles as classic <script> tags. The contract (see
// host/packages/client/modules) is: the bundle calls
//   window.__ModuleLoader__.load({ id, factory })
// where `factory(require)` returns `module.exports`.
//
// tsdown cannot emit this wrapper only for the client entry (the host plugin
// entries must stay plain ESM), so we add it here after the client build:
//   1. wrap the CJS bundle in the __ModuleLoader__.load call
//   2. inject a `process` shim — React's CJS entry branches on
//      `process.env.NODE_ENV` and browsers have no `process` global.

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const FILE = resolve(ROOT, 'dist/client/index.mjs')
const ID = 'dsh-plugin-yolo'
const MARK = `__ModuleLoader__.load({ id: "${ID}"`

const raw = readFileSync(FILE, 'utf8')

if (raw.includes(MARK)) {
  console.log('[wrap-client] already wrapped, skipping')
} else {
  const wrapped = `${MARK}, factory: (require) => {
var process = (typeof process !== 'undefined' && process) || { env: {} };
var module = { exports: {} }; var exports = module.exports;
${raw}
return module.exports;
} });`
  writeFileSync(FILE, wrapped)
  console.log(`[wrap-client] wrapped ${FILE} (${wrapped.length} bytes)`)
}
