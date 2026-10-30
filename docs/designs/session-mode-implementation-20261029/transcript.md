# 正文、Sources与运行呈现实施记录（2026-10-29～30）

本文覆盖批准方案的正文域 T01–T54。其他范围矩阵条目、正式服务切换、2秒 p95、真实官方 daemon任务与CLI共享、三provider组合由各负责人汇总；不能把下述组件/fixture结果解释为全部174项已验收。代码保留在当前混合工作区，本文不执行提交或切换正式入口。

## 原包证据与边界

基线仍为只读 `third_party/openai.chatgpt-26.51007.21434-linux-x64`。复核审计已有O01–O50：原始SHA256和0-based UTF-16 needle均匹配；并补O51–O53：`app-initial-41ab338a184f.js`中的 `ght` failure schema / `_ht` exact image_gen limit 与 `sites-end-resource-733bd1c6da06.js` 的 `LD` 额度卡。53锚结果在 `.dev-runtime/session-mode-implementation-20261029/transcript/native-anchor-verification.json`。下表“Oxx”链接回[原审计锚表](../session-render-alignment/codex-client-audit-20261029/transcript.md)。原包保持未修改。

组件静态核对、Vitest、受控浏览器、原生协议及像素几何分别记账。下面广域单测覆盖既有正文组件，不能当作所有官方schema、真实账号、真实模型任务或像素同一性的证明。

## 实现与不变量

- 运行中默认只保留最新commentary及当前工具；计时按钮可展开全部。完成文档、错误/请求、计划和MCP App/生成图片结果独立保留。过程折叠只影响投影，事件、序号、审批与任务不受影响。
- 流式Markdown保留现有8KiB segments和256KiB head/tail预算。解析只处理新增稳定段及≤16KiB变化尾段；最多128稳定块。超长未闭合块、跨段引用定义等无法局部正确解析时明确保留有界原文，完成后走原完整renderer。没有每token join全篇，也没有以流中copy/fork操作冒充终稿。
- 控制事件精确分类：不按宽泛前缀删除协议。readState/queue/metadata等仍留在事件源与状态消费者，只不分配聊天行。未知方法/项进入最多32条、每标识≤512字符的身份诊断；不 stringify其payload。future null/opaque payload不会崩溃。
- 同一个精确thread/turn只呈现最后终态；后来的completed撤销旧interrupted展示。不同旧轮的真实interrupted保留。没有把任意本地inProgress timing强行压过native终态；fresh native active校正在history合并层实现，保留原“stale timing不能重开completed”断言。
- `CodexThread.tsx`变为轻量owner/visibility wrapper，原虚拟列表、阅读锚点及完整工具/Markdown实现完整搬至局部lazy `CodexTranscript.tsx`。模块加载时展示本线程最近4条各≤4KiB真实文本及≤8KiB live文本，并标记 `data-transcript-preparing`；不是正文ready。rich模块失败保留局部正文和composer。队列Markdown也使用局部lazy边界，最终仍是原renderer。
- Sources仅聚合已加载、有界聊天投影：每类最多512来源、每来源/调用目标最多32条；保留原turn/item来源，不声称全历史已经扫描。网页按host；文件按provided/read/created/updated；MCP按source和去重调用计数。文件继续走 `openWorkspaceFileReference`，捕获原owner cwd及行列，native字面文件名中的冒号不误拆。
- Sources MCP详情只在显式展开精确call后，通过既有单读者通道读取。输入/结果在JSON.stringify之前限制深度、条数和字符，最终仅保留≤2KiB预览字符串；不把完整tool item放React state或缓存。关闭、切scope、账号/连接失效时取消并释放。StrictMode effect replay在一microtask内先确认仍存活再获得读槽，避免abort中的reader被立即重取。
- image_gen只有原生 `failure.type=usageLimitExceeded` 且 `limitId=image_gen`、合法number/null resetsAt才显示额度卡。网关仅额外保留这3字段，仍不传结果像素/正文。显示真实reset时间；缺少原生workspace role时采用原包通用retry文案，不依据套餐猜组织角色、权限或账单操作。
- 官方daemon实时接入仅显式“连接实时交互”：access四字段必须满足 sharedDaemon、loaded、!attached、精确activeTurnId；再读内存scopeToken，捕获thread/turn/generation，单次POST。历史/预热/reconnect无自动resume。未知写入回执不自动重试；只读重新核对后再开放显式动作。runtime已有真实attached不因浏览器refresh重置，按钮不会每刷新再出现。
- `view=chat`接收前工具正文裁剪、8MiB display、16MiB chat、32MiB RPC、事件恢复、相同快照不通知、正文warm/dormant与任务状态分离均保持；本域没有放宽预算、恢复整历史轮询或停止Agent。

