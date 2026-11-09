# 原包静态候选 28–54：旧会话模式只读对照

仓库根目录：`/data01/home/xing.hu/vibe_codings/coding_kanban`。编号对应 `docs/designs/chatgpt-desktop-mode-20261103/original-static-features.md` 按出现顺序的 `##` 条目。原包标签与文案仅是静态候选；以下是本次对旧会话模式工作树静态取证，不代表第三方程序动态行为、正式服务版本或第四模式实现。仓库存在并发修改，行号按本次读取时的工作树。未操作正在运行的会话、桌面安装包或生产浏览器。

## 28 插件包括应用、MCP、hooks 与组织禁用 — 部分

- 旧模式证据：`apps/web/src/session-mode/features/plugins/components/PluginDetailView.tsx:66` 提取 hooks/MCP；`:182` 展示 Apps；`:189` 展示 MCP；`:214` 展示 hooks。`docs/designs/session-mode-implementation-20261029/plugins.md:3` 记录协议策略来源。
- 边界：真实组织禁用/管理员 badge 的完整映射、hook 执行政策及当前账号效果未经本次验证；历史文档明确真实组织策略未验（同文 `:54`）。

## 29 MCP stdio / streamable HTTP 配置 — 部分

- 旧模式证据：`apps/web/src/session-mode/features/mcp/McpServerForm.tsx:9`、`:44`、`:106` 定义 stdio/http/sse、配置输入和可填 Authorization header；`CodexMcpView.tsx:75` 构造并保存对应配置。
- 边界：UI 中的 `http` 标签不单独证明与原包所有 streamable-HTTP 功能、密钥存储和传输行为等价；未连真实服务器。

## 30 MCP 连接、启用、OAuth 注册策略 — 部分

- 旧模式证据：`apps/web/src/session-mode/features/mcp/McpServerCard.tsx:86` 按协议区分授权；`:197` 发起 OAuth；`:225` 处理启用。`docs/session-mcp-auth.md:3` 说明捕获身份和完成回执。
- 边界：未见原包自动/CIMD/DCR 注册策略完整 UI 的直接证据；真实 OAuth、所有服务兼容和账户权限未验。

## 31 终端连接、断开、重新打开及 cwd 提示 — 部分

- 旧模式证据：`apps/web/src/session-mode/features/terminal/TerminalPane.tsx:58` 使用工作目录，`:72` 注释一次性命令不因重连重跑，`:245` 重连，`:325` 提示断线；`TerminalPanel.tsx:74` 明示关闭会结束对应终端。
- 边界：未对照 Mac 原包 cwd 警告、重启/断线全部状态，也未验证远端 SSH 终端归属。

## 32 聊天旁标签打开终端、浏览器等 — 部分

- 旧模式证据：`apps/web/src/session-mode/components/layout/RightPanelHeader.tsx:40` 定义变更、VS Code、终端、浏览器、文件等工具标签；`RightPanel.tsx:163` 和 `:193` 挂载终端及网页预览。
- 边界：结构是旧模式右侧工具面板，非已证实的原包逐项布局或插件标签；第四模式未实现。

## 33 内置浏览器设备模拟和扩展管理 — 明确差异

- 旧模式证据：`apps/web/src/session-mode/features/web-preview/WebPreview.tsx:28` 创建 HTTP(S) 预览，`:135` 使用 iframe；`RightPanel.tsx:193` 挂载预览。
- 边界：这是 iframe 预览，不能视为原生浏览器、设备模拟或扩展管理。对旧模式 `siteTools|deviceToolbar|browser.*extension` 的有界源码搜索未见对应完整实现，非全仓及全部运行态的否定证明。

## 34 网站工具的读/写分类与近期使用 — 未核实

- 旧模式证据：`apps/web/src/session-mode/features/web-preview/WebPreview.tsx:135` 仅证明网页 iframe；`features/mcp-apps/McpAppView.tsx:33` 展示普通 MCP App 生命周期，两者不能证明网站工具。
- 边界：对旧会话模式 `webMcpTools|siteTools|deviceToolbar` 有界搜索未见对应实现；原包文案也不证明工具真正执行。待检验权限和真实协议。

## 35 完成、审批、提问提醒和系统权限 — 部分

- 旧模式证据：`apps/web/src/session-mode/components/codex/hooks/useServerNotificationHandler.ts:466` 触发完成通知，`:587` 处理新问题到达；`apps/web/src/session-mode/lib/notify.ts:20` 使用浏览器/Tauri 通知并在 `:42` 提供浏览器通知授权。
- 边界：问题到达的页面提示不等于每类审批/提问均有系统通知；未对照原包各模式、OS 授权与后台实际效果。

## 36 自定义音效大小/时长限制 — 未核实

