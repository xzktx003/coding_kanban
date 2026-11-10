# 会话模式 Codex 复刻缺口清单（2026-11-07，基准 26.51021.22027）

> 本文件**取代** `current-gap-inventory-20261103.md`（其对照旧基线 `26.51007.21434`）。
> 本清单以 **26.51021.22027** 为基准（解压、版本与资产钉定见
> [codex-26.51021.22027-reference-baseline-20261107.md](codex-26.51021.22027-reference-baseline-20261107.md)），
> 逐项核对 `apps/web/src/session-mode/components/codex` 的当前实现，产出“真实缺口”而非“重复开发已实现功能”。
> 结论：**当前实现已在组件/状态层面高度对齐；剩余工作以 E2E/像素验收为主，少数为宿主门控或项目特色保留。**

复核方法：读当前源码 + 组件单测 + 既有审计矩阵（`codex-client-audit-20261029/matrix.md` M01–M55 状态域、G01–G26、
CMP-36..39、T 项），并将证据分层。不把“已实现+已测”当作“已完成全量官方宿主验收”，也不把“已实现”再开发一遍。

## 0. 证据层级（沿用 matrix.md，不可跨越）

| 标记 | 可证明 | 不能证明 |
|---|---|---|
| O-S | 原包静态代码、版本、hash、存在状态/分支 | 分支可达、实际交互、性能、正确收尾 |
| O-C | 实际官方组件/导出在受控 reference 回放 | 官方扩展宿主、MessagePort、app-server、真实登录/运行 |
| O-N | 未改官方 CLI + 无登录隔离 loopback | 官方 VS Code UI、真实模型/账号、多 writer CAS |
| O-F | 完整官方 VS Code/code-server/extensionHost/webview/native 链路 | 未执行状态、版本/实例组合 |
| P-S | 当前项目源码与测试存在 | 当前实际通过、实际原组件配对、真实 native 写出 |
| P-C | 当前 HEAD 实际执行 | 未覆盖场景、原组件以外的完整官方宿主 |

同一"Native/参考"命名的 spec 可能只是 P-C（API fixture），不因命名升格为 O-N/O-F。

## 1. 覆盖概览

- 代码量：`apps/web/src/session-mode/components/codex` 下 **318** 个非测试 `ts/tsx`，**292** 个测试文件。
  - composer 118 / items 51 / thread 47 / presentation 53 / widget 3 / hooks 9 / stores 9。
- 本次组件测试运行（`vitest run`，jsdom，maxWorkers=2）：**292 文件，1976 用例，1969 通过 / 7 失败**。
  - **失败样本复核（2026-11-07 单文件隔离复跑）**：
    - `ThreadList.performance.test.tsx`：单独复跑 **5/5 通过** → 确认为共享主机并发/时序不稳的 flaky，**非 parity 缺口**。
    - `AgentMessageItem.streaming-regression.test.tsx`：单独复跑 **2/4 失败且确定性**（两个 streaming 文件引用用例）→ **不是 flaky**，是真实 parity 缺口：
      **流式 live-tail 路径（`LiveMarkdownTail`/`inlineText`）未把 `:codex-file-citation{...}` / `【…†L8】` 渲染成 `NativeFileCitationPill`，而是渲染成原始文本**；等消息稳定后走 `CodexMarkdown` 才变成 pill。这造成“流式中文件引用显示为纯文本，settle 后突变为 pill”的行为不一致，与官方插件不符。已派 `implementer` 修复（先红后绿）。
      - **✅ 已修复（t6，implementer）**：`LiveMarkdownTail` 在渲染前复用 `parseNativeFileCitations`/`NativeFileCitationPill` 把 `:codex-file-citation{...}` 与 `【…†L8】` 解析为 `.native-file-citation` pill（文案/图标/打开行为与稳定 `CodexMarkdown` 一致，via 共享 `useNativeFileCitationOpen`）；跨流式段边界由 `parseLiveBlocks` 的 `pending+current` 重组后仍正确渲染；不整段 join 大流、无界 DOM 不变，live-tail 仍是有界的 `state.pending + current`。测试证据：`AgentMessageItem.streaming-regression.test.tsx` 单独复跑 **4/4 通过**（`keeps a rendered file citation over both stream budgets` 两个参数化用例 + `keeps a file citation whose directive is split at a segment boundary` + bounded preview）；`presentation` 全量 **53 文件 / 271 用例通过**；`native-citations` **4 文件 / 45 用例通过**；`pnpm --filter web exec tsc --noEmit` 0 类型错误。
      - **✅ 边界补齐（t12，implementer）**：当引用指令（`:codex-file-citation{...}` / `【…†L8】`）被 `**粗体**` 整体包裹时，t6 的 `inlineTokens` 让 strong token 覆盖引用 → strong 内保留字面（流式显示原始文本、settle 突变 pill），与稳定 `CodexMarkdown`（`<strong><NativeFileCitationPill/></strong>`）不一致。t12 修正 `renderLiveText`：命中 `strong` token 时对 strong 内层递归分别渲染，使嵌套其内的引用成为 `strong` 内的 pill，词边界（`**前缀 引用 后缀**`）与跨流式段边界仍正确；`code` 内引用仍按 `CodexMarkdown` 保持字面。先红后绿：新增 `presentation/liveMarkdownTail.test.tsx`（4 用例：嵌套于强调内、词边界、跨段边界 ×2 引用形式），先**红**（strong 内渲染原始文本）后转**绿**。测试证据：`AgentMessageItem.streaming-regression.test.tsx` 4/4、`presentation` 全量 **54 文件 / 275 用例通过**、`native-citations` 4 文件 / 45 用例通过、`pnpm --filter web exec tsc --noEmit` 0 类型错误。
  - 其余失败样本复核后按结论归类：用户可见行为差异 → 进入 §4.1 待验收/本缺口；纯时序 flaky → 标注非 parity 缺口。
