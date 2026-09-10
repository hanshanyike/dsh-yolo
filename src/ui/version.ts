/**
 * Version-check HTTP adapter.
 *
 * The plugin's settings card shows a notice when a newer YOLO is published, and
 * this is where the answer comes from: the browser never talks to npm directly,
 * so the host does one small registry read (the package's dist-tag table),
 * caches it, and serves the cached answer at `GET /yolo/version`.
 *
 * The read is advisory in every direction: it never blocks a response and never
 * surfaces an error to the UI.
 */
import type { VersionCheckResult, VersionTags } from '../application/read-models/version-check.ts'
import { pickUpdate } from '../application/read-models/version-check.ts'
import type { WebServerLike } from './dashboard.ts'

/** The published package this deployment compares itself against. */
export const YOLO_PACKAGE_NAME = 'dsh-plugin-yolo'

/** The registry's dist-tag table — a few hundred bytes, not the full manifest. */
export const DIST_TAGS_URL = `https://registry.npmjs.org/-/package/${YOLO_PACKAGE_NAME}/dist-tags`

/** Hard bound on the registry read; a slow network must not pile up requests. */
const FETCH_TIMEOUT_MS = 5_000

/** How long a registry answer is reused. Fixed: this is not a user setting. */
const CACHE_TTL_MS = 12 * 60 * 60 * 1000

/** A registry read: dist-tags in, nothing else. Injectable so tests own the wire. */
export type FetchVersionTags = (signal: AbortSignal) => Promise<VersionTags>

export interface VersionEndpointOptions {
  /** The version this host is running. */
  current: string
  /** Test seam for the registry read. */
  fetchTags?: FetchVersionTags
  /** Test seam for the clock. */
  now?: () => number
  logger?: { warn?(format: string, ...args: unknown[]): void }
}

/** The endpoint's read side, exposed so a caller (and tests) can force a refresh. */
export interface VersionEndpointHandle {
  /** Consult the registry once and await it; concurrent calls share one read. */
  refresh(): Promise<void>
  /** The answer the endpoint currently serves. */
  snapshot(): VersionCheckResult
}

async function defaultFetchTags(signal: AbortSignal): Promise<VersionTags> {
  const response = await fetch(DIST_TAGS_URL, { signal, headers: { accept: 'application/json' } })
  if (!response.ok) throw new Error(`registry answered ${response.status}`)
  const body: unknown = await response.json()
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new Error('registry answered a non-object')
  return body as VersionTags
}

/**
 * Mount `GET /yolo/version` and warm the cache once.
 *
 * Responses are always served from the cache: a settings card that opens must
 * never wait on the network. A stale cache triggers a background refresh, and
 * the host warms it at startup so the answer is normally already there.
 * @param ctx - host context carrying the web server.
 * @param options - the running version and the test seams.
 * @returns the refresh/snapshot handle.
 */
export function registerVersionEndpoint(
  ctx: { webServer?: WebServerLike },
  options: VersionEndpointOptions,
): VersionEndpointHandle {
  const now = options.now ?? ((): number => Date.now())
  let result: VersionCheckResult = { current: options.current }
  let inFlight: Promise<void> | undefined

  const read = async (): Promise<void> => {
    try {
      const tags = await (options.fetchTags ?? defaultFetchTags)(AbortSignal.timeout(FETCH_TIMEOUT_MS))
      const update = pickUpdate(tags, options.current)
      result = { current: options.current, ...(update === undefined ? {} : { update }), checkedAt: now() }
    } catch (error) {
      // Offline, proxied, rate-limited, or answered with nonsense: stay silent.
      // The UI simply shows no update notice, which is the same thing an
      // up-to-date host shows.
      options.logger?.warn?.('[yolo] version check failed: %s', error instanceof Error ? error.message : String(error))
    }
  }

  const refresh = (): Promise<void> => {
    if (inFlight !== undefined) return inFlight
    const run = read().finally(() => { inFlight = undefined })
    inFlight = run
    return run
  }

  ctx.webServer?.register({
    kind: 'prefix',
    path: '/yolo/version',
    handler: (_req, res) => {
      if (result.checkedAt === undefined || now() - result.checkedAt > CACHE_TTL_MS) void refresh()
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-cache' })
      res.end(JSON.stringify(result))
    },
  })

  // Warm the cache at plugin load so the first settings card open already has
  // an answer. Never awaited: a slow registry must not delay host startup.
  void refresh()

  return { refresh, snapshot: () => result }
}
