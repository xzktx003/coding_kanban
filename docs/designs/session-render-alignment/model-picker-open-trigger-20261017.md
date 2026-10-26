# R28e8：模型菜单打开时的 Trigger 呈现（2026-10-17）

**本轮产品执行关卡已结束。** 精确Product V3与Browser V6的新8例已取得旧E7真实RED→同字节GREEN，类型、related589、恢复后的完整100控制、短时内存、web生产构建和只读status均有实际收据。本文记录产品实现与执行实绩；最终root封存、独立终审和放行以外置 `model-picker-open-trigger-r28e8-release-receipt.json` 收据为准，文档准备包的封签不代替最终放行。整体Goal继续active。

## 行为与最小范围

普通本地OpenAI main和真实展开Sheet，在菜单**实际打开且有效视图为simple**时，同一Trigger显示操作目的：effective model为“选择强度”，effective Default为“选择模型”。保存FI不是有效模式的替身；saved Default对当前pair不成立时仍按effective model。advanced、自然单项／空项形成的advanced及closed保留原当前model＋bt，不改用物理选项回退／TX标签。独立Power caption的menuitem aria-label仍为“选择模型”，可见内容仍是当前强度＋模型。

只改`NativeModelSelector.tsx`、`NativeModelTrigger.tsx`和`.session-mode`内局部`composer-native.css`。原owner/root/layer、FI首开seed、Default、B联合本地意图、R27当前行、R29 bt、tier、recent、wheel、pointer／键盘、focus、350ms reset与pointer lock保持；呈现不新增model/effort设置。current行仍可能记录APP recent，同值FI setter也可能持久化，不能笼统宣称零storage写入或native原子CAS；raw cache、A/B/default/custom、pending/revision、草稿与输入归属分设硬保护。

这是本APP ordinary展示范围，不是完整原生Ct/Lti/Pti或账号／rollout／权限资格证明。primary model error保留legacy，首pending/Loading、generic/custom、Side独立选择器与direct-basic保持既有路径；已接受主目录后的附属pending/error与背景fetching不新增success-only门槛。普通320ms enter及350ms reset不是Daybreak，不作为目的文案的延迟门槛。

## 同节点宽度、局部cap与可访问性

打开前量取本节点实际current content与hidden purpose，保存两者较大值，覆盖current更宽／purpose更宽两方向，button/ref不替换。关闭清除，重开重测；**open advanced只恢复raw选择子树，临时宽度保留到close**。percentage-contract曾把advanced误写为clear，独立erratum已纠正，不据笔误新增行为。

完整有限非负px cap才做数值clamp，扣除实际button chrome后保留numeric content minWidth；none／空cap保留源最大值。其他非空／非none cap采用可收缩preferred content width，由min-width:0、原flex-shrink和外层CSS解析当时布局，不能把`100%`经parseFloat当100px或冻结开前auto grid旧area。Sheet百分比依据当时实际grid area，不以viewport／整条footer替代；oracle逐phase读取used tracks、数字列span、gap、content box与box-sizing，未知形式记夹具诊断。

保留主输入窄视口110px cap、1px容差与button／chevron／page overflow约束，不改CSS阈值，不引timer/DPR/伪style或scale。原CT为默认1的context、wT按该scale除宽度；本APP使用正常局部CSS几何，preferred-width是本地grid/flex适配，不声称完整原生布局、任意zoom/transform/calc解析或逐像素一致。

simple-open purpose分支卸载当前model/effort selection子树，移除stale raw aria-label／aria-labelledby。measurement只含目的文字，aria-hidden、visibility:hidden、fixed、pointer-none、nowrap，不能用隐藏raw子树让旧断言假绿。closed恢复raw名称，advanced恢复原selection／ARIA。

Radix modal菜单会将后台Trigger分支设为aria-hidden。始终观察同一捕获按钮：可见目的、零selection spans、无raw aria及独立隐藏measurement无条件核对；实际AX-hidden时计算名称为空，不能宣称暴露目的名称；实际exposed才要求名称等于目的。settled main／Sheet记录背景隐藏，最终close恢复exposure／raw name；不用hidden:true、不改modal/Portal或隐藏属性制造名称。这是本地依赖源码与Chromium接受测试，不是新的官方IDE AX实测。

