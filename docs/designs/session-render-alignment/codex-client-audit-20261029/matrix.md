# 本地 Codex 客户端对照矩阵与证据审计

审计日期：2026-10-29。项目基线：`f6699ba064059009529a50b0c126cbed4402f093`。官方基线：仓库原包 `third_party/openai.chatgpt-26.51007.21434-linux-x64/extension`，`package.json` 版本 `26.51007.21434`。云端执行不在本次范围内。本文件供主报告合并与用户 review，仅审计，不表示批准后续开发。

## 1. 本轮实际做了什么

- 只读检查当前 E2E 入口、夹具隔离方式及历史验收文档。未改产品、测试、正式文档，未连接默认 IPC、读取登录数据、发送真实任务或重启正式服务。
- 校验 reference manifest 中 9 份原包 JS/CSS/locale 以及 latest-actions 的 2 份资产，11/11 SHA256 一致。结果见 `reference-hash-check.json`。这证明固定资产身份，不证明全部模块已执行。
- 运行当前 HEAD 的 `session-rail-theme.spec.ts` 4 项与 `session-latest-message-actions.spec.ts` 5 项，**9 passed / 0 skipped / 0 unexpected / 0 flaky**，总计 62.054 秒，开始于 `2026-10-29T07:35:45.176Z`。原始输出 `paired-e2e/result.json` 含 dotenv 日志前缀；纯 JSON 为 `paired-e2e/report.json`；精简记录、源文件 SHA 为 `paired-e2e/audit-summary.json`。
- 使用根审计进程持有的只读原组件参考服务 `http://10.30.0.24:36601/native-goal.html`，正式前端静态资源来自 HTTPS LAN `https://10.30.0.24:8484`。产品页面由 `installSessionUxFixture` 拦截全部 `**/api/**` 并关闭全部 WebSocket；参考页面只运行自有夹具与未修改原包组件，不连接官方宿主。该临时参考地址生命周期由主审计进程负责，不是新的产品入口。

本轮 9 项的准确拆分：

| 当前执行项 | 数量 | 真正观察 | 不应外推 |
|---|---:|---|---|
| rail theme / queue / diff / notice / Goal | 4 | light/dark × base/coexist；每项实际原包组件与当前项目组件配对；640/360 内容容器；队列行、diff、计数、控件布局、可达性等既有断言 | 全官方 composer、所有 rail 分支、真实 native queue/steer ACK、多宿主性能 |
| latest-actions 项目交互 | 4 | 1440/390 × light/dark；完成、新轮次、切换隐藏模式、不同回答分组、未发送草稿与不启动任务 | 每个测试都完整运行官方组件；完整协议恢复；所有 assistant/tool 消息类型 |
| latest-actions 固定原包验证 | 1 | 两份资产 hash；真实原包分组函数；真实原组件持久可见行为 | 官方宿主的 command handler、剪贴板系统权限、完整 turn 生命周期 |

截图/尺寸细节另在 `.dev-runtime/session-rail-theme-20261027/audit-20261029/` 与 `paired-e2e/artifacts/`；旧日期目录名由现有测试固定，**只有 `audit-20261029` 子目录属于本轮**。

## 2. 证据层级：不能把六种证据合成一个“全绿”

| 标记 | 来源 | 可证明 | 不能证明 |
|---|---|---|---|
| O-S | 本轮固定原包的静态代码、版本、hash | 存在状态、分支、调用关系、资产身份 | 分支可达、实际交互、性能、正确收尾 |
| O-C | 实际官方组件/导出函数在受控 reference 中回放 | 给定 props/provider/主题/尺寸下的真实原组件 DOM、计算样式、函数返回、有限交互 | 官方扩展宿主、MessagePort、app-server、真实登录/运行关系 |
| O-N | 未改官方 CLI + 无登录隔离 loopback provider | 实际 native 协议、请求身份、命令/审批、断线后游标等有限行为 | 官方 VS Code UI；真实模型/账号服务；两个独立 writer 的 CAS |
| O-F | 完整官方 VS Code/code-server/extensionHost/webview/native 链路 | 精确版本/实例/窗口/状态下的端到端行为 | 未执行状态、其他版本、所有客户端组合 |
| P-S | 当前项目源码、当前存在的测试 | 已实现意图及测试设计覆盖 | 当前实际通过、实际原组件配对、真实 native 写出 |
| P-H | 历史项目执行记录 | 对应 source-manifest/commit 与场景当时的结果 | 2026-10-29 当前全绿；本次没重跑的真实行为 |
| P-C | 本轮当前 HEAD 实际执行 | 本轮指定断言通过与截图 | 未覆盖场景及原组件以外的完整官方宿主 |

