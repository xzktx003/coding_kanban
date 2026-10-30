# 多会话预热、恢复与性能实施记录

2026-10-29；本记录对应已批准总方案的 B/G。工作区原有首屏、共享读取、Claude/ACP 虚拟化和同步修复继续复用，不将此前工作改写为本次新成果。全量交付与最终验收以主工作流记录为准。

现行规则已统一：2026-10-30用户后续明确“统一为预算允许时持续保温”。全部关注最近页预加载，无偏好默认 `warmFollowedSessions: true`，预算充足时持续保温，可见正文优先，压力或超预算回收后台。显式false继续约60秒不可见回收且不后台再热，已有true/false不迁移。新的current整合及无偏好默认保温/压力浏览器验收正在推进；v5默认false的自然回收与数值保留为历史阶段，不改称新默认已验。各次源码和实际状态见[主验收记录](../session-mode-user-experience-acceptance-20261029.md)，标准30分钟RSS红灯继续保留。

## 本次实现

| 链路 | 修改与约束 | 对应范围 |
| --- | --- | --- |
| 近期正文留存 | 默认预热全部关注会话最近页，资源充足时保持，受原16MiB共享预算和可见优先规则约束；只有设备明确关闭warm才按原约60秒离屏回收。压力或超预算回收后台，休眠正文不被迟到事件重新填充。 | B、G、T39–T44、H05/H09/H17/H21 |
| 设备策略 | “预热关注会话”无偏好时默认true，依据2026-10-30后续明确答复，与用户Q5/Q8和已批准主方案§5.3一致；设备已有true/false原样保留，不批量迁移。显式false为原约60秒回退且不后台再热，不影响任务、审批、未读、草稿和原生历史。旧默认存储的true不能被解释为用户明确选择。 | B/G、M38 |
| 预算 | 单线程显示准入原 8 MiB 不变；原 governor 背景总量高水位 32 MiB、目标 16 MiB 不变。warm 使用其中 16 MiB 低水位，先计可见正文、后台正文、独立旧基线及流式缓冲，属于同一数据的治理，不增加第二份缓存。原阅读窗口的明确额度保持。 | B、G、G26 |
| 回收后恢复 | dormant 仍禁止 delta、迟到历史及设备缓存恢复重新持有正文。仅开启warm、资源低于 12 MiB 且回收满 60 秒后，才可通过既有预算准入申请一次只读再预热；显式false不后台再热。按上一实际体积预留，至少 64 KiB，每轮只准入一个，等待新结果再决定下一页，防止旧小体积预测引起批量突发。必须有接受该精确 thread 的近期页 reader；非关注观察子 Agent 或迟到保留链接不能被无关的全局 listener 唤醒，也不能占用本轮预热资格。 | B、T41/T43/H09 |
| 任务保护 | 正文治理不触碰运行状态、审批、未读、草稿或 Goal。正在核对历史、翻页、未知回执的正文保留；确认的 native client ID 回执先结算，再允许回收。 | B/G、CMP13/14、LG01 |
| 多窗读取优先级 | 当前聚焦目标优先，然后全部实际可见窗格，再后台关注。恢复的 split 布局在正文挂载前即可提供显示目标，避免先启动无关的慢后台读取；手机只认当前窗口组。新显示窗格提升同一现存逻辑读取，不增加消费者或重发请求。隐藏浏览器页、隐藏会话模式及二级页的旧选择不会获得前台优先级。 | B/G、T54、CMP03、H09/H21 |
| 并发 | recent/history/status 仍为 3/2/1，总 6；recent 实际后台运输至多 1。外层仅为最多四个可见窗格预留逻辑排队需求空间，所有运输仍经过同一个共享准入器。原有公平性、原生 reader 预算和 deadline 不放宽。 | B、H17/H21 |
| 精确读取合并 | dedup 身份包含当前运行/账号 scope、完整读取参数（recent 投影、cursor、afterTurnId）及游标恢复语义。不同页面先等待前次读取，等待后重新检查同页是否已被其他消费者准入；不把近期页当作完整历史结果，也不重复启动同一后续页。 | B、T39/T40/H17/H21 |
| 刷新执行状态 | 独立 recent chat reader 推断的 interrupted 不覆盖同一精确 turn 已知的原生 active/inProgress 或 completed/failed；修正发生在事件投影前，避免状态控件正确但正文仍闪错误中断。原生 idle 时仍接受真正 interrupted。缓存目标切换使用精确 native active timing 保留当前 Stop 目标，不从较老终态行推断当前轮结束。 | G、T43、H05/H09 |

核心实现：`services/sessionWarmRetention.ts`、`codexTranscriptActivity.ts`、`sessionTranscriptRetention.ts`、`followedSessionHistorySync.ts`、`codexService.ts`。warm策略仅持有数字、身份和时间，不保存正文或native写权限，不扩大既有字节、并发或RPC预算。以下保温/压力实测对应各自冻结源的开启分支；v5无偏好默认false的约60秒自然回收记录保留为历史阶段和显式false回退证据，不替代本次新默认的current组合验收，见[本轮体验记录](../session-mode-user-experience-acceptance-20261029.md)。

## 红绿灯与当前证据

真实旧逻辑先复现三项失败：小体积关注页在 120 秒时已被清除；第二至第四可见窗格未获 interactive 准入；隐藏浏览器页的保存选择仍被当作前台需求。另复现近期页和完整读取在并发时只执行一次、把错误投影交给完整读取消费者。修复后相应测试转绿。

局部回归命令：

```sh
pnpm --filter web exec vitest run --config vitest.session.config.ts \
  src/session-mode/services/sessionWarmRetention.test.ts \
  src/session-mode/services/codexTranscriptActivity.test.ts \
  src/session-mode/services/sessionTranscriptRetention.test.ts \
  src/session-mode/services/followedSessionHistorySync.test.ts \
  src/session-mode/services/sessionReadQueue.test.ts \
  src/session-mode/services/sessionMemoryGovernor.test.ts \
  src/session-mode/services/codexService.test.ts \
  src/session-mode/services/codexHistoryCancellation.review.test.ts \
  src/session-mode/services/sessionTranscriptCache.test.ts \
  src/session-mode/services/sessionTranscriptCache.hmr.test.ts
```

2026-10-30 00:12 的检查点为 10 文件、124 项通过，日志 `.dev-runtime/session-multisession-20261029/unit-final-3.log`；另有原执行控制/状态同步/阅读保护 3 文件、54 项通过。新增覆盖恢复 split 与手机优先级、等待后再合并、同 turn 错误中断投影和无 reader 不得唤醒；均保留对应旧行为失败记录。工作环境 owner 的原生 cwd 校验新增后，四项旧 fixture 缺合法 cwd/未清自有意图一度失败（`unit-final-2.log`），修正 fixture 后转绿，没有放宽生产校验。这不是全部最终整合源码的测试结论。

策略回退另有 `warm-legacy-red.log`（2 项原行为失败）与 `warm-switch-red.log`（原设置无该开关），加入设备字段、策略分支和真实设置控件后，3 文件20项通过（`warm-legacy-green.log`）。原策略浏览器分支已加到 `session-idle-memory.spec.ts`，等待新源码冻结实测，不把单测假时钟计作真实释放验收。

新增 `session-refresh-interruption.spec.ts` 在冻结 HTTPS 43577 上通过 1440/393 两尺寸（2 项16.1秒）。各自三次真实刷新，原生 EventSource 先证明同一精确 live turn，之后迟到的独立 reader 错误中断不得落正文或闪红；当前轮、空输入 Stop、带草稿的 Queue/Steer、持久草稿及最终回复均正确，0隐式 native 写入。`refresh-interruption-completed-fixture/` 保留 JSON。该夹具不替代真实 daemon/实体手机，且先证明 live turn 的顺序被明确限定；首两次夹具错误（带稿仍要求 Stop、完成后持久历史没有最终回复）记录保留，不计作产品故障。

### 真实时钟、EventSource 与物理回收

