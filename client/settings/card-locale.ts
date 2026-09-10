// Copy for the YOLO plugin-configuration card.
//
// dsh 0.1.5 gives every plugin card the framework's locale seat: a card
// registration that declares `locale: <namespace>` receives a `t` bound to that
// namespace (the shipped `settings.plugins` section does exactly this). YOLO
// therefore owns a dictionary namespace instead of hard-coding Chinese strings,
// so its card follows the host's language switch like every other card.
//
// Shared chrome wording (`expand`, `save`, `discard`, `unsaved`, `overridden`,
// `reset`, `readOnly`, `invalidNumber`, …) deliberately mirrors the shipped
// `settings.plugins` dictionary verbatim: the same gestures must read the same
// way wherever a plugin card appears.

/** Locale namespace owned by this package; also the card registration's `locale`. */
export const YOLO_CARD_NS = 'dsh-plugin-yolo'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** YOLO plugin-configuration card copy. */
    'dsh-plugin-yolo': YoloCardLocaleKey
  }
}

/** Every key this card renders — the dictionary must carry all of them in both locales. */
export type YoloCardLocaleKey =
  | 'title'
  | 'description'
  | 'meta'
  | 'unsaved'
  | 'expand'
  | 'collapse'
  | 'save'
  | 'saving'
  | 'discard'
  | 'saveFailed'
  | 'readOnly'
  | 'overridden'
  | 'reset'
  | 'invalidNumber'
  | 'invalidTime'
  | 'experimental'
  | 'groupExtraction'
  | 'groupExperimental'
  | 'groupReminder'
  | 'groupBrief'
  | 'groupStorage'
  | 'updateTag'
  | 'updateDetail'
  | 'updateHint'
  | 'extractionEnabled'
  | 'extractionEnabledHint'
  | 'extractionModel'
  | 'extractionModelHint'
  | 'identityR2'
  | 'identityR2Hint'
  | 'identityR2Confidence'
  | 'identityR2ConfidenceHint'
  | 'identityR3'
  | 'identityR3Hint'
  | 'reminderEnabled'
  | 'reminderEnabledHint'
  | 'checkIntervalSec'
  | 'checkIntervalSecHint'
  | 'aheadMin'
  | 'aheadMinHint'
  | 'quietHoursEnabled'
  | 'quietHoursEnabledHint'
  | 'quietStart'
  | 'quietStartHint'
  | 'quietEnd'
  | 'quietEndHint'
  | 'briefEnabled'
  | 'briefEnabledHint'
  | 'morningTime'
  | 'morningTimeHint'
  | 'eveningTime'
  | 'eveningTimeHint'
  | 'briefModel'
  | 'briefModelHint'
  | 'snapshotEvery10Turns'
  | 'snapshotEvery10TurnsHint'

/** Simplified Chinese copy. */
export const zh: Record<YoloCardLocaleKey, string> = {
  title: 'YOLO — 管理工作与生活的助手',
  description: '配置对话提取、低打扰提醒、早晚报与本地快照。',
  meta: 'v{version} · 设置由宿主保存，刷新后仍会保留。',
  unsaved: '未保存',
  expand: '展开设置',
  collapse: '收起设置',
  save: '保存',
  saving: '保存中…',
  discard: '放弃修改',
  saveFailed: '本部署没有接受这些值，已保留供你修改。',
  readOnly: '本部署的设置为只读。',
  overridden: '已覆盖',
  reset: '恢复默认',
  invalidNumber: '请填数字；留空表示使用默认值。',
  invalidTime: '请填 24 小时制时间，例如 22:30；留空表示使用默认值。',
  experimental: '实验性',
  groupExtraction: 'LLM 提取',
  groupExperimental: '实验能力',
  groupReminder: '到期提醒',
  groupBrief: '早晚报',
  groupStorage: '本地快照',
  updateTag: '有新版本',
  updateDetail: '发现新版本 v{latest}（{tag} 通道），当前运行 v{current}。',
  updateHint: '更新：npx @deepseek-ai/dsh plugin --profile web add dsh-plugin-yolo@{latest}',
  extractionEnabled: '启用 LLM 提取',
  extractionEnabledHint: '关闭后不再从对话中整理新的事项。',
  extractionModel: '提取模型',
  extractionModelHint: '用于从对话中整理事项的模型名。',
  identityR2: '高置信事项自动关联',
  identityR2Hint: '开启后，仅在模型置信度至少达到下方阈值且只有一个开放候选时，把后续提及关联到原事项，或按稳定 ID 修改明确的截止时间。不会自动重开、合并、修改状态或处理多候选。',
  identityR2Confidence: '关联置信度阈值',
  identityR2ConfidenceHint: '0 到 1 之间的数字；越低越容易自动关联，也越需要留意误关联。',
  identityR3: '重复事项合并建议',
  identityR3Hint: '开启后，看板会结合模型语义判断和受保护的标题相似度提示可能重复的事项，并展示推荐理由与置信度。系统只提供预览；必须由你选择保留哪一项并确认，绝不会自动合并。',
  reminderEnabled: '启用到期提醒',
  reminderEnabledHint: '关闭后不再产生到期提醒投递。',
  checkIntervalSec: '扫描间隔（秒）',
  checkIntervalSecHint: '至少 10 秒；重启宿主后生效。',
  aheadMin: '提前提醒（分钟）',
  aheadMinHint: '0 表示到点提醒。',
  quietHoursEnabled: '启用安静时段',
  quietHoursEnabledHint: '安静时段内到期的提醒会推迟到时段结束后投递。',
  quietStart: '安静时段开始',
  quietStartHint: '24 小时制，例如 22:30。',
  quietEnd: '安静时段结束',
  quietEndHint: '24 小时制，例如 07:00。',
  briefEnabled: '启用早晚报',
  briefEnabledHint: '按下方时间投递当日计划与提醒摘要。',
  morningTime: '早报时间',
  morningTimeHint: '24 小时制，例如 08:30。',
  eveningTime: '晚报时间',
  eveningTimeHint: '24 小时制，例如 21:00。',
  briefModel: '简报模型',
  briefModelHint: '生成早晚报正文的模型名。',
  snapshotEvery10Turns: '每 10 轮工作对话生成快照',
  snapshotEvery10TurnsHint: '开启后按轮次写入本地 Markdown 快照；关闭则每日一次。YOLO 自身的对话不计入轮次。',
}

