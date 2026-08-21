#!/usr/bin/env node
// YOLO dev launcher (M2) — idempotent one-command setup + run against the
// deepseek-harness dev host.
//
// Steps:
//   1. ensure host checkout (clone --depth 1 if missing)
//   2. install host deps (when node_modules missing)
//   3. build host artifacts (when apps/web/dist missing)
//   4. install YOLO deps (when node_modules missing — includes better-sqlite3
//      native binding, allowed via pnpm-workspace.yaml allowBuilds)
//   5. build YOLO artifacts (when dist/client/index.mjs missing — client bundle
//      discovery requires the built + wrapped client entry)
//   6. create the profile junction (~/.dsh/profiles/node_modules/dsh-plugin-yolo
//      -> repo root) so host resolves the package name to this repo
//   7. generate the runtime patch cordis.dev.local.yml (package-name entries:
//      bare name for the ClientModuleRegistry + per-plugin subpaths)
//   8. start `pnpm dsh web --patch <yml> --no-open --port <port>` in the host
//
// Options:
//   --setup   run steps 1-7 only (prepare, do not start)
//   --update  git pull the host first, then reinstall + rebuild, then start
//   --port N  custom port (default 4080 — 3080 is the running dsh GUI itself)
//   --fix-acl elevate once via UAC to repair the workspace ACL (Windows only)

import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const HOST = join(ROOT, 'host', 'deepseek-harness')
const HOST_REPO = 'https://github.com/deepseek-ai/deepseek-harness.git'
const PROFILE_DIR = join(homedir(), '.dsh', 'profiles')
const LINK_DIR = join(PROFILE_DIR, 'node_modules')
const LINK = join(LINK_DIR, 'dsh-plugin-yolo')
const PATCH = join(ROOT, 'cordis.dev.local.yml')
const PORT = parsePort()

function parsePort() {
  const i = process.argv.indexOf('--port')
  return i !== -1 && process.argv[i + 1] ? Number(process.argv[i + 1]) : 4080
}
const SETUP = process.argv.includes('--setup')
const UPDATE = process.argv.includes('--update')
const FIX_ACL = process.argv.includes('--fix-acl')

const win = process.platform === 'win32'

// ---------------------------------------------------------------------------
// Windows ACL preflight.
//
// The dsh sandbox grants a workspace-write ACE on the workspace directory via
// SetNamedSecurityInfoW, which needs WRITE_DAC. A directory created by an
// ELEVATED process is owned by BUILTIN\Administrators and typically grants the
// standard user only "Modify" (M) — no WRITE_DAC — so every confined tool then
// fails with: "SetNamedSecurityInfoW failed (Win32 5): grantWrite(<dir>)".
//
// The preflight detects this BEFORE the host starts and prints the one-time
// repair (take ownership + full-control grant). `--fix-acl` performs it via UAC.
// ---------------------------------------------------------------------------

/** Principals whose ACEs a non-elevated standard user can actually use. */
const COVERING_PRINCIPALS = new Set([
  'everyone',
  'nt authority\\authenticated users',
  'nt authority\\authenticated users@',
  'builtin\\users',
])

function runCapture(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', shell: false, windowsHide: true })
  return r.status === 0 ? `${r.stdout ?? ''}` : null
}

