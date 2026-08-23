#!/usr/bin/env node
// YOLO end-to-end test runner (real host + Playwright).
//
//   node scripts/e2e.mjs                 # ensure host up, run ALL specs (api + ui)
//   node scripts/e2e.mjs --lane=api      # HTTP-only lane (no browser, fastest feedback)
//   node scripts/e2e.mjs --lane=ui       # browser lane only
//   node scripts/e2e.mjs --spec panel-flow   # one spec, space or "=" form both work
//   node scripts/e2e.mjs --no-host       # reuse an already-running host
//   node scripts/e2e.mjs --no-clean      # skip the [E2E] fixture sweep before bring-up
//
// Environment:
//   YOLO_E2E_PORT     port for a runner-started host (default 3080)
//   YOLO_E2E_HOST     base URL the specs drive (default http://127.0.0.1:<port>)
//   YOLO_E2E_PROBE_MS health-probe timeout per attempt (default 15000 — must
//                     exceed worst-case /yolo/dashboard latency, or healthy
//                     hosts get declared down)
//   YOLO_E2E_REPORT   when set, Playwright additionally writes a JSON report
//                     there (machine-readable summary for agents/CI)
//
// Host bring-up mirrors scripts/dev conventions (idempotent): ensure checkout,
// deps, build, junction + runtime patch, then `pnpm dsh web`. If a host already
// answers GET /yolo/dashboard we reuse it and never touch its database — only a
// host THIS runner starts gets the pre-run [E2E] fixture sweep, and only a host
// this runner started is stopped afterwards.
//
// Why the sweep exists: crashed/interrupted runs used to leak `[E2E]` rows that
// bloated the dashboard payload and slowed every later call (the old habit was
// running scripts/clean-test-data.mjs by hand — AGENTS.md). Bring-up now does
// it automatically while the DB is guaranteed closed (host not yet started).

import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readlinkSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const HOST = join(ROOT, 'host', 'deepseek-harness')
const HOST_REPO = 'https://github.com/deepseek-ai/deepseek-harness.git'
const PROFILE_DIR = join(homedir(), '.dsh', 'profiles')
const LINK_DIR = join(PROFILE_DIR, 'node_modules')
const LINK = join(LINK_DIR, 'dsh-plugin-yolo')
const PATCH = join(ROOT, 'cordis.dev.local.yml')
const PORT = Number(process.env.YOLO_E2E_PORT ?? process.env.PORT ?? 3080)
const BASE = `http://127.0.0.1:${PORT}`
const PROBE_TIMEOUT_MS = Number(process.env.YOLO_E2E_PROBE_MS ?? 15_000)

const win = process.platform === 'win32'