- 官方基准 26.51021.22027 相对 26.1021.22027 仅变更入口/懒加载 chunk 名（t1 核验），
  共享 app-initial/rolldown/compiler/message-bus/vscode-theme/core/zh-CN 字节不变，功能面基本不变。
  - 原包提供：`index-*.js`（app 入口）、`app-main-*.js`（initializeApp）、`thread-goal-side-panel-content-*.js`
    （`ThreadGoalSidePanelTab`）、`composer-content-*.js`（`ComposerContent`/`Composer`）、
    `widget-renderer-*.js`、`core-*.js`、`zh-CN-*.js`。参考夹具以 `native-app.html` app harness 驱动。

## 2. 四大关注面逐项现状

### 2.1 composer（`components/codex/composer/`）

| 子域 | 实现入口（非测试） | 关键测试 | 现状 |
|---|---|---|---|
| 输入/提交 | `Composer.tsx`、`ComposerEditor.tsx`、`submitIntent.ts`、`imeSubmitKey.ts` | `ComposerEditor.external-sync`、`submitIntent`、`imeSubmitKey` | **已实现**：文字/附件/IME 安全提交、Shift+Enter 续行、`isComposing`/keyCode 229 不误发 |
| 运行态动作 | `composerPrimaryAction.ts`、`NativeSubmitButton.tsx` | `composerPrimaryAction`、`NativeSubmitButton` | **已实现**：运行中 active→Stop，queue 时→Queue/Steer；空/非空草稿区分 |
| 队列 | `FollowupQueue.tsx`、`FollowupQueue`、`queuePreviewText.ts`、`QueueReorder.tsx`、`QueueMessagePreview.tsx` | `FollowupQueue.*`（plugin/preview/recovery/sort/tooltips）、`QueueReorder`、`QueueMessagePreview.*`、`queuePreviewText` | **已实现**：原生指针排序、六点悬停手柄、预览、恢复、reorder；true/false 精度 |
| 队列设置提示 | `NativeQueueSettingsNotice.tsx` | `NativeQueueSettingsNotice` | **已实现** |
| 审批门控（发送前） | `conversationOwnerFormContext.tsx`、`useNativeUltraEffortCommit.ts`、`ultraFullAccessGate.ts`、`AccessModePopover.tsx`、`NativeFullAccessConfirmation.tsx`、`NativeUltraFullAccessConfirmation.tsx` | `AccessModePopover.*`、`ModelReasonSelector.ultra-full-access`、`ultraFullAccessGate` | **已实现**：完整访问下 ultra 先发问；确认前不写入；三出口（保持完整访问/先降权/取消） |
| 模型选择 | `NativeModelSelector.tsx`、`NativeModelTrigger.tsx`、`ModelReasonSelector.tsx`、`ReasoningEffortSelector.tsx`、`NativePickerEffortProjection.ts`、`nativePowerWheel.ts` | `NativeModelSelector.*`（40+）、`NativeModelTrigger.*`、`nativePicker*`、`nativePowerWheel` | **已实现**：菜单展示广告强度（max/ultra）、keyboard、effort filter、completion tooltip、nonmodal、preferences 集成 |
| 菜单/会话动作 | `ComposerMenu.tsx`、`ConversationMenu.tsx`、`ConversationOwnerForms.tsx`、`DeferredConversationMenu.tsx`、`SlashCommandsSelector.tsx` | `ComposerMenu.*`、`ConversationMenu.*`、`slashCommands.*` | **已实现**：+/会话操作收纳、owner forms、slash commands、draft render、attach |
| 附件/绘图/文件搜索 | `composerDrop.ts`、`ScreenshotPopover.tsx`、`FileSearchSheet.tsx`、`v2/ContextAttachments.tsx`、`v2/DrawingEditor.tsx`、`v2/drawingTool.ts` | `composerDrop`、`ComposerMenu.attach`、`ContextAttachments`、`DrawingEditor.storage`、`drawingTool`、`drawing` | **已实现**：粘贴/上传图片、缩略图、上传状态/失败重试、绘图 |
| 展开编辑器 | `v2/ComposerSheet.tsx`、`v2/RichDraftEditor.tsx`、`v2/drafts.ts`、`v2/draftStorage.ts`、`v2/selectionAnnotations.ts` | `RichDraftEditor`、`drafts*`、`draftStorage`、`selectionAnnotations`、`selectionAnnotationDrafts` | **已实现**：展开编辑、选区批注、上下文快照、草稿事务/多页 |
| 悬浮 rail（运行/问题/队列/Goal 汇总） | `ComposerRail.tsx`、`ComposerRailIcon.tsx`、`RunningTurnChanges.tsx`、`SideChatPanel.tsx` | `ComposerRail.*`、`ComposerRailIcon.native`、`RunningTurnChanges`、`SideChatPanel.*` | **已实现**；外层定位为**项目特色**（半透明悬浮，见 §3.3） |
| 听写 | `DictationButton.tsx`、`DictationPopoverContent.tsx` | （真实会话听写入口在；starting 态非 disabled 且点击取消） | **已实现** |
| 会话内查找 | `SearchChatsSheet.tsx`、`thread/threadFindKeys.ts`、`thread/turnNavigation.ts`、`thread/threadSearchHighlight.ts` | `SearchChatsSheet`、`threadFindKeys`、`turnNavigation`、`threadSearchHighlight` | **已实现** |