## Tooltip／单Escape窄修与E9边界

原V2完整100控制为89passed／5failed／6timedOut：4次首Escape后menu在5s内未关闭、6次raw tooltip实际拦截Power指针输入（4 preferences、2 wheel），另1次seed context destroyed未归因。六超时共20条cleanupErrors（preferences4×3、wheel2×4）；保存的SSE closed记录不能证明observer／page／最终快照清理完整，失败后未达的晚期动作和断言不补认。wheel在首次hover已被阻断，不能称wheel／boundary／Ctrl已测；focus fixture本来没有自有SSE。

精确V2的原完整16 focus诊断为12PASS／4pointer FAIL（1440／390、main／expanded），复现一次trusted Escape不关闭；失败后post-rethrow parity/source/API/input断言未执行。先前seed contextloss此次未复现，原因仍未知，不归给Tooltip／HMR／导航。六次指针遮挡由实际call log直接支持；后来Tooltip DismissableLayer截获首Escape属于源码与现象支持的机制解释，没有原失败现场的layer/call trace。

必要补充将原E9 actual-open-only隐藏提前E8：原Dca在isOpen（simple与advanced）返回tooltipOpen=false，V3相对精确V2只在Trigger向既有ComposerTooltip传`popupOpen={enhancedTrigger && pickerOpen}`，Selector/CSS不变，shared Tooltip／菜单动作与等待不变。V3原16 focus已16PASS，随后恢复后的**完整同100全部PASS**，原六个指针遮挡场景到达后续完整动作／保护；Root实际查看四张代表open图未见raw tooltip再盖Power。四图只是视觉观察，不附加tooltip独立AX证明，也不把popupOpen称为完整Dca。

closed tooltip仍为raw model/effort；E9 closed-purpose文案和完整Dca选中后hold／首blur／pointerleave生命周期仍未实现。generic/direct/basic/error/pending沿原适配，未新增原生权限或账号能力。

## 实际RED/GREEN与历史分类

| 阶段 | 实际结果 | 分类与限制 |
| --- | --- | --- |
| 原R20 baseline首次／corrected | 首次worker-config失败、15未运行；corrected **16PASS／96.0091s** | 私有output-existence guard被worker重载误触；首次无product body，不算产品RED |
| 旧E7 focused unit | **149=119PASS／30FAIL** | 新13=6目标AssertionRED＋7control；legacy136=24迁移投影RED＋112control；258消息不是258测试，旧硬呈现失败后的未达守护不补认 |
| 旧E7 migrated browser | **48=46迁移投影FAIL／2custom control PASS** | post-open投影失败后的未达检查不补认，不是最终100结果 |
| 新browser V2／V3，旧E7 | 各 **8FAIL／0 qualified product RED** | V2 reopen误期待menu容器、实际caption；V3第二ArrowDown实际到强度thumb，驱动失败保留 |
| V4，旧E7 | **8 qualified RED；372 errors=312 target＋40 caption fixture＋20 cap fixture** | 原352 target含40caption，外部澄清纠正；20百分比oracle错误不是产品几何红，8例行为红仍有效 |
| V5，旧E7 | **8 qualified RED；368 errors=328 target＋40 caption fixture** | 无百分比几何／驱动／清理错误；与V4为同组历史，不累加成16缺陷 |
| root reader／产品V1类型 | promotion KeyError发生于产品写入前；V1实际 **TS2783 FAIL／26.0627s** | 误名after-product的27.5216s PASS实际仍E7；V1 aria重复与静态parseFloat问题由combined V2修正，不冒称GUI几何红 |
| V2类型／单测 | web **26.9593s**、E2E V5 **2.8909s**均exit0；focused **149PASS／23.6156s**，related **39文件589PASS／63.7329s** | 589包含149，不能相加；这是V2历史，不替代V3验证 |
| V5 on V2 | **8FAIL，仅40 caption fixture／82.4789s** | 每例5条caption null，其余purpose／geometry／硬保护／清理通过；名含green的runner不等于整体GREEN |
| V2完整100／原16诊断 | **89PASS／5failed／6timedOut，984.8355s**；诊断 **12PASS／4FAIL，104.0110s** | 4首Escape＋6指针遮挡＋1未知seed；20cleanupErrors、晚期未达及无ownSSE边界保留 |
| 同V6，旧E7 | **8 qualified RED／328纯target（41×8），81.6302s** | 13states；0caption/cap/driver/cleanup错误，旧hooks缺失使positive width条件分支未进入，不补认正向宽度通过 |
| V3类型／related | web **26.8981s**、E2E V6 **2.7593s**均exit0；**39文件589PASS／63.5851s** | 已重新验证V3，包含new13／focused149，不与V2或子集相加 |
| 同V6，V3 | **8/8GREEN／69.0733s** | 同8ID／同V6字节，每例13states及正宽度分支已达；main各11／Sheet各10正向geometry记录，四读取／raw-owner等保护及observer／ownedSSE清理通过，3560四maps稳定 |
| 原16 focus，V3 | **16PASS／78.7192s** | 包含在后续完整100的同16覆盖内，不加总成116 |
| V3完整100首次，基础设施故障 | **66PASS／1timedOut／33FAIL，568.3950s** | 第67例加载原R22模块时自有前端消失，后33goto refused，34例业务未达；不是产品RED或完整100通过 |
| 恢复后V3完整同100 | **100/100PASS／853.8359s，exit0，worker1／retry0** | 与原discovery精确ID顺序，3576四maps／HEAD稳定；是另一完整批，禁止66＋34拼接 |
| 原8文件memory28 | **27PASS／1默认30min soak SKIP／325.9104s** | 原字节／阈值与E7同，3581四maps冻结；短时回归，不是长期RSS闭合 |
| web生产build／status | **exit0／71.4714s**（Vite42.91s）；**exit0／0.653875s** | 原chunk／dynamic-import warnings保留，唯一生产build在全部browser后；正式runtime磁盘未激活 |

