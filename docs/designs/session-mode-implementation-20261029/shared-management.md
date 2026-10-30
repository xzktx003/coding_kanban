# 共享管理、生命周期与官方队列

日期：2026-10-30，持续实施。范围为已批准方案C；本文件区分服务端状态机、网页真实操作、官方原生协议和仍待组合验收的功能，不能据单测绿灯宣称174项全部完成。

## 当前实现与身份

`SessionLifecycle`在本机持久保存Resume/rename/settings/archive意图和回执；归档先关闭本看板的写入准入，等待已进入操作结束，再核对精确thread/turn/queue/Goal和原生账号/执行域。普通归档只允许空闲且无待处理队列或active Goal；显式停止并归档按顺序暂停Goal、精确interrupt、确认终态及原生队列未变化、再归档。停止失败、回执未知或其他客户端更新都停止后续步骤。它不锁外部CLI，不具有跨客户端原子CAS。

官方队列是唯一执行调度器。`NativeCodexFollowups`只投影原生queue ID、线程设置和投递确定性，不用本地timer重新turn/start。旧逐条模型/权限快照保持原文件，用户确认后才迁入官方线程设置；相同client ID不视为原生幂等保证。未知add、review和队列动作保留原操作ID，只读核对，不因queue为空推断未执行。

queue edit/delete/reorder/clear/continue以及delete→queued-steer、undo、显式retry都使用持久动作journal。每步写前绑定scope，记录已完成阶段；失败或未知不补偿、不自动重发。edit undo核对原native row及全队列指纹；删除undo保留原内容但明确确认“加入当前线程末尾、空闲时可能立即执行”。同source undo/retry另有持久fence，防止某页丢ACK、原生队列已drain后由另一页再次add。冷continue走明确的queue restore，核对相同队列ID与idle后再start，不把恢复执行语义称为只读。

网页unknown意图每个operation独占一个localStorage key，旧数组只读兼容；多个页面不会用整数组RMW抹掉另一目标回执。只存目标/namespace/参数指纹和状态，不存rename文本、审查prompt或队列正文。最多100个unknown、100个保留终态；读取有独立key/字节上限，损坏记录fail closed。不同参数的同目标inflight不会共用旧回执，核对了旧操作也不能把新的名字或归档范围说成已经执行。

列表置顶和会话菜单共用共享管理的实际ACK/CAS proof再进入全局异步undo/redo。归档不改写pin意图，撤销归档恢复导航位置且不覆盖其他设备后来的置顶操作。列表管理动作和归档设置中文化；归档设置按真实nextCursor分页、读取取消和scope代次隔离，恢复按精确行等待回执，不用整数组乐观回滚覆盖其他并发恢复。

## 本轮证据

- `server-current.log`：本轮server状态机33项通过，覆盖活动Goal/队列/精确停止/已进入writer、scope撤销、未知归档、持久回执淘汰后的重复请求及native queue动作。源码在`apps/server/src/services/{session-lifecycle,native-codex-followups,session-management}.test.ts`。
- `per-op-outbox-red.log`、`inflight-edit-red.log`、`lifecycle-outbox-red.log`保留新发现的网页意图问题；修复后`outboxes-green.log`两文件9项通过。另`management-lists-current.log`四文件22项通过，归档设置3项、中文列表与共享pin均先红后绿。`web-domain-current.log`较早检查点42项通过，不替代最终源码复跑。
- 真实网页与生产followup HTTP路由：**HTTP `http://10.30.0.24:37845`**，前端绑定`0.0.0.0`，后端为自有私有fixture，无正式Agent代理。`session-native-queue-actions.spec.ts`三项通过：1440/393最后一条原生队列删除、150ms rail退出后undo仍弹独立确认、确认前零add/确认后一次add、未发草稿保持；真实HTTP edit已接受后故意丢浏览器ACK，刷新并在同设备第二页的新编辑只GET原回执、不二次update，保留尚未提交的新输入。日志`browser-{red,green}.log`和原始附件在忽略目录`.dev-runtime/session-shared-management-20261030/`。该网页结果早于随后列表/归档设置和journal共用模块补充，最终组合需再冻结验证。
- 官方0.165.0、无登录、全新私有HOME、loopback provider：A域`daemon-native-current.log`三项通过，包含真实CLI共享审批、queue thread settings/中断暂停/冷restore不推进/明确start。C域新增`daemon-queue-actions.native.test.ts`验证真实update、同client ID不同queue ID的reorder、delete→steer保持原turn、provider实际收到steer和编辑后queued输入、只有两个完成turn。原生测试默认跳过，只有显式设置`SESSION_CODEX_DAEMON_NATIVE_BIN`才计执行。
- 新原生探针最初假定steer一定作为独立userMessage出现在完成历史，被官方原包运行反证：模型后续请求确实收到steer，但完成首轮items没有该单独用户行。保留`native-actions{,-probe}.log`，不把此原包行为算成看板修复的红绿，也不伪造native item。看板accepted steer的持久显示由正文/发送回执域继续核对。