“缺当前动态证据”“无完整原包端到端对照”是审计缺口，不自动等于已复现产品 bug。历史红灯保留原日期、层级与精确样本，不因为后来单测通过而消失，也不在未复验时断言现在一定复现。

## 3. 对照矩阵使用方式

矩阵中 `D` 为桌面，`M` 为触控手机尺寸模拟，`T` 为平板/中间宽度。`1p` 为单页，`2p` 为同源两页，`2ctx` 为独立 browser contexts，`3host` 为三套真正独立官方宿主。默认原组件参考须相同 locale/theme/font/DPR/data；不得用 mock 截图替代 O-C。

`C` 表示本轮有限通过；`H` 表示有历史记录，当前未重跑；`S` 表示本轮只核对静态入口；`U` 表示该组合仍需建立/复验。**没有一行声称 O-F 的完整矩阵通过**。

### 3.1 初始、空闲、运行与呈现

| ID | 状态/触发与必要断言 | 当前项目可执行入口（`tests/e2e/`） | 已有视口/客户端粒度 | 本轮证据与剩余差异/缺口 |
|---|---|---|---|---|
| M01 | 空白工作台：无关注会话、导航可操作、无隐式新建/发送 | `session-startup-performance.spec.ts`、`session-composer-v2.spec.ts` | D1440/M393；1p、3p | S/H；fixture 的空白外壳不能代替官方 onboarding/new-chat 空状态；O-F U |
| M02 | 官方空白新线程：未发送 UUID、独立草稿、刷新仍相同目标 | `codex-refresh-newchat-acceptance.mjs` | 两桌面+M393×852/DPR3；官方宿主 | H/O-F：10/15 早期第3列/布局恢复红灯后来有9/9三端功能闭合；当前未重跑，非≤2s证明 |
| M03 | 新线程首发：仅一次接受；新资源路由与 editor URI/thread 正确 | `codex-refresh-newchat-send-acceptance.mjs`、`codex-refresh-initial-prompt.mjs` | 显式自有官方夹具 | S；不能把打开 frame/opened HTTP 或新资源路由看作实际首发确认；O-F U |
| M04 | idle 已完成历史：最新回答动作始终可见、旧 turn 按原分组隐藏 | `session-latest-message-actions.spec.ts:131,393` | D1440/M390 × light/dark；1p | **C/P-C+O-C**；本轮固定原包分组与有限动作验证绿；host command/全部消息分支 U |
| M05 | running+空草稿：显示 Stop；无“已中断”假终态；不显示错误引导 | `session-composer-action-labels.spec.ts` 与 `session-background-interruption.spec.ts`、`session-state-transitions.spec.ts` | M393/D1280；1p fixture | S/H；主动作具体原包分支需跟随父报告代码索引；无完整 O-F paired 样本 |
| M06 | running+草稿：主动作为 Queue/Steer，草稿不被旧完成覆盖 | `session-composer-attached-rail.spec.ts`、`session-codex-composer-native.spec.ts` | D1440/M390、light/dark | S/H；API fixture；full official native queue/steer ACK U |
| M07 | 流式 assistant：增量与最终正文合并为一行，无闪失/重复 | `session-codex-native-render.spec.ts:620`、`session-codex-stream-memory.spec.ts:4` | 当前测试指定视口；1p | S；“native”文件名不代表真实 native：此入口实际注入事件/存储；O-F/O-C streaming U |
| M08 | 1万交错事件：有界行/字符串，最新答复可见，序号不丢 | `session-codex-native-render.spec.ts:676` | 1p fixture | S；10k synthetic 不代替真实长时流、网关传输量、自然GC与 renderer RSS |
| M09 | tool 执行：command输出有界、显式展开详情、完成/失败状态 | `session-codex-native-render.spec.ts:99,339`、`session-codex-native-targets.spec.ts` | D1440/M390 × light/dark | S/H；保留chat投影；ANSI/MCP/所有工具O-C/O-F全状态尚未统一闭合 |
| M10 | running diff + queue rail：边框/计数/滚动/多行队列共存 | `session-rail-theme.spec.ts:68` | 640/360内容容器 × light/dark × base/coexist | **C/P-C+O-C**；本轮4项绿；仅所测组件数据，非完整官方composer |
| M11 | Markdown/代码/表格/图片：字体、wrap、高亮、copy/download | `session-codex-native-render.spec.ts`、`session-codex-visual-acceptance.spec.ts`、`session-native-markdown-reference.ts` | D1440/T768/480/M390/844×390/390×420，双主题分批 | S/H；实际原 Markdown 参考有历史样本；全消息×视口不是一次当前paired运行 |
| M12 | expanded composer：插入代码、选择区、关闭/刷新/返回主输入 | `session-composer-v2.spec.ts:98`、`session-rich-draft-insert.spec.ts` | D/M fixture | S/H；原组件所有 toolbar/action/attachment 像素与状态组合 U |
| M13 | 完成通知/未读/提示音：后台收尾后状态独立于正文挂载 | `session-background-sync.spec.ts`、`session-idle-memory.spec.ts`、`session-state-recovery.spec.ts:487` | D/M，多标签 | S/H；必须同时核对完成回复/未读/音频资源关闭；不因正文回收推断任务终止 |

