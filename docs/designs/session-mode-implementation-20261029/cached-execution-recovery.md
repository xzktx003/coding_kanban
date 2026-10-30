# 刷新缓存与当前执行状态的确定性

原用户问题是刷新后先显示「已中断」，稍后又出现回答。独立历史 reader 的执行字段已由精确 owner 小快照修正，但设备 IndexedDB 仍可能存着旧版本错误推断的 `interrupted`。此前 cache restore 绕过 HTTP 历史的执行纠正，甚至在已经确认同一轮运行/完成/失败后重新发布旧红标；反向顺序中，后来到达的 activity 只改 timing，不改已经显示的旧终止行。

## 正文恢复与执行证据

- 设备缓存仍只恢复有界正文，不恢复执行权、审批、当前轮次或任务能力。最新一条 cache-only 中断在缺少新原生证据时显示中性「正在核对轮次状态」；更早的历史中断保留。状态标记是纯内存 WeakSet，HMR 只复用弱集合身份，不加到 native DTO 或磁盘记录。
- 工具投影也不能把这条未核实结束推断为工具中断/成功。展示层的 `unverified` 与 native `TurnStatus` 分开；命令、MCP、图片、压缩及网页活动保持中性，工具自己明确返回的失败/完成/中断仍保留。不伪造 inProgress、Stop、Steer 或权限。
- `nativeTurnExecutionProof.ts` 用 WeakMap 绑定**实际接受后的 timing 对象**、精确 thread/turn、操作代次、账号类型/namespace/确认状态及 API endpoint/认证来源。只有原生 SSE 生命周期、受保护 activity 查询或实际 turn/start ACK 能登记；缓存、历史推断、乐观状态、另一个对象或另一个 thread 均不能充当证据。原生观察之后账号同值通知、运行代次、endpoint/token 变化都撤销旧证据；这些字段不写磁盘，不是跨客户端 CAS。
- proof 先到时，设备恢复只纠正精确匹配的旧中断，保留其他历史轮次。缓存先到时，activity/SSE 接受 proof 后立即修正对应正文投影，不等待完整历史或最终回答。确认真实 interrupted 后，中性行恢复为真实中断；completed/failed 使用真实结论；inProgress 移除错误结束行并保留正文与实际当前轮次。
- 原先在 cache 启动前就收到的 native 正文也会保留，合并后先执行既有 8MiB 显示预算再发布。IDB 的单条 2MiB/总 30MiB、warm 总额、60 秒宽限及 dormant 不复活规则不放宽。

## 有界核对和相同正文

缓存发布最新待核实状态后只发本地 `session-cached-execution-pending`（detail 为 thread ID）。现有状态同步核对关注成员，走原 64KiB/15 秒 activity 通道；没有开启新轮次、resume/acquire 或完整历史轮询。active 但 timing 尚无当前证据时只核对一次；证据仍有效时不重复查询。idle 的待核实缓存也能读取精确最新轮次，确认真实结束。

fresh history 与 cached interruption 的 JSON 可以完全一样，但确定性已经改变。`mergeHistoryPage` 在“相同快照不通知”前比较纯显示标记，不能把刚核实的原生记录退回旧的未核实对象。普通相同正文、引用及确定性未变的快照仍不通知。

## HTTP 读取来源隔离

额外红灯证明：旧 endpoint/token 的 held Codex 历史响应可以在换设备后发布；同 thread/page 的新读取还会复用旧请求。现只读请求在排队前捕获完整内存来源，发布/错误前复核，Pairing 变化及时取消并锁存撤销，A→B→A 不复活旧读取。相同来源及完整参数/游标的消费者继续共享，改设备显示名不取消；新来源使用独立队列身份，凭证不进入队列 key 或持久 journal。取消仍等待原有有界 native reader 清理，不放宽 RPC/正文预算，不重发任何用户操作。

最终跨层审查另复现了两个遗漏入口：最近页之后独立读取的轻量 metadata，以及项目会话列表，只检查 account/epoch，尚未等到新账号确认时 endpoint/token 已可能变化。metadata 现也在排队前捕获完整来源，取消排队需求和在途 transport，发布模型/原生权限及 thread 元数据前复核；同源重复需求共享，新来源不能加入旧请求。列表使用同一来源租约和最新请求身份，既拒绝跨源返回，也拒绝同源不同项目的旧成功/错误覆盖新列表和 cursor。取消锁存支持 A→B→A，结束或撤销释放临时 Pairing 订阅，不引入常驻监听，不改变公共操作 scope、草稿或 native writer。

对应 `codexService.metadata-source.test.ts` 12 项覆盖 endpoint/token、A→B→A、metadata 新源去重、队列等待期间换源、同源快速切项目、旧失败不清新列表及订阅清理。先在独立忽略目录确认四个真实跨源反例，再将完整回归放入仓库；清理正确的正式红灯为 11 红 1 绿，修复后 12/12 通过。原始日志在 `.dev-runtime/metadata-scope-review-20261030/{red,formal-red-cleanup,green}.log`。此前性能及长测冻结早于这项补丁，不能直接冒充本补丁的最终源码验收。

## 红绿灯与验收边界

本轮保留的反例为：缓存覆盖已确认同轮结论 3 红、endpoint/token held body 与错误去重 4 红、fresh 同 JSON 确定性被吞 1 红；分别转绿。最终专项 `native-cache-source-unit-final-2.log` 为 11 文件 184 项；工具/显示补充为 14 文件 140 项，实际前端 tsc 通过。日志在忽略目录 `.dev-runtime/session-management-read-20261030/rss-diagnosis/`，工具补充日志由正文台账记录。

`session-cache-execution-recovery.spec.ts` 使用独立 **HTTP LAN `http://10.30.0.24:37985`**（绑定 `0.0.0.0`，2885 文件冻结）。真实浏览器 IndexedDB、实际 reload 与原生 EventSource 连接；业务 API 均为隔离 fixture。两种尺寸覆盖 proof 先到、cache 先到，以及随后真实 inProgress/completed/interrupted 三种核对。cache-first 断言期间完整历史及最终 SSE 都被封锁，必须先显示缓存正文/中性状态，再独立由只读 activity 修正，保留草稿、较早真实中断及展开工具；任务写入为零。这不是实体手机或正式账号任务的证据。

首次 browser 2 红来自夹具在 held IDB 期间确认初始账号、正确撤销旧读取；现将该场景保持在同一未变化的来源 lifetime，撤销另有专门单测。另一次误填未监听端口的 8 连接失败单独存为 `wrong-port-*`，不计产品红灯。

组合先后出现 7/8、6/8：两种尺寸的 inProgress 用例在点击「展开全部」之前断言较早 commentary 可见。原生 IDB get/put 摘要和退出前 store 诊断均证明四条缓存事件、正文及中性状态已经恢复，`proof:false`、无读取错误；较新工具活动按已批准的「默认最新进展」设计折叠了之前的 commentary。仅纠正浏览器操作顺序，先等待缓存实际恢复、展开对应轮次，再检查全部正文和工具；产品代码、状态断言、预算均未修改。最终整组 **8/8 通过，34.3 秒**，记录 `cache-execution-expanded-final.log`。此前失败、单项诊断及完整状态附件一并保留，未用单项通过替代整组验收。

这项修复不替代两秒多页性能、原始 30 分钟 RSS 门槛、共享官方 daemon/CLI 或正式部署验收；它们继续由总台账单独记录。
