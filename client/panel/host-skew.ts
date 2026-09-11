/**
 * Host-half skew detection.
 *
 * The panel bundle and the host's server half ship in the same package, but
 * they load at different times: the browser reads `dist/client` fresh on
 * every page load, while the host process keeps the server half it loaded at
 * boot. Rebuilding or upgrading `dist` while the host keeps running therefore
 * serves a NEW client against an OLD server — subpaths the old half never
 * registered (for example `POST /yolo/notifications/dismiss`) then answer
 * 405 and the panel could only show a cryptic「HTTP 405」.
 *
 * This module makes that state visible instead. The server reports the
 * version it was built with at `GET /yolo/version` (`current`), the client
 * compares it with its own bundled version, and the panel asks for a host
 * restart when they disagree. A missing endpoint (404) is skew by
 * definition: this client ships in the same build as that endpoint, so a
 * server without it predates this bundle. Every other failure stays silent —
 * the notice is advisory, exactly like the settings-card update notice.
 */

import packageJson from '../../package.json' with { type: 'json' }

/** The version this client bundle was built from. */
export const PANEL_VERSION: string = packageJson.version

/** The result of comparing the running host half against this bundle. */
export type HostSkew =
  | { kind: 'fresh' }
  | { kind: 'stale'; client: string; server: string | null }

/** Shape guard for the endpoint's `current`; anything else means unknown. */
export function parseServerVersion(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null
  const current = (body as { current?: unknown }).current
  return typeof current === 'string' && current !== '' ? current : null
}

/**
 * Ask the host half which version it runs and compare with this bundle.
 * @param fetcher - fetch implementation; injected so tests own the wire.
 * @param url - the host endpoint.
 * @returns `stale` only on definitive evidence (404, or a differing version);
 *   network noise and malformed answers read as `fresh` and stay silent.
 */
export async function fetchHostSkew(
  fetcher: typeof fetch = fetch,
  url = '/yolo/version',
): Promise<HostSkew> {
  try {
    const response = await fetcher(url, { headers: { accept: 'application/json' }, cache: 'no-store' })
    if (response.status === 404) {
      // The server half predates the version endpoint itself — it is older
      // than this bundle, which ships the endpoint.
      return { kind: 'stale', client: PANEL_VERSION, server: null }
    }
    if (!response.ok) return { kind: 'fresh' }
    const server = parseServerVersion(await response.json())
    if (server === null || server === PANEL_VERSION) return { kind: 'fresh' }
    return { kind: 'stale', client: PANEL_VERSION, server }
  } catch {
    return { kind: 'fresh' }
  }
}

/** The upgrade/restart hint shown for a 405 the running half cannot answer. */
export const HOST_SKEW_HINT = '宿主还在运行旧版助手：重启宿主（dsh web）后再试，重启后即可生效。'

/**
 * Map a failed panel request to the stale-host explanation when the status
 * says the running server half never knew that route.
 * @param status - the HTTP status of the failed request.
 * @returns the hint, or undefined when the status points elsewhere.
 */
export function hostSkewHint(status: number): string | undefined {
  return status === 405 ? HOST_SKEW_HINT : undefined
}