冻结 HTTP LAN `http://10.30.0.24:5173`，绑定 `0.0.0.0`，全部业务 API 隔离。快照源清单 2703 文件在 `.dev-runtime/session-multisession-20261029/frozen-1793287147882/source-manifest.json`；该自有监听器完成后已按 PID/start ticks 核对关闭。

`session-idle-memory.spec.ts` 保留原物理释放、晚事件不复活、正确完成回复、未读、审批、草稿、只读重显和音频释放断言，并增加真实等待 120 秒 warm 的前置。之后用九个 1 MiB 的 completed-item SSE 快照触发既有入站显示压力信号；单帧仍小于 16 MiB，正常 retention 定时器完成回收，没有直接调用 release、强制 GC、刷新或停止 Agent。

| 阶段 | 秒 | JS heap MiB | backing storage MiB | renderer RSS MiB | 正文 |
| --- | ---: | ---: | ---: | ---: | --- |
| 初始三会话 | 0.029 | 58.46 | 25.57 | 382.61 | 三会话各 16 事件 |
| 资源充足 warm | 120.056 | 45.23 | 24.04 | 246.57 | 三会话仍各 16 事件 |
| 压力后自然回收 | 123.550 | 118.86 | 35.07 | 424.81 | 当前 18，后台两页为空 |
| 只读重显 | 155.626 | 102.21 | 24.59 | 388.38 | 当前及恢复目标各 18 |

四次均为 renderer PID `132180`、start ticks `220588115`，无页面错误或采样缺失。用例 1 项、2.7 分钟通过；完整证据 `.dev-runtime/session-multisession-20261029/warm-pressure-browser-items/**/idle-memory-observations.json`。数值为自然采样，不是 retained/private/PSS 或长期泄漏归因。

首个失败夹具保留于 `warm-pressure-browser/`：同一 item 的大 live delta 在压力计数前已被合并和裁剪，没有达到声明的压力前置，所以后台保温是正确结果。后续改用原生 completed-item 快照，明确覆盖真实计数通道，不改生产压力阈值。

长测原有负载、自然 GC 窗口和 heap/RSS 阈值保留。资源充足时后台不再要求为空，改为 8 MiB 单体、16 MiB 后台 warm 的明确字节上限；物理 dormant 空身和迟到不复活由上述增强用例承担。此前 30 分钟 RSS 红灯继续保留，须在最终冻结源码重新验收。

## 多页两秒验收

新增 `tests/e2e/session-multisession-performance.spec.ts`：每轮全新 context，同步加载三页；每页 30 个关注、四个真实 split 正文窗格与唯一 composer。逐页独立记录导航、可编辑输入、精确 `data-owner-thread`、无缓存四正文及实际按键后两帧，不合并各页分布。正式模式每页 30 样本，报告 p50/p95/max，界面 p95 ≤ 2 秒、输入两帧 p95 ≤ 100ms。无缓存正文另列。

`SESSION_PERFORMANCE_DIAGNOSTIC=1` 只执行一轮定位，标题和 JSON 明确 `acceptanceEligible:false`，不计正式验收。原生 EventSource 与即时隔离 API 只证明 UI/读取客户端路径，不能证明官方 daemon 读盘、模型首字或实体手机时序。

HTTP 检查点三页首轮 composer 为 8.64–8.71 秒、四正文 9.58–9.60 秒，保持红灯；HTTP/1 的 ESM 连接调度与日常 HTTPS/HTTP2 入口不能混为一项。正在使用独立私有 TLS、同源 HTTP2 冻结入口定位模块瓶颈；修复后才执行正式 30 轮。部分早期夹具把显示名当作目标、以及把主动关闭的 Vite WebSocket/正常取消请求当成产品错误，已修正为真实 owner 身份并分开诊断，错误原记录保留。

首个 HTTPS 冻结的真实三页 composer 为 9.239/6.086/9.192 秒。拆分 composer 菜单、模型完整选择器及正文 renderer 后，新快照 `frozen-1793290148990` 首轮为 3.152/3.187/3.205 秒，导航 2.586–2.751 秒，完整四正文 9.064–9.919 秒，输入两帧 49.6–69.7ms。相同服务已变换模块后重新建立全新 browser context，composer 仍为 2.600/2.589/2.616 秒，输入 37.2–94.2ms，证明剩余红灯不能仅归因服务初次转换；两轮都是诊断，未计 30 样本验收。`three-page-https-deferred-diagnostic/` 与 `three-page-https-deferred-warmserver/` 保留逐页数值与脚本时间线。full body 的判定明确排除 `data-transcript-preparing`，准确预览也不冒充完整正文。

后续加入开发图标精确 named-import 优化的根工作流检查点为 HTTPS LAN `https://10.30.0.24:43577`，`0.0.0.0`，2759 文件（`frozen-1793290595376`）。对应 Vite 配置与插件另存 `configuration-manifest.json`，不只给正文源哈希；不代理正式 API，全部用例必须自行装隔离夹具。

最终源码正式 LAN、多页性能、网络投影、恢复/审批组合及 30 分钟结果由根工作流继续汇总；当前没有宣布这几项全部通过。

## 2026-10-30 辅助 Agent 正文与已有连接恢复

CC/ACP 的正文使用同一份 16 MiB warm 账本、8 MiB 单体与 60 秒不可见宽限；没有另建第二份正文缓存或第二个回收定时器。已有显式保温偏好控制资源充足时的行为，资源压力仍回收不可见正文。可见消费者、当前读取及 ACP 尚未收到本地持久 ACK 的用户行受保护。CC 回收后仅保留未处理审批和有界任务结果；ACP 正文清空时保留运行、精确审批、连接和设备草稿。只读详情、原图与旧记录面板只上报实际持有字节，不向账本复制正文。

ACP live 与 recent 使用真实源行 ID 合并；迟到最近页不能覆盖其快照之后的增量，真正的向前页保留原始游标。乐观用户行仅通过同一 Agent/connection/session 的 `prompt-persisted.clientMessageId` 关联，文字相同不合并；该 ACK 只确认本地历史持久，不代表原生接受或幂等。工具行保留网关截断标记、源详情及图片入口。旧运行层无源 ID 的晚事件也不能重新填充 dormant 正文。

浏览器仅在本页面 `sessionStorage` 保存有界的 endpoint/runtime/Agent/connection/session 指针，不保存模型、权限、消息或任务结论。首次 layout 先建立输入屏障，随后 `connection-snapshot` 核对原实例的实际运行与审批；失败保留草稿并明确阻止误发，不能自动新建、load 或替代原连接。账号/设备、用户选择及读取代次变化取消迟到结果；runtime 重启重新只读核验同一 owner。ACP 事件桥改由持续挂载的应用壳负责，切换到 Codex/Claude 或机器人页后仍跟踪审批与状态，正文继续受 dormant 判定保护。

不支持 `loadSession` 的 Agent 打开旧记录时，新的原生会话是唯一输入目标，旧历史在单独“旧记录仅供查看”面板中按最近页/向前游标展示，明确其不属于新原生上下文。详情绑定旧源 session 和当前 viewer 双 scope；关闭、不可见或换目标立即取消释放。没有完整 raw 历史回退或把旧正文伪装为新上下文。

当前源码组合 `provider-domain-current.log` 为 24 文件110项通过，`provider-current-types-4.log` 前端类型检查通过。新增缺失模块、并发源合并、恢复屏障、runtime 重验等红灯及对应绿灯保留于本轮忽略目录；正常 Abort/旧读取代次取消不发布“加载失败”或控制台 error。

独立冻结 HTTP LAN `http://10.30.0.24:44443`（`0.0.0.0`，2835 文件）源及配置清单位于 `.dev-runtime/provider-closure-20261030/frozen-1793297803509/`，manifest 包含 Vite 外部 source map 插件。`session-provider-recovery.spec.ts` 的前一冻结 LAN 41473 上，1440/393 两尺寸共2项通过：每尺寸三次真实刷新，同一已有 ACP 任务、审批、草稿与实际 source-ID 后续正文均正确，所有隐式 start/new/load/cancel/stop/prompt 为0。该测试使用原生 EventSource 与隔离 HTTP snapshot/recent；真实 ACP 子进程/SQLite 的无 RPC 证明见[辅助历史](auxiliary-history.md)，不混称已连接正式 Agent。

