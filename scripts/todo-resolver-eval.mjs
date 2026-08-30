import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const LINKING = new Set(['LINK', 'UPDATE', 'REOPEN', 'NEW_OCCURRENCE', 'ATTACH_STEP'])
const R2A_DECISIONS = new Set(['LINK', 'UPDATE'])
const OPEN_STATUSES = new Set(['pending', 'in_progress'])
const REQUIRED_STRATA = ['paraphrase', 'pronoun', 'ellipsis', 'cross_session', 'same_name_distinct', 'terminal', 'step']
const GATE = Object.freeze({
  minimumSamplesPerStratum: 6,
  minimumExactRate: 0.8,
  maximumMissedLinkRate: 0.15,
  minimumSafeCoverage: 0.5,
  minimumConfidence: 0.98,
})

function usage(exitCode = 1) {
  console.error('Usage:')
  console.error('  node scripts/todo-resolver-eval.mjs export <yolo.db> <samples.jsonl>')
  console.error('  node scripts/todo-resolver-eval.mjs evaluate <labeled-samples.jsonl> [report.json]')
  console.error('  node scripts/todo-resolver-eval.mjs gate <labeled-samples.jsonl> [report.json]')
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

function confidenceBucket(prediction) {
  const confidence = prediction?.confidence
  if (typeof confidence !== 'number' || !Number.isFinite(confidence)) return 'missing'
  if (confidence >= 0.98) return '0.98-1.00'
  if (confidence >= 0.95) return '0.95-0.979'
  if (confidence >= 0.8) return '0.80-0.949'
  return '0.00-0.799'
}

function candidateStatus(row, id) {
  return Array.isArray(row.candidates) ? row.candidates.find((candidate) => candidate?.id === id)?.status : undefined
}

function isSafeExpected(row) {
  const ids = [...idSet(row.expected)]
  return R2A_DECISIONS.has(row.expected?.decision)
    && ids.length === 1
    && OPEN_STATUSES.has(candidateStatus(row, ids[0]))
}

function isAutoEligible(row) {
  const ids = [...idSet(row.prediction)]
  return R2A_DECISIONS.has(row.prediction?.decision)
    && typeof row.prediction?.confidence === 'number'
    && row.prediction.confidence >= GATE.minimumConfidence
    && ids.length === 1
    && OPEN_STATUSES.has(candidateStatus(row, ids[0]))
}

function autoAuthorization(rows) {
  const stats = { safe_expected: 0, eligible: 0, correct: 0, unsafe: 0, false_link: 0 }
  for (const row of rows) {
    if (!row.expected || typeof row.expected.decision !== 'string') continue
    if (isSafeExpected(row)) stats.safe_expected++
    if (!isAutoEligible(row)) continue
    stats.eligible++
    const exact = row.prediction.decision === row.expected.decision
      && sameIds(idSet(row.prediction), idSet(row.expected))
    if (exact) stats.correct++
    else {
      stats.unsafe++
      if (!isSafeExpected(row) || !sameIds(idSet(row.prediction), idSet(row.expected))) stats.false_link++
    }
  }
  return {
    ...stats,
    safe_coverage: stats.safe_expected ? stats.correct / stats.safe_expected : 0,
  }
}

function modelRoutes(rows) {
  const routes = new Set()
  for (const row of rows) {
    const replay = row.provenance?.replay
    if (replay?.model_provider && replay?.model_name && replay?.resolver_version) {
      routes.add(`${replay.model_provider}/${replay.model_name}@${replay.resolver_version}`)
    } else if (row.provenance?.model_provider && row.provenance?.model_name && row.provenance?.resolver_version) {
      routes.add(`${row.provenance.model_provider}/${row.provenance.model_name}@${row.provenance.resolver_version}`)
    }
  }
  return [...routes].sort()
}

function gateReport(report, rows) {
  const authorization = autoAuthorization(rows)
  const checks = {
    predictions_complete: report.unlabeled === 0 && report.unpredicted === 0 && report.overall.labeled === report.samples,
    one_model_route: report.model_routes.length === 1,
    strata_complete: REQUIRED_STRATA.every((stratum) => (report.by_stratum[stratum]?.labeled ?? 0) >= GATE.minimumSamplesPerStratum),
    false_link_zero: authorization.false_link === 0,
    exact_rate: report.overall.exact_rate >= GATE.minimumExactRate,
    missed_link_rate: report.overall.missed_link_rate <= GATE.maximumMissedLinkRate,
    unsafe_auto_zero: authorization.unsafe === 0,
    safe_coverage: authorization.safe_coverage >= GATE.minimumSafeCoverage,
  }
  return {
    passed: Object.values(checks).every(Boolean),
    checks,
    thresholds: {
      minimum_samples_per_stratum: GATE.minimumSamplesPerStratum,
      minimum_exact_rate: GATE.minimumExactRate,
      maximum_missed_link_rate: GATE.maximumMissedLinkRate,
      minimum_safe_coverage: GATE.minimumSafeCoverage,
      minimum_confidence: GATE.minimumConfidence,
    },
    auto_authorization: authorization,
    note: 'This engineering gate supports a default-off experimental toggle but does not authorize default-on behavior. Expand the labeled set from sanitized shadow logs after accuracy feedback or material model, prompt, threshold, or policy changes.',
  }
}

function evaluate(file, reportFile, requireGate = false) {
  const path = resolve(file)
  const rows = readFileSync(path, 'utf8').split(/\r?\n/u).filter(Boolean).map((line, index) => {
    try { return JSON.parse(line) } catch { throw new Error(`invalid JSONL at line ${index + 1}`) }
  })
  const overall = emptyStats()
  const byStratum = new Map()
  const byConfidence = new Map()
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
    const confidence = confidenceBucket(row.prediction)
    const confidenceStats = byConfidence.get(confidence) ?? emptyStats()
    byConfidence.set(confidence, confidenceStats)
    addSample(overall, row)
    addSample(bucket, row)
    addSample(confidenceStats, row)
  }
  const report = {
    file: path,
    samples: rows.length,
    unlabeled,
    unpredicted,
    overall: ratios(overall),
    by_stratum: Object.fromEntries([...byStratum].map(([name, stats]) => [name, ratios(stats)])),
    by_confidence: Object.fromEntries([...byConfidence].map(([name, stats]) => [name, ratios(stats)])),
    model_routes: modelRoutes(rows),
  }
  report.gate = gateReport(report, rows)
  const output = `${JSON.stringify(report, null, 2)}\n`
  console.log(output.trimEnd())
  if (reportFile) writeFileSync(resolve(reportFile), output, 'utf8')
  if (overall.labeled === 0) process.exitCode = 2
  else if (requireGate && !report.gate.passed) process.exitCode = 2
}

const [mode, first, second] = process.argv.slice(2)
try {
  if (mode === 'export' && first && second) exportSamples(first, second)
  else if (mode === 'evaluate' && first) evaluate(first, second)
  else if (mode === 'gate' && first) evaluate(first, second, true)
  else usage()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