- 旧模式证据：`apps/web/src/session-mode/utils/beep.ts:24` 为程序化提示音，`:58` 为空闲资源释放；`useServerNotificationHandler.ts:474` 依据模式触发。
- 边界：本次未找到等价的自定义音频导入、大小/时长校验和持久化证据；不将固定提示音等同于文件音效功能。

## 37 设备发现与控制、授权设备及撤销 — 明确差异

- 旧模式证据：`apps/web/src/session-mode/components/settings/RemoteAccessSettings.tsx:243` 区分 Tauri 与浏览器，浏览器分支 `:246` 展示 LAN 地址及二维码；`:115` 的 token 轮换属于 Tauri 分支；`components/pairing/DesktopDrawer.tsx:55` 有旧配对选择并在 `:64` 重载页面。
- 边界：LAN 地址或旧配对不等于 Mac 原包账户设备发现、逐设备授权/撤销或官方 relay；上述 Tauri 分支不能自动算作当前网页能力。

## 38 云环境仓库、共享、脚本、变量/密钥、网络 — 未核实

- 旧模式证据：`apps/web/src/session-mode/features/codex-host/CloudTasksPanel.tsx:98` 有旧组件候选，`:242` 可请求环境列表；但搜索 `apps/web/src` 生产代码中 `CloudTasksPanel` 仅命中其定义，没有找到生产引入点。`docs/designs/session-mode-implementation-20261029/README.md:11` 记录旧期云任务排除。
- 边界：不能将未挂载组件视为可达云环境编辑器，更不能推断创建、共享、秘密、服务授权及网络配置已经实现。

## 39 云网络策略拒绝及域名限制 — 未核实

- 旧模式证据：`apps/web/src/session-mode/components/codex/composer/ComposerMenu.tsx:313` 有权限配置管理网络的提示；`apps/web/src/session-mode/bindings/v2/NetworkRequirements.ts:16` 存在原生类型。
- 边界：类型及本地权限提示不构成云环境允许域名编辑/策略拒绝 UI 或实际云策略证据；未进行网络操作。

## 40 命令面板搜索聊天、任务、设置和侧栏 — 部分

- 旧模式证据：`apps/web/src/session-mode/components/common/SessionManagerShared.tsx:54` 提供按名称/项目搜索；`apps/web/src/session-mode/components/layout/SessionTopNavigation.tsx:128` 为项目导航；`components/ui/command.tsx:32` 仅是可复用命令对话框组件。
- 边界：现有分散入口和通用组件不能证明有原包统一命令面板、完整动作或相同快捷键绑定。

## 41 独立聊天、新窗口和侧聊焦点 — 部分

- 旧模式证据：`apps/web/src/session-mode/components/agent/SessionTabs.tsx:153`、`:169` 提供会话新窗口；`services/openSessionWindow.ts:34`、`:41` 使用浏览器新窗口；`components/codex/composer/ConversationMenu.tsx:1102`、`:1167`、`:1172` 关联侧聊创建和焦点。
- 边界：无项目新聊天、原生独立窗口/侧聊焦点全部语义和 Mac 窗口行为均未确认；浏览器弹窗不等同桌面宿主窗口。

## 42 文件代码导航和查找 — 部分

- 旧模式证据：`apps/web/src/session-mode/features/thread-workflows/ThreadWorkflowToolbar.tsx:366` 提供聊天文本搜索；`thread-workflows/model.ts:43` 明确仅扫描提供的行，跳过未完成助手行及 commentary。
- 边界：该搜索不能证明所有历史全文可搜索；在旧会话模式文件功能范围检索未找到语言服务器定义跳转/查找引用的充分证据。

## 43 会话正文错误边界及重试 — 部分

- 旧模式证据：`apps/web/src/session-mode/components/codex/thread/CodexHistoryNotice.tsx:29` 显示历史加载错误及 `:39` 重试；`CodexTranscriptPreparing.tsx:37` 保留近期正文与草稿并提示显式刷新。
- 边界：历史读取失败与某轮组件渲染异常是不同故障；不据此宣称逐轮 render error boundary 和原包的独立 retry 等价。

## 44 上下文使用量 — 部分

- 旧模式证据：`apps/web/src/session-mode/components/codex/widget/ContextWindowWidget.tsx:12`、`:13` 使用最近响应 token 和模型上下文窗口，`:39` 无数据时不渲染，`:45` 显示百分比；`components/codex/composer/Composer.tsx:1176` 挂载组件。
- 边界：原包所示 reasoning 分类及 unavailable 状态是否一一对应未核实，真实账户额度未验。

## 45 文件/照片、语音与计划模式入口 — 部分

