// YOLO settings card (browser) — renders inside the dsh Settings > Plugins section.
// Reads/writes through the settings scope bound to the 'yolo' namespace (M4b:
// live config editing wired when the settings scope hook types are pinned).

import { YoloLogo } from '../YoloLogo.tsx'

export function SettingsCard(): JSX.Element {
  return (
    <div className="yolo-settings-card" style={{ padding: '12px 0' }}>
      <h3 style={{ margin: '0 0 8px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
        <YoloLogo size={20} />
        YOLO — 管理工作与生活的助手
      </h3>
      <p style={{ margin: '4px 0', color: 'var(--foreground-secondary, #666)' }}>
        把每轮对话里的待办 / 目标 / 里程碑 / 偏好 / 决策接进你的计划，跨会话整理、到点主动提醒，
        不用每次重新交代。看板位于左侧边栏底部（全局，与具体会话无关）。
      </p>
      <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
        <li>抽取：回合末 LLM 语义提取（可配置模型与节流间隔）</li>
        <li>召回：新会话自动注入相关记忆与偏好</li>
        <li>提醒：到期任务自动注入对话</li>
        <li>存储：SQLite + 每日 Markdown 快照</li>
      </ul>
      <p style={{ margin: '8px 0 0', fontSize: 12, opacity: 0.7 }}>
        详细配置（抽取 / 提醒 / 存储 / 召回）位于设置项上方；本卡片在 M4b 接入可编辑配置。
      </p>
    </div>
  )
}
