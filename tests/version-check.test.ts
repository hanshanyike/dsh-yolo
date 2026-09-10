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
  it('takes the highest version across every dist-tag, not just latest', () => {
    // The live shape of this package: the stable tag lags the rc tag.
    const tags = { latest: '0.4.0-rc5', beta: '0.5.0-beta.3', rc: '0.5.0-rc.1', alpha: '0.2.0-alpha.1' }
    expect(pickUpdate(tags, '0.4.0-rc5')).toEqual({ latest: '0.5.0-rc.1', tag: 'rc' })
  })

  it('reports nothing when the running version is the newest published', () => {
    expect(pickUpdate({ latest: '0.4.0-rc5', rc: '0.5.0-rc.1' }, '0.5.0-rc.1')).toBeUndefined()
  })

  it('prefers a release over the prerelease it supersedes', () => {
    expect(pickUpdate({ rc: '0.5.0-rc.1', latest: '0.5.0' }, '0.5.0-rc.1')).toEqual({ latest: '0.5.0', tag: 'latest' })
  })

  it('ignores malformed and empty tag tables instead of reporting them', () => {
    expect(pickUpdate({}, '0.5.0-rc.1')).toBeUndefined()
    expect(pickUpdate({ rc: 'not-a-version' }, '0.5.0-rc.1')).toBeUndefined()
    expect(pickUpdate({ rc: '0.9.0', junk: 'nonsense' }, '0.5.0-rc.1')).toEqual({ latest: '0.9.0', tag: 'rc' })
  })
})
