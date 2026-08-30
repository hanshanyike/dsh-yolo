/** True when a session id belongs to a YOLO-owned resident or anchored thread. */
export function isYoloSessionId(id: string | undefined): boolean {
  return !!id && (id.startsWith('yolo-w-') || id.startsWith('yolo-a-'))
}
