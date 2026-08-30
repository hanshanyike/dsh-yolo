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
| `settings/` | `contracts/config` 设置模型和卡片 |
| `design/` | Mono tokens、icons、style |

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

## 测试

- `tests/panel-controllers.test.ts` 覆盖 dashboard signature、notification routing 和 controller 纯行为。
- 原 panel/navigation/filter/chat/settings 测试继续覆盖兼容行为。
- 修改任何 controller、client contract 或 layout 后运行 `pnpm check`、`pnpm test:run`、`pnpm build`、受影响 UI E2E 与 W1–W16；controller 单测不能替代真实 Edge。

## 当前限制

- shell 和 KanbanView 已明显缩小，但仍不是完全按每个产品页面物理拆分；未来拆分必须以 use-case owner 和可验证收益为依据。
- `panel/v2` 尚未重命名；它不表示有两份服务器 current state。
- Agent task 页面未实现，客户端没有隐藏的 Agent task controller 或路由。
