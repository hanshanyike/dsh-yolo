import { existsSync } from 'node:fs'
import { join } from 'node:path'

function normalizeSpec(spec) {
  return spec
    .replace(/\\/g, '/')
    .replace(/^tests\/e2e\//, '')
    .replace(/\.spec\.ts$/, '')
    .replace(/^\/+|\/+$/g, '')
}

/** Resolve CLI suite/spec inputs to Playwright's repo-relative path filters. */
export function resolveE2ESelection({ spec, suite = '', root, fileExists = existsSync }) {
  const normalizedSuite = suite.toLowerCase()
  if (normalizedSuite && normalizedSuite !== 'api' && normalizedSuite !== 'ui') {
    throw new Error(`unknown suite "${suite}" (use api | ui | all)`)
  }

  if (!spec) return normalizedSuite ? [`tests/e2e/${normalizedSuite}/`] : []

  const normalized = normalizeSpec(spec)
  const qualified = normalized.startsWith('api/') || normalized.startsWith('ui/')
  const candidates = qualified
    ? [`tests/e2e/${normalized}.spec.ts`]
    : normalizedSuite
      ? [`tests/e2e/${normalizedSuite}/${normalized}.spec.ts`]
      : [`tests/e2e/api/${normalized}.spec.ts`, `tests/e2e/ui/${normalized}.spec.ts`]
  const matches = candidates.filter((path) => fileExists(join(root, path)))

  if (matches.length === 0) {
    throw new Error(`unknown E2E spec "${spec}" (searched ${candidates.join(', ')})`)
  }
  return matches
}
