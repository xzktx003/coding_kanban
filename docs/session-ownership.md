# Codex 会话执行权与跨客户端交接

会话历史、轮次状态和执行权分别管理。网页打开标签、刷新、恢复历史、补齐发送回显都只读；需要执行操作时才恢复同一 Codex ID。草稿及附件仍由既有会话草稿和持久消息队列保存。

## 用户操作

- 回答结束且没有后台工作时，后台自动释放。本项目原生子进程的卸载延迟为 2 秒，实际以本进程 `thread/loaded/list` 确认不再加载为准；通常数秒完成。
- “当前会话的更多操作 → 释放给其他客户端”使用相同安全检查，不会隐含停止任务或结束后台命令。
- 生成、重试、审批、问题、MCP 交互、活动目标、关联子 Agent、后台终端、队列继续或送达待确认都会保留执行实例。资源能力不可用、响应不完整、队列心跳过期时也保留，并显示原因。
- 外部客户端占用时可查看历史，返回浏览器窗口时只读刷新外部新增内容。发送请求会在模型调用前被拒绝，队列保留原消息 ID、正文、上下文和附件；对方实际释放后点“重新连接并发送”。不主动杀进程、强制接管或创建替代会话。
- 关闭标签仅取消关注。后台任务和连续队列照常运行；输入草稿不阻止安全释放。

“本项目未占用执行权”只说明本项目没有加载该线程，不能据此推断外部客户端是否空闲。

## 协议与协调

Rust 的 `ownership::Ownership` 位于 Codex stdio 传输之上。以每会话互斥锁串行化恢复、执行和释放；代数随执行请求递增。关闭事件不能直接重置新轮次，需只读查询当前 app-server 的已加载集合。运行层实例替换继续使用既有前端 epoch 作废旧 HTTP 回执。

`thread/read` 提供完整只读历史：legacy 使用 `includeTurns`；paginated 以 `thread/turns/list` 的 `itemsView=full` 和升序游标收集历史，检测重复游标。新版原生返回在 Thread 上的模型、推理设置会更新对应会话，缺字段不清空已有设置，进行中的用户设置优先。

HTTP 新增：

- `/api/codex/thread/read`：完整只读历史。
- `/api/codex/thread/turns/list`、`items/list`、`loaded/list`：只读原生查询。
- `/api/codex/thread/access`：`{threadId, release?: boolean}`，返回 state/reason/generation；无 release 时只读取访问状态。
- `/api/codex/thread/unsubscribe`：经过安全检查的释放入口，返回访问状态，**不承诺取消订阅即释放**。
- `/api/internal/codex/queue-holds`：仅网关使用。网关在串行队列操作前登记 busy，操作后发布所有执行、待续发和待确认会话，轮询持续刷新。10 秒无新快照则不释放。使用同主机单调时钟序号拒绝重复或迟到快照；网关重启不复用旧序号。浏览器代理拒绝整个 internal 路径空间。

原生子进程启动参数添加 `thread_unload_delay_secs=2`，不修改用户 config.toml，也不修改其他 CLI/IDE 或共享 daemon。

释放过程先检查 loaded、轮次、终端、目标、子 Agent、交互、队列；检查期间有新事件则重新核对。取消订阅后保持 releasing。查询确认本进程不再加载才显示 readonly；即使 close 通知丢失也能收敛。8 秒仍未释放时保留 releasing 和原因，新发送返回明确“尚未发送”，不无限等待、不重发原消息。

`SESSION_OWNED_ELSEWHERE`、`SESSION_ACQUIRE_FAILED`、`SESSION_RELEASE_PENDING` 返回 HTTP 409，发生在发送前，队列记为可显式重试的失败。实际执行写入或回执中断使用 `DELIVERY_UNKNOWN` / HTTP 502，队列记为 uncertain，保持既有人工核对流程，不自动重发。成功的新显式执行可以解除运行层旧的未知标记，队列自身的 uncertain 仍独立保留。

## 兼容与发布

`/health.capabilities.codexOwnership=true` 表示新运行层。旧 Rust 服务仍运行时，新前端不会为了加载历史偷偷退回 resume：会明确提示当前服务尚未支持只读历史及自动释放。旧运行层的队列继续工作；网关允许旧版不存在 holds 接口的 404。

必须在正式 Agent 的安全窗口启用新 Rust 运行层。构建、前端热更新、Node 网关热更新都不代表正式 Rust 已更换。禁止仅为了启用本功能就终止仍在运行的 Agent。

## 验证

