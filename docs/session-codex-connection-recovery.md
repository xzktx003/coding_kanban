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

## 2026-10-26补充：历史读取取消与队列拥塞

会话模式 `REF_xh3_accu` 显示“无法加载消息”。现场请求直接返回 `429 CHAT_HISTORY_BUSY`；单独读取其最近 10 轮成功，输出 1,206,139 bytes／512 项、用时 6.191 秒，历史没有据此丢失。前端 recent 截止只有 5 秒，后台却是单 reader 加 16 个排队项、120 秒总等待期限，客户端会提前超时并触发已有恢复重试。

真实 Vite HTTP/2 HTTPS 回归进一步复现：POST 请求体已发送完毕后取消 HTTP/2 stream，后台连接仍存活；同场 HTTP/1 用例正常。HTTP/2 取消事件之后还会出现 response `finish`，不能仅依赖随后 `close` 时的 `writableFinished`。开发代理现同时观察 request `aborted` 和 response `close`，正常 finish 后清理监听；严格限定 POST 聊天 `turns/list?view=chat` 与显式 `item-detail`，不将此行为扩展到发送／审批等写请求。原有 Host、Origin、HTTPS 转发和 WebSocket 设置保持。

队列原先用不可移除的 Promise 链；16 个等待者取消后仍占据名额，下一条请求直接 429。现改为可移除的有界 FIFO：取消排队项立即拒绝并清理引用，不启动原生进程；活跃项仍等待 `reading.finished`，确认自有进程退出才开始下一项。关闭网关取消全部自有读请求；无 Agent resume、acquire、interrupt 或重启。上限仍为一个 reader 加 16 个排队请求。

前端 recent 截止改为 125 秒，覆盖后台既有 120 秒期限和最多两次各 2 秒的进程清理；普通完整历史保留 15 秒，用户取消仍立即生效。客户端并发、分页游标、请求页大小、16 MiB 投影、32 MiB 共享 RPC、工具正文裁剪和正文空闲回收均未放宽，没有增加历史轮询。

验证：HTTP/2 取消、取消队列释放准入、6.2 秒有效读取分别先红后绿；真实 HTTP/1/HTTP2 及写请求排除 3 项、前端读取／同步 54 项、原生读取／取消／背压 16 项、网关相关 17 项、开发代理配置 9 项通过，`pnpm check` 通过。约定的八组浏览器保护共 27 项通过、1 项长测默认跳过，覆盖原生 SSE 大正文裁剪、自动休眠与恢复、缺失完成回复、审批/流式状态恢复和正文预算；这不代表长期 renderer RSS 红灯已解决。

证据及日志位于忽略目录 `.dev-runtime/history-load-fix-20261026/`；前端入口保持 **HTTPS https://10.30.0.24:8484，端口 8484**。网关加载更新的独立只读库，原 Session 运行层 PID 2712539 保留。

正式浏览器通过真实接口打开 `REF_xh3_accu`，1600×1000 桌面及 393×852 手机尺寸均显示历史最终回复和待回答问题，没有“无法加载消息”提示或横向溢出；目标及同批历史接口全部 200、页面异常 0、任务写入请求 0。截图为该目录 `desktop.png`／`mobile.png`，结果 `browser-result.json`。初次浏览器探测碰到测试证书策略切换导致的 `ERR_CERT_VERIFIER_CHANGED`，另一次通过动态导入 store 检查就绪的探测超时但实际正文已显示；这两次不计通过。最终探测仅核对真实 DOM／网络，使用固定本机证书公钥白名单，保留失败日志，没有修改站点证书或放宽产品安全设置。

再次现场复验的材料位于 `.dev-runtime/history-load-recheck-20261027/`：同一正式地址的目标会话在两种尺寸均显示回复及问题，5 条历史读取全部 200，页面异常和任务写入均为 0。首次冷启动测试浏览器再次遇到 `ERR_CERT_VERIFIER_CHANGED`，不计通过；浏览器完成同源初始化后重新导航的独立检查通过，未改站点证书、产品代码或服务。`pnpm codex:status` 同时确认已切换宿主、网关及 broker 可用，不据此代替模型对话验收。