`session-provider-memory.spec.ts` 在44443上首轮132秒通过：先由只读 recent 实际填入两CC及一ACP后台正文，真实等待120秒保温，再用原生 completed-item SSE 触发既有流量压力；正常 retention 定时器释放三者正文，审批/运行保留、迟到事件不复活，CC标签和ACP正文重显只读恢复。没有伪时钟、直接 release、强制GC、刷新或停止任务。观察包含 heap/backing storage 及 renderer PID/start ticks/RSS；恢复时短时分配峰值不计作长期稳定。最终增强的晚审批与自然settle观察、标准30分钟自然GC长测以及正式30轮两秒计时结果继续在下方追加；此前RSS红灯和两秒红灯没有提前撤销。

## 2026-10-30 隐藏历史项目面板与关键图诊断

`DeferredHistoryProjectsDialog` 常驻轻量事件入口，只有显式历史项目手势才读取完整弹窗；原组件的 `initialOpen` 保留首次手势，加载失败/接口不符本地重试，取消、隐藏模式和迟到下载不会重新弹出。已经挂载的原面板继续保留状态。所有 BrowserProjects/ProjectSelector 调用方改为直达模块，消除 barrel 把闭合弹窗重新拉回首屏的旁路。

实际手机反例是加载提示在项目列表 Sheet 外：取消按钮可见，但 Sheet overlay 拦截点击。现复用 session Dialog/Portal 及交接焦点保护。4 项新行为单测加6项原项目流程共10项通过；`tests/e2e/session-history-dialog-loading.spec.ts` 在自有冻结 HTTPS LAN `https://10.30.0.24:41881` 真实1440/393按钮各1项通过。模块在首手势前请求0次、取消后不迟到打开、再次打开只请求1次，原composer草稿保留；没有强制click或放宽遮罩断言。日志 `.dev-runtime/session-management-read-20261030/history-dialog-{red,green,browser-mobile-red,browser-green,types}.log`。

额外 CDP 单轮诊断在32983冻结版本确认：同步准备正确输入目标后，nav后的React主长任务由约367ms降到256ms，晚到的 restoredInputTarget 回调不再触发第二次完整composer挂载；Lexical self约24ms、GC约21ms，其余主要为React通用render/commit。该次有功能浏览器、单测和CDP采样争用，三页nav1.69–1.79s/composer2.08–2.15s，明确不是正式30样本或两秒通过；原始profile在 `cpu-32983/`。最终多页p95、长测和实际正式源版本仍由主验收单列。

## HTTP JSON 消费与未知回执

公共HTTP响应改为字节流解码、错误只读一次；完整Chrome负结果与精确headless原生分配对照分别记录，不能把它们当作完整页面长期内存通过。409错误正文丢失不再误判明确拒绝。红绿及实际HTTP浏览器证据见[响应消费与回执](json-response-memory.md)，最终30分钟原门槛仍由冻结验收单列。

## 2026-10-30：ACP 多 owner 与精确历史来源

ACP `sessionId` 由各独立进程定义，允许两个进程同为 `s1`，不能用它唯一读取应用历史、定位草稿或选择侧栏记录。运行层生成独立 `historySessionId`；原生 RPC 仍传原 native ID。应用最近页、详情、已读、文字/图片草稿、文件/技能输入旁路和会话名称使用精确历史来源；历史 owner 查找要求唯一 Agent/source/endpoint，不按“最近相同 native ID”替换。旧 bare-ID 草稿保留，只有明确导入操作才能迁移。

新聊天不再使用中断确认：明确空闲可在现有进程 `session/new`；运行、待审批或回执未知时保留原连接并创建独立连接。仅新手势创建且未被采用的空连接可按原范围关闭，不能清理已登记 owner。结果迟到、选择/目录改变、账号同值撤销均不能替换新选择。元数据 registry 使用原 128 项/1MiB 本页资源预算，仅闲置项可回收；运行、待审批和未知 owner 不为腾位置被停止。已有 owner 返回区持续显示后台审批，并通过只读 snapshot 后恢复精确输入目标；这不是把 ACP 加入跨设备共享的 `FollowedSession.kind` 集合。

点击持久记录只打开独立只读面板，原输入目标、任务和草稿保持。面板的“继续此会话”才在新连接执行原生 `loadSession`；没有可核实 native ID 或不支持加载时只建立新上下文并保留清楚分离的旧记录。浏览器刷新只读核对已保存连接，不自动 start/new/load/cancel/stop/prompt。

专项证据：`session-acp-multiowner.spec.ts` 在冻结 HTTPS LAN `https://10.30.0.24:37513`（绑定 `0.0.0.0`，2860 文件）1440/393 两尺寸共2项、13.4秒通过。真实 UI 新建 B、同 native `s1` 的 A/B 草稿、后台 A 审批、返回后正确审批、只读 C 历史与显式新连接继续、再返回 A/B 均通过；写入顺序严格为 `start(B), respond-permission(A), start(C), load-session(C,真实nativeID)`，无隐式停止或重发。API 使用隔离 HTTP 夹具、事件为原生 EventSource；不是连接正式账号的 ACP 进程。真实两个子进程/SQLite source namespace 由[辅助历史](auxiliary-history.md)独立证明，不能相互替代。

`session-provider-recovery.spec.ts` 的新 source-ID 夹具在相同冻结源1440/393两项通过；每尺寸三次真实刷新，已有任务/审批/草稿/最终回复保留，任务写入0。旧新聊天中断测试已按批准多会话语义迁移为新连接失败仍保留旧 A，并保留原目录和响应式回归。原生 ID/source-ID 相互独立及旧运行层拒绝写入的边界保持。

真实继续操作还找出一个 hook 顺序缺陷：source ID 清空时执行 `??` 右侧 store hook，导致整页错误边界。现始终读取 runtime selector，source 有→空→有红灯转绿，原审批/阅读与继续面板组合19项通过。`acp-new-owner-red.log`、`acp-sidebar-source-red.log`、`acp-input-facade-red.log`、`acp-owner-label-red.log`、`acp-source-hook-order-red.log` 保留旧行为失败；对应绿灯及2浏览器证据位于 `.dev-runtime/session-full-implementation-20261029/` 和 `.dev-runtime/performance-finish-20261030/`。夹具主动关闭的 Vite HMR 诊断另列，不算产品异常，也不屏蔽其他错误。

标准 30 分钟自然 GC 长测已在 HTTP LAN `http://10.30.0.24:45105` 的独立冻结源启动，成功 JSON 读取使用有界生命周期的 bytes/decoder 消费器。该冻结之后的 ACP hook/输入旁路与错误回执细化不改变 Codex 成功负载；全量源码版本差异仍需与最终结果一起记录。本轮长测已结束，结果在下一节保留；此前短测或专项原生分配改善均不计作完整页面通过。

### 本轮 bytes 消费器后的标准长测仍未通过

HTTP45105冻结源原负载自然 GC 持续1802.015秒，870 cycles/870样本，RSS低点276,533,248→443,281,408 bytes（+166,748,160 bytes，159.0234MiB＞128MiB门槛），峰值477,814,784 bytes。JS heap低点36,837,372→43,366,592 bytes（+6.2267MiB），峰值140,889,572 bytes；backing低点14,244,963→14,416,000 bytes（+0.1631MiB），峰值34,140,664 bytes。全部为renderer PID1657937/start ticks222831573，错误与采样错误为空，React measure为零，负载内创建一个音频上下文。

