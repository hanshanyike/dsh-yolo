import type {
  AssistantJudgmentView,
  JudgmentActionIntent,
  JudgmentFeedbackReason,
  JudgmentSource,
} from './model.ts'

export interface AssistantJudgmentProps {
  judgment: AssistantJudgmentView
  busy?: boolean
  partialData?: boolean
  onIntent: (intent: JudgmentActionIntent) => void
  onExpand?: () => void
  onCollapse?: () => void
  onIgnore?: () => void
  onFeedback?: (reason?: JudgmentFeedbackReason) => void
  onOpenSource?: (source: JudgmentSource) => void
}

function SourceLine({ source, onOpen }: {
  source: JudgmentSource
  onOpen?: (source: JudgmentSource) => void
}): JSX.Element {
  const content = (
    <>
      <span>{source.label}</span>
      {source.workspace ? <span> · {source.workspace.label}</span> : null}
      {source.excerpt ? <q>{source.excerpt}</q> : null}
    </>
  )

  if (source.sessionId && onOpen) {
    return (
      <button type="button" className="v2-judgment-source" onClick={() => { onOpen(source) }}>
        {content}
      </button>
    )
  }
  return <div className="v2-judgment-source">{content}</div>
}

export function AssistantJudgment({
  judgment,
  busy = false,
  partialData = false,
  onIntent,
  onExpand,
  onCollapse,
  onIgnore,
  onFeedback,
  onOpenSource,
}: AssistantJudgmentProps): JSX.Element {
  const titleId = `assistant-judgment-${judgment.id}`
  const compact = judgment.presentation === 'compact'
  const evidence = judgment.evidence.slice(0, 3)

  return (
    <article className={`v2-judgment v2-judgment--${judgment.presentation}`} aria-labelledby={titleId}>
      <header className="v2-judgment-header">
        <span>助手判断</span>
        {!compact ? <span>需要你回应</span> : null}
        {!compact && judgment.appearedAt
          ? <time dateTime={new Date(judgment.appearedAt).toISOString()}>{new Date(judgment.appearedAt).toLocaleString()}</time>
          : null}
      </header>

      <h2 id={titleId}>{judgment.todo.title}</h2>
      <p className="v2-judgment-reason">{judgment.reason}</p>

      {partialData
        ? <p role="status" className="v2-judgment-partial">部分工作区暂不可用，当前判断不代表全局最重要事项。</p>
        : null}

      {!compact ? (
        <>
          {evidence.length > 0 ? (
            <section aria-label="为什么现在">
              <h3>为什么现在</h3>
              <ul>
                {evidence.map((item) => (
                  <li key={item.code}>
                    <span>{item.label}</span>
                    {item.value !== undefined && item.value !== null ? <strong>{String(item.value)}</strong> : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {judgment.source ? <SourceLine source={judgment.source} onOpen={onOpenSource} /> : null}
        </>
      ) : null}

      <div className="v2-judgment-actions" role="group" aria-label="处理助手判断">
        {compact ? (
          <button type="button" disabled={busy} onClick={() => { onIntent('open_panel') }}>处理</button>
        ) : (
          <>
            <button type="button" disabled={busy} onClick={() => { onIntent('complete') }}>完成</button>
            <button type="button" disabled={busy} onClick={() => { onIntent('postpone_tomorrow') }}>推迟到明天</button>
            <button type="button" disabled={busy} onClick={() => { onIntent('discuss') }}>讨论</button>
            <button type="button" disabled={busy} onClick={() => { onIntent('open_panel') }}>更多处理</button>
          </>
        )}
      </div>

      <div className="v2-judgment-secondary">
        {compact && onExpand ? <button type="button" onClick={onExpand}>展开依据</button> : null}
        {!compact && onCollapse ? <button type="button" onClick={onCollapse}>收起依据</button> : null}
        {!compact && onIgnore ? <button type="button" disabled={busy} onClick={onIgnore}>暂时忽略</button> : null}
        {!compact && onFeedback ? <button type="button" disabled={busy} onClick={() => { onFeedback() }}>原因不对</button> : null}
      </div>

      {!compact && judgment.impact ? <p className="v2-judgment-impact">处理后：{judgment.impact}</p> : null}
    </article>
  )
}
