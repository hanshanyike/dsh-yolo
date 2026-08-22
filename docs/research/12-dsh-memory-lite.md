# dsh-memory-lite 分析报告

> 他山之石调研 · 最值得深入研究仓库之一（dsh 生态）
> 一句话：**极简半自动「文件即真相」长期记忆——JSON 文件即真相 + 字节预算贪心注入 + 会话开始注入去重 + 原子写，无向量、无提醒、无看板，但单点工程细节质量极高。**

## 元信息

| 项 | 值 |
|---|---|
| 仓库 | [yangyongzhen/dsh-memory](https://github.com/yangyongzhen/dsh-memory)（npm 包 `dsh-memory`，本地克隆目录 dsh-memory-lite-r） |
| 主语言 | TypeScript（NodeNext，编译到 lib/，约 1200 行源码） |
| 许可证 | MIT |
| 当前版本 | v0.1.0（**非常早期**：仅 2 条 commit，无 tag，无 CI） |
| 维护状态 | 极简半自动长期记忆插件；功能稳定但工程迭代停滞 |
| 定位 | JSON 文件即真相：把跨会话需记住的内容（四类型 × 两作用域）持久化为人类可读 JSON，每个新会话第一步以字节预算注入，不做任何主动能力 |

## 定位与主张

极简推荐：`global.json` + `projects/<slug>.json`，人类可读可手改（风格「和 dsh-session-report 一致」）。`<system-reminder>` 注入到第一次请求。**半自动**：写入由 Agent 判断（工具提示「写入前先用 memory_search 检查是否已有同义记忆，避免重复」），不做全自动 LLM 摘要（明说「那需要额外 LLM 调用」）。

## 核心架构与运作原理

**存储层（src/store.ts）**：`<root>/global.json` + `<root>/projects/<slug>.json`，每文件 `{version:1, entries:[]}`。四类型 preference/fact/summary/knowledge，两作用域 global/project。project slug 从会话 `header.cwd` 取末两段拼接（去掉盘符，非法字符替换 `_`），注明「collision acceptable」。**原子写** `writeFileSync(tmp) → renameSync(tmp,path)` 崩溃不撕裂。**mtime 缓存 + 外部协调**：每次读先 `statSync` 比对 mtime，变了才重读——并发外部编辑（另一 dsh 进程）在下一次读取被吸收。**损坏降级**：解析失败/版本不符 → 保留「最后一次好快照」而非清空，绝不崩溃。`put` 传 id 则原地改，否则 `randomUUID` 新条。

**检索层（store.search 内置）**：多 scope（未指定时 global + 当前项目）→ type 过滤 → tags 交集 → content+tags 拼串做**不区分大小写子串包含**（多词须全部命中）；排序 important 优先再 updatedAt 降序。**纯字符串匹配，无语义/向量**。

**渲染层（src/render.ts）— 贪心字节预算（核心亮点）**：
- 块顺序 `[preference,fact,summary,knowledge]`，同类内 important 优先再时间。
- 每条渲染 `- [type [重要度 N]] content 标签: ...`；content 压缩空白后按 `maxEntryBytes` **截断 + 省略号**（`truncateTo` 用二分找不超预算最大前缀，**回退避免切开代理对**，中文按 utf8 多字节算）。
- 整体硬预算 `maxBytes`：外壳（preamble+epilogue）超预算直接返回空串（预算连外壳都塞不下→不注入）。
- **贪心逐行**：逐块累加 used 字节，放不下就 **skip 该条而不是丢整个 section**；配「孤儿 header 守护」——header 只有在其后至少一条 entry 能放进时才 emit。

**注入层（src/index.ts）— agent/pre-step 水瀑布**：`agent/pre-step` 判定 `enter && step===1` 时注入；**resume 防重** `alreadyInjected` 扫 session surface 找 `user/message` 且 `source.kind==='plugin' && source.plugin==='memory'` 者即判定已注入——step>1 或续会话都不重复。注入内容寻址 FNV-1a `digest` 随 `createUserMessage({source:{kind:'plugin',plugin:'memory',form:'recall',digest}})` 写入。四个工具 memory_write/read/search/delete。

## 关键亮点（带证据）

1. **字节预算贪心打包 + 跳单条不丢 section**：header 与 entry 拆独立 block 计字节，放不下就 skip 该条继续装后面的，配孤儿 header 守护——「宁可少注入也不撑爆上下文」的直接实现【src/render.ts】。
2. **代理对感知 UTF-8 截断**：`truncateTo` 二分 + 绝不切开 surrogate pair【src/render.ts】。
3. **mtime 缓存 + 并发外部协调**：跨进程写同一 unit 也能被下次读取吸收【src/store.ts + store.test.mjs】。
4. **损坏文件优雅降级**：解析失败保留最后好快照 / 空 unit，拒不崩溃【src/store.ts】。
5. **resume 安全 + 内容寻址去重**：`alreadyInjected` 扫 surface + digest，一次会话只注入一次【src/index.ts】。
6. **config 默认归一化防空指针**：`Config(rawConfig)` + all-default schema——正是 dsh-yolo AGENTS.md 强调的 `Config(config ?? {})` 同款事故预防【src/index.ts】。

## 与「个人 AI 助手（记忆+提醒+看板）」的契合度与差距

**契合（MVP 参考价值最高）**：存储/注入/原子写三件套与 dsh-yolo「长期记忆」维度完全同构；零外部服务依赖，测试齐，极宜作为基线参考；「半自动」哲学符合「绝不打扰工作会话」。

**明确不在能力范围**：无向量/语义检索（纯子串包含）；无提醒/调度器（`ctx.effect` 空实现）；无看板/待办/状态机/审计；无抽取管线（写入全凭 Agent 判断，无 LLM 语义抽取/去重/节流）；无 UI/React。

## 明显的不足 / 局限

1. **无向量语义检索**：纯子串包含、多词逐词命中，同义改写/语序变化/中文分词差异会漏检。
2. **无 release 工程化**：0.1.0、零 tag、零分支策略、无 changelog、`lib` 产物直接提交、无 CI。
3. **provenance/审计缺失**：无操作审计日志、无 undo 恢复——对「看板状态机+审计」无法复用其路径。
4. **写入缺去重/冲突收敛**：仅「建议先 search」软约束，Agent 不遵守会累积语义重复；无摘要收敛、无重要性老化淘汰。
5. **project scope 强依赖 cwd + 写侧并发碰撞**：无 cwd 抛错；多进程共享磁盘根时写侧 `writeUnit` 后写覆盖先写（非耦合式合并），读侧靠 mtime 协调。
6. **火星字段/低价值实现**：`digest` 是内容寻址但 `alreadyInjected` 实际不比对内容（按 plugin 标记判重）；`sortNewest/listAll/clear` 部分未暴露到工具。

## 对 dsh-yolo 的具体借鉴点

1. **文件即真相 + 原子写（tmp+rename）+「损坏留最后好快照」+ mtime 跨进程协调**——直接移植到持久化层【src/store.ts】。
2. **字节预算贪心打包 + 孤儿 header 守护 + 代理对感知截断**——复用于把记忆/看板摘要注入上下文的预算控制【src/render.ts】。
3. **会话开始注入 + digest 去重 + resume 免疫**：`agent/pre-step`（仅 step1）+ `alreadyInjected` 扫 surface + `source.plugin` 标记——「一次会话只注入一次、续会话不重复」的干净范式，dsh-yolo 提醒/记忆注入可照搬【src/index.ts】。
4. **config 默认归一化防空指针**：印证 AGENTS.md「apply 里必须 `Config(config ?? {})`」规则【src/index.ts】。
5. **检索的 tags 交集/多词全命中过滤**——可作 dsh-yolo 未来语义检索的「结构化光圈」基础【src/store.ts】。

## 一句话结论

一个**无向量、无提醒、无看板、仅 0.1.0 的极简「文件即真相」长期记忆插件，整体工程价值有限但单点质量极高**——字节预算注入的贪心渲染、原子写 + mtime 跨进程协调、会话开始注入去重是 dsh-yolo 可直接复用的「他山之石」；但检索仅子串匹配且无调度/审计，正好反衬出 dsh-yolo「LLM 语义抽取 + 提醒调度 + 看板状态机 + 审计」的差异化空白。

---
*资料来源：仓库 src/store.ts、src/render.ts、src/index.ts、test/store.test.mjs、test/smoke.test.mjs、README.md、package.json（源码级分析）。*