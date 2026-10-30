# 会话意外中断与运行轮次释放保护

## 2026-10-27 现场与证据边界

手机截图对应的原生历史确有两次 `turn_aborted(reason=interrupted)`：北京时间 01:05:45 和 01:09:36，时长分别为 151207 ms 和 84089 ms。相应网关日志没有发现 `/followups/stop` 或 `/api/codex/turn/interrupt` 请求；用户确认没有主动停止，并反馈切后台、刷新时易出现。这能确认原生轮次中断及 UI 归因错误，不能仅凭页面重连记录证明这两次中断的完整触发链。原生日志的中断原因本身不包含操作者身份。

## 已复现并修复的释放缺口

`Ownership` 已记录 `turn/started`，但原有资源释放检查没有使用 `activeTurns`。在网关给出空队列且轻量元数据暂时为 idle 时，主会话或子 Agent 的未完成轮次仍可能通过释放检查，写出父会话的 `thread/unsubscribe`。回归用例先复现该写入，再要求修复后写入次数为零。

- 未完成轮次成为主会话、家族资源检查及实际写入 guard 的独立保留条件。较旧、稀疏、暂时 idle 的快照不能解除它。
- 只有该 thread 的精确 turn 完成或原生关闭／删除边界才能解除对应保留；旧轮的完成不解除新轮。
- 已接受的 `turn/start` 回执为 `inProgress` 时，在 start 通知到来前也建立保留。若更新的通知已经到达，迟到回执不覆盖它，尤其不能复活已完成轮次。
- 单纯隐藏、刷新、网络断开或浏览器状态恢复不构成停止授权。测试不会自动重发未知送达的输入，也不停止原生 Agent 来恢复页面。

## 中断提示与队列

网关仅在匹配 `stopTurnId` 的明确停止操作时保留用户停止归因。外部事件或只读历史恢复发现 interrupted 时显示“当前响应已中断，队列已暂停；中断来源尚未确认，请检查后继续”。仍暂停队列，不自动重试、继续或清除草稿。前端将旧运行层的 `interrupted` 和旧“由于你中断…”字符串转成中性提示，兼容已保存的历史暂停状态。

## SSE 离线与在线恢复

共享聊天 EventSource 收到浏览器 `offline` 时关闭当前连接并显示 `reconnecting`，保留已处理的 SSE 序号和审批状态；`online` 时仅重建同一个 `view=chat` 流并从保留序号继续。若离线期间收到 runtime-restarted，则重置旧代次游标并等到 `online` 后从新代次开始。离线关闭本身不变更审批或草稿；online 后只接收原流回放与既有快照。网络恢复不会解除超预算暂停，也不 resume、重发输入或触发完整历史轮询。最后一个订阅者离开时移除网络状态监听。

定向单测 `eventStream.test.ts` 12 项通过。显式真实 HTTP/Chromium 验收命令为 `SESSION_EVENTSTREAM_OFFLINE_LIVE_RUN=1 node --test scripts/session-eventstream-offline-live.test.mjs`；该夹具实际观测到 EventSource OPEN→离线 CLOSED、运行时 SSE subscriber 从基线 4 回到 4、online 创建第二条连接并以 `since=1` 收到事件及审批快照。默认脚本测试跳过此浏览器关卡；完整步骤与边界见本轮 debug 记录。

## 最小验证与激活

- `packages/session-runtime/src/codex/ownership.test.ts`：主／子未完成轮次、精确完成、回执先于 start 通知及 completion 先于回执。
- `apps/server/src/services/codex-followups.test.ts`：未知中断归因、暂停后零重发、历史恢复及原有显式停止／替换。
- `FollowupQueue.recovery.test.tsx`、`FollowupQueue.plugin.test.tsx`：旧运行层提示兼容与零隐式恢复。
- `tests/e2e/session-background-interruption.spec.ts`：桌面／手机尺寸模拟隐藏、pagehide、刷新，核对草稿、队列、零 interrupt/resume/start 请求；这是隔离真实 HTTP 队列和浏览器夹具，不能冒充物理手机或真实模型任务验收。

构建不替换运行中的独立会话服务。须用 `pnpm session:status` 核对是否仍待激活；需要停止或替换正式运行层时，先确认活跃任务影响并取得用户授权。不得把磁盘产物的绿色测试记成正式运行进程已修复。

## 本轮已完成验证

- 新增主／子未完成轮次用例先红；修复后 ownership、client、Goal completion／preflight 共 51 项定向通过。全量运行层首轮捕获 1 项 Goal 等待回归，改为独立 releaseHold，保留其精确完成等待；最终全量 366 项通过，无失败、跳过或取消。
- 队列归因先红后绿，34 项服务单测通过；补充队列路由、HTTP 集成、状态转换和撤销回归共 50 项通过。前端旧暂停兼容先红后绿，21 项组件单测通过。
- `pnpm check` 通过（保留既有构建 chunk 提示）；内部释放保护调整后，运行层构建及前后端类型检查再次通过。
- 隔离浏览器 `http://10.30.0.24:36795`，前端绑定 `0.0.0.0`：桌面／手机后台和刷新、旧暂停恢复、队列失败／未知送达处理及三类 Agent 的显式停止，共 10 项通过。除浏览器和真实隔离 HTTP 队列外，Agent 由夹具模拟，未向真实任务发送测试输入或停止请求，未验证物理手机的后台回收策略。
- `pnpm session:status` 明确运行产物不一致；只读检查发现独立会话运行层仍有活跃会话。没有停止或替换它，不能声称正式运行层已启用新的释放保护。

