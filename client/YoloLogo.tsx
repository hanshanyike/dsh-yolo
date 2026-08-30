// YOLO brand mark — focus rings + the next item moving into attention. This is
// the original target composition, refined to dsh's DeepSeek blue system.
// Keep these exported values in sync with docs/logo.svg; tests guard the two
// public renderers against drift.
import type { CSSProperties } from 'react'

export const YOLO_LOGO_BACKGROUND = '#4176E6'
export const YOLO_LOGO_ATTENTION_ARC = 'M 168 100 A 62 62 0 0 0 190 66'

export interface YoloLogoProps {
  size?: number
  style?: CSSProperties
}

export function YoloLogo({ size = 18, style }: YoloLogoProps): JSX.Element {
  return (
    <svg
      viewBox="0 0 256 256"
      width={size}
      height={size}
      role="img"
      aria-label="YOLO logo"
      style={{ flex: 'none', display: 'block', ...style }}
    >
      <rect width="256" height="256" rx="56" fill={YOLO_LOGO_BACKGROUND} />
      <circle cx="124" cy="132" r="62" fill="none" stroke="#FFFFFF" strokeWidth="13" opacity="0.95" />
      <circle cx="124" cy="132" r="30" fill="none" stroke="#FFFFFF" strokeWidth="11" opacity="0.9" />
      <circle cx="124" cy="132" r="10" fill="#FFFFFF" />
      <circle cx="204" cy="74" r="15" fill="#FFFFFF" />
      <path d={YOLO_LOGO_ATTENTION_ARC} fill="none" stroke="#FFFFFF" strokeWidth="10" strokeLinecap="round" opacity="0.55" />
    </svg>
  )
}
