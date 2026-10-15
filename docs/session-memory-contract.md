# 会话内存防回归约定

## 已确认有效的修复基线

**后续现场反馈（2026-10-10）**：用户随后补充，会话模式内存虽然增长变慢，长时间使用仍逐渐增加。因此下述确认仅代表此前的暴涨已缓解，不能解释为长期内存问题全部解决。原有保护继续保留；剩余增长需区分缓存留存与浏览器分配/回收波动，并验证更长时间的自动释放效果。新版官方扩展的生命周期释放证据见[后续对照](session-browser-memory.md#后续反馈与新版插件自动释放对照2026-10-10)。

2026-10-10，用户在部署修复后明确反馈：**“这次的内存修复很关键，内存控制住了。”** 对应代码提交为 `78884745a307282c854523355dad9f872b6d47fb`（`v1.3.0`，已同步 GitHub / GitLab）。这是用户现场确认；此前自动测试的结果及适用边界单独列在下文，不把用户反馈换算成未经测量的内存数字。

此前现象：Codex 执行任务时，浏览器标签页一两分钟涨到数 GB 后崩溃；没有对话时也缓慢增长，且没有打开右侧编辑器。多轮仅限制消息条数、隐藏工具行或裁剪前端缓存的修改未能完全解决。最终有效方案同时修复了**传输前裁剪、历史读取触发条件、空闲状态更新**，并保留此前的有界流式渲染和引用释放。

本文件是当前维护约定。[排查历史与测量详情](session-browser-memory.md)保留了早期方案；其中“工具正文仍通过网络进入浏览器”“保留工具预览”等阶段性描述，不得用作恢复旧行为的依据。

## 后续修改必须保持的边界

2026-10-14 命令详情补充：聊天投影仍不发送任何命令输出。四类命令只有显式展开才经固定精确项通道读取；完整命令、输出、ANSI 派生节点和复制闭包局限于可卸载子组件，关闭/隐藏立即释放，不依赖聊天 60 秒宽限期。返回保留展开状态但不自动重读，取消须另外证明自有 native reader 实际退出。网关使用同一只读 reader 支持已运行旧会话服务，禁止因此重启 Agent。实现与测量边界见 [命令详情](session-command-details.md)。

| 边界 | 必须保持 | 会重新引入问题的做法 |
| --- | --- | --- |
| 浏览器接收数据之前 | 浏览器 SSE 与 Codex 只读历史使用 `view=chat`；Node 网关在发送前裁剪隐藏工具正文，且不把该参数传给运行层 | 只在 React、store 或 `JSON.parse` 之后过滤；以“界面没有显示”为理由恢复原始大包 |
| 工具及内嵌数据 | 同时覆盖输出 delta、最终工具项、turn/thread 内嵌 items、raw response、hook、diff、自动审批复核等；子 Agent 的 prompt/message 仅保留有界预览，当前为 1024 字符；原生 `unified_diff` / `content` 先映射成 `diff`，单个文件 diff 最多保留 24,000 字符供聊天计数和悬停预览，超出仍标记未加载；命令输出、MCP 结果和原始响应不进入聊天 | 把完整工具正文、超大 diff 或命令输出放回聊天投影；通过工具参数、`agentsStates.message`、元数据或旧缓存重新持有原始正文 |
| 协议与任务状态 | 保留原事件序号、轮次生命周期、真正的审批/提问及子 Agent 身份/状态；后台内部消费者继续使用原协议 | 直接丢掉序号造成缺口与重读风暴；混淆“自动审批复核提示”和“需要用户处理的审批请求” |
| 过大 SSE 帧 | 当前单帧上限 16 MiB；网关发出命名事件 `session-projection-error` 后释放上游，浏览器暂停接收并显示原因；显式重试恢复连接与只读历史 | 静默丢弃审批；伪造 `seq: 0`；自动无限重连并回放同一巨帧；为恢复页面而停止 Agent |
| 后台历史读取 | 首次加载、连接缺口、缺失回执、完成边界、手动/页面恢复触发补读；外部空闲会话由轻量状态列表的 `updatedAt` 变化触发 | 恢复“活动静默 5 秒 / 空闲 30 秒”完整历史轮询；把工具执行安静当作消息丢失；活动时间戳每次变化都重读正文 |
| 完成恢复 | `active → idle/systemError` 即使旧 timing 仍为 `inProgress` 也要补读；读取中发生完成须合并排队一次后续读取；轻量快照持续 idle 与本地 inProgress 矛盾时，按轮次去重补读一次 | 为减少请求漏掉最终回复、未读状态或外部客户端保存的历史；读取中完成被直接忽略 |
| 不可见正文生命周期 | 以实际可见的聊天正文组件计数；最后一个使用者离开 60 秒后释放可恢复正文、流式缓冲及派生视图缓存（5 秒扫描，繁忙浏览器可能延迟）；运行状态、审批、草稿及未读独立保留，重显只读恢复最近页 | 把“仍在关注列表”等同于一直需要正文；回收后让后台 delta/历史读取重新填满；恢复时沿用已释放的旧分页起点漏掉回复 |
| 空闲同步 | 相同项目/标签快照返回原 Zustand 状态，不通知订阅者；真实变化、操作确认与错误恢复仍正常发布 | 每两秒生成新根状态，即使字段相同也通知整片 Markdown、卡片和导航重渲染 |
| 开发性能时间线 | React 开发性能记录的原生时间线留存也须释放；开发专用、明确识别 React 的记录，普通应用 measure/mark 保留；同时测 renderer RSS | 只测 JS 堆；长期保留含组件属性的 React User Timing 记录；清空所有应用计时或生产 API |
| 完成提示音 | 单个活跃/关闭中的 AudioContext；每声结束断开节点，连续任务复用上下文，空闲 30 秒关闭；音频时间冻结时有墙钟释放兜底，HMR 释放旧实例 | 每次完成 new AudioContext 却只调用 oscillator.stop；仅测 JS 堆而忽略原生音频资源；自动播放阻止后无限积累挂起上下文 |
| 前端留存与渲染 | 活动助手正文使用有界稳定分段，完成后再渲染最终 Markdown；显示缓存与线程元数据不重复持有工具正文；截断预览断开大字符串引用 | 每 token 复制历史数组、拼接全文或重跑 Markdown；用短 `slice` 的字符数证明原始大字符串已释放；移除预算和退出观察范围的清理 |

这些是行为和资源边界，不禁止有证据的替代实现。修改预算、协议或恢复策略时，必须记录替代方案、相同工作负载下的测量结果，并更新对应测试；不得仅删除断言、放宽阈值或关闭恢复能力使测试通过。浏览器预算不是 RSS 的硬上限，不在生产中强制 GC 或周期性刷新页面掩盖增长。

## 代码与回归入口

以下路径均相对仓库根目录。修改哪一条路径，就至少运行该行测试；涉及传输、历史或状态联动时，同时运行下面的整组验收。

| 修改位置 | 必查测试 |
| --- | --- |
| `apps/server/src/routes/session-mode.ts` | 同目录 `session-mode.test.ts`；`tests/e2e/session-network-memory.spec.mts`（真实 HTTP → 网关 → 浏览器原生 EventSource） |
| `apps/web/src/session-mode/lib/eventStream.ts`、`services/apiAdapt/codex.ts` | `lib/eventStream.test.ts`、`services/apiAdapt/codex.history-page.test.ts`、`services/apiAdapt/codex-ownership.test.ts`、`components/codex/thread/CodexAccessNotice.test.tsx` |
| `services/followedSessionHistorySync.ts`、`services/followedSessionStatusSync.ts`（位于 session-mode） | 对应两个 `.test.ts`；`tests/e2e/session-background-sync.spec.ts`、`session-restoration.spec.ts`、`session-state-recovery.spec.ts` |
| `services/codexTranscriptActivity.ts`、`sessionTranscriptRetention.ts`、`components/codex/hooks/useTranscriptVisibility.ts`（位于 session-mode） | 对应单测；`tests/e2e/session-idle-memory.spec.ts`；发送回执、审批和恢复回归 |
| `stores/useAgentCenterStore.ts`、`stores/useWorkspaceStore.ts`（位于 session-mode） | 对应两个 `.sync.test.ts`，尤其 `unchanged polling snapshots do not notify UI subscribers` |
| `apps/web/src/main.tsx`、`lib/react-performance-retention.ts` | `lib/react-performance-retention.test.ts`（纳入 `pnpm --filter web test:terminal`）；30 分钟 `session-idle-memory.spec.ts` 同时核对 React measure / RSS |
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
