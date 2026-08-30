# 事项身份 shadow gold corpus

`todo-resolver-labeled-cases.jsonl` 是人工构造并复核的中文 shadow-style gold corpus，长期用于事项身份 resolver 的离线评估与回归。它不是从真实生产日志复制或脱敏得到的数据，也不能作为线上准确率证据。

每行遵循 `scripts/todo-resolver-eval.mjs` 的 JSONL 输入格式：

- `sample_id`：稳定、可读的样本 ID；已有 ID 不因排序调整而变化。
- `stratum`：主分层，固定为 `paraphrase`、`pronoun`、`ellipsis`、`cross_session`、`same_name_distinct`、`terminal`、`step` 之一。
- `tags`：一个样本可同时覆盖的风险点，例如多候选、同标题不同客户、否定纠正、重开或新 occurrence。
- `input_excerpt`：不超过 shadow log 上限的真实中文工作或生活表达。
- `candidates`：resolver 当时可见的有界候选事实，只使用稳定 ID、标题、业务状态、截止时间和历史别名。
- `prediction`：保留为 `null`；执行具体模型观测时写入临时副本，不覆盖 gold 文件。没有 prediction 的
  corpus 只能验证 gold 数据契约，不能产生准确率、false-link 或 missed-link 指标，更不能据此授权开启运行时写入。
- `expected`：人工标签，只包含预期 decision 与候选目标。
- `provenance.kind`：固定为 `handcrafted_shadow_style`，防止与 `export` 导出的真实本机 shadow log 混淆。

维护约束：

1. 新增样本必须使用自然场景语言，不写“测试任务”“E2E 夹具”等自指措辞。
2. 候选必须足以支持 gold 判断，但每条最多 4 个；信息不足时标签应为 `ASK`，不能凭标题相似度猜测。
3. `CREATE` 不指向现有候选；终态项只有明确纠正才 `REOPEN`，明确“再次/下一轮”才 `NEW_OCCURRENCE`。
4. 同一条 JSONL 可添加 tags，但主分层只能有一个，以保证 evaluator 的分层统计口径稳定。
5. 修改后运行 `pnpm exec vitest run tests/todo-resolver-eval.test.ts`；需要评估模型输出时，复制 corpus、写入 `prediction` 后再运行 `node scripts/todo-resolver-eval.mjs evaluate <副本>`。

## 使用宿主配置回放

仓库提供一条默认休眠的宿主内回放路径。它复用 dsh `web` profile 已配置的 provider、模型和凭据，
不会读取或复制 API key 到输出，也不会开放评估 HTTP 端点。先构建并确认当前 checkout 已通过
`dsh plugin --profile web add .` 链接，然后运行：

```powershell
pnpm build
pnpm eval:todo-resolver -- tests/fixtures/todo-resolver-labeled-cases.jsonl output/todo-resolver-predictions.jsonl --report output/todo-resolver-report.json
```

runner 会在临时空工作区和随机端口启动官方 `dsh web`，由 `yolo-extract` 内部使用 `ctx.llm` 顺序回放，
完成后停止自己启动的宿主并删除临时工作区。gold 的统一语义时钟固定为
`2026-08-30T09:00:00+08:00`，可用 `--as-of` 显式覆盖；输入永不原地改写，已存在的输出也会拒绝覆盖。
生成副本只保留解析后的 prediction、provider/model/resolver 版本、finish 和 token usage，不保存原始模型文本。

报告始终包含 7 个分层、置信度分桶和 R2a engineering gate。增加 `--require-gate` 时，门禁不通过会以
退出码 2 结束。门禁要求 prediction 完整且来自单一路由、每层至少 6 条、0.98 自动候选中的 false-link 为 0、总体 exact
不低于 0.8、missed-link 不高于 0.15、0.98 高置信自动候选无误授权且覆盖至少一半安全 LINK/UPDATE。
这仍是工程回归门，不单独构成默认开启 R2a 的授权；还必须有独立的隔离真实对话留出集。

## 隔离真实宿主 observation

`todo-resolver-observed-cases.jsonl` 另存从一次隔离真实 dsh 宿主导出的、经人工标注和脱敏的
shadow observation。它保留实际 resolver/provider/model、prediction、R2a application receipt 与 gold，
但删除真实 scope、session、fingerprint 和随机 todo id。当前只有同一改期场景的两个样本，只能证明导出、
标注、门槛阻断/授权和审计链路可运行，不能代表总体或各分层线上准确率，也不能单独授权默认开启 R2a。

这两条真实 turn 中，主 Agent 都先通过统一 `yolo_action/postpone` 修改 authoritative todo，后台 resolver
再消费工具前 candidate snapshot。因此 0.98 样本的 `authorized/no_change` 是预期幂等结果：当前值已经是
9 月 6 日，R2a 再按稳定 ID 执行同一 due update 时由领域 no-op 阻止重复事件，同时补充真人 evidence；
它不表示用户改期未执行。`application_context` 明确记录 candidate snapshot、策略执行前的 authoritative
due、先行写入来源和预期 receipt，避免把 resolver 指标与 application 成功混为一谈。