失败在RSS低点断言，后续峰值门槛与最终音频空闲归零断言未执行，不计通过。没有强制GC、页面刷新、放宽门槛或改负载；源码/配置manifest与全部JSON、摘要在 `.dev-runtime/performance-finish-20261030/standard-soak*`。单独 headless-shell 真实JSON消费器的原生分配改善不等于整页长期增长已解决，前后两次不是独立因果配对。下一步先对真实页面的原生分配/网络缓冲做有界诊断，不简单重复长测挑选绿色结果。


### 辅助正文详情的原页来源确认

实际接受的 CC/ACP 只读页才为页内 canonical 行建立弱引用来源证明，身份精确到 provider、history source、item 和正文 owner。它包含读前捕获的账号/设备/运行范围，仅留在内存，不复制正文或持久化凭据。同范围同快照维持原行、原证明和订阅版本；账号同值撤销后的新接受页即使正文完全相同，也会更新实际确认版本。模块热替换丢失证明时，旧预览先显示明确的“重新核对来源”，不会从 React 对象引用或新的点击凭据推导旧记录身份。

较早页还在证明中保留实际读取使用的原始 opaque cursor；它只是重新只读定位原页的线索，不能授权展开或恢复写入。重新确认仍需新的完整来源校验与 AbortSignal；旧游标在新范围收到403/409时要求重新选择历史，不回退近期页、raw 全文、原生 load/resume 或发送。生产者包含真实 CC 同正文保留引用与 ACP 页内/页外行、原始向前游标的红绿回归，3文件17项通过：`.dev-runtime/performance-finish-20261030/provider-source-cursor-{red,current}.log`。

## 刷新缓存与执行证据

HTTP reader修正没有覆盖旧IDB终态和cache-first竞态。最新cache-only中断/工具现以中性提示核对，精确原生proof在任意到达顺序即时修正；来源取消、相同JSON确定性与红绿/实际browser边界见[专项记录](cached-execution-recovery.md)。8MiB显示、16MiB warm、原生传输及长期RSS门槛不变；任务不被自动停止或恢复。


## 2026-10-30：正式 30×4×3、暖切换与压力结果

最终当前 Web 源首次正式冻结为 HTTPS LAN `https://10.30.0.24:44723`，绑定 `0.0.0.0`，2885 文件，`frozen-1793314563632`，PID3238135/start ticks223302066，Node24.14.0，Chromium145.0.7632.6。源码与配置、依赖锁和启动器 SHA 清单位于 `.dev-runtime/performance-finish-20261030/` 的独立冻结目录；全局保温默认 true、已有显式 false 保持，包含来源确认与原页游标、缓存执行确定性、HTTP scope guard 和新窗口身份投影。HMR与日常开发入口一致保留，但关闭文件观察且没有 API proxy；夹具仅允许本前端的精确 HMR，所有实际任务接口由隔离 HTTP 与原生 EventSource 夹具接收。

正式每页30个新 browser context 样本、每 context 同时3页、每页30关注/4可见窗格，完整90样本无页面/模块/接口错误，未替换或删除样本。结果仍为红灯：

| 页面 | 导航 p95 / max ms | 正确目标与可编辑 composer p50 / p95 / max ms | 四份无缓存完整正文 p95 ms | 输入两帧 p95 / max ms |
| --- | --- | --- | --- | --- |
| 1 | 2081.8 / 2105.3 | 2334.0 / 2475.7 / 2487.5 | 4638.5 | 33.2 / 42.3 |
| 2 | 2075.6 / 2112.7 | 2307.6 / 2449.0 / 2512.5 | 4638.1 | 38.9 / 42.5 |
| 3 | 2079.1 / 2156.4 | 2312.3 / 2472.4 / 2522.1 | 4634.9 | 50.2 / 58.0 |

`formal-three-page.log` 与 `formal-three-page/**/three-page-performance.json` 保留逐样本值、p50/p95/max与零失败请求。启动前主机152 CPU、load24.65，本工作流其他浏览器/单测已暂停；只观察到当时没有其他 Playwright/Vitest driver，不宣称整台共享主机绝对静默或没有其他工作负载。`formal-host-before.json` 记录测量边界。完整正文单列，空壳和准确预览不代替正文可见。

同一冻结源的真实30次暖标签手势均等待该次正确正文、原草稿与输入观察完成后才进行下一次：正文 p95 198.6ms、草稿 p95 198.7ms，二者最大202.7ms；输入两帧 p95 37.4ms、最大43.4ms。实际原生 HMR 已连接，页面与控制台错误均为0。原始10,000消息会话与30关注并存，点击的是主要会话标题，项目目录的独立按钮仍可单独操作，无 force click 或坐标绕过。证据 `formal-warm/**/public-performance.json`，15.1秒通过。

50/100关注各保留实际4窗格、正确唯一输入目标、全部最近页预热与设备草稿，两个压力用例32.2秒通过；保温账本51,180/102,480 bytes，输入两帧23.2/22.2ms，任务写入0、错误0。这里的8.31/21.93秒是等待所有50/100份正文都实际填入后的观察时间，既不是首个composer完成时间，也不计两秒标准或长期RSS稳定。证据 `formal-pressure/**/followed-pressure.json`。

后续同源单轮诊断只用于归因，不能替换上述正式红灯。实际 page0 导航1772.4ms、composer2182.4ms；首个 TextDecoder 在2246.5ms，首个不可见 ux-1 读取在4465.4ms，均晚于可编辑输入。此前只有两次持久偏好 JSON.parse，共0.2ms；可见0/27/28的历史请求开始1936–1938ms，响应头在2209ms以后。由此本次数据不支持“后台正文解码抢占首屏”的假设，不以关闭默认预热或增加盲等待来制造绿色。1939.5–2182.5ms 的243ms主线程长任务与composer首次提交重合；导航前已有548个脚本/6.54MB，输入前562个/6.67MB。`critical-cold-diagnostic/` 保留有界 fetch/parse/decode 时间线、真实资源和 page0 CDP CPU profile；它有观测开销且 acceptanceEligible=false。下一步按实测模块图和首轮 React/Lexical 提交继续收敛；两秒与标准30分钟RSS仍未通过。


旧44723启动器只冻结Web源码，通过workspace链接读取shared编译产物；在后续候选改动前已由shared修改者确认源、包清单和dist均未变，并独立保存当时89个依赖文件及SHA/mtime到 `shared-before-leaf-cut/`，原启动器副本也保留。后续验收启动器会同时复制shared包清单/dist并以每个已声明导出映射到同一冻结canonical文件，另写依赖manifest，避免构建后共享依赖悄悄变化。这个隔离改进不当作产品提速，也不将旧Web-only snapshot描述为已冻结所有workspace依赖。


2026-10-30 shared 依赖专项：实际 44723 三页冷进入仍超过两秒，诊断确认根再导出的 22 脚本 waterfall；19 个关键运行导入改八个明确子路径，不关闭能力或预热。原始反例、身份与冻结边界见[依赖记录](shared-entry-dependencies.md)，收益须以新冻结完整测量确认。


## 2026-10-30：真实 HTTPS/H2 的两秒关卡通过

安装版本 Playwright1.58.2 的 `crNetworkManager.js` 154–158 行确认：任意 `Page.route` 会开启全请求、请求前的 `Fetch` 拦截并关闭整个HTTP缓存；即使用户pattern仅匹配API，548个首屏脚本也先经调试器与测试worker往返。原有44723正式90样本红灯保留，不能改写成产品已达标的历史记录，也不能把不同测量传输的差值全算作产品优化。

新的原生HTTP夹具把完全相同的30关注、4正文窗格和唯一公共输入区种子抽到 `tests/e2e/session-multisession-fixture.ts`。固定自有 Vite 上只增加真实同源API middleware和初始化脚本，所有API都留在隔离夹具；脚本/CSS继续走原 Vite HTTPS/H2、条件缓存与真实 HMR，正文事件仍是原生 EventSource。实际Page不注册HTTP/WebSocket路由或Fetch，不设置cacheDisabled；完整标准Network观察仍保留。每轮依然是一个全新browser context内三页同时进入，同样30轮、相同DOM/正确owner/实际输入与两帧判据、同样2000/100ms门槛。

