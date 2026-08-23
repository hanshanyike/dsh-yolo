// v5 host-native drawer — horizontal view tabs (frontend-redesign-v5-native.md §四).
// The vertical navigation belongs to the host sidebar; YOLO's own face
// switching is a horizontal segmented bar: 今日 / 即将 / 已完成 / 目标 / 台账.
// Each tab carries its live count so the drawer reads at a glance.

import { IcCalendar, IcCheck, IcClock, IcLedger, IcTarget } from '../design/icons.tsx'

export type ViewKey = 'today' | 'upcoming' | 'done' | 'goals' | 'ledger'

export interface ViewTabsProps {
  view: ViewKey
  counts: Record<ViewKey, number>
  onChange: (view: ViewKey) => void
}

const TABS: { key: ViewKey; label: string; title: string; icon: JSX.Element }[] = [
  { key: 'today', label: '今日', title: '今日：逾期 + 今天', icon: <IcCalendar size={15} /> },
  { key: 'upcoming', label: '即将', title: '即将：未来 7 天 + 滞留', icon: <IcClock size={15} /> },
  { key: 'done', label: '已完成', title: '已完成', icon: <IcCheck size={15} /> },
  { key: 'goals', label: '目标', title: '目标与里程碑', icon: <IcTarget size={15} /> },
  { key: 'ledger', label: '台账', title: '今日台账', icon: <IcLedger size={15} /> },
]

export function ViewTabs({ view, counts, onChange }: ViewTabsProps): JSX.Element {
  return (
    <nav className="y-tabs" role="tablist" aria-label="看板视图">
      {TABS.map((t) => (
        <button
          key={t.key}
          type="button"
          role="tab"
          aria-selected={view === t.key}
          className={`ytab${view === t.key ? ' on' : ''}`}
          title={t.title}
          onClick={() => { onChange(t.key) }}
        >
          {t.icon}
          <span>{t.label}</span>
          <span className="nnum">{counts[t.key]}</span>
        </button>
      ))}
    </nav>
  )
}
