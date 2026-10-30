# 会话模式用户体验实施与严格验收

用户已批准 [开发方案](session-mode-user-experience-plan-20261029.md)。目标为完整A1、A2、B、C、D；本记录按实际完成证据更新，局部通过不代表整体验收完成。

## 当前完成情况

| 批次 | 状态 | 验证 |
|---|---|---|
| A1 首屏与基线 | current-warm固定候选完成；开发和生产的两尺寸各30样本均通过 | 严格实际输入p95：开发1574.5/1521.6ms；生产803.3/745.0ms；开发首文档3476.9ms完整计入，详见末尾current-warm结果 |
| A2 连接与同步稳定性 | 已实现可复现的重试及提示缺陷修复；现场截图的历史断线根因仍无对应时段证据 | 9文件51项单测；8项桌面/手机、双页和原生EventSource浏览器回归通过 |
| B 全部关注会话最近正文页预加载 | 当前优先/全部覆盖/共享取消已验；双页同reader组合4项完成，默认策略冲突已由用户决定解除 | 1/8/30/50公共全链路与真实queue→HTTP→gateway→native组合单列；current-warm无key实际默认true，120.097秒仍保温、压力后释放；显式false62.461秒回收，两项首轮通过 |
| C 三类Agent长历史与输入 | 有界虚拟行/阅读/输入/审批及公共性能已验，CC/ACP真实源完整浏览器链3项闭合，后续原cursor/缓存执行恢复补验通过 | current-warm严格暖切换开发/生产p95为197.7/70.0ms，开发首暖962.2ms保留；真实私有源原图/详情/分页/取消证据不代表真实provider生成时延 |
| D 完整恢复与资源验收 | current-warm固定候选已完成构建、全量单测、77项功能/资源浏览器及严格性能；root后续来源保护增量另验，原30分钟RSS红灯保留 | 当前752文件4606项；27交互+45恢复/传输+3因果HMR+2自然留存=77，性能开发3/生产3另列；root增量75项+类型通过，不重标完整组合或累计历史重跑 |

此表为2026-10-30用户统一预算内持续保温后的现行结算。下文各早期批次保留其当时源码、策略和红绿灯；原v5默认false与旧冲突说明均为历史，不能覆盖现行规则。现场频繁重连根因、正式运行层安全启用及长期RSS仍按末节边界单独记录。

## A1：显示名恢复不阻塞会话

- `AppShell`直接渲染会话；`useSessionSettings`仅负责后台名称读取，总等待10秒、失败局部重试、卸载取消。重试只读取设置，不刷新正文或发送任务。
- 名称store的`editRevisions`仅在内存，用户同值重命名仍推进修订。读取回包只合并读取期间未编辑的键；缓存/原生自动命名仍可被有效服务端名称恢复。
- 读取取消后即使底层忽略取消并返回，也须先检查signal，不发布旧名称。远程手机读取沿用现有成功/回退判断，但共用本次生命周期与总等待。
- 红灯：`.dev-runtime/session-ux-review-20261029/a1-unit-red.log`，新增4项失败；`a1-browser-red.log`，桌面/手机均因composer缺失失败。
- 绿灯：`a1-complete-unit.log`，4文件15项；`a1-browser-green.log`及`a1-browser-green/`，2项、7.3秒。浏览器通过已有LAN HTTPS `https://10.30.0.24:8484/?mode=session`（监听`0.0.0.0`），全API隔离fixture，未向真实Agent发送任务。
- 尚未将局部结果解释为冷入口两秒达标、所有provider恢复完成或长期RSS稳定。最终源码需执行前后端检查、正式性能与完整矩阵。

## A2：连接、列表同步与提示

- 复现并修复旧revision快照导致的连续立即重试，以及429没有遵守Retry-After。单路串行、持久操作身份与原有确认语义保留；失败5秒起步指数退避，上限30秒加有限抖动，服务端Retry-After最多60秒。显式重试按tabs/projects固定枚举唤醒对应链路，不重发任务。
- `sessionConnectionDiagnostics`仅保留health/tabs/projects/events四个固定记录，分类HTTP、超时、网络、无效响应、旧快照及存储失败；只记录计数/时间/状态码/待提交数，无正文、URL或凭证。HTTP与JSON解析共用10秒deadline，底层不响应abort也可结算。
- 默认紧凑状态由顶栏`SessionSyncIndicator`承载；零待提交读取失败不再声称有本地修改。收起、恢复、再次抖动保持默认收起，不抢输入焦点、不改变聊天阅读几何。存储未落盘、401/403以及实时流暂停单独显露；健康连接与SSE分别核对。
- 红灯`a2-unit-red.log`新增5项失败；绿灯`a2-expanded-unit.log`9文件51项，`a2-browser.log`8项1.4分钟。真实浏览器涵盖1440/393尺寸抖动、恢复、局部重试、双设备共享操作、故障期间草稿与阅读位置；使用隔离API和原生EventSource，零Agent测试写入。证据目录同A1。
- 当前服务日志抽样：projects267、health119、tabs266次均为200，最大耗时分别24.38/524.47/7.69ms。它们只能说明当前观察窗口，不能解释用户截图发生时的网络/资源原因；没有把紧凑提示等同于现场断线根因已解决。

## B：覆盖与只读调度

- 前端recent/history/status仍共最多6项：3/2/1。recent只保留一个后台传输，留两个既有槽给重叠的旧/新前台选择；原生独立reader仍只有一个。前端及网关每连续3个interactive准入后给background一次机会，后台不会因持续切换永久饥饿。
- 自有固定枚举HTTP头`x-session-read-priority: interactive|background`仅作用于`thread/turns/list?view=chat`，缺省interactive兼容旧客户端，非法值400；不加入native参数，不获得写入权。已开始的读取继续由原deadline和自有进程清理控制，未扩大17项网关准入、120秒队列等待或字节预算。
- 同会话读取合并但每个消费者有独立取消；最后一个取消才撤销传输，并立即移除已取消的去重身份。账号范围变更的原始错误由UI/调度器分别消费，翻页仍等待先前读取后重新捕获原生cursor。
- IDB一次只恢复一个有界记录；每项完成重新选择“当前目标、可见正文、其余关注”。50目标覆盖注册只保留phase/revision；回收标记reclaimed，清理关注/卸载同步删除。60秒正文回收、休眠禁止重新持有正文及原缓存准入不变。
- 真实HTTP网关调度红灯`b-gateway-red.log`、IDB红灯`b-cache-red.log`、前端容量红灯`b-queue-red.log`保留。绿灯`b-gateway-green.log`2项；`b-expanded-unit.log`7文件71项，额外共享消费者及50覆盖测试通过。
- `b-preload-browser-5.log`4项50.8秒：浏览器实际点击末尾目标并输入，生产网关/生产reader/私有假native/原生EventSource；1/8/30/50最近页全部完成，8/30/50点击到正确正文可见900/847/1133ms，单样本非p95。每个自有native PID/start ticks核对均已退出，无任务写入。
- 先前浏览器失败保留：初版夹具ESM加载问题；其后普通短SSE响应引发反复reconnect、设置关注未走操作日志等夹具缺陷；最终使用持续原生EventSource、正式关注动作。最后又复现“旧前台+2后台占满3槽”实际调度缺陷，收敛后台传输后转绿。

## C：长历史与Claude变更检测

