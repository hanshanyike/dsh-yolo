// YOLO brand mark — inline reproduction of docs/logo.svg (target rings + a
// captured memory bit), kept component-shaped so the UI can size it anywhere
// without touching the asset pipeline. Stays in sync with docs/logo.svg.
import { useId } from 'react'
import type { CSSProperties } from 'react'

export interface YoloLogoProps {
  size?: number
  style?: CSSProperties
}

export function YoloLogo({ size = 18, style }: YoloLogoProps): JSX.Element {
  // Unique per instance to avoid gradient-id collisions when several marks render.
  const gid = useId().replace(/:/g, '')
  const grad = `yolo-grad-${gid}`
  return (
    <svg
      viewBox="0 0 256 256"
      width={size}
      height={size}
      role="img"
      aria-label="YOLO logo"
      style={{ flex: 'none', display: 'block', ...style }}
    >
      <defs>
        <linearGradient id={grad} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#6366F1" />
          <stop offset="1" stopColor="#06B6D4" />
        </linearGradient>
      </defs>
      <rect width="256" height="256" rx="56" fill={`url(#${grad})`} />
      <circle cx="124" cy="132" r="62" fill="none" stroke="#FFFFFF" strokeWidth="13" opacity="0.95" />
      <circle cx="124" cy="132" r="30" fill="none" stroke="#FFFFFF" strokeWidth="11" opacity="0.9" />
      <circle cx="124" cy="132" r="10" fill="#FFFFFF" />
      <circle cx="204" cy="74" r="15" fill="#FFFFFF" />
      <path d="M 168 100 A 62 62 0 0 0 190 66" fill="none" stroke="#FFFFFF" strokeWidth="10" strokeLinecap="round" opacity="0.55" />
    </svg>
  )
}