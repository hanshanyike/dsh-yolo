// YOLO shared session access. The dsh Session class exposes its storage header
// (id, cwd, lineage) as `header` — an earlier revision of these plugins read a
// non-existent `meta` field, so every cwd lookup silently fell back to
// process.cwd() and scoped all workspace memory to the harness root. All
// plugins resolve the session workspace through these helpers instead.

/** Workspace cwd of a dsh session, when its header carries one. */
export function sessionCwd(session: unknown): string | undefined {
  if (typeof session !== 'object' || session === null) return undefined
  const header = (session as { header?: { cwd?: unknown } }).header
  return typeof header?.cwd === 'string' ? header.cwd : undefined
}

/** Durable id of a dsh session, when available. */
export function sessionId(session: unknown): string | undefined {
  if (typeof session !== 'object' || session === null) return undefined
  const header = (session as { header?: { id?: unknown } }).header
  return typeof header?.id === 'string' ? header.id : undefined
}
