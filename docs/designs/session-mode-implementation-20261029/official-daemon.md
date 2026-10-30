# 官方共享 Codex daemon：实现与验收

日期：2026-10-29—30。对应[总方案](../session-mode-multisession-development-plan-20261029.md)的官方执行域接入、只读历史、请求身份与运行层生命周期。产品目标为看板和官方 CLI 共享任务；用户已明确本期不做 VS Code 插件启动适配。

## 当前实现

- 默认 `CodexService`、chat reader、command detail reader、legacy history reader 都连接已有官方 daemon。缺省控制路径来自实际 `CODEX_HOME/app-server-control/app-server-control.sock`；没有私有 `app-server` fallback。
- 默认路径不存在/拒绝连接且允许按需启动时，只调用官方 `codex app-server daemon start`。同进程启动合并，官方命令负责跨客户端启动锁。显式自定义 socket 不触发启动。没有 daemon stop/restart/update 的产品调用。
- `SESSION_CODEX_DAEMON_AUTO_START=0|1`（默认1）、可选 `SESSION_CODEX_DAEMON_SOCKET` 属于服务部署配置，不接受浏览器路径、端口或命令参数。连接核对 socket 和父目录所有权/权限、真实 inode 身份，并在 HTTP Upgrade 后重查；不删除、覆盖或修复现有 socket。
- 已运行服务的附着不读取 provider 环境存储；只有确实需要启动官方服务时才求取启动环境，并重查该环境未改变配置执行域。provider 存储故障不能阻挡已有任务的历史或审批连接。
- 关闭看板运行层/reader仅关闭自身 Unix socket。ACP 和显式单测 fixture 继续使用自有 stdio 子进程；它们的原进程退出、安全关闭和未知回执行为保留。
- 健康响应提供 `codexBackend: shared-daemon`，`codexConnection`只含连接、原生版本、代次、账号观察修订和不含路径的运行域哈希。连接断开不判断官方任务已经停止。

底座为 [daemon.ts](../../../packages/session-runtime/src/codex/daemon.ts)、[rpc.ts](../../../packages/session-runtime/src/transport/rpc.ts)、[client.ts](../../../packages/session-runtime/src/codex/client.ts)、[item-detail.ts](../../../packages/session-runtime/src/codex/item-detail.ts)。

## 传输与资源边界

官方0.165控制 socket 要求 WebSocket HTTP Upgrade。`codex app-server proxy`仅复制原始字节；假 Unix byte-stream 的 proxy 验证不能证明它能直接收发 daemon JSON-RPC。

本实现固定连接本机私有 Unix socket，仅协商普通 WebSocket，不协商压缩、不开放远端 URL。客户端帧按协议掩码，处理 text/continuation、ping/pong、close，拒绝扩展/二进制/非法控制帧。接收端按4096字节流式投递 JSONL，不先缓冲完整 WebSocket message。因此原命令/历史 selector 仍可在工具正文进入可见缓存前丢弃巨量内容。

共享 JSON-RPC 保持32MiB帧/写队列，chat投影保持16MiB；原 parser token、深度、背压、单 reader 和网关准入没有放宽。reader指标明确区分 `transport: shared-daemon`、`connectionClosed` 和 fixture 子进程的 `pid/childExited`；共享读取还返回只含哈希的 `nativeScope`，不把关闭socket写成原生进程退出。

## 实时订阅与显式连接

**只读历史不建立完整线程订阅。** 真实0.165测试中，另一连接可收到全局 `thread/started`、`thread/status/changed`，但不会仅因 `thread/read`、`loaded/list` 或初始化就收到既有主线程的全部 turn/item/审批。后台预热、历史恢复和浏览器重连均不调用 `thread/resume`。

明确的“连接实时交互”使用固定 `guarded-attach`。先核对原生 active、loaded、最新 `inProgress` 精确 turn ID，再执行不带模型/权限覆盖的 `thread/resume({threadId, excludeTurns:true})`；实际写出前核对运行/账号作用域及工作流观察到的状态变化。真实 CLI 用例证明这个 loaded 分支可收到并回答同一原生审批，历史仍只有一个 turn。运行层连接不重建时，浏览器刷新保持原订阅，不需要重复连接。