// ---- args (both "--flag=value" and "--flag value" forms) ----
const argv = process.argv.slice(2)
function argValue(name) {
  const eq = argv.find((a) => a.startsWith(`--${name}=`))
  if (eq !== undefined) return eq.slice(name.length + 3)
  const i = argv.indexOf(`--${name}`)
  if (i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--')) return argv[i + 1]
  return undefined
}
const SPEC = argValue('spec')
const LANE = (argValue('lane') ?? '').toLowerCase() // api | ui | (empty = all)
const skipHost = argv.includes('--no-host')
const noClean = argv.includes('--no-clean')

function childEnv() {
  const raw = process.env.NODE_OPTIONS ?? ''
  const cleaned = raw.replace(/--require=["'][^"']*genie-safe-delete[^"']*["']/g, '').trim()
  return { ...process.env, NODE_OPTIONS: cleaned }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

function hostUp() {
  try {
    // A host that answers with a 5xx (e.g. a stale dist missing a runtime asset)
    // is NOT usable — only treat a 2xx dashboard response as "up", so the runner
    // never silently reuses a broken host (the ready-wait loop also relies on this).
    // The probe budget must exceed real dashboard latency: it used to be 3s while
    // the endpoint legitimately took ~3s+ under fixture bloat, so healthy hosts
    // were declared dead ("nothing at ..." / "did not become ready").
    execFileSync('node', ['-e', `
      const c = require('node:http').request('${BASE}/yolo/dashboard', r => {
        const ok = r.statusCode >= 200 && r.statusCode < 300;
        r.resume(); process.exit(ok ? 0 : 1)
      });
      c.on('error', () => process.exit(1)); c.setTimeout(${PROBE_TIMEOUT_MS}, () => { c.destroy(); process.exit(1) }); c.end();
    `], { stdio: 'ignore', env: childEnv(), windowsHide: true, timeout: PROBE_TIMEOUT_MS + 5000 })
    return true
  } catch {
    return false
  }
}

function run(cmd, argsList, opts = {}) {
  const r = spawnSync(cmd, argsList, {
    cwd: opts.cwd ?? ROOT,
    stdio: opts.silent ? 'ignore' : 'inherit',
    env: childEnv(),
    shell: win && cmd === 'pnpm',
  })
  return r.status ?? 1
}

/**
 * Delete `[E2E]`-prefixed fixture rows from every known yolo SQLite store.
 * Same contract as scripts/clean-test-data.mjs, inlined so bring-up can run it
 * at the only moment it is safe (no host holds the DB yet). Only machine
 * fixtures ([E2E] prefix) are touched; real user rows stay untouched.
 */
function sweepE2EFixtures() {
  const dirs = [join(ROOT, '.dsh', 'yolo'), join(homedir(), '.dsh', 'yolo')]
  let total = 0
  let Database
  try {
    // resolved from ROOT/node_modules — the same better-sqlite3 the plugin ships
    Database = createRequire(join(ROOT, 'package.json'))('better-sqlite3')
  } catch (e) {
    console.log(`[e2e] fixture sweep skipped (better-sqlite3 unavailable: ${e.message})`)
    return
  }
  for (const dir of dirs) {
    if (!existsSync(dir)) continue
    for (const file of readdirSync(dir).filter((f) => f.startsWith('yolo-') && f.endsWith('.db'))) {
      const path = join(dir, file)
      let db
      try {
        db = new Database(path, { readonly: false })
      } catch {
        console.log(`[e2e] fixture sweep: skip (locked) ${path}`)
        continue
      }
      const c = (sql) => { try { return db.prepare(sql).run().changes } catch { return 0 } }
      const n =
        c("DELETE FROM todos WHERE title LIKE '[E2E]%'") +
        c("DELETE FROM notifications WHERE title LIKE '[E2E]%'") +
        c("DELETE FROM events WHERE summary LIKE '%[E2E]%' OR detail LIKE '%[E2E]%'") +
        c("DELETE FROM session_summaries WHERE summary LIKE '%[E2E]%'")
      total += n
      if (n > 0) console.log(`[e2e] fixture sweep ${file}: removed ${n} rows`)
      db.close()
    }
  }
  console.log(total > 0 ? `[e2e] fixture sweep done: ${total} stale rows removed` : '[e2e] fixture sweep: nothing to remove')
}

async function bringUpHost() {
  const step = (n, label) => console.log(`\n[e2e] step ${n}: ${label}`)

  step(1, 'host checkout')
  if (!existsSync(join(HOST, 'package.json'))) {
    mkdirSync(join(ROOT, 'host'), { recursive: true })
    execFileSync('git', ['clone', '--depth', '1', HOST_REPO, HOST], { stdio: 'inherit' })
  }

  step(2, 'host deps')
  if (!existsSync(join(HOST, 'node_modules'))) run('pnpm', ['install'], { cwd: HOST })

  step(3, 'host build')
  if (!existsSync(join(HOST, 'apps', 'web', 'dist'))) run('pnpm', ['run', 'build'], { cwd: HOST })

  step(4, 'YOLO deps')
  if (!existsSync(join(ROOT, 'node_modules'))) run('pnpm', ['install'])

  step(5, 'YOLO build (client bundle)')
  // A stale/incomplete dist (e.g. client bundle present but runtime assets like
  // schema.sql missing) silently breaks every dashboard query later, so rebuild
  // whenever any required artifact is absent rather than keying on index.mjs only.
  if (
    !existsSync(join(ROOT, 'dist', 'client', 'index.mjs')) ||
    !existsSync(join(ROOT, 'dist', 'src', 'storage', 'schema.sql'))
  ) run('pnpm', ['build'])

  step(6, 'profile junction')
  mkdirSync(LINK_DIR, { recursive: true })
  let ok = false
  try { ok = readlinkSync(LINK).toLowerCase() === ROOT.toLowerCase() } catch { ok = false }
  if (!ok) {
    if (existsSync(LINK)) {
      if (win) execFileSync('cmd', ['/c', 'rmdir', LINK])
      else rmSync(LINK, { recursive: true, force: true })
    }
    try { symlinkSync(ROOT, LINK, 'junction'); console.log(`[e2e] junction: ${LINK} -> ${ROOT}`) }
    catch (e) { console.error(`[e2e] junction failed: ${e.message}`); process.exit(1) }
  }

  step(7, 'runtime patch')
  writeFileSync(PATCH, `# Generated by scripts/e2e.mjs — do not edit.
- insert:
  - id: yolo
    name: dsh-plugin-yolo
  - id: yolo-storage
    name: dsh-plugin-yolo/dist/src/storage
  - id: yolo-memory
    name: dsh-plugin-yolo/dist/src/memory
  - id: yolo-extract
    name: dsh-plugin-yolo/dist/src/extract
  - id: yolo-reminder
    name: dsh-plugin-yolo/dist/src/reminder
  - id: yolo-ui
    name: dsh-plugin-yolo/dist/src/ui
`)

  if (noClean) {
    console.log('[e2e] step 7b: [E2E] fixture sweep skipped (--no-clean)')
  } else {
    step('7b', '[E2E] fixture sweep (DB closed — safe window)')
    sweepE2EFixtures()
  }

  step(8, `start dsh web on :${PORT}`)
  const child = spawn('pnpm', ['dsh', 'web', '--patch', PATCH, '--no-open', '--port', String(PORT)], {
    cwd: HOST, env: childEnv(), stdio: 'ignore', shell: win, detached: !win,
  })
  const deadline = Date.now() + 180_000
  while (Date.now() < deadline) {
    if (hostUp()) return child
    if (child.exitCode !== null || child.signalCode !== null) {
      console.error('[e2e] host process exited during bring-up')
      process.exit(1)
    }
    await sleep(1000)
  }
  console.error(`[e2e] host did not become ready on ${BASE}`)
  try { child.kill() } catch {}
  process.exit(1)
}

/** Map --lane/--spec to Playwright path filters (paths are relative to testDir). */
function selectionArgs() {
  if (SPEC) return [join(ROOT, 'tests', 'e2e', `${SPEC.replace(/\.spec\.ts$/, '')}.spec.ts`)]
  if (LANE === 'api') return [join(ROOT, 'tests', 'e2e', 'api')]
  if (LANE === 'ui') return [join(ROOT, 'tests', 'e2e', 'ui')]
  if (LANE) {
    console.error(`[e2e] unknown lane "${LANE}" (use api | ui | all)`)
    process.exit(2)
  }
  return []
}

;(async () => {
  const t0 = Date.now()
  let startedChild = null
  if (skipHost) {
    if (!hostUp()) {
      console.error(`[e2e] --no-host but nothing answering ${BASE}/yolo/dashboard (probe budget ${PROBE_TIMEOUT_MS}ms — raise YOLO_E2E_PROBE_MS if the host is just slow)`)
      process.exit(1)
    }
    console.log(`[e2e] reusing running host at ${BASE} (--no-host; its database is NOT touched)`)
  } else if (hostUp()) {
    console.log(`[e2e] reusing running host at ${BASE} (its database is NOT touched)`)
  } else {
    console.log(`[e2e] no host answering ${BASE} — bringing it up`)
    startedChild = await bringUpHost()
  }

  const sel = selectionArgs()
  if (sel.length) console.log(`[e2e] selection: ${sel.map((p) => p.slice(ROOT.length + 1)).join(', ')}`)
  const code = run('pnpm', ['exec', 'playwright', 'test', ...sel], { cwd: ROOT })

  if (startedChild) {
    console.log('[e2e] stopping the host this runner started')
    try { startedChild.kill() } catch {}
  }
  const report = process.env.YOLO_E2E_REPORT
  if (report && existsSync(report)) {
    try {
      const j = JSON.parse(readFileSync(report, 'utf8'))
      const stats = j.stats ?? {}
      console.log(`[e2e] report ${report}: expected=${stats.expected} unexpected=${stats.unexpected} skipped=${stats.skipped} durationMs=${Math.round(stats.duration ?? 0)}`)
    } catch { /* summary is best-effort */ }
  }
  console.log(`[e2e] wall ${(Date.now() - t0) / 1000}s, exit ${code ?? 0}`)
  process.exit(code ?? 0)
})()