## T01–T54逐项对照

| ID | 功能 | 官方锚 | 本次处理 | 证据与验收范围 |
|---|---|---|---|---|
| T01 | 用户正文/Markdown | O11,O50 | 保留现有实现；本轮重新核对原包锚，原有边界不改 | UserMessageItem.native-edit / NativeUserMessageContent |
| T02 | 用户附件与引用 | O11 | 保留现有实现；本轮重新核对原包锚，原有边界不改 | NativeUserMessageContent / CodexMarkdown.images |
| T03 | 助手流式正文 | O09,O10,O12 | 有界渐进 Markdown；稳定块 memo，变化尾段≤16KiB，超长/引用依赖回退保留原文，完成后一次最终解析 | StreamingCodexMarkdown；AgentMessageItem.streaming/native；浏览器 live strong/code/table |
| T04 | 助手最终正文/行动条 | O08,O12,O34,O35 | 保留现有实现；本轮重新核对原包锚，原有边界不改 | AgentMessageItem.native/latest-actions/review |
| T05 | commentary 与 final_answer分层 | O02,O40 | 运行默认 latest，显式展开 all；current activity 与 final answer独立，不改事件或任务状态 | turnWork.latest；turnWorkScale；桌面/手机真实点击 |
| T06 | 公开reasoning摘要 | O17 | 保留现有实现；本轮重新核对原包锚，原有边界不改 | ReasoningSummaryItem / transcript投影 |
| T07 | turn工作时长/折叠 | O16,O41 | 保留现有实现；本轮重新核对原包锚，原有边界不改 | turnWork / TurnWorkHeader / turnWorkScale |
| T08 | 命令执行与解析动作 | O18 | 保留现有实现；本轮重新核对原包锚，原有边界不改 | ShellCommand.details/native / NativeActivityItem |
| T09 | 连续命令分组 | O01,O18 | 保留现有实现；本轮重新核对原包锚，原有边界不改 | deriveRenderItems / activityRows / turnWorkScale |
| T10 | 工具活动聚合 | O01,O42 | 保留现有实现；本轮重新核对原包锚，原有边界不改 | activityRows / NativeActivityGroup / nativeToolSemantics |
| T11 | 文件变更单项 | O19 | 保留现有实现；本轮重新核对原包锚，原有边界不改 | NativePatchItem / FileChange / metadata投影 |
| T12 | turn文件汇总/diff入口 | O25 | 保留现有实现；本轮重新核对原包锚，原有边界不改 | ThreadFileChangesSummary，跨域diff交互见extensions记录 |
| T13 | 撤销/恢复patch | O25 | 保留现有实现；本轮重新核对原包锚，原有边界不改 | 保留SavedPatchAction，真实Git撤销/冲突由extensions集成 |
| T14 | 代码审查结果 | O12 | 保留现有实现；本轮重新核对原包锚，原有边界不改 | AgentMessageItem.review；NativeReviewFindings跨域保留 |
| T15 | web search/search open/find | O15 | 保留现有实现；本轮重新核对原包锚，原有边界不改 | NativeActivityItem / nativeToolSemantics |
| T16 | image-view | O14 | 保留现有实现；本轮重新核对原包锚，原有边界不改 | LocalImage / NativeActivityItem / CodexImage |
| T17 | 生成图片占位与画廊 | O13 | 新增精确 native image_gen额度失败及reset时间，小元数据投影；已有图片与失败并存，图片/额度项不收进过程fold | NativeGeneratedImages.failure；turnWork.images；shared projection 8项；浏览器额度卡 |
| T18 | 生成图片编辑/下载 | O13 | 保留现有实现；本轮重新核对原包锚，原有边界不改 | NativeGeneratedImages 原owner保存回归；真实下载见集成 |
| T19 | context compaction | O27 | 保留现有实现；本轮重新核对原包锚，原有边界不改 | NativeCompactionItem |
| T20 | 普通MCP调用 | O28 | 保留现有实现；本轮重新核对原包锚，原有边界不改 | McpToolCallItem / ToolContent / commandDetail |
| T21 | MCP App交互widget | O28,O33 | 本域接精确thread/turn/item App入口，保留于fold外；双iframe、授权和资源生命周期由extensions负责 | McpToolCallItem.app-target；turnWork.mcp-app；独立extensions验收 |
| T22 | 动态工具注册表 | O29 | 保留现有实现；本轮重新核对原包锚，原有边界不改 | NativeDynamicToolItem / nativeDynamicToolSemantics/Oracle |
| T23 | 隐藏工具/协议噪声 | O13,O29 | readState等精确控制事件不占聊天行；未知事件进入仅32条小身份诊断，源事件不丢 | threadRows.metadata；transcriptDiagnostics（含null/future payload）；浏览器无控制JSON |
| T24 | 命令审批 | O07 | 保留现有实现；本轮重新核对原包锚，原有边界不改 | ApprovalItem.native |
| T25 | 文件变更审批 | O06 | 保留现有实现；本轮重新核对原包锚，原有边界不改 | ApprovalItem.native / NativePatchItem |
| T26 | 临时权限请求 | O21 | 保留现有实现；本轮重新核对原包锚，原有边界不改 | PermissionsItem.native |
| T27 | 同步request_user_input | O04,O42,O46 | 保留现有实现；本轮重新核对原包锚，原有边界不改 | RequestUserInputItem.native / rpcLifecycle |
| T28 | 异步问题/回答消息 | O01,O12 | 保留现有实现；本轮重新核对原包锚，原有边界不改 | AsyncQuestionEventItem；arrival/model跨域保留 |
| T29 | MCP form elicitation | O03,O20,O46 | 保留现有实现；本轮重新核对原包锚，原有边界不改 | ElicitationItem.native（composer独占修改） |
| T30 | MCP form键盘Escape | O47 | composer负责人实现；本域避开 ElicitationItem 文件 | 见composer实施记录；本域广域用例保留原请求回归 |
| T31 | MCP表单图片/文件选择 | O46 | 保留现有实现；本轮重新核对原包锚，原有边界不改 | ElicitationItem.native（composer/extension集成） |
| T32 | URL/auth/tool审批elicitation | O03,O20 | 保留现有实现；本轮重新核对原包锚，原有边界不改 | ElicitationItem.native；逐种真实request由集成验收 |
| T33 | 自动审批审核 | O30 | 保留现有实现；本轮重新核对原包锚，原有边界不改 | NativeSystemNotice / nativeAutomaticReview |
| T34 | hook消息/统计 | O08 | 保留现有实现；本轮重新核对原包锚，原有边界不改 | NativeHookStats / hooks投影 / AgentMessageItem |
| T35 | 模型改派通知 | O26 | 保留现有实现；本轮重新核对原包锚，原有边界不改 | NativeSystemNotice |
| T36 | 子Agent工具活动 | O31 | 保留现有实现；本轮重新核对原包锚，原有边界不改 | SubagentEvent/native metadata；子Agent读写边界由集成验收 |
| T37 | 子Agent原生进展消息 | O32 | 保留现有实现；本轮重新核对原包锚，原有边界不改 | SubagentEvent；精确子thread导航由集成验收 |
| T38 | 子Agent侧栏与读写边界 | O48 | 保留现有实现；本轮重新核对原包锚，原有边界不改 | 原SubagentPanel/inputIdentity保持；非本域改动 |
| T39 | 加载历史失败提示 | O37 | 保留局部历史失败+只读Retry；富renderer异步/模块失败显示本owner有界缓存正文，composer独立 | CodexThread.deferred；transcriptPreview；浏览器held-module |
| T40 | 更早消息分页 | O38 | 保留现有实现；本轮重新核对原包锚，原有边界不改 | earlierHistoryScroll / reading-position helpers；真实分页由performance验收 |
| T41 | 断线/恢复提示 | O39 | 保留连接和turn状态分离；新增官方共享daemon的显式实时连接（仅loaded+active精确turn+未attached） | CodexAccessNotice.attach；浏览器手势及refresh不重attach；原生route由root/runtime验收 |
| T42 | 历史failed与错误通知去重 | O23,O24 | 保留现有实现；本轮重新核对原包锚，原有边界不改 | TurnFailureNotice / threadRows / nativeErrorContent |
| T43 | 历史interrupted呈现 | O16,O41 | 同thread/turn终态去重，后来completed替换旧interrupted；真实旧轮中断保留 | threadRows.terminal-reconciliation；恢复层fresh native覆盖由performance负责 |
| T44 | 长历史/大输出与详情 | O18,O28,O38 | 保留网关裁工具正文、原内存预算和虚拟列表；新增来源详情先有界预览后释放 | codexTranscriptMemoryBudget/Visibility；commandDetail；SourceMcpPreview |
| T45 | 消息copy富文本 | O36,O50 | 保留现有实现；本轮重新核对原包锚，原有边界不改 | 原 NativeMessageCopy/clipboard；新流中不开放actions |
| T46 | 从回复分支并引用选区 | O35 | 保留现有实现；本轮重新核对原包锚，原有边界不改 | 原 NativeMessageFork.selection / owner链保持，非本域修改 |
| T47 | 编辑用户消息/回退 | O40 | 保留现有实现；本轮重新核对原包锚，原有边界不改 | 原 UserMessageItem.native-edit / InlineUserEditor保持 |
| T48 | 计划Markdown/展开 | O43,O44,O45 | 保留现有实现；本轮重新核对原包锚，原有边界不改 | PlanContentItem.native/copy；running计划在latest中保留 |
| T49 | 计划文档open/download/copy | O43,O44,O45 | 保留现有实现；本轮重新核对原包锚，原有边界不改 | 原计划侧栏/新窗保留，文件下载组合归集成 |
| T50 | todo-list计划进度 | O22 | 保留现有实现；本轮重新核对原包锚，原有边界不改 | TurnPlan / turnWork.latest |
| T51 | 文件引用与memory citation | O34 | 保留原文件/引用链；修正 source.ts:7:3 被当URI scheme；native字面路径不拆冒号 | fileReference；CodexMarkdown citation/file/image测试；Sources原owner跳转单测 |
| T52 | Sources完整聚合面板 | O49 | 新增完整 Sources侧栏；网页host、provided/read/created/updated文件、MCP source计数；只读详情按点击加载 | sourceCatalogue；ThreadSourcesPanel；SourceMcpPreview StrictMode；桌面/手机Sources截图 |
| T53 | 会话内查找与导航 | O40 | 保留现有实现；本轮重新核对原包锚，原有边界不改 | 原查找/rail/cursor/阅读定位完整搬入lazy renderer，跨页真实组合由performance验收 |
| T54 | 多窗口正文身份 | O40,O48 | owner/turn/item显式贯穿，局部lazy不阻塞精确composer；跨线程迟到target guard | MCP精确target/AccessNotice.attach；held renderer+稿保留浏览器；原生多窗组合归集成验收 |