## 逐项映射

状态“专项已验”只指所列证据；“待组合”不能作为完整功能绿灯。路径相对仓库根。

| Feature | 实现/复用路径 | 本轮证据 | 当前边界 |
|---|---|---|---|
| CMP-11 | `services/session-lifecycle.ts`、`services/apiAdapt/lifecycle.ts` | Resume持久意图/重复来源server单测；D域`session-composer-parity-20261029.spec.ts` | C状态机专项已验，完整主动作组合由D验收 |
| CMP-14 | `services/native-codex-followups.ts`、`services/nativeQueueAction.ts`、`services/lifecycleMutation.ts` | unknown/reject、lost ACK、源fence单测及真实HTTP浏览器 | 专项已验，不把accepted称为执行完成 |
| CMP-15 | 同上及`FollowupQueue.tsx` | 官方add/start/steer真实provider；HTTP edit/undo | native和重点网页专项已验，全部运行状态组合仍待G |
| CMP-16 | `SessionLifecycle.archive`、`NativeCodexFollowups.stop/change` | 官方中断保留queue、cold restore静默、显式start | 原生专项已验，无独立queue pause API |
| CMP-17 | `native-queue-actions.ts`、`operationReceiptJournal.ts` | lost add/delete/undo ACK、刷新/双页GET原回执 | 专项已验，未知不重发 |
| CMP-18 | `NativeCodexFollowups.change`、`FollowupQueue.tsx`、`QueueReorder.tsx` | edit/delete精确身份、真实native update/reorder；D现有sort测试 | 正式新原生路径已补；当前网页拖动组合待复跑 |
| CMP-19 | `QueueMessagePreview.tsx` | D域preview/tooltip/Markdown组合测试 | 非本域新增；当前原组件视觉由D/T记录 |
| CMP-20 | `FollowupQueue.tsx`、`SideChatPanel.tsx` | native queued-steer；队列toggle/side chat按D测试 | 旧冻结配置转官方线程语义，不能宣称逐条冻结等价 |
| CMP-21 | `FollowupQueue.tsx` | 1440/393真实队列删除/undo | 已验关键操作；全部长队列组合待D/G |
| CMP-22 | `ComposerRail.tsx`、`UndoNotice.tsx` | 真实150ms退出后undo红→绿；42项rail/recovery检查点 | 不依赖已卸载rail持有确认 |
| LG06 | `sessionNames.ts`、`ThreadList.tsx`、`lifecycleMutation.ts` | 名称修订/原生name预检/异步undo、参数指纹单测 | 当前网页全流程待最终冻结 |
| LG07 | `ConversationMenu.tsx`、owner forms | 同上及owner form既有测试 | 本轮末次组合待复跑 |
| LG08 | `archiveThreadUndo.ts`、`appActionHistory.ts` | archive feedback/owner forms回归 | 异步历史不提前移动stack |
| LG09 | `appActionHistory.ts` | pending/失败/后提交动作/迟到ACK单测 | C专项已验，D菜单状态共享 |
| LG10 | `ThreadList.tsx`、`ConversationOwnerForms.tsx` | 中文archive feedback单测 | 仅在已确认native成功后移出导航 |
| LG11 | `SessionLifecycle.archive`、owner form | 普通归档/停止并归档分离、精确turn反例 | 未确认停止则不归档；外部CLI无原子锁 |
| LG12 | 同上 | queued/uncertain/active Goal/admission writer测试；官方queue+Goal pause | 不批量停止子Agent |
| LG13 | `archiveThreadUndo.ts` | 导航原顺序/保留草稿/异步undo回归 | pin意图保持，不恢复旧pin覆盖新设备操作 |
| LG14 | `ArchivedThreadSettings.tsx` | 原50条无续页红→nextCursor/去重/错误重试绿；1440/393真实网页2项 | 当前专项已验，真实服务长归档集不属fixture证据 |
| LG15 | 同上 | 中文/并发恢复/账号切换3项及1440/393逐行失败重试网页2项 | 网页局部错不卸载工作台 |
| LG16 | `ThreadList.tsx` | 中文菜单新增红→绿，相关4文件24项检查点 | 原native引用不改，仅自有列表本地化 |
| LG17 | `ConversationMenu.tsx`、`ThreadList.tsx`、`sessionManagement{Client,Sync}.ts` | 共享pin实际ACK；跨页消费回执红→绿19项；桌面/手机双页pin/unpin/旧undo拒绝网页1项 | 同浏览器两页模拟设备；0任务写入，未称实体双设备已验 |
| LG18 | `sessionManagementClient.ts`、`useSessionReadReceipt.ts`、management routes | A/readsync域原生revision必填、双context真实HTTP | 由readsync域维护详细证据 |
| H10 | `SessionManagement`、`NativeCodexFollowups`、`SessionLifecycle.write` | namespace、操作window、原生scope和队列intent单测 | 自有门禁不约束外部CLI |
| H11 | `operationReceiptJournal.ts`、共享管理sync | per-op key/metadata-only、旧格式兼容、late unknown不降级 | 不是VSCode atom桥 |
| H12 | 共享管理read/pin通道 | A/readsync域双context HTTP、native read-state CAS | 没有跨客户端native事务CAS |