### 3.2 审批、提问、失败与中断

| ID | 状态/触发与必要断言 | 当前可执行入口 | 视口/客户端粒度 | 本轮证据与剩余差异/缺口 |
|---|---|---|---|---|
| M14 | pending审批：精确thread/turn/item/request/token、所有按钮可达 | `session-codex-requests-native.spec.ts:402`、`session-approval-reviewer.spec.ts` | D/M/390×420 × light/dark | S/H；此E2E为API fixture，不因native命名升格O-N |
| M15 | 两客户端竞争同一审批：只有一次native accept，旧请求409 | `scripts/fixtures/session-approval-multiclient/acceptance.py` | D1440×1000 + M393×852；2ctx | H/O-N+项目真实ApprovalItem：10/27精确样本通过；本轮未跑；不是官方VSCodeUI或跨native-writer CAS |
| M16 | 审批期间B断线再接：since游标补回新请求、旧token不得批准 | 同 M15；`session-state-transitions.spec.ts:65` | 2ctx；真实browser-facing SSE socket | H/O-N；曾发现setOffline不必断已有SSE，最终样本确实关闭socket；不得用旧失败夹具推断产品bug |
| M17 | 审批失败：卡片保留可重试；已resolve/过期/账号变化不可迟到提交 | `session-codex-requests-native.spec.ts:848`、`session-native-request-parity.spec.ts` | D1440/M390 × light/dark | S/H；原包错误source card有O-C入口；所有审批类型/授权变更O-F U |
| M18 | requestUserInput：选项/文字/schema验证；仅本轮自动展开一次 | `session-async-questions.spec.ts:74,174,268`、`session-codex-requests-reference.spec.ts` | D/M；双主题 | S/H；typed原卡 O-C入口独立env gate；原包真实host问题生命周期 U |
| M19 | 问题回复拒绝/未知ACK/远程已答：保留草稿、显式继续、不自动重发 | `session-async-questions.spec.ts:374,486` | D/M、split | S/H；fixture可断言身份与显式动作；O-N同类端到端证据未在本轮确认 |
| M20 | turn failed：错误source卡、Markdown链接、安全可点击、可重试 | `session-native-request-parity.spec.ts:9`、`session-state-transitions.spec.ts:26` | D1440/M390 × light/dark | S/H；reference env缺失会skip；错误card比对不是整个失败turn O-F |
| M21 | 显式用户中断：停止精确turn一次，队列暂停；终态不能反复追加 | `codex-refresh-interrupt-acceptance.mjs`、`session-state-transitions.spec.ts` | 显式自有官方夹具/项目fixture分层 | S；本轮不点击Stop；完整官方中断→继续→刷新组合U |
| M22 | 刷新时旧 interrupted + 迟到 completed：真终态收敛，不凭连接失败捏造中断 | `session-state-recovery.spec.ts`、`session-background-interruption.spec.ts`、`session-codex-native-render.spec.ts:99` | D/M；API/SSE fixture | S/H；这是用户截图核心，需将精确原生历史/事件时间线与UI同时对齐；现有测试不是当前复现证明 |
| M23 | older-runtime 已暂停原因：中性文案，不误称“你中断了”，不自动resume | `session-background-interruption.spec.ts:61` | M393；1p | S；旧原因归一不代表刷新事件真的中断过任务；需区分UI文案与真实native状态 |

### 3.3 断线、刷新、历史与内存

