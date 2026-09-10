/**
 * Version-check projection: is a newer YOLO published on npm?
 *
 * Pure data in, pure data out — no network, no Cordis — so the semver
 * precedence rules and the "is this actually newer?" decision are unit
 * testable without a registry. `src/ui/version.ts` owns the wire read.
 *
 * The comparison is against the registry's `latest` dist-tag and nothing else:
 * npm owns which published version is current, and a prerelease line is only
 * "the current one" once it has been promoted to `latest`. Reading other tags
 * here would second-guess that promotion.
 */

/** One registry answer: dist-tag → version. */
export type VersionTags = Record<string, string>

/** A published version that outranks the installed one. */
export interface VersionUpdate {
  /** The version npm reports as `latest`. */
  latest: string
}

/** What the UI endpoint serves. */
export interface VersionCheckResult {
  /** The version this host is running. */
  current: string
  /** Present only when `latest` is a strictly newer version. */
  update?: VersionUpdate
  /** When the registry was last consulted successfully; absent while unknown. */
  checkedAt?: number
}

interface ParsedVersion {
  core: [number, number, number]
  /** Dot-separated prerelease identifiers; empty for a release version. */
  pre: string[]
}

const VERSION_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/u

/** Parse a semver string; undefined when it is not one (the registry is not trusted to be well-formed). */
export function parseVersion(value: string): ParsedVersion | undefined {
  const match = VERSION_PATTERN.exec(value.trim())
  if (match === null) return undefined
  const [, major, minor, patch, prerelease] = match
  return {
    core: [Number(major), Number(minor), Number(patch)],
    pre: prerelease === undefined || prerelease === '' ? [] : prerelease.split('.'),
  }
}

function comparePrerelease(left: string[], right: string[]): number {
  // SemVer 11.3–11.4: a version WITH a prerelease is LOWER than the same
  // version without one, so an empty prerelease list always wins.
  if (left.length === 0 && right.length === 0) return 0
  if (left.length === 0) return 1
  if (right.length === 0) return -1
  const shared = Math.min(left.length, right.length)
  for (let i = 0; i < shared; i += 1) {
    const a = left[i]!
    const b = right[i]!
    const aNumeric = /^\d+$/u.test(a)
    const bNumeric = /^\d+$/u.test(b)
    if (aNumeric && bNumeric) {
      const diff = Number(a) - Number(b)
      if (diff !== 0) return diff < 0 ? -1 : 1
      continue
    }
    // Numeric identifiers always have lower precedence than alphanumeric ones.
    if (aNumeric !== bNumeric) return aNumeric ? -1 : 1
    if (a !== b) return a < b ? -1 : 1
  }
  if (left.length === right.length) return 0
  return left.length < right.length ? -1 : 1
}

/**
 * Compare two semver strings by precedence; build metadata is ignored.
 * Unparseable inputs sort below every parseable one and compare equal to each
 * other, so a malformed tag can never be reported as an available update.
 * @returns negative when `left` precedes `right`, 0 when equal, positive when it follows.
 */
export function compareVersions(left: string, right: string): number {
  const a = parseVersion(left)
  const b = parseVersion(right)
  if (a === undefined && b === undefined) return 0
  if (a === undefined) return -1
  if (b === undefined) return 1
  for (let i = 0; i < 3; i += 1) {
    const diff = a.core[i]! - b.core[i]!
    if (diff !== 0) return diff < 0 ? -1 : 1
  }
  return comparePrerelease(a.pre, b.pre)
}

/** Whether `candidate` is a strictly newer version than `current`. */
export function isNewer(candidate: string, current: string): boolean {
  return compareVersions(candidate, current) > 0
}

/**
 * Read the registry's `latest` and report it when it outranks `current`.
 * @param tags - the registry's dist-tag table.
 * @param current - the running version.
 * @returns the newer version, or undefined when there is nothing newer.
 */
export function pickUpdate(tags: VersionTags, current: string): VersionUpdate | undefined {
  const latest = tags.latest
  if (typeof latest !== 'string' || parseVersion(latest) === undefined) return undefined
  return isNewer(latest, current) ? { latest } : undefined
}
