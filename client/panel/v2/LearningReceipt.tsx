import { buildLearningReceiptView, type LearningReceiptData } from './model.ts'

export interface LearningReceiptProps {
  receipt?: LearningReceiptData | null
  onUndo?: (receipt: LearningReceiptData) => void
  onOpenPreferences?: () => void
}

function displayValue(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '未设置'
  return String(value)
}

export function LearningReceipt({
  receipt,
  onUndo,
  onOpenPreferences,
}: LearningReceiptProps): JSX.Element | null {
  const view = buildLearningReceiptView(receipt)
  if (!receipt || !view) return null

  const hasChange = view.before !== undefined || view.after !== undefined
  return (
    <section className="v2-learning-receipt" aria-label="助手记录回执">
      <p role="status">{view.summary}</p>
      <dl>
        <div>
          <dt>作用范围</dt>
          <dd>{view.scopeLabel}</dd>
        </div>
        {hasChange ? (
          <div>
            <dt>变化</dt>
            <dd>{displayValue(view.before)} → {displayValue(view.after)}</dd>
          </div>
        ) : null}
        {view.sourceAction ? (
          <div>
            <dt>来源动作</dt>
            <dd>{view.sourceAction}</dd>
          </div>
        ) : null}
        {view.occurredAt ? (
          <div>
            <dt>记录时间</dt>
            <dd><time dateTime={new Date(view.occurredAt).toISOString()}>{new Date(view.occurredAt).toLocaleString()}</time></dd>
          </div>
        ) : null}
      </dl>
      <div className="v2-learning-receipt-actions">
        {view.reversible && onUndo
          ? <button type="button" onClick={() => { onUndo(receipt) }}>撤销变化</button>
          : null}
        {onOpenPreferences
          ? <button type="button" onClick={onOpenPreferences}>查看提醒偏好</button>
          : null}
      </div>
    </section>
  )
}