| ID | 状态/触发与必要断言 | 当前可执行入口 | 视口/客户端粒度 | 本轮证据与剩余差异/缺口 |
|---|---|---|---|---|
| M24 | 无法加载历史：真实503仍提示错误，局部SSE不能伪装同步完成 | `session-render-recovery.spec.ts:6` | 375/1440；原生HTTP/EventSource夹具 | S/H；消息error notice实际原卡O-C入口为`session-history-native-reference.spec.ts`；完整host U |
| M25 | 重试history warning：双主题616/390尺寸、点击只读重试一次 | `session-history-native-reference.spec.ts` | 616/390 × light/dark | S；原包warningCallout真实组件配对；不是原包真实读取失败；本轮未运行 |
| M26 | SSE断开→重连：清连接/同步提示、草稿不丢、无隐式写请求 | `session-connection-recovery.spec.ts` | 1p fixture | S/H；低版本AbortSignal兼容另有case；浏览器WiFi/蜂窝/OS suspend U |
| M27 | SSE序号gap/malformed/无完成：仅只读history修复、保留reader | `session-background-sync.spec.ts:517`、`session-state-recovery.spec.ts:268,398,487` | D/M；多标签；有真实EventSource辅助夹具 | S/H；原包client同类完整paired U；需要同时记传输字节、游标、终态 |
| M28 | 运行实例重启或较小快照：reset旧cursor，挡住旧实例ACK | `session-state-recovery.spec.ts:124` | 1p fixture | S；原生服务generation/账号与网页store实例必须分层，不能仅用threadId |
| M29 | 普通刷新：tabs/status/draft恢复，失败可重试，阅读位置不动 | `session-restoration.spec.ts:82`、`session-background-sync.spec.ts:433` | 测试viewport loop；多tabs | S/H；项目层恢复不等于官方编辑器已ready；场景不得隐式resume/interrupt |
| M30 | 手机切后台/pagehide/refresh：运行不中断，排队保持，0新写 | `session-background-interruption.spec.ts:5` | M393/D1280 | S/H；通过覆盖visibility/pagehide模拟；未模拟OS真实挂起、进程驱逐、页面冻结恢复 |
| M31 | 官方running刷新/关闭一端：精确turn持续active，完成一次，UI收尾 | `codex-refresh-running-acceptance.mjs` | 三页面；桌面+M393；自有官方夹具 | S/H/O-F分层：需显式manifest，受控provider释放；结果`measuresRecoveryPerformance:false`，不能当性能绿 |
| M32 | 官方pending approval刷新：无composer不显示误导onboarding | `codex-refresh-approval-acceptance.mjs` | 三页面；自有官方夹具 | S/H/O-F：有历史有限样本；完整手机/断线/多host组合当前U |
| M33 | 原生completed后composer settle：正确唯一thread、清稿、无busy/Stop/Queue、有Send | `codex-refresh-ui-settlement.mjs` | 单页/3host显式选择 | S/H：10/16并发手机曾completed但15s仍Stop；另组绿不可擦除该红；不能只看native completed |
| M34 | 翻页：保留native cursor、view=chat裁正文、滚动锚不跳，不acquire/resume | `session-background-sync.spec.ts:433`、`session-reading-resize.spec.ts:22`；运行层专项测试 | D/M、两个可见长历史 | S/H；完整官方同数据长history paired U；不能用前端隐藏工具行替代网络剪裁 |
| M35 | 1200项长历史+两页：独立位置/草稿/未读、后台不轮询大history | `session-multi-client-recovery.spec.ts:64` | 同源2p、一页split；HTTP fixture | H：10/27 9次history1,449,222UTF8字节、anchor0px；不等于真实native长history/10k流/30minRSS |
| M36 | 首次cold history超显示预算：首次发布前有界，5MiB prompt头尾保留 | `session-cold-memory-budget.spec.ts:6` | 1p；注入20turn+大prompt | S：当前测试断言事件≤8MiB、prompt≤256KiB、0写；模拟响应非原包对照；本轮未跑 |
| M37 | 高堆压不重复发布相同受保护附件：防渲染反馈循环 | `session-memory-feedback-loop.spec.ts:3` | 1p空fixture+实际store/governor | S：人为performance.memory=300MiB，等待2.3s；不是分配300MiB或自然GC实测；本轮未跑 |
| M38 | 不可见正文60s回收→只读重显：终态/审批/未读独立保留 | `session-idle-memory.spec.ts:195`、`session-transcript-memory.spec.ts`、`session-memory-governor.spec.ts` | 多标签/后台 | S/H；必须同时记录JS堆+renderer RSS；默认长测skip不能变绿 |
| M39 | 自然长测：30min、真实HTTP/EventSource、RSS/堆/传输/回显都闭合 | `session-idle-memory.spec.ts:341`、`session-network-memory.spec.mts`、`session-react-performance-memory.spec.mts` | 当前场景依具体参数 | S/H；`SESSION_MEMORY_SOAK_MINUTES`默认0会跳过自然长测。历史红灯不能推断新HEAD仍红，也不能以新单测绿代替复验 |
| M40 | composer模块加载失败：显式reload入口恢复草稿，无隐式task操作 | `session-module-recovery.spec.ts:5` | 393/1440 | S/H；历史22nd-context ERR_NETWORK_CHANGED中断性能批次；不是30个有效样本，不能与后续2/2功能恢复合并成p95 |