### 2.2 transcript / items（`components/codex/thread/` + `components/codex/items/`）

| 子域 | 实现入口 | 关键测试 | 现状 |
|---|---|---|---|
| 空态 | `thread/CodexTranscript.tsx`、`thread/deriveRenderItems.ts`、`thread/threadRows.ts` | `threadRows.empty` | **已实现**：无关注/无消息可操作、不隐式新建 |
| 加载态 | `thread/CodexTranscriptPreparing.tsx` | （含失败态） | **已实现**：`正在准备完整消息视图…` / 失败提示+保留近期正文草稿 |
| 历史错误/重试 | `thread/CodexHistoryNotice.tsx`、`thread/CodexAccessNotice.tsx`、`thread/CodexSystemRecords.tsx` | `CodexHistoryNotice`、`CodexAccessNotice`、`CodexSystemRecords` | **已实现**：真实 503 错误、重试 once、history warning 因果 |
| 消息行投影 | `thread/threadRows.ts`、`thread/projectTranscriptItems.ts`、`thread/deriveRenderItems.ts`、`thread/turnWork.ts` | `threadRows.*`（delivery/empty/failure/hooks/metadata/projection/spacing/subagents/terminal-reconciliation）、`projectWorkflowRows.*`、`turnWork.*` | **已实现**：按 turn/item 投影、hiddenMethods、端到端 8Ki 字符分段的原生文件引用 |
| 消息项（用户/助手/工具/审批/plan） | `items/AgentMessageItem.tsx`、`items/UserMessageItem.tsx`、`items/ApprovalItem.tsx`、`items/ElicitationItem.tsx`、`items/RequestUserInputItem.tsx`、`items/TurnPlan.tsx`、`items/PermissionsItem.tsx` | `AgentMessageItem.*`（latest-actions/memory/native/review/streaming/visualize）、`UserMessageItem.*`、`ApprovalItem.*`、`ElicitationItem.native`、`RequestUserInputItem.*`、`TurnPlan.native`、`PermissionsItem` | **已实现**：渐进 Markdown、commentary latest/all、approval、提问、plan、权限 |
| 工具项 | `items/ShellCommand.tsx`、`items/CommandActionItem.tsx`、`items/CommandActionSummaryItem.tsx`、`items/McpToolCallItem.tsx`、`items/CollabAgentToolCallItem.tsx`、`items/NativeDynamicToolItem.tsx`、`items/NativeToolDisclosure.tsx` | `ShellCommand.*`、`CommandActionItem.*`、`CommandActionSummaryItem.native`、`McpToolCallItem.*`、`NativeDynamicToolItem`、`NativeToolDisclosure` | **已实现**：有界命令输出、显式展开、退出码/停止/未知状态、MCP App、动态工具媒体 |
| 文件变更 | `items/IndividualFileChanges.tsx`、`items/SummaryFileChanges.tsx`、`items/ThreadFileChangesSummary.tsx`、`items/fileChangeLogic.ts`、`items/fileChangeUtils.ts` | `IndividualFileChanges.*`、`fileChangeLogic.owner`、`ThreadFileChangesSummary.*` | **已实现**：diff 卡片、行号、+N -N、复制、展开/详情未加载 |
| 子 Agent / 压缩 / 记忆引用 | `items/NativeActivityGroup.tsx`、`items/NativeActivityItem.tsx`、`items/NativeCompactionItem.tsx`、`items/NativeMemoryCitations.tsx`、`items/NativeHookStats.tsx`、`items/NativeSystemNotice.tsx` | `NativeActivityGroup`、`NativeActivityItem`、`NativeCompactionItem`、`NativeMemoryCitations`、`NativeHookStats`、`NativeSystemNotice` | **已实现**（子 Agent 只读观察、压缩、hook、系统通知） |
| 轮次头部/收尾 | `thread/TurnWorkHeader.tsx`、`thread/TurnWorkHeader.waiting`、`items/TurnFailureNotice.tsx`、`items/RunningTurnChanges.tsx` | `TurnWorkHeader.*`、`TurnFailureNotice.*`、`RunningTurnChanges` | **已实现**：轮次状态、失败原因/重试 |

