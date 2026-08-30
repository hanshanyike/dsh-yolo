# `src/domain/`：领域内核

## 职责与边界

`domain` 定义存储和 adapter 无关的稳定身份、scope 与领域数据类型。它不依赖 Cordis、dsh、SQLite、HTTP、React、application 或 client。

## 文件

| 文件 | 职责 |
|---|---|
| `scope.ts` | `ScopeRef`、cwd 规范化、workspace identity、兼容 scope key |
| `types.ts` | todo、goal、milestone、notification、event、evidence、日志等领域类型 |

## ScopeRef

`ScopeRef` 只有 workspace 与 user 两种：

- workspace 使用 catalog 分配的 opaque `WorkspaceId`；调用方不得把 cwd 或 scope key 当成 WorkspaceId。
- user 指向明确的 user store，不允许隐式跨所有 workspace 扇出写入。
- cwd、Windows 盘符大小写和目录分隔符只在边界规范化；workspace 的稳定身份由 catalog 与 store marker 共同证明。
- 既有 `scope_key` 与 legacy global store 是 infrastructure compatibility，不是新的领域 scope variant。

## 迁移兼容

`src/storage/scope.ts` 与 `src/storage/types.ts` 继续 re-export domain API，保证旧 import path 和 package consumers 可工作。新代码应直接依赖 `src/domain/*`。

## 不变量

- 同一 cwd 的等价拼写得到相同 filesystem identity。
- WorkspaceId 在 relocate 后保持不变。
- domain 类型不能 import repository、DB handle 或 dsh session object。
- 未实现的 Agent task 领域模型不在当前 module 中虚构。