### 3.4 多窗、身份、草稿、附件及体验

| ID | 状态/触发与必要断言 | 当前可执行入口 | 视口/客户端粒度 | 本轮证据与剩余差异/缺口 |
|---|---|---|---|---|
| M41 | split多可见窗：每窗reading/更新/目标独立、拖拽不串输入 | `session-split.spec.ts`、`session-split-drag.spec.ts`、`session-reading-resize.spec.ts` | D/M；同页多pane | S/H；同页多pane≠多标签≠独立contexts≠独立native hosts，禁止合并计数 |
| M42 | 跨设备tabs：共享关注/顺序/关闭，输入目标与布局/阅读本地 | `session-tabs-sync.spec.ts:31`、`session-projects-cross-context.spec.ts:47` | D + M390，2ctx，离线编辑 | H：10/27有Fastify状态/isolatedAPI证据；未验实体手机网络/OS；属于Kanban特有设计，不要求移除 |
| M43 | 20/50后台tabs：状态推进，slow history不阻塞其它窗，0大轮询 | `session-background-sync.spec.ts:174,633` | D/M、20或50标签fixture | S/H；50标签不等于50官方iframe；需资源与interaction latency单独计量 |
| M44 | owner外部占用：禁止retry/continue/重复投递，保留草稿/附件，可移除失败项 | `session-queue-recovery.spec.ts:9,172` | 390/1440 | S/H；同Session runtime保护非跨独立writer原子CAS；外部释放后不能自动重发 |
| M45 | uncertain ACK：显式确认前不重发；reload后重试沿原意图ID | `session-queue-recovery.spec.ts:129`、`session-submission-multitab.spec.ts:228` | 两页/真实Fastify+disk queue | H：10/27 10项提交安全样本；autoStart:false，无native写出；不能当模型执行通过 |
| M46 | 迟到send ACK：另一页新草稿/相同文字独立edit不能被清空 | `session-drafts-cross-page.spec.ts:19`、`session-submission-multitab.spec.ts` | 同源2p、独立context | S/H；不是只比字符串，要原owner/edit/revision；需跨端草稿本来就独立的规则 |
| M47 | 附件异步upload/delete/restore：旧upload不能复活已删图，不误删其它页bytes | `session-attachments-multitab.spec.ts:89,130`、`session-queue-attachments.spec.ts:629,691` | 同源2p；D/M原组件有分批参考 | S/H；系统选图/相机/真实OS权限/大型图片内存U；本轮未验证原生图片上传 |
| M48 | 大粘贴/context/file引用/expanded draft：刷新保留、发送捕获冻结、undo不串设置 | `session-composer-v2.spec.ts:20,98,139`、`session-context-drafts-hmr.spec.mts`、`session-contexts-multitab.spec.ts` | 同源2p/HMR/D/M | S/H；草稿是设备本地设计，不能当缺跨设备同步bug；完整原组件context chips U |
| M49 | 模型/权限设置双页事务、晚read/ACK、A→B→A：不覆盖新意图 | `session-thread-settings-multitab.spec.ts:74,163,213,284,385`、`session-model-menu-selection-view.spec.ts` | 2p/重载 | S/H；nativePermissionMetadata不落盘；UI当前设置不替换已捕获发送参数；完整官方设置事件paired U |
| M50 | Goal完成清理晚ACK：新goal不被旧清除、只读完成不接管 | `session-goals-completion.spec.ts:72,95,111,127` | 项目fixture + 条件原组件 | S/H；reference比对为条件分支，无env测试依然可绿但不能记O-C；跨客户端native CAS不支持 |
| M51 | 子Agent readonly观察：不改变主输入/project、不resume；审批精确身份 | `session-subagents.spec.ts:465,530,896,1054,1093` | D/M、split、batch stop | S/H；通信不当父子证据；旧权限/旧轮stop挡住；原包完整family UI/协议组合仍待对照 |
| M52 | Enter/IME/touch：手机Return不误发；external keyboard明确组合发送 | `session-composer-enter.spec.ts:46,72,84,146` | touch与键盘fixture；D/M | S/H；composition事件模拟不能冒充系统候选词/实体键盘；原包可信compositionend历史也未闭合 |
| M53 | 主工作台布局：控件不被裁、landscape/short viewport可达、hidden mode不监听键 | `session-codex-visual-acceptance.spec.ts:104`、`session-latest-message-actions.spec.ts:131` | 1440/768/480/390/844×390/390×420，双主题 | C仅latest-actions有限hidden行为；其余S/H。390×420为缩小viewport，不是物理软键盘；safe-area/OS行为U |
| M54 | 单窗/三窗≤2s：导航/composer实际可输入，typing顺畅、样本分位数 | `session-startup-performance.spec.ts:15,229,352` | 393/1440；30冷样本；同context三页×10批 | H：10/27 fixture p95约1.3s单窗/1.56s三页；当前未复跑；不等于3host官方插件或所有场景≤2s |
| M55 | 三独立官方宿主刷新并发send：thread唯一、各输入仅一次、UI收尾、2s | `codex-refresh-concurrent-send-acceptance.mjs`、`codex-refresh-browser-acceptance.mjs` | 明确共享诊断profile或3精确profile、3origin | H/O-F：10/16并发组仍有手机Stop/15s红，另一独立组绿；顺序11.9–13.9s性能红；当前复验缺条件 |