### 2.3 presentation（`components/codex/presentation/`）

| 子域 | 实现入口 | 关键测试 | 现状 |
|---|---|---|---|
| 渐进 Markdown | `presentation/StreamingCodexMarkdown.tsx`（+ `liveMarkdownTail.tsx`、`prepareStreamingMarkdown.ts`） | `StreamingCodexMarkdown.*`（live/regression）、`prepareStreamingMarkdown` | **已实现**：流式正文渐进渲染、最终全文补齐、Live tail |
| Markdown 语义 | `presentation/CodexMarkdown.tsx`、`DeferredCodexMarkdown.tsx`、`fileReference.ts`、`codexCode.ts`、`nativeToolMessage.ts` | `CodexMarkdown.*`（citations/file-links/hotline/images/native/normalization/typography）、`DeferredCodexMarkdown`、`fileReference`、`codexCode`、`nativeToolMessage` | **已实现**：引用/文件链接/图片/行内代码/转义/工具消息 |
| 代码围栏/高亮 | `presentation/NativeCodeFence.tsx`、`presentation/nativeFenceHighlight.ts`、`presentation/codexCode.ts` | `NativeCodeFence.*`（svg/tooltip）、`nativeFenceHighlight` | **已实现**：浅/深主题 token 色、SVG、复制、折叠、144px 滚动 |
| 图片/媒体 | `presentation/CodexImage.tsx`、`presentation/CodexMarkdownImage.tsx`、`presentation/NativePreviewImage.tsx`、`presentation/nativeImageGalleryLayout.ts`、`presentation/nativeImageFailure.ts`、`presentation/chatImageSource.ts` | `CodexImage.failed`、`CodexMarkdown.images`、`NativePreviewImage`、`nativeImageGalleryLayout`、`nativeImageFailure`、`chatImageSource` | **已实现**：放大/下载、额度失败卡、图库布局 |
| 丰富预览 | `presentation/NativeGithubPreview.tsx`、`presentation/NativeSlackPreview.tsx`、`presentation/NativeWebsitePreview.tsx`、`presentation/NativeRichPreviewBody.tsx`、`presentation/NativeTextPreview.tsx`、`presentation/NativeMermaidFence.tsx`、`presentation/nativeMath.ts`、`presentation/NativeMarkdownTable.tsx` | `NativeGithubPreview`、`NativeSlackPreview`、`NativeWebsitePreview`、`nativeMath`、`NativeMarkdownTable.*`、`nativeMermaidTheme` | **已实现**：GitHub/Slack/website/text/diagram/table/math 预览 |
| 工具语义/图标 | `presentation/nativeToolSemantics.ts`、`presentation/nativeDynamicToolSemantics.ts`、`presentation/nativeDynamicToolTarget.ts`、`presentation/nativeToolLabels.ts`、`NativeToolIcons.tsx`、`NativeDynamicToolIcon.tsx` | `nativeToolSemantics`、`nativeDynamicToolSemantics`、`nativeDynamicToolTarget`、`nativeToolMessage`、`ToolContent.native` | **已实现**：工具语义/图标/文案、MCP 活动登记 |
| 剪贴板/复制 | `presentation/nativeMarkdownClipboard.ts`、`presentation/nativeMessageClipboard.ts`、`presentation/nativeTableClipboard.ts` | `NativeMarkdownClipboard.http`、`nativeMessageClipboard`、`nativeTableClipboard` | **已实现**（HTTP 复制边界） |