冻结 HTTPS LAN `https://10.30.0.24:33233`，绑定 `0.0.0.0`，2886个Web文件、89个shared依赖文件；run `frozen-1793323262531`，PID1567947/start ticks224171953。相对45851候选，仅两个不被应用导入的测试文件不同，产品及89个shared哈希相同；八模块主动预取未写入产品。shared明确子路径与App直接hook切口消除了不相关模块阻塞，但其前次诊断没有证实两秒收益，这个功能正确性结论单独保留。

正式90样本2.4分钟通过：

| 页面 | 导航 p50 / p95 / max ms | 正确目标与可编辑输入 p50 / p95 / max ms | 四份完整正文 p95 / max ms | 输入两帧 p95 / max ms |
| --- | --- | --- | --- | --- |
| 1 | 1362.9 / 1542.8 / 1579.8 | 1693.7 / 1903.8 / 1918.6 | 3863.1 / 3880.6 | 51.6 / 52.2 |
| 2 | 1386.8 / 1610.1 / 1646.2 | 1701.5 / 1932.0 / 1976.0 | 3910.4 / 3999.0 | 49.7 / 52.0 |
| 3 | 1308.8 / 1560.2 / 1591.5 | 1636.8 / 1895.4 / 1912.5 | 3832.6 / 3925.2 | 50.9 / 51.3 |

所有90页都实际收到原HMR connected帧、至少一个原生SSE响应，任务写入0，页面/控制台/接口错误0；30轮后台元数据都验证真实H2、三个同时SSE连接、没有实际WebSocket拦截或模型任务写入。没有丢弃或重测成功样本。该次缓存命中/重验证计数为0，所以这里证明的是去除Fetch中间层后的真实HTTP、HMR与浏览器正常策略下的UI关卡，不能声称测出了缓存命中或合并请求带来的单因素收益。首次完整正文仍单列为约3.8–4.0秒，不把导航和输入可操作冒充正文全部就绪。

原始日志与90逐页记录在 `.dev-runtime/performance-finish-20261030/native-http-formal/`；独立复算六组统计、逐轮原生传输及所有前端/shared哈希的结果是 `native-http-formal-independent-audit.json`。9份config与5份直接fixture输入都核对SHA，但fixture清单没有穷举Node服务所有传递导入；不据此宣称整个真实后端都已冻结或其延迟已覆盖。Node夹具一次加载、没有HMR，结果严格限定为UI/只读客户端路径，不包含真实模型调用、daemon磁盘服务或实体手机时延。

真实HTTP正式命令：

```sh
SESSION_PERFORMANCE_TRANSPORT=native-http \
SESSION_PERFORMANCE_NATIVE_FIXTURE_RECORD="$PWD/.dev-runtime/native-http-fidelity-20261030/frontend.json" \
PLAYWRIGHT_SKIP_WEBSERVER=1 \
PLAYWRIGHT_BASE_URL=https://10.30.0.24:33233 \
PLAYWRIGHT_FRONTEND_PROTOCOL=https \
pnpm exec playwright test tests/e2e/session-multisession-performance.spec.ts
```

驱动先核对固定自有record的URL、PID/start ticks、launcher、30/4夹具与无正式API代理，错误配置拒绝加载，不回退正式服务。原 `playwright-route` 路径仍保留，明确标记其保守拦截/缓存边界。最终同产品无夹具CLEAN双份源 `https://10.30.0.24:34595` 从33233逐字节复制，供原生HTTP长测、最后暖切换/压力和新窗口复核；30分钟RSS结果仍待独立追加。


## 2026-10-30：元数据来源窄修后的最后冻结与复验

最后只读审计又复现四个真实问题：初始metadata与thread list没有完整约束配对endpoint/token，旧设备的迟到返回可能在当前账号探测完成前污染线程摘要或模型状态。`codexService.ts` 窄修现在捕获完整原生读取来源，在只读请求存续时观察Pairing变更并锁定撤销（A→B→A也不能接回旧响应），通过AbortSignal取消；发布与最终清理仍核对同一read/epoch，原正文保护、实际任务和草稿保持。新增来源红绿与邻近测试6文件83项、Web类型检查通过；本次不加入新预取、不改内存或时间阈值。

最终产品 `codexService.ts` SHA256 为 `9279231f64059f08999d904106f38dd50442aa911061bc72a61f7bf5c611b3a5`。新的原生HTTP冻结是 HTTPS LAN `https://10.30.0.24:34711`，record `.dev-runtime/native-http-final-20261030/frontend.json`，`frozen-1793325543121`；2887个Web文件（多一个正式测试）、89个shared文件。对应无API/HTML夹具的HTTPS源为 `https://10.30.0.24:38337`，record `.dev-runtime/clean-native-final-20261030/frontend.json`，`frozen-1793325611544`，与34711逐文件SHA相同。旧33233/34595测量与被撤销的长测partial都保留，不能算最后版完整长测。

最终原生HTTP正式90样本仍全部保留，2.4分钟完成、无失败请求。按批准Q10的“p95≤2秒并报告max”通过：

| 页面 | 导航 p50 / p95 / max ms | 正确输入 p50 / p95 / max ms | 完整四正文 p95 / max ms | 输入两帧 p95 / max ms |
| --- | --- | --- | --- | --- |
| 1 | 1356.6 / 1571.0 / 4222.9 | 1699.2 / 1880.3 / 4616.0 | 3953.1 / 7521.6 | 47.7 / 50.9 |
| 2 | 1385.5 / 1571.2 / 4254.3 | 1684.6 / 1896.2 / 4607.0 | 3913.2 / 7511.1 | 48.3 / 49.4 |
| 3 | 1368.0 / 1552.6 / 4222.3 | 1690.0 / 1876.2 / 4630.6 | 3884.6 / 7534.2 | 44.9 / 49.9 |

这轮前端服务是新启动、没有先做浏览器烟测；首个客户端还要支付开发服务首次模块编译，round0三页输入为4.61–4.63秒，正文约7.53秒。其余是同一已运行服务上的全新浏览器context。首轮完全纳入90样本和上述p95/max，没有删样本或复跑挑绿。因此验收通过的是约定p95标准，不能表述为“任何情况下每次都硬性两秒”；也不为了美化max继续修改或重新测量这个源。完整正文一直单列，不冒充两秒就绪。

所有90页仍实际收到HMR connected、原生SSE及H2，任务写入和页面/控制台错误均为0；30轮后台统计为三个同时SSE连接、真实H2与无实际WebSocket拦截。最终完整记录是 `.dev-runtime/performance-finish-20261030/final-guard-native-http-formal/`，独立复算六组p50/p95/max、90页传输及2887Web/89依赖/9config/5直接fixture哈希的证据是 `final-guard-native-http-formal-independent-audit.json`。之前原生HTTP夹具的零缓存命中及传递Node依赖清单边界继续适用，不将它称为缓存单因素收益或真实后端延迟通过。

同一最终38337源的暖切换与压力用例3项、48.3秒通过：真实30次标签手势的正确正文与草稿 p95均195.1ms、最大219.7ms；keydown到两帧 p95 34.4ms、最大36.6ms，实际HMR已连接、页面和控制台错误0。50/100关注均真实保温全部最近页、四窗格、唯一owner与草稿正确，账本51,180/102,480 bytes；输入两帧31.0/26.4ms、任务写入0。11.78/20.63秒是等全部50/100正文填入后的观察时点，不能解释为首个界面延迟或两秒判据。证据 `final-guard-warm-pressure/` 与同名日志；这两项暖/压力沿用保守Page.route夹具，不能冒称原生HTTP计时。

该最终冻结的90、暖切换与压力性能窗口已结束，交接完整Web回归、新窗口专项、独立真实CLI共享以及新的40秒smoke后唯一完整30分钟自然GC长测。最终长测由其独立记录追加，未完成前不得覆盖旧RSS红灯或宣称最后版内存验收通过。