- 旧模式证据：`apps/web/src/session-mode/components/codex/composer/ComposerMenu.tsx:93` 设备文件、`:215` 照片选择；`Composer.tsx:1290` 听写、`:1310` 实时语音；`slashCommands.ts:84` 为计划模式命令。
- 边界：实际麦克风权限、平台相册、实时语音协议、计划切换及原包键盘绑定需各自动态验证，不能以入口存在算通过。

## 46 引用聊天、先前上下文与 PR 附件 — 部分

- 旧模式证据：`apps/web/src/session-mode/components/codex/composer/v2/ContextAttachments.tsx:25` 有回答引用、目录引用和文件快照；`:163` 保留来源变化时的既有快照。
- 边界：已有回答选区/文件快照不等同于原包共享聊天附件、跨线程上下文或 PR 附件的原生身份与快照格式；未核实传输。

## 47 本机与云端后续任务去向 — 未核实

- 旧模式证据：孤立候选 `apps/web/src/session-mode/features/codex-host/CloudTasksPanel.tsx:149` 有创建逻辑、`:170` 确认目标、`:469` 创建或续聊文案；生产源码未发现该组件引入，详见第 38 项。
- 边界：不能把孤立文件视为可达产品，更不能推断本机/云端 follow-up、工作区 Git 修改继承与原包语义相同。

## 48 项目启动脚本与动作 — 部分

- 旧模式证据：`apps/web/src/session-mode/features/workspace-execution/ExecutionLocationPanel.tsx:328` 标明设置针对新会话，`:385` 可选择不执行命令，`:402` 展示命令，`:421` 要求确认；`apps/server/src/services/workspace-environments.ts:19` 使用 `spawn(..., shell:false)`，`:20` 校验确认、cwd 和 worktree。
- 边界：这是当前看板本地环境能力；原包动作、远程 SSH 主机的 cwd/owner/回执以及应用引导创建尚未对照。

## 49 后台 Agent/终端独立停止入口 — 部分

- 旧模式证据：`apps/web/src/session-mode/features/subagents/BackgroundAgentSummary.tsx:130`、`:152` 捕获并核验子 Agent 停止目标，`:210` 明确确认本轮范围；`features/terminal/TerminalPanel.tsx:74` 表明关闭面板终端将结束该进程。
- 边界：看板面板拥有的终端不自动等同 Codex 原生后台命令终端；历史后台终端准确身份和原包清理语义未验。

## 50 生成文件和项目预览的打开/复制 — 部分

- 旧模式证据：`apps/web/src/session-mode/services/openWorkspaceFileReference.ts:65` 有文件打开错误处理；`features/files/FileOperations.tsx:142`、`:149` 复制路径和下载；`features/web-preview/WebPreview.tsx:82` 外部打开网页；`features/visualizations/VisualizationPreview.tsx:206` 展开 HTML 可视化。
- 边界：这些是文件/网页相关能力，不能证明原包生成工件卡、复制文件内容、云附件或权限范围逐项等价。

## 51 大 Diff 降载和异常恢复 — 部分

- 旧模式证据：`apps/web/src/session-mode/features/DiffViewer.tsx:53` 定义 100,000 字符展示阈值，`:315` 超限显示提示及编辑器入口；`features/git/GitDiffFileItem.tsx:338`、`:350` 提供文件变更错误与重试。
- 边界：原包大 diff 的前后文件导航、内存行为、跨文件异常恢复及界面并未动态对照。

## 52 MCP Apps 缓存管理 — 未核实

- 旧模式证据：`apps/web/src/session-mode/features/mcp-apps/McpAppView.tsx:33` 处理账号/连接变化；`features/mcp-apps/bridge.ts:28` 在关闭时发资源 teardown。
- 边界：资源 teardown 不能视为清除 MCP Apps 持久缓存；有界搜索未找到等价 clear-data 管理入口及其存储范围。

## 53 站点批注可用/不可用状态 — 未核实

- 旧模式证据：`apps/web/src/session-mode/features/web-preview/WebPreview.tsx:135` 为 iframe；仓库另有代码/回答选区批注能力但不同于网页站点批注。
- 边界：旧会话模式针对 `commentMode|siteTools|annotationFeatures` 的有界搜索无对应实现；不据此断言全仓所有浏览器能力均不存在。

## 54 连接失败及重新登录错误恢复 — 部分

- 旧模式证据：`apps/web/src/session-mode/components/layout/SessionSyncIndicator.tsx:215` 有实时消息重连状态；`components/settings/RemoteAccessSettings.tsx:243` 区分桌面配对和浏览器 LAN 展示。
- 边界：这些通用会话重连不等于原包授权设备列表的 authRequired、重新登录与 retry；无法将其视为官方设备控制或 SSH 重连验收。