表内路径按当前仓库核对；没有把“尚未执行”写成“失败”。

## 4. 状态关系必须拆开核对

完整矩阵不能用一个 `running/idle` 字段表达。至少以下状态域并存：

1. native thread 状态与 turn/item 状态：active/idle 等线程状态不自动覆盖精确 turn 的 inProgress/completed/failed/interrupted。
2. 传输与恢复：connected/disconnected/reconnecting、SSE sequence/cursor、historyLoaded/historyLoading/error、部分live正文与完整history是独立轴。
3. writer与授权：owner、native instance/generation、account scope、request/token、待写guard；只读恢复不能获取writer。
4. UI宿主：外壳、workbench barrier、extensionHost、webview、correct-thread frame、composer ready/settled；opened HTTP/native completed均不是UI空闲。
5. 草稿与发送意图：thread/project/owner/edit/revision、text/image/context、queued/sending/uncertain/failed/sent、当前UI设置与已捕获参数。
6. 可见性与资源：关注集合、visible正文消费者、隐藏宽限、内存eviction、阅读anchor、unread、独立设备布局。

关键跨域不变量：

| 转换 | 必须观察的两端 | 不允许的推断 |
|---|---|---|
| transport disconnect→reconnect | 实际browser-facing socket断开；since恢复；history终态与UI | “SSE断了，所以native turn已中断” |
| reload→restore | exact instance+thread；draft revision；composer；0隐式任务写入 | “重新加载iframe可见，所以可发送” |
| turn completed→UI settle | native精确完成一次；唯一正确composer已清稿、无busy/Stop/Queue、有Send | “completed后立刻截图还有Stop，所以永久卡死”；或反向把completed算空闲 |
| history failed + partial live delta | error仍可见；partial/final身份；成功完整history后清error | “收到一条delta就同步成功” |
| old interrupted + new/late final | 精确turn/item标识、事件sequence、history权威终态 | “没有正文就造一条已中断”或把另一轮final覆盖此轮 |
| send unknown ACK→retry | 原submission identity、真实durable queue、显式重试 | “没有HTTP ACK所以必未送达” |
| old ACK after draft edit | 捕获的owner/edit/revision与当前草稿不相同 | “文字一样就可清稿” |
| hidden→evicted→visible | 任务/审批/未读连续；只读history恢复；锚点及bounded缓存 | “正文卸载就停止task”或静默完整history轮询 |

## 5. 当前证据不能支持的“完整”结论

| 差异/缺口ID | 分类 | 结论与下一步验证 |
|---|---|---|
| E01 | 当前覆盖缺口 | 本轮9绿只更新M04/M10及有限M53；其余S/H不得据此改为C |
| E02 | 原组件与完整宿主边界 | O-C是真实官方组件，具有价值，但fixtures的host API/provider替身没有执行完整extensionHost/MessagePort/native。完整逐状态O-F仍未闭合 |
| E03 | 产品与独立Codex模式边界 | Session API fixture性能历史绿与官方宿主历史15s级红分属不同架构，不能互相替代 |
| E04 | 历史来源一致性 | 10/09 review-checks是设计草图；10/10–10/27 visual/batch累积记录并非同一HEAD、同一数据、同一浏览器一次完整矩阵 |
| E05 | 条件skip污染覆盖 | reference URL缺失会skip；Goal completion条件对比不执行也可product test绿；必须读runner skipped和分支执行证据 |
| E06 | 多客户端概念差异 | pane、same-origin page、独立context、独立origin、独立host、独立native-writer不能合称“多端已验收” |
| E07 | 真实网络与隐藏差异 | Object.defineProperty(document.hidden/visibilityState)、setOffline和真正browser-facing SSE切断不是等价实验；OS后台冻结/网络切换未统一覆盖 |
| E08 | 内存测量差异 | 模拟performance.memory高压/合成10k事件/8MiB事件估算不等于自然GC+RSS长测；当前冷预算/feedback测试不证明30min稳定 |
| E09 | 手机证据差异 | touch/coarse pointer/393×852/DPR3是可复现尺寸模拟；不是物理Safari键盘/文件选择器/音频权限；用户已接受尺寸模拟，不因此阻塞本地审计 |
| E10 | 未闭合历史红灯 | 独立宿主并发手机UI收尾、两秒性能存在明确历史红样本，当前未重跑；报告保留但不声称本轮复现 |
| E11 | 请求完整性 | 原生双页审批O-N历史证据强于mock，但仅一个Session service下两网页；无法推导两个独立native writer原子审批 |
| E12 | 视觉范围 | 代码块局部像素/计算样式相同不等于整个工作台零差异；light/dark、360/390/480/768/1440、hover/touch/focus/disabled、所有状态的完整paired笛卡尔积尚未执行 |

