# Codex 连接与大历史恢复（2026-10-26）

现场所有项目显示“会话加载失败”，`thread/list` 返回 500 `NOT_SENT: RPC transport unavailable`，但运行层 `/health` 仍为正常。实际失效的是其原生 stdio 连接。原生旧历史页约 59 MB，超过共享传输的 32 MiB 帧限制；退出后已完成的 `starting` Promise 长期留存，使后续列表、模型和历史读取继续使用死连接。

## 连接生命周期

`CodexService` 的退出回调仅处理当前精确 transport，清理初始化缓存、sweep 和待审批身份；旧 transport 的请求、通知和退出回调不能影响替代连接。环境发现或初始化失败也清理对应 Promise，迟到旧失败不能清除新尝试。八个并发后续请求只建立一次连接。

失败的原请求直接返回；未知发送回执不重发。重连不接管历史 writer，不自动停止仍存活的旧任务进程；服务持有自有 transport 至进程退出，显式关闭服务时才统一释放。原有 32 MiB 帧预算不变。

现场先确认旧 native 已退出、无挂起请求，才对该唯一旧服务实例的 `ready` 方法应用已验证的恢复逻辑。检查 PID/start ticks 和实例身份；原方法留在该实例中供追溯，临时 loopback 诊断监听已关闭。常驻运行层、两个既有终端和独立 Codex 宿主没有重启。完整源代码的旧事件隔离等改动随下一次安全启动生效，本次不声称整个常驻旧模块已替换。

## 显式聊天历史的独立读取

默认网关构建的只读库增加 `thread/turns/list?view=chat`：

- 从与会话服务一致的 provider 配置解析环境，只允许固定 `initialize`、`initialized`、`thread/turns/list`；HTTP 只接受受限 threadId、cursor、limit、排序和 itemsView，不能指定可执行文件、路径或 RPC 方法。
- 一个独立聊天 reader，最多十六个有界排队请求；命令详情仍保留自己的原有单槽。取消、网关关闭和超时只释放自有 reader，不调用共享 Agent 的 resume、acquire、interrupt 或停止接口。
- 复用既有 4096-byte 输入块、16-token 解析队列、64 KiB 输出队列、128 层深度及 10/15/120 秒初始化／空闲／总时限。排队总等待另有 120 秒上限。
- command 输出、reasoning 正文和 MCP 结果正文在接收时丢弃，MCP 授权元数据仍保留。工具项随完成即复用公共聊天投影，密集工具以已投影字节存储，避免同时留存整页的完整对象结构。最终仍使用公共投影，保留用户／助手消息、工具身份与状态、子 Agent 目标、Hook 规则和分页游标。
- 每页缓冲及最终 JSON 各有 16 MiB 限制；过大可见消息返回明确 413，协议身份／重复键／截断返回错误，不默默丢消息或扩大预算。没有增加完整历史轮询。请求分页大小及原生游标保持，不自行生成或切割游标。
- 完整／原始历史请求沿用既有运行层协议。自定义部署缺少本地库时保留旧接口与支持状态，不重启旧运行层来补齐功能；此类旧部署不具备独立聊天读取保护。

实现：`packages/session-runtime/src/codex/{client,chat-history,chat-history-channel,item-detail}.ts`，网关接线位于 `apps/server/src/routes/session-mode.ts`。这条路径不改变聊天正文休眠、缓存、审批或序号恢复策略。

## 验证与边界

红灯：原连接实现四项恢复用例失败；旧回调兼容场景的八个并发请求曾启动八个进程；真实浏览器打开问题历史页复现 502／32 MiB 错误。新增独立聊天入口用例在实现前失败。

绿灯包括退出／初始化／环境失败、未知发送不重发、并发合并、旧回调隔离，40 MiB 工具输出及 12,000 条密集工具项；用户消息、最终回答、子 Agent 目标和原生游标保持。密集夹具实际输入 54,052,568 bytes，输出 12,649,584 bytes，输入块 ≤4096、解析队列 ≤16、输出队列 ≤65536，慢消费者背压及自有进程退出均核对。错误 RPC ID、重复键、截断及超大可见消息均明确失败。

最终检查：运行层 361 项、网关相关 21 项全部通过；运行层／后端／前端类型检查及后端生产构建通过。

现场独立原生读取实际输入 59,027,669 bytes，投影输出 13,555,717 bytes，自有 reader 已退出。9 个项目列表及每项目一条近期历史均成功；真实浏览器经局域网 `https://10.30.0.24:8484` 验证九项目、历史、刷新和 390px 项目抽屉，无 pageerror、5xx 或任务写入请求。地址来自本机配置，不写入源码。

最小回归命令：

```sh
pnpm --filter @agent-orchestrator/session-runtime test
pnpm --filter server build
pnpm --filter server exec tsx --test src/routes/session-chat-history.test.ts src/routes/session-mode.test.ts src/routes/session-item-detail-local.test.ts
pnpm --filter web exec tsc -p tsconfig.json --noEmit
PLAYWRIGHT_SKIP_WEBSERVER=1 PLAYWRIGHT_BASE_URL=<已运行的LAN地址> pnpm exec playwright test tests/e2e/session-idle-memory.spec.ts tests/e2e/session-network-memory.spec.mts
```

正文自动回收／只读恢复与真实 HTTP/EventSource 裁剪三项通过；三十分钟长测默认跳过，不能计为通过，本次不关闭既有长期 renderer RSS 红灯。现场只读检查和临时诊断材料位于忽略目录 `.dev-runtime/codex-reconnect-20261026/`，不包含提交凭证。
