# `client/`：浏览器客户端

## 职责与边界

浏览器客户端负责 panel shell、页面 controller、对话/通知/事项前景和 Mono 展示。服务端仍是 current state 与业务判断事实源；客户端不推导不存在的完成状态、attention reason、source 或 workspace owner。

## 当前控制器拆分

Phase 5 已把高耦合 use-case state 从两个大组件迁到稳定 controller：

| Controller | Owner |
|---|---|
| `panel/controllers/use-dashboard-controller.ts` | dashboard fetch、loading/error、业务 signature、refresh sweep、unseen revision 防倒退 |
| `panel/controllers/use-item-detail-controller.ts` | 当前事项定位、编辑 draft、动作/保存、receipt/undo/error 与讨论入口 |
| `panel/controllers/use-notification-navigation.ts` | popup 已读、reminder todo 定位和通知记录 fallback |
| `panel/kanban/use-kanban-actions.ts` | quick add、事项动作、attention intent、Today task panel、receipt/undo/error |
| `panel/kanban/surfaces.ts` | 稳定 Home/Plan/History surface key |

`YoloPanel.tsx` 仍是 shell：拥有 route、foreground、layout/presentation、panel 恢复、主题和 controller 组合。`KanbanView.tsx` 仍负责页面呈现、筛选和局部 editor UI，但不再自行实现主要 mutation workflow。此次拆分保持现有 IA、视觉与 HTTP contracts，不新增页面。

## 文件结构

| 路径 | 职责 |
|---|---|
| `index.ts` | dsh client registration、settings 与 sidebar slot |
| `panel/YoloPanel.tsx` | shell、route、single foreground、layout/controller composition |
| `panel/KanbanView.tsx` | Home/Plan/History 页面内容和纯筛选呈现 |
| `panel/controllers/` | dashboard、detail、notification use-case controllers |
| `panel/kanban/` | board actions 与稳定 surface names |
| `panel/ChatPane.tsx`、`panel/chat/` | fresh assistant/item-episode conversation UI 与请求/scroll controller |
| `panel/HistoryView.tsx` | history read model UI |
| `panel/NotificationLog.tsx` | cursor-paginated notification record UI |
| `panel/ForegroundContext.tsx` | detail/source/chat 单一前景 |
| `panel/v2/` | 已有 Dashboard v2 展示组件与 API helper；目录名仍为 compatibility，未虚构为新数据版本 |
| `sidebar/` | 常驻入口、badge 与 non-modal popup |
| `settings/` | `settings.plugin.item` 插件配置卡的模型、表单控制器、文案与样式 |
| `design/` | Mono tokens、icons、style |

## 插件配置卡（dsh 0.1.5）

dsh 0.1.5 把「插件」设置页做成一个扩展点：`settings.plugins.tab` 是 tab 列表槽，其中
`configurable` tab 再声明按键（settings namespace）分发的 `settings.plugin.item` 槽。卡片由插件自己
拥有，所以 YOLO 的卡片要与 dsh 自带卡片（shell / agent-loop / web-search / subagent）一致，靠的是
**同契约 + 同原子 + 同声明**，而不是复用组件：

| 组成 | 做法 |
|---|---|
| `settings/` 注册 | `ctx.slots.register({ name: 'settings.plugin.item', key: 'yolo', locale: 'dsh-plugin-yolo', inject })`；`key` 是 host 侧注册的 settings namespace |
| 文案 | `ctx.locale.register('dsh-plugin-yolo', { zh, en })`，注册时声明 `locale`，框架把该命名空间的 `t` 作为标准座位注入 |
| 卡片外壳 | 复刻 dsh 的卡片契约：根节点是列表里的 `<li>`，头部是 disclosure `<button>`（名称 + 描述 + 未保存 Tag + chevron），正文含只读提示与底部的放弃/保存；`available === false` 时不渲染；保存成功后自动折叠 |
| 表单状态 | `Settings` scope + `CardShell`（available/writable/dirty/invalid/saving/failed）与 `CardActions`（edit/resetField/save/discard），另加 switch 的 `setSwitch` |
| 控件 | 值字段复刻 `ValueField` 结构；开关用 shell 提供的 `Tag` / `Switch` / 图标原子（`@deepseek-ai/dsh-client-ui-primitives` 属于客户端 module baseline） |
| 写入 | 草稿全部暂存，保存时按 dotted path 组装 `SettingsPathOpView[]`，用**一次** revision-fenced `scope.mutate(ops, fence)` 提交，再从 `user` 层回读校验 |

