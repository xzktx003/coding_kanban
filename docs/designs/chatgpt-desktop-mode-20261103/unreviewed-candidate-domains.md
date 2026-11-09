# ChatGPT Mac 26.1027.61615：ASAR 路径候选领域总览

- ASAR SHA-256：`bb88615052255e79b5977885f9a0cc212c268589587c79d4d3b7c4b46e881a95`。通过解析索引枚举 **22534 个成员、385 个目录**；其中 `.vite` 27，`native-menu-locales` 64，`node_modules` 880，`webview` 21562，顶层 `package.json` 1。
- `webview/assets/` 共 **21395** 个成员；下列关键词在成员**文件名**中匹配，属于候选索引且可跨类重复；5187 个资源至少命中一类，**16208 个没有命中所选关键词**，包括哈希命名等，不能据此判定不相关。
- “共 N 个”指匹配路径数，不是功能数、实现数或验收数；同包混有 ChatGPT / Work、第三方库、UI 共享组件，当前无法按文件名划清一期 Codex 可达范围，默认均为 **未知 / 待验证**。
- 全量可复查索引：[ASAR 所有成员](../../../.dev-runtime/chatgpt-desktop-audit-20261103-kmy767aq/asar-member-index.json)；逐类全部路径和正则：[候选领域索引](../../../.dev-runtime/chatgpt-desktop-audit-20261103-kmy767aq/candidate-domains.json)。该索引中的 `header_integrity` 是 ASAR 声明；另一次独立扫描已回读 22,534 个成员，22,527 匹配、7 项不匹配，结果见 [实际哈希清单](../../../.dev-runtime/chatgpt-desktop-audit-20261103-kmy767aq/asar-inventory.csv.gz)。两者都不构成官方签名或来源验证。
- 此索引不包含 `.app` 中 ASAR 外的主程序、Frameworks、独立 Codex CLI 等物理文件。ASAR 列出的 16 个 unpacked 项均有对应物理文件：逐一对照头部大小和 SHA-256，9 项一致、7 项大小及哈希不一致；[完整检查数据](../../../.dev-runtime/chatgpt-desktop-audit-20261103-kmy767aq/unpacked-integrity.json)。这 7 个文件的 Mach-O 每个架构切片都有 `LC_CODE_SIGNATURE` 加载命令；没有原始未签名成员或签名验证结果，原因仍未知，不能单凭这一结果推断文件损坏或运行状态，不得将这 7 个原生组件当作完整性已匹配。

## 导航 / 工作区布局：307 个候选路径

匹配规则（文件名）：`(?:^|[-_.])(?:sidebar|navigation|navbar|rail|nav|menu|toolbar|breadcrumb|tab|tabs|layout)(?:[-_.]|$)`。

路径示例：

- `webview/assets/toolbar-action-group-5285460fad8f.js`
- `webview/assets/artifact-tab-content.electron-757f58d12b55.js`
- `webview/assets/tab-content-8de26932704b.js`
- `webview/assets/selection-toolbar-position-de107bef884a.js`
- `webview/assets/thread-side-panel-tab-content-d2b583a29734.js`
- `webview/assets/text-file-editor-tab-content.electron-3dfaf00197f1.js`

## 项目 / 工作目录 / worktree：82 个候选路径

匹配规则（文件名）：`(?:^|[-_.])(?:project|projects|projectless|workspace|workspaces|worktree|worktrees|repository|repositories|repo)(?:[-_.]|$)`。

路径示例：

- `webview/assets/workspace-auto-generated-name-9aea386ed954.js`
- `webview/assets/workspace-ef894ca29ee1.js`
- `webview/assets/projects-index-page-78237015641b.js`
- `webview/assets/worktrees-settings-page-44ed0fea3928.js`
- `webview/assets/worktree-path-labels-85606217baf0.js`
- `webview/assets/workspace-d5c9a125edf8.js`

## 聊天 / 历史 / 归档：410 个候选路径

匹配规则（文件名）：`(?:^|[-_.])(?:thread|threads|conversation|conversations|chat|chats|message|messages|transcript|history|archive|fork)(?:[-_.]|$)`。