## 红绿灯与浏览器证据

证据目录 `.dev-runtime/session-mode-implementation-20261029/transcript/` 为忽略目录；日志中的fixture账户均为隔离伪数据，未接正式IPC或登录。

| 范围 | 红灯 | 当前绿灯 / 结果 |
|---|---|---|
| latest/all、控制通知 | `transcript-red.log` | `transcript-wide-2.log` 51文件266项（后续扩展见宽回归） |
| 同turn中断终态去重 | `terminal-reconciliation-red.log` | 独立/广域threadRows回归 |
| bounded流式Markdown | `streaming-markdown-red.log` | streaming+AgentMessage+ShellCommand组3文件41项；后续宽回归 |
| Sources裸文件行号 | `sources-file-reference-red.log` | `sources-final-unit.log` 5文件18项 |
| Sources StrictMode reader | `sources-strict-red.log` | `sources-strict-green.log` 4项；真实点击不读取失败 |
| future null诊断 | `transcript-null-diagnostic-red.log` | 宽回归 `transcript-final-unit.log` 的相关文件已绿 |
| 显式实时连接 | `attach-red.log` | `attach-green.log` 3文件20项；后续额外资格/迟到测试 |
| 持久MCP App入口 | `transcript-mcp-persistent-red.log` | `transcript-attach-mcp-green.log` 4文件21项 |
| rich renderer延迟 | `transcript-deferred-red.log` | `transcript-deferred-all-green.log` 5文件6项；正确缓存与composer独立 |
| 队列富文本延迟 | `queue-markdown-deferred-red.log` | `queue-rich-preview-final-green.log` 原6项bold/code/no-heading全部保持；等待实际module完成，不抬性能阈值 |
| quota元数据/卡片 | `image-quota-red.log` / `image-quota-projection-red.log` | `image-quota-green.log` 2文件6项；共享8项；`image-quota-final-green.log` 5文件18项 |
| 图片不被work折叠 | `transcript-image-persistence-red.log` | `transcript-preview-fold-green.log` 中该例绿（队列旧同步断言随后修正见上行） |