`@deepseek-ai/dsh-client-ui-settings-plugins` 的浏览器产物只导出 `apply` / `inject`，`PluginCard` /
`ValueField` / `CardForm` 无法被外部插件 `require`，因此卡片外壳与 CSS 声明在 `client/settings/` 内按
上游声明逐条复刻（见 `card-style.ts`）。样式只使用 host 的 `--dsw-alias-*` token，随宿主主题切换。

| 文件 | 职责 |
|---|---|
| `settings/card-locale.ts` | 文案命名空间 `dsh-plugin-yolo` 与中英词典（chrome 用词与 dsh 自带卡片逐字一致） |
| `settings/model.ts` | 可编辑字段表、dotted path 读写、字段 → 文案键的**全量**映射、分组布局 |
| `settings/card-form.ts` | 暂存式表单：`CardShell` / `CardFieldState` / `CardActions` + 一次 fenced `mutate` 与回读校验 |
| `settings/SettingsCard.tsx` | 卡片组件：复刻 PluginCard / ValueField 外壳，开关用宿主 `Switch` |
| `settings/card-style.ts` | 卡片样式表（一次性注入、随 fiber 卸载移除） |

YOLO 的 settings namespace 是嵌套结构（`reminder.checkIntervalSec`），所以卡片按叶子路径读写，
而不是像自带卡片那样按顶层字段整段写入；host 的 `applyPathOp` 支持嵌套路径并会补齐中间容器。

## Contracts 与依赖

客户端 DTO 统一从 `src/contracts/*` 导入。纯日期、筛选与 dashboard surface 规则仍可从明确的 `src/shared/*` 纯函数导入。

Dependency fitness test 禁止 client 直接依赖：

- `src/storage/types.ts`；
- `src/shared/actions.ts`；
- `src/ui/config.ts`。

客户端所有 mutation 继续通过 `/yolo/actions` 或专用 HTTP endpoint；controller 只能显示服务端 outcome/receipt，不能直接修改 SQLite 语义。

## 状态与刷新

- Dashboard 首开加载一次；动作、显式刷新与 notification request 触发重新读取，不恢复 panel 内 30 秒轮询。
- dashboard sweep 使用稳定业务 signature，纯响应时间变化不触发动效。
- unseen 更新绑定 server revision，旧 dashboard/旧请求不能覆盖较新 badge。
- popup click 先标记指定 delivery seen；能解析 reminder todo 时打开该事项，否则打开 notification record。
- route、foreground、draft、thread 和 request 不因 responsive presentation 改变。

## 对话与前景

panel 任一时刻只有一个 detail/source/conversation foreground。顶层“和助手聊聊”每次显式打开都生成新的 `a-*` ephemeral thread，界面从空历史开始且绝不展示内部 `w-*` resident；事项讨论复用自己的 episode，显式结束后才释放。split/focus 各自有真实 scroll owner，near-bottom 才自动跟随最新消息。

## Mono 设计与响应式

使用中性色与单一 indigo，发丝线层次和不超过 200ms 的动效；不添加装饰性隐喻。340px、窄屏、标准宽和宽屏只改变 presentation，不改变应用状态。reduced-motion 必须保留功能。

## Bundle 构建契约

浏览器入口仍为 `client/index.ts`，构建为 CJS 后由 `scripts/wrap-client.mjs` 注册到 dsh ModuleLoader，并提供所需 `process` shim。裸 package row、`./client` export、manifest `dsh.client` 与 host patch rows 由 `tests/package-loader-contract.test.ts` 固定。

`tsdown.client.config.ts` 把客户端 module baseline 里的共享模块留作 external（`react`、`react/jsx-runtime`、
`@deepseek-ai/dsh-client-store`、`@deepseek-ai/dsh-client-ui-primitives`），由 shell 的 module table 提供
同一份实例；打包进来会产生第二份 React / 组件样式，破坏 hooks 与外观一致。其余跨包引用一律走
type-only import（构建时擦除，不产生运行时依赖）。

## 测试

- `tests/panel-controllers.test.ts` 覆盖 dashboard signature、notification routing 和 controller 纯行为。
- 原 panel/navigation/filter/chat/settings 测试继续覆盖兼容行为。
- 修改任何 controller、client contract 或 layout 后运行 `pnpm check`、`pnpm test:run`、`pnpm build`、受影响 UI E2E 与 W1–W16；controller 单测不能替代真实 Edge。

## 当前限制

- shell 和 KanbanView 已明显缩小，但仍不是完全按每个产品页面物理拆分；未来拆分必须以 use-case owner 和可验证收益为依据。
- `panel/v2` 尚未重命名；它不表示有两份服务器 current state。
- Agent task 页面未实现，客户端没有隐藏的 Agent task controller 或路由。
