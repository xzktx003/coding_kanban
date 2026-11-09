# 共享会话首轮与续聊的原权限选择（候选）

固定 Mac 原生 ID 的首轮请求及已有会话发送保留审批策略、审批者、active permission profile 或 sandboxPolicy，以及 runtimeWorkspaceRoots。multiAgentMode 只支持固定原版默认 literal `explicitRequestOnly`，未知模式拒绝；不把原选择替换成 daemon 默认。

`withSend` 仅移除一次性发送标记，原 permissionsConfig、approvalsReviewer、multiAgentMode 交给原 manager 生成真实请求。发送 schema 通过共用权限模块验证原字段并复制为不可变数据；无 cwd 的 native/IPC 层只做结构、规范路径、枚举和预算检查，服务端必须用真实 binding 的 cwd 再检查根约束。

服务端 `verifyPermissionsSync(params,binding)` 默认缺失即拒绝非空权限选择。register、实际 socket 写前及回执处理都重验精确 binding、当前执行证明与原有账号/view/期限。生产回调须核对真实 native start/resume 权限回执，未证明的新权限选择不能发送；该回调不能伪造 turn 权限回执。

原 32 KiB 单条文字、64 KiB frame、16 pending、8192 总预算不变。未知 config、非空附加上下文、插件或其它未实现字段仍明确拒绝；未知投递不重发，不因刷新或后台恢复发送。

原版模型选择器可能保留在 local 连接，不能据其显示值证明共享 daemon 支持该选择。显式创建授权时，缺少共享目录证明才经同一已核 daemon observer 读取固定 `model/list`；每页最多 100 条、最多 5 页、合计 2 MiB，游标原样传递。取消、期限、账号/view 或较新目录观察变化均阻止迟到安装；读后重验 ticket，随后同步注册创建，不跨 await 保留创建注册上下文。读取不启动模型、线程或工具，不更改选中模型/effort；固定原件的 UI 标签 Light 对应协议 `low`。

验收使用 `native-shared-thread-submission`、`native-shared-thread-send-routing`、`shared-thread-send`、固定 IPC 与 clientUserMessageId 定向测试。旧实现对原权限字段和 explicitRequestOnly 的红灯及修复后首/续因果链绿灯独立留存；真实模型首轮与续聊由主验收另行记录，单测不代表上线。

创建 IPC 的失败回包仅新增固定负路径枚举，用于区分 native 请求结构、控制期限、host scope、host authorize 和结果结构。发送和接收共用同一固定白名单，不输出参数、账号或宿主原始错误；未知 binding 回执仍为 `SHARED_DAEMON_OUTCOME_UNKNOWN`。冻结容器的复制清单与 helper 摘要必须同版更新。

原 SDK 在授权后补入的 OTel `traceparent`／可选 `tracestate` 独立严格验证，不进入业务授权比较，原始 wire 保留；空 tracestate 是实际原 producer 的合法输出。创建与续聊共用该规则及原 64 KiB 总预算。SDK 的原准备 provider 也会补入 `daybreakProgramPropagationEnrolled:false`：固定 CLI 0.166 的真实无登录隔离实例已验证此值与缺省的权限、模型和运行根等价，仅该字面 false 不参与业务比较，true 与其它值仍拒绝。最终 gate 保留原异常 cause 和固定阶段。

v16 的实际首因是上述默认 false 被拒，现场 trace 缺失；不能将静态 trace 风险当成本次实际故障。截至 v16 的失败均确认未写出 daemon 创建/turn 请求、不重发；GUI 两轮收发尚待后续候选证明。

v17 已实际写出创建并通过原生回执、权限与采纳证明，随后 MCP 启动状态通知被旧分类器拒绝；没有写出首轮 turn。新增 `mcpServer/startupStatus/updated` 按固定 CLI 0.166 五字段合同转发：四种状态及原 error／reauthenticationRequired 保留，UUID 线程沿原 history/follower，缺失或 null 线程仅作为当前 source 的 host 元数据，不创建绑定。关联空线程 `01a1b7af-862c-7a71-8bfe-15f8eb7a11b0` 已保留，来源为唯一时间／目录关联后只读原生元数据核验，不冒称已保存原始请求与 UUID 的映射，也不重发。

v18 原 daemon 成功回执至原 SDK 匹配 pending response 相隔 22.381 秒，随后创建意图 guard 拒绝；没有写出 turn。回执 hold 现保持到同一队列项的实际 `writeNative` Promise 完成及精确 sequence 消费 ACK 均确认，再释放后续通知，避免后续同步验证抢先占用回执路径。ACK 早于写出 Promise 完成仍合法；关闭拒绝未完成回执并释放原预算。15 秒消费计时起点与时长、30 秒原创建期限及每次实际写前身份验证均不变；超时只新增固定阶段以区分写出等待与消费等待。真实共享首轮／续聊仍由新候选验证，不以该排序修复代替模型收发。

v19 的该回执实际写入耗时 45ms，原 SDK 在写入后 4ms 成功匹配请求，ACK、创建绑定与 follow 消息均到达。准确创建 UUID 为 `01a1b7de-c835-7ff2-80d4-c68525dc884d`，直接来自原请求对应的真实回执。随后浏览器桥因 `request_timeout` 关闭，原生 MessagePort 关闭错误是后果；未写出首轮 turn、不重发，空线程保留。该结果证明回执延迟修复有效，不能表述为共享模型收发成功；后续排查转向浏览器桥回执与背压。