宽回归 `transcript-final-unit.log`：144文件791项，143文件789项绿，2项既有 CodexDeliveryEchoes fixture 因新增nativeOperationContext范围读取未mock而红；管理负责人已补精确有效scope并单独重跑。没有放宽实际scope gate。最终全量结果由主实施记录汇总。

受控功能前端为 **HTTP LAN `http://10.30.0.24:19897`**，绑定0.0.0.0、独立端口，全API/EventSource/WebSocket均由测试fixture控制，不运行模型、不接正式网关。首次真实浏览器发现并修复Sources footer与composer重叠；随后发现并修复StrictMode single-reader冲突。`tests/e2e/session-transcript-parity.spec.ts`覆盖1440×852和393×852：

1. 显式live attach前无写入；精确scope/thread/turn只发一次；refresh保持attached且不重写。
2. 持有rich renderer模块未响应时，准确owner缓存正文仍可读，真实公共composer目标正确且可编辑；释放模块后正文和草稿保持。
3. latest/all真实点击，控制JSON不入正文，流式strong/code/table即时可见且无终稿actions；quota可见，Sources网页/文件/MCP预览真实点击，详情前0次读、后仅1次精确读；关闭回到同一live正文。

`browser-deferred`：4场景通过，19.4s（功能测试总耗时，非加载p95）。`browser-attach-quota`扩展6场景首轮5绿、最后手机Sources在持续HMR服务中关闭；没有把这轮记成全绿。该手机单例带trace复验通过（`browser-phone-trace`，12.4s），仍需在无HMR冻结快照完成全部6场景。严格两秒性能另用 `https://10.30.0.24:43577` 的冻结HTTP2前端，采样由performance负责人执行，body-ready必须排除`data-transcript-preparing`。