### 2.4 悬浮 / 导航层

| 子域 | 实现入口 | 关键测试 | 现状 |
|---|---|---|---|
| 输入区悬浮提示栏 | `composer/ComposerRail.tsx`、`composer/ComposerRailIcon.tsx`、`composer/RunningTurnChanges.tsx` | `ComposerRail.*`、`ComposerRailIcon.native`、`composer-floating-rail` spec | **已实现**；外层定位为**项目特色**（半透明悬浮，见 [composer-floating-rail-20261102.md](composer-floating-rail-20261102.md)） |
| 菜单层生命周期 | 会话菜单/面板（`ConversationMenu`、`ComposerMenu`、`NativeModelSelector`） | `ConversationMenu.parent-lifetime`、`session-menu-layer-lifecycle` | **已实现**：菜单关闭/父级生命周期、不串输入 |
| 项目/目录/工作环境选择器 | `composer/ComposerTargetMeta.tsx`、`composer/ConversationMenu.tsx`、`common/WorkspaceSwitcher.tsx` | `ComposerTargetMeta`、`ComposerFooterLabel.controls/collapse` | **已实现**（branch 仅绑定 git worktree 时显示） |
| 导航/主题 | 外壳与 Codex 编辑器同色；会话/终端共用模式切换 | `WorkbenchModeSwitch`、session-navigation-a | **已实现**：`#20211d/#282a23/#ccc`，浅色对应，可一键切换 |

## 3. 状态差异清单（空态/加载/消息/工具/审批/队列/菜单）

> 状态列 `实现`：组件/P-C 级已实现并有测试；`验收`：需 E2E/像素（t3）或完整宿主 O-F 复验；`门控`：宿主/授权；`特色`：项目有意保留。

| 状态域 | 具体状态 | 定位 | 实现入口 | 状态标记 |
|---|---|---|---|---|
| 空态 | 空白工作台（无关注会话，无隐式新建） | 项目 | `ThreadList`/`threadRows.empty` | **已实现待验收** |
| 空态 | 官方空白新线程（未发送 UUID、独立草稿、刷新同目标） | 宿主 | `codex-refresh-newchat-*`（官方宿主 O-F） | **宿主门控** |
| 加载 | 历史/消息加载中 | 项目 | `CodexTranscriptPreparing` | **已实现待验收** |
| 加载 | 历史加载失败/重试 | 项目 | `CodexHistoryNotice` | **已实现待验收** |
| 消息 | 流式 assistant 增量+最终合并一行、无闪失/重复 | 项目 | `StreamingCodexMarkdown` | **已实现待验收** |
| 消息 | 万/十万级交错事件有界、序号不丢、最新可见 | 项目 | `threadRows`/`deriveRenderItems` + 内存 governor | **已实现待验收**（真实长时流/自然GC O-F 仍 U） |
| 消息 | 空/未知 item 的 raw-JSON fallback | 项目 | `threadRows.metadata` | **已实现**（真正未知协议端到端触发为边界） |
| 工具 | 命令输出有界、显式展开、完成/失败/停止/未知 | 项目 | `ShellCommand` | **已实现待验收** |
| 工具 | MCP App / 动态工具媒体 / 压缩语义 | 项目 | `McpToolCallItem`/`NativeDynamicToolItem` | **已实现待验收** |
| 审批 | pending 审批（精确 thread/turn/item/request/token、全部按钮可达） | 项目 | `ApprovalItem` | **已实现待验收**（E2E 为 API fixture，见 §0） |
| 审批 | 两客户端竞争同一审批（仅一次 accept、旧请求 409） | 宿主/运行层 | `session-approval-multiclient/acceptance.py`（O-N） | **宿主门控** |
| 审批 | 审批失败保留可重试、已 resolve/过期不得迟到提交 | 项目 | `ApprovalItem`/`RequestUserInputItem` | **已实现待验收** |
| 队列 | 排序/预览/重排/恢复/未见 ACK 不重发 | 项目 | `FollowupQueue`/`QueueReorder` | **已实现待验收** |
| 菜单 | 会话动作/owner forms/slash commands | 项目 | `ComposerMenu`/`ConversationMenu` | **已实现待验收** |
| 菜单 | 模型菜单（强度/max/ultra/keyboard/effort filter） | 项目 | `NativeModelSelector` | **已实现待验收** |
| 菜单 | 权限/访问模式/完整访问门 | 项目 | `AccessModePopover`/`NativeFullAccessConfirmation` | **已实现待验收** |

