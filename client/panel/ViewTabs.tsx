// v5 host-native drawer — horizontal view tabs (frontend-redesign-v5-native.md §四).
// The vertical navigation belongs to the host sidebar; YOLO's own face
// switching is a horizontal segmented bar: 今日 / 即将 / 已完成 / 目标 / 台账.
// Each tab carries its live count so the drawer reads at a glance.

import { useRef } from 'react'
import { IcCalendar, IcCheck, IcClock, IcLedger, IcTarget } from '../design/icons.tsx'

export type ViewKey = 'today' | 'upcoming' | 'done' | 'goals' | 'ledger'

export interface ViewTabsProps {
  view: ViewKey
  counts: Record<ViewKey, number>
  onChange: (view: ViewKey) => void
  /** Compact mode promotes only the three everyday views. */
  compact?: boolean
  /** Today count covers only loaded workspaces when the dashboard is partial. */
  todayPartial?: boolean
}

const TABS: { key: ViewKey; label: string; title: string; icon: JSX.Element }[] = [
  { key: 'today', label: '今天', title: '今天默认表面承接的开放事项', icon: <IcCalendar size={15} /> },
  { key: 'upcoming', label: '即将', title: '即将：未来 7 天 + 滞留', icon: <IcClock size={15} /> },
  { key: 'done', label: '已完成', title: '已完成', icon: <IcCheck size={15} /> },
  { key: 'goals', label: '目标', title: '目标与里程碑', icon: <IcTarget size={15} /> },
  { key: 'ledger', label: '台账', title: '今日台账', icon: <IcLedger size={15} /> },
]

const PRIMARY_KEYS: readonly ViewKey[] = ['today', 'upcoming', 'done']

export function ViewTabs({ view, counts, onChange, compact = false, todayPartial = false }: ViewTabsProps): JSX.Element {
  const refs = useRef<Array<HTMLButtonElement | null>>([])
  const tabs = compact ? TABS.filter((tab) => PRIMARY_KEYS.includes(tab.key)) : TABS
  const activeIndex = tabs.findIndex((tab) => tab.key === view)

  const moveFocus = (index: number, key: string): void => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(key)) return
    const next = key === 'Home'
      ? 0
      : key === 'End'
        ? tabs.length - 1
        : (index + (key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
    const nextTab = tabs[next]
    if (nextTab) onChange(nextTab.key)
    refs.current[next]?.focus()
  }

  return (
    <nav className="y-tabs" role="tablist" aria-label="看板视图">
      {tabs.map((t, index) => {
        const title = t.key === 'today'
          ? `今天默认表面承接的开放事项：助手判断、需要关注、今天到期和未处理提醒已去重${todayPartial ? '；部分工作区未加载，仅统计已加载内容' : ''}`
          : t.title
        return (
          <button
            ref={(node) => { refs.current[index] = node }}
            key={t.key}
            type="button"
            role="tab"
            id={`yolo-tab-${t.key}`}
            aria-controls={`yolo-view-${t.key}`}
            aria-selected={view === t.key}
            tabIndex={view === t.key || (activeIndex === -1 && index === 0) ? 0 : -1}
            className={`ytab${view === t.key ? ' on' : ''}`}
            title={title}
            aria-label={t.key === 'today' ? `今天，${counts[t.key]} 件。${title}` : undefined}
            onClick={() => { onChange(t.key) }}
            onKeyDown={(event) => {
              if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
              event.preventDefault()
              moveFocus(index, event.key)
            }}
          >
            {t.icon}
            <span>{t.label}</span>
            <span className="nnum">{counts[t.key]}</span>
          </button>
        )
      })}
    </nav>
  )
}