- Claude按稳定消息组UUID、ACP按entry ID使用可变行高视口，80条以内保留直接呈现，长历史overscan6；审批及最新标记在虚拟行之外。逐行ResizeObserver测量、阅读锚点/偏移及读底意图恢复，扩展状态只保留布尔值，不保留卸载行的正文闭包。
- Claude组件改为订阅自身正文/运行状态和必要动作，后台其他会话变化不再订阅整份store。历史合并逐条深比较并复用未变化对象，避免创建两份完整JSON字符串；外部新增回复和原有未完成审批仍保留，相同快照不通知。
- 早期阶段的Claude SDK只提供完整历史读取，因此当时保留5秒活动/30秒空闲只读恢复，其成本单列如下。后续已接入网关recent页、metadataOnly变更探测和独立只读兼容库，完整SDK读取不再是当前公共正文恢复协议；具体字节限制、真实游标与源身份见[辅助历史](session-mode-implementation-20261029/auxiliary-history.md)。
- 公共输入只在选中时加载Claude/ACP输入组件，立即工作的事件/审批订阅保持。Codex入口挂起其他provider输入模块的红灯`c-dependency-red.log`保留；`c-browser-2.log`8项41.9秒通过，包括两尺寸千条历史锚点/新回复/审批/输入、混合Agent草稿附件及未打开输入模块故障注入。
- `c-unit.log`4文件31项，`c-component-green-2.log`4文件11项，Claude完整序列化红灯/绿灯另有日志。千条DOM首轮原红灯2项、绿灯2项保留；不是原生读取速度或最终30次性能结论。


## 后续补充修复与验证

- 首屏依赖：只在首次打开后加载导入、变更及侧边聊天内容。新增轻量侧边意图订阅，同时响应聊天与独立计划面板；立即工作的状态、审批和消息回执订阅未延后。可选面板503由局部错误边界呈现，主聊天/输入/草稿保留。`d-optional-browser.log`4项通过；`c-side-transcript-red.log`证实未打开侧边模块可阻塞主输入，后续复验见最终矩阵。
- `initial-workbench-preload.ts`在主React入口下载期间并行准备明确选中的会话模式；不挂载应用、不启动API效果。终端/Codex及独立计划路由保持各自入口。`c-early-entry-green.log`和后续`c-current-graph-browser.log`覆盖主入口挂起、模式隔离、千条Claude/ACP的真实DOM/阅读/输入/审批，共7项通过。
- 虚拟滚动：测量产生的程序滚动不再让读底状态变成阅读历史；用户滚轮/触摸/指针/滚动按键可立即解除跟随。单测使用真实阅读意图，不用单独派发scroll冒充用户操作。首轮ACP两尺寸红灯保留；隔离服务禁用watch后复制源码不会自动清除Vite转换缓存，先前两轮复验仍取到旧模块，已通过读取实际响应确认并使用全新自有服务复验。`c-layout-scroll-isolated-unit.log`7项、`c-current-graph-browser.log`7项通过。
- Claude共享读取补齐：传输、投影与合并只执行一次；每个消费者独立取消，最后取消撤销自有HTTP并立即分离旧身份。显式加入后台读取会提升排队项，history通道只占一路后台读取，原2个总槽及10秒传输deadline不变。该早期检查点仍使用完整SDK读取，后续recent协议另列。两项取消、容量及提升均先红后绿；`c-shared-consumer-regression.log`19项，`c-claude-priority-green.log`22项；`c-claude-shared-http.log`真实浏览器HTTP取消/立即重开通过。
- 元数据turn/started没有items时保留原对象和序号，避免裁剪异常；`d-metadata-turn-red.log`2项失败，绿灯46项通过。
- 实时断线文案改为“任务状态待核对”，不根据浏览器断线断言任务仍在运行或已停止；恢复后沿用只读核对。`a2-state-wording-red.log`/`a2-state-wording-green.log`保留对应红绿灯。

## Claude完整读取的历史成本检查点

`d-current-recovery/`的`claude-history-cost.json`：一个真实浏览器页面、8个会话各500条SDK合成消息，预热后再完整读取3轮，共24次HTTP、28,962,744正文响应字节；总墙钟1085ms，CDP TaskDuration增量338.117ms、ScriptDuration增量1.467ms。TaskDuration包含浏览器同期任务，ScriptDuration不代表完整JS/解析CPU。相同正文无store通知、数组/行身份复用；外部新增完成回复与本地未完成审批均保留。

此测量主动调用当时的生产恢复函数，证明该阶段共享/合并行为与实际传输成本，不等于SDK原生读盘耗时、自动30秒周期或实体多设备性能，也没有声称网络字节减少。后续recent/metadata及独立reader已替代该浏览器完整读取路径，这组旧数据不能作为新协议的收益或最终成本证据。

## 公共UI性能检查点

`d-final-production-performance.log`3项通过，独立生产预览HTTP LAN `http://10.30.0.24:19887`，绑定0.0.0.0；桌面1440×852和手机393×852，各30个全新context，同一个Chromium实例、即时隔离API。输入计时以实际按键后DOM出现字符为准，所有样本必须大于0。

| 操作 | p95 | max |
|---|---:|---:|
| 桌面冷入口实际输入 | 1139.5ms | 1216.1ms |
| 手机冷入口实际输入 | 1081.7ms | 1129.4ms |
| 1万条/30关注，实际点标签到正确正文 | 73.4ms | 75.1ms |
| 同一点击到正确草稿 | 73.5ms | 75.1ms |
| 按键到两帧 | 31.4ms | 36.3ms |

该检查点早于最后的侧边聊天延迟加载、Claude取消与提示文案修正；最终产物另行复跑后更新，不用检查点冒充全部最终源码。最早`d-production-performance.log`的冷输入计时因Lexical阻止冒泡而为0，已判无效，不计入通过；真实暖切换计时独立有效。

开发版仍未达到完整验收：`d-current-development-performance.log`桌面30样本实际输入p95 2515.9ms，大于2000ms；后续侧边依赖修复后的`d-deferred-development-performance.log`桌面第26个/手机第8个context遇到ERR_NETWORK_CHANGED，没有完整30样本。它们保持失败，不筛掉失败样本称为成功。后续测试逐样本保留`cold-progress.json`，不完整样本仍不能通过30次门槛。

在本机同一观察窗口，`network-monitor.log`记录Docker bridge/veth地址及路由删除/重建，浏览器记录net::ERR_NETWORK_CHANGED；这支持本轮自动化宿主网络变化的解释，不能反推用户原截图时刻的现场根因。未停止其他容器、更改宿主网络、伪造浏览器联网状态或自动刷新文档。独立只读模块缓存探针还证明，相同URL的ESM失败会被浏览器缓存，简单重新import不会真实重传。

## 长时间资源与恢复

