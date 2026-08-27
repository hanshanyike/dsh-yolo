// YOLO brand mark — inline reproduction of docs/logo.svg (a friendly chat
// bubble), kept component-shaped so the UI can size it anywhere without
// touching the asset pipeline. Stays in sync with docs/logo.svg.
import type { CSSProperties } from 'react'

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
      <rect width="256" height="256" rx="60" fill="#5B5BD6" />
      <path d="M52 76c0-13.255 10.745-24 24-24h104c30.928 0 56 25.072 56 56v16c0 30.928-25.072 56-56 56h-38l-38 25v-25H76c-13.255 0-24-10.745-24-24V76Z" fill="#FFFFFF" />
      <circle cx="105" cy="108" r="10" fill="#5B5BD6" />
      <circle cx="151" cy="108" r="10" fill="#5B5BD6" />
      <path d="M96 137c8 12 19 18 32 18s24-6 32-18" fill="none" stroke="#5B5BD6" strokeWidth="10" strokeLinecap="round" />
    </svg>
  )
}
