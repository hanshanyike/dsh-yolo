import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'
import { openDb } from '../src/storage/db.ts'
import { logTodoResolution } from '../src/storage/repository.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
  roots.length = 0
})

describe('todo resolver labeling tool', () => {
  it('exports local shadow logs and reports stratified exact/error rates', () => {
    const root = mkdtempSync(join(tmpdir(), 'yolo-resolver-eval-'))
    roots.push(root)
    const dbPath = join(root, 'yolo.db')
    const samplesPath = join(root, 'samples.jsonl')
    const db = openDb(dbPath)
    logTodoResolution(db, {
      scope_key: 'scope/default',
      session_id: 'session-1',
      turn_seq: 2,
      operation_id: 'extract/session-1/2',
      input_fingerprint: 'hash-1',
      input_excerpt: '研发那份演示材料别忘了发出去',
      resolver_version: 'shadow-v1',
      model_provider: 'provider',
      model_name: 'model',
      status: 'ok',
      candidates_json: JSON.stringify([{ id: 'todo-1', title: '把演示稿发给研发', status: 'pending' }]),
      resolutions_json: JSON.stringify([{ decision: 'LINK', candidate_ids: ['todo-1'] }]),
    })
    db.close()

    const script = resolve('scripts/todo-resolver-eval.mjs')
    const exported = spawnSync(process.execPath, [script, 'export', dbPath, samplesPath], { encoding: 'utf8' })
    expect(exported.status, exported.stderr).toBe(0)
    const sample = JSON.parse(readFileSync(samplesPath, 'utf8').trim())
    expect(sample).toMatchObject({
      input_excerpt: '研发那份演示材料别忘了发出去',
      prediction: { decision: 'LINK', candidate_ids: ['todo-1'] },
      expected: null,
    })

    sample.stratum = 'paraphrase'
    sample.expected = { decision: 'LINK', candidate_ids: ['todo-1'] }
    writeFileSync(samplesPath, `${JSON.stringify(sample)}\n`, 'utf8')
    const evaluated = spawnSync(process.execPath, [script, 'evaluate', samplesPath], { encoding: 'utf8' })
    expect(evaluated.status, evaluated.stderr).toBe(0)
    const report = JSON.parse(evaluated.stdout)
    expect(report.overall).toMatchObject({ labeled: 1, exact: 1, false_link: 0, missed_link: 0 })
    expect(report.by_stratum.paraphrase.exact_rate).toBe(1)
  })
})
