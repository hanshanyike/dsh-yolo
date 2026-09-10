import { describe, expect, it } from 'vitest'
import {
  compareVersions,
  isNewer,
  parseVersion,
  pickUpdate,
} from '../src/application/read-models/version-check.ts'

describe('semver precedence', () => {
  it('orders core versions numerically, not lexically', () => {
    expect(compareVersions('0.5.0', '0.10.0')).toBeLessThan(0)
    expect(compareVersions('1.0.0', '1.0.1')).toBeLessThan(0)
    expect(compareVersions('2.0.0', '1.99.99')).toBeGreaterThan(0)
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0)
  })

  it('ranks a prerelease below the release it precedes', () => {
    expect(compareVersions('0.5.0-rc.1', '0.5.0')).toBeLessThan(0)
    expect(compareVersions('0.5.0-alpha.1', '0.5.0-beta.1')).toBeLessThan(0)
    expect(compareVersions('0.5.0-beta.3', '0.5.0-rc.1')).toBeLessThan(0)
    expect(compareVersions('0.5.0-rc.1', '0.5.0-rc.2')).toBeLessThan(0)
    // Numeric identifiers compare numerically and rank below alphanumeric ones.
    expect(compareVersions('0.5.0-rc.2', '0.5.0-rc.10')).toBeLessThan(0)
    expect(compareVersions('0.5.0-1', '0.5.0-alpha')).toBeLessThan(0)
    // A longer prerelease wins when every shared identifier is equal.
    expect(compareVersions('0.5.0-rc.1', '0.5.0-rc.1.1')).toBeLessThan(0)
  })

  it('ignores a leading v and build metadata', () => {
    expect(compareVersions('v0.5.0', '0.5.0')).toBe(0)
    expect(compareVersions('0.5.0+build.7', '0.5.0+build.9')).toBe(0)
  })

  it('refuses to treat an unparseable version as newer', () => {
    expect(parseVersion('latest')).toBeUndefined()
    expect(parseVersion('0.5')).toBeUndefined()
    expect(compareVersions('not-a-version', '0.5.0')).toBeLessThan(0)
    expect(isNewer('not-a-version', '0.5.0')).toBe(false)
  })
})

describe('pickUpdate', () => {
  it('reports the registry latest when it outranks the running version', () => {
    expect(pickUpdate({ latest: '0.5.0-rc.2', rc: '0.5.0-rc.2' }, '0.5.0-rc.1')).toEqual({ latest: '0.5.0-rc.2' })
    expect(pickUpdate({ latest: '0.6.0' }, '0.5.0')).toEqual({ latest: '0.6.0' })
  })

  it('reports nothing when the running version is the registry latest', () => {
    expect(pickUpdate({ latest: '0.5.0-rc.1', rc: '0.5.0-rc.1' }, '0.5.0-rc.1')).toBeUndefined()
  })

  // npm owns which published version is current: a prerelease line only counts
  // as the current one once it has been promoted to `latest`.
  it('ignores every other dist-tag, including one that outranks latest', () => {
    expect(pickUpdate({ latest: '0.4.0-rc5', rc: '0.5.0-rc.1', beta: '0.5.0-beta.3' }, '0.4.0-rc5')).toBeUndefined()
    expect(pickUpdate({ rc: '0.9.0' }, '0.5.0-rc.1')).toBeUndefined()
    expect(pickUpdate({}, '0.5.0-rc.1')).toBeUndefined()
  })

  it('refuses a malformed latest instead of reporting it', () => {
    expect(pickUpdate({ latest: 'not-a-version' }, '0.5.0-rc.1')).toBeUndefined()
    expect(pickUpdate({ latest: '0.5' }, '0.5.0-rc.1')).toBeUndefined()
  })
})