## 残留与集成关卡

- 本域未向真实CLI/daemon发送模型任务，显式attach浏览器fixture不是原生接管/实时审批证明；真实daemon与gateway由root/runtime用独立无登录provider验证。
- 不宣称T01–T54完整像素一致。原有原包组件/几何保护保留；新Sources与quota遵循当前工作台视觉，逐状态原包双渲染、真实多窗审批、原生连续刷新和iPhone实机应随主验收单列。
- 原生商业账号workspace role在当前公开snapshot中不可核实：quota原因/reset准确，个性化“通知owner/加credits”文案没有通过猜套餐实现。原包通用retry分支可用；若本期要求商业分流，需要同scope只读真实role能力，不能伪造权限预检。
- Sources只列当前加载窗口的来源，有显式说明；更早来源须加载其历史。未把原包云端Sources数据或全工具正文回灌浏览器。
- MCP App完整双iframe与工具权限验收归extensions记录；T30归composer记录。三provider、30关注/4窗/3页p95及50/100压力归主验收；本文的HTTP实时服务结果不替代它们。

## 供中央清单合并的功能与修复

新增功能：默认latest/all；有界流式Markdown；Sources来源侧栏与按需MCP预览；未知协议小身份诊断；官方daemon显式live连接；native image_gen额度卡；局部异步renderer保留正确缓存正文与composer。

修复记录：readState等控制JSON混入聊天；同turn旧interrupted在completed之后重复显示；裸`source.ts:7:3`被误认为URI scheme；Sources新入口在短屏被composer覆盖；StrictMode取消原生reader后立即重取导致详情失败；MCP App/生成图片被过程折叠隐藏；队列Markdown静态依赖阻塞composer模块。中央 `func_list.md/debug_list.md` 及仓库镜像由root合并，本文不修改它们。


## 2026-10-30 当前源码补充验收与辅助Agent正文

本轮另起自有冻结功能前端 **HTTP LAN `http://10.30.0.24:33015`**，绑定0.0.0.0，源码清单2800项（`.dev-runtime/session-multisession-20261029/frozen-1793295627699/source-manifest.json`）；无API proxy/HMR，业务接口全隔离，不接正式任务。固定26.51007原组件只读参考为 **HTTP `http://10.30.0.24:37565/native-transcript.html`**，原包字节SHA仍由reference server核实；这两个地址仅为本次验收监听，不是部署默认配置。

- 当前生成图片额度notice的四组成对测试（700/390 × light/dark）与原renderer探针共5项通过。文案、13px字体/19.5px行高、原16×16图标path、色彩、间距、整体高度均逐项相等；`quota-paired-current/**/paired-quota.json`与original/candidate截图留存。旧45083候选的文字/图标/高度红灯仍保留，不据此推断所有T01–T54像素一致。
- 正文功能在相同冻结前端6项通过（1440/393）：显式live attach等待实际唯一POST与fresh access确认，再刷新保持；held rich模块保留本owner预览/可编辑composer/草稿；latest/all、live Markdown、控制噪声、quota及Sources。`current-six-receipt/`为当前记录，约28.5s为全部功能测试耗时，非加载p95。首轮5/6中的手机attach断言在按钮改为“正在连接…”即提前检查writes；校正为等待真实POST和完成状态，不把按钮消失当回执，不修改生产写入guard。
- CC/ACP大预览新增显式“查看完整内容”，只读64KiB响应在JSON解析前限额，只保留当前原始内容部分，后续分片必须同itemRevision；关闭、隐藏、切后端/账号/运行域或源改变释放。不会把完整巨项放回canonical正文store。SDK转换保留源ID；纯工具与tool-result裁剪行不再被分组逻辑吞掉入口。
- 真实发现CC SDK用户content数组正文/图片原来在msg.text为空时完全不渲染，现保留原问题、支持的图片和原顺序；非法图片来源不触发不受限URL。新增2项先红后绿；详情/转换/失败边界共10项通过。大图片的按需图像查看/下载正在补充，不能把base64 JSON可读算图片已验收。
- CC/ACP两尺寸完整Workbench详情流程4项通过（`provider-detail-native-stream/`）：展开前0次detail，精确session/source请求、下一部分替换而不累计、关闭后同owner草稿仍可编辑。持久原生EventSource/真实HTTP由自有夹具提供。首次旧SSE夹具立即结束触发scope正确撤销，3项红灯保留；改为持久连接后通过，不移除撤销保护。