## 尚未闭合

最终server总套件已在本域执行1135项：1134通过、0失败/取消、1项macOS专属扫描跳过，36.95秒；日志`server-all-final2.log`。前端领域15文件117项（`web-complete.log`）及跨页共享管理2文件19项（`management-cross-page-ack-final.log`）、生命周期跨operation ID18项分别有当前专项证据。HTTP42993的组合中归档分页/恢复2、queue撤销/丢ACK3、HTTP复制3已通过；列表专项更新完整native范围fixture后1项绿（`browser-list-final2.log`），导航DOM位置只读poll修正后2项绿（`browser-pin-final.log`）。当前自有HTTP `http://10.30.0.24:36485`（绑定`0.0.0.0`）的desktop/393手机双页pin/CAS撤销1项绿（`browser-pin-green.log`，8.4秒）；共有12项分别具当前专项绿灯，没有单一12项同批summary。30关注/4窗格/3页面性能和长时间RSS由总台账独立汇总。新源码未自动切换正式运行层，没有为本域验收停止正式Agent、共享daemon或活跃Harness。


## 本轮末次加固

- 生命周期收据按table/operation ID增加临时claim，再进入原thread锁；相同UUID同时指向不同thread的rename/settings/resume/archive最多一个原生写，另一请求冲突，持久回执不被另一目标覆盖。四项先红，18项生命周期回归绿。
- `NativeSteerReceipts`使用固定meta、编号冷segment和哈希source文件。每段512项/8MiB，超过后换段而不限制累计消息次数；读取只扫描最多512索引项并返回最近30条/1MiB，空页可以有更早游标。旧正文只在磁盘，不建立全局内存历史。持久native identity索引对重复来源保守标歧义，原生相同client ID不是幂等保证。
- 可信完成卡片持久绑定读取时原scope/namespace；完成记录前后范围变化拒绝，链式回复继承原来源。旧卡片不能被回放成当前授权，sameUUID跨namespace、同值账号新修订和运行实例变化都拒写，最终guard用原scope。实际卡片与native queue的HTTP集成验证跨重启只有两次add、不重复调度。
- 原独立item-detail测试依赖隐式私有app-server不再符合共享daemon默认；改为第4个程序内参数显式注入受控fixture launch，HTTP launch字段400、只读initialize/initialized/thread/read及确切owned PID退出均核对。生产调用不传参数，仍只连接共享daemon；没有环境变量或HTTP逃生开关。
- Native list读到的名称初始化独立name store，保护首次关注时的名称不被preview fallback覆盖。未把名称改写到消息preview，也不覆盖manual名称。

- 跨页共享管理ACK先写独立有界metadata回执再删pending：完整绑定operation ID、原window、目标namespace/kind/id及action指纹，原页面可读取其他页消费的确切ACK。最近64项/512KiB、单项64KiB、15分钟有效期；账号变化、参数/目标/window不符拒绝，不重发原mutation。双页真实菜单反例先暴露原页面无undo，再修复并通过19项共享管理单测与1项desktop/phone浏览器。

