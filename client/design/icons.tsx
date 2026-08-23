// Mono icon set (frontend-redesign.md 3.5 / appendix B) — 16×16 viewport,
// 1.5px stroke, round caps, currentColor, no fills (status dots aside).
// Hand-drawn zero-dependency SVG so no icon library enters the bundle.
// The Emoji glyphs (💬 ✕ ✓ 🚩) of the pre-redesign UI are all retired here.

export interface IconProps {
  size?: number
  className?: string
}

function shell(paths: string): (props: IconProps) => JSX.Element {
  return function YoloIcon({ size = 16, className }: IconProps): JSX.Element {
    return (
      <svg
        className={className ?? 'ic'}
        viewBox="0 0 16 16"
        width={size}
        height={size}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        dangerouslySetInnerHTML={{ __html: paths }}
      />
    )
  }
}

export const IcCheck = shell('<path d="M3.5 8.5l3 3 6-7"/>')
export const IcClock = shell('<circle cx="8" cy="8" r="5.5"/><path d="M8 5.5V8l2 1.5"/>')
export const IcCalendar = shell('<rect x="2.5" y="3.5" width="11" height="10" rx="2"/><path d="M2.5 6.5h11M5.5 2.5v2M10.5 2.5v2"/>')
export const IcLedger = shell('<path d="M4 2.5h8.5v11H4z"/><path d="M6 5.5h4.5M6 8h4.5M6 10.5h3"/>')
export const IcPlusDay = shell('<path d="M8 3.5v9M3.5 8h9"/><circle cx="12.5" cy="3.5" r="1.5" fill="currentColor" stroke="none"/>')
export const IcChat = shell('<rect x="3" y="4" width="10" height="7.5" rx="2"/><path d="M6 11.5L5 14l3-2.5"/>')
export const IcDots = shell('<circle cx="4" cy="8" r="1.2" fill="currentColor" stroke="none"/><circle cx="8" cy="8" r="1.2" fill="currentColor" stroke="none"/><circle cx="12" cy="8" r="1.2" fill="currentColor" stroke="none"/>')
export const IcFilter = shell('<path d="M3 4.5h10l-3.8 4.2v4.3L6.8 11.5V8.7z"/>')
export const IcClose = shell('<path d="M4 4l8 8M12 4l-8 8"/>')
export const IcRefresh = shell('<path d="M13 8a5 5 0 1 1-1.9-3.9"/><path d="M13.2 2.8v2.4h-2.4"/>')
export const IcFlag = shell('<path d="M4.5 14V3.5"/><path d="M4.5 4h7l-1.5 2.5L11.5 9h-7"/>')
export const IcBell = shell('<path d="M4 10.5V7a4 4 0 0 1 8 0v3.5l1.2 1.8H2.8z"/><path d="M6.8 13.8a1.3 1.3 0 0 0 2.4 0"/>')
export const IcPlus = shell('<path d="M8 3.5v9M3.5 8h9"/>')
export const IcSend = shell('<path d="M13.5 3.2L2.8 7.4l4.3 1.9 1.9 4.3z"/><path d="M7.1 9.3l6.4-6.1"/>')
export const IcChevron = shell('<path d="M6 4l4 4-4 4"/>')
export const IcPin = shell('<path d="M8 13.5S3.5 9.8 3.5 6.5a4.5 4.5 0 0 1 9 0c0 3.3-4.5 7-4.5 7z"/><circle cx="8" cy="6.5" r="1.6"/>')
export const IcTarget = shell('<circle cx="8" cy="8" r="5.5"/><circle cx="8" cy="8" r="1.5" fill="currentColor" stroke="none"/>')
export const IcExpand = shell('<path d="M3 6V3h3"/><path d="M3 3l4.5 4.5"/><path d="M13 10v3h-3"/><path d="M13 13l-4.5-4.5"/>')
export const IcShrink = shell('<path d="M9 3h4v4"/><path d="M13 3l-4.5 4.5"/><path d="M7 13H3V9"/><path d="M3 13l4.5-4.5"/>')
export const IcMerge = shell('<path d="M4 4v2.5a3.5 3.5 0 0 0 3.5 3.5h6"/><path d="M4 12V9.5"/><path d="M11.5 7.5L13.5 9.5l-2 2"/>')
export const IcSun = shell('<circle cx="8" cy="8" r="2.5"/><path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M12.6 3.4l-1.1 1.1M4.5 11.5l-1.1 1.1"/>')
export const IcMoon = shell('<path d="M12.8 10.3A5.5 5.5 0 0 1 5.7 3.2 5.5 5.5 0 1 0 12.8 10.3z"/>')
