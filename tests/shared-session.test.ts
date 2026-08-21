// Session-header access tests — regression guard for the M8 scope bug: the
// plugins used to read a non-existent `session.meta.cwd`, silently scoping all
// workspace memory to the harness root via process.cwd() fallback.

import { describe, it, expect } from 'vitest'
import { sessionCwd, sessionId } from '../src/shared/session.ts'

describe('sessionCwd / sessionId', () => {
  it('reads the workspace cwd from a Session-shaped header', () => {
    const session = { id: 's1', header: { id: 's1', cwd: 'D:\\ws\\proj' } }
    expect(sessionCwd(session)).toBe('D:\\ws\\proj')
    expect(sessionId(session)).toBe('s1')
  })

  it('returns undefined when the header has no cwd (session without workspace)', () => {
    const session = { id: 's2', header: { id: 's2' } }
    expect(sessionCwd(session)).toBeUndefined()
    expect(sessionId(session)).toBe('s2')
  })

  it('ignores the legacy meta shape that never existed on the class', () => {
    // the OLD broken read: `session.meta?.cwd` — must not resurrect as a fallback
    const legacy = { id: 's3', meta: { cwd: '/wrong/scope' } }
    expect(sessionCwd(legacy)).toBeUndefined()
    expect(sessionId(legacy)).toBeUndefined()
  })

  it('tolerates null/undefined/primitive payloads', () => {
    expect(sessionCwd(undefined)).toBeUndefined()
    expect(sessionCwd(null)).toBeUndefined()
    expect(sessionCwd('session')).toBeUndefined()
    expect(sessionCwd(42)).toBeUndefined()
    expect(sessionId(undefined)).toBeUndefined()
    expect(sessionId({})).toBeUndefined()
  })
})