本次截图问题收尾复验材料位于 `.dev-runtime/history-load-current-20261027/`：正式 HTTPS 入口的 `REF_xh3_accu` 在 1600×1000 和 393×852 均显示历史回复及待回答问题，5 条历史请求全部 200，加载错误提示、页面异常、任务写入请求和横向溢出均为零。当前源码专项回归 46 项通过（历史服务 33、代理配置 9、取消队列 1、真实 HTTP/1 与 HTTP/2 代理 3）。首次前端测试误用默认 Vitest 配置并混入 Node 测试，失败日志保留；分别使用仓库 Session 配置和 `tsx --test` 后通过，未为此修改产品代码。原 Session 运行层 PID 2712539 保留，未以重启 Agent 完成验收。

联合改造后的最终正式复验保存在 `.dev-runtime/history-load-final-20261027/`：仍使用上述 LAN HTTPS 地址，两种尺寸均显示目标会话的最终回复及待回答问题，5 条历史请求全部 200，加载错误提示、pageerror、任务写入和横向溢出均为零。原始日志保留初始化时的一条资源 404 及页面切换取消的请求，不把这些记录描述为“所有网络请求无异常”。当前会话全量单测 548 文件／3303 项及 `pnpm check` 通过；前端监听 `0.0.0.0:8484`，独立 Session 运行层 PID 2712539 继续保留。


第三批UI改造后的正式只读复验见 `.dev-runtime/session-real-read-r3-20261027/`：REF_xh3_accu在1600×1000及393×852均显示历史回复和待回答问题，6条历史请求全部200，加载错误提示、pageerror、任务写入及横向溢出为零。日志保留资源404及页面取消请求。最终553文件3348项会话单测、构建通过，3270输入前后未变；原Session运行层PID2712539保持。


第四批设置/账号范围修复后的最终正式复验位于 `.dev-runtime/session-real-read-scope-contract-20261027/`：上述LAN HTTPS入口的目标会话在1600×1000及393×852均显示回复和待回答问题，9条历史请求200，pageerror/任务写入/加载提示/溢出均为零。一次内部scope取消信号泄漏为未处理异常的失败记录保留在 `session-real-read-r4-20261027/`；修复消费者独立处理契约后复验通过，不能覆盖失败日志或删除异常断言。原Session进程PID2712539未替换，完整联合结果见[第四批](designs/session-render-alignment/session-parity-batch-r4-20261027.md)。

截图问题再次核对（2026-10-27）：`.dev-runtime/history-screenshot-recheck-20261027-080557/` 保存当前正式 LAN 页面复验。1600×1000 和 393×852 均显示目标回复及待回答问题，9 条历史请求全部 200，加载提示、页面异常、任务写入和横向溢出均为零。当前源码专项 47 项通过（历史服务 34、代理配置 9、取消队列 1、HTTP/1 与 HTTP/2 代理 3）；代理配置首次误用 Vitest 的运行器失败日志保留，改用其 Node test 运行器后通过。浏览器保留导航取消请求日志，未重启 Session 运行层 PID 2712539；Codex 状态同时确认宿主、网关和 broker 可用。


## 2026-10-27：完整历史不再占用共享 Agent 管道

旧版 legacy `thread/read` 正文走共享 stdio；单帧超过 32 MiB 时旧实现会结束整个 app-server，可能连带中断同一进程上的其它执行轮次。页面刷新或队列核对若触发这种超限读取，就会走到这条危险路径。现场确有 `turn_aborted(reason=interrupted)` 且未见对应的 `turn/interrupt`，但日志没有把具体超限回包与两次中断逐一关联，因此不能断言每次都由它造成。

`CodexService.readHistory` 仍先用共享连接读取不含正文的元数据。分页历史保持原协议；legacy 正文改由 `readLegacyHistory` 启动独立只读进程解析。字符串按 parser chunk 累加，并在单值超过预算时立即中止，避免先构造超限正文；超过既有历史预算时只拒绝这一次读取，不调用 interrupt，也不替换共享 Agent 进程。

