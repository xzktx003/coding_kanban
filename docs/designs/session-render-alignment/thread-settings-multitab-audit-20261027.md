# 多页线程设置持久化审计与专项验收

2026-10-27。初始只读审计确认的问题、后续设计及独立浏览器红绿证据均保留于本文。线程设置的事务实现已通过本文末尾的冻结源码专项验收；主线程的完整构建、消费者与 HMR 检查单独记录。全局 Followup 偏好另已完成[独立修复](followup-preferences-multitab-20261027.md)，不与线程设置事务混用。所有浏览器诊断在新建上下文中执行，未发送正式任务或审批。

## 已确认：另一页可覆盖未发送的线程设置

初始取证版本的 `apps/web/src/session-mode/stores/useThreadModelStore.ts:181` 用 Zustand persist 把全部 `threads` 写入 `kanban.session.codex-thread-models`（version 2）。`changeThreadModel` 和 `hydrateThreadModel` 均从本页 map 构造下一份 map；另一页面的更新不会先归并到本页内存。单线程修订比较只保护本页请求时序，无法防止另一页随后写入整份旧 map。

这违反 [模型设置规则](../../session-model-selection.md) 的已有线程隔离与待生效选择保存约定。真实双页反例均已复现：

| 步骤 | 页面 A | 页面 B | 持久结果 |
| --- | --- | --- | --- |
| 起点 | 恢复 thread-a/native-a、thread-b/native-b | 同样恢复两个线程 | 两页基线一致 |
| 本机选择 | 把 thread-a 改为 chosen-a/high，pending=true | 尚未操作 | A 内存及此时磁盘均为新选择 |
| 反例一 | 保持页面打开 | 只对 thread-b 调用 changeThreadModel，选择 chosen-b/low | thread-a 被 B 的旧 native-a 快照覆盖 |
| A 刷新 | getThreadModelSettings(thread-a) 返回 native-a、pending=false | — | 未发送的 chosen-a 丢失 |
| 反例二 | 再选择 chosen-a-2 | 仅对 thread-b 调用 hydrateThreadModel，处理新的原生设置观察 | A 刷新仍恢复 native-a；不要求 B 主动改设置 |

诊断使用实际生产 store 模块、两个真实同源页面及真实 localStorage；通过独立诊断 HTML 展示状态，没有打开正式应用会话。LAN 地址为 **HTTPS `https://10.30.0.24:8484`，端口 8484**。全部 `/api/**` 拦截拒绝，实际 API 请求数为 0、pageerror 为 0。它证明存储与实际 selector 恢复故障，不冒充完整 Composer 控件交互或原生发送验收。

证据目录 `.dev-runtime/session-settings-multitab-20261027/`：

- `probe.mjs`：可重跑诊断，显式提供 `SETTINGS_AUDIT_ORIGIN`。
- `evidence.json`：两页内存、实际持久内容、reload 后 selector、源码 SHA。
- `run.log`、`reloaded.png`：反例结果与恢复状态。
- `audit.md`：初步只读记录。

取证源码 SHA-256：

| 文件 | SHA-256 |
| --- | --- |
| useThreadModelStore.ts | `158563c65319611f69623e5e1eeb7913bcd39446e456eb7d3008ba879b309ef1` |
| useFollowupSettingsStore.ts | `65cd7962540fe61d553c62531e0eeb1bff3b8610e055dc40037955e4f7773459` |

`useThreadModelStore.test.ts` 已有单模块线程隔离及单份快照重新 hydrate 用例；这些测试不能证明两个独立页面交错安全。`followupParameters()` 从实际 thread store 读取下一次发送配置，因此刷新丢失会影响后续捕获的模型。**已入队消息使用先前冻结的参数，不能据此推断已入队配置被修改。**本轮没有发 native turn，也不宣称已观察到真实模型误用。

## 最小可行方案建议（尚未实现）

建议保留当前 UI 同步内存 API，将持久层改为 IndexedDB 每 thread 一行，在真实 readwrite 事务内读取最新行并应用显式意图。仅将全局 map 拆成每 thread localStorage key 可以解决不同线程互覆盖，却无法处理同线程不同字段、原生观察与本机选择竞争；localStorage read/merge/write 不具备 CAS，不能作为完整修复。