原始日志保存在被忽略的 `.dev-runtime/interruption-20261027/`。历史两次的完整触发来源仍受原日志缺少原生写入因果记录所限；本次修复证明并封住的是上述可复现路径，不冒充历史全因已证实或意外中断全面根治。

## 手机刷新继续排查（2026-10-27）

### 已实测的刷新触发点

1. 实际安装的 Vite 7.3.1 客户端在 HMR WebSocket 断开后调用 `waitForSuccessfulPing`，服务恢复可达便执行 `location.reload()`。隔离页面仅关闭这条连接、不发任何 Agent 写请求，393px 和 1280px 两项均复现 document 身份改变；单纯模拟 visibility/pagehide 的旧回归不能覆盖此路径。
2. 正式 `.dev-runtime/web.log` 连续记录 `NativeMcpAuthentication.tsx` 的 `showMcpPrompt` 导出不兼容和 `circular import invalidate` 导致的 page reload。原模块既启动 service，又向 service 导出提示函数，形成循环。真实 HMR 先红后绿：等待 hot-updated 后再等待整页刷新阶段，修复前 document 身份丢失，拆分提示函数、提示组件和启动组件后保持页面与草稿。

开发服务通过自有 Vite 插件适配实际服务的 `/@vite/client`，不改 node_modules 或官方 VSIX。网络断开仅重连现有 HMR transport，保留业务 SSE 的恢复规则；失效连接的 ping 及握手计时器清理，重连合并，失败 Promise 不长期占用连接入口。正常 HMR 保留；不兼容整页更新、错过源码更新或服务代次改变时，保留当前页面并提示“刷新界面”，只有明确点击才整页刷新，等待期间不继续应用新模块更新。版本状态端点只提供不含机器配置的 opaque 代次与修订，不能触发任务、停止或服务重启。只在 serve 启用；安装的 Vite 客户端结构变化会显式失败，不能静默退回自动刷新。

### 原生进程中断的另一条可复现危险路径

原生记录还确认本次主会话在北京时间 12:41:50、12:43:27 中断；原生执行进程日志分别在对应时段结束，新进程随后出现。原记录未持久保存传输失败原因，不能把进程更换直接归因为某个回包或手机刷新。

不过旧 `StdioRpc.consume` 在收到超过 32 MiB 的帧时会直接向共享进程发送 SIGTERM；该进程持有的其他执行轮次也会受影响。33 MiB 隔离夹具先复现 PID 更换，再验证修复后同一 PID、单次 initialize、零重发。现在识别标准原生 `id` 在 `result/error` 之前的回复前缀：只拒绝该回包，以固定小前缀和逐块丢弃方式读到换行，保留后续完成事件、审批及其他回包。响应过大明确报错，不把它当成读取成功，不截断或修改持久历史，32 MiB 限额保持。

未知超限帧不能安全跳过时隔离传输并清空有界缓冲，不停止执行进程，也不为仍存活的失效传输启动替代 writer。stdout end 可能早于真正退出，后续读取只短暂等候 exit 证据；存活时明确拒绝，真正退出后才允许新的独立请求连接，仍不重发原操作。`codex:disconnected` 增加 `reason`（frame_limit/process_exit/transport_error）及通知当时的 `nativeProcessAlive`，供后续区分真实退出与协议失效。

这些变更的运行层专项 14 项、最终全量 368 项均通过，无跳过、取消或失败；MCP/队列相关前端 28 项通过。完整构建与后续浏览器复验的最终结果在下方补充。前端修复与运行层启用分别核对，不能把页面已更新当成旧独立运行进程已激活。

### 验证限制与失败保留

第二轮日志在 `.dev-runtime/mobile-interruption-20261027/`：`reconnect-identity-red.log`、`hmr-real-red.log`、`full-reload-red.log`、`oversized-red.log` 为红灯证据。一次整组浏览器运行遇到其他进程同时改写相同文件、隔离 Vite 配置重载失败而退出；另一轮捕获并修复测试回调把 fixture 当成 Page 的错误，均不计通过。当前活动源码按最终复验记录核对。手机尺寸及模拟隐藏不代表物理手机、操作系统内存回收或真实模型长任务验收。

隔离原生只读诊断仅 initialize／initialized、thread/read、thread/turns/list，未 resume、acquire 或向真实任务发输入。当前主会话完整只读回包约 10.47 MB，另一旧线程约 2.31 MB；本次没有实测到它们超出 32 MiB，不能把过往大包或故障夹具当成这两次事件的现场因果证明。

### 最终复验

