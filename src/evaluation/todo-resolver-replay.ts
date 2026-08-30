import type { LlmRuntime } from '@deepseek-ai/dsh-llm'
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import type { TodoIdentityCandidate } from '../domain/types.ts'
import {
  llmResolveTodoIdentity,
  TODO_RESOLVER_VERSION,
  type TodoResolverObservation,
} from '../extract/todo-resolver.ts'

export const TODO_RESOLVER_REPLAY_FLAG = 'YOLO_TODO_RESOLVER_REPLAY'
export const TODO_RESOLVER_REPLAY_INPUT = 'YOLO_TODO_RESOLVER_REPLAY_INPUT'
export const TODO_RESOLVER_REPLAY_OUTPUT = 'YOLO_TODO_RESOLVER_REPLAY_OUTPUT'
export const TODO_RESOLVER_REPLAY_STATUS = 'YOLO_TODO_RESOLVER_REPLAY_STATUS'
export const TODO_RESOLVER_REPLAY_AS_OF = 'YOLO_TODO_RESOLVER_REPLAY_AS_OF'
export const TODO_RESOLVER_GOLD_AS_OF = '2026-08-30T09:00:00+08:00'

interface ReplayRow {
  sample_id: string
  input_excerpt: string
  candidates: TodoIdentityCandidate[]
  prediction?: unknown
  provenance?: Record<string, unknown>
  [key: string]: unknown
}

export interface TodoResolverReplaySummary {
  samples: number
  predicted: number
  errors: number
  provider: string
  model: string
  resolver_version: string
  as_of: string
  output: string
}

function parseRows(path: string): ReplayRow[] {
  return readFileSync(path, 'utf8').split(/\r?\n/u).filter(Boolean).map((line, index) => {
    let value: unknown
    try {
      value = JSON.parse(line)
    } catch {
      throw new Error(`invalid replay JSONL at line ${index + 1}`)
    }
    if (!value || typeof value !== 'object') throw new Error(`replay row ${index + 1} must be an object`)
    const row = value as Partial<ReplayRow>
    if (typeof row.sample_id !== 'string' || !row.sample_id.trim()) {
      throw new Error(`replay row ${index + 1} has no sample_id`)
    }
    if (typeof row.input_excerpt !== 'string' || !row.input_excerpt.trim()) {
      throw new Error(`replay row ${index + 1} has no input_excerpt`)
    }
    if (!Array.isArray(row.candidates) || row.candidates.length > 20) {
      throw new Error(`replay row ${index + 1} has invalid candidates`)
    }
    const candidateIds = new Set<string>()
    for (const candidate of row.candidates) {
      if (!candidate || typeof candidate !== 'object' || typeof candidate.id !== 'string' || !candidate.id) {
        throw new Error(`replay row ${index + 1} has an invalid candidate`)
      }
      if (candidateIds.has(candidate.id)) throw new Error(`replay row ${index + 1} repeats candidate ${candidate.id}`)
      candidateIds.add(candidate.id)
    }
    return value as ReplayRow
  })
}

function atomicWrite(path: string, content: string): void {
  const temp = resolve(dirname(path), `.${Date.now()}-${process.pid}-${Math.random().toString(16).slice(2)}.tmp`)
  writeFileSync(temp, content, { encoding: 'utf8', flag: 'wx' })
  try {
    renameSync(temp, path)
  } catch (error) {
    rmSync(temp, { force: true })
    throw error
  }
}

/** Replay a labeled corpus through the exact resolver used by the host.
 *
 * Input is immutable: output must be a new path, and an existing output is
 * rejected rather than silently overwritten. Raw provider text and credentials
 * are never persisted; only parsed predictions and bounded routing metadata are
 * added to the generated copy. */
export async function runTodoResolverReplay(options: {
  llm: LlmRuntime
  provider: string
  model: string
  inputFile: string
  outputFile: string
  asOf?: Date
  signal?: AbortSignal
  onProgress?: (completed: number, total: number, sampleId: string) => void
}): Promise<TodoResolverReplaySummary> {
  const input = resolve(options.inputFile)
  const output = resolve(options.outputFile)
  if (input === output) throw new Error('replay output must not overwrite the input corpus')
  if (!existsSync(input)) throw new Error(`replay input not found: ${input}`)
  if (existsSync(output)) throw new Error(`replay output already exists: ${output}`)
  const asOf = options.asOf ?? new Date(TODO_RESOLVER_GOLD_AS_OF)
  if (Number.isNaN(asOf.getTime())) throw new Error('replay as-of datetime is invalid')
  const rows = parseRows(input)
  const generated: ReplayRow[] = []
  let predicted = 0
  let errors = 0

  for (const [index, row] of rows.entries()) {
    if (options.signal?.aborted) throw options.signal.reason ?? new Error('todo resolver replay aborted')
    let observation: TodoResolverObservation | undefined
    let prediction: unknown = null
    let predictionError: string | null = null
    try {
      const resolutions = await llmResolveTodoIdentity({
        llm: options.llm,
        provider: options.provider,
        model: options.model,
        turnText: row.input_excerpt,
        candidates: row.candidates,
        now: asOf,
        signal: options.signal,
        observe: (value) => { observation = value },
      })
      if (resolutions.length !== 1) {
        predictionError = `expected one resolution, received ${resolutions.length}`
        errors++
      } else {
        prediction = resolutions[0]
        predicted++
      }
    } catch (error) {
      predictionError = error instanceof Error ? error.message : String(error)
      errors++
    }
    generated.push({
      ...row,
      prediction,
      ...(predictionError ? { prediction_error: predictionError.slice(0, 500) } : {}),
      provenance: {
        ...(row.provenance && typeof row.provenance === 'object' ? row.provenance : {}),
        replay: {
          resolver_version: TODO_RESOLVER_VERSION,
          model_provider: options.provider,
          model_name: options.model,
          as_of: asOf.toISOString(),
          finish_kind: observation?.finish.kind ?? null,
          usage: observation?.usage ?? null,
        },
      },
    })
    options.onProgress?.(index + 1, rows.length, row.sample_id)
  }

  atomicWrite(output, `${generated.map((row) => JSON.stringify(row)).join('\n')}\n`)
  return {
    samples: rows.length,
    predicted,
    errors,
    provider: options.provider,
    model: options.model,
    resolver_version: TODO_RESOLVER_VERSION,
    as_of: asOf.toISOString(),
    output,
  }
}

export function writeTodoResolverReplayStatus(path: string, value: Record<string, unknown>): void {
  const target = resolve(path)
  if (existsSync(target)) throw new Error(`replay status already exists: ${target}`)
  atomicWrite(target, `${JSON.stringify(value, null, 2)}\n`)
}
