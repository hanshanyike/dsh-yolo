import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { LlmRuntime, StreamChunk } from '@deepseek-ai/dsh-llm'
import {
  runTodoResolverReplay,
  TODO_RESOLVER_GOLD_AS_OF,
} from '../src/evaluation/todo-resolver-replay.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
  roots.length = 0
})

function chunkStream(text: string): AsyncIterable<StreamChunk> {
  return (async function* () {
    yield { type: 'block-start', index: 0, blockType: 'text' } as StreamChunk
    yield { type: 'text-delta', index: 0, text } as StreamChunk
    yield { type: 'block-end', index: 0, block: { type: 'text', text } } as StreamChunk
  })()
}

describe('todo resolver configured-host replay', () => {
  it('writes predictions to a new corpus without modifying gold or persisting raw model text', async () => {
    const root = mkdtempSync(join(tmpdir(), 'yolo-resolver-replay-test-'))
    roots.push(root)
    const input = join(root, 'gold.jsonl')
    const output = join(root, 'predictions.jsonl')
    const row = {
      sample_id: 'natural-link',
      stratum: 'paraphrase',
      input_excerpt: '研发评审要用的最终版演示材料，记得发过去',
      candidates: [{
        id: 'todo-deck', title: '把演示稿发给研发', status: 'pending', due_at: null, aliases: [], rank: 0,
      }],
      prediction: null,
      expected: { decision: 'LINK', candidate_ids: ['todo-deck'] },
      provenance: { kind: 'handcrafted_shadow_style' },
    }
    const original = `${JSON.stringify(row)}\n`
    writeFileSync(input, original, 'utf8')
    const rawProviderText = JSON.stringify({ resolutions: [{
      decision: 'LINK', candidate_ids: ['todo-deck'], proposed_title: null, confidence: 0.99,
      reason: '同一份演示材料和接收方',
    }] })
    const llm = { stream: () => chunkStream(rawProviderText) } as unknown as LlmRuntime

    const progress: string[] = []
    const summary = await runTodoResolverReplay({
      llm, provider: 'configured-provider', model: 'configured-model', inputFile: input, outputFile: output,
      asOf: new Date(TODO_RESOLVER_GOLD_AS_OF),
      onProgress: (_completed, _total, sampleId) => progress.push(sampleId),
    })

    expect(summary).toMatchObject({ samples: 1, predicted: 1, errors: 0, provider: 'configured-provider', model: 'configured-model' })
    expect(progress).toEqual(['natural-link'])
    expect(readFileSync(input, 'utf8')).toBe(original)
    const generated = JSON.parse(readFileSync(output, 'utf8'))
    expect(generated).toMatchObject({
      prediction: { decision: 'LINK', candidate_ids: ['todo-deck'], confidence: 0.99 },
      provenance: { replay: {
        resolver_version: 'shadow-v2', model_provider: 'configured-provider', model_name: 'configured-model',
      } },
    })
    expect(generated.raw_text).toBeUndefined()
    expect(generated.provenance.replay.raw_text).toBeUndefined()
    await expect(runTodoResolverReplay({
      llm, provider: 'configured-provider', model: 'configured-model', inputFile: input, outputFile: output,
    })).rejects.toThrow('output already exists')
  })

  it('records a bounded per-sample error and still completes the generated corpus', async () => {
    const root = mkdtempSync(join(tmpdir(), 'yolo-resolver-replay-test-'))
    roots.push(root)
    const input = join(root, 'gold.jsonl')
    const output = join(root, 'predictions.jsonl')
    writeFileSync(input, `${JSON.stringify({
      sample_id: 'ambiguous', input_excerpt: '就按之前那个来',
      candidates: [{ id: 'todo-a', title: '发送方案', status: 'pending', aliases: [], rank: 0 }],
      prediction: null, expected: { decision: 'ASK', candidate_ids: ['todo-a'] },
    })}\n`, 'utf8')
    const llm = { stream: () => chunkStream('{"resolutions":[]}') } as unknown as LlmRuntime
    const summary = await runTodoResolverReplay({
      llm, provider: 'p', model: 'm', inputFile: input, outputFile: output,
    })
    expect(summary).toMatchObject({ samples: 1, predicted: 0, errors: 1 })
    expect(JSON.parse(readFileSync(output, 'utf8'))).toMatchObject({
      prediction: null,
      prediction_error: 'expected one resolution, received 0',
    })
  })
})