初次实现完成时，正式运行层仍为旧构建；之后用户明确授权服务重启，`pnpm dev:restart` 已激活当前构建。重启后只读复验 `REF_xh3_accu` 返回 200，历史为 paginated，100 turns／2,915 items，响应 11,611,853 bytes，末轮 completed。此复验不扩大 16 MiB 聊天页、32 MiB RPC 与历史预算，也不表示任意超预算 legacy 正文可显示。

## 2026-10-27截图复验与链接刷新修复

当前现场的消息读取修复仍有效：正式 HTTPS LAN 入口 `https://10.30.0.24:8484`，目标 `REF_xh3_accu` 在1600×1000和393×852均显示历史回复及待回答问题，未出现加载错误提示。原有前端recent有界期限、HTTP/2取消传播、可移除FIFO和16 MiB聊天投影／32 MiB RPC预算保持。

本次额外执行真实刷新发现独立缺陷：旧式 `?mode=session&agent=codex&thread=…&cwd=…` 入口消费导航参数时，会把全部query删除；无保存模式的新浏览器刷新后回到终端。旧实现的真实浏览器失败及两个永久单测红灯保存在 `.dev-runtime/history-screenshot-live-20261027-095347/`。这不是历史内容丢失，也不能把终端页面的控制台告警归为历史接口错误。

`useUrlParamThread` 现在只清除确实消费的 `addProject` 和有效agent导航参数，保留工作模式、无关参数（含重复值）、hash及已有history state；纯项目链接不会顺带清除未消费的agent/cwd。Codex与Claude入口、disabled到enabled以及重复渲染不重复导航均有断言。目标选择、发送、writer权限和历史裁剪不变。

修复后的正式证据为上述目录的 `accepted/browser-result.json`、`desktop.png`、`mobile.png`、`mobile-refreshed.png`：桌面、手机与手机刷新均显示目标回复和问题，6条已完成历史请求全部200，加载提示／pageerror／任务写入／横向溢出均为零。原始日志保留刷新卸载时取消的请求，不声称全部网络无异常。独立夹具的永久浏览器测试 `tests/e2e/session-launcher-link-refresh.spec.ts` 在1600px及393px均通过，API与WebSocket全部隔离；不向正式任务提交测试输入。

最小回归包括历史服务34项、代理配置9项、取消队列1项、真实HTTP/1与HTTP/2代理3项，以及URL导航／标签恢复／会话链接相关单测；前端类型检查通过。Session运行层PID2712539保持，未重启Agent。本次没有重跑30分钟RSS关卡，也不改变其既有红灯结论。

## 2026-10-29 只读最近页调度

浏览器recent/history/status总准入仍为3/2/1。原生聊天reader串行，因此recent只准入一个后台传输，保留另外两个既有槽给重叠的旧/新前台读取；前端排队支持同键提升。网关读取自有HTTP头`x-session-read-priority`，只接受`interactive`／`background`，缺省interactive兼容旧调用，非法值400；该字段不加入native RPC。每连续三次前台准入后，等待中的后台获得一次准入，17项总排队上限、120秒期限和原进程退出清理保持。已开始的读取不会因另一个消费者切换而停止Agent。

每个共享历史消费者单独取消，最后一个取消才撤销自有传输并立即移除去重身份；账号/运行scope的原始失败由每个消费者按自己的UI/调度需求结算，不能由首个消费者吞掉。`sessionPreloadState`仅记关注目标phase和revision，不持有正文；回收后标记reclaimed且不重新填入。所有正文、最终回复、审批及未读仍走原来的独立生命周期。真实HTTP网关、原生EventSource和私有假native验收见[实施记录](designs/session-mode-user-experience-acceptance-20261029.md)。

Claude的history通道也只允许一个后台传输，保留另一个原有槽给显式读取；共享取消和排队提升复用同一消费者机制。SDK必要的5秒活动/30秒空闲只读完整恢复仍保留，不假称已有原生增量分页。

连接提示分开记录health、关注列表、项目列表和实时消息。无待提交修改的读取失败保持紧凑，权限/本机保存/接收暂停仍明确可处理；重试保持原操作身份，不改变未知发送回执。同步详情可显式下载固定连接元数据以排查现场，省略正文、草稿、账号、URL和凭证。浏览器断线或接收暂停只说明连接状态，任务状态须恢复后只读核对。
