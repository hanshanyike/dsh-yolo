/**
 * Browser half of the version check.
 *
 * The host owns the registry read (`GET /yolo/version`, cached there); the card
 * only asks it once and renders whatever comes back. The ask never throws and
 * never blocks rendering: a version notice is advisory, so an offline host, an
 * older host without the endpoint, or a malformed answer all mean the same
 * thing — no notice.
 */

/** A published version that outranks the running one. */
export interface VersionUpdateNotice {
  /** The newer version string, as published. */
  latest: string
  /** Which dist-tag carries it. */
  tag: string
}

/** Shape guard for the endpoint's answer; anything else means "no update". */
export function parseVersionUpdate(body: unknown): VersionUpdateNotice | undefined {
  if (typeof body !== 'object' || body === null) return undefined
  const update = (body as { update?: unknown }).update
  if (typeof update !== 'object' || update === null) return undefined
  const { latest, tag } = update as { latest?: unknown; tag?: unknown }
  if (typeof latest !== 'string' || latest === '' || typeof tag !== 'string' || tag === '') return undefined
  return { latest, tag }
}

/**
 * Ask the host whether a newer YOLO is published.
 * @param fetcher - fetch implementation; injected so tests own the wire.
 * @param url - the host endpoint.
 * @returns the update, or undefined when there is none or it cannot be known.
 */
export async function fetchVersionUpdate(
  fetcher: typeof fetch = fetch,
  url = '/yolo/version',
): Promise<VersionUpdateNotice | undefined> {
  try {
    const response = await fetcher(url, { headers: { accept: 'application/json' } })
    if (!response.ok) return undefined
    return parseVersionUpdate(await response.json())
  } catch {
    return undefined
  }
}