V6只将唯一Power caption的aria-label作为观测并精确toBe“选择模型”，零个／多个仍null，原driver/actions/waits不改；V2–V5错按visible textContent搜索，原strengthRows始终另存真实text/label。harness、focus驱动、reader、TS2783、percentage适配／oracle、caption与后续fixture服务故障分别留证，旧报告不回写；早期宽泛分类由独立澄清纠正，不切换环境期待或削弱阈值。文档准备reader裸README误定位等元数据错误亦不计产品RED。

## 自有fixture故障、恢复与完整100的清理边界

第一次V3完整100到第67例时模块fetch refused/reset，首timeout有2条captureErrors（terminal screenshot、page release），后33例goto失败前未seed/hook/readiness/actions；这34例不能用保存的无写入／source/closure检查补认业务通过。68份SSE关闭记录中，只有34例实际连接、另34监听器从未连接；不把unused listener关闭写成68次活连接验收。

故障后只读probe确认旧自有前端PID1238668和reference2247110已不存在，48865不可连接；退出原因**UNKNOWN**，不归因OOM、signal、actor或source。正式runtime2712539/start55361120始终保持。仅按旧exact Vite codex-parity／host0／port48865及原reference脚本恢复两个已经消失的自有fixture，未改产品／测试／env，先做原首R22单例readiness诊断，再整批同100重跑，不拼接旧66与新34；恢复基础设施的launch/readiness和外置live-log边界独立记录。

恢复后的完整100有**68份owned-SSE实际接受连接并全部关闭**，无活动response/socket，observer／reader与订阅清理无capture/cleanupErrors；另focus16＋unknown-label16共32例本来没有ownSSE，不能说84或100份ownSSE。console为**100条Vite＋2条预期warm500＋8条显式directory503**，unexpected0，不写console全零。内部10562个check不是额外测试。已纠正的V2／故障批清理与未达限制不会因新批通过而消失。

## 内存、构建、时序与运行身份

自然三样本（未强GC／未reload）为：

| 阶段 | JS heap（B） | 全部browser renderer RSS（B） |
| --- | ---: | ---: |
| visible-and-background | 165607780 | 487170048 |
| dormant-body-expired | 59868132 | 295387136 |
| read-only-reactivated | 144795656 | 637067264 |

