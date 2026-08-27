// v5 host-native drawer — capture-first command bar (frontend-redesign-v5-native.md §四).
// A first-class input at the top of the drawer: 记一件事，回车保存（默认今天到期）.
// All adds go through POST /yolo/actions (quick_add) exactly like the old
// bottom capture bar — the submit callback owns the network + refresh + toast.

import { useState } from 'react'
import { IcPlus } from '../design/icons.tsx'

export interface CaptureBarProps {
  busy?: boolean
  /** Run the add; resolve true when it landed so the input clears. */
  onSubmit: (text: string) => Promise<boolean>
}

export function CaptureBar({ busy = false, onSubmit }: CaptureBarProps): JSX.Element {
  const [draft, setDraft] = useState('')
  const [focused, setFocused] = useState(false)

  const send = async (): Promise<void> => {
    const text = draft.trim()
    if (!text || busy) return
    if (await onSubmit(text)) setDraft('')
  }

  return (
    <div className="capture capture--top">
      <label className={`capture-in${focused ? ' focus' : ''}`}>
        <IcPlus size={14} />
        <input
          className="cap-input"
          value={draft}
          placeholder={busy ? '保存中…' : '记一件事，回车保存（默认今天到期）'}
          disabled={busy}
          autoComplete="off"
          onChange={(e) => { setDraft(e.target.value) }}
          onFocus={() => { setFocused(true) }}
          onBlur={() => { setFocused(false) }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) void send()
          }}
        />
        <span className={`enter-hint mono${draft.trim() ? ' lit' : ''}`}>↵</span>
      </label>
      <button
        className="capture-submit"
        type="button"
        disabled={busy || !draft.trim()}
        onClick={() => { void send() }}
      >
        快速记录
      </button>
    </div>
  )
}