- `d-soak-30m.log`：旧检查点标准30分钟仍失败，RSS低点增长157,532,160字节（150.23MiB）超过原128MiB；JS堆低点约+6.27MiB，正文/后备存储有界。失败记录保留，没有扩大阈值。
- `d-final-soak-30m.log`：后续独立冻结开发前端HTTP 19886、原生EventSource、874轮/1800.515秒、自然GC标准30分钟通过。JS堆低点+4.849MiB，renderer RSS低点+57.297MiB，峰值582.961MiB；同一PID/start ticks，无页面/采样错误。全程至多一个音频上下文，最后自然空闲归零断言通过。没有强制GC、页面刷新、停止Agent或放宽原阈值。一次通过不证明历史长期增长根因已全部消失。
- 最终独立确认使用冻结前端HTTPS LAN `https://10.30.0.24:19891`、自有证书、后端端口9并由API fixture完全隔离；`d-acceptance-final-soak.log`完成875轮/1801.922秒，**仍失败**。heap低点+5.793MiB、backing storage低点+0.172MiB；renderer RSS低点312.305→466.445MiB（+154.141MiB＞128），观察峰值509.824MiB。页面/采样错误为空，同一PID/start ticks。RSS增长断言失败，后续峰值及最终音频空闲断言未执行；循环内至多一个AudioContext。冻结源指纹2662项另存私有文件；之后的提示、浮层和依赖修改不计入此源码快照。原门槛未放宽，一次较高预热基线下的绿灯不能关闭长期RSS红灯。
- `d-current-recovery.log`8项通过：双context项目离线合并、低运行快照、已接受消息缺少完成事件、health失败、真实SSE gap及阅读中未读。`d-current-editor.log`两尺寸通过，核对隐藏、关闭工具/二级页/别名目录后的同一iframe身份和未保存buffer。
- 扩展旧矩阵`d-recovery-memory-matrix.log`27通过/2失败/1默认跳过；失败包括旧gap启动与context退出，后续对应8项恢复已通过。没有把默认跳过30分钟当作通过。
- 侧边权限旧用例在本次改动前的冻结服务上也因“模型已从”内联旧文案失败；当前产品按既有原生toast语义，仅用户模型操作提示，恢复存储notice不提示，测试已按实际契约修正。HTTP LAN不提供安全上下文clipboard，计划窗口用例在HTTP上的readText失败不计产品成功，最终完整矩阵改用私有HTTPS复验。

最终检查与剩余验收结果继续追加。所有正式服务与Agent保持运行，没有激活替换运行层，没有commit/push。

## 浮层容器与后续依赖修复

真实菜单交接失败的根因已通过浏览器组件树确认：`DropdownMenuContent`在render阶段查询到旧的`<main class="session-mode codex-plan-window-loading">`。同次commit替换加载占位后，这个container已经脱离文档；Radix内部打开状态更新不重新渲染外层包装，菜单因而仍挂在失效节点中，用户看不到菜单，modal指针遮罩还可能留住。

- `menu-fibers.json`保留实际脱离文档的Portal容器身份。将非模态当作修复的隔离候选失败，未写入产品；只清除遮罩的候选也未修复容器根因。
- `useSessionPortalContainer`在layout effect中选择commit后的根。Dropdown红灯1项、绿灯相关21项；扩查Popover/Dialog/Sheet/AlertDialog的同路径4项全部先红后绿。原模态、焦点和独立ownerDocument规则保留。
- 指针清理放在实际Radix Content内部，实际卸载后才检查是否有其他开放层；另有开放Dialog时不释放其遮罩。该清理解决生命周期问题，不冒充容器修复。
- `d-current-final-ui.log`30项中26通过/4失败；菜单4组、独立计划4组、同步诊断2组均通过。后续定点trace中会话URL、搜索、远端回答和分屏操作通过；两个启动失败明确记录关键JS请求`ERR_NETWORK_CHANGED`。这些失败日志保留，不算作完整矩阵全绿。
- `d-portals-dialog-green-2.log`11文件141项通过，包含容器替换、焦点返回、会话表单原目标隔离、原生菜单动作和暂停接收提示。原表单单测改为等待实际dialog再操作，未改变捕获目标/草稿/回执断言。
- 新增未打开`ConversationOwnerForms`/`SearchChatsSheet`/`KeyboardShortcutsSheet`模块挂起红灯；保持命令拥有者挂载，只延迟按需表单，局部加载状态可取消，加载失败不卸载聊天。`c-dialog-dependency-green-3.log`通过，真实键盘在可见设置页打开快捷键表单，返回后主草稿完整。早两版测试分别误用了Ctrl+K、以及在没有可见命令拥有者的主输入上要求Ctrl+/；保留失败，不作为产品缺陷证据。
- 原生手机专用MobileShell改为只在原生手机入口加载。宽度模拟仍走正常浏览器布局；浏览器挂起该模块仍可输入的复验在`d-current-final-ui.log`及`d-v3-ui.log`通过，不声称验证Tauri实体手机。

## 重连诊断与现场边界

用户确认是在自己的电脑/手机访问，且前台持续使用和后台恢复两种情况都会出现。服务器上自动化Chromium的Docker路由变化不能解释用户原截图的失败来源。

- 提示可显式导出四条固定链路元数据：health、关注、项目、实时消息；包含状态码/分类、次数、时间、耗时、重试时间、待提交数量及页面协议/可见性/联网提示。没有正文、草稿、路径、URL、账号、Token或无限日志。Blob URL使用后释放。
- `a2-export-red.log`先确认缺入口，`a2-export-unit.log`8项验证导出不带额外store正文；`d-current-final-ui.log`两尺寸真实下载核对HTTP503、零待提交、四条链路、文件小于16KiB且无草稿内容。
- 暂停异常投影时也明确“任务状态待核对”，不根据接收暂停判断任务运行；`a2-paused-state-red.log`保留旧文案红灯，对应绿灯包含在141项中。
- 只读解析当前正式网关日志的已完成响应：health 1148次全部200，p95 64.1ms、max3182.2ms；关注3072次全部200、max21.4ms；项目3075次全部200、max24.4ms。只保留固定路径/状态/耗时/时间，证据`formal-api-log-metadata.json`。这不涵盖未到网关、未完成、TLS或浏览器侧失败，不能据此宣称用户网络无问题或重连已根治。
- `pnpm session:status`只读确认正式运行层仍就绪且产物不同；新的运行层代码仅编译和隔离验收，没有替换活跃服务。前述真实网关调度试验不冒充正式运行层已激活。

一分钟原生measure诊断只观察产品guard之后的固定元数据：37626次、总4158752字符、单条最大199字符，无大props。该诊断不是30分钟验收，也没有修复或归因剩余RSS增长。


## 恢复后的诊断、缓存和卸载回调补充