冷正文释放后heap/RSS下降，复显RSS637067264高于初始487170048；只证明该短路径回收与恢复，没有整体平台或长期稳定RSS结论。默认30min soak在`SESSION_MEMORY_SOAK_MINUTES=0`下SKIP，不能计验收。网络fixture记录upstream **100669814B→browser6178字符**、最大单event317字符；其单独forced-GC样本retained35964B，与上表自然样本口径不同，不混用。

Root书签共**47条实际命令**，其中17次实际browser批次（包含上述失败历史）、17次checking；discovery不计测试通过。每命令log、四maps和HEAD前后稳定，browser批次不互相重叠，checking/compiler与browser不重叠；唯一生产build在所有browser结束后。选定49份source/test拷贝及49份original/static拷贝另有冻结index，六旧文完整prefix独立绑定；最终root全包封存与独立终审另由外置收据记录，本文的产品执行结果不代替最终放行。

已结束只读status为0，正式runtime **PID2712539/start55361120**不变，新磁盘产物未激活；仅恢复自有fixture后，前端 **2973342/start111490273**、reference **2973318/start111490242**，最终收据监听0.0.0.0、LAN HTTP48865／37575均200。所有权依据捕获的PID/startTicks，reference的ppid2841不改变原身份；旧1238668／2247110仅作历史，不再声称存活。本文引用最终只读收据，文档准备者没有重新探测网络／进程。

LAN前端 **HTTP `http://10.30.0.24:48865/`**，自有参考服务 **HTTP `http://10.30.0.24:37575/native-goal.html`**。仅本机LAN地址和模拟浏览器接受测试，未直接验证实体同网段设备；390为视口／触控模拟，不是真手机。本批无新官方GUI、真实账号/nativeCLI/SDK/默认IPC、native业务／权限操作；未重启／停止正式Agent、未复制认证、未git stage/commit/push，也未切换正式runtime。APP联合本地意图不是nativeCAS，整体Goal与E9后续仍未完成。

## 证据入口与放行依据

- [最终100／memory资格及口径](../../../.dev-runtime/session-polish-round2-20261016/model-picker-open-trigger-r28e8-root/completed-v3-controls-memory-qualification.json)：其中futureBuildStatusDocsRelease是该文件写入时历史截点；后续build/status实际收据已在本页补齐，最终root/docs/release由外置收据记录。
- [47命令书签与时间区间](../../../.dev-runtime/session-polish-round2-20261016/model-picker-open-trigger-r28e8-root/command-bookend-summary.json)。
- [结束后的运行身份与LAN观察](../../../.dev-runtime/session-polish-round2-20261016/model-picker-open-trigger-r28e8-root/final-owned-runtime-status.json)。
- [49source/test＋49original/static冻结index](../../../.dev-runtime/session-polish-round2-20261016/model-picker-open-trigger-r28e8-root/frozen-source-and-original-index.json)。
- [V3故障批独审](../../../.dev-runtime/session-polish-round2-20261016/model-picker-open-trigger-r28e8-v3-controls-outage-review/review.json)与[恢复后完整100独审](../../../.dev-runtime/session-polish-round2-20261016/model-picker-open-trigger-r28e8-v3-controls-green-review/review.json)。

原链Main hCa→lCa→uca→oca/Dca；已执行ProductV3 seal `6c02605f…`（Trigger `d0c83189…`），Selector `cc436912…`／CSS `272af626…`精确沿用V2 `281cd060…`，BrowserV6 seal `e8e19790…`（`73664337…`）。core、AX、percentage＋erratum、caption及tooltip/Escape公开合同分别保留；产品／测试全文、历次RED/GREEN和独审见同一E8root与兄弟sealed包，不将本轮静态来源说成新原版GUI运行。

本文与六份追加记录同步本轮实现与验证；六份E7完整prefix按`e7-baseline-copies/`及bindings保存，文档准备者未读写live正式docs，正式写入由Root逐字核对前缀后执行。最终root封存、独立终审及外置放行以 `.dev-runtime/session-polish-round2-20261016/model-picker-open-trigger-r28e8-release-receipt.json` 为准。E9 closed-tooltip与完整Dca、原生完整能力、实体设备／长期RSS保持后续边界，不写“完美对齐”或whole Goal完成。