路径示例：

- `webview/assets/chatgpt-conversation-turn-content-10f0c5e66953.js`
- `webview/assets/local-conversation-thread-2f594f841b07.js`
- `webview/assets/chatgpt-conversation-page-f00171e0eb0a.js`
- `webview/assets/chatgpt-conversation-share-dialog-4a7031cbe83e.js`
- `webview/assets/thread-side-panel-tab-content-d2b583a29734.js`
- `webview/assets/local-conversation-turn-e1ee3114316e.js`

## 账号 / 登录 / 团队：89 个候选路径

匹配规则（文件名）：`(?:^|[-_.])(?:account|accounts|auth|oauth|login|logout|identity|profile|team|teams|organization)(?:[-_.]|$)`。

路径示例：

- `webview/assets/profile-53441db99d75.js`
- `webview/assets/account-linking-d206f9196278.js`
- `webview/assets/profile-preview-6c85fab9cbf7.js`
- `webview/assets/accounts-valdi-ac657687522f.js`
- `webview/assets/login-route-814949a1c03e.js`
- `webview/assets/team-settings-page-35cc479e7ba6.js`

## 设置 / 配置 / 偏好：180 个候选路径

匹配规则（文件名）：`(?:^|[-_.])(?:settings|setting|config|configuration|preference|preferences|policy|requirements)(?:[-_.]|$)`。

路径示例：

- `webview/assets/_virtual_settings-search-documents-e84bcda5b237.js`
- `webview/assets/configuration-fields-c30a31b42a50.js`
- `webview/assets/general-settings-eef28ee7c589.js`
- `webview/assets/security-settings-e577a3e884c6.js`
- `webview/assets/remote-connections-settings-4dd0ca54883c.js`
- `webview/assets/personalization-settings-7ef3fe8695e0.js`

## 自动化 / 定时 / 触发器：78 个候选路径

匹配规则（文件名）：`(?:^|[-_.])(?:automation|automations|scheduled|schedule|cron|heartbeat|recurrence|recurring|webhook|trigger|inbox)(?:[-_.]|$)`。

路径示例：

- `webview/assets/automations-page-f42fb2994576.js`
- `webview/assets/configuration-schedule-19415060faff.js`
- `webview/assets/automation-frequency-section-467de6dbd3d7.js`
- `webview/assets/cloud-automation-detail-panel-769113aacf36.js`
- `webview/assets/automation-row-37c157e22263.js`
- `webview/assets/automation-plan-summary-9f8f3a8d66ac.js`

## 远程连接 / 设备 / SSH：92 个候选路径

匹配规则（文件名）：`(?:^|[-_.])(?:remote|ssh|connection|connections|connect|device|devices|host|pairing|tunnel|reconnect)(?:[-_.]|$)`。

路径示例：

- `webview/assets/initialize-app-host-services-a3479e215e83.js`
- `webview/assets/remote-connections-settings-4dd0ca54883c.js`
- `webview/assets/app-connect-modal-content-f6abea3f0522.js`
- `webview/assets/remote-conversation-page-f909727e086c.js`
- `webview/assets/host-85c53fcfd4f2.js`
- `webview/assets/device-storage-49df203d8c6c.js`

## 云 / 沙箱 / 运行环境：149 个候选路径

匹配规则（文件名）：`(?:^|[-_.])(?:cloud|environment|environments|sandbox|container|runtime)(?:[-_.]|$)`。

路径示例：

- `webview/assets/runtime.worker-91acb72237a7.js`
- `webview/assets/runtime.worker-95ee87e29573.js`
- `webview/assets/runtime.worker-3473dfddeac6.js`
- `webview/assets/pdfkit-runtime.browser-79d2473c4429.js`
- `webview/assets/pdfkit-runtime.browser-f35adec669c7.js`
- `webview/assets/app-runtime-b179428fcc1e.js`

## 连接器 / 市场 / 授权：45 个候选路径