共享八槽 reader 的真实 Unix／双 MessageChannel 用例复现了两个页面各占四个数据名额、后续 portPost 回执无法读取的闭环。浏览器调度现不再要求本页占满八项才前进：压力下每 8ms 实际转发一项，下一独立事件循环仅确认该项，再为后项重新等待节拍；FIFO、原八槽／8MiB、32 个 in-flight post 和 10 秒请求期限保持。失败时在既有提示属性保留触发请求的固定类型、编号、写出／排队状态和数值计数，不保留参数或正文；这项运输反例不是 v19 具体超时请求已被证实的替代证据。

v20 在首次发送之前记录 `b/first-cause.json: renderer_awaiting_count`，原生视图被关闭，未写出 thread/start 或 turn/start。原生 shim 现在保留原 64 条实际 IPC 在途窗口，增加最多 256 项本地快照 FIFO，在途与等待共用原 8MiB 字节预算；只有真实 main ACK 才前进，关闭清空，超量失败，不合并或丢弃更新。该新增等待计数明确列出，不当作未改变任何资源预算；原包、权限、账号与正式任务不变，新宿主再验证实际模型收发。

v21 仅在未发布 profile 的启动阶段失败：控制交接超过原 10 秒期限；当时 CPU 3 实测满载。未创建 UI／任务的该次失败宿主按精确身份停止，所有文件保留。v22 在全新单核 CPU 5 上启动成功；这只是调度对照，不证明唯一根因。其真实线程 `01a1b80b-045e-7772-8bb1-b8924c2df14c` 创建成功但未写出 turn，仍保留。

v22 的精确超时请求是已派发的普通 `call/sendMessageFromView`，编号 2390；排队及 nativeDeferred 均为零，不能归因为窗口占满。确认创建回执后，宿主下一条绑定读取晚了 8.1 秒，同期已有十四条原生通知留存在 hold。现在通知按原顺序每次派发一条，经 `setImmediate` 让出 I/O 后继续；WS 暂停、字节及条目预算、原期限不变。每次继续前重核 scope；关闭取消调度，撤销不继续派发并保留已知创建 UUID。原生调用的具体消息类型未被保留，不补猜测；真实收发继续由候选验证。

v23 的精确创建回执确认至下一条绑定请求缩短为 171ms，但绑定请求至 follow 仍相隔 9.702 秒；触发浏览器超时的已派发请求为 `portPost` 2420，队列没有满。真实创建 UUID `01a1b816-93ab-75d2-bffd-d767488a7cd9` 保留，未写出 turn、没有重发；自有浏览器上下文已关闭。下一候选仅在私有现有日志增加绑定 handler 和实际回执写入的阶段时间，用于区分服务端写入与原生接收延迟，不修改原超时或身份验证。

v24 的绑定 handler 为 325ms、实际绑定回执写入为 62ms，不能再将该轮失败归因于绑定慢写。精确超时请求变为已派发的 `call/sendMessageFromView` 2455，32 个 post 在途、117 项等待；共享线程 `01a1b826-e2fe-7b90-b41a-a2b20a13b3ad` 的本地日期 `2026/11/08` 原生 rollout 只有 session_meta，没有首轮 turn。原版另有成功的 local ambient ephemeral 模型调用；其完成早于该超时调用，既不是共享收发证据，也不能仅凭耗时推定是超时原因。自有页面已关闭、未重发；下一样本将管理进程与容器分到不同单核，并用私有固定类型时序区分普通调用处理与回执排队，原版后台行为及期限保留。

v25 的 manager 仅绑 CPU 6、容器绑 CPU 5，不满足原 `affinityIncludes` 启动约束，未进入界面；失败资料保留。v26 改为 manager 允许 CPU 5/6 调度但总配额 100%，容器仍为 CPU 5 单核，未删除原 guard。该轮普通调用正常完成，转为明确的 `thread/attachment/list` 读取被 gate 拒绝；共享线程 `01a1b83d-b478-7db0-b48d-606f956b8a89` 保留，没有首轮 turn，页面已关闭且不重发。该样本不能证明 CPU 调度是此前延迟的唯一原因。

附件读取现按固定 CLI 0.166 的 `threadId`、可选 `cursor`／`limit` 合同转发，每页最多 100 项。响应保留原 data/payload、可选 nextCursor 和原错误；原 64KiB 请求与 16MiB gate 响应预算不变，不放宽下游更小的传输预算。已有八字段 history binding 在写出和回执时均须仍有效，配置偏好变化不要求 writer；未知线程、账号或 owned-view 变化拒绝，不开放 add/remove/owner 方法。CLI 对未知 UUID 也可能返回空列表，因此空页绝不作为线程存在或权限证明。原 QQ 查询函数与 bka wrapper 已按固定摘要原样执行，验证 `cursor:null, limit:100`、原游标继续、缺省终止游标及真实错误传播；GUI 模型收发继续单独验证。

v27 已真实写出 `thread/attachment/list` 并收到原生 `data/nextCursor`，证明该接口已接通；共享线程 `01a1b84c-3b85-7810-b542-31227cfd8ed7` 仍未写出 turn、已保留。随后 `fs/createDirectory` 先收到适配器明确的能力错误，原创建流程取消，再有 `thread/list` 被只读 gate 拒绝；不能把最后的 gate 异常直接归给 mkdir。普通 shared 文字首轮的完整原 I2 会创建线程专属 visualization 目录并直接追加本轮 `runtimeWorkspaceRoots`，不等待 settings/update；原本地 realtime voice 设置 helper 是另一条路径。目录回执与后续 turn 证明现已实现，真实 UI 收发待验，见[目录与发送参数](shared-thread-artifacts-20261108.md)。失败页面已按原 scope 关闭，没有重发。