第一阶段可限制为同源本设备线程设置：提供 ensure/flush/保存状态，发送前明确等待所捕获的 thread 设置落盘并核对身份；保存失败保留本机选择和可重试错误，不自动发送。无需更改原生协议，也不扩展为跨设备设置同步。使用少量当前字段/组的修订及待生效身份，不保存完整历史快照或无界操作日志。

事务应接收本机编辑、原生观察、精确回执和提示关闭四类不同意图，不能接收并覆盖调用页整份 ThreadModelEntry。不同线程事务互不影响；同线程由事务序列化，再按字段/设置组处理因果关系。原 store 的通知、待生效显示和原生来源信息必须保留。存量全量 localStorage key 仅作为只读迁移备份，空行/迁移标记防旧页面复写备份后复活旧设置；迁移失败不得覆盖原始数据。

## 必须保留的语义与验收

1. **pending 与 pendingFields**：本机编辑只更新实际修改的字段，合并其他未确认字段；原生观察可更新 observed/nativeSettings，但旧观察不能清掉当前 pending。model/provider/effort、sandbox/policy/webSearch、reviewer/capability 等现有相关字段组不能任意拆开产生不可能组合。同线程独立设置组的并发编辑均应保存；同字段冲突须有明确次序或可恢复冲突，不允许静默覆盖未保存的选择。
2. **revision 与编辑身份**：当前 revision 是各页数字，两个页面可生成相同值，不能充当跨页唯一编辑身份。新持久协议需在事务内推进可比较修订，并为本机编辑/相关设置组保留唯一身份。相同值的后续真实编辑也不能被旧 ACK 当作旧选择处理；同时保留当前“无实际变化不通知”的行为。不要复用文字草稿 owner/revision 来掩盖线程配置竞争。
3. **readAt/请求开始屏障**：当前 ThreadModelEntry 没有名为 readAt 的字段；现有 `readInitialThreadMetadata` 和历史恢复在请求前捕获本页 revision，返回时传给 hydrate。新协议需要对应的、可序列化的读取开始标记（可命名 readAt，但应是修订/编辑身份及运行代次，不是墙钟时间）。读取在 A 编辑前开始、B 编辑后返回时，应保留 B 选择。事务执行较晚或本机时间较大不等于原生观察较新。
4. **ACK 与 partial metadata**：回执必须绑定原 thread、捕获的编辑身份/字段及运行实例；缺失字段不是清空值，旧 read/fork ACK 不得确认之后的选择。保留 `initialOnly` 的仅补缺行为、原生显式 null 清除语义、legacy provenance unknown 边界及 pending 模型匹配规则；不能把无来源的值相等伪造成跨客户端原子确认。原生协议没有 CAS 的地方，必须明确本地防护的范围。
5. **运行切换**：读取或写后回执遇 runtime/account scope 改变要忽略旧结果，不能把旧设置当成新连接的写入权限，也不自动 resume/acquire/停止 Agent。测试要覆盖请求开始后切换、事务等待期间切换、相同 thread ID 出现在不同有效运行 scope 的边界。持久缓存仍只是偏好/观察，`nativePermissionMetadata` 必须继续仅在内存、写盘和恢复均剥离，不能新增权限缓存来源。
6. **提示与资源**：notice dismiss 必须精确到对应 notice 身份，不能覆盖另一页的新模型提示。保留 nativeSettings 分组替换、pendingFields、personality notice、providerModels 的既有行为。不要轮询全文历史，也不广播正文；页面失焦/恢复或设置事件的同步仅涉及有限设置元数据，隐藏页面不得据此发任务。
7. **失败与恢复**：配额/解析/事务取消保留当前本机设置并可显式重试，晚 ACK 不能改写另一页新编辑。IDB 同时初始化、旧备份反复回写、HMR 在途编辑、发送等待设置保存期间切换目标都须测试。已经捕获或入队的 parameters 保持原值，不能为合并缓存而重新生成提交身份或重发。