## 2026-10-30 当前冻结长测更新

旧38337 guarded 30m仍保留实际RED：1801.199s/885 samples，RSS low-rise +130.4375MiB 超过128MiB，后置UI/audio/fingerprint断言未执行。之后38444 budget/cache freeze（Web manifest `85175e6ed0c8cfd27d8d5b08e4b3ce6993338421ceddd1f79a4488d8c253ca68`）完成strict 30m正式通过：1800.857s/885 samples；RSS low-rise 62.65625MiB、heap low-rise 7.94974MiB、RSS peak 394.488MiB、heap peak 87.995MiB；early103/late90样本、28,320 sequence连续、source fingerprint稳定、final reply/owner/draft/approval/unread/audio idle及cleanup通过，`errors=[]`/writes0。host load range 7.45–16.21，并发root Web workers、M03/M34及之后daily maintenance/M08诊断均由run metadata并列留存。单独记录 `proxyErrors=[Error: aborted]`，不隐藏。结构化结果与原始证据位于 `.dev-runtime/root-native-memory-20261030/budget-optimized-strict-thirty/strict-30m.log`、`strict-result-summary.json`、`native-http-memory/capped.json`。本结果只对38444冻结源码有效，38337 RED继续作为历史证据。


此前M54待测目标为38444；该目标已被下述governor修复后的38445最终冻结替代。38444 M39通过与34711性能数据均只适用于各自source。

## 2026-10-30 latest M08 status

The tracked M08 case on the immutable full 38444 source with persistent live SSE produced three sequential samples: **631.0 ms RED, 603.4 ms RED, 253.9 ms PASS**. The two RED runs stopped at the existing `<500ms` assertion; the PASS also satisfied the existing row, DOM and exact-body assertions. No retry or threshold change occurred. Detailed runner evidence is `.dev-runtime/root-native-memory-20261030/budget-optimized-final-freeze/m08-live-sse-quiet-3x/summary.md` and `run.log`.

A private synchronous-governor candidate produced 1181.2 RED / 473.2 PASS / 286.3 PASS and failed an earlier-history paging scroll semantic case; it was not adopted. Separately, diagnostics found that the old warm-text condition may be met by `CodexTranscriptPreparing` while the rich presentation and rows are absent. An ignored test copy on the unchanged 38444 source required a visible rich warm row and absent preparing fallback, yielding 413.9 PASS / 555.7 RED / 376.8 PASS. These samples explain why the prior warm criterion was insufficient, but do not close M08 or establish the remaining timing cause. Fixture EOF/reconnect and history rereads remain possible confounders; no single cause is established. The 500ms threshold and later assertions remain unchanged. M08 stays open.

At the time of this section, M54 was pending on 38444 and M39 had passed only on that frozen source. The subsequent adopted governor fix created a new 38445 final freeze; see the latest sections below. M39 is reopened for strict current-source revalidation, M54 now has a separate 38445 byte-identical nativeHTTP origin acceptance, and prior-source results remain source-specific.


## 2026-10-30 adopted governor fix and final source revalidation

The narrowly scoped governor source fix was adopted after the private 38446 candidate's functional evidence. Synchronous release is limited to changed, non-pinned snapshots whose raw event count exceeds 3000; iteration uses `Object.entries`. Run guards and pending cleanup remain, as do ordinary scheduling, byte accounting and reading-window protections. Three focused tests were 2 RED before the fix; afterward governor13 + budget41 = 54 passed, and Web TypeScript checking passed. The fix and regression note are mirrored in the repository's function/debug/memory-contract records.

The exact new final freeze is HTTPS LAN `https://10.30.0.24:38445`, source record `.dev-runtime/root-native-memory-20261030/governor-final-freeze/frontend.json`: Web manifest `ac39d4478f2fef416840b1a24e1cf8d258ed14085b2b4c44b771ae75628c7718`, shared `2482eb777c1313b7d83beb1eec5e51a12f30e02520e01021368d09bdf82cd493`, config `0756e5aeb4faec04af50c9c4564f8c369e500d90be5c99bfe1653aef4c698388`, governor source `0293a4b389aa6e86bfbcce87b29f869239c65e6df685d5f8ff517d3890c32be8`.

Historical status at this point in the log: the 38444 tracked M08 samples (631/603/253ms), rich-warm diagnostic copy (413.9/555.7/376.8ms), and private 38446 candidate (1181/473/286ms) remain source-specific evidence. The subsequent section records the 38445 M08 pass; those earlier REDs stay preserved. M54 current-source 90 samples and warm/pressure cases remain pending on a distinct nativeHTTP origin. The 38444 strict M39 30-minute pass remains source-specific; rerun the unchanged strict 30m on 38445 after the M54 quiet/performance window releases. At this point M39 current-source revalidation and M54 remain open.


## 2026-10-30 M08 final-source result and remaining performance work

On final frozen source `https://10.30.0.24:38445`, the exact tracked M08 three-sample case passed **416.9 / 415.0 / 353.3ms**. Every sample passed the original `<500ms`, `<80` rows, `<2000` DOM descendants and exact-body assertions. The original scroll semantic companion passed 3/3 for detached reading-anchor behavior, positive wheel at latest, and top-edge automatic older-history loading. Runner artifacts: `.dev-runtime/root-native-memory-20261030/governor-final-freeze/final-m08-3x-01/run.log` and `.dev-runtime/root-native-memory-20261030/governor-final-freeze/final-scroll-3x-01/playwright.log`; source/hash/host records are in those directories. M08 closes for this exact source. Earlier 38444 and 38446 REDs/diagnostics remain historical and are not erased.

Historical checkpoint before completion: the nativeHTTP origin/M54 result and M39 strict run were still pending. Later sections record the 38689 M54 pass and the current 38445 M39 RSS RED; the 38444 pass remains source-specific.


## 2026-10-30 M54 final-source 90-sample acceptance

M54 passed on a separate nativeHTTP fixture origin `https://10.30.0.24:38689`, with 30 rounds × 3 simultaneous pages and 90 fresh contexts. `acceptanceEligible=true`, `failures=[]`. The frontend content is byte-identical to final 38445 across 2887 Web and 89 shared files; origin configuration, fixture driver and transitive dependency boundary are separately recorded. This is the source-compatible nativeHTTP run required by the performance harness, not a rewrite of the 38445 source identity. Origin record `.dev-runtime/native-http-final-governor-run3-20261030/frontend.json`; request identity is in `.dev-runtime/root-native-memory-20261030/m54-native-http-90-final-02/identity-before.json` and `identity-after.json`.

| Page | Navigation p95 / max | Interactive p95 / max | Four uncached bodies p95 / max | Input two frames p95 / max |
|---:|---:|---:|---:|---:|
| 1 | 1647.2 / 4072.4ms | 1960.1 / 4484.7ms | 4008.3 / 7398.7ms | 48.2 / 49.2ms |
| 2 | 1654.6 / 4097.9ms | 1975.8 / 4527.1ms | 3995.6 / 7431.8ms | 46.8 / 50.1ms |
| 3 | 1631.0 / 4221.9ms | 1947.6 / 4575.4ms | 4020.9 / 7419.3ms | 46.2 / 47.6ms |

The agreed p95 gates pass: all interactive p95 values are ≤2s and input-two-frame p95 values ≤100ms. Keep the fresh-service cold round: navigation max 4.222s, interactive max 4.575s, four-body max 7.432s; 844 scripts, 13.810MB encoded / 14.063MB transferred, zero cache/revalidation. Round 29 interactive was 1.585–1.615s and four bodies 3.571–3.629s. Across the observed run: 15,461 HTTPS/H2 requests, 6,828,465 response bytes, 959,020 request bytes, zero API errors/task writes, 90 EventSource opens / 3 active streams, and no actual WebSocket interception. Host load was 9.28→13.6→12.62 on 152 CPUs; this is not characterized as saturation. The renderer log does not establish a complete owned-renderer inventory. Raw runner/artifacts are under `.dev-runtime/root-native-memory-20261030/m54-native-http-90-final-02/`, including `results/session-multisession-perfo-70e2c-ltaneous-pages-native-http-/three-page-performance.json` and `playwright.log`.