广域170文件835项检查点有832项绿，唯一3项citation旧fixture因mock缺getState及新的scope guard而失败；已改为真实store范围，保留原editor bridge和新增自有files路径/行范围断言，相关3项加2项CC历史复验通过（`/tmp/transcript-citation-current-green.log`）。该记录不冒充最终整个工作区全量通过；根线程仍做最终整合。web类型检查在本轮补充后通过，原生scope、两秒、多页、资源与图片扩展分别记账。

174项/55场景的独立[执行矩阵](execution-matrix.md)逐行列出实现指针和证据等级；没有把静态存在、旧原包对照或默认skip写成全部通过。

### 原图和 accepted steer 的补充闭环

CC/ACP 大图已从“可展开base64 JSON”补为显式二进制预览和原图下载。入口传递原session/item/index/MIME；一次只保留一张blob，下载复用当前blob，预览40MP/10MiB，超像素仅允许显式下载。真实Chromium在HTTP LAN `http://10.30.0.24:37173`（绑定`0.0.0.0`，私有冻结`frozen-1793297374331`，无正式API代理）完成CC/ACP×1440/393的8项文本详情+原图浏览器：图片实际解码为1px，下载逐字节等于原图，换图及关闭后旧blob URL实际fetch失败，原owner草稿保留。记录`.dev-runtime/session-mode-implementation-20261029/transcript/receipts-images-current-green`中8绿；同批2个steer测试因fixture未建立关注目标失败，不能将整批10项写成通过。

文本详情、原图和持久补充说明均使用`retainExternalTranscriptBody`只登记身份/数字，不建立第二份正文缓存。文本页按UTF-16估算，图片同时登记编码blob与当前解码像素估算；关闭/隐藏释放后删除元数据。显式图像像素限制和真实后端格式/源检查属于独立后端门禁，视口模拟不是实体手机证据。

官方0.165原生探针证明steer进入同一轮、provider收到内容，但首轮完成历史没有对应的独立user item。因此`CodexSteerReceipts`将服务端持久记录作为显示来源而非native item，标“已发送的补充说明”。当前namespace绑定保留发送时旧scope，单页30条/1MiB并替换旧页；只读GET，不resume/重发。精确native identity的合并还要求服务端持久索引确认唯一，跨页重复或未知身份保留distinct source原文。原生、服务器持久状态、网页刷新与组合冻结各自记账。

当前正文/Markdown/Sources/CC/ACP广域 **173文件849项通过**（`/tmp/transcript-current-broad-final.log`），修复了之前旧citation fixture缺`getState`的3红，保留原编辑器桥接与文件/行范围断言。随后新增身份歧义守卫单独有17项检查点；最终全项目冻结由总验收统一执行。

源查看进一步补了两个实际时序反例：预览失败后的下载、文本下一页不得重新捕获新账号/设备scope来读取旧source。初次“查看”手势就捕获scope，穿过lazy模块加载边界，翻页/重试/下载复用原scope；两项旧实现分别出现第二次错误读取与错误账号页，修复后历史13项专项通过。原生steer的非文字image/audio/localAudio/mention/skill引用现折叠显示原URL/路径/名称，保留唯一引用，不自动解码、播放或执行；对应先红后绿。最新7文件39项新详情/receipt/原发送回显专项通过，记录`/tmp/transcript-current-all-new-final.log`。

Goal取消专项的旧fixture没有模拟新生命周期作用域GET，导致请求在进入Goal前404，旧测试却无界等入站。补真实私有scope/namespace，不削弱无持久文件时仍存在的内存写入gate；入站与整case均有限deadline并包含响应/路径诊断。3种Goal取消和14个通用网关检查17/17通过（`/tmp/transcript-gateway-cancellation-current-green.log`），上游挂起请求在浏览器取消后真实关闭。这里只修测试合同，不以跳过gate让测试转绿。