这些是证据与验收层面的差异。具体产品功能差异须由父报告基于固定原包源码与当前实现逐项填写，不能从测试名或未覆盖状态臆测所有功能缺失。

## 6. 可执行验证路径

以下命令为后续 review 可复验入口。本次仅执行第1组；第2组需要用户选定验证范围后安排，不自动重启正式服务或复用登录。

### 6.1 本轮原组件有限对照，可重复

由所有者启动/管理只读参考服务，必须 `0.0.0.0`，使用实际打印的HTTP LAN URL。项目前端使用实际LAN HTTPS URL且通过fixture截断所有API/WS；不用仅127.0.0.1的前端地址作为局域网验收。

```sh
# 先读取 scripts/codex-goal-reference-server.mjs 的当前参数，
# 由单一所有者启动参考服务，并保存私有启动日志；不得重复启多个实例。
PLAYWRIGHT_SKIP_WEBSERVER=1 \
PLAYWRIGHT_BASE_URL=https://10.30.0.24:8484 \
PLAYWRIGHT_FRONTEND_PROTOCOL=https \
CODEX_GOAL_REFERENCE_URL=http://10.30.0.24:36601/native-goal.html \
CODEX_NATIVE_REFERENCE_URL=http://10.30.0.24:36601/native-goal.html \
RAIL_EVIDENCE_PHASE=audit-20261029 \
pnpm exec playwright test \
  tests/e2e/session-rail-theme.spec.ts \
  tests/e2e/session-latest-message-actions.spec.ts \
  --reporter=json \
  --output=.dev-runtime/codex-client-audit-20261029/paired-e2e/artifacts
```

地址是本轮运行值，应在复验时换为所有者刚确认的实际地址。result.json第一行dotenv的环境变量数量提示不含值；读取JSON前跳过该日志行，保留原始输出。

### 6.2 其余原组件reference（本轮未执行）

```sh
# 同上显式PLAYWRIGHT_*与CODEX_NATIVE_REFERENCE_URL；检查当前fixture所需providers。
pnpm exec playwright test tests/e2e/session-history-native-reference.spec.ts
pnpm exec playwright test tests/e2e/session-native-request-parity.spec.ts \
  tests/e2e/session-codex-requests-reference.spec.ts
# 使用CODEX_GOAL_REFERENCE_URL；同时核对原组件分支真的执行。
pnpm exec playwright test tests/e2e/session-goals-reference.spec.ts \
  tests/e2e/session-goals-completion.spec.ts
```

重试/错误/typed request对照脚本的参考页会限制外域请求；原组件实际执行仍只记录O-C。不要盲目把全部带native字样的spec加入此组。`session-codex-native-review.spec.ts`对git API有`route.continue()`，须先建立独立私有仓库/服务夹具，不能直接连接正式后端运行该脚本。

### 6.3 真正native隔离审批（O-N，本轮未执行）

```sh
python3 scripts/fixtures/session-approval-multiclient/acceptance.py \
  --codex /absolute/path/to/fixed-version/codex \
  --browser /absolute/path/to/chrome \
  --output-dir /absolute/path/to/new/private/evidence-output
```

先读该目录README。需要Linux x86_64/Python/Node/strace/Chrome、精确CLI字节；输出新建0700私有目录；seccomp只允许自有loopback provider；不复制登录、不连接default IPC。仅固定无害审批fixture命令，不是真实任务/账号验收。不能把历史187源指纹等同本轮HEAD。

### 6.4 完整官方宿主刷新（O-F，需要全新自有夹具，本轮未执行）

```sh
NATIVE_CODEX_REFRESH_BROWSER_MANIFEST=/absolute/private/manifest.json \
NATIVE_CODEX_REFRESH_BROWSER_OUTPUT=/absolute/private/fresh-output \
node tests/e2e/codex-refresh-running-acceptance.mjs
# 同一显式前提分别运行approval / concurrent-send / interrupt / newchat脚本，
# 每次输出全新目录，不覆盖早期失败，不把未运行项计绿。
```