M54's 90-sample gate and the supplementary warm/pressure 3-case batch are complete on 38445. The mistaken 30-minute invocation was interrupted at cycle0 and is not acceptance evidence. M39's unchanged strict 30-minute acceptance on 38445 later completed RED at the RSS low-rise threshold; the current failure and exact evidence are documented in the following section. The 38444 strict-soak result remains valid only for 38444.


## 2026-10-30 warm-switch and followed-pressure completion on 38445

Supplementary current-source warm/pressure work passed 3/3 in 43.4s on the 38445 freeze. Thirty actual tab clicks with a 10,000-message conversation kept the correct body and saved draft together: p95 200.3ms, max371ms; input two-frame p95 35.2ms, max39.9ms; page/console errors 0. Fifty followed sessions kept four correct visible panes, exact owner/draft and all 50 bodies warm: 51,180 bytes, all-body ready 8.1438s, input two frames 22.3ms, errors/writes 0. One hundred followed sessions retained the same invariants for all 100 bodies: 102,480 bytes, all-body ready 20.0812s, input two frames 27.9ms, errors/writes 0. The 50/100 all-body readiness time is a pressure observation, not a common initial-interactive two-second criterion or a natural RSS-soak result.

Artifacts: `.dev-runtime/root-native-memory-20261030/warm-pressure-3cases-final-01/summary.json` and `playwright.log`, plus per-case raw JSON paths in the summary. A mistaken 30-minute invocation was interrupted at cycle0; `.dev-runtime/root-native-memory-20261030/warm-pressure-30-final-01/interruption-metadata.json` explicitly marks it `interrupted_not_acceptance`. It is neither a pass nor a fail for the intended 30-click/50/100 pressure cases.

At the time of this section, M39 strict 30m on 38445 had started; the following current-source result section records its later RSS RED. Keep the gate open for root-directed diagnosis and valid follow-up.


## 2026-10-30 prior 38445 strict result under the old HMR helper: RED

The current final 38445 source strict native HTTP 30-minute run completed 885 cycles / 1800.595s and **failed** its RSS low-rise threshold. `rssLowRiseBytes=144687104` (~137.984MiB) exceeded `134217728` bytes (128MiB). Heap low-rise was 9,384,644B and heap peak 124,364,164B; RSS peak was 435,204,096B. `errors=[]`; one `proxyErrors: Error: aborted` is recorded separately. All owned cleanup flags are true. Because the RSS assertion failed, final UI, natural audio idle and end-fingerprint assertions were not executed; this run is not a pass.

Primary raw result: `.dev-runtime/root-native-memory-20261030/governor-final-strict-thirty/native-http-memory/capped.json`. Driver assertion log: `.dev-runtime/root-native-memory-20261030/governor-final-strict-thirty/pw-output/session-native-http-memory-c5997-d-complete-Network-observer/native-http-memory-driver.log`. Runner output: `.dev-runtime/root-native-memory-20261030/governor-final-strict-thirty/strict-30m.log`; `.last-run.json` records one failed test. The actual measured threshold failure is in `tests/e2e/helpers/session-native-http-memory.mts:1069`; the Playwright spec `tests/e2e/session-native-http-memory.spec.mts:74` observed helper exit code 1 where it expected 0. Do not count the wrapper assertion as a separate failure or dismiss the raw RSS RED as a wrapper issue.

The 38445 source identity for that historical strict attempt is in `run-metadata.json`: Web ac39d4478f2fef416840b1a24e1cf8d258ed14085b2b4c44b771ae75628c7718, shared 2482eb777c1313b7d83beb1eec5e51a12f30e02520e01021368d09bdf82cd493, config 0756e5aeb4faec04af50c9c4564f8c369e500d90be5c99bfe1653aef4c698388. Preserve the earlier 38444 strict M39 pass as source-specific history and the 38445 old-helper RSS RED as a completed failed attempt. The corrected-helper 38445 strict run is the current open portfolio gate. The final pnpm check and Web suite passed independently; neither substitutes for M39.


## HMR fixture diagnosis and corrected M39 helper rerun

A 45.1s probe against the same 38445 source observed six Vite HMR WebSocket handshakes with HTTP 101, each actively closed by the old helper after 2–11ms with zero frames; reconnects were about 11s apart. Prior 38444 PASS and 38445 RED runs both showed high socket close counts (165/168). This proves material HMR fixture churn under the old helper; it does not prove that churn was the sole cause of the RSS result or erase the prior RSS RED. Probe artifact `.dev-runtime/root-native-memory-20261030/hmr-ws-proof/probe.log`.

The helper was corrected to map source HTTP→WS and HTTPS→WSS and validate exact `/` path, token, Host, Origin and subprotocol; frame/buffer handling and bounded cancellation/cleanup were added. Proxy Node tests passed 3/3; strict NodeNext declaration checking passed. Proxy SHA `84aeeb1e76b45228dd8ac63e94a36d9726dab2f9b7f02df9add0a1f2e3afda2a`; driver SHA `09089465a83b76b4b5cc2d5197a912cef490a3754dc480f295cce7bc1d0015db`; product source remains Web `ac39d447...628c7718` / shared `2482eb77...82cd493` / config `0756e5ae...c698388`. Green unit log `.dev-runtime/root-native-memory-20261030/hmr-ws-proof/proxy-boundary-tests/green-after-fix.log`.

A short 15-cycle browser proof on the unchanged 38445 product source reports `completed=true`, `formalAcceptance=false`, HMR 1 connected/0 closed/1 active with two client pings, task writes 0, one SSE stream, and all owned cleanup true: `.dev-runtime/root-native-memory-20261030/hmr-ws-proof/run-06-review-final/native-http-memory/capped.json` and `pw-output/.last-run.json`. This proves helper functionality but is not a 30-minute acceptance. Earlier interim proxy timer 1008 and extra-pong assumptions produced red runs; preserve those records.

The corrected-helper full strict M39 run completed RSS RED on the then-current 38445 freeze; the prior old-helper RED and historical 38444 source-specific pass remain. Later history-page source changes are documented below and do not rewrite these source-qualified results. The run observed a stable live HMR upstream during measurement, so the RSS failure must not be attributed to the old helper disconnect fault. This is a historical 38445 result. At that earlier checkpoint, 38517 was the planned next source; its strict run later produced a source-specific RED, and 38518 is now current. Latest scripts regression passed 198 tests: 197 passed, one browser opt-in skipped, zero failed (exit 0, 15.850s) in `.dev-runtime/session-full-implementation-20261029/scripts-final-hmr-proxy-20261030.log`; concurrency 4 and polling are test-environment settings only.


## Corrected-helper 38445 strict M39 result: RED

The corrected-helper strict run completed **886 cycles / 1801.998s** and failed the unchanged RSS low-rise threshold: **146,464,768B (~139.68MiB) > 134,217,728B (128MiB)**. Heap low-rise was 11,876,836B, heap peak 151,047,080B, RSS peak 548,597,760B. Raw result: `.dev-runtime/root-native-memory-20261030/hmr-corrected-final-strict-thirty/native-http-memory/capped.json`. `completed=true`, `formalAcceptance=false`, `errors=[]`, one `proxyErrors` abort, and all owned cleanup true.

The runner observed one HMR attempt, one connected/active upstream, zero closes before cleanup, 60 client pings and one source connection. Cleanup then left zero active/upstream/raw connections and one closed connection. The RSS assertion failed before final UI, audio-idle, source-after fingerprint and formal HMR gate assertions; those were not executed. The HMR counters show a live, stable observed connection during the run, but do not satisfy the skipped formal HMR assertion. This corrected-helper RED cannot be attributed to the old helper's disconnect churn. Preserve it alongside the earlier old-helper RSS RED and the source-specific 38444 pass.

