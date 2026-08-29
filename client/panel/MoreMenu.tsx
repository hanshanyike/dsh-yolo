// Dashboard shell secondary actions. The compact surface keeps only the three
// primary views visible; goals, ledger, refresh and theme stay discoverable in
// this labelled menu instead of competing with chat and notifications.

import { useCallback, useEffect, useRef, useState } from 'react'
import { IcDots, IcFilter, IcMoon, IcRefresh, IcSun, IcTrash } from '../design/icons.tsx'

export interface MoreMenuProps {
  loading: boolean
  theme: 'dark' | 'light'
  onOpenFilters?: () => void
  onOpenDataManagement: () => void
  onRefresh: () => void
  onToggleTheme: () => void
}

export function MoreMenu({ loading, theme, onOpenFilters, onOpenDataManagement, onRefresh, onToggleTheme }: MoreMenuProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const close = useCallback((restoreFocus = false): void => {
    setOpen(false)
    if (restoreFocus) window.setTimeout(() => { buttonRef.current?.focus() }, 0)
  }, [])

  useEffect(() => {
    if (!open) return
    const first = menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')
    first?.focus()

    const onPointer = (event: PointerEvent): void => {
      const target = event.target as Node | null
      if (!target || menuRef.current?.contains(target) || buttonRef.current?.contains(target)) return
      close(false)
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        close(true)
        return
      }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') return
      const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])
      if (items.length === 0) return
      event.preventDefault()
      const current = items.indexOf(document.activeElement as HTMLElement)
      const next = event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? items.length - 1
          : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
      items[next]?.focus()
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [close, open])

  const run = (action: () => void, restoreFocus = true): void => {
    action()
    close(restoreFocus)
  }

  return (
    <div className="more-wrap">
      <button
        ref={buttonRef}
        type="button"
        className="head-secondary more-trigger"
        aria-label="更多看板操作"
        aria-haspopup="menu"
        aria-expanded={open}
        title="更多看板操作"
        onClick={() => { setOpen((value) => !value) }}
      >
        <IcDots size={14} />
        <span>更多</span>
      </button>
      {open && (
        <div ref={menuRef} className="more-menu" role="menu" aria-label="更多看板操作">
          {onOpenFilters ? (
            <button type="button" role="menuitem" onClick={() => { run(onOpenFilters, false) }}>
              <IcFilter size={15} /><span>高级筛选</span>
            </button>
          ) : null}
          {onOpenFilters ? <span className="more-separator" role="separator" /> : null}
          <button type="button" role="menuitem" className={loading ? 'refreshing' : undefined} aria-busy={loading} onClick={() => { run(onRefresh) }}>
            <IcRefresh size={15} /><span>刷新看板</span>
          </button>
          <button type="button" role="menuitem" onClick={() => { run(onToggleTheme) }}>
            {theme === 'dark' ? <IcSun size={15} /> : <IcMoon size={15} />}
            <span>{theme === 'dark' ? '切换为浅色主题' : '切换为深色主题'}</span>
          </button>
          <span className="more-separator" role="separator" />
          <button type="button" role="menuitem" className="danger" onClick={() => { run(onOpenDataManagement, false) }}>
            <IcTrash size={15} /><span>事项数据管理</span>
          </button>
        </div>
      )}
    </div>
  )
}