匹配规则（文件名）：`(?:^|[-_.])(?:connector|connectors|connection|connections|integration|integrations|oauth|marketplace)(?:[-_.]|$)`。

路径示例：

- `webview/assets/remote-connections-settings-4dd0ca54883c.js`
- `webview/assets/plugins-connections-modal-96a436a38a0f.js`
- `webview/assets/app-connect-oauth-callback-page-813a93dfac72.js`
- `webview/assets/remote-connection-editor-dialog-141e6df0668d.js`
- `webview/assets/pca-connector-eligibility-f4bdd2c815d2.js`
- `webview/assets/connection-error-f68fc6b3500f.js`

## 插件 / 应用入口：184 个候选路径

匹配规则（文件名）：`(?:^|[-_.])(?:plugin|plugins|marketplace|app|apps)(?:[-_.]|$)`。

路径示例：

- `webview/assets/app-initial-18b189e867e7.js`
- `webview/assets/app-shared-601019a330d7.js`
- `webview/assets/app-primary-75d53eef2374.js`
- `webview/assets/app-runtime-b179428fcc1e.js`
- `webview/assets/initialize-app-host-services-a3479e215e83.js`
- `webview/assets/app-connect-modal-content-f6abea3f0522.js`

## MCP / 工具交互：54 个候选路径

匹配规则（文件名）：`(?:^|[-_.])(?:mcp|webmcp|tool|tools|elicitation)(?:[-_.]|$)`。

路径示例：

- `webview/assets/mcp-tool-activity-label-9a3f21f8cf08.js`
- `webview/assets/chatgpt-writing-block-ai-tools-380d86654398.js`
- `webview/assets/mcp-tool-item-content-424629821fad.js`
- `webview/assets/thread-handoff-dynamic-tool-2f356d9a04df.js`
- `webview/assets/inline-tool-suggestion-request-card-690b1195cb76.js`
- `webview/assets/image-tools-toolbar-5cf04296bc01.js`

## Skills / Hooks / 命令：69 个候选路径

匹配规则（文件名）：`(?:^|[-_.])(?:skill|skills|hook|hooks|prompt|prompts|command|commands)(?:[-_.]|$)`。

路径示例：

- `webview/assets/plugins-skills-tabs-c731ebf7d521.js`
- `webview/assets/command-menu-dialog-75d588ab4b71.js`
- `webview/assets/command-messages-5647543f3fe2.js`
- `webview/assets/skills-fc249e42a8e8.js`
- `webview/assets/skill-instructions-8811b578968e.js`
- `webview/assets/hooks-settings-dcc6d1fed9c5.js`

## 输入 / 草稿 / 附件：144 个候选路径

匹配规则（文件名）：`(?:^|[-_.])(?:composer|composition|input|draft|attachment|attachments|upload|drop)(?:[-_.]|$)`。

路径示例：

- `webview/assets/composer-content-b926d24ef280.js`
- `webview/assets/composer-controls-a9dbb3dfe047.js`
- `webview/assets/composer-utility-bar-882e7f195cb9.js`
- `webview/assets/phone-number-input-f79788215b58.js`
- `webview/assets/codex-composer-adapter-d1ca952732ea.js`
- `webview/assets/request-user-input-async-notifications-703a2441ce12.js`

## 模型 / 推理 / 用量 / 目标：446 个候选路径

匹配规则（文件名）：`(?:^|[-_.])(?:model|models|reasoning|effort|speed|plan|goal|rate|token|usage)(?:[-_.]|$)`。

路径示例：

- `webview/assets/document-model-c9aa9b7ed747.js`
- `webview/assets/automation-plan-summary-9f8f3a8d66ac.js`
- `webview/assets/model-34d2cf37a828.js`
- `webview/assets/plan-summary-item-content-b7907af4f41c.js`
- `webview/assets/cfc-plan-page-7344a87f97fc.js`
- `webview/assets/thread-usage-breakdown-45c084f62200.js`

## 权限 / 组织策略 / 审批：63 个候选路径