- 短暂抖动恢复后，现在每个通道另留一个lastFailure和累计次数；正常提示仍清除，更多功能中仍可导出，不建立事件数组。100次失败/恢复后快照小于4KiB，先红后绿；a2-retention-green.log四文件15项通过，d-v4-ui.log的17项真实浏览器专项全部通过，含两尺寸恢复前/后下载、正确503和累计次数，无草稿内容。用户实际客户端的频繁失败原因仍待现场元数据。
- 根目录web-v3-unit.log为647文件4123通过/1失败，原因是飞书设置测试在初始禁用时点击；已等待真实可操作状态，产品设置行为未改。后续根目录web-v4-unit.log运行中25份相关文件持续变化，6失败/4124通过及1个迟到回调错误不作为固定版本结论，差异见v4-concurrent-root-changes.json。
- web-v4-frozen-unit.log为648文件4124通过/1失败，唯一失败为副本缺少runtime源码。补齐依赖并以固定Git基线加本轮明确文件形成候选后，candidate-check.log完整pnpm check通过；candidate-web-unit.log为**649文件4126项全部通过**，无未处理回调错误。未覆盖另一工作流的源码。该候选结论不冒充并行修改后的整个工作区已经验收。
- Claude/ACP虚拟列表的上游offset observer移除监听后仍保留scroll-end debounce，可能在文档销毁后通知React。实际滚动→卸载→文档销毁的回归先红后绿；释放后不再转发回调，正文、滚动定位及回收预算不变。c-scroll-teardown-green.log三文件9项通过，且纳入上述全量。
- 独立Vite缓存位于.dev-runtime/vite-cache，React插件默认只排除node_modules，误将已预打包依赖再次交给Babel。实际插件执行红灯c-cache-react-initialized-red.log保留；c-cache-react-green.log八项通过，普通及隔离目录应用组件仍保留Fast Refresh。缓存用途见[Vite官方说明](https://v7.vite.dev/config/shared-options#cachedir)。
- 隔离对照只改该过滤：React DOM响应3,162,607→1,006,153 bytes；入口资源decoded合计22,266,572→19,995,165 bytes。请求数812/813及首次优化状态不同，不从小对照推断p95。c-cache-browser-2.log在自有LAN Vite中实际点击计数0→2后改组件，HMR显示新标题且计数仍为2，无整页导航，依赖响应大小接近已编译磁盘文件。首版夹具0端口被Vite归为默认5173而失败，未干扰占用者；最终显式选择自有临时端口并拒绝碰撞。

冻结生产前端HTTP LAN http://10.30.0.24:19909的d-v4-frozen-production-performance.log三项通过：桌面/手机各30个新context，实际输入p95为1132.4/1125.2ms，max1134.7/1191.7ms；1万条/30关注实际标签点击到正确正文p95 77.0ms、正确草稿77.1ms、按键两帧31.8ms，max84.4/84.4/32.1ms。该检查点早于最后observer卸载保护，不称为最终合并工作区。

candidate-ui-matrix.log为45通过/2失败。首个手机专用模块挂起用例失败确有两个React版本，原因是验收准备将前端和shared构建并行启动：扫描时shared入口尚不存在，随后依赖优化器换版。candidate-vite.log和首次trace保留，属于本轮副本准备错误；应先完成依赖构建再启动新的自有前端。8关注用例失败也停在初始输入，未到其调度断言，单列保留。candidate-development-performance.log保持失败，不能计为完整30次达标。诊断读取不存在的错误详情原会一直等待，已改为即时querySelector，30样本和原两秒门槛不变。

## 开发冷启动补充对照（2026-10-30）

隔离候选仅增加预打包依赖的`minifyWhitespace`，不混淆变量名；先完成shared构建，再启动HTTPS LAN `https://10.30.0.24:19913`。`minified-probe-development-performance.log`完成桌面/手机各30个全新context，原两秒门槛仍失败：实际输入p95为2514.7/2384.6ms，max5501.3/2474.8ms；composer出现p95为2180.2/1876.2ms。暖切换用例独立通过。该实验没有达到目标，**不合入此配置**；没有删除首个服务冷样本或改称完整通过。其源码、日志与完整样本留在私有忽略目录。

输入出现到自动化按键之间还有数百毫秒，需要独立核对测试等待；在同一源码中比较断言轮询与逐帧就绪等待之前，不将这部分全部归因于应用阻塞，也不据此改写旧结果。

### 等待方式与关键入口修复

同一源码、同一HTTPS LAN 19915服务、393px、8组交替先后对照，普通`expect(...).toBeVisible()`的composer出现/按键前时间中位数为1635.2/2209.2ms，驱动额外等待554.8ms；逐帧等待为1628.9/1648.6ms，额外等待25.7ms。实际字符出现中位数2253.3/1736.8ms。完整`cold-driver-comparison.json`保留，不将测试等待的减少宣称为产品提速。正式测试改为逐帧检查可见可编辑，随后仍由Playwright真实按键并观察DOM字符；30样本、正值和2000ms门槛不变。

相同新驱动下，原候选`candidate-raf-baseline-performance.log`完成各30样本：桌面实际输入p95 2325.7ms（composer2185.7ms），仍红；手机通过，不能以单边结果替代桌面。仅改主AppLayout直接导入AgentView、AgentView直接导入公共AgentComposer的隔离候选`critical-entry-probe-performance.log`三项全部通过。桌面/手机实际输入p95为1969.9/1854.1ms，max4716.2/1893.6ms；首个自有服务冷优化样本没有删除。暖切换正确正文p95 237.1ms、草稿237.2ms、按键两帧38.6ms，均保留原门槛。

该两处产品改动已按最小补丁加入根工作区与固定候选；其他provider输入、正文、卡片及可选工具仍延迟加载。副本先停止自有Vite，再构建、验证，完成后再新启前端，避免依赖构建和扫描交错。当前合并工作区含其他任务的并行变更，最终报告须区分候选与合并状态。

## 最终固定候选验收（2026-10-30）

固定副本为私有忽略目录`.dev-runtime/session-ux-verified-candidate-20261029`，从本轮基线及已验证源码构造，包含最后入口、缓存与卸载保护。`candidate-final-source-verification.json`确认测试前后3511个源码/测试/脚本文件及1142个构建文件均未变化；不将这份结果称为当前并行工作区的结果。

- `candidate-final-check.log`：`pnpm check`成功，包含shared、运行层、后端、前端类型检查和生产构建。
- `candidate-final-web-unit.log`：649文件、4126项成功；最后两处入口改动相关的当前根工作区8文件20项也成功（`critical-entry-root-unit.log`）。
- `candidate-final-ui-matrix.log`：50项成功，含挂起/失败模块、预加载无副作用、1/8/30/50全部正文覆盖、Claude/ACP千条历史、桌面/手机深浅主题菜单、同步诊断恢复前后下载、分享/历史锚点、原生用户编辑缓冲和编辑器保留。
- `candidate-final-recovery-matrix.log`：62项成功、1项长测默认跳过，含真实HTTP/EventSource投影、缺口/静默恢复、历史错误与重试、异步问题/审批、未知发送回执、跨页项目/标签、子Agent精确目标、自然正文回收及只读重显。此前已完成的30分钟RSS红灯保留，不将本轮skip算成通过。
- `candidate-final-development-performance.log`与`candidate-final-production-performance.log`各3项成功。两种尺寸各30个全新浏览器context；真实点击和字符输入，没有删除首个服务冷样本、放宽门槛或将自动化等待校准当成产品收益。

| 最终实际操作 | 开发p95 / max | 生产p95 / max |
|---|---:|---:|
| 桌面冷入口输入 | 1921.3 / 4551.3ms | 709.6 / 808.3ms |
| 手机尺寸冷入口输入 | 1923.6 / 2064.0ms | 664.3 / 670.1ms |
| 1万条、30关注，标签点击到正确正文 | 263.4 / 306.4ms | 83.2 / 86.2ms |
| 同一点击到正确草稿 | 263.4 / 306.5ms | 83.2 / 86.2ms |
| 按键到两帧 | 40.8 / 195.9ms | 35.7 / 36.2ms |

访问地址为隔离LAN HTTPS `https://10.30.0.24:19919`与生产预览HTTP `http://10.30.0.24:19921`，监听0.0.0.0；API即时夹具、同一Chromium实例中的新context，393×852为尺寸模拟。以上不等于实体手机、用户网络或真实provider读盘/生成时延；开发源码资源和生产产物分别测量。

最终1/8/30/50覆盖全链路均通过；8/30/50单次点击正确正文906/1172/1362ms，不称为p95。89条私有假native读取只允许initialize/initialized/thread/turns/list，精确PID/start ticks核对的存活列表均空。自然回收在62.343秒时释放后台正文，94.486秒只读重显；heap依次75333104/49371340/76093044 bytes，renderer RSS 381501440/272736256/380698624 bytes，同一PID/start ticks、错误为空。没有用强制GC或刷新参与此自然回收用例。

完成后按PID/start ticks/目录/命令核对，仅清理自有19919/19921前端，见`candidate-final-cleanup.json`；本轮未向真实Agent发送测试任务或执行其停止/重启。正式服务源仍是已有LAN HTTPS 8484，不将被清理的测试地址描述成可使用的正式实例。

### 合并验收仍待完成

根工作区第二次全检期间及后续又有16份源码新增、130份变化（`root-integration-source-changes.json`），含输入、正文、运行层与权限；本轮没有覆盖这些并行改动。第一次全检遇到并行新增图片失败测试类型错误；其后该处变更，第二次全检遇到`codex/ownership-shared.test.ts`返回值不满足Json的类型错误。两次失败日志完整保留，不能从固定候选绿色推导根工作区已通过，也不因这些错误回退其他任务源码。

曾发现明确的合并行为差异：并行改动把`warmFollowedSessions`默认为true，而本轮已批准方案保留不可见正文约60秒回收。后续独立审计核对方案第16、165行及仓库内存约定，确认默认回收已有直接授权，无须再次等待批准；已恢复无偏好默认false，保留设备已存true/false及可选保温实现。不能把存储的true推断为用户明确开启，因为其他设置更新也可能持久化旧默认。两条规则的验收分别记录，见后续整合结果。

现场频繁重连仍需用户电脑/手机的四通道元数据；入口为“更多功能 → 导出连接诊断”，恢复后也可导出最近失败。服务端成功请求抽样及宿主自动化网络变化不能解释用户截图。原标准30分钟RSS红灯继续保留，未以候选短测或某一次长测通过宣称根治。

## 合并代码的追加验证（2026-10-30，继续中）

第一次合并副本为`.dev-runtime/session-ux-merged-probe-20261030`，从当时完整工作区收集426份变更/新增文件，复制过程中指纹无变化，保留全部并行改动。该副本的前端类型检查和生产构建通过（`merged-probe-web-build.log`）；18文件105项与本轮相关的单测通过，新增图标导入优化器5项通过。它们不替代此前649文件4126项，也不代表全部新增功能已验收。

`merged-legacy-retention.config.ts`仅在自有HTTPS LAN 19923测试context内设置真实设备偏好`warmFollowedSessions=false`，不修改当时产品默认值。保留旧版完整自然回收断言，`merged-legacy-retention.log`1项通过，1.7分钟：64.157秒后台正文释放，96.801秒只读恢复；heap为53932952/46765396/91324000 bytes，renderer RSS 353443840/262991872/367333376 bytes，同PID/start ticks，无页面或采样错误。后台完成、审批、草稿、最终回复、单音频上下文及无任务写入断言保留。该结果验证关闭保温的兼容路径，不能替代后续无偏好默认值的自然回收验收。

第三次根工作区全检停在并行新增的native followup接口/测试签名不一致；该实现随后变化。第四次已通过共享包、运行层和后端，前端停在原生界面重试集合的字面量类型过窄。仅补充`Set<string>`类型标注，不改变匹配/观察；当前前端类型检查与对应46项观察测试通过。第五次根工作区`pnpm check`完整通过（`root-integration-check-20261030-5.log`），但其间仍有14份源码变化，列表见`root-integration-5-source-after.json`，不伪称静态固定版本的全量行为验收。

中断后核对发现旧19923服务的工具句柄已不存在，且/proc无原Vite进程；没有把超时当退出或盲目重启。后续使用第二份合并副本，收集452份变更/新增文件，复制期间指纹仍无变化。该副本包含最后类型修复；原副本及其证据保留，待完成依赖构建后再启动性能测试前端。

## Ultra 协作整合与第三副本（2026-10-30）

按用户要求，构建/传输、恢复矩阵、性能/HMR及完成性审计分别使用 `ultra` 协作 Agent。主线程保留集成及验收责任。第三副本 `.dev-runtime/session-ux-merged-probe3-20261030` 复制4301份Git源文件，复制前后指纹无变化，清单为`session-ux-merged-probe3-20261030-source-copy.json`。仅测试监听配置增加`watch:null`和私有端口；夹具后续受控同步单独记录，不能称原始全部文件始终不变。

- 无偏好默认回收：存储恢复用例先3红/3绿，改为默认false后6项全绿，连同留存相关4文件30项通过；保存的true/false不批量迁移。`session-idle-memory`新增不写settings key的新设备分支，保留原可选warm/已存false分支及原长测工作负载。
- 元数据错误：Claude已有revision时的metadataOnly失败原来被静默吞掉；现用已有错误状态展示并在成功后清除，正文保留，取消/旧代次/运行入口变化不发布。另复现并行连接快照先失败使Promise.all提前释放取消owner，改为等待两个结果；新5项及原共享/连接恢复、设备设置合计4文件23项通过。日志保留两次有效产品红灯以及并行新增mock差异，最终为`metadata-and-default-final-unit-2.log`。
- 旧运行层传输回归：CC/ACP忽略`view=recent`时，原网关会把raw工具正文甚至metadataOnly正文送到浏览器；实际4项约3.15MB红灯和新增8项小/大反例保留。网关现接收前2MiB限额，校验实际projection/revision/source/cursor和空metadataOnly；旧raw明确501，投影错误/越界502，取消上游。原无query raw入口保持兼容。该保护不等于旧运行层已可用，独立只读兼容接入另行记录。
- HTTPS取消：真实HTTP/2反例显示CC/ACP recent取消没有传到上游；仅把两个固定recent只读路径加入Vite已有取消处理，写入/full/多view负向用例保留。相关网关51项、前端配置9项通过；真实当前私有运行层和HTTP/HTTPS取消9项与该组重叠，不重复累计。

第三副本的前端类型检查和生产构建已通过（`merged-probe3-web-build.log`）。HTTPS LAN开发19927、生产预览19929均绑定0.0.0.0，API全部隔离夹具。无偏好自然回收用例1项、1.7分钟通过：63.446秒正文释放、95.799秒只读恢复；heap为36752856/34437900/65713036 bytes，renderer RSS318808064/235327488/321159168 bytes。同PID/start ticks，无页面或采样错误；完成、审批、未读、草稿、音频和无任务写入断言均保留，没有强制GC/刷新。日志为`merged-probe3-default-retention.log`，这不是30分钟RSS验收。

新增顶栏延迟入口和面板4项真实浏览器用例全部通过（`merged-probe3-deferred-ui.log`）：1440/393下关注切换、新聊天、Git表单取消、导入预览/重开、左右面板首次打开/关闭/重开，保留实际DOM实例/本地状态、隔离草稿、SVG和输入目标；没有提交Git/导入或native任务。实际图标facade和新增未扫描alias fallback的两项HMR也通过，保留编辑前计数和一份文档，见`perf-hmr-fallback-green.log`。

## final4整合结算与默认策略冲突（2026-10-30）

`final4-check-2.log`全项目构建成功；首轮只因新增测试使用Node未公开类型的Agent.addRequest而红，随后保留真实function断言/spy，仅补typed view转绿。最终Web为725文件4412项、退出0、无未处理错误；2826份Web源/配置前后指纹不变。后端75项、原运行层库17项，以及实际私有旧HTTP服务→官方SDK/SQLite→网关1项通过；显式raw兼容另验证，自动读取raw为0，源表/文件字节未变，精确进程已退出。最终历史恢复22项、真实HTTP/EventSource6项合计28项全部通过；新增关闭最后标签取消、真实侧栏重开并再次分页通过，不把它冒充cross-realm/finally精确竞态的浏览器先红后绿。

但是final4无偏好自然回收测试在75秒时仍有16条后台事件，保留完整红灯/trace（`final4-default-retention.log`）。随后比对发现，并行流程于02:24把默认值从false重新改成true，也将本轮新建初始/缺键测试断言改成true；留存核心模块逐字未变。这解释了单测全绿而默认自然回收红灯，不能说原批准默认已在共享树生效。

为避免互相覆盖，保留共享工作区及原final4。新建`.dev-runtime/session-ux-approved-retention-20261030`，精确派生自final4，只恢复默认false、区分“全部预加载”和“额外保温”的注释及初始/缺键false断言，设备已存true/false和其他可选保温实现不变。候选默认测试再次3红/3绿→修复后4文件30项全绿；全项目与全量/自然回收/性能验收使用独立身份继续。最终共享树的策略整合另行协调，尚未把候选结果称为正式入口已切换。

### 批准回收策略候选的已完成检查

`approved-retention-check.log`全项目类型检查与生产构建退出0；`approved-retention-web-unit.log`为725文件4412项通过、无未处理错误。该次命令显式使用4个Vitest worker，仓库配置仍为2，未修改测试负载或断言；2826份Web源码/配置前后指纹一致，摘要为`approved-retention-web-unit-summary.json`。这些结果属于该固定候选，不覆盖之后继续变化的共享工作区。

`approved-retention-default-browser.log`无settings存储键的新设备分支通过，未由测试写入false偏好。1.158秒三线程均有16项正文，63.068秒后台正文自然释放，95.491秒只读重显恢复新完成回复。JS heap依次36,925,748／34,841,368／65,312,840 bytes；renderer RSS依次324,206,592／239,116,288／313,974,784 bytes，均为同一PID 3602345、start ticks 221841173。页面及采样错误为空，审批、未读、草稿、完成信息、音频与无任务写入断言保持；没有强制GC或刷新。该短测不能替代原30分钟RSS红灯。

### 严格性能驱动发现的证据缺口

此前性能驱动虽然采集控制台错误，却未在冷入口成功分支断言错误为空。补齐后，`approved-retention-development-performance.log`的两个冷入口均在第一个context发现夹具误关闭Vite热更新WebSocket；每尺寸仅一个样本，不构成30次p95。该文件的暖切换30次p95为415.2ms，超过原300ms门槛，保留失败原件，不以较早候选的绿色数字替代。

另核对到首个暖切换观察器越过后续点击，在再次选择相同目标时才写入结束时间；这条1607.9ms记录存在跨手势归属问题，而415.2ms慢样本不能据此排除。后续只校准每次真实点击与其完成观察的对应关系，并精确放行测试自身的HMR连接；不缩减1万条/30关注负载、不删除首样本、不放宽2秒/300ms/100ms门槛。该校准本身不算产品性能收益，重新验收尚待实际结果。

### approved-retention严格性能校准结果

性能驱动最终SHA256为`19c2e3a79d5d9d2e9c02cbf460bbe1ce1d05765fe48efe4874d18ff97e537d6b`，根目录与该固定候选一致。完整开发/生产各3项均退出0；每种冷尺寸各30个全新context，每个暖用例30次真实点击及输入，原门槛不变。下面顺序为p50／p95／max，单位ms：

| 场景 | 开发HTTPS 19935 | 生产预览HTTPS 19937 |
|---|---:|---:|
| 1440px冷入口实际输入 | 1559.2／1671.4／3631.6 | 734.2／837.2／868.7 |
| 393px冷入口实际输入 | 1487.8／1588.6／1597.8 | 684.6／747.7／752.9 |
| 正确正文 | 165.2／246.9／249.9 | 64.3／76.3／79.3 |
| 正确正文与草稿同时就绪 | 165.3／246.9／249.9 | 64.5／76.3／79.3 |
| 按键到两帧 | 26.9／47.4／52.1 | 35.8／47.2／47.6 |

开发首文档3631.6ms完整计入；不能把p95通过写成每次两秒。独立新浏览器暖切换的正文及草稿p95为234.5ms、输入53.2ms，90次暖手势均无跨手势归属或失效标记。120个冷context及三个暖页面均无pageerror/consoleerror，开发全部60个冷context与两个暖页面都有真实自有HMR connected帧。这里的草稿计时以正确正文为共同条件，不能当成独立草稿store恢复耗时。

测试开启request、longtask及框架trace观察，是有观测开销的隔离Chromium基准；API夹具、393×852尺寸模拟、同一运行浏览器中的新context和初次服务冷文档分别记录，不等于实体手机或真实provider时延。3940份源码与1650份构建文件前后无变化。首次显式重复启动tracing的两个导航前准备错误和trace保留；该次有效独立暖测试区块与最终驱动逐字相同，不将整次失败命令记为通过。完整证据为`strict-final-20261030-RESULT.md`、`strict-final-20261030-summary.json`及`strict-final-20261030-execution-record.json`。

独立完成审计随后补查公共历史路径：该旧候选尚有Claude侧栏首次选择raw读取，以及ACP选择会调用load/new的旧行为；共享树已具备更新的ACP只读入口。以上性能结果仍有效，但不证明这两个公共历史入口已完成，最终整合需带上相应修复与真实源浏览器关卡，不以合成API响应遮蔽它们。

## 当前工作区第五次固定整合

重新核对原批准方案第16、165行后，确认默认约60秒回收属于本轮已授权修复，无需把先前的跨流程协调问题变成新的批准门槛。根工作区仅按已验证两文件补丁恢复无偏好默认false及其测试，保留已有true/false偏好和可选保温实现；逐字前置哈希与结果为`approved-policy-root-integration-20261030.json`。先前默认true的代码、75秒红灯及两条工作流的历史记录均保留。

新增CC入口测试先4/5失败，再发现异步选择回调的实际Unhandled Rejection；只修改`useSessionSelection.ts`，改走已有recent reader，不再追加raw正文或清除后台任务loading，并消费回调拒绝。最终6项全绿，失败由已有owner错误状态提供重试，不将catch当成历史成功。

严格性能窗口还记录到插件及技能重复读取。三独立mention消费者对相同参数分别调用3次，StrictMode为6次，新增测试首轮12红/2绿。现仅共享有效cwd、能力/目录修订及完整scope内进行中的Promise；不新增完成结果TTL，32项索引有界，完成/失败和HMR清理。每个hook仍有原requestVersion和scope采用检查。最终16项新增与4项原刷新回归合计20绿，证据为`mention-pending-20261030/`；不从请求数下降推断CPU或点击时延收益。

`.dev-runtime/session-ux-current-v5-20261030`重新复制当前共享树4408个Git源文件，复制前后无变化，包含当前ACP只读公共选择、scope/JSON消费及上述入口修复。仅增加隔离`watch:null`和私有环境；HTTPS LAN前端19939监听0.0.0.0，API后端指向未监听的loopback测试端口，所有数据测试须显式接自有夹具。`v5-check.log`全项目类型检查与生产构建退出0；4018份源码/测试和1705份构建指纹已记录，新增E2E helper的后续受控同步单独记载。全量单测、自然回收及真实源/双页浏览器正在结算，不能把旧候选结果直接冠为v5通过。

### v5已完成的验证

- `v5-web-unit.log`：747文件4558项全部通过，退出0且无未处理错误；CLI沿用4worker，仓库默认2worker未改。`v5-server-related.log`75项、`v5-runtime-related.log`18项分别退出0。原始结果与源码边界汇总为`v5-completed-checks-20261030.json`，新增hook与mention测试已在4558中，不重复累计。
- `v5-default-browser.log`：不写settings键的自然回收1项通过。0.026／61.951／94.478秒依次为正文具备、后台释放、只读重显；heap为74,153,328／33,960,648／100,690,852 bytes，renderer RSS为352,464,896／234,590,208／359,698,432 bytes，同PID2648120/start ticks223113883，页面和采样错误为空。审批、草稿、完成与未读保持，没有强制GC/刷新，也没有关闭原长期RSS红灯。
- 双页同reader新增4项通过，17.3秒，证据`.dev-runtime/dual-page-reader-20261030/`。真实HTTPS/H2前门→原生HTTP转发→生产HTTP1网关/reader；17项准入、溢出429、queued/inflight取消、公平每至多3前台后轮后台、同页合并及单消费者取消、另页独立请求、旧目标/scope/deadline均验证。33个native精确PID/start ticks全程峰值1、全部退出；原生方法仅initialize/initialized/thread/turns/list。预期两条429控制台诊断保留；其余控制台和pageerror为空。此为最小协议DOM组合，不冒充公共标签或跨页合并；公共1/8/30/50关卡独立保留。
- 新辅助历史实链共3个独立浏览器用例：CC1440、ACP1440/393，证据`.dev-runtime/aux-browser-20261030/{RESULTS.md,MANIFEST.json}`。真实私有SDK JSONL/只读SQLite→已验证旧协议形态HTTP模拟→生产编译网关/库→完整工作台侧栏、分页、两段详情、PNG解码、关闭取消及重开；没有在Playwright合成历史正文。raw及任务写入为0，源字节/SQLite表不变，每次detail关闭均观察到上游取消；错误源501有可见拒绝，草稿/目标保持，pageerror为空，三个自有源进程均退出。CC/ACP近期最大响应71,611/78,655 bytes。两ACP在原三项命令中已绿，CC修正测试的可选按钮假设后专项14.3秒通过，未重跑ACP挑结果。

v5严格性能开发3项与生产3项各运行一次并退出0，完整120冷context/60暖手势保留。每项30样本，下表为p50／p95／max，单位ms：

| 场景 | 开发HTTPS 19939 | 生产预览HTTPS 19941 |
|---|---:|---:|
| 1440px冷入口实际输入 | 1510.9／1715.6／3296.2 | 764.9／836.5／841.0 |
| 393px冷入口实际输入 | 1471.5／1664.2／1686.5 | 721.7／751.2／757.3 |
| 正确正文与草稿同时就绪 | 144.5／214.5／766.5 | 54.7／67.9／70.3 |
| 按键到两帧 | 31.7／47.6／47.9 | 29.8／49.9／51.7 |

所有页面及控制台错误为零，手势无失效/跨次归属；60个开发冷context及暖页实际收到HMR connected。开发冷首文档3296.2ms与暖首切换766.5ms完整计入，不能写成每次都达到p95门槛。慢暖样本重叠169个资源，仅一项62ms长任务，证据不足以推断CPU根因。两版30次暖窗口的插件/技能接口均各30次、每次点击各1次，证明重复调用减少，不等于CPU或时延因果对照。原2秒/300ms/100ms、工作负载和计时驱动保持；4018份源码、1705份构建在性能准备前后不变，详细样本/哈希/请求见`v5-strict-performance-20261030/`。

### 共享树仍存在的整合边界

v5冻结后，共享树又有29份源码/测试差异，包括native读取scope、详情可见性、导航/样式及默认策略；本轮没有把这些并行新增修改覆入固定候选。前述按批准方案整合的默认false随后再次被另一流程改回true，其注释引用另一流程Q5/Q8。实际共享树现为默认持续保温，v5为批准方案的约60秒默认回收，不能将v5验收称为共享默认已生效。

当前差异清单为`v5-current-root-comparison-20261030.json`；已生成并只读核对可应用的两文件补丁`approved-v5-policy-review-current-root.patch`，保留已有设备偏好，暂未再次覆盖默认值。完整公共UI与恢复回归继续在精确v5上运行；所有通过结果、原长期RSS红灯及缺失的用户客户端重连元数据分别记录，不宣布整个目标完成。

### v5公共UI与恢复矩阵结算

公共UI的11文件首轮为49通过/1失败，原命令退出1、日志和trace保留。真实冷URL分支的历史`thread/read?view=chat`和新独立`thread/metadata?view=chat`均200，旧测试却只统计read并要求两次。只修测试统计，严格验证历史1次、同owner元数据1次/换owner0次，保留fromLink/元数据调用栈、首次账号前0次、目标/正文/草稿及零任务写入。两分支定向2项通过，其中一项与首轮重复；去重为50个场景，而非51。89份自有native reader清理记录均无存活项。四条计划窗口的Vite WebSocket诊断来自夹具显式关闭WS，单列保留，不把整组说成控制台零错误。汇总为`v5-ui-matrix-20261030-final-summary.json`。

恢复矩阵15文件共65项，已单独通过的无偏好default回收不重复执行。首轮63通过/1失败/1默认30分钟skip，原命令退出1、日志及JSON保留。唯一失败的完成家族用例已通过compact0、完成3项等UI断言，末尾零错误断言发现三个management complete请求404。定向trace证实夹具漏登记child-atlas/iris/echo的完整原生线程，生产guard正确拒绝不存在的目标；不是metadata或静态资源缺失。

仅给公共夹具增加可选、惰性的明确nativeThreads清单，并由子Agent测试提供已存在的完整child对象；普通UI线程/关注列表不变，未知ID404、scope/CAS、能力和只读guard及零错误断言全部保留。受影响的完整子Agent文件20项定向全绿，未重跑其余14文件。恢复去重为64通过+1默认长测skip，另有无偏好回收的独立1通过，不将20次重跑累计。该批显式false自然回收63.354秒、95.411秒重显，同renderer PID3016800/start ticks223227419，heap35,910,608／32,946,284／68,355,712 bytes、RSS322,383,872／233,742,336／314,699,776 bytes，页面和采样错误为空。真实HTTP/EventSource上游100,669,814 bytes投影为浏览器6,178个SSE数据字符、最大317字符；该物理留存项使用强制GC，不能当自然回收数据。

固定候选产品及构建没有因以上测试校准改变；后续E2E最小同步和源码指纹单独列出。只读`pnpm session:status`仍确认正式运行层PID1676067就绪、运行二进制与磁盘产物不同；未为验收替换它或停止Agent。本轮隔离验证不能等同于正式运行层已经启用新产物，用户客户端频繁重连的根因仍需其四通道诊断。

## 2026-10-30 用户统一默认持续保温

用户对默认策略明确回复“统一为：预算允许时持续保温”。该决定取代本轮原先默认false/约60秒的规则，默认策略冲突已解除：无持久偏好采用true，全部关注最近页在既有预算内保温，可见优先、压力或超预算回收；已存true/false不迁移，显式false继续约60秒回收且不后台再热。休眠正文的迟到事件、历史与设备缓存不得直接重新填充；再热仍需原预算、冷却及精确只读reader准入。原8MiB显示、IDB2/30MiB、并发及RPC上限保持，任务、审批、草稿、未读独立。

此前v5默认false的结果与整合冲突保留为历史，不能改称当前默认已通过。两份恢复false的旧补丁仅作历史证据，不再应用。用户客户端故障诊断JSON仍未提供；本次新输入已解除默认决策阻塞，当前继续整合验证，原blocked计数重置。

`session-idle-memory`保留未预置settings键的分支，改为真实核对初始null及挂载后实际store为true，再执行原120秒保温、9×1MiB真实EventSource压力、回收后不复活/只读重显和审批/未读/草稿/音频保护；显式false原自然回收分支保留。相同六项设备设置契约对精确旧v5 store的私有reference为3红/3绿，当前store为6绿，旧v5文件及当前产品store未改；证据为`warm-default-idle-contract-20261030/`。默认压力浏览器尚待新候选实际执行，不从单测或旧显式true结果推断通过。

新固定候选`.dev-runtime/session-ux-current-warm-20261030`复制当前4439份Git源文件，前后无变化；仅设置私有监听配置及`watch:null`，未替换正式服务。相对已验v5，当前冷依赖图、缓存执行确定性、来源撤销、Provider旧cursor确认/隐藏取消、新窗口daemonIdentity及窄屏导航均有实际新增，按差异安排单测、相关浏览器及严格开发/生产性能，不把旧v5绿色直接外推。当前候选全项目构建/检查已退出0，前端752文件4606项、运行层差异15项、网关差异19项全部通过，详见`current-warm-completed-checks.json`及原始日志；真实浏览器与严格性能结果随后单列。

### 当前warm固定候选的检查与功能结算

- 当前`pnpm check`退出0；Web752文件4606项全部通过（274.06秒，CLI4worker/仓库配置2未改），网关差异19项、运行层差异15项分别退出0。原始receipt见`current-warm-completed-checks.json`。
- `current-warm-functional-20261030-report.md`汇总27项入口/导航/原cursor/缓存执行/新窗口及45项HTTP/EventSource/流式预算/后台/恢复/审批/异步问答/回执，共72个独立用例全部通过、无重试。旧子Agent21项按精确来源和语义单列复用，不混入当前72项；窗口mention持久键变化由新窗口两尺寸补证。
- HMR按内存约定额外验证：初次3例因宿主文件监听配额ENOSPC未到实际HMR；隔离夹具改用`CHOKIDAR_USEPOLLING=1`后cache/recent通过，locale原夹具未调用当前显式初始化入口而0订阅。仅对夹具补真实mount及替换后的owner初始化，保留live=1、5通知、旧Map/WeakRef/8MiB及草稿/历史断言，最终3项通过（5.3秒）。该因果诊断显式GC，不能替代自然回收、生产或长期RSS证据；失败日志、精确patch及自有tmp清理记录保留。
- 4039份源码相对初始冻结只有两个明确授权E2E差异：`session-public-performance.spec.ts`生产HMR前置判断、`session-hmr-retention.spec.mts`显式初始化夹具；产品及1709份build指纹不变。前者首次生产准备在5000ms HMR等待红，最小修复后准备绿的30样本标记`acceptanceEligible:false`且保留，不用其并发单测期间数字当正式性能。
- 新的独立三页原生HTTP正式基准（09:29）三页各30样本通过，正确输入p95为1903.8/1932.0/1895.4ms，按键51.6/49.7/50.9ms，四窗格未缓存正文另为约3.83–3.91秒。2886份前端和89份shared源码与本候选逐项相同（`current-warm-vs-native-http-formal-source.json`）；它使用另一配置/夹具冻结、传递依赖指纹不完整，不累计到当前候选通过数，也不把移除Fetch拦截后的方法差异直接归因于产品或缓存。旧route正式红灯和单轮2233/2239.5/2246.2ms诊断仍保留。

默认无key/显式false自然内存与重启自有前端后的严格公共性能单列结算。真实用户设备四通道现场诊断仍未提供，原30分钟RSS红灯不关闭；未替换正式runtime或停止Agent。

### 当前warm默认、严格性能与服务结算

无偏好默认true与已存false两项首轮通过（2/2、退出0、259.662秒、无重试）。默认启动settings原值null，实际store为true；120.097秒后台正文仍有实际内容，9×1MiB文本的原生EventSource完成事件压力后123.611秒释放后台正文引用，155.794秒通过只读reader恢复最终回复。显式false于62.461秒释放、94.509秒恢复。审批、草稿、完成/未读、休眠不回填、原音频断言和零任务写入均通过；无强制GC、重载或手动release。5100项该专项源/静态/build/helper指纹不变、11个实际观察进程均退出。7个自然采样点的heap/backing/RSS及PID/start ticks见`warm-default-browser-20261030/README.md`，压力临时分配仍保留，不把正文Map释放解释成RSS即时归还。

随后仅对两个自有Vite监听器完成PID/start ticks/cwd/argv/端口核验后停止旧进程，启动全新19943/19945且未HTTP预热。正式开发3项、生产3项各完整运行一次并退出0，每个场景30样本；120冷context、60暖手势完整保留，page/console/socket及invalid均0。p95/max（ms）如下：

| 场景 | 开发 | 生产预览 |
|---|---:|---:|
| 桌面冷入口实际输入 | 1574.5 / 3476.9 | 803.3 / 849.2 |
| 手机尺寸冷入口实际输入 | 1521.6 / 1567.3 | 745.0 / 774.8 |
| 正确正文与草稿同时就绪 | 197.7 / 962.2 | 70.0 / 84.3 |
| 输入到两帧 | 41.9 / 42.1 | 46.4 / 48.4 |

原2秒/300ms/100ms门槛保持。开发首冷3.48秒与index0首暖962.2ms均真实保留，p95通过不等于所有单次达标。首暖重叠194项资源及128ms longtask，仅时间关联不能认定CPU原因；插件/技能各30次只证明每次点击端点1次。测试基于带观察的私有API夹具，手机为393×852模拟，不能代替实体客户端、真实provider磁盘或模型延迟；生产正确允许零HMR socket，开发实际连接HMR。

4039份源及1709份build在正式性能前后零变化。所有自有浏览器退出后精确关闭2078157/2078170；19943/19945已停，正式8484/8282仍为原监听器。`pnpm session:status`退出0，正式runtime PID1676067仍运行旧产物，未因构建切换或停止Agent。原始样本、指纹及慢尾见`current-warm-strict-performance-20261030/`，清理见`current-warm-final-owned-stop.json`。

性能结算后共享root又出现独立metadata/list来源保护增量，另有并行只读LAN验收/HTTP夹具改动；固定候选保持不动，后续定向类型/单测单列，不能把本节性能改标为该新组合完整已验。真实用户设备频繁重连的现场JSON仍未收到，既有30分钟RSS红灯未关闭。

### root来源保护独立增量补验

固定候选之后，root的`codexService.ts`又增加轻量metadata/list的完整来源锁存、排队/发布复核、最新列表隔离及订阅释放；首次收尾观察e3ce…之后仍有更新，最终实际验证产品SHA为9279231f64059f08999d904106f38dd50442aa911061bc72a61f7bf5c611b3a5、新测试070e29e40b8b012054dc41c1f7444ae14149fec6dae67e13c0f4566907a92eed。本轮独立一次6文件75项通过（含metadata-source12例及history-source/list/deadline/queue），13个受检文件前后无漂移；另做前端tsc退出0并核对产品/新测试前后SHA相同。没有修改peer源码或固定候选，没有重标全量、浏览器及性能组合结论；通用订阅finally已审，专用计数未逐一覆盖失败/超时/reset的边界如实保留。证据见`current-root-metadata-source-20261030/`及`current-root-metadata-types-verification.json`。

### 逐要求完成审计与新guard三页补证

来源保护增量之后另有新三页独立正式结果：3页各30次，正确输入p95为1880.3/1896.2/1876.2ms，按键47.7/48.3/44.9ms；首次冷启动最大4616/4607/4630.6ms完整保留，未缓存四正文p95为3953.1/3913.2/3884.6ms。2887份前端及89份shared运行文件与snapshot/当前root逐项相同，产品确为9279231f…3a5；shared源码28份无漂移。该独立原生HTTP/H2组合补证不加到77项，也不转标原单页开发/生产6项；server夹具传递依赖仍未有完整闭包manifest。核验见`final-guard-three-page-independent-verification-20261030.json`。

按A1/A2/B/C/D及原验收矩阵复核：A1首屏与真实输入、B完整预加载/优先级/双页受控native、C三种源到公共UI、D候选构建/单测/恢复/资源/资料均有对应有界证据。B6按生产queue/codexService两页→原生fetch/H2→网关→native与公共1/8/30/50组合闭合，不声称跨页合并或整页压力。A2可复现的错误/重试/提示已验，现场高频断连的根因仍缺用户设备四通道JSON，目标因此不能宣布全部完成。当前只读状态仍为PID1676067、older，ownedAgents字段未知，不能据健康200判定任务空闲；不隐式激活新运行层。旧长期RSS红灯及被取消的新诊断都不算内存通过；未追加重复浏览器测试。