至少补两项已确认反例的永久红绿回归，再覆盖同 thread 不同设置组并发、同字段冲突、旧 readAt/ACK、runtime 切换、损坏/配额、迁移与保存后刷新。真实浏览器应复用生产设置入口和只读/隔离 API，不必重复本批 contexts9、capture2、submission10 的全部验收，但与新设置保存门禁相交的消费者必须复验。

## 低一级：全局 Followup 偏好字段互覆盖

`useFollowupSettingsStore` 的 mode、enterBehavior、reviewDelivery 是全局本机偏好，不是 thread-owned 配置。诊断确实观察到 A 将 mode 改为 steer、B 将 enterBehavior 改为 cmdAlways 后，A 刷新得到 queue/cmdAlways：B 的旧 mode 随整对象写回。

该问题单列为较低优先级的同源多页偏好保存体验，不与线程 pending/ACK 协议合并。`useConfigStore` 是新聊天默认，`useAgentSettingsStore` 是当前 Agent/指令类型偏好；本轮仅审阅这两个 store，没有实证双页反例，不能按 grep 宣告业务故障。不同设备/profile 各自保存偏好是正常边界，不要求共享草稿或设置。

初始只读阶段没有修改产品或写入“已修复”清单。后续专项仍未测实体手机、性能、原生跨设备并发改设置或所有权限策略，不能把本机设置持久化验收泛化到这些范围。

## 实施前独立审阅与永久红灯

独占浏览器回归 `tests/e2e/session-thread-settings-multitab.spec.ts` 已建立；仍使用实际 store 模块、真实同源双页和真实浏览器存储，所有 API 请求拒绝，不挂载正式会话。

- `.dev-runtime/session-thread-settings-multitab-20261027/red/`：首批 4 失败、1 通过。不同 thread 的 change/hydrate、同 thread 不同字段、迟到 snapshot 均复现；volatile permission metadata 的既有剥离边界通过。
- `red-boundaries/`：另 2 项失败，覆盖 A→B→A 的新模型编辑被旧同值 snapshot 确认，以及另一页的 initialOnly fork 观察覆盖 pending/新 notice。该批源码 SHA 仍为本报告取证值。
- 每项输出 `settings.json` 记录真实捕获和恢复结果。原生权限用例先确认内存中确有 metadata，再枚举实际 localStorage/IDB 检查未写盘，并在另一页恢复确认缺失，避免用空输入得到假通过。
- 新异步实现下，同 thread 测试明确在 A 编辑前让 B ensure 相同旧基线，不能因 B 首次恢复发生在 A 保存后而退化成顺序写测试。

消费者接入审查清单：

| 来源 | 现有行为 | 所需接入约束 |
| --- | --- | --- |
| `codexService.readInitialThreadMetadata`、`resumeThread` | 请求前捕获本页 numeric revision，返回 hydrate | 改为请求开始的 read token，附运行代次；仅等待本地设置恢复，不申请 writer |
| `features/thread-workflows/threadLinkService` | 链接只读 threadRead，同样用 numeric revision | 保留只读/选中目标 guard，使用相同 read token 协议 |
| `useServerNotificationHandler` 的 thread/settings/updated | 无 read 请求 token 的原生观察 | 不能借此 ACK 所有待生效字段；保留来源/运行身份，不用事件入库时间冒充读取时间 |
| `Composer.handleSubmit` | 点击时已经捕获 followupParameters，之后等待 contexts | 同时捕获设置 selection/token，等待其保存后核对，不在 await 后替换原 parameters |
| `SideChatPanel` → followupService.submit | 无显式参数，服务读取线程设置 | 集中在服务捕获并等待正确 thread 的设置，不借主输入/全局默认 |
| `SubagentInput` → followupService.submit | 显式参数来自子线程 native metadata，省略权限以继承原生 | 不可把省略项补成主线程/本机 store 权限；保存门禁不能改写该显式参数域 |
| `codexService.turnStart` | Goal、inline edit、async questions、slash、旧 queue 等共用 | 默认读取路径须等设置；保留 configOverride 的冻结值与优先级，不在等待后漂移原目标 |
| `features/thread-workflows/edit.ts` | rollback 前冻结 config，未知/已完成回执重试复用原 config | 不得重新读当前设置替代已保存的 rollback config，不能因设置保存失败重复 rollback/发送 |
| `conversationActions.createSideChat` | fork 前捕获父设置供缺字段回退，结果 initialOnly hydrate 子线程 | 父捕获等待一致、原线程身份固定；fork ACK只补缺，不确认子线程之后的本机选择 |
| `codexService.threadFork/threadStart` | 创建/分叉响应 seed 返回 thread | 保留返回精确 thread 与 capture epoch；响应不得覆盖已先到的设置或 pending |
| `useThreadModelSettings`、slashCommands、模型/权限 UI | 同步本机编辑与显示 | 保留同步乐观交互，显示 loading/saving/error/conflict，提供明确恢复；不能将保存失败伪报成原生权限失败 |
| `ModelChangeNotice`、PersonalityNotice | 本机 notice 显示/精确dismiss | dismiss仅对应本次 notice，不能触发别的线程整行覆盖或重新宣布旧提示 |

