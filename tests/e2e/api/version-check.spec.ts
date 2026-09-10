import { readFileSync } from 'node:fs'
import { test, expect } from '@playwright/test'
import { compareVersions } from '../../../src/application/read-models/version-check.ts'
import { connectApi, type Api } from '../helpers.ts'

const packageVersion = (JSON.parse(
  readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'),
) as { version: string }).version

let api: Api

test.beforeAll(async () => { api = await connectApi() })
test.afterAll(async () => { await api.close() })

test('VC-01: 版本检测端点回答宿主自己的结论，且不等待网络', async () => {
  const started = Date.now()
  const response = await api.req.get('/yolo/version')
  const elapsed = Date.now() - started
  expect(response.status()).toBe(200)

  const body = await response.json() as { current?: unknown; update?: unknown; checkedAt?: unknown }
  expect(body.current).toBe(packageVersion)

  // An update is optional — it depends on what npm currently publishes as
  // `latest` — but when one is reported it must be a strictly newer version.
  if (body.update !== undefined) {
    const update = body.update as { latest?: unknown }
    expect(typeof update.latest).toBe('string')
    expect(compareVersions(update.latest as string, packageVersion)).toBeGreaterThan(0)
    expect(body.checkedAt).toEqual(expect.any(Number))
  }

  // The endpoint serves a cached answer: it may trigger a refresh, but it must
  // never make the caller wait for the registry.
  expect(elapsed).toBeLessThan(2_000)
})