- 当前合并源码 `pnpm check` 成功，保留既有 chunk 提示。运行层全量 370 项全部通过，包含原有 Goal／所有权、共享 RPC 超限保护和新增 legacy 独立读取；没有跳过、取消或失败。前端 MCP／队列 28 项及 Vite 客户端契约 3 项通过；队列后端服务／路由的 50 项回归保持通过。
- 隔离真实 HTTP 前端 `http://10.30.0.24:36795`、绑定 `0.0.0.0`：18 项浏览器全部通过，无跳过。包括后台断连、前台连续三次断连、实际 MCP HMR、源代码代次变化提示、真实隔离 Vite restart／full-reload、明确刷新后的草稿、队列恢复与三类 Agent 显式停止。代次的合成反例和实际 server.restart 用例分别记录，不混为同一种证据。
- 正式 HTTPS 前端 `https://10.30.0.24:8484`、绑定 `0.0.0.0`：真实开发客户端与 WSS，手机／桌面后台重连及手机三次前台断连 3 项全部通过；业务 API 与 Agent 仍由夹具截获，未向正式任务发测试输入。最初 HTTPS 回归卡在 Vite SharedWorker ping；改用主页面有界状态探测后通过，不修改站点证书或全局 TLS 策略。不能据此声称物理手机后台回收策略已实测。
- 正式前端曾因并发改写配置时读到不完整模块而退出，日志保留；确认 8484／8483 均无监听后，仅恢复前端至原 HTTPS 配置，没有停止 Node 网关或独立运行层。最终 `/@vite/client` 为 200，并实际包含保留文档与显式更新代码。
- 实际原生只读 legacy 路径复验返回正确线程身份及 19 个轮次，读进程 loaded 集合为零，退出只清理自有读连接。它证明读取路径可用，不代表真实模型任务／物理手机连续运行验收。
- 上述阶段性结果当时仍使用旧运行层，不能据前端已生效推断运行层已经更新。后续用户明确授权重启服务后，旧运行层和其原生子进程已结束，`pnpm dev:restart` 启动了当前构建；`pnpm session:status` 不再报告 build fingerprint 不匹配。

最终日志：`check-final.log`、`runtime-current-all.log`、`browser-final-v3.log`、`formal-browser-v2.log`、`readonly-legacy-acceptance.log`、`vite-contract-final-v3.log`。原 17／18 的浏览器失败保留：重启后冷加载的原 5 秒输入区等待不足，采用与重新加载流程匹配的 15 秒期限后专项及完整组通过，不据此作两秒恢复或性能通过声明。截图为 `browser-final-v3-results/**/mobile-{full-reload,restart}.png`。

### 授权切换后的最终运行层与现场历史复验

- 用户明确授权停止、中断和重启服务后，已停止原 Session 运行层并通过 `pnpm dev:restart` 恢复前后端及最新运行层。当前 Session 运行层报告 ready，build fingerprint 与磁盘一致；HTTPS 前端监听 `0.0.0.0:8484`，网关监听 `0.0.0.0:8282`。
- 最终 `pnpm test` 退出 0；其中 session-runtime 370 项、Web 591 个测试文件／3661 项、脚本 152 项通过。最终 `pnpm check` 通过，保留仓库现有动态导入与大 chunk 提示。
- 在真实 LAN HTTPS 页面上使用真实 Vite WSS 运行 `session-mobile-reconnect` 和 `session-background-interruption`：8 项全部通过，无跳过。覆盖 393px／1280px 原位重连，错过更新／服务代次变化显示手动刷新，三次连续断线，后台／pagehide／刷新后的草稿和队列保留，以及零 Agent 写请求。浏览器 API／Agent 仍由隔离夹具截获；这不是物理 iPhone 或真实模型长任务验收。
- 新运行层对实际 `REF_xh3_accu` 执行只读 `thread/list` 与 `thread/read`：目标为 paginated，历史 HTTP 200、11,611,853 bytes、100 turns／2,915 items，末轮 completed；未发送任务写入。该现场范围证明此会话刷新后历史可读，不表示超过既有读取预算的任意单条 legacy 消息都会被显示。
- legacy 单个字符串在解析时超过既有 32 MiB 历史预算，会明确返回 413，仅拒绝该次读取并清理自有 reader；不会截断／静默丢正文，也不会杀掉共享 Agent。超预算 legacy 正文仍是可见的读取限制。


## 开发依赖缓存的React过滤（2026-10-29）

各Vite进程仍使用独立缓存身份。缓存位于.dev-runtime/vite-cache，React插件须同时排除该路径和原node_modules，避免已编译依赖重复Babel转换；不得排除整个.dev-runtime，隔离验收目录的应用源码仍需Fast Refresh。scripts/vite-react-cache.test.mjs执行实际插件过滤，tests/e2e/session-vite-optimizer.spec.mts验证真实LAN依赖响应及保留计数状态的源码HMR。文档连续性、代次检测和显式刷新要求不变，详见[会话体验验收](designs/session-mode-user-experience-acceptance-20261029.md)。
