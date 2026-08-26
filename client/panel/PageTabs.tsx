import { useRef } from 'react'
import { IcCalendar, IcLedger, IcTarget } from '../design/icons.tsx'
import type { BoardPage, HistorySection, PlanSection } from './navigation.ts'

export interface PageTabsProps {
  page: BoardPage
  counts: Record<BoardPage, number>
  partial?: boolean
  onChange: (page: BoardPage) => void
}

const PAGES: Array<{ key: BoardPage; label: string; icon: JSX.Element }> = [
  { key: 'home', label: '首页', icon: <IcTarget size={15} /> },
  { key: 'plan', label: '计划', icon: <IcCalendar size={15} /> },
  { key: 'history', label: '历史', icon: <IcLedger size={15} /> },
]

export const PAGE_KEYS: readonly BoardPage[] = ['home', 'plan', 'history']

export function pageKeyForKeyboard(page: BoardPage, key: string): BoardPage | null {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(key)) return null
  const index = PAGE_KEYS.indexOf(page)
  const next = key === 'Home'
    ? 0
    : key === 'End'
      ? PAGE_KEYS.length - 1
      : (index + (key === 'ArrowRight' ? 1 : -1) + PAGE_KEYS.length) % PAGE_KEYS.length
  return PAGE_KEYS[next] ?? null
}

export function PageTabs({ page, counts, partial = false, onChange }: PageTabsProps): JSX.Element {
  const refs = useRef<Array<HTMLButtonElement | null>>([])
  const activeIndex = PAGES.findIndex((entry) => entry.key === page)

  const move = (index: number, key: string): void => {
    const targetKey = pageKeyForKeyboard(PAGES[index]?.key ?? page, key)
    if (!targetKey) return
    const next = PAGES.findIndex((entry) => entry.key === targetKey)
    onChange(targetKey)
    refs.current[next]?.focus()
  }

  return (
    <nav className="y-tabs" role="tablist" aria-label="助手页面">
      {PAGES.map((entry, index) => (
        <button
          ref={(node) => { refs.current[index] = node }}
          key={entry.key}
          type="button"
          role="tab"
          id={`yolo-tab-${entry.key}`}
          aria-controls={`yolo-page-${entry.key}`}
          aria-selected={page === entry.key}
          tabIndex={page === entry.key || (activeIndex < 0 && index === 0) ? 0 : -1}
          className={`ytab${page === entry.key ? ' on' : ''}`}
          aria-label={`${entry.label}，${partial ? '已加载' : ''}${counts[entry.key]} 项`}
          onClick={() => { onChange(entry.key) }}
          onKeyDown={(event) => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
            event.preventDefault()
            move(index, event.key)
          }}
        >
          {entry.icon}<span>{entry.label}</span><span className="nnum">{counts[entry.key]}</span>
        </button>
      ))}
    </nav>
  )
}

export function PlanTabs({ section, onChange }: { section: PlanSection; onChange: (section: PlanSection) => void }): JSX.Element {
  return <SectionTabs label="计划范围" value={section} entries={[
    ['today', '今天'], ['upcoming', '接下来'], ['goals', '目标'], ['all', '全部'],
  ]} onChange={(value) => { onChange(value as PlanSection) }} />
}

export function HistoryTabs({ section, onChange }: { section: HistorySection; onChange: (section: HistorySection) => void }): JSX.Element {
  return <SectionTabs label="历史范围" value={section} entries={[
    ['completed', '已结束'], ['changes', '最近变化'],
  ]} onChange={(value) => { onChange(value as HistorySection) }} />
}

function SectionTabs({ label, value, entries, onChange }: {
  label: string
  value: string
  entries: Array<[string, string]>
  onChange: (value: string) => void
}): JSX.Element {
  return (
    <div className="caps" role="tablist" aria-label={label}>
      {entries.map(([key, text]) => (
        <button key={key} type="button" role="tab" aria-selected={value === key} className={`cap${value === key ? ' on' : ''}`} onClick={() => { onChange(key) }}>
          {text}
        </button>
      ))}
    </div>
  )
}