## 预览首次手势的来源绑定（2026-10-30）

后续审计发现更早的窗口：旧消息预览尚未展开，同值账号通知或同地址配对 token 已变化，此时第一次点击不能把旧 source ID 绑定到新账号。`ProviderHistoryDetail` 现在在该来源预览出现时捕获原域，首次按钮手势先同步核对；已有独立只读面板通过可选 `originScope` 传入其原始来源域。失效显示“重新加载会话后查看”，不自动恢复写权限或重读。读者挂载后的翻页/重试/下载继续复用原手势域，关闭/隐藏释放原有观察与 blob。未给每条预览增加订阅、SSE、正文缓存或凭据持久化。

`/tmp/transcript-origin-first-gesture-red.log` 保留同值账号与同 endpoint token 的2项真实旧行为失败；`/tmp/transcript-origin-first-gesture-green.log` 为3文件15项通过。真实浏览器在 HTTP LAN `http://10.30.0.24:44649`（0.0.0.0、冻结2856文件、无正式API代理）覆盖CC/ACP×1440/393的首次手势撤销，原消息预览仍在时实际同步推进产品scope并点击，readonly HTTP为0且草稿保留；其余原文分页与图片原始下载/释放/懒模块撤销也重跑。**22/22通过（1.2分钟）**，以 `/tmp/transcript-origin-and-lazy-worker-final.log` 及 `.dev-runtime/session-mode-implementation-20261029/client-account/origin-and-lazy-worker-final/` 为准。这些是隔离HTTP/SSE与真实Chromium证据，不是原生账号、实体手机或全工作区性能通过。

## LG03 手机列表长按专项

沿用现有 `ThreadList` 的450ms touch/pen指针长按，不新增产品行为。`ThreadList.usability.test.tsx` 新增449ms不弹/450ms弹、松手click不选择，以及pointerup/move/cancel在阈值前取消的4项检查；包含原列表分支共15/15通过（`/tmp/transcript-mobile-longpress-unit.log`）。`session-mobile-list-longpress.spec.ts` 在同一HTTP44649冻结页上使用真实Chromium/CDP touchStart/touchEnd/touchMove，393手机尺寸1/1通过6.2秒：按住原行才展示管理菜单，随后滑动取消下一次长按，当前唯一输入owner、草稿和0任务写入均保留。未使用force-click或直接调用菜单handler；这不代表实体手机系统触摸验收。证据 `.dev-runtime/session-mode-implementation-20261029/transcript/mobile-longpress/`。

## 同ID只读确认与恢复

预览撤销后不要求整页刷新。`providerHistorySourceConfirmation.ts`只在实际接收并接受只读近期/向前页后，给该页确实包含、未被迟到live覆盖且实际进入canonical显示的source项登记WeakMap证明：provider、独立history source ID、原item ID、精确owner、读取前的作用域及本地confirmationKey。对象仅是查找键，不是授权依据；没有auth/正文/WeakMap落盘，弱键不额外持有正文，同scope同row证明不通知订阅者。metadata-only响应不生成证明，HMR丢失证明后必须再次只读核对。

CC/ACP的完整内容入口复用该证明。无证明或旧scope已撤销时，提供明确“重新核对来源”，只读刷新原精确source，既不load/resume也不发任务。核对期间的scope观察及AbortSignal穿过懒模块与共享读取等待；换目标、隐藏或账号/设备变化取消原手势，迟到结果不解锁。实际新页确认了同一item后，详情重新可用，不把对象重建、重新渲染、当前账号数据或同ID猜测当成确认。原图片/下一页/重试仍使用展开时scope。

`ProviderHistoryReconfirmation.test.tsx`先对旧实现产生CC/ACP两红（失效后没有核对入口），随后实际调用生产只读读取函数、接受page与scope证明，通过同ID恢复；另覆盖确认期间同地址token改变，原read信号取消、旧页迟到不解锁，下一次明确核对才能查看。相关正文/详情/来源生产者9文件48项通过的检查点在 `/tmp/transcript-readonly-proof-unit-final.log`，后续token取消专项2文件13项日志 `/tmp/transcript-readonly-reconfirmation-cancel-final.log`。真实WorkBench的CC/ACP×1440/393已验证旧source首手势0详情读、明确实际recent确认后同ID恢复的8项，原图8项单列日志。新冻结HTTP LAN `http://10.30.0.24:39311`，0.0.0.0、2877文件、无正式API代理；证据 `.dev-runtime/session-mode-implementation-20261029/transcript/readonly-proof-reconfirmation-final/` 与 `readonly-image-proof-final/`，不把中间图片夹具尚未挂载前检查按钮的4红计入通过。完整代码/组合/性能仍以根最终验收为准。