拟定兼容 API：`ensureThreadModelSettings(id)`、`flushThreadModelSettings(id,capture?)`、`captureThreadModelRead(id)` → hydrate `options.readToken`、`captureThreadModelSelection(id)` 返回不可变 settings/token，以及 `retryThreadModelSettings(id)` 和每线程 storage 状态。此处记录协作接口，不代表实现已验收。

同值编辑身份应使用 A→B→A 回归，而不是强迫现有 A→A 无实际变化创建新身份；应保持后者不通知订阅者的约定。native permission metadata 仅是 volatile 观察，其变化可以使本页读取屏障失效，但不得因持久化而成为另一页的权限证明。

### 开发版独立复验（尚非最终冻结）

`green-first` 首批七项在事务实现上通过（5.4 秒）。追加同组冲突后显式 retry、旧备份带权限 metadata 的只读迁移，两项也通过；二者不代表原生写权限或真实任务验收。

`extra-first-actual` 另发现并复现事务实现的混合 patch 缺口：B 的基线 serviceTier=null，A 设置 fast；B 提交 `{model:"new-model", serviceTier:null}`。本页未变化的 serviceTier 没有计入冲突保护 groups，原完整 patch 却仍写入它，导致远端 fast 被覆盖成 null。保护字段和实际 reducer payload 必须一致；可以只传真正变化的字段，或为显式未改字段也校验前置条件，不能写未受保护的组。该批为 2 通过、1 失败，保存了实际恢复结果；最初 `extra-first` 的语法错误是夹具失败，不计产品红灯。实现方已收到反例，后续修复和最终冻结复验另行记录。

实现方将事务 payload 收窄为本页实际变化字段后，`green-second` 全部 10 项通过（7.6 秒），包括上述混合 patch 回归。spec 严格 TypeScript 检查通过（`spec-types.log`）。这是开发版验证，核心 HMR/超时及消费者仍在并行收敛，不等于最终源码冻结。冲突重试通过实际 store API 显式调用，不能代替主线程另测的真实 Composer 状态控件与双尺寸交互。


### 冻结源码最终专项结果

`green-final` 全部 **10/10** 通过，耗时 **7.545 秒**，0 skipped、0 unexpected、0 flaky。`source-before.json` 与 `source-after.json` 核对核心 store、事务适配器、权限元数据辅助模块、新聊天配置 store 及该 spec 的 SHA-256；`source-verification.json` 的 `sourceDrift` 为空。结果 JSON、实际恢复状态与日志保存在 `.dev-runtime/session-thread-settings-multitab-20261027/green-final/`。

混合 patch 的独立断言仍保留：B 的未改 serviceTier=null 不能清除 A 的 fast；恢复结果必须同时具有 B 的 new-model 与 A 的 fast。测试没有删除保护断言或为通过扩大预期范围。全部任务 API 拦截仍启用；同组冲突后重试是实际 store API 层显式操作，完整 Composer 控件恢复另由主线程验证。

最终发送门禁保留既有参数捕获契约：仅等待点击时已有的保存前缀，之后改变设置或目标不替换该次捕获；旧scope/保存失败/同组冲突才阻止提交，不能把“之后任何配置变化均拒绝”作为修复。实现、消费者与最新联合结果见[第四批](session-parity-batch-r4-20261027.md)。