## 4. 分类结论

### 4.1 已实现待验收（不做再次开发，接入 t3 像素 diff / 真实 E2E 验收）

- composer：提交/IME/运行态动作/队列/审批门/模型选择/附件绘图/展开编辑/会话查找（§2.1）。
- transcript/items：空态/加载/消息/工具/审批/plan/文件变更/子 Agent/压缩（§2.2）。
- presentation：渐进 Markdown/代码围栏/图片媒体/丰富预览/工具语义/剪贴板（§2.3）。
- 悬浮/导航层：输入区悬浮提示栏（项目特色定位除外）、菜单层、工作环境选择器、主题（§2.4）。
- 证据：292 测试文件 / 1976 用例（1969 通过），上述各入口均有对应测试。

### 4.2 宿主门控（需要宿主能力/授权，记录为阻塞/条件差异，不冒充实现）

> 2026-11-07 在隔离 code-server 原型 + 官方 VSIX 26.51021.22027 + 仅显式 `--shared-codex-home` 授权账号复用下逐项评估，
> 结论详见 [host-capability-assessment-20261107.md](host-capability-assessment-20261107.md)。宿主桥仅 open/restore/release/status + 发送桥；
> grep `ide-context`/`ideContext`/`worktree`/`branch`/`local-env`/`environment`/`voice`/`realtime` 无命中 → 无这些 host API。

| 项 | 评估结论 |
|---|---|
| **G01** IDE 自动上下文 | **阻塞**：`/ide` 已移除，无 `ideContextStatus` 来源，宿主桥缺失。 |
| **G20 / CMP-36** local/worktree 新聊天 | **条件差异/部分可行**：项目有 `forkSlashWorktree`/`gitCreateWorktree`/`runLocalEnvironment` 可复用；但主 Codex composer 无官方 `composerMode` run-location 选择器，需先证官方 `ide-context` flag。 |
| **CMP-37** worktree toggle | **条件差异**：无 `composer.toggleWorktreeMode`；官方 flag 可能隐藏。 |
| **CMP-38** local env dropdown | **条件差异/部分可行**：`runLocalEnvironment` 已有；缺 dropdown/`workspaceKnown`/设置页跳转；需确认桌面 workspace flag 是否 VSCode 启用。 |
| **CMP-39** branch dropdown | **条件差异**：`BranchSwitcher` 在 AgentComposer 层，非官方 `hostId:cwd/follower/readOnly` 语义；是否迁入由 review 决定。 |
| **CMP-51** Realtime voice | **阻塞/门控**：项目侧 `RealtimeVoiceButton`/`ThreadRealtime` 存在，但 `nativeRealtimeWebRtcSupported` 验证集仅 `{0.163.0,0.165.0}`，扩展自带 CLI `0.164.0-alpha.11.1` 不在集内 → 运行层拒绝；且官方 feature/auth/host+remote unsupported 门控需真实账号。 |
| **G24** 未知协议端到端复现 | `hiddenMethods` 覆盖 `thread/*`；未知 item 走 raw-JSON fallback 已实现；真正未知协议方法端到端触发属边界。 |
| **G26 / M54 / M55** 刷新与并发发送 ≤2s 性能 | 需真实宿主/长测；历史红样本保留。 |
| **M02/M03/M21/M31/M32/M33** 官方宿主刷新/中断/新聊天生命周期 | O-F，需显式自有夹具。 |
| **M15/M16** 多独立 writer 审批 CAS | O-N，需隔离 loopback provider。 |

> **对 t3 像素 diff 的边界**：G20/CMP-36..39 的未实现官方控件属「宿主门控/条件差异」，
> 不应为了像素对齐把项目既有 `WorkspaceSwitcher`/`BranchSwitcher`/`fork` 全量替换成官方不可达控件；
> 这些作为 t3 的排除项记录，不进入 UI 逐像素对齐目标。