向前历史页还有独立恢复边界：旧 item 不一定在近期页内，“重新核对来源”必须重读该 item 实际来自的原页。实际接受页的生产者现在在 WeakMap 证明中附带原始 `readCursor`，只作内存中的只读定位；consumer 将它传给原 CC/ACP reader，并重新捕获当前读取域。游标不能授予权限；403/409 明确提示重新选择历史会话或历史页，不自动回退 recent/raw，也不启动、恢复或发送 Agent。CC/ACP 两项旧行为先红（核对请求丢失原 cursor），然后增加两项拒绝分支，与详情/证明共3文件22项通过（`/tmp/transcript-earlier-source-confirmation-final.log`）。该最新 consumer 的浏览器组合仍由最终冻结验收覆盖，不能把先前 HTTP39311 证据当成此改动的浏览器通过。


## 缓存轮次的显示确定性

仅从设备缓存恢复、且缺少本次只读 native 证明的最新 interrupted 结束事件，会得到内存 WeakSet 标记。渲染器显示“正在核对轮次状态”，保留原事件的 interrupted 字段；没有把未知状态改成运行中、添加 Stop 或开放写权限。真正较早已中断轮次继续显示原结束状态，文件改动摘要不丢失。证明到达后用新事件投影替换，显示与精确线程/轮次的实际结果一致。

该显示确定性也穿过工具投影、命令归组与活动归组：纯显示 `RenderTermination = TurnStatus | "unverified"` 不进入协议、store 或持久化 schema。未独立结束的 MCP、Shell、压缩、搜索和图像活动暂时以中性提示呈现，不合成工具 interrupted、成功或持续旋转；工具自身已经明确 completed/failed 等状态仍保留。随后同一精确轮次实际终态可更新此前的临时投影，不能把 provisional 标记当成不可更新的 finalized。terminal UI 两红先转绿，工具合成 interrupted 另有真实红灯；14文件140项近邻通过（`/tmp/transcript-cached-tool-projection-broad-final2.log`，17.93秒），web tsc 实际退出0（`/tmp/transcript-ui-cursor-types-final.log`）。缓存读写/HTTP来源与真实浏览器时序由缓存专项单独记录，不能用这些 renderer 单测声称整个刷新链路已通过。


最新统一冻结 `http://10.30.0.24:43735`（0.0.0.0、2885文件、`frozen-1793314044395`）已将原页定位恢复、图片和关闭态依赖/反馈入口放在同一真实浏览器进程批次验证：**22/22通过，1.3分钟**（`/tmp/transcript-latest-cursor-tools-browser-final.log`，`.dev-runtime/session-mode-implementation-20261029/transcript/latest-cursor-tools-final/`）。其中四个CC/ACP×桌面/手机的原页核对在旧HTTP39311全部真实红灯，再在新源转绿，精确检查请求仍携带实际原cursor，0旧scope详情读、原草稿保持。反馈4项仍断言私有worker真实退出，关闭态2项没有提前加载可选编辑器/反馈模块。该冻结只提供隔离API/真实Chromium的专项证据，不等于真实账号、实体手机、全工作区最终整合或两秒p95。两台本次自有临时前端均按PID/start ticks核实后停止，未触碰native或正式服务。


## 冷进入 hooks 入口等待边界

`App.tsx` 现在直接导入 `hooks/useCodexEvents`，不再经 `hooks/index` 等待六个未调用模块（聚合入口、useIsProcessing/useNewThread/useScrollToBottom/useThreadFilter/useThreadList）。仅改这一条值导入，原聚合导出继续保留。移出的 hooks 在模块层没有必需 listener 或初始化；真实 `useCodexEvents(codexReady)`、输入 facade、设置同步和生命周期清理仍由原 App 挂载调用，不能以删初始化换速度。两种导入指向原具体模块，不新建 store 或 observer。

专项在旧 HTTPS44723 原冻结中持有 `useNewThread.ts` 响应，1440/393 两尺寸导航可见但正确 composer 均无法挂载；新 HTTP LAN `http://10.30.0.24:45897`（0.0.0.0，`frozen-1793315858652`，2885文件）两项均通过5.7秒。先真实编辑精确 `data-owner-thread="ux-0"` 草稿，再释放未使用模块并导入保留的公开入口，断言 hook/store 严格引用相等、原草稿保留、EventSource 仅一个、任务写入为零。日志 `/tmp/transcript-hook-entry-{red,green}.log`；该延迟依赖与身份检查不是两秒p95验收，也不把同批其他 shared 导入优化归到这一行。
