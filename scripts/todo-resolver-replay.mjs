import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const win = process.platform === 'win32'

function usage(code = 1) {
  console.error('Usage: node scripts/todo-resolver-replay.mjs <gold.jsonl> <predictions.jsonl> [--report <report.json>] [--as-of <ISO>] [--timeout-ms <ms>] [--require-gate]')
  process.exitCode = code
}

function option(name, fallback) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : fallback
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms))
}

async function freePort() {
  return await new Promise((resolvePromise, reject) => {
    const server = createServer()
    server.unref()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close((error) => error ? reject(error) : resolvePromise(port))
    })
  })
}

function killTree(child) {
  if (!child?.pid) return
  if (win) {
    try { execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }) } catch {}
  } else {
    try { process.kill(-child.pid, 'SIGTERM') } catch { try { child.kill() } catch {} }
  }
}

async function removeRunRoot(path) {
  let lastError
  for (let attempt = 1; attempt <= 10; attempt++) {
    try {
      rmSync(path, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 })
      return
    } catch (error) {
      lastError = error
      // Windows can keep the child cwd/SQLite handles alive briefly after
      // taskkill returns. A bounded retry preserves strict cleanup semantics
      // without reusing or silently abandoning the directory.
      await sleep(250)
    }
  }
  throw lastError
}

const positional = process.argv.slice(2).filter((arg, index, args) => {
  if (arg.startsWith('--')) return false
  return index === 0 || !args[index - 1]?.startsWith('--')
})
if (positional.length < 2) {
  usage()
} else {
  const input = resolve(positional[0])
  const output = resolve(positional[1])
  const report = resolve(option('--report', `${output}.report.json`))
  const asOf = option('--as-of', '2026-08-30T09:00:00+08:00')
  const timeoutMs = Number(option('--timeout-ms', '900000'))
  const requireGate = process.argv.includes('--require-gate')
  if (!existsSync(input)) throw new Error(`gold corpus not found: ${input}`)
  if (input === output) throw new Error('prediction output must differ from the gold corpus')
  if (existsSync(output)) throw new Error(`prediction output already exists: ${output}`)
  if (existsSync(report)) throw new Error(`report output already exists: ${report}`)
  if (!Number.isFinite(timeoutMs) || timeoutMs < 10_000) throw new Error('timeout must be at least 10000ms')
  if (Number.isNaN(new Date(asOf).getTime())) throw new Error('invalid --as-of datetime')
  mkdirSync(dirname(output), { recursive: true })
  mkdirSync(dirname(report), { recursive: true })

  const runRoot = mkdtempSync(join(tmpdir(), 'yolo-resolver-replay-'))
  const workspace = join(runRoot, 'workspace')
  const statusPath = join(runRoot, 'status.json')
  mkdirSync(workspace)
  const port = await freePort()
  const logs = []
  // On Windows the global dsh shim is a .cmd file. Invoke cmd explicitly with
  // a fully fixed command shape instead of spawn({ shell: true }), which would
  // concatenate arbitrary arguments and emits Node's DEP0190 warning.
  const hostCommand = win ? (process.env.ComSpec || 'cmd.exe') : 'dsh'
  const hostArgs = win
    ? ['/d', '/s', '/c', `dsh web --no-open --port ${port}`]
    : ['web', '--no-open', '--port', String(port)]
  const child = spawn(hostCommand, hostArgs, {
    cwd: workspace,
    env: {
      ...process.env,
      YOLO_TODO_RESOLVER_REPLAY: '1',
      YOLO_TODO_RESOLVER_REPLAY_INPUT: input,
      YOLO_TODO_RESOLVER_REPLAY_OUTPUT: output,
      YOLO_TODO_RESOLVER_REPLAY_STATUS: statusPath,
      YOLO_TODO_RESOLVER_REPLAY_AS_OF: asOf,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: !win,
    windowsHide: true,
  })
  const collect = (chunk) => {
    logs.push(String(chunk))
    while (logs.join('').length > 20_000) logs.shift()
  }
  child.stdout.on('data', collect)
  child.stderr.on('data', collect)
  const stop = () => killTree(child)
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)

  try {
    const deadline = Date.now() + timeoutMs
    while (!existsSync(statusPath) && Date.now() < deadline) {
      if (child.exitCode !== null || child.signalCode !== null) {
        throw new Error(`dsh host exited before replay completed\n${logs.join('').slice(-8000)}`)
      }
      await sleep(250)
    }
    if (!existsSync(statusPath)) throw new Error(`resolver replay timed out after ${timeoutMs}ms\n${logs.join('').slice(-8000)}`)
    const status = JSON.parse(readFileSync(statusPath, 'utf8'))
    if (status.status !== 'ok') throw new Error(`resolver replay failed: ${status.error ?? 'unknown error'}\n${logs.join('').slice(-8000)}`)
    if (!existsSync(output)) throw new Error('resolver replay reported success without an output file')
    console.log(JSON.stringify(status, null, 2))
  } finally {
    killTree(child)
    process.removeListener('SIGINT', stop)
    process.removeListener('SIGTERM', stop)
    await removeRunRoot(runRoot)
  }

  const mode = requireGate ? 'gate' : 'evaluate'
  const evaluated = spawnSync(process.execPath, [join(ROOT, 'scripts', 'todo-resolver-eval.mjs'), mode, output, report], {
    cwd: ROOT,
    stdio: 'inherit',
  })
  process.exitCode = evaluated.status ?? 1
}