> **跨状态像素 diff 复核（2026-11-07，t7）**：隔离官方 webview 的**同状态交叉像素 diff（goal card/composer/thread item/queue rail）
> 未能打通**。根因：官方 webview 是完整 ChatGPT webview（路由/账号/线程生命周期），单发 `initialize`/`identity`/`thread/*`/`model/settings`
> 无法把 loader 推进到主界面，需模拟真实宿主 `MessagePort` + `vscode.getState()/setState()` 级完整驱动——属**专项多轮 RE**；
> 且新版 chunk 导出为不透明 minified 标识符（t5），无法静态重绑 goal/transcript 参考夹具。逆向发现已记录
> [official-webview-host-drive-findings-20261107.md](official-webview-host-drive-findings-20261107.md)。
> 因此 host 驱动打通前：t3 像素 diff 仅覆盖官方 **boot shell** 基线 + 本地 shell 对照；
> 4 个参考用例（session-goals-reference / session-goals-completion / session-goal-control-styles-reference /
> session-current-transcript-reference）保持「未设 `CODEX_GOAL_REFERENCE_URL` 即跳过」，不计为通过；
> 组件级/O-C 记录不等于跨状态像素 parity 已达成。**真实登录 Playwright（O-F）是当前可独立完成的验收路径**。

### 4.3 项目特色保留（不是缺口，不做像素/几何对齐，仅核对原生行内容与交互）

- 输入区悬浮提示栏（`composer-floating-rail`：有意改为半透明悬浮、背景与附着布局不同，用户要求）。
- 跨设备关注标签、关闭标签不停止 Agent。
- 归档显式生命周期与中文 toast、`append undo/redo` 看板 pin vs 原生 pin 的差异。
- 未读写 attention store 的非原生 read-state（保留看板注意力语义）。
- 模型目录未知不伪造、拒绝未知权限。
- 内存保护（接收前裁剪/有界流式/32MiB 16MiB/60s 回收/高堆回收）。
- 手机适配（Return 换行、固定高度、compact shelf、44px 触控）。
- 项目选择与关注标签联动（看板特有）。

## 5. 结论

1. **主体是“验收已实现功能”而非“开发”**：composer、transcript/items、presentation、悬浮/导航层在
   26.51021.22027 基准下的状态差异绝大多数已有组件实现与测试（1969/1976 用例通过），
   待办主要是 **t3 像素 diff / 真实 E2E 验收** 与补充证据，而不是重写。
2. **真实新开发空间有限**：集中在“宿主门控”子集（§4.2）与少数待复验的交互细节。
3. **证据分层必须保留**：不能把组件级 P-C/O-C 绿当完整官方宿主 O-F 绿；t3 隔离官方 webview 像素 diff +
   真实登录 Playwright 双轨验收是唯一能上推 O-F 的路径。
4. **本批次已复核更新的点**（相对 11-03 清单）：基线从 26.51007.21434 升到 26.51021.22027；
   悬浮提示栏/项目选择器/审批门/模型菜单/工具语义等按当前源码与测试重新确认处于“已实现”；
   明确列出 7 个组件测试失败样本作为证据边界（非 parity 缺口）。

## 6. 真实登录 Playwright 验收（O-F，t8）—— 已通过 / 仍阻塞 分界

> 2026-11-07 t8 以**真实登录**驱动 `https://10.30.0.26:8484` 会话模式 Codex 复刻逐状态截图与结构核对。
> 完整记录见 [session-mode-live-oauth-acceptance-20261107.md](session-mode-live-oauth-acceptance-20261107.md)。
> 验收入口 `tests/e2e/session-mode-codex-live-acceptance.spec.ts`；证据 `tests/test-results/session-mode-codex-live-oauth/`。
> 只读：未读取/输出登录令牌或会话正文；未发送任何 prompt（无 `turn/start|interrupt|steer`）。

### 6.1 真实确认通过（O-F 可见证据）
| 状态 | 证据 |
|---|---|
| 悬浮/导航层（顶部导航、模式切换、会话标签） | `00-navigation-layer.png`；`topNav=1 modeSwitch=5 leftSidebar=0 sessionTabs=3`（项目会话侧栏该证据运行未单独确认，见下） |
| composer 空态（`session-composer-form` + `[contenteditable]`） | `02-composer-empty.png`（form=1 input=1） |
| composer 输入态（填入草稿渲染，未发送） | `03-composer-input.png` |
| composer 审批/权限门（`执行权限`/`完全访问` 选择器） | `04-composer-queue-approval.png`（accessModeButton=1） |
| 转写区空态（`.session-welcome`「开始一个会话」） | `05-transcript-empty.png` |
| 转写区消息（打开真实线程，`[data-message-author]`） | `06-transcript-messages-{0,1,2}.png`（前 3 个含消息线程截图）；t13 扩展后 scanned=40 范围内观察到 `[data-message-author]`（消息图按上限 3 张留证） |
| presentation 渐进 Markdown（`[data-streamdown]`=47） | `12-presentation-markdown-*.png` |
| presentation 代码围栏（`pre`，=3） | `11-presentation-code-fence-*.png` |
| 扫描范围（项目分组展开 + 加载更多历史） | `scan-scope`（rows=82 exposed，scanned=40，跨项目/更旧历史）；t13 扩展 |

