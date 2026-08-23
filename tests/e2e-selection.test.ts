import { describe, expect, it } from 'vitest'
import { resolveE2ESelection } from '../scripts/e2e-selection.mjs'

const ROOT = 'D:/repo'
const existing = new Set([
  'D:/repo/tests/e2e/api/dashboard-scope.spec.ts',
  'D:/repo/tests/e2e/ui/panel-flow.spec.ts',
])
const fileExists = (path: string): boolean => existing.has(path.replace(/\\/g, '/'))

describe('E2E CLI selection', () => {
  it('finds an unqualified UI spec in its suite directory', () => {
    expect(resolveE2ESelection({ spec: 'panel-flow', root: ROOT, fileExists }))
      .toEqual(['tests/e2e/ui/panel-flow.spec.ts'])
  })

  it('finds an unqualified API spec in its suite directory', () => {
    expect(resolveE2ESelection({ spec: 'dashboard-scope.spec.ts', root: ROOT, fileExists }))
      .toEqual(['tests/e2e/api/dashboard-scope.spec.ts'])
  })

  it('accepts suite-qualified and full repo-relative forms', () => {
    expect(resolveE2ESelection({ spec: 'ui/panel-flow', root: ROOT, fileExists }))
      .toEqual(['tests/e2e/ui/panel-flow.spec.ts'])
    expect(resolveE2ESelection({ spec: 'tests/e2e/api/dashboard-scope.spec.ts', root: ROOT, fileExists }))
      .toEqual(['tests/e2e/api/dashboard-scope.spec.ts'])
  })

  it('keeps suite-only selection and rejects missing specs', () => {
    expect(resolveE2ESelection({ suite: 'api', root: ROOT, fileExists }))
      .toEqual(['tests/e2e/api/'])
    expect(() => resolveE2ESelection({ spec: 'missing', root: ROOT, fileExists })).toThrow('unknown E2E spec')
  })
})