`thread/access`增加 `sharedDaemon/attached/loaded/activeTurnId`。attached只由本连接真实start/resume/fork回执记录，不从全局thread/started推导；断线、取消订阅、账号修订和关闭使旧记录失效。查阅这些字段仅使用小元数据和 `itemsView:notLoaded` 的最新turn，不取得写入权。

原生接口没有 `loadedOnly/expectedTurn` CAS。本服务写前保护不能对尚未送达的其他客户端变化提供原子保证；显式连接仍必须展示为用户动作，不得改成静默恢复。官方0.165 loaded/cold resume分支证据见[线程处理器](https://github.com/openai/codex/blob/rust-v0.165.0/codex-rs/app-server/src/request_processors/thread_processor.rs#L4624)。

## 写入作用域、队列与审批

`operation-context`在实际只读 `account/read(refreshToken:false)` 核对后返回scope/namespace。scope绑定运行层实例、真实socket、连接代次和单调账号事件修订；同值账号通知也撤销旧scope。ChatGPT使用原生 `workspaceRouting.chatgptAccountId` 作为管理namespace的一部分，缺失时明确不支持；API key/Bedrock/GCP使用历史域和原生账号种类，不由邮箱或套餐推断权限。namespace只用于管理数据身份，不能充当授权。

固定 guarded路由覆盖空输入Resume、interrupt、archive、Goal pause、thread settings、native queue、read-state和显式loaded attach。上下文字段在本层消费，不传给原生RPC；guard贯穿Ownership预检、可能的显式执行加载和最终JSONL写出。它保证本服务已观察作用域，不是跨原生客户端的原子授权协议。

原生队列是已提交队列的唯一调度器。它使用线程设置，idle enqueue可立即执行，`clientUserMessageId`不是原生幂等键。不能在原生接收后再由看板pump发同一条`turn/start`，丢失回执先读队列/turn核对。更新设置回执未知时不继续add。

共享模式中的settings、Goal、archive、interrupt等操作不再为了旧writer模型而隐式resume冷线程。冷线程settings实际返回`thread not found`。用户明确发送时可经`guarded-queue-load`核对原生队列为空、Goal非active、任务非active及直接输入权限后显式加载，再应用捕获设置、提交队列。已有待发或活动Goal不走这条自动准备链。直接空输入Resume/turn执行的冷加载也使用`excludeTurns:true`，避免加载长历史占满共享RPC预算；不注入旧私有服务的feature覆盖。并发原生客户端仍不受本地串行锁约束。

固定guarded POST将明确写前`NOT_SENT`冲突返回HTTP 409，回执未知仍返回失败且不得自动重发。冷acquire的写前拒绝保留原`NOT_SENT`，恢复此前access状态，不再包装成不确定的恢复失败。这只区分已知尚未写出与不能确认的结果，不把通信失败当成原生拒绝。

普通审批请求可发给多个订阅连接，首个响应或错误会消耗原生callback。看板对未知request不再默认返回`-32601`；相同request重放保留原token与claimed状态。回答排队后若另一客户端先处理，最终写出前拒绝旧请求。原生特殊单owner UserVerification不被当成普通可转移审批，能力协商仍拒绝未实现的attestation。

已读协议使用**opaque string revision**和原生`operation:{type:read|unread}`。不能把revision转成数字，也不能把内部简化操作字符串直接透传原生。

## 已执行验证

1. 新模块加入前 `daemon.test.ts` 因缺少daemon实现失败，随后独立连接、缺失endpoint、未知request/审批replay和36MiB单WebSocket工具帧通过。巨帧读取每块≤4096字节、parser queue≤16，输出不含无关工具正文；结束后官方形态监听器仍存活。另有两项实际红→绿：已有服务不依赖provider环境存储，以及Upgrade后endpoint消失时关闭已接受socket（修复前500ms观察仍未关闭）。
2. 原RPC/重连/ownership/大历史/详情/背压等41项通过，包含>64MiB丢弃、暂停下游、超时、取消和真实自有reader退出。后续客户端/作用域定点组继续通过。
3. 一次完整runtime检查点413项：411通过、0失败、2个原生opt-in默认跳过。此检查点早于最后的显式加载/访问元数据与read-state边界补充，最终源码需复跑；不能把默认跳过记作原生验收。
4. 显式安装的官方 `codex-cli 0.165.0` 在全新私有HOME、无登录、本地Responses provider中：两个客户端共享同一socket身份和线程；关闭一个客户端时原任务继续；只读重连读到最终答案。记录同时明确 `lateConnectionReceivedTurnEvents:false`，不把正文恢复冒充实时订阅。
5. 真实官方CLI进程通过PTY与看板共享同一daemon。显式loaded attach后，看板回答该CLI任务的真实command approval，CLI任务完成且CLI仍运行，严格只有一个turn。三次provider请求分别是带工具主调用、无工具辅助调用、带function_call_output的续接，没有第二个用户turn。
6. 原生队列实测：idle add立即启动；重复client ID产生不同原生queue ID；在首轮运行中改变线程模型，后续provider实际采用新模型。活动turn加待发队列与活动Goal后，先显式暂停Goal，再精确interrupt到terminal；随后archive/unarchive仍保留队列和paused Goal。interrupt后、unarchive后、metadata-only loaded restore后分别静默观察至少2秒，均无额外provider请求，只有显式queue/start继续。归档期间queue/list原生明确拒绝`session is archived`，不能把这个拒绝当成队列已清空。重复项在执行前显式删除。
7. 原生夹具读取其私有daemon PID记录后，核对真实`/proc`启动ticks和命令中的私有域。清理只调用同私有HOME的官方daemon stop，测试退出前断言该PID身份已退出；不根据文件PID向进程发信号。
8. 原生read-state实测以opaque revision执行read→unread；旧revision再次read被原生CAS拒绝。完成任务归档再恢复为冷线程后，settings.update明确失败且无新执行；随后明确冷发送准备、应用捕获设置、enqueue只启动一次。四次实际provider模型依次为`fixture-a/fixture-b/fixture-b/fixture-c`。
9. `ownership-shared.test.ts`验证六类冷线程管理写操作不隐式resume、每个实际写出检查作用域，以及显式冷执行不读历史或注入feature。metadata-only冷acquire用例先复现缺少`excludeTurns:true`，修复后通过；第二次写前撤销scope时只有acquire已写出，turn未写出。

2026-10-30最终底座检查：`pnpm --filter @agent-orchestrator/session-runtime check`通过；client/reconnect/ownership/shared-ownership/Goal preflight/daemon/operation-context合计58项通过、0跳过；以上三个官方原生opt-in用例显式执行3/3通过，约14.9秒。`git diff --check`对本域已有文件通过。原生二进制实际`codex-cli 0.165.0`，SHA-256为`c06a67fd8ac76508dc78bd99ce20c9f317b8d568beda59485f3f4134df9962d5`；夹具不继承正式账号或默认IPC。

精确官方0.165源码另包含中断保留队列、metadata-only resume不推进、重建app-server后仍保留pause的[队列用例](https://github.com/openai/codex/blob/rust-v0.165.0/codex-rs/app-server/tests/suite/v2/thread_queue.rs#L560)，其647—678行覆盖重建服务后的恢复与显式queue/start。这是源码对照证据，本次没有执行该Rust测试；上面的原生运行证据不宣称自行重启共享服务验证了同一过程。

原生入口默认不启用。显式执行示例：

```sh
SESSION_CODEX_DAEMON_NATIVE_BIN=/absolute/path/to/official/codex \
pnpm --filter @agent-orchestrator/session-runtime exec tsx --test \
  src/codex/daemon.native.test.ts \
  src/codex/daemon-cli.native.test.ts \
  src/codex/daemon-queue.native.test.ts
```

本文件的原生协议结果不替代浏览器UI、30关注/4窗格/3页面两秒性能、跨设备、实体手机、MCP/实时语音、长时间RSS或正式部署验收。现有独立私有app-server中的活跃任务不会因这次代码修改自动迁到daemon；旧队列未知回执也不能自动灌入新服务。

2026-10-30接续整合复验：runtime定点55项通过、0跳过；三个官方原生opt-in显式执行3/3通过（约8.7秒），日志为`.dev-runtime/session-management-read-20261030/daemon-{unit,native}-current.log`。本轮新增实际确认：另一新连接在完成后以`itemsView:full`和`includeTurns:true`读取最终正文；archive/unarchive后loaded集合确认为冷，仍可full只读恢复且保持冷，不resume。官方0.165在turn/start回执之后立即读取偶见`list_turns is not supported yet`，不能将这个尚未就绪窗口缓存成永久能力不支持；后续完成事件触发读取成功。未添加私有fallback或静默resume。

明确继续一个冷线程的既有队列现走`guarded-queue-restore`：捕获全部精确native queue IDs和scope，核对idle/notLoaded、Goal非active及队列顺序后metadata-only resume，再由显式queue/start推进。原生实测冷queue/start会拒绝要求先resume；精确restore后的2秒安静观察没有额外模型请求，暂停原因及内容保留。这个resume是用户明确执行动作，不归入只读历史恢复，也不提供跨客户端原子CAS保证。共享阅读的浏览器验收见[阅读状态](readsync.md)。

## 全量清单条目映射

| 条目 | 本期实现与已执行证据 | 验收边界 |
| --- | --- | --- |
| H07 本地 app-server 生命周期 | 经批准改为官方共享 daemon：`codex/daemon.ts`、`codex/client.ts` 及 `transport/rpc.ts` 负责已有服务附着、可选官方 daemon start 与仅关闭自有连接。`daemon.test.ts`、上述55项定点和三个显式官方0.165原生用例通过；`daemon-cli.native.test.ts` 证明关闭看板连接不停止同一CLI任务。 | 不创建私有app-server；不自动停止、重启或升级共享daemon。运行层自动/显式维护及CC/ACP活动保护另见[运行层替换](runtime-replacement.md)。不是正式部署或所有官方客户端兼容证明。 |
| H08 RPC/通知/请求归属 | `transport/rpc.ts`、`codex/client.ts`、`ownership.ts`、`operation-context.ts` 以连接代次、thread/request/turn与scope校验分发和最终写出；未知request不自动回答、审批重放不重建token。`client.test.ts`、`client.reconnect.test.ts`、`ownership-shared.test.ts`、`operation-context.test.ts`及上述定点组通过；真实CLI原生用例仅显式loaded attach后收到并回答同一任务审批，原生只有一个turn。 | 后连只读客户端不会自动获得完整实时订阅；未实现原生跨客户端CAS，也不把本层已观察scope称为原生原子授权。浏览器审批/队列交互由对应条目的独立记录覆盖。 |
| H17 只读历史与工具正文投影 | `codex/chat-history.ts`、`codex/item-detail.ts`、共享RPC selector及网关chat投影维持原32MiB/16MiB和流式丢弃预算；只读连接不resume/acquire。`daemon.test.ts` 的36MiB单WebSocket帧投影、原读取器>64MiB丢弃/背压组通过；`daemon.native.test.ts` 显式验证完成后及冷archive/unarchive后full items/includeTurns读取不加载线程。最近页/长历史真实浏览器证据见[性能与恢复](performance-recovery.md)，阅读CAS双端浏览器见[阅读状态](readsync.md)。 | 原生协议、投影测试与浏览器性能是独立关卡；这些通过不代表长时RSS、全部历史状态组合或两秒验收通过。 |