### 6.2 仍阻塞 / 未在本次采样会话中出现（不冒充已通过）
| 状态 | 结论 |
|---|---|
| 项目会话侧栏（已关注项目/会话列表） | **not-present**：该证据运行 `leftSidebar=0`（`.session-sidebar-projects`/`.session-project-sessions` 等未命中），未单独捕获侧栏截图；导航层通过仅基于 `topNav=1 modeSwitch=5 sessionTabs=3` |
| composer 队列（follow-up 队列列表） | **host-gated**：本次会话无排队 follow-up（`queue=0`），需活动中排队状态 |
| presentation 流式 live-tail（进行中 turn） | **pass（O-F，2026-11-08 14:52:18Z）**：页面内观察器在真实只读轮次中锁存 `liveMessage=1 liveTail=1 streamingText=1`，可见 3165 ms、采样 138 次；`streamdown 0→19`。早先 700 ms DOM 轮询加流式期间截图错过了完成后即移除的节点，不能再记为宿主门控 |
| 转写区加载（历史准备/提示指示） | **not-present**：打开线程后未捕获到 `codex-transcript-preparing`/history 提示（快速加载/已在缓存，瞬时态）；对应加载组件有单测 |
| 转写区工具（命令/工具项） | **pass（O-F，2026-11-08 14:52:18Z）**：同一真实只读轮次结算后 `toolItems=1`。早先历史扫描和误判为未送达的轮次不能覆盖这次直接 DOM 证据 |
| 转写区 plan | **not-present（O-F，2026-11-08 14:52:18Z）**：已送达真实轮次的 `planItems=0`；本轮没有可渲染 plan，不能记为宿主未送达 |
| 转写区文件变更 | **not-present（O-F，2026-11-08 14:52:18Z）**：已送达真实轮次的 `fileChanges=0`；只读操作没有产生文件变更 |
| presentation 引用 pill | **not-present**：rows=82/scanned=40 下 `citations=0`（`.native-file-citation`）；流式/稳定引用 pill 组件行为已由 `AgentMessageItem.streaming-regression.test.tsx`（t6 修复，4/4）锁定，另 t12 补齐「引用被 `**粗体**` 包裹时 strong 内渲染 pill」边界，实时线程未出现文件引用指令 |

### 6.3 与 §4.2 宿主门控的关系
G01/G20/CMP-36..39/CMP-51 仍按 §4.2 记录为宿主门控/条件差异，**未**被本验收标记为已通过；
本验收仅确认真实登录下**挂载/空态/输入/权限门/真实线程消息/渐进 Markdown/代码围栏**这几类的可见渲染。

### 6.4 其余状态的证据分层复核（O-C vs O-F）
为把 live-tail / tool / plan / file-change / 引用 pill 的**渲染 parity**（O-C）与**真实登录可见性**（O-F）分开记录，本轮复核结论：
- **O-C（渲染 parity）已验证**：这些状态均有绿组件测试 / 受控回放——`ShellCommand.native/copy/detail.test.tsx`、`TurnPlan.native.test.tsx`、`IndividualFileChanges.native/copy.test.tsx`、`StreamingCodexMarkdown.live.test.tsx`（3 用例）、`StreamingCodexMarkdown.regression.test.tsx`（11 用例）、`liveMarkdownTail.test.tsx`（4 用例），以及既有 `session-codex-command/activity/citations/markdown-reference.spec.ts` 受控对照回放。
- **O-C 受控回放对** **新基线 26.51021.22027** **不可用（再次印证 t5/t7）**：上述 `*-reference.spec.ts` 硬编码**旧基线** chunk 名（`app-initial-e98b9eaef8e3.js`、`app-initial-3192ac99b6cd.js`），而新基线资产只有 `app-initial-13f932cb2f13.js`（旧名 count=0，已核对 absent）。因新 webview chunk 导出为**不透明 minified 标识符**（t5），无法静态重绑定参考夹具，故新基线的 O-C 对照回放受阻。
- **O-F（真实登录可见）**：2026-11-08 14:52:18Z 的只读新轮次已直接看到 streaming live-tail 与一个 tool item。plan 与 file-change 在该轮次仍是 `not-present`，不能从其他历史轮次外推为本轮已渲染。 |
- 结论：**渲染 parity（无论 O-C 单测还是受控回放）与真实登录可见性分开评估**；仅「真实登录下可驱动」这一维度受限，**不代表渲染本身有差异**。
