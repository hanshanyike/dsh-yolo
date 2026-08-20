// YOLO browser-side bundle — M4a skeleton.
// Loaded by the dsh web client via the `dsh.client` field + `./client` export.
// Full dashboard UI (conversation.view tab, conversation node, header button,
// settings card renderer) is implemented in M4b on top of this entry.

export const name = 'yolo-client'

export function apply(ctx: { logger?: { info?: (msg: string) => void } }): void {
  ctx.logger?.info?.('[yolo] client bundle loaded')
}