## ACP同native ID多owner历史分域

两个真实独立stdio进程、不同connection/agent均返回`s1`时，旧SQLite只保留一条owner-b记录，混入alpha与beta两方正文。精确connection权限Map没有串审批：B不能回复A的request ID。红例日志`acp-owner-collision-red.log`。

新`historySessionId=acph_SHA256([runtimeInstance,connectionId,agentId,nativeSessionId])`只作本地持久只读源键；RPC保留native`sessionId`。`acp_sessions`只增加native/runtime/connection元数据列，不重建updates大表；新record.sessionId是source，旧裸ID行标`historyScope=legacy`，保持原位只读，不按相同native ID猜归属。start/new/load/snapshot与SSE携带source，Bot本地读结果也使用source。fresh source的显式native load直接逐条保存实际回放并标`historyReplayed:true`；同source已有历史再load不重复。重启读取不启动进程，不复制旧DB正文。双owner/同agent新connection/legacy隔离/实际native replay/SQLite重启与既有ACP权限执行状态共24项及runtime类型检查通过；前端双ID组合与实际多owner浏览器由B/G域继续收敛，不以本后端专项代替。

补充生命周期和删除保护：ACP v1 的 `session/load` 成功结果可为 `{}`，运行层将精确 JSON-RPC 请求捕获的 native ID 投影回响应，不将其描述成原生回显。若额外 `sessionId` 与请求不同，或 new/load 的结果类型不合法，则保留 `DELIVERY_UNKNOWN`，阻止后续写入；不按失败自动重试创建或加载。七项畸形结果与合法空 load 响应均用真实私有 stdio 进程验证。删除 scoped 历史前再核对原 runtime/connection/agent/native ID；原 owner 仍运行、待审批或回执未知时返回 409，旧页面不能绕过 UI 删除后台任务的持久历史；不停止进程或发送 cancel。

本次后端收口证据：`acp-active-history-delete-red.log` 的实际双 owner 待审批反例先失败；修复后 `acp-owner-final-green.log` 中 29 项 ACP 服务、历史来源、SQLite/回放和生命周期专项通过。日志位于忽略的 `.dev-runtime/session-full-implementation-20261029/`，不以此替代前端多 owner 或最终全量验收。

Bot 历史的旧清理逻辑另将 `title IS NULL` 当作空会话；真实 load 回放没有本地首问标题，后开连接会删掉该来源及正文。新 scoped 注册不自动清理其他来源；旧未绑定注册的兼容清理也只触及无 updates、无 runtime/connection/native 绑定的空行。零 updates 不能证明另一个 owner 空闲，可能尚未收到首个响应、正在 load 或回执未知。未命名但有真实更新的来源也出现在 Bot 历史列表，以原 source ID 读取。`acp-bot-replay-prune-red.log`、`acp-bot-replay-list-red.log` 分别复现误删和列表遗漏；修复不复制正文、不启动 Agent，也不改已命名历史。

按[ACP v1 官方 Session Setup](https://github.com/agentclientprotocol/agent-client-protocol/blob/main/docs/protocol/v1/session-setup.mdx)复核，运行层在分配 load 来源或发出 RPC 前要求实际初始化的 `loadSession === true`。缺失、false、字符串 true 的三项真实 stdio 反例先红后绿，均保持原会话可用、原请求日志不存在且不设置未知。load 已发送而结果畸形时，尚未加入 sessions 集合的部分来源也受原 owner 未知状态保护，不能被旧删除请求清空。最终 `acp-backend-complete-green.log` 的 34 项覆盖服务、双 owner、生命周期、能力门控及 Bot SQLite 保留；最终全量运行层结果另列。

追加两项真实 SQLite 红绿：同 Bot 的另一 connection、另一 runtime 注册前，原 scoped owner 尚无正文更新；旧逻辑会删其身份行，晚到原生输出因而无法按原来源恢复。修复后空来源仍不显示在 Bot 历史列表，但 owner 行保留，后续原连接输出写入原 source，另一来源保持为空。`acp-pending-bot-owner-red.log` 两项失败，`acp-pending-bot-owner-green.log` 五项通过；显式删除仍走既有活动/审批/未知保护，不隐式 cancel。
