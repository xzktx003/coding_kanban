# 旧运行层的 Claude / ACP 只读历史兼容

本适配解决已运行会话服务不认识 `view=recent` 时，前端近期历史无法使用的问题。它复用运行包的文件型历史读取和分页投影，通过独立库供网关加载；不创建会话运行服务，不连接 Agent 或默认 IPC，不调用 query、connect、load、resume 或发送消息。原 raw 历史接口继续走原代理。

## 固定来源与导出

运行包新增 `@agent-orchestrator/session-runtime/auxiliary-history` 导出，包含 `createAuxiliaryHistoryReader`、可选固定路由包装 `registerLocalAuxiliaryHistoryChannel`，以及既有图片/详情参数和图片响应头辅助函数。

factory 的 `dataHome`、`cacheHome`、`sourceScope`、`nativeEnv` 与必需的 `verifySource(signal)` 全部由服务端固定。调用方须将它们绑定到已核实的运行记录、实际运行进程和原生文件环境，不能假定网关的 `process.env` 与原进程相同。每次源访问前及结果发布前都执行来源核对；撤销或取消后不发布结果。

可选 `resolveClaudeSession(ownerId, signal)` 只接服务端核对的已有原生身份元数据；不可用时仅只读解析原运行目录中已有的 alias 映射，再以对应原生 JSONL 的文件存在证据确认目标。`claudeIdentityRoot` 保留原运行环境中的历史根字符串，匹配已有映射的 hash namespace；它不改变实际文件读取根。未知 alias 明确返回身份不可核实，不以空页冒充成功。读取前后重新核对同一映射，变化时拒绝结果；对外的 `session_id` 与 cursor 始终绑定原请求 owner。旧运行层从未持久保存的内部 alias 不会被本适配猜测或创建。

HTTP 只接受精确会话、cursor、limit、metadataOnly 和显式详情/图片选择参数，不接受路径、HOME、环境或运行实例替换参数。可选包装器只注册两组固定 provider 路径；没有 `view` 的 raw 请求调用既有 fallback。调用方也可直接使用 factory 接入已有代理分支。

## 两类来源

| 类型 | 只读源 | 自有派生数据 |
| --- | --- | --- |
| Claude | 固定原生环境下的 SDK 文件历史；仅允许 `listSessions` / `getSessionMessages` | 复用 `ClaudeHistory` 的 metadata fingerprint / SQLite cache，位置改为网关自有私有缓存 |
| ACP | 固定 `dataHome/.codexia/cache.db`；SQLite 使用 `readonly: true`、`fileMustExist: true`、query_only | `acpRecentHistory` 的增量投影写入独立私有 sidecar；原始 source ID、chunk/tool 合并、快照边界和 cursor 保持 |

不得为了读取 ACP 调用 `SessionDatabase` 构造器，也不得在正式源上调用建表/迁移。投影函数增加可选独立源连接，默认仍使用原来的同库行为，保持运行层已有调用兼容。只读 metadata 查询不解析消息 payload。sidecar 按固定 scope 和实际源文件身份命名，后续读取继续增量，不清空已有缓存。

缓存目录必须属于当前用户且不允许组/其他用户访问。创建前解析既有父目录的实际路径，拒绝与源目录交叠；已有缓存文件不得为符号链接或硬链接。新文件使用私有权限。Claude 自有 worker 不继承 NODE_OPTIONS、凭证或任意 provider/session-store 环境开关；取消和 deadline 仅终止本次创建的只读 worker，并等待退出。

来源核对保证调用方提供的运行/文件 scope 边界，不构成跨客户端账号 CAS，也不读取登录材料以推断额外权限。原生文件历史的授权范围沿用原来的本机文件读取语义；不能据此声称已验证 OAuth/组织策略或真实账号切换。

## 预算及验收

保留近期页 2 MiB、最多 256 行、详情 64 KiB 及原图片预算；不向浏览器回退完整 raw 历史。全部关注预加载、默认不可见正文约 60 秒回收、审批/状态/草稿和发送回执规则由既有消费者继续维护，独立读取库不改变这些规则。

专项入口：

```sh
pnpm --filter @agent-orchestrator/session-runtime exec tsx --test \
  src/auxiliary-history-reader.test.ts src/auxiliary-history-channel.test.ts \
  src/storage/recent-history.test.ts src/claude/recent-history.test.ts \
  src/claude/recent-native-files.test.ts src/claude/history-images.test.ts
```

测试使用全新私有 SQLite 与官方已安装 SDK 的合成 JSONL，不读取正式正文或登录。覆盖源文件字节/表不变、metadata 不解析非法 payload、sidecar 重建后继续增量、原始 cursor/source boundary、详情/图片、来源撤销、缓存重定向拒绝、取消自有 worker，以及 native alias 的公开 owner/cursor 和迟到映射拒绝。初版源分离、通道参数和 alias 红灯保留在私有 `.dev-runtime/session-ux-auxiliary-reader-20261030/`；最终合并测试数随主验收记录更新。

以上是独立库与隔离来源证据。网关实际来源锚、传输验证、浏览器错误/重试和完整合并版本验收由主流程另行记录，不据此声称正式 provider、实体设备或长期 RSS 已验收。

## 2026-10-30 整合范围复核

当前公开 hook 统一为 `resolveClaudeSession(ownerId, signal)`；返回值只能来自同一已核实 runtime 的只读元数据，不能接受浏览器 native ID 覆盖。已有合法持久 alias 也不得吞掉 live hook 的撤销/范围异常并降级文件读取；新增该反例及非法路径 alias 拒绝，和此前迟到映射变化一起通过。公共 owner/cursor 仍保持原请求身份，native 文件从已核实 SDK 历史根读取，不创建 Query。

整合复验：独立 reader 8 项、服务端源锚 14 项、HTTP/1 与 HTTPS/HTTP2 的 Vite 取消传递 17 项全部通过；运行层类型与 build、后端类型通过。Vite proxy 测试使用真实 ProxyOptions.configure 参数类型，没有用 any cast 绕过回调/范围约束。日志位于 `.dev-runtime/session-management-read-20261030/aux-{scope-runtime,scope-server,proxy-cancel,scope-types,build,server-types}.log`。CC live/durable 身份实现及其 12 项运行层和真实浏览器证据见 [Claude 刷新恢复](claude-live-recovery.md)。