匹配规则（文件名）：`(?:^|[-_.])(?:permission|permissions|approval|approvals|policy|policies|requirements|consent|security|sandbox|trust|secret|credentials)(?:[-_.]|$)`。

路径示例：

- `webview/assets/security-route-ebab78fda0bf.js`
- `webview/assets/security-settings-e577a3e884c6.js`
- `webview/assets/visualization-sandbox-html-7655087ec50a.js`
- `webview/assets/browser-use-policy-site-permissions-ffe4799762b2.js`
- `webview/assets/permissions-mode-dropdown-ff036d61b201.js`
- `webview/assets/chronicle-permissions-dialog-9705873e44c3.js`

## 审查 / Diff / Git：184 个候选路径

匹配规则（文件名）：`(?:^|[-_.])(?:review|diff|git|commit|branch|changes|pull-request|file-review)(?:[-_.]|$)`。

路径示例：

- `webview/assets/review-file-source-item-1dd7be4eee73.js`
- `webview/assets/code-diff-2f98e0923a3a.js`
- `webview/assets/revision-review-unavailable-message-872aef8a119b.js`
- `webview/assets/use-diff-annotations-35b012425236.js`
- `webview/assets/git-action-new-branch-field-c7396979f0b9.js`
- `webview/assets/pull-request-comment-cd5fd0985652.js`

## 文件 / 编辑器 / 工件：738 个候选路径

匹配规则（文件名）：`(?:^|[-_.])(?:file|files|directory|folder|editor|document|preview|source|sources|artifact)(?:[-_.]|$)`。

路径示例：

- `webview/assets/artifact-source-bootstrap-3a66237ec1b6.js`
- `webview/assets/document-session-4a808c4e9741.js`
- `webview/assets/document-model-c9aa9b7ed747.js`
- `webview/assets/editor-588bf8341db0.js`
- `webview/assets/docx-preview-ca5523f50dcc.js`
- `webview/assets/annotation-comment-editor-card-caf6db62b1d9.js`

## 终端 / Shell / 进程：66 个候选路径

匹配规则（文件名）：`(?:^|[-_.])(?:terminal|pty|shell|process|command|execution)(?:[-_.]|$)`。

路径示例：

- `webview/assets/shell-553a6f3737f3.js`
- `webview/assets/execution-360ae38ff570.js`
- `webview/assets/command-menu-dialog-75d588ab4b71.js`
- `webview/assets/command-messages-5647543f3fe2.js`
- `webview/assets/thread-app-shell-chrome-e7e38c7ea254.js`
- `webview/assets/code-block-execution-7f07e1f5fa79.js`

## 浏览器 / 网页 / 站点批注：131 个候选路径

匹配规则（文件名）：`(?:^|[-_.])(?:browser|webview|webmcp|site|site-tools|url|navigate|annotation|screenshot)(?:[-_.]|$)`。

路径示例：

- `webview/assets/pdfkit-runtime.browser-79d2473c4429.js`
- `webview/assets/pdfkit-runtime.browser-f35adec669c7.js`
- `webview/assets/browser-ca0886742f6d.js`
- `webview/assets/browser-dc9de315e139.js`
- `webview/assets/server.browser-df191ff7477c.js`
- `webview/assets/annotation-comment-editor-card-caf6db62b1d9.js`

## 通知 / 未读 / 音频：127 个候选路径

匹配规则（文件名）：`(?:^|[-_.])(?:notification|notifications|unread|alert|sound|toast|badge)(?:[-_.]|$)`。

路径示例：

- `webview/assets/notifications-settings-f978129b87c5.js`
- `webview/assets/request-user-input-async-notifications-703a2441ce12.js`
- `webview/assets/automation-notification-policy-dropdown-c3c24be4b72a.js`
- `webview/assets/notifications-runtime-f189a8c8bdfe.js`
- `webview/assets/appearance-edit-badge-2a62f06033af.js`
- `webview/assets/schema-compatibility-toast-5956b599bac7.js`

## 智能体 / 子任务 / Goal：96 个候选路径

匹配规则（文件名）：`(?:^|[-_.])(?:agent|agents|subagent|subagents|delegation|task|tasks|goal|goals)(?:[-_.]|$)`。

