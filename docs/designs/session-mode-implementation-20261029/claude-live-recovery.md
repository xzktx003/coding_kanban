# Claude 会话刷新：只读恢复原运行连接

日期：2026-10-30。对应公共三类 Agent 的刷新、手机恢复、多个窗口及审批连续性。Codex 由官方共享 daemon 承载；Claude Query 仍由看板独立运行层持有，普通网关、浏览器刷新和关闭标签均不替换该 Query。自动更新保护另见 [运行层替换](runtime-replacement.md)。

## 身份与恢复

`activeSessionIds` 只表示浏览器曾经关注的会话，不能证明后端连接已经建立。`POST /api/cc/session-snapshot` 只检查已有内存 owner，返回实际 `runtimeInstance`、请求的 `sessionId`、真正事件目标 `eventSessionId`、已经观察到的 SDK `nativeSessionId`、cwd、running、connected 和待处理权限。首次发现允许省略 expected_runtime_instance；已有 owner 的后续读取以及发送、中断、权限模式更新携带捕获的运行实例和目录，变化时拒绝。未知 owner 为 404；不能调用 ensure/query、恢复或创建替代 Agent 来填补只读快照。

快照只投影模型、effort、权限模式和工具允许列表等白名单；不返回任意 settings、环境、插件配置或 MCP 凭据。`optionsKnown` 表示当前 owner 捕获的设置意图可完整恢复，不能把它宣称为 CLI 未公开的所有生效默认设置。快照限制 2 MiB，设置投影限制 128 KiB；元数据超限明确报错，原任务和请求继续保留。

关注会话复用既有 5/30 秒元数据检查和可见性调度，历史正文仍走独立的事件驱动、有界最近页。恢复只同步实际状态、权限身份与 canonical/native 别名，不改变当前选中项、项目或草稿。实时事件比请求中的快照更新时，迟到快照不得重新盖回 busy 或旧审批；相同快照不通知订阅者。服务换代取消旧检查，保留原 owner 身份并只读重验，拒绝未知范围的替代连接。

明确用户发送或恢复时，先读取实际 owner；存在则复用，即使其尚未启动 Query。只有 owner 明确 404 才按该次手势捕获的设置恢复历史。断网、旧运行实例、错误目录及未知响应不进入 resume 分支。审批回执按捕获 session/request/execution/runtime 更新，切换会话后不再按旧消息下标修改当前会话。

## 原生历史身份

新建随机 UUID 会话使用已安装官方 SDK 0.3.296 的 `Options.sessionId`，不与 resume/continue 混用，保持新会话的看板与 SDK UUID 一致。已有不同 UUID 的会话保留实际观察到的 logical/native 映射，事件继续按原逻辑目标发布；历史 raw、recent、detail、image 只读入口先解析这一身份。小型原子文件只存两种 ID，按实际 SDK 历史根目录的 SHA 命名空间保存，换运行实例后仍可恢复历史定位；不保存正文、登录或写入权限。写入失败在快照中保留明确恢复警告。映射不会因为其他 CLI 账号或历史根而自动改绑。

SDK 原生别名也必须受运行/删除保护：不能通过另一个 native ID 绕过已有活动轮次，创建第二个 Query 或删除仍运行的历史。删除期间阻止同 owner 的新发送，失败保留原连接。明确恢复已保存的 logical ID 时，将 resume 指向记录中的实际 SDK UUID。

## 巨型审批详情

待审批的 SDK hook 本身已持有原始 tool_input；恢复通道只在等待期间引用同一对象，不另外缓存巨型 JSON 副本。单项最多 8 MiB，所有待审批源合计 16 MiB；resolve、取消、轮次结束和连接关闭释放引用与预算。超过源预算仍保留 request、execution、tool 等精确身份，提供拒绝操作和明确 inputUnavailable 错误，不自动批准或停止。

至多 32 KiB 的完整参数可随元数据恢复。大项仅给出 truncated、inputAvailable、inputRevision 和身份；用户显式展开才调用 `POST /api/cc/permission-detail`。请求固定 session/request/expected_runtime_instance/current execution，并携带前一片修订；每片实际 JSON 响应不超过 64 KiB，UTF-8、JSON 转义和 surrogate pair 均纳入预算。参数变化或请求已经结束返回冲突，不能切到新请求或历史文件拼出一份看似完整的审批。

恢复的大项读取完整之前，批准按钮禁用，拒绝入口保持可用。前端详情总量最多 8 MiB，隐藏会话、隐藏页面、切换请求或结束审批时取消读取并释放完整参数。批准失败保留明确错误和重试/拒绝入口；不把截断预览当完整审批。

## 验收与实际边界

后端先复现缺少 snapshot、logical/native 历史映射两项红灯，再转绿。专项覆盖真实服务类原 Query 数量不变、设置白名单、跨实例/目录/session/turn 拒绝、Unicode 和转义分片、输入修订变化、单项及聚合预算、取消释放、alias 活动/删除保护、历史根隔离和原有 SSE/WS。前端覆盖恢复、无隐式 resume、真实 owner 检查、终止事件压过迟到快照、相同快照不通知、切会话后精确审批回写、参数读全后才批准和隐藏释放。

`tests/e2e/session-claude-readonly-recovery.spec.mts` 使用 production Claude service/routes、production 网关、原生 EventSource、production 恢复客户端与审批卡；SDK Query 是全新私有无登录受控 fixture。桌面 1440 和手机 393×852 两个独立 context 刷新待审批会话，完整读取 100 KiB 参数，拒绝后接收同一 Query 的终稿，再发送下一条。当前重复验证实际 LAN 为 HTTP `http://10.30.0.24:42847/`（监听 0.0.0.0，结束后关闭）；记录 Query=1、输入=2、resume=0、4 次详情请求、最大分片 65,406 bytes。

该页面明确 `fullWorkbenchCovered:false`；CSS 在行为 harness 中省略。它不代表实体手机、正式 Claude 登录账号、远端模型响应或完整工作台性能验收，也不声称 Claude 已接入 Codex daemon。正式账号/模型策略与 CLI 在线行为仍须单独核实。运行层显式关闭可结束其 Claude/ACP Agent；自动更新必须保护这些 owner。

日志和最新重复验证位于忽略目录 `.dev-runtime/session-management-read-20261030/cc-{snapshot-red,history-alias-red,snapshot-green,recovery-web,browser-final,types,web-types-current}.log`，浏览器量化结果位于 `cc-browser-final/**/claude-readonly-recovery.json`。

```sh
pnpm --filter @agent-orchestrator/session-runtime exec tsx --test \
  src/claude/service.test.ts src/claude/session-identity.test.ts \
  src/claude/recent-routes.test.ts src/claude/history-images.test.ts src/transport/server.test.ts
pnpm --filter web exec vitest run --config vitest.session.config.ts \
  src/session-mode/services/claudeConnectionRecovery.test.ts \
  src/session-mode/services/claudePermissionDetail.test.ts \
  src/session-mode/services/resolveClaudePermission.test.ts \
  src/session-mode/components/cc/session/messages/PermissionRequestCard.recovery.test.tsx
PLAYWRIGHT_SKIP_WEBSERVER=1 pnpm exec playwright test tests/e2e/session-claude-readonly-recovery.spec.mts
```