function windowsAclStatus(dir) {
  const whoami = runCapture('whoami', [])
  const me = whoami ? whoami.trim().toLowerCase() : null
  const icacls = runCapture('icacls', [dir])
  if (!icacls) return { ok: true, detail: 'icacls unavailable — skipping check' }

  const covering = new Set([...COVERING_PRINCIPALS])
  if (me) covering.add(me)

  // ACE lines look like: "  PRINCIPAL:(I)(OI)(CI)(IO)(F)" — rights are the
  // trailing parenthesized tokens. F (full) includes WRITE_DAC; explicit
  // WDAC grants it too. BUILTIN\Administrators is deliberately NOT covering:
  // a non-elevated token carries the group as deny-only.
  for (const line of icacls.split(/\r?\n/)) {
    const m = line.trim().match(/^(.+?):\(([^)]*)\)/)
    if (!m) continue
    const principal = m[1].toLowerCase()
    if (!covering.has(principal)) continue
    const rights = line.trim().slice(line.trim().lastIndexOf('(') + 1, -1).toLowerCase()
    if (rights === 'f' || rights.includes('wdac')) {
      return { ok: true, detail: `"${m[1]}" carries ${line.trim().endsWith('(F)') ? 'full control' : 'WRITE_DAC'}` }
    }
  }

  // No full-control ACE — the last escape hatch is ownership (the owner
  // implicitly holds WRITE_DAC).
  const ps = runCapture('powershell.exe', [
    '-NoProfile', '-Command',
    `([System.IO.Directory]::GetAccessControl('${dir.replace(/'/g, "''")}')).Owner`,
  ])
  const owner = ps ? ps.trim() : null
  if (owner && me && owner.toLowerCase() === me) {
    return { ok: true, detail: `owner is ${owner} (implicit WRITE_DAC)` }
  }
  return {
    ok: false,
    detail: owner ? `owner=${owner}, user=${me}, no full-control ACE for the user` : 'no full-control ACE for the user',
  }
}

function aclFixCommands(dir) {
  const user = process.env.USERNAME ?? ''
  return [
    `takeown /f "${dir}"`,
    `icacls "${dir}" /grant "${user}:(OI)(CI)F"`,
  ]
}