manifest必须真实0600、自有、`noLoginCopied:true`、`managedStartup:true`、精确profile/native/host PID start ticks、三唯一HTTPS源；固定fixture root `/tmp/ck-ui-life-*`；共享诊断profile或三精确独立profiles选择必须如实记录。具体setup参见 `tests/e2e/codex-refresh-ui-fixture.mjs` 与刷新文档；这些脚本需要fixture释放受控provider，不能拿正式Agent当夹具。

`codex-refresh-ui-settlement.mjs`必须在精确native turn完成后核对：正确thread、唯一composer、空草稿、无busy/Stop/Queue、有Send。单次原生completed/HTTP200/iframe存在都不足。

### 6.5 项目恢复/草稿/多页与性能（本轮未执行）

按相关spec先核对fixture全部API/WS隔离与真实Fastify只写独立SESSION_DATA_HOME；使用显式 `PLAYWRIGHT_SKIP_WEBSERVER=1` 防止默认配置启动第二套服务。按状态小组选择，不把所有测试一次跑满。

```sh
pnpm exec playwright test tests/e2e/session-render-recovery.spec.ts \
  tests/e2e/session-state-recovery.spec.ts \
  tests/e2e/session-background-interruption.spec.ts
pnpm exec playwright test tests/e2e/session-submission-multitab.spec.ts \
  tests/e2e/session-attachments-multitab.spec.ts \
  tests/e2e/session-drafts-cross-page.spec.ts
SESSION_STARTUP_RUNS=30 pnpm exec playwright test \
  tests/e2e/session-startup-performance.spec.ts
SESSION_MEMORY_SOAK_MINUTES=30 pnpm exec playwright test \
  tests/e2e/session-idle-memory.spec.ts
```

性能批次需记录冷/热缓存定义、共同source-manifest、每样本导航起点、导航ready、composer可输入、三窗输入延迟、最大值与p95、requestfailed、浏览器版本、资源传输、JS堆与renderer RSS。若网络中途异常/未完成全部样本，保留原始失败与样本，整批不得补成“30/30绿”。

## 7. 历史记录索引与不可搬用条件

| 文档 | 可沿用的知识 | 当前不能直接沿用的结论 |
|---|---|---|
| `docs/designs/session-render-alignment/current-goal-audit-20261027.md` | 明确列出未闭合矩阵；具体历史样本与入口 | 所有R1/R4批次绿即当前全产品绿 |
| `docs/designs/session-render-alignment/visual-acceptance.md` | 原组件字体/DOM/几何取证方式；每批版本与视口 | 多批截图合成同一次完整paired；局部pixel等价即全页面等价 |
| `docs/designs/session-render-alignment/review-checks.md` | 早期设计语义 | 设计草图当产品/原包当前验收 |
| `docs/designs/session-render-alignment/native-dual-client-approval-20261027.md` | 真实CLI+SSE+ApprovalItem竞态/断线证明 | 完整官方插件、正式网关、实体手机、独立native-writer CAS |
| `docs/designs/session-render-alignment/multi-client-recovery-20261027.md` | 两页/1200项/HTTP读量/精确anchor等有限证据 | 真实native history、自然后台OS、10k事件、30minRSS |
| `docs/designs/session-render-alignment/submission-multiclient-safety-20261027.md` | 真实Fastify+durable queue提交身份/未知ACK | native模型执行；其实际E2E文件为`session-submission-multitab.spec.ts` |
| `docs/designs/codex-mode-audit-20261014/refresh-client-settlement-20261016.md` | completed后需额外UI收尾；红样本完整保留 | 后一组绿消除前一组手机Stop红；顺序成功代表并发收尾稳定 |
| `docs/designs/codex-mode-audit-20261014/refresh-official-lifecycle-20261016.md` | running/pending/并发官方host有限生命周期证据 | 15s级结果算≤2s；功能9/9算完整180次矩阵 |
| `docs/designs/codex-mode-audit-20261014/refresh-recovery-progress-20261015.md` | 历史推进与后续闭合原因，不能只摘早期红 | 全部红都是现存bug；所有旧绿都属于当前HEAD |

本轮结论：固定版本的有限原组件对照可执行且选定9项通过；55个场景已经按状态、视口、客户端与证据层级拆开，当前整体仍是**有限已验证 + 多项静态覆盖/历史证据 + 明确未覆盖项**，不足以称“完整官方客户端行为等价”或“所有bug已排除”。后续是否开发、先开发哪项，由用户review主报告后决定。