The root-directed allocation attribution is now complete as a 22-minute diagnostic on the same 38445 source: 648 cycles / 1320.816s, `formalAcceptance=false`. Its narrow early/late comparison found Blink GC heap committed capacity +24.8MiB while allocated objects fell 6.8MiB, and NetworkResourcesData metadata +2.0MiB. Exact `PerformanceMeasure` objects also fell 10,090→2,927. The report does not prove an allocation stack, retained-object root cause or leak and does not attribute the result to host pressure. It does not alter either M39 RSS RED or count as acceptance. See `.dev-runtime/root-native-memory-20261030/memory-allocation-diagnostic/analysis/strict-22m-early-late-comparison.md` and `runs/strict-22m/native-http-memory/capped.json`; any further work is subject to root review.


## 2026-10-30 current 38519 App body source status

Current full-source freeze: `https://10.30.0.24:38519`, Web manifest `09dcff463bfcdc528dbcd3a85a2be3db584a1eb8aac7f6a490e831bdff711214` (2890 files), shared manifest `2482eb777c1313b7d83beb1eec5e51a12f30e02520e01021368d09bdf82cd493` (89 files), config manifest `0ce68d193ced11878bf6968edf16a02cc0a2e93efe0f202421c7874b937a9cad` (12 entries). Freeze record `.dev-runtime/root-native-memory-20261030/app-body-final-freeze/frontend.json`; root independent audit `.dev-runtime/root-native-memory-20261030/app-body-final-freeze/root-independent-audit.json` reports zero mismatches for all three manifests. Relative to38518 only `SessionWorkbench.tsx`, `SessionAppBody.tsx`, and `SessionAppBody.test.tsx` changed.

`pnpm check` passed on38519, with production build in46.22s: `.dev-runtime/session-full-implementation-20261029/check-app-body-final-20261030.log`. AppBody targeted tests passed10 files/30 tests: `.dev-runtime/root-native-memory-20261030/app-body-targeted-green.log`. The full Web count754 files/4645 tests belongs to38518; it is shown alongside the38519 focused delta for coverage context, not represented as one full38519 Web run.

### M54 current-source nativeHTTP 90 samples: PASS

The complete M54 run passed30 rounds ×3 simultaneous pages using30 fresh contexts, with the first cold round included. Root independently recalculated the retained90 samples. Ready p95 was1791.8/1869.5/1821.5ms, within the2s threshold; cold maxima were4595.8/4727.2/4716.7ms and remain separately visible. Uncached four-body p95 was3811.3/3822.7/3828.5ms, max7626.2/7663.5/7634.9ms; body timing is separate from ready. Typing two-frame p95 was48.9/50.0/87.3ms, within100ms; page2 maximum108.8ms is separately retained and does not replace the p95 criterion. There were no native HTTP errors or task writes; HMR/SSE checks passed and fixture cleanup completed.

Functional origin38519 and nativeHTTP fixture origin `https://10.30.0.24:33909` have separate records/configuration. Root's independent recalculation checked source parity and all90 samples. Raw performance JSON `.dev-runtime/root-native-memory-20261030/m54-app-body-final-native-http-01/results/session-multisession-perfo-70e2c-ltaneous-pages-native-http-/three-page-performance.json`; independent recalculation/root audit and fixture identity are in `.dev-runtime/root-native-memory-20261030/m54-app-body-final-native-http-01/` and `.dev-runtime/root-native-memory-20261030/m54-app-body-final-prep/frontend.json`. The previous38518 M54 RED (page0 p95 2013.4ms) remains preserved and source-qualified.

Navigation-to-composer median remains276.9/274.9/275.3ms, about275ms. The M54 pass does not mean all observed ~300ms fallback delay was eliminated or identify one cause. Supplementary exact-grep warm-pressure cases passed3/3 on38519: 30 real clicks body/draft p95 219.5ms, input33.1ms, errors0; 50/100 followed sessions retained bodies/owner, with two-frame input19.9/16.8ms and errors/writes0. Evidence `.dev-runtime/root-native-memory-20261030/warm-pressure-app-body-final-01/` and closure `.dev-runtime/root-native-memory-20261030/app-body-final-browser-closure.json`.

### App loader/Suspense diagnostic boundary

A single instrumented cold diagnostic on38518 recorded `app.import.resolve` before health success and the first `SessionAppBody` render. Even after `app.component.render`, the fallback remained for303.6ms; fallback mount-to-unmount was318.5ms, and owner-checked composer DOM followed0.5ms after fallback unmount. This is consistent with a Suspense fallback scheduling delay but does not identify the descendant that suspended or prove a React scheduler lane. The one-page run changed Vite-served bytes and is diagnostic, not a formal M54 sample: `.dev-runtime/root-native-memory-20261030/session-lazy-diagnostic-prep/results/one-page-cold-01/analysis-summary.md`. Do not say the new M54 PASS eliminates the full delay or proves a single-factor fix.

38518 M08 short exact case passed3x at434.6/434.6/316.1ms, plus three idle variants and three HMR polling-corrected cases. These are previous-source results; no38519 M08 exact rerun is recorded. Evidence `.dev-runtime/root-native-memory-20261030/allocation-final-browser-runs-closure.json`.

### M39 current-source strict run: PASS (single 30-minute source-qualified result)

The original strict driver on exact38519 source completed `completed=true`, `formalAcceptance=true`: **886 cycles / 1801.97s**. Original thresholds stayed unchanged: heap low-rise<64MiB, heap peak<256MiB, RSS low-rise<128MiB, RSS peak<768MiB. Measured heap low-rise6,701,472B, heap peak162,304,884B; RSS low-rise25,477,120B (24.296875MiB), RSS peak479,969,280B. First/last windows contained103/90 samples. Natural GC, original helper/proxy, and full Network observation with4MiB total/1MiB per-resource body cache remained in use.

Raw event sequence held28,352 entries with no gaps or duplicates; taskWrites was empty and `errors=[]`. Final UI kept the exact owner and composer, latest reply intersected the viewport, draft and approval were preserved, latest completion was true, and unread state was retained. One AudioContext peaked at one active node and became idle with0 active after27.937s. HMR connected once and received60 client pings with no live-phase closes. Source-after Web/shared/config hashes matched source-before. All owned renderer/browser/profile/HTTP/SSE cleanup checks passed. Raw result `.dev-runtime/root-native-memory-20261030/app-body-final-strict-thirty/native-http-memory/capped.json`; wrapper closure `.dev-runtime/root-native-memory-20261030/app-body-final-strict-thirty/run-closure.json` exit0, no timeout, no owned leftovers; start/runner records in same directory.

**Proxy error phase boundary:** the tracked helper synchronously asserted `owned.proxyErrors.length===0` before `Browser.close()` and passed. It then set `completed=true` and awaited `Browser.close()`. That cleanup appended one owned upstream `Error: aborted` to the same raw array. Therefore the final raw `proxyErrors` contains this one teardown event; it is not accurate to describe the final array as zero. This is consistent with the passing live-phase assertion, raw `errors=[]`, and driver `formalAcceptance=true`. Root's independent phase-aware audit `.dev-runtime/root-native-memory-20261030/app-body-final-strict-thirty/root-independent-audit.json` matched the raw metrics and confirmed the cleanup phase boundary. Its initial blanket precheck requiring the post-cleanup proxyErrors array to remain empty was rejected; the source and original driver result were unchanged. Do not rewrite the raw record or rerun the same source.

The user decided on2026-10-30, “先提交已验证修复，内存问题单独跟踪.” The code commit `118748b849abbb741804242adc2ffce7ac5ff180` (917 files, local only/no push) occurred while M39 was still running. This strict PASS came after that commit and must not be backdated. Current portfolio acceptance now includes this exact-source M39 result with evidence boundaries; keep longer-term observation separate. The single30-minute pass is not a24-hour stability guarantee or proof of a unique RSS cause. Prior38517 and38445 REDs and the38444 PASS remain immutable, source-qualified history.
