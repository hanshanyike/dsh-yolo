import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  auditDependencyFitness,
  fitnessKey,
  violatedRule,
  type LegacyDependencyException,
} from './architecture/dependency-fitness.ts'

const ROOT = resolve(import.meta.dirname, '..')

// Phase 0 freezes only the imports that existed when the rule was introduced.
// Migration tightens the architecture by deleting entries; adding entries is
// an explicit architecture regression and must not be used as routine relief.
const LEGACY_ALLOWLIST: readonly LegacyDependencyException[] = [
  { rule: 'host-features-must-not-depend-on-ui-session', source: 'src/extract/index.ts', target: 'src/ui/session.ts' },
  { rule: 'host-features-must-not-depend-on-ui-session', source: 'src/memory/index.ts', target: 'src/ui/session.ts' },
  { rule: 'host-features-must-not-depend-on-ui-session', source: 'src/reminder/index.ts', target: 'src/ui/session.ts' },
]

describe('architecture dependency fitness', () => {
  it('has no new boundary violations and no stale legacy exceptions', () => {
    const result = auditDependencyFitness(ROOT, LEGACY_ALLOWLIST)
    expect(result.unexpected, 'new dependency violations must be migrated, not allowlisted').toEqual([])
    expect(result.staleAllowlist, 'delete allowlist entries immediately after migration').toEqual([])
  })

  it('keeps every exception unique and reviewable', () => {
    const keys = LEGACY_ALLOWLIST.map(fitnessKey)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('expresses the target rules independently of the current tree', () => {
    expect(violatedRule({ source: 'src/shared/new.ts', target: 'src/ui/new.ts', specifier: '../ui/new.ts' }))
      .toBe('shared-must-not-depend-on-ui')
    expect(violatedRule({ source: 'src/extract/new.ts', target: 'src/ui/session.ts', specifier: '../ui/session.ts' }))
      .toBe('host-features-must-not-depend-on-ui-session')
    expect(violatedRule({ source: 'client/new.ts', target: 'src/storage/types.ts', specifier: '../src/storage/types.ts' }))
      .toBe('client-must-use-contracts')
    expect(violatedRule({ source: 'client/new.ts', target: 'src/contracts/actions.ts', specifier: '../src/contracts/actions.ts' }))
      .toBeUndefined()
  })
})