/** English copy. */
export const en: Record<YoloCardLocaleKey, string> = {
  title: 'YOLO — assistant for managing work and life',
  description: 'Configure conversation extraction, low-interruption reminders, daily briefs, and local snapshots.',
  meta: 'v{version} · The host stores these settings, so they survive a refresh.',
  unsaved: 'Unsaved',
  expand: 'Show settings',
  collapse: 'Hide settings',
  save: 'Save',
  saving: 'Saving…',
  discard: 'Discard',
  saveFailed: 'The deployment did not accept these values; they were left for you to correct.',
  readOnly: 'This deployment stores settings read-only.',
  overridden: 'Overridden',
  reset: 'Reset to default',
  invalidNumber: 'Enter a number, or leave blank to use the default.',
  invalidTime: 'Enter a 24-hour time such as 22:30, or leave blank to use the default.',
  experimental: 'Experimental',
  groupExtraction: 'LLM extraction',
  groupExperimental: 'Experimental capabilities',
  groupReminder: 'Due reminders',
  groupBrief: 'Daily briefs',
  groupStorage: 'Local snapshots',
  updateTag: 'Update available',
  updateDetail: 'Version v{latest} is published on the {tag} channel; this host runs v{current}.',
  updateHint: 'Update: npx @deepseek-ai/dsh plugin --profile web add dsh-plugin-yolo@{latest}',
  extractionEnabled: 'Enable LLM extraction',
  extractionEnabledHint: 'When off, new commitments are no longer organised from conversations.',
  extractionModel: 'Extraction model',
  extractionModelHint: 'Model name used to organise commitments from conversations.',
  identityR2: 'Auto-link high-confidence mentions',
  identityR2Hint: 'When on, a later mention is linked to its original item — or an explicit due date is updated by stable ID — only when the model reaches the threshold below with a single open candidate. It never reopens, merges, changes state, or handles multiple candidates.',
  identityR2Confidence: 'Link confidence threshold',
  identityR2ConfidenceHint: 'A number between 0 and 1; lower links more readily and needs more care against false links.',
  identityR3: 'Duplicate-merge suggestions',
  identityR3Hint: 'When on, the board suggests possibly duplicated items using model judgement plus protected title similarity, with its reasoning and confidence. It only previews: you choose which item to keep and confirm. It never merges automatically.',
  reminderEnabled: 'Enable due reminders',
  reminderEnabledHint: 'When off, no due reminders are delivered.',
  checkIntervalSec: 'Scan interval (seconds)',
  checkIntervalSecHint: 'At least 10 seconds; takes effect after a host restart.',
  aheadMin: 'Remind ahead (minutes)',
  aheadMinHint: '0 reminds exactly when due.',
  quietHoursEnabled: 'Enable quiet hours',
  quietHoursEnabledHint: 'Reminders falling inside quiet hours are held until the window ends.',
  quietStart: 'Quiet hours start',
  quietStartHint: '24-hour clock, for example 22:30.',
  quietEnd: 'Quiet hours end',
  quietEndHint: '24-hour clock, for example 07:00.',
  briefEnabled: 'Enable daily briefs',
  briefEnabledHint: 'Deliver the day’s plan and reminder summary at the times below.',
  morningTime: 'Morning brief time',
  morningTimeHint: '24-hour clock, for example 08:30.',
  eveningTime: 'Evening brief time',
  eveningTimeHint: '24-hour clock, for example 21:00.',
  briefModel: 'Brief model',
  briefModelHint: 'Model name used to write the brief body.',
  snapshotEvery10Turns: 'Snapshot every 10 work turns',
  snapshotEvery10TurnsHint: 'On writes a local Markdown snapshot by turn count; off writes one daily. YOLO’s own conversation does not count.',
}