- Rust 生命周期测试：读写分离、外部锁、释放 ACK 与确认分离、后台命令、活动目标、审批、未知资源、迟到关闭、队列快照次序、过期心跳、送达不明、分页历史、取得执行权失败。
- Node 测试：notLoaded 后继续发送、持久队列 hold、接口故障阻止投递、冲突后保留身份和附件、显式重试一次、浏览器不能伪造 hold。
- 前端单测与浏览器：只读导航/刷新/回显、模型隔离、草稿/附件保留、手动释放与占用提示、未确认释放不显示成功。
- `python3 scripts/session-ownership-acceptance.py --codex /path/to/codex`：构建 Rust 后，在临时数据目录启动真实运行层和独立 Codex app-server，使用本地 Responses 测试服务。验证同 ID 写锁交替、外部占用读历史、拒绝发送无模型调用、自动释放、释放/发送竞态、历史保留。只清理脚本自己创建的进程组，不使用真实凭证或远端模型。

完整执行结果见 [验收记录](designs/session-ownership-acceptance.md)。

## 完成通知缺失时的队列恢复（2026-10-08）

`notLoaded` / `readonly` 不是完成凭据。若队列已有明确接收回执并保存 `awaitingTurnId`，但新的状态快照显示 idle、notLoaded 或 systemError，网关用完整只读 `thread/read` 核对原会话与等待轮次。仅在该轮及后续历史均为确定终态时解除等待；失败或中断继续暂停，成功只解除由网关恢复产生的“等待任务完成确认”。手动暂停、送达不明、停止等待、未结束审查不会被这条路径解除。

查询不调用 resume；只有后续投递仍由既有 turn/start 执行权流程恢复原 ID。读期间收到更新事件、队列修改或停止请求会作废核对结果，历史缺失、格式不完整、旧运行层不支持或网络失败均不推进队列。同一等待轮次的失败核对最多每 5 秒尝试一次。已送达消息不会重发，排队消息保持原 clientUserMessageId、正文、附件与模型快照。

红绿灯覆盖漏完成回执、网关重建、失败/中断、错误会话、历史缺失、进行中轮次、手动暂停、网络异常和读期间新轮开始；HTTP 适配器集成测试确认只调用 thread/read 并且后一条消息只发送一次。现场只读核验确认原会话从 23 轮增至 24 轮，队列中的原消息仅对应一个 clientId，新增轮次 completed。没有发送额外测试正文，没有强制接管或重启 Rust。

补充验收：队列及 HTTP 适配器 33 项通过；`pnpm check` 通过；最终 `pnpm test` 共 1,860 项通过（server 649、终端 web 526、会话 web 590、脚本 95），另有 1 项平台条件跳过。浏览器交接/队列 15 项与发送回显 4 项分批通过。首轮 tmux 改名单测曾超时，完整复跑通过；旧发送回归先因拦截 resume 失败，改为 read 后发现有限 SSE fixture 的人工断线与历史写入时序竞态，测试改用持续的隔离流并先持久化模拟历史再发布事件，4 项复跑全部通过。未以重试掩盖产品错误或移除断言。

本地证据（Git 忽略）：`.dev-runtime/queue-history-{red,pause-red,green,check,tests-final,e2e,delivery-final}.log`；真实接收/完成与唯一消息 ID 核验为 `.dev-runtime/queue-history-live-verification.json`。

## 子线程能力与回复身份

普通子输入权限须在获取写入权前通过原生只读元数据确认；false 或缺失时不 resume，不以试发消息探测。子中断与普通输入权限分开判断，实际停止复用既有暂停/中断接口。查看后代不产生关注标签或新的写入实例。新网页回复绑定 thread/request/turn/item 与 requestToken，运行层原子匹配待处理请求，拒绝旧实例和重复回复。完整保护需新网页及新 Rust 二进制同时启用，旧接口仍兼容。见 [子 Agent](session-subagents.md)。

### 新线程的首条消息

`thread/start` 创建的原生实例在首条用户消息之前可能尚未物化到磁盘。自动 sweep 与显式 release 均须保留这一实例，直到 `turn/start` 成功接纳；失败或未知送达不解除保护，不重试消息本身。接纳后恢复现有队列、活动轮次、后台终端、目标和子 Agent 安全释放检查。分页历史只对首屏明确的“not materialized yet / before first user message”返回空 turns，不吞掉其他原生错误，也不隐式 resume。隔离原生验收覆盖创建后等待多个 sweep 周期、读取空历史、首条消息只发送一次以及后续安全释放。
