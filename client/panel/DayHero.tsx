// v5 host-native drawer — DayHero (frontend-redesign-v5-native.md §四).
// The today face's headline: date + 「N 件待办 · M 逾期」 so the day's
// load is legible before any row is read.

export interface DayHeroProps {
  /** Today-due open count (待办). */
  todayCount: number
  /** Overdue open count (逾期). */
  overdueCount: number
}

export function DayHero({ todayCount, overdueCount }: DayHeroProps): JSX.Element {
  const d = new Date()
  const dateLabel = `${d.getMonth() + 1}月${d.getDate()}日 · 周${'日一二三四五六'[d.getDay()]}`
  return (
    <div className="hero">
      <h1>今天</h1>
      <span className="hdate">{dateLabel}</span>
      <span className="hcount">
        <b>{todayCount}</b> 件待办 · <span>{overdueCount}</span> 逾期
      </span>
    </div>
  )
}
