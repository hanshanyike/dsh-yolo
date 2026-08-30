import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const LINKING = new Set(['LINK', 'UPDATE', 'REOPEN', 'NEW_OCCURRENCE', 'ATTACH_STEP'])

function usage(exitCode = 1) {
  console.error('Usage:')
  console.error('  node scripts/todo-resolver-eval.mjs export <yolo.db> <samples.jsonl>')
  console.error('  node scripts/todo-resolver-eval.mjs evaluate <labeled-samples.jsonl>')
  process.exitCode = exitCode
}

function parseJson(value, fallback) {
  try { return JSON.parse(value) } catch { return fallback }
}

function exportSamples(dbFile, outputFile) {
  const dbPath = resolve(dbFile)
  if (!existsSync(dbPath)) throw new Error(`database not found: ${dbPath}`)
  const db = new DatabaseSync(dbPath, { readOnly: true })
  try {
    const resolutionColumns = new Set(db.prepare('PRAGMA table_info(todo_resolution_log)').all().map((row) => row.name))
    const applicationColumn = resolutionColumns.has('application_json') ? 'application_json' : 'NULL AS application_json'
    const rows = db.prepare(
      `SELECT id,scope_key,session_id,turn_seq,input_fingerprint,input_excerpt,
              resolver_version,model_provider,model_name,status,error,
              candidates_json,resolutions_json,${applicationColumn},created_at
       FROM todo_resolution_log ORDER BY created_at ASC,id ASC`,
    ).all()
    const samples = []
    for (const row of rows) {
      const candidates = parseJson(row.candidates_json, [])
      const predictions = parseJson(row.resolutions_json, [])
      const items = predictions.length ? predictions : [null]
      items.forEach((prediction, index) => samples.push({
        sample_id: `${row.id}/${index}`,
        stratum: null,
        input_excerpt: row.input_excerpt,
        candidates,
        prediction,
        application: parseJson(row.application_json, null),
        expected: null,
        provenance: {
          scope_key: row.scope_key,
          session_id: row.session_id,
          turn_seq: row.turn_seq,
          input_fingerprint: row.input_fingerprint,
          resolver_version: row.resolver_version,
          model_provider: row.model_provider,
          model_name: row.model_name,
          status: row.status,
          error: row.error,
          created_at: row.created_at,
        },
      }))
    }
    const outputPath = resolve(outputFile)
    writeFileSync(outputPath, `${samples.map((sample) => JSON.stringify(sample)).join('\n')}\n`, 'utf8')
    console.log(JSON.stringify({ exported: samples.length, output: outputPath }))
  } finally {
    db.close()
  }
}

function idSet(value) {
  return new Set(Array.isArray(value?.candidate_ids) ? value.candidate_ids.filter((id) => typeof id === 'string') : [])
}

function sameIds(a, b) {
  if (a.size !== b.size) return false
  return [...a].every((id) => b.has(id))
}

function emptyStats() {
  return { labeled: 0, exact: 0, decision_correct: 0, target_correct: 0, false_link: 0, missed_link: 0 }
}

function addSample(stats, sample) {
  const expected = sample.expected
  const predicted = sample.prediction
  stats.labeled++
  const expectedIds = idSet(expected)
  const predictedIds = idSet(predicted)
  const decisionCorrect = predicted?.decision === expected.decision
  const targetCorrect = sameIds(predictedIds, expectedIds)
  if (decisionCorrect) stats.decision_correct++
  if (targetCorrect) stats.target_correct++
  if (decisionCorrect && targetCorrect) stats.exact++
  const expectedLink = LINKING.has(expected.decision)
  const predictedLink = LINKING.has(predicted?.decision)
  if (predictedLink && (!expectedLink || !targetCorrect)) stats.false_link++
  if (expectedLink && (!predictedLink || !targetCorrect)) stats.missed_link++
}

function ratios(stats) {
  const denominator = stats.labeled || 1
  return {
    ...stats,
    exact_rate: stats.exact / denominator,
    false_link_rate: stats.false_link / denominator,
    missed_link_rate: stats.missed_link / denominator,
  }
}

function evaluate(file) {
  const path = resolve(file)
  const rows = readFileSync(path, 'utf8').split(/\r?\n/u).filter(Boolean).map((line, index) => {
    try { return JSON.parse(line) } catch { throw new Error(`invalid JSONL at line ${index + 1}`) }
  })
  const overall = emptyStats()
  const byStratum = new Map()
  let unlabeled = 0
  let unpredicted = 0
  for (const row of rows) {
    if (!row.expected || typeof row.expected.decision !== 'string') {
      unlabeled++
      continue
    }
    if (!row.prediction || typeof row.prediction.decision !== 'string') {
      unpredicted++
      continue
    }
    const stratum = typeof row.stratum === 'string' && row.stratum ? row.stratum : 'unstratified'
    const bucket = byStratum.get(stratum) ?? emptyStats()
    byStratum.set(stratum, bucket)
    addSample(overall, row)
    addSample(bucket, row)
  }
  const report = {
    file: path,
    samples: rows.length,
    unlabeled,
    unpredicted,
    overall: ratios(overall),
    by_stratum: Object.fromEntries([...byStratum].map(([name, stats]) => [name, ratios(stats)])),
  }
  console.log(JSON.stringify(report, null, 2))
  if (overall.labeled === 0) process.exitCode = 2
}

const [mode, first, second] = process.argv.slice(2)
try {
  if (mode === 'export' && first && second) exportSamples(first, second)
  else if (mode === 'evaluate' && first) evaluate(first)
  else usage()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
