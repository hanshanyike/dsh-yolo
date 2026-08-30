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
  it('keeps sanitized isolated-host predictions evaluable without exposing runtime identities', () => {
    const observedPath = resolve('tests/fixtures/todo-resolver-observed-cases.jsonl')
    const observedText = readFileSync(observedPath, 'utf8')
    expect(observedText).not.toMatch(/session-[0-9a-f-]{36}/iu)
    expect(observedText).not.toMatch(/[A-Z]:\\|\/(?:home|Users)\//u)
    expect(observedText).not.toMatch(/\b[0-9a-f]{64}\b/iu)
    expect(observedText).not.toMatch(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/iu)
    const observed = observedText.split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line))
    expect(observed).toHaveLength(2)
    for (const row of observed) {
      expect(row.provenance).toMatchObject({ kind: 'isolated_real_host_shadow', sanitized: true })
      expect(row.provenance.scope_key).toBeUndefined()
      expect(row.provenance.session_id).toBeUndefined()
      expect(row.provenance.input_fingerprint).toBeUndefined()
      expect(row.prediction).toMatchObject({ decision: 'UPDATE', candidate_ids: ['todo-observed-interview-notes'] })
      expect(row.expected).toEqual({ decision: 'UPDATE', candidate_ids: ['todo-observed-interview-notes'] })
      const candidateIds = new Set(row.candidates.map((candidate: { id: string }) => candidate.id))
      for (const id of [...row.prediction.candidate_ids, ...row.expected.candidate_ids]) expect(candidateIds.has(id)).toBe(true)
      if (row.application.plan.candidate_id) expect(candidateIds.has(row.application.plan.candidate_id)).toBe(true)
      if (row.application.todo_id) expect(candidateIds.has(row.application.todo_id)).toBe(true)
    }
    expect(observed[0]).toMatchObject({
      application: { plan: { mode: 'blocked', confidence: 0.95, reason: 'confidence_below_threshold' }, status: 'blocked' },
      application_context: {
        candidate_snapshot_due_at: '2026-09-01', authoritative_due_at_before_policy: '2026-09-05',
        prior_write_source: 'assistant_action', expected_status: 'blocked',
      },
    })
    expect(observed[1]).toMatchObject({
      application: { plan: { mode: 'authorized', confidence: 0.98, reason: 'safe_single_update' }, status: 'no_change', evidence_created: true },
      application_context: {
        candidate_snapshot_due_at: '2026-09-05', authoritative_due_at_before_policy: '2026-09-06',
        prior_write_source: 'assistant_action', expected_status: 'no_change',
      },
    })

    const evaluated = spawnSync(process.execPath, [resolve('scripts/todo-resolver-eval.mjs'), 'evaluate', observedPath], { encoding: 'utf8' })
    expect(evaluated.status, evaluated.stderr).toBe(0)
    expect(JSON.parse(evaluated.stdout)).toMatchObject({
      samples: 2,
      unlabeled: 0,
      unpredicted: 0,
      overall: { labeled: 2, exact: 2, false_link: 0, missed_link: 0 },
      by_stratum: { cross_session: { labeled: 2, exact: 2, false_link: 0, missed_link: 0 } },
    })
  })

  it('keeps the handcrafted Chinese gold corpus valid, bounded and risk-stratified', () => {
    const corpusPath = resolve('tests/fixtures/todo-resolver-labeled-cases.jsonl')
    const rows = readFileSync(corpusPath, 'utf8').split(/\r?\n/u).filter(Boolean).map((line, index) => {
      try { return JSON.parse(line) as Record<string, unknown> } catch { throw new Error(`invalid gold JSONL at line ${index + 1}`) }
    })
    const requiredStrata = new Set([
      'paraphrase', 'pronoun', 'ellipsis', 'cross_session', 'same_name_distinct', 'terminal', 'step',
    ])
    const requiredTags = new Set([
      'multi_candidate', 'same_title_distinct_object', 'same_title_distinct_customer',
      'same_title_distinct_date', 'negation_correction', 'duplicate', 'new_occurrence', 'reopen', 'noop',
    ])
    const allowedDecisions = new Set([
      'LINK', 'UPDATE', 'REOPEN', 'NEW_OCCURRENCE', 'CREATE', 'ATTACH_STEP', 'ASK', 'NOOP',
    ])
    const allowedStatuses = new Set(['pending', 'in_progress', 'done', 'cancelled'])
    const singleTargetDecisions = new Set([
      'LINK', 'UPDATE', 'REOPEN', 'NEW_OCCURRENCE', 'ATTACH_STEP',
    ])
    const sampleIds = new Set<string>()
    const strataCounts = new Map<string, number>()
    const seenTags = new Set<string>()
    const seenDecisions = new Set<string>()

    expect(rows).toHaveLength(42)
    for (const row of rows) {
      expect(typeof row.sample_id).toBe('string')
      expect(sampleIds.has(row.sample_id as string)).toBe(false)
      sampleIds.add(row.sample_id as string)

      expect(requiredStrata.has(row.stratum as string)).toBe(true)
      strataCounts.set(row.stratum as string, (strataCounts.get(row.stratum as string) ?? 0) + 1)
      expect(typeof row.input_excerpt).toBe('string')
      expect((row.input_excerpt as string).length).toBeGreaterThan(0)
      expect((row.input_excerpt as string).length).toBeLessThanOrEqual(1000)
      expect(row.prediction).toBeNull()
      expect(row.provenance).toEqual({ kind: 'handcrafted_shadow_style', locale: 'zh-CN' })

      const tags = row.tags as string[]
      expect(Array.isArray(tags)).toBe(true)
      tags.forEach((tag) => seenTags.add(tag))

      const candidates = row.candidates as Array<{
        id: string
        title: string
        status: string
        due_at?: string | null
        aliases: string[]
        rank: number
      }>
      expect(Array.isArray(candidates)).toBe(true)
      expect(candidates.length).toBeGreaterThan(0)
      expect(candidates.length).toBeLessThanOrEqual(4)
      const candidateIds = new Set(candidates.map((candidate) => candidate.id))
      expect(candidateIds.size).toBe(candidates.length)
      for (const candidate of candidates) {
        expect(typeof candidate.id).toBe('string')
        expect(candidate.id.length).toBeGreaterThan(0)
        expect(typeof candidate.title).toBe('string')
        expect(candidate.title.length).toBeGreaterThan(0)
        expect(allowedStatuses.has(candidate.status)).toBe(true)
        expect(Array.isArray(candidate.aliases)).toBe(true)
        candidate.aliases.forEach((alias) => expect(typeof alias).toBe('string'))
        expect(Number.isFinite(candidate.rank)).toBe(true)
        if (candidate.due_at !== undefined && candidate.due_at !== null) {
          expect(typeof candidate.due_at).toBe('string')
        }
      }

      const expected = row.expected as { decision: string, candidate_ids: string[] }
      expect(allowedDecisions.has(expected.decision)).toBe(true)
      expect(Array.isArray(expected.candidate_ids)).toBe(true)
      expect(new Set(expected.candidate_ids).size).toBe(expected.candidate_ids.length)
      expected.candidate_ids.forEach((id) => expect(candidateIds.has(id)).toBe(true))
      if (singleTargetDecisions.has(expected.decision)) expect(expected.candidate_ids).toHaveLength(1)
      if (expected.decision === 'CREATE' || expected.decision === 'NOOP') expect(expected.candidate_ids).toEqual([])
      if (expected.decision === 'ASK') expect(expected.candidate_ids.length).toBeGreaterThan(0)
      seenDecisions.add(expected.decision)
    }

    expect([...requiredStrata].every((stratum) => strataCounts.get(stratum) === 6)).toBe(true)
    expect([...requiredTags].every((tag) => seenTags.has(tag))).toBe(true)
    expect(seenDecisions).toEqual(allowedDecisions)
  })

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
      application_json: JSON.stringify({ policy_version: 'r2a-v1', status: 'linked', todo_id: 'todo-1' }),
    })
    db.close()

    const script = resolve('scripts/todo-resolver-eval.mjs')
    const exported = spawnSync(process.execPath, [script, 'export', dbPath, samplesPath], { encoding: 'utf8' })
    expect(exported.status, exported.stderr).toBe(0)
    const sample = JSON.parse(readFileSync(samplesPath, 'utf8').trim())
    expect(sample).toMatchObject({
      input_excerpt: '研发那份演示材料别忘了发出去',
      prediction: { decision: 'LINK', candidate_ids: ['todo-1'] },
      application: { policy_version: 'r2a-v1', status: 'linked', todo_id: 'todo-1' },
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