路径示例：

- `webview/assets/subagent-activity-chip-group-ec483877ca99.js`
- `webview/assets/agent-builder-530053b688ea.js`
- `webview/assets/tasks-ff370b1d41fa.js`
- `webview/assets/home-task-suggestions-92b26671391c.js`
- `webview/assets/onboarding-task-environment-46e1fa944ac9.js`
- `webview/assets/external-agent-import-step-bc7965eb6443.js`

## 同步 / 事件 / 连接恢复：48 个候选路径

匹配规则（文件名）：`(?:^|[-_.])(?:sync|subscription|event|events|stream|transport|rpc|queue|reconnect|resume|daemon)(?:[-_.]|$)`。

路径示例：

- `webview/assets/sync-b466122c1057.js`
- `webview/assets/stream-tokenizer-bf87c66b3794.js`
- `webview/assets/subscription-onboarding-f2a48b3963f7.js`
- `webview/assets/subscription-update-dialog-e1f103189a4b.js`
- `webview/assets/calculator-heart-score-for-major-cardiac-events-widget-7951b082dd22.js`
- `webview/assets/resume-chatgpt-completion-2c1bb5445319.js`

## 桌面 / Electron / 原生桥：98 个候选路径

匹配规则（文件名）：`(?:^|[-_.])(?:electron|desktop|preload|native|ipc|bridge|window|windows|platform|macos|darwin)(?:[-_.]|$)`。

路径示例：

- `webview/assets/dotnet.native.v7yzmxw71a.wasm`
- `webview/assets/avatar-overlay-native-page-920d05377bbe.js`
- `webview/assets/artifact-tab-content.electron-757f58d12b55.js`
- `webview/assets/dotnet.native.inc43q60w4.js`
- `webview/assets/native-room-ef340599c545.js`
- `webview/assets/text-file-editor-tab-content.electron-3dfaf00197f1.js`

## 主题 / 样式 / 字体 / 图标：108 个候选路径

匹配规则（文件名）：`(?:^|[-_.])(?:theme|themes|font|fonts|style|styles|color|appearance|icon|icons)(?:[-_.]|$)`。

路径示例：

- `webview/assets/color-icon-7f05b76f0fb2.js`
- `webview/assets/lucide-icons-b42c1927872f654c.js`
- `webview/assets/register-pierre-themes-50d08bd72b55.js`
- `webview/assets/writing-style-setup-522c59625aaa.js`
- `webview/assets/color-466a22be2bf9.js`
- `webview/assets/aeon-appearance-picker-3f9f9ad14f0d.js`

## 图像 / 图表 / 文档 / 画布：2170 个候选路径

匹配规则（文件名）：`(?:^|[-_.])(?:artifact|visualization|chart|diagram|image|pdf|spreadsheet|slide|presentation|document|canvas)(?:[-_.]|$)`。

路径示例：

- `webview/assets/presentation-2a90685bf0ef.js`
- `webview/assets/artifact-source-bootstrap-3a66237ec1b6.js`
- `webview/assets/presentation-panel-ee4fa219735e.js`
- `webview/assets/pdf-cff422367602.js`
- `webview/assets/pdf-4820c2b2f0dc.js`
- `webview/assets/presentation-fdc9df27b29d.js`

## 全量覆盖与剩余边界

- 这些类是一个索引视角，不应把 54 条已经定位的静态 UI 锚点理解为全部功能。原包现有 ASAR 内容很多属于渲染器资源、本地化、外部依赖或功能变种，至少需要对独立 Codex 入口的导入图、功能门控、状态与权限、实机行为分别分类。
- 不按某个资源没有关键词就断言功能不存在；大共享 bundle、哈希资源、运行时动态模块、ASAR 外插件、后端与账户服务均可能影响能力。
- 后续逐项标注：候选路径 → 有上下文的组件/调用或数据流 → 当前产品源码与界面 → Mac 受控实测 → 依赖/门控；仅到哪一级就报告到哪一级。
