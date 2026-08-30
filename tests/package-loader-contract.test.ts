import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as packageEntry from '../src/index.ts'
import YoloStorage from '../src/storage/index.ts'
import * as memoryPlugin from '../src/memory/index.ts'
import * as extractPlugin from '../src/extract/index.ts'
import * as reminderPlugin from '../src/reminder/index.ts'
import * as uiPlugin from '../src/ui/index.ts'
import { Config } from '../src/ui/config.ts'

const ROOT = resolve(import.meta.dirname, '..')

interface PackageManifest {
  main?: string
  exports?: Record<string, string>
  files?: string[]
  scripts?: Record<string, string>
  dsh?: {
    bundle?: { patch?: string }
    client?: { inject?: string[]; platform?: string }
  }
}

const manifest = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')) as PackageManifest

const HOST_EXPORTS = {
  './dist/src/storage': './dist/src/storage/index.mjs',
  './dist/src/memory': './dist/src/memory/index.mjs',
  './dist/src/extract': './dist/src/extract/index.mjs',
  './dist/src/reminder': './dist/src/reminder/index.mjs',
  './dist/src/ui': './dist/src/ui/index.mjs',
} as const

const HOST_ROWS = [
  { id: 'yolo-storage', name: 'dsh-plugin-yolo/dist/src/storage' },
  { id: 'yolo-memory', name: 'dsh-plugin-yolo/dist/src/memory' },
  { id: 'yolo-extract', name: 'dsh-plugin-yolo/dist/src/extract' },
  { id: 'yolo-reminder', name: 'dsh-plugin-yolo/dist/src/reminder' },
  { id: 'yolo-ui', name: 'dsh-plugin-yolo/dist/src/ui' },
] as const

function patchRows(text: string): Array<{ id: string; name: string }> {
  const rows: Array<{ id: string; name: string }> = []
  const pattern = /^\s*- id:\s*([^\s#]+)\s*\r?\n\s+name:\s*['"]?([^'"\s#]+)['"]?\s*$/gmu
  for (const match of text.matchAll(pattern)) rows.push({ id: match[1], name: match[2] })
  return rows
}

describe('package and Cordis loader contract', () => {
  it('keeps the package root, browser export and five host subpath exports stable', () => {
    expect(manifest.main).toBe('./dist/src/index.mjs')
    expect(manifest.exports?.['.']).toBe('./dist/src/index.mjs')
    expect(manifest.exports?.['./client']).toBe('./dist/client/index.mjs')
    expect(Object.fromEntries(Object.keys(HOST_EXPORTS).map((key) => [key, manifest.exports?.[key]])))
      .toEqual(HOST_EXPORTS)
  })

  it('keeps the bare client-discovery row followed by the five host plugin rows', () => {
    const rows = patchRows(readFileSync(resolve(ROOT, 'cordis.patch.yml'), 'utf8'))
    expect(rows).toEqual([
      { id: 'yolo', name: 'dsh-plugin-yolo' },
      ...HOST_ROWS,
    ])
    expect(manifest.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
    expect(manifest.dsh?.client).toEqual({
      inject: ['@deepseek-ai/dsh-client-runtime'],
      platform: 'web',
    })
  })

  it('exports storage as the Cordis-loadable default service class', () => {
    expect(typeof YoloStorage).toBe('function')
    expect(YoloStorage.name).toBe('Yolo')
    expect(typeof YoloStorage.prototype.resolve).toBe('function')
  })

  it.each([
    ['root', packageEntry, 'yolo', []],
    ['memory', memoryPlugin, 'yolo-memory', ['yolo', 'tools', 'systemPrompt', 'llm', 'settings']],
    ['extract', extractPlugin, 'yolo-extract', ['yolo', 'llm', 'sessions', 'settings']],
    ['reminder', reminderPlugin, 'yolo-reminder', ['yolo', 'agents', 'llm', 'settings']],
    ['ui', uiPlugin, 'yolo-ui', ['yolo', 'webServer', 'agents']],
  ] as const)('keeps the %s plugin name/inject/apply shape', (_label, plugin, name, inject) => {
    expect(plugin.name).toBe(name)
    expect(plugin.inject).toEqual(inject)
    expect(typeof plugin.apply).toBe('function')
  })
})

describe('settings and build-asset contract', () => {
  it('keeps the yolo settings namespace and complete loader defaults stable', () => {
    expect(uiPlugin.YOLO_NS).toBe('yolo')
    expect(Config(undefined)).toEqual({
      enabled: true,
      extraction: {
        enableLLM: true,
        model: 'deepseek-chat',
        minIntervalSec: 30,
        minTurnChars: 4,
        maxRunsPerDay: 300,
      },
      reminder: {
        enabled: true,
        checkIntervalSec: 30,
        aheadMin: 0,
        quietHoursEnabled: false,
        quietStart: '22:00',
        quietEnd: '08:00',
      },
      brief: {
        enabled: true,
        morningTime: '09:00',
        eveningTime: '21:00',
        model: 'deepseek-chat',
      },
      storage: { scope: 'workspace', snapshotInterval: 'daily' },
      recall: { maxTokens: 512, topK: 5 },
      semantic: {
        enabled: true,
        model: 'deepseek-chat',
        expansionsPerQuery: 3,
        rerankOn: true,
        maxRerankCandidates: 8,
        dailyBudget: 60,
        minQueryChars: 6,
        degradeAfterEmpty: 5,
      },
      ui: { aggregateAcrossWorkspaces: false, focusDefaultCount: 0 },
    })
  })

  it('keeps host/client entries and runtime assets in the build and package', () => {
    const hostBuild = readFileSync(resolve(ROOT, 'tsdown.config.ts'), 'utf8')
    const clientBuild = readFileSync(resolve(ROOT, 'tsdown.client.config.ts'), 'utf8')
    const assetCopy = readFileSync(resolve(ROOT, 'scripts/copy-assets.mjs'), 'utf8')
    const clientWrapper = readFileSync(resolve(ROOT, 'scripts/wrap-client.mjs'), 'utf8')

    for (const entry of [
      'src/index.ts',
      'src/storage/index.ts',
      'src/memory/index.ts',
      'src/extract/index.ts',
      'src/reminder/index.ts',
      'src/ui/index.ts',
    ]) expect(hostBuild).toContain(`'${entry}'`)
    expect(hostBuild).toContain("format: 'esm'")
    expect(hostBuild).toContain("outDir: 'dist/src'")

    expect(clientBuild).toContain("entry: ['client/index.ts']")
    expect(clientBuild).toContain("format: 'cjs'")
    expect(clientBuild).toContain("outDir: 'dist/client'")
    expect(clientWrapper).toContain('window.__ModuleLoader__.load')
    expect(clientWrapper).toContain("const ID = 'dsh-plugin-yolo'")

    expect(assetCopy).toContain("['src/storage/schema.sql', 'dist/src/storage/schema.sql']")
    expect(manifest.files).toEqual(expect.arrayContaining([
      'dist',
      'cordis.patch.yml',
      'src/storage/schema.sql',
    ]))
    expect(manifest.scripts?.build).toContain('scripts/wrap-client.mjs')
    expect(manifest.scripts?.build).toContain('scripts/copy-assets.mjs')
  })
})
