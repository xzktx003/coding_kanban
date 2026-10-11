# Codex Slack 预览的数据与归属边界

原生依据为 `third_party/openai.chatgpt-26.51002.51308-linux-x64` 的 `state-5eb30f7a10ad F/k`、`e98 GD/WD/Fg` 和实验协议 `mcpServer/tool/call`。卡片尺寸、图标、键盘及动画的截图对照见 [特殊链接进度](designs/session-render-alignment/special-links-progress.md)。本功能只接入 Codex Slack 链接，不开放通用 MCP 工具调用或网页抓取。

## 请求与原生线程

| 接口 | 允许输入 | 返回 |
| --- | --- | --- |
| `POST /api/codex/mcp/slack-preview/context` | 受限 HTTPS Slack `href` | 可用连接的短期 token／不含账号明文的 identity，或 `context:null` |
| `POST /api/codex/mcp/slack-preview/read` | 同一解析目标的 `href`、contextToken | 同一 identity 与有界显示 data |

网页继续使用现有网关前缀 `/api/session`，以及既有设备认证／可配置后端地址；接口拒绝额外的 threadId、server、tool、arguments 等参数。运行层使用当前原生账号响应中的 `workspaceRouting.chatgptAccountId`、账号 email 与路由策略核对身份，不接受调用者提供的账号或连接。

只能从 `codex_apps` 目录选取唯一匹配的 Slack 工具。connectorId／connector_id、URI 中的 connector 与 target、action、非 synthetic 标记均需一致；多连接、错误字段或无工具回退不可用。资料 action 为 `slack_read_user_profile`，参数为 user_id+detailed；消息 action 为 `slack_read_thread`，使用 root threadTs，根消息 limit=1、回复 limit=100，要求 concise+structured。

运行层经 `CodexService.raw` 创建专用 `thread/start`，参数为 ephemeral=true、permissions=`:read-only`、threadSource=`mcp_extension_host`。它不经过 Agent 的执行权获取，不借用 Agent ID，不调用 turn/start、resume、interrupt 或历史回滚。原生返回的 `thread.source` 可以是 `vscode`；threadSource 是分析分类参数，不能据返回 source 字段猜测临时线程归属。所有注销只对本服务创建并记录的 ID 生效。

同一账号的并发读取复用同一临时线程；同一连接／目标的在途读取合并。账号改变时先退役自己的旧线程，等待其在途请求结束再 unsubscribe，其他 Agent 不受影响；自己线程关闭后下次读取重新创建，不重放已经发送的读取。真实账号和工具目录在调用前后复核，账号／连接改变的迟到结果不返回原文。

## 有界投影与恢复

完整工具结果只在运行层解析，网页仅接收匹配后的标题（≤200 字符）和描述（≤300 字符）。Codex Apps 的外层封装先按原生 Fg 解开，再核对用户 ID 或 channel／thread／具体 message。显示短字符串复制成独立字符串，避免 slice 保留大结果。context 与结果缓存分别有数量上限 128，真实在途读取上限 16；结果 stale 1 分钟、未使用时 gc 5 分钟，失败结果同样不立即重复读取。

前端实例仅保留一个链接的身份上下文，并复用既有共享 EventSource。账号、设备目标或权限身份变化使旧上下文失效；目录事件只读重核 context，不在连接未变时重读工具。此前不可用的连接出现时也能立即恢复，不等待负缓存期限。真正身份变化且卡片仍打开时按新身份读取；断连、恢复缺口和运行服务重启只使旧身份失效，不自动重读工具，保持原生 no-refetch-on-reconnect 边界。

隐藏会话模式、卸载、目标更换和自己的读取取消会解除订阅／计时器并丢弃迟到字段。UI 取消不转换为 Agent 中断。关注集合与输入目标不包含这些临时线程；其 start/closed 元数据保持既有事件序号和未知线程过滤规则，不删除公共审批或任务事件。本实现不修改聊天 SSE／历史的工具正文裁剪或不可见正文 60 秒回收。

## 验收与运行产物

- 最初缺失接口的 HTTP 红灯 `/tmp/codex-slack-rpc-red.log`；实现后的路线、白名单、并发、账号切换、目标校验和消息根／回复测试在运行层。
- 最终运行层全套 179 项通过 `/tmp/codex-slack-final-runtime-regression.log`，类型检查 `/tmp/codex-slack-final-runtime-typecheck.log`；前端呈现／引用／传输及事件流回归 40 文件、183 项通过 `/tmp/codex-slack-final-client-regression.log`。`pnpm check` 覆盖共享、运行层、网关与网页，最后前端构建 `/tmp/codex-slack-final-web-build.log`；`pnpm --filter @agent-orchestrator/session-runtime run audit` 核对原 208 个迁移契约，新两个预览接口由行为测试覆盖。
- `tests/e2e/session-codex-slack-http.spec.ts` 使用浏览器自身 fetch／EventSource，改写隔离端点到真实 HTTP 服务，运行正式路由与控制器。390／700px × 深浅主题四项通过 `/tmp/codex-slack-http-isolation.log`，含资料、具体回复、缓存复用、私有线程事件不新增标签、不改变输入目标，以及在途旧账号结果不能覆盖新账号。每次读取的 HTTP 响应保持小于 1000 字节；截图／传输 JSON 位于 `.dev-runtime/codex-slack-http-isolation/`。账号、目录和工具输出是隔离协议夹具，不能据此称远程 Slack 已验收。
- 未改动的原包 CLI 已实际接受只读临时线程与实验工具调用；仅对不存在的工具进行协议探测，不执行真实工具或 Agent turn，日志 `/tmp/codex-slack-native-host-probe.log`。当前实际账号目录有 8 个 MCP server，但没有唯一 Slack 资料工具，无法实测远程资料／消息读取。
- 原生账号／目录错误不把原始诊断内容返回浏览器：context 回退 null，读取连接重核失败仅给固定的身份变化错误。诊断保护红灯 `/tmp/codex-slack-diagnostic-red.log` 保留，最终运行层测试已包含；最后 700px 深色的 HTTP／账号切换保护复验见 `/tmp/codex-slack-http-final-guard.log`。
- 当前正式 HTTP 前端为 `http://10.30.0.24:8484`、绑定 `0.0.0.0`；正式运行服务的预览 context 仍返回 404。编译新产物不代表已替换运行服务。启用仍遵守 [启动流程](startup.md)和活跃 Agent 安全窗口，不为了预览隐式重启服务或停止 Agent。

完整 Codex 编辑器／对话框复刻目标仍进行中。本页证明源码与隔离数据通路，不关闭真实 Slack 连接、权限失败、GitHub／网站富预览及全量功能验收。
