# 会话内存防回归约定

## 已确认有效的修复基线

**后续现场反馈（2026-10-10）**：用户随后补充，会话模式内存虽然增长变慢，长时间使用仍逐渐增加。因此下述确认仅代表此前的暴涨已缓解，不能解释为长期内存问题全部解决。原有保护继续保留；剩余增长需区分缓存留存与浏览器分配/回收波动，并验证更长时间的自动释放效果。新版官方扩展的生命周期释放证据见[后续对照](session-browser-memory.md#后续反馈与新版插件自动释放对照2026-10-10)。

2026-10-10，用户在部署修复后明确反馈：**“这次的内存修复很关键，内存控制住了。”** 对应代码提交为 `78884745a307282c854523355dad9f872b6d47fb`（`v1.3.0`，已同步 GitHub / GitLab）。这是用户现场确认；此前自动测试的结果及适用边界单独列在下文，不把用户反馈换算成未经测量的内存数字。

此前现象：Codex 执行任务时，浏览器标签页一两分钟涨到数 GB 后崩溃；没有对话时也缓慢增长，且没有打开右侧编辑器。多轮仅限制消息条数、隐藏工具行或裁剪前端缓存的修改未能完全解决。最终有效方案同时修复了**传输前裁剪、历史读取触发条件、空闲状态更新**，并保留此前的有界流式渲染和引用释放。

本文件是当前维护约定。[排查历史与测量详情](session-browser-memory.md)保留了早期方案；其中“工具正文仍通过网络进入浏览器”“保留工具预览”等阶段性描述，不得用作恢复旧行为的依据。

## 后续修改必须保持的边界

**2026-10-30 用户留存策略确认：** 全部关注会话的最近页预加载后，默认在既有资源预算内持续保温，可见正文优先；压力或超预算时回收后台正文。设备已存true/false不迁移，显式false继续约60秒不可见回收且不后台再热。休眠正文不能被迟到事件、历史回包或设备缓存填满；开启保温后的再热也须经过现有预算准入、冷却和精确只读reader，不扩大字节、并发或RPC预算。旧默认false阶段的自然回收记录保留为历史证据，不能替代新默认保温及压力回收验收。

2026-10-20 React 诊断补充：仅清空时间线仍会先序列化大 props，产生 JS 堆未充分反映的原生分配；开发模式明确 React 的 `devtools.properties` 必须在原生 `measure` 调用之前剥离，保留计时／轨道及普通应用 API，不修改 React 复用参数。原生对照、适用边界和完整页面验收见 [React 性能记录](session-react-performance-memory.md)。

2026-10-20 子 Agent 补充：独立 `subagents/snapshot`／`verify` 不经过通用聊天代理，必须自行在网关序列化前裁剪；不得把 `boundedSubagentThread` 的前端过滤当作传输保护。活跃轮次优先只读 `itemsView: notLoaded`，明确不支持时才回退；旧运行层返回完整 items 仍必须在浏览器前剥离。保留父子身份、权限和当前轮次，回归及证据见 [空闲轮询正文透传修复](session-subagent-memory.md)。此修复不自动关闭已有长期 RSS 红灯。

2026-10-20 热更新补充：替换 `sessionCacheState` 时必须释放旧模块的恢复正文／时间 Map，模块级 store 订阅也必须 dispose。旧 ES 模块可继续存在，不能只检查当前 Map 或 `Runtime.getHeapUsage.usedSize`；外部字符串还应核对 `backingStorageSize` 与 renderer RSS。该路径有明确触发条件，不等于任意组件更新都会泄漏；物理留存回归与范围见 [HMR 释放](session-hmr-memory.md)。

2026-10-20 输入补充：文字草稿必须按 owner 保存实际变化，不能恢复每键序列化完整草稿集合；动作型文件树／附件消费者不得订阅输入全文。关注集合／项目相同快照既不能通知 UI，也不应反复写设备缓存，尤其不能用空闲轮询覆盖另一页的本地选择。保留逐会话版本、同步落盘、旧备份／墓碑与失败重试边界；验收入口见 [输入响应](session-input-responsiveness.md)。这些 CPU／存储修复不替代 renderer RSS 长测。

2026-10-14 命令详情补充：聊天投影仍不发送任何命令输出。四类命令只有显式展开才经固定精确项通道读取；完整命令、输出、ANSI 派生节点和复制闭包局限于可卸载子组件，关闭/隐藏立即释放，不依赖聊天 60 秒宽限期。返回保留展开状态但不自动重读，取消须另外证明自有 native reader 实际退出。网关使用同一只读 reader 支持已运行旧会话服务，禁止因此重启 Agent。实现与测量边界见 [命令详情](session-command-details.md)。

| 边界 | 必须保持 | 会重新引入问题的做法 |
| --- | --- | --- |
| 浏览器接收数据之前 | 浏览器 SSE 与 Codex 只读历史使用 `view=chat`；Node 网关在发送前裁剪隐藏工具正文，且不把该参数传给运行层 | 只在 React、store 或 `JSON.parse` 之后过滤；以“界面没有显示”为理由恢复原始大包 |
| 工具及内嵌数据 | 同时覆盖输出 delta、最终工具项、turn/thread 内嵌 items、raw response、hook、diff、自动审批复核等；子 Agent 的 prompt/message 仅保留有界预览，当前为 1024 字符；原生 `unified_diff` / `content` 先映射成 `diff`，单个文件 diff 最多保留 24,000 字符供聊天计数和悬停预览，超出仍标记未加载；命令输出、MCP 结果和原始响应不进入聊天 | 把完整工具正文、超大 diff 或命令输出放回聊天投影；通过工具参数、`agentsStates.message`、元数据或旧缓存重新持有原始正文 |
| 协议与任务状态 | 保留原事件序号、轮次生命周期、真正的审批/提问及子 Agent 身份/状态；后台内部消费者继续使用原协议 | 直接丢掉序号造成缺口与重读风暴；混淆“自动审批复核提示”和“需要用户处理的审批请求” |
| 过大 SSE 帧 | 当前单帧上限 16 MiB；网关发出命名事件 `session-projection-error` 后释放上游，浏览器暂停接收并显示原因；显式重试恢复连接与只读历史 | 静默丢弃审批；伪造 `seq: 0`；自动无限重连并回放同一巨帧；为恢复页面而停止 Agent |
| 后台历史读取 | 首次加载、连接缺口、缺失回执、完成边界、手动/页面恢复触发补读；外部空闲会话由轻量状态列表的 `updatedAt` 变化触发 | 恢复“活动静默 5 秒 / 空闲 30 秒”完整历史轮询；把工具执行安静当作消息丢失；活动时间戳每次变化都重读正文 |
| 完成恢复 | `active → idle/systemError` 即使旧 timing 仍为 `inProgress` 也要补读；读取中发生完成须合并排队一次后续读取；轻量快照持续 idle 与本地 inProgress 矛盾时，按轮次去重补读一次 | 为减少请求漏掉最终回复、未读状态或外部客户端保存的历史；读取中完成被直接忽略 |
| 不可见正文生命周期 | 以实际可见聊天正文组件计数；默认在既有预算内保留关注最近页，可见优先、压力或超预算回收。显式false在最后使用者离开约60秒后释放可恢复正文、流式缓冲与派生缓存（5秒扫描，繁忙时可延迟）。回收后的再热须有预算、冷却和精确只读reader准入；运行状态、审批、草稿及未读独立保留，重显只读恢复最近页 | 把关注等同于无预算永久驻留；让迟到delta/历史/设备缓存直接重填休眠正文；绕过准入或沿用已释放的旧分页起点漏掉回复 |
| 空闲同步 | 相同项目/标签快照返回原 Zustand 状态，不通知订阅者；真实变化、操作确认与错误恢复仍正常发布 | 每两秒生成新根状态，即使字段相同也通知整片 Markdown、卡片和导航重渲染 |
| 开发性能时间线 | React 大属性在原生 measure 序列化之前剥离，时间线留存也须释放；开发专用、明确识别 React 的记录，普通应用 measure/mark 保留；同时测 renderer RSS | 只测 JS 堆；先序列化完整 React 属性再清空、长期保留 React User Timing 记录；清空所有应用计时或生产 API |
| 完成提示音 | 单个活跃/关闭中的 AudioContext；每声结束断开节点，连续任务复用上下文，空闲 30 秒关闭；音频时间冻结时有墙钟释放兜底，HMR 释放旧实例 | 每次完成 new AudioContext 却只调用 oscillator.stop；仅测 JS 堆而忽略原生音频资源；自动播放阻止后无限积累挂起上下文 |
| 前端留存与渲染 | 活动助手正文使用有界稳定分段，完成后再渲染最终 Markdown；显示缓存与线程元数据不重复持有工具正文；截断预览断开大字符串引用 | 每 token 复制历史数组、拼接全文或重跑 Markdown；用短 `slice` 的字符数证明原始大字符串已释放；移除预算和退出观察范围的清理 |

这些是行为和资源边界，不禁止有证据的替代实现。修改预算、协议或恢复策略时，必须记录替代方案、相同工作负载下的测量结果，并更新对应测试；不得仅删除断言、放宽阈值或关闭恢复能力使测试通过。浏览器预算不是 RSS 的硬上限，不在生产中强制 GC 或周期性刷新页面掩盖增长。

## 代码与回归入口

以下路径均相对仓库根目录。修改哪一条路径，就至少运行该行测试；涉及传输、历史或状态联动时，同时运行下面的整组验收。

| 修改位置 | 必查测试 |
| --- | --- |
| `apps/server/src/routes/session-mode.ts` | 同目录 `session-mode.test.ts`；`tests/e2e/session-network-memory.spec.mts`（真实 HTTP → 网关 → 浏览器原生 EventSource） |
| `apps/server/src/routes/session-subagents.ts`、`services/codex-subagents.ts` | 对应两个 `.test.ts`；`tests/e2e/session-subagent-network-memory.spec.mts`（真实 HTTP、15 秒自然空闲轮询、旧运行层巨量正文）；`session-subagents.spec.ts` |
| `apps/web/src/session-mode/lib/eventStream.ts`、`services/apiAdapt/codex.ts` | `lib/eventStream.test.ts`、`services/apiAdapt/codex.history-page.test.ts`、`services/apiAdapt/codex-ownership.test.ts`、`components/codex/thread/CodexAccessNotice.test.tsx` |
| `services/followedSessionHistorySync.ts`、`services/followedSessionStatusSync.ts`（位于 session-mode） | 对应两个 `.test.ts`；`tests/e2e/session-background-sync.spec.ts`、`session-restoration.spec.ts`、`session-state-recovery.spec.ts` |
| `services/codexTranscriptActivity.ts`、`sessionTranscriptRetention.ts`、`components/codex/hooks/useTranscriptVisibility.ts`（位于 session-mode） | 对应单测；`tests/e2e/session-idle-memory.spec.ts`；发送回执、审批和恢复回归 |
| `services/sessionCacheState.ts`、`sessionTranscriptCache.ts`、模块级最近访问／语言订阅（位于 session-mode） | `sessionTranscriptCache.hmr.test.ts`；`tests/e2e/session-hmr-retention.spec.mts`（真实 HMR、旧正文物理释放）；`session-idle-memory` 与恢复回归；旧代迟到读取不得重填已释放缓存 |
| `stores/useAgentCenterStore.ts`、`stores/useWorkspaceStore.ts`（位于 session-mode） | 对应两个 `.sync.test.ts`，尤其 `unchanged polling snapshots do not notify UI subscribers` |
| `apps/web/src/main.tsx`、`lib/react-performance-retention.ts` | `lib/react-performance-retention.test.ts`（纳入 `pnpm --filter web test:terminal`）；`session-react-performance-memory.spec.mts` 原生序列化前裁剪与 RSS 对照；30 分钟 `session-idle-memory.spec.ts` 同时核对 React measure / RSS |
| `utils/beep.ts`（位于 session-mode） | `utils/beep.test.ts`；`tests/e2e/session-idle-memory.spec.ts` 原生 WebAudio 上下文空闲归零 / 连续任务只创建一个；30 分钟同时观察 JS 堆与 renderer RSS |
| `services/codexTranscriptVisibility.ts`、`codexTranscriptMemoryBudget.ts`、`components/codex/stores`（位于 session-mode） | 对应单测；`tests/e2e/session-codex-stream-memory.spec.ts`、`session-transcript-memory.spec.ts`、`session-memory-governor.spec.ts` |

仓库根目录执行类型检查、构建和单测：

```sh
pnpm check
pnpm --filter server exec tsx --test src/routes/session-mode.test.ts
pnpm --filter web exec vitest run --config vitest.session.config.ts
```

浏览器验收前准备隔离 fixture 使用的前端，前端绑定 `0.0.0.0`；`PLAYWRIGHT_BASE_URL` 设置为实际局域网可访问 URL，协议与 `PLAYWRIGHT_FRONTEND_PROTOCOL` 一致。下列命令复用已启动前端，不向真实 Codex 任务发送压力数据：

```sh
PLAYWRIGHT_SKIP_WEBSERVER=1 pnpm exec playwright test \
  tests/e2e/session-idle-memory.spec.ts \
  tests/e2e/session-network-memory.spec.mts \
  tests/e2e/session-codex-stream-memory.spec.ts \
  tests/e2e/session-transcript-memory.spec.ts \
  tests/e2e/session-memory-governor.spec.ts \
  tests/e2e/session-background-sync.spec.ts \
  tests/e2e/session-restoration.spec.ts \
  tests/e2e/session-state-recovery.spec.ts
```

涉及字段裁剪还须核对审批/提问和子 Agent 回归：`tests/e2e/session-async-questions.spec.ts`、`session-message-delivery.spec.ts`、`session-subagents.spec.ts`。接口新增 query 参数时，fixture 按 pathname 或可选 query 匹配，确保失败注入和慢读场景确实执行，不能只改断言。

## 验收证据与判断方法

- **传输证据**：基线测试送入 24 个 4 MiB 工具帧，加审批与最终回复，原始数据 100,669,814 字节；浏览器收到 4,964 个 SSE 数据字符，26 个序号连续，审批和最终回复保留。17 MiB 单帧只收到一次命名错误，不收到巨量普通消息。新实现至少保持“大工具正文没有进入浏览器”的断言；具体字节数会随元数据变化。
- **真实页面空闲观测**：稳定代码、真实后端、未发任务、未开右侧面板，125 秒 renderer RSS 从 266.5 到 253.8 MiB，范围 230.4–288.7 MiB，未强制 GC；最近历史读取 3 次，旧采样为 16 次。这是一次观测，不是所有设备必须达到的固定阈值。
- **前端物理留存**：保留 `SlicedString` 回归；逻辑字符数、事件数和 DOM 行数不能替代 GC 后留存量测量。直接调用假 EventSource 回调的测试不能替代原生网络测试。
- **现场反馈**：用户已确认本次修复后内存控制住。未来若再次出现增长，分别记录任务活动/空闲、网络入站量、读取次数、JS heap、renderer RSS、自然 GC 后的趋势及观察时间；区分短期分配、持续留存与其他进程，不凭单个峰值判断泄漏。不用开发热更新/构建中的采样充当稳定代码对照。
- **独立未解决项**：1 万条历史 / 30 标签的输入延迟阈值尚未稳定达标，旧版本对照也超过 200ms；这与本次内存修复的用户确认分别记录，不能因此声称所有性能问题都已解决。

维护本约定时同步更新 [bug 清单](debug_list.md)及[仓库记忆镜像](../memories/repo/debug_list.md)。未来发现更好的实现，应保留这里的故障背景和验证理由，让下一位维护者知道为什么这些限制存在。

新增实际时间长测（同上准备隔离前端和局域网 URL）：

```sh
SESSION_MEMORY_SOAK_MINUTES=30 PLAYWRIGHT_SKIP_WEBSERVER=1 pnpm exec playwright test \
  tests/e2e/session-idle-memory.spec.ts --grep 'long-running native'
```

默认不运行该 30 分钟用例。它使用原生 EventSource、持续任务与反复切换，不强制 GC，附件 `natural-gc-soak.json` 记录 JS 堆及 DOM/监听器计数。Linux 下该附件同时记录浏览器 renderer RSS，其他平台需另行采样，不能以堆值替代；React 开发性能记录不得继续留存。

## 原生工具元数据兼容验收（2026-10-10）

原生工具 UI 保留有界的身份、状态、短描述及真实导航目标，工具正文仍在网关发送前裁剪。对应测试从整项工具缺失改为逐项验证元数据、真实完成状态及正文为 null；500 工具压力用例分别约束不含工具的正文/交互事件少于 100、工具唯一身份至多 501、工具事件至多 1002。原先总事件少于 100 的断言依赖整项工具删除，已明确更换表示层指标，未更改生产事件预算。相同压力负载的 4 MiB 字节、heap、SlicedString、强制 GC 与自然 GC 门槛保持；已单批通过 8 项物理留存与自动恢复用例，后续复验单独记录，不能把逻辑事件数当成物理内存证明。

最终复验：同一隔离 HTTPS 服务单 worker 运行 stream-memory、memory-governor 与 transcript-memory，9/9 通过。自动恢复自然 GC 的 24 次样本保持原门槛；无关会话/隐藏工具输出突发的强制 GC heap 增量为 -68,728 bytes。另子 Agent 12/12、消息投递 4/4、手机输入与附件 4/4 通过。健康探测 503 但只读接口可用的短轮次完成恢复，已在真实 SSE 静默场景验证正文、未读、停止转圈、草稿隔离及单次投递；不据此声称物理手机、所有性能指标或所有插件功能均已验收。

滚动测试已改用实际有界流式增量与独立 live 节点；历史阅读测试使用 20 个独立最终报告，适配原生轮次折叠，阅读位置、未读及禁止执行型请求的断言保持。仍有一项严格滚动验收未通过：正向滚轮跟随 live 内容时，两次独立测试均捕获 ResizeObserver loop completed with undelivered notifications；绘制前及 RO 微任务距底均为 0，但零错误门槛仍为红。未移除或放宽该断言，RO 调度问题作为独立未解决项保留。

后续严格验收定位上述滚动红灯的触发方式：测试在初始 RO 交付微任务的 continuation 中人工注入新正文，导致同周期改变受观察祖先高度；无 React／产品源码的纯 DOM 案例也能复现相同错误。仅在人工注入增长前等待独立动画帧后，三次定向与整文件七项通过。增长后的首个原生 RO 微任务及绘制前距底、零错误、草稿和禁止执行请求断言均保留，产品滚动源码未改；这解释了该测试红灯，不推断所有浏览器和负载都不存在 RO 问题。证据在被忽略的 `.dev-runtime/session-typescript-migration/post-push/scroll-ro-audit/`。

## 两个远程同步后的合并复验（2026-10-10）

合并本地自动回收、文件管理与通知去重，以及 GitLab/GitHub 的原生 UI 和权威完成恢复更新后，在独立工作区验证：`pnpm check`、`pnpm session:check` 通过；会话前端 1548、终端前端 534、后端 792（另 1 个跳过）、脚本 105、编辑器伴随扩展 4 个测试通过。隔离 HTTPS 前端为 `https://10.30.0.28:18487`，绑定 `0.0.0.0`；没有启动或中断用户 Agent。

文件传输／展开／草稿、不可见正文 60 秒自动回收和真实 SSE 恢复：12 项通过；传输、流式正文及物理留存回归：11 项通过。原生 HTTP → 网关 → EventSource 压力用例保留上游大于 96 MiB、浏览器正文小于 128 KiB、最大事件小于 16 KiB、回收后 heap 增量小于 8 MiB 的原断言，序号、审批和最终答复同时通过。可见历史 5 次强制 GC 样本为 41.28／40.51／40.74／40.79／40.36 MiB，自动恢复 24 次自然 GC 样本约 46.95–84.07 MiB；无关正文突发回收后 heap 增量为 -96,836 bytes。此轮没有重跑 30 分钟 renderer RSS 长测，之前的长期增长失败记录和严格滚动问题仍保留，不能把这些短时测试解释为长期 RSS 已彻底解决。

隔离工作区的 Node 类型解析复用已经安装的 `@types/node` 包（仅 node_modules 链接，不新增依赖）；其余依赖按远程 lockfile 冻结安装。浏览器初次在冲突清除期间遇到 HMR 加载失败，固定合并内容后新鲜浏览器复验通过，没有因此修改或放宽产品断言。

2026-10-11 回归追加：移除“短命令输出 <=80 字可进入聊天”的分支，输出正文一律为 null，明细继续显式只读恢复。MCP 公开参数与 OAuth scope 是有界元数据，result/credential 不进入聊天；调用方更小的 toolTextLimit 同样作用于保留的参数摘要，安全 cursor 不重新读取已删除的 delta/diff 正文。相关单测与 9 项正文/缓存浏览器通过；30 分钟 renderer RSS 本轮先失败（低点增长 156.79MiB >128MiB），最新 MCP 身份/重连版本随后一次通过，保留两次记录，不把后者解释为长期增长根治。真实 HTTP/EventSource、恢复与审批整组结论随最终验收追加。

同日游标恢复修复：低序号快照的立即重连计入已有物理重连节流。250ms 修复通知仍执行，避免立即关闭刚建立的新流丢失新回复。保留序号、只读恢复、审批快照与原 2500ms 回复可见断言；8 项流单测和 3 次真实 HTTP/EventSource 通过，全组及最新长测以独立批次为准。

2026-10-11 最新严格长测仍为红灯：`/tmp/codex-noncloud-final-memory-soak.log` 30.2 分钟、861 次自然采样，JS 堆低点从 54.3685 到 59.3707 MiB（增长 5.0031 MiB），renderer RSS 低点从 329.0625 到 499.7070 MiB（增长 170.6445 MiB，超过原 128 MiB 门槛）；RSS 峰值 659.9531 MiB，堆峰值 233.6865 MiB，页面错误为零。DOM／监听器的低点仅增加 7／9，不据此排除原生分配或证明无泄漏。实际 JSON 保存在被忽略的 `.dev-runtime/codex-noncloud-final-memory-soak/session-idle-memory-long-r-12e42--natural-garbage-collection/natural-gc-soak.json`。本轮冻结加载源含重复重连修复，随后新增的公共配置投影与批量停止规则未载入该页；不能冒充所有最终源码的同批长测。失败发生在最后的音频空闲断言之前，连续任务仅一个活跃上下文已检查，最终空闲归零不得计作本次通过。之前一次绿色长测不能覆盖此红灯，不放宽门槛、不强制 GC／刷新／停止 Agent。

2026-10-11 独立观测对照（不替代标准长测）：raw-CDP 桌面 1280×720、30 分钟、882 轮相同原生事件负载，传输 178,901,074 bytes，不启用 Network 域；堆低点增长 4.0828 MiB、renderer RSS 低点增长 108.5117 MiB，峰值约 233.238／620.168 MiB，页面错误为零，最后音频空闲归零通过。原门槛保持，无强制 GC／刷新；JSON 为 `.dev-runtime/codex-memory-raw-cdp-desktop.json`。窄屏 700×900 的 Network 域对照同为 882 轮／相同传输量，RSS 增长 135.46875 MiB，仍超原 128 MiB 门槛（`.dev-runtime/codex-memory-raw-cdp-network.json`）；窄屏无 Network 对照增长 111.1377 MiB。不同视口／观察方式／加载源码边界不能混作因果证明；标准 Playwright 的 170.6445 MiB 红灯仍保留。桌面对照额外只读检查仅见两条 WebSocket 日志，未支持持续 HMR 日志积累的猜测。忽略目录内的替代提示音五分钟实验仅验证实验可运行，没有长期收益证据，未写入产品。

2026-10-11 标准当前源码复验仍失败：30.1分钟／859样本，堆低点增长6.7994MiB、renderer RSS低点从311.2930到489.0430MiB（增长177.7500MiB＞128MiB），峰值235.6489／650.6172MiB，错误数组空；失败在最终音频空闲检查之前，不计该检查通过。原门槛／自然GC／连续事件场景保留。日志 `/tmp/codex-noncloud-current-source-soak.log`，完整JSON `.dev-runtime/codex-noncloud-current-source-soak/session-idle-memory-long-r-12e42--natural-garbage-collection/natural-gc-soak.json`。冻结页面早于新增用户图片链接／确认ABA保护；事件／历史／内存源码本轮未改。之前raw-CDP绿色与标准红灯并列保留。

Inspector存档因果诊断（未改产品／安装目录）：仅在独立测试Node进程覆盖Network.enable为总4MiB／单资源1MiB，Network保持开启，其余标准场景／门槛不变。30.1分钟仍失败，RSS低点增长139.6602MiB＞128MiB；堆增长1.6782MiB，页面错误为零。日志 `/tmp/codex-memory-inspector-archive-diagnostic.log`，JSON位于 `.dev-runtime/codex-memory-inspector-archive-diagnostic/`。不能把约38MiB的条件差异解释为完整根因或用此结果覆盖标准177.75MiB失败；更不能直接改门禁的观察方式挑绿。

提示音原生分配诊断未支持更换产品实现：三组独立1280×720 raw-CDP／无Network域15分钟（各440轮／89,236,954bytes），原每声新振荡器RSS增长57.3320MiB，复用PCM的BufferSource方案103.2852MiB，复用振荡器＋Gain并每声断开的方案109.5000MiB。草稿／审批、60秒正文释放、React measure、单上下文及最后自然空闲归零均通过；但15分钟不替代标准30分钟，波形相位／启动测量助手的差异与GC时序不能被忽略。三组均在忽略目录／独立Vite，不修改产品beep.ts，也未修改安装包。两种替代方案未显示收益，未合入。日志为 `/tmp/codex-memory-default-tone-15min.log`、`/tmp/codex-memory-buffer-tone-15min-v2.log`、`/tmp/codex-memory-reusable-tone-15min.log`。

2026-10-11 原生分配归因诊断：独立 raw-CDP 桌面 1280×720／无 Network 域，20 分钟 586 轮、118,854,514 bytes；堆低点增长4.6074MiB、renderer RSS低点增长115.0508MiB，草稿／审批／正文释放及自然音频空闲归零通过。两份 memory-infra 快照使用 deterministic:false，没有触发强制 GC，且记录同一自有 renderer PID186445；不是标准 Playwright 30分钟验收。开始／结束时 Blink 活对象7.6157→8.8730MiB，已提交堆54.8702→58.9952MiB，V8堆容量129.0312→139.0586MiB，buffer分区活对象55.6361→55.8761MiB；这些时点差异无法解释全部RSS低点增长，不能据此宣布根因、将父子allocator节点重复求和或把虚拟地址空间当作物理占用。日志 `/tmp/codex-memory-native-allocations.log`，完整样本与快照 `.dev-runtime/codex-memory-native-allocations.json`。2分钟启动验证只证明采集可用，不当成稳定性证据；标准177.75MiB及Inspector存档139.6602MiB失败仍保留。

React原生时间戳因果诊断没有闭合标准RSS红灯：在独立Node进程对自有页面初始化脚本仅过滤console.timeStamp的Components⚛／Scheduler⚛字段，普通时间戳转发原实现、Performance.measure现有释放保留、Network及所有原工作负载／门槛保留；不修改产品或安装包。30.1分钟／860样本仍失败，RSS低点322.0391→483.9883MiB（增长161.9492MiB＞128MiB），堆低点增长5.8805MiB，峰值246.8119／654.9570MiB，errors[]；音频最终空闲检查因RSS先失败未执行。日志 `/tmp/codex-memory-react-stamp-diagnostic.log`，JSON `.dev-runtime/codex-memory-react-stamp-diagnostic/session-idle-memory-long-r-12e42--natural-garbage-collection/natural-gc-soak.json`。相对原177.75MiB的条件差异不足以证明收益／根因，未合入时间戳过滤，也没有移除普通API或更新原标准门槛。


## 发送与身份恢复加固复验（2026-10-15）

本轮涉及 API 取消信号与连接身份复位，保留既有事件驱动恢复和预算。真实 HTTP → 网关 → 原生 EventSource 用例通过：上游 100,669,814 bytes，浏览器收到 6,178 个 SSE 数据字符，单事件最多 317 字符，强制 GC 后堆增量 35,964 bytes；序号、审批和最终回复断言保留。流式正文／可见历史预算／大字符串释放／无关正文隔离另 9 项通过，自动恢复自然 GC 的 24 次样本约 34.3–80.1 MB，未放宽门槛。

独立浏览器自动回收与只读重显约 96.5 秒：JS heap 为 93,977,620 → 62,124,452 → 235,419,324 bytes，renderer RSS 为 432,459,776 → 295,903,232 → 561,545,216 bytes；没有强制 GC／刷新，草稿、审批与完成回复保留，页面错误为空。该短测只证明回收和恢复边界，不证明长期 RSS 稳定，未重跑默认跳过的 30 分钟 soak，之前标准长测红灯仍保留。

证据位于被忽略的 `.dev-runtime/send-reliability-final/`（`session-network-memory-metrics.json`、`idle-memory-observations.json`）和 `.dev-runtime/send-reliability-memory/`，局域网 HTTPS 前端为 `https://10.30.0.22:8484`、绑定 `0.0.0.0`；隔离 fixture 接收全部测试写入，没有向真实 Agent 发送测试任务。

## Goal 对齐后的冻结长测（2026-10-16）

标准 Playwright / 原生 EventSource 负载持续 1802.806 秒、862 次自然采样，**仍未通过**：renderer RSS 低点 336.9102 → 515.6406 MiB，增长 178.7305 MiB，超过原 128 MiB 门槛。JS 堆低点增长 6.4837 MiB，峰值 heap/RSS 为 236.6881/691.6445 MiB，React measure 留存为零，页面错误为空。失败发生在最终音频空闲断言之前；采样仅观察连续任务创建一个上下文，不计最后空闲归零通过。没有强制 GC、刷新、放宽门槛或停止 Agent。

前端为独立绑定 `0.0.0.0` 的 **HTTP `http://10.30.0.24:5173/`**，结束后已验证自有 PID/start ticks/目录并关闭。加载副本 2820 个文件的哈希前后不变；该冻结版本早于本轮消息折叠、菜单焦点及复制资源修复，不作为全部最终 UI 源码的长测。完整 JSON、日志与哈希核对分别在忽略目录 `.dev-runtime/session-polish-round2-20261016/soak-browser/**/natural-gc-soak.json`、`soak-browser.log`、`soak-manifest-verification.json`，摘要为 `soak-result-summary.json`。此前标准长测红灯继续保留，短时堆释放用例不覆盖此长期 RSS 问题。

随后只执行一次独立归因诊断：冻结副本、私有缓存和固定冻结 shared 解析，四个私有多进程浏览器分别对比产品／解析丢弃 sink 与持续／短时附着 CDP。监听为 **HTTP `http://10.30.0.24:37237/`**、绑定 `0.0.0.0`，业务接口均为自有 fixture；未接正式网关。自有 browser-tree VmRSS 总和达到 2585.1602 MiB，超过事先固定的 2560 MiB 安全预算，即停止负载并清理；总墙钟 77.081 秒，仅活动 18.032 秒／10 cycles／10 次 OS 采样，未到 90 秒预热、native dump 或安静尾段。四个 renderer 在这段短窗内身份恒定，不能据此外推标准 30 分钟的进程数，更不能作泄漏或观察器根因结论。

该次 `completed:false`，不重跑、不提高预算，也不替代上述 +178.7305 MiB 红灯。两个产品页还有 fixture 的 Vite WebSocket-close 错误；关闭前一条历史响应未完成 sink 镜像，亦不能宣称完整流量／条件相同。自有浏览器均退出后，Node 的 fixture/stdin 句柄仍在，按持有的 PID/start ticks 精确 SIGTERM 收尾；最终登记自有 PID 为零、监听已关闭。摘要与原始证据为 `.dev-runtime/session-polish-round2-20261016/rss-audit/once-result-summary.json`、`run-zb7_4dam/`。冻结 2819 个非 env 文件前后哈希相同，唯一 env 未读取；正式服务、产品实现和标准门槛未变。

后续只读复算确认原低点算术正确，但采样 RSS 是浏览器所有 renderer 合计，heap 仅为 page target；未记录逐 PID/start ticks／数量，VmRSS 缺字段按零处理，无法事后排除进程组合或部分缺测。实际 862 条均为正数，没有证据把原红灯判为采集错误；也不能将合计 RSS 直接命名为单进程净留存。两个原窗口 RSS median 为 540.48→523.64 MiB，低尾抬升并不代表分布一致平移；这不是替代门槛或通过证据。原始复算与有界反例在 `rss-audit/readonly-next-candidate/`。

同次审查发现无搜索时仍注册全文 MutationObserver 的无效工作，1280／390px 真实浏览器均先复现受控正文变化多 4 次回调。现在仅选中带 query 的结果且现有聊天可见性允许时注册，关闭／隐藏清理，返回恢复；两例已转绿，原有 Range／RAF cleanup 保持，不改变 SSE、历史或正文回收规则。[该批验收](designs/session-render-alignment/search-highlight-lifecycle-20261016.md) 单独记录源码与恢复／审批／自然回收检查；回调减少不是长期 RSS 收益证据，30 分钟红灯继续保留。

随后修正测试采样：Linux 缺失 VmRSS、空 renderer、procfs 读取失败或 PID 身份变化必须使测量失败，不得补零或吞错；每条记录包含所有 renderer 的 PID/start ticks／RSS。读取 RSS 前后再次核对 start ticks，但该数据仍是浏览器 renderer 合计，不是单 page 的 private/PSS 内存。十项单测先对旧算法 9 红／1 绿，再全部转绿；97.055 秒自然回收／恢复浏览器通过，三次采样同一进程身份、无缺测。原阈值、负载、自然 GC 与默认长测跳过规则保持，旧数据不能追溯修补，+178.7305 MiB 标准长测红灯不变，详见 [采样身份验收](designs/session-render-alignment/renderer-rss-metering-20261016.md)。

## 当前源码的一次标准长测通过（2026-10-16）

搜索观察生命周期修正及 RSS 采样身份补齐后，在同一隔离 **HTTP `http://10.30.0.24:48865/`**（绑定 `0.0.0.0`）运行原标准 Playwright／原生 EventSource 长测。持续负载 1802.920 秒、862 cycles／862 样本，命令退出 0、1 项通过，总用时 30.6 分钟；原工作负载、90–300 秒／最后 180 秒窗口、heap 64/256 MiB、RSS 128/768 MiB 门槛、自然 GC 和音频断言保持。

RSS 低点 469.8320→496.0898 MiB，增长 26.2578 MiB；heap 低点 55.2915→59.6986 MiB，增长 4.4072 MiB。RSS／heap 峰值分别 676.9258／238.7538 MiB，页面和采样错误为空，React measure 留存为零。全部样本为一个 renderer PID 808587／start ticks 102195697，逐进程之和与合计均相等。连续任务只创建一个音频上下文、峰值活跃为一；测试到达并通过最终自然空闲归零断言，不把循环内 active=1 的样本误写成尾部观测值。

这是一轮当前源码的通过记录，不是独立因果对照或长期问题根治。相比旧红灯，前窗口 RSS 低点本身由 336.91 升为 469.83 MiB，差值减少不能直接算作搜索观察器或复制修复的收益；源码和 GC 时序也不同。旧 +178.7305 MiB 红灯、缺少逐进程身份的边界及中止的四浏览器诊断全部保留，不追加重复运行挑选绿色结果。

`round9-soak-source-manifest.json`／`round9-soak-source-verification.json` 核对 2834 源码、14 份 E2E、2 份采样脚本和 72 份 shared 产物前后不变；本批没有构建、HMR 修改、强制 GC、刷新或停止正式 Agent。完整 JSON 为 `.dev-runtime/session-polish-round2-20261016/round9-soak-browser/session-idle-memory-long-r-12e42--natural-garbage-collection/natural-gc-soak.json`，摘要 `round9-soak-result-summary.json`，日志 `round9-soak-browser.log`。只读正式服务核对的 PID/start ticks 仍为 2712539／55361120，健康接口 HTTP 200；没有替换运行进程。

## 输入响应修复后的标准长测（2026-10-20）

本轮修复逐键全量草稿保存、动作型消费者全量输入订阅、无变化共享同步仍落盘；详见[输入响应验收](session-input-responsiveness.md)。原标准 Playwright／自然 GC 三十分钟负载仍为红灯：1801.968 秒、862 次采样，heap 低点增长 5.6413 MiB，renderer RSS 低点 320.8086→502.0703 MiB（+181.2617 MiB＞128 MiB）；峰值 heap/RSS 为 212.2511/673.2422 MiB。采样始终同一 PID/start ticks、无缺测或页面错误、React measure 为零，DOM/监听器低点增加 7/15。没有证据据此宣布原生增长根因或完全稳定。

失败在 RSS 低点断言，后续峰值及最后音频空闲归零断言未执行，不计通过；连续负载只观察一个上下文。未改变原工作负载、门槛或采样器，无强制 GC／刷新／停止 Agent。1,837 个生产源的冻结指纹前后相同；首轮因补齐跨页空闲互写修复而取消，不计完整长测。完整 JSON 与日志在忽略目录 `.dev-runtime/session-input-20261020/final-soak/`、`final-soak.log`，摘要 `final-soak-summary.json`。三页十分钟输入回归已通过，不能替代此三十分钟 RSS 红灯；更早红灯和对照继续保留。

## 空闲大包／HMR 排查中的标准长测（2026-10-20）

独立子 Agent 路由裁剪后，原标准自然 GC 30 分钟测试仍失败：1801.149 秒、861 轮，heap 低点 54.2825→59.4814 MiB（+5.1989），renderer RSS 低点 336.9883→481.8711 MiB（+144.8828＞128 MiB）。峰值 heap/RSS 为 176.0709/592.9336 MiB；同一 renderer PID 2949235／start ticks 150742832，无页面或采样错误。失败在 RSS 低点断言，后续峰值及最终音频空闲归零断言未执行，不能计作通过。

本轮未改标准负载或门槛，不强制 GC、刷新或停止 Agent。运行先于 HMR 修复启动，fixture 阻断热更新，但期间四份 HMR 相关源码变更，因此不是全部最终源码的冻结验收；指纹差异与范围另存 `soak-source-scope.json`。完整指标与日志位于忽略目录 `.dev-runtime/session-idle-regression-20261020/soak/`、`soak.log`、`soak-summary.json`。此红灯保留，后续仅在找到新的可验证路径后重测，不能重复执行挑选绿色结果。

## React 属性原生序列化修复后的标准长测（2026-10-20）

后续对照区分了调试网络缓存、HTTP 夹具、原生 SSE 和 GC 堆容量，结果与候选方案范围见 [原生内存归因](session-native-memory-attribution.md)。负结果也必须保留，不能把显式 GC 后下降算作自然回收达标。

[原生属性专项](session-react-performance-memory.md) 证明先裁剪再 measure 可阻止大块原生序列化分配，但最终冻结源码的标准 30 分钟仍失败：1802.013 秒、863 轮，heap 低点 +5.4506 MiB、backing storage +0.1733 MiB、RSS 低点 327.9961→481.0664 MiB（+153.0703＞128）；峰值 RSS 627.7461 MiB。2,930 文件指纹前后相同，同一 renderer 身份、错误为空。没有调整负载／门槛或强制 GC／刷新；失败后的 RSS 峰值和音频最终空闲归零断言未执行。专项因果成立不代表完整页面剩余增长已解释，原红灯继续保留，完整指标及路径见该文档。


## 2026-10-18：长历史阅读与输入焦点（R30）

原1500条历史性能从WebKit846.0／Chromium742.0ms收敛至完整原用例422.0／454.7ms，500ms门槛及真实正文、历史／草稿恢复断言未改。局部选择订阅、真实行原点／首测补偿、阅读意图及下一帧原生焦点分别保留隔离和清理。最终两引擎各23阅读、15输入／草稿、4真实Lexical控制通过；原10000／30基准、内存27PASS+1默认长测SKIP、Goal11和原组件4组、非模态2、相关44文件246项、Node3及后置pnpm check通过。指定13份E2E strict通过；旧20份扩大检查失败与早期WebKit刷新诊断未归因边界保留。正式runtime未激活，见[完整验收](designs/session-render-alignment/history-switch-performance-20261018.md)。

本轮未保留React记录候选修改，原性能保护源码／测试与R29一致，Node3通过。自然回收95.429秒的heap为75,240,472→56,270,560→101,124,324bytes，全部renderer RSS为401,731,584→289,427,456→360,755,200bytes；同PID809901/start117458304，无缺测、无强制GC或刷新。真实网络上游100,669,814bytes／浏览器6178字符／最大事件317字符／GC后增量35964bytes。新30分钟长测默认跳过；不得将历史长测通过或本轮短测改称当前长期RSS稳定。


## 2026-10-26 合并后的标准长测仍未通过

隔离 HTTP 局域网页面在原负载、自然 GC 与原门槛下运行 30 分钟，871 轮/871 样本。renderer RSS 低点 325.2422→487.8477 MiB（+162.6055 MiB＞128），JS heap 低点 +5.4941 MiB；观察到 RSS/heap 峰值 585.8242/169.8867 MiB，页面/采样错误为零、同一 renderer 身份、React measure 为零。RSS 低点断言失败，后续峰值和音频尾部断言未执行；不以短测或十分钟输入通过替代。2182 个生产文件冻结校验无变化。完整证据、先前主机资源争用的无效尝试和通过项目见 [合并验收](designs/update-merge-20261026.md)。原保护不变，长期 RSS 尚未解决。


## 线程设置与运行范围隔离后的保护复验（2026-10-27）

本批未扩大读取并发、正文或RPC预算。最终真实HTTP/EventSource投影用例，上游100,669,814 bytes，浏览器收到6,178个SSE数据字符，最大单事件317字符，GC后堆增量35,964 bytes。原生序号、审批和完成回复断言保持；不能把浏览器数据字符数称作压缩后的全部网络字节数。

自动回收用例补充了“先确认两个后台线程各有正文”的前置断言，防止初始化漏读被误算成已经回收。最终0.021秒时三线程各16项；68.383秒时后台正文自然释放；100.250秒只读重显恢复目标18项，草稿、审批和新完成回复保留。JS heap为77,777,220→58,139,712→110,434,828 bytes；renderer RSS为432,979,968→308,146,176→405,331,968 bytes。RSS为该自有浏览器全部renderer合计，heap为页面target；无采样错误、pageerror或任务写入，没有强制GC/刷新参与该自然回收用例。

证据在 `.dev-runtime/session-parity-batch-20261027-r4/browser-accepted/`。这证明指定短时回收/恢复和传输边界；默认跳过的30分钟用例不计通过，既有长期RSS红灯仍保留。原首轮“counts=4”失败发生在后台正文从未初始加载、0.041秒即误越过回收等待的条件下，不是已休眠正文复活的证据；完整失败及修复见[第四批验收](designs/session-render-alignment/session-parity-batch-r4-20261027.md)。


### 2026-10-27 执行状态与独立历史分离

独立 chat reader 能重建正文，不代表它知道另一实例中活跃轮次的状态；不得用它推断的 interrupted 覆盖执行实例的 inProgress。网关通过有界只读活动快照仅修正精确匹配轮次的执行字段；前端状态冲突时只读取 `/api/session/codex/activity`，不恢复完整历史轮询或保留工具正文。此读取不得 resume/acquire 或重发排队消息，详细边界与回归见 [执行状态权威来源](session-execution-state.md)。

涉及这条链路须验证 activity 网关、status/history sync、useTurnControl、chat-history selector/channel，以及真实 HTTP/EventSource、不可见正文回收、恢复和审批；不得放宽原限额。


## 2026-10-29：首次显示恢复必须先执行预算

8MiB默认值仍在；禁止把异步回收器当成历史或设备缓存的准入限制。`codexService.loadThreadHistory`首次store发布前执行同一显示预算；不可缩小的合法附件/元数据明确拒绝本次恢复，不能先渲染再等定时器。用户全部text输入共享有界头尾预览，UTF-8元素区间须保持正确，非文本附件保持合法。`earlierLoading`不得免除预算。

旧IDB读入须重新应用原单条2MiB/总30MiB分摊限制，不相信bytes字段；baseline不能重新持有未裁正文。淘汰、600条前缀窗口和最终缩窗都必须更新item/turn恢复游标，防止旧opaque cursor跳过回收区间。修改须运行`codexService`、budget、governor、cache/HMR单测，以及`session-cold-memory-budget`和本文件原网络、空闲回收、恢复/提问浏览器组。复现数据、物理留存夹具就绪修正及未闭合的现场/长期RSS边界见[本轮记录](session-memory-admission.md)。


## 2026-10-29：回收幂等与 store 热更新身份

正文、事件顺序与引用均未变化时，compactor 必须返回原数组，governor 不得因新包装重复发布同内容；不可缩小的合法附件不能引发250ms自反馈循环。测试须覆盖真实压力分支中无输入的状态发布次数，不能靠放宽预算。

Codex store 热更新须立即注册并复用同一个 store，更新 actions 而保留现有数据/订阅，不在模块作用域保存旧 state 快照；清空恢复缓存 Map 不能替代此保证。修改须运行 `useCodexStore.hmr.test.ts`、budget/governor 单测、`session-memory-feedback-loop.spec.ts` 与真实 Vite `session-store-hmr.spec.mts`，及原恢复/审批/空闲回收组。因果红绿、测量范围及原长期RSS未达标边界见[回收与HMR记录](session-memory-feedback-loop.md)。

## 2026-10-30：浏览器网络离线时的共享 SSE 生命周期

浏览器 `offline` 必须关闭共享原生 EventSource、标记 `reconnecting` 并保留序号；`online` 只能从该序号恢复原 `view=chat` 只读事件流。离线期间 runtime-restarted 仍须清旧序号并延迟连接到 online。离线处理本身不修改审批/草稿，不 resume、重发或扩大为历史轮询；online 后仅接收原流回放和既有快照。超预算 `paused` 状态不由 `online` 清除，最后一个 subscriber 退出时移除 offline/online listener。12 项 eventStream 单测通过；显式真实 HTTP/EventSource 短测观测到原生 readyState 1→2→1、服务器 EventHub 总订阅数基线4→5→4，重连 URL 按 `since=1` 回放离线间隙事件与双审批快照。默认脚本测试跳过浏览器关卡，完整证据与限制见 `session-interruption-safety.md`。

## Claude/ACP实时投影与有界历史（2026-10-30）

`view=chat`现在同时裁剪ACP工具rawInput/rawOutput/content/locations以及Claude tool_use输入/tool_result结果；字段至多64KiB，明确truncated并保留按需只读详情。普通助手终稿、权限/提问和事件序号不变。ACP持久sourceID和最近页快照边界用于读中合并，不能按相同文本猜测身份。元数据轻探测不读完整正文。单页2MiB与源安全边界、真实网络验证见[辅助历史](designs/session-mode-implementation-20261029/auxiliary-history.md)。

本轮独立LAN HTTP→正式网关→原生EventSource短测通过：67,113,626 bytes源数据投影为180,218 bytes浏览器数据，最大事件11,256 bytes；19条连续序号、8个ACP源身份、两类审批和最终答复完整。没有据此声明堆/RSS长期稳定；原标准长测与自然回收门槛均保持。

## 2026-10-30 HTTP JSON 字节消费与回执保护

公共JSON响应经字节流/UTF-8解码，错误只消费一次；锁与临时正文在完成/失败时释放。不得恢复双clone错误读取，也不得将截断或读失败的409推断成明确拒绝。原网关/RPC/聊天预算与所有自然GC长测门槛保留；完整Chrome的负结果和精确headless的分配路径对照分别保存，后者不代表完整工作台RSS达标，见[响应消费与回执](designs/session-mode-implementation-20261029/json-response-memory.md)。

## 2026-10-30 缓存执行确定性与连接来源

最新cache-only中断的未核实标记为纯WeakSet；原生执行proof为以实际timing对象为弱键的有界元数据，不保存正文，也不将认证凭证或授权结果写盘。原生SSE/activity/ACK纠正须精确thread/turn且来源仍有效；相同JSON但确定性变化须通知显示，其他相同快照保持幂等。cache与既有native事件合并仍先执行8MiB显示预算；pending只触发现有小activity核对，不恢复完整历史轮询。跨endpoint/token held读取锁存撤销，dormant不得重填。详见[缓存与执行恢复](designs/session-mode-implementation-20261029/cached-execution-recovery.md)，原全部自然GC/RSS门槛保持。

## 2026-10-30 完整调试观察器的固定预算验收入口

新增显式 `session-native-http-memory.spec.mts`：实际 HTTP/API/原生 EventSource、全部 Network 回调及应用 pooled subscriber 连续序号均保留，只为唯一 CDP Network session 的调试器正文副本设置固定 4/1 MiB 预算。产品限额、原 30 delta/2 秒负载、90–300 秒/末 180 秒窗口及 64/256 MiB heap、128/768 MiB RSS 门槛不变；原 Playwright 长测与所有历史 RED 独立保留。默认跳过和 smoke 均不能计作三十分钟通过，完整方法与尚待最终冻结长测的边界见[原生 HTTP 验收](session-native-http-memory-acceptance.md)。

## 2026-10-30：transcript 事件数回收与投影复用

`compactCodexTranscript` 可在压缩后的字节估算已经低于原 low-water mark 时，仅按原事件顺序和原 active/protected turn 规则删除完整 turn 组，避免另建逐事件 bytes 数组；剩余字节仍按同一估算缓存重算。字节仍超目标时必须保留原分组估算、减量与文字收缩路径。每个可见事件在 hidden-body 检查时得到的 chat projection 复用于 compact，直接 compact 私有正文仍返回安全 cursor；不能跳过隐藏正文过滤、裁掉未知元数据或更改序号、审批/提问、reading window、active turn、恢复游标或8MiB/3000事件预算。回归需同时覆盖 count-only / byte-pressure、active与protected group、reading window / pending cursor、hidden private body、large unknown metadata与BigInt，并运行 `codexTranscriptMemoryBudget`、`sessionMemoryGovernor` 和 `sessionMemoryReadingProtection` 单测。纯函数 M08 对照结果不能代替原 500ms/<80行/<2000 DOM 浏览器关卡或长期RSS测量；这些原门槛保持。

## 2026-10-30：超限快照的同步保护

未主动展开历史的变更快照若超过原3000事件上限，memory governor 在该次发布中立即调用既有预算回收，取消先前的250ms debounce；运行标志阻止回收自身发布递归。仅检查变更数组的条数，不在每个token扫描完整正文。当前已固定的阅读窗口继续使用原延迟调度与阅读额度，普通流、5秒检查、字节/压力阈值和可恢复游标不变。活动轮次、审批及草稿保持独立，不能用同步保护替代分页或裁掉明确阅读的内容。

性能测试必须以真实完整聊天行就绪作为预热条件，不能因 `CodexTranscriptPreparing` 显示相同预览文字就开始“暖渲染”计时。完整组件的冷加载另行记录；最新行500ms/行数/DOM限制及自然30分钟内存门槛均不变。