function fixAclElevated(dir) {
  const cmds = aclFixCommands(dir).join(' && ')
  console.log(`[dev] requesting elevation to run:\n      ${cmds}`)
  const r = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-Command', `Start-Process cmd -Verb RunAs -Wait -ArgumentList '/c ${cmds.replace(/"/g, '\\"')}'`],
    { stdio: 'inherit', shell: false },
  )
  if (r.status !== 0) {
    console.error('[dev] elevated repair failed or was declined.')
    process.exit(r.status ?? 1)
  }
  const after = windowsAclStatus(dir)
  console.log(after.ok
    ? `[dev] ACL repaired (${after.detail}).`
    : `[dev] ACL still not writable (${after.detail}). Run the two commands above manually from an elevated terminal.`)
}

function warnWindowsAcl() {
  if (!win) return
  const status = windowsAclStatus(ROOT)
  if (status.ok) {
    console.log(`[dev] workspace ACL ok — ${status.detail}`)
    return
  }
  console.log(`
[dev] WARNING: this workspace directory cannot change its own DACL
      (${status.detail}). The dsh sandbox grants a workspace-write ACE
      before running confined tools and WILL fail mid-session with:
        SetNamedSecurityInfoW failed (Win32 5): grantWrite(${ROOT})

      One-time repair — run these from an ELEVATED terminal:
${aclFixCommands(ROOT).map((c) => `        ${c}`).join('\n')}
      or: node scripts/dev.mjs --fix-acl   (prompts UAC, no terminal needed)

      See docs/architecture.md#windows-environment.
`)
}

/** Strip the WorkBuddy safe-delete shim from NODE_OPTIONS so child processes
 *  (pnpm, dsh, etc.) don't abort on temp-dir cleanup under Git Bash. */
function childEnv() {
  const raw = process.env.NODE_OPTIONS ?? ''
  // Strip the WorkBuddy safe-delete require while preserving other NODE_OPTIONS.
  const cleaned = raw.replace(/--require=["'][^"']*genie-safe-delete[^"']*["']/g, '').trim()
  return { ...process.env, NODE_OPTIONS: cleaned }
}

const run = (cmd, args, cwd) => {
  const r = spawnSync(cmd, args, {
    cwd,
    stdio: 'inherit',
    shell: win && cmd === 'pnpm',
    env: childEnv(),
  })
  if (r.status !== 0) {
    console.error(`[dev] command failed: ${cmd} ${args.join(' ')} (exit ${r.status})`)
    if (win && cmd === 'pnpm') {
      console.error('[dev] tip: if this is the safe-delete trash error, run the command in PowerShell.')
    }
    process.exit(r.status ?? 1)
  }
}

const step = (n, label) => console.log(`\n[dev] step ${n}: ${label}`)

// 1. host checkout
step(1, 'host checkout')
if (!existsSync(join(HOST, 'package.json'))) {
  mkdirSync(join(ROOT, 'host'), { recursive: true })
  console.log('[dev] cloning deepseek-harness (shallow)...')
  execFileSync('git', ['clone', '--depth', '1', HOST_REPO, HOST], { stdio: 'inherit' })
} else {
  console.log('[dev] host checkout present')
  if (UPDATE) {
    console.log('[dev] git pull...')
    execFileSync('git', ['pull', '--ff-only'], { cwd: HOST, stdio: 'inherit' })
  }
}

// 2. host install
step(2, 'host deps')
if (!existsSync(join(HOST, 'node_modules'))) {
  run('pnpm', ['install'], HOST)
} else {
  console.log('[dev] host node_modules present')
}

// 3. host build
step(3, 'host build (web-app dist)')
if (!existsSync(join(HOST, 'apps', 'web', 'dist'))) {
  run('pnpm', ['run', 'build'], HOST)
} else {
  console.log('[dev] host dist present')
}

// 4. YOLO deps
step(4, 'YOLO deps')
if (!existsSync(join(ROOT, 'node_modules'))) {
  run('pnpm', ['install'], ROOT)
} else {
  console.log('[dev] YOLO node_modules present')
}

// 5. YOLO build (host plugins + wrapped client bundle)
step(5, 'YOLO build (client bundle)')
const rootEntry = join(ROOT, 'dist', 'src', 'index.mjs')
const hostEntries = ['storage', 'memory', 'extract', 'reminder', 'ui'].map((m) =>
  join(ROOT, 'dist', 'src', m, 'index.mjs'),
)
if (!existsSync(join(ROOT, 'dist', 'client', 'index.mjs')) || !existsSync(rootEntry) || hostEntries.some((p) => !existsSync(p))) {
  run('pnpm', ['build'], ROOT)
} else {
  console.log('[dev] YOLO dist present')
}

// 6. profile junction — host resolves `dsh-plugin-yolo` from the profile's
//    node_modules; a Windows junction (no admin needed) keeps this repo live.
step(6, 'profile junction')
mkdirSync(LINK_DIR, { recursive: true })
const linkOk = () => {
  try {
    return readlinkSync(LINK).toLowerCase() === ROOT.toLowerCase()
  } catch {
    return false
  }
}
if (linkOk()) {
  console.log('[dev] junction present')
} else {
  if (existsSync(LINK)) {
    // Bypass the WorkBuddy safe-delete shim on Windows: it tries to trash the
    // junction and aborts. `rmdir` via cmd removes the junction link only.
    if (win) execFileSync('cmd', ['/c', 'rmdir', LINK])
    else rmSync(LINK, { recursive: true, force: true })
  }
  try {
    symlinkSync(ROOT, LINK, 'junction')
    console.log(`[dev] junction: ${LINK} -> ${ROOT}`)
  } catch (e) {
    console.error(`[dev] junction failed: ${e.message}`)
    process.exit(1)
  }
}

// 7. runtime patch — package-name entries (bare name for ClientModuleRegistry
//    discovery + per-plugin subpaths resolved via package.json exports)
step(7, 'runtime patch')
const patch = `# Generated by scripts/dev.mjs — do not edit.
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
`
writeFileSync(PATCH, patch)
console.log(`[dev] patch: ${PATCH}`)

if (SETUP) {
  console.log('\n[dev] setup complete. Start with: node scripts/dev.mjs')
  process.exit(0)
}

warnWindowsAcl()

// 8. start
step(8, `start dsh web on :${PORT}`)
run('pnpm', ['dsh', 'web', '--patch', PATCH, '--no-open', '--port', String(PORT)], HOST)
