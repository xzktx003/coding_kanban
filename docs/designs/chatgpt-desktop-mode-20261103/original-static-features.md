# Codex 一期功能范围扩展：原包静态锚点

版本 26.1027.61615，app.asar SHA-256 `bb88615052255e79b5977885f9a0cc212c268589587c79d4d3b7c4b46e881a95`。以下是经 ASAR 内置 integrity 核对的成员中观察到的候选界面/局部分支；未启动 Mac 原版，不代表运行可达或协议已经验证。聊天和 Work 专属功能归未来阶段；同包共享组件需补产品模式/账号/地区门控。成员内偏移从 0 开始，以 UTF-8 字节计。

## 模型与权限：Codex 模型目录加载与重试

- 原包成员：`webview/assets/app-primary-75d53eef2374.js`，SHA-256 `ebaecd54561e7e3da76c08b0d900e056424d57b1b23675afad4d7d235599f80b`。
- 精确锚点：`composer.modelPicker.retryModels` @ 4370367；`composer.modelPicker.loadingModels` @ 4370537。
- 证据/限制：组件状态，实际模型源/权限待验。

## 模型与权限：推理强度选择

- 原包成员：`webview/assets/app-primary-75d53eef2374.js`，SHA-256 `ebaecd54561e7e3da76c08b0d900e056424d57b1b23675afad4d7d235599f80b`。
- 精确锚点：`composer.modelPicker.selectEffort.label` @ 3956384。
- 证据/限制：与选中模型和 effort 列表条件相关。

## 模型与权限：请求批准、自动审核、完全访问、自定义及组织策略

- 原包成员：`webview/assets/permissions-mode-dropdown-ff036d61b201.js`，SHA-256 `204816dfdb368361fb4d53da7a865be2c7eb6e769d8c1b1848925ab35536170e`。
- 精确锚点：`composer.permissionsDropdown.default.approvalOptionLabel` @ 13529；`composer.permissionsDropdown.guardianApproval.optionLabel` @ 29948；`composer.permissionsDropdown.fullAccess.optionLabel` @ 30336；`composer.permissionsDropdown.custom.optionLabel` @ 30852。
- 证据/限制：含界面候选，实际权限执行须单独验证。

## 模型与权限：被 requirements.toml 或云模式约束

- 原包成员：`webview/assets/permissions-mode-dropdown-ff036d61b201.js`，SHA-256 `204816dfdb368361fb4d53da7a865be2c7eb6e769d8c1b1848925ab35536170e`。
- 精确锚点：`composer.permissionsDropdown.disabledByRequirements.tooltip` @ 34600；`composer.permissionsDropdown.unavailableForCloudWork.tooltip` @ 34981。
- 证据/限制：switch 有明确限制分支。

## 模型与权限：完全访问的确认流程

- 原包成员：`webview/assets/permissions-mode-dropdown-ff036d61b201.js`，SHA-256 `204816dfdb368361fb4d53da7a865be2c7eb6e769d8c1b1848925ab35536170e`。
- 精确锚点：`composer.mode.agentMode.fullAccessConfirm.warningDescription.codeMode` @ 6602；`composer.mode.agentMode.fullAccessConfirm.turnOnButton` @ 10969。
- 证据/限制：条件展示的确认 UI，不代表绕过平台策略。

## 模型与权限：待审批卡片及自动审查

- 原包成员：`webview/assets/composer-approval-request-card-d675d8437483.js`，SHA-256 `5bc377b6b150b89e381bda58eaf7bdf82fff4a3c034eadfb90207bf2867ac959`。
- 精确锚点：`approvalRequestCard.allowOnce` @ 2285；`approvalRequestCard.alwaysAllow` @ 4193；`approvalRequestCard.deny` @ 4552；`approvalRequestCard.allowConversation` @ 6296。
- 证据/限制：存在审批组件但确切协议与门控须单独跟踪。

## 输入与附件：发送、排队、引导和中断

- 原包成员：`webview/assets/composer-content-b926d24ef280.js`，SHA-256 `cf56f37714e14488239f4eb715b845067e75f8c2e98851c768c4110d3eb6fd08`。
- 精确锚点：`composer.submitButtonTooltip.queue` @ 134950；`composer.submitButtonTooltip.steer` @ 135140；`composer.submitButtonTooltip.stop` @ 135961。
- 证据/限制：queue/steer 为条件分支，写出回执未验。

## 输入与附件：中断后暂停队列时发送的确认

- 原包成员：`webview/assets/composer-content-b926d24ef280.js`，SHA-256 `cf56f37714e14488239f4eb715b845067e75f8c2e98851c768c4110d3eb6fd08`。
- 精确锚点：`composer.pausedQueueSubmit.title` @ 346774；`composer.pausedQueueSubmit.description` @ 346996。
- 证据/限制：不假定无回执重发策略。

## 输入与附件：远程语音与附件夹限制

- 原包成员：`webview/assets/composer-content-b926d24ef280.js`，SHA-256 `cf56f37714e14488239f4eb715b845067e75f8c2e98851c768c4110d3eb6fd08`。
- 精确锚点：`composer.realtime.remoteProjectUnsupported` @ 136484。
- 证据/限制：远程项目语音提示，条件与可达性待验。

## 输入与附件：远程聊天的本机文件夹限制

- 原包成员：`webview/assets/composer-attachment-actions-b89b20d8b9f0.js`，SHA-256 `63a6568f6664b10e0981a6535bb1a15fb012f28c7892e7bf4b9860c73ac3e504`。
- 精确锚点：`composer.fileAttachment.remoteFolderUnsupported` @ 5819；`composer.fileAttachment.uploadError.fileTooLarge` @ 1111。
- 证据/限制：代码过滤所附本地文件夹并展示提示。

## 输入与附件：目标 Goal 编辑/替换/暂停/Token 预算

- 原包成员：`webview/assets/composer-content-b926d24ef280.js`，SHA-256 `cf56f37714e14488239f4eb715b845067e75f8c2e98851c768c4110d3eb6fd08`。
- 精确锚点：`composer.threadGoal.replaceConfirmation.title` @ 26518；`composer.threadGoal.pause` @ 37951；`composer.threadGoal.tokenProgress` @ 43885。
- 证据/限制：具体生命周期和协议需验证。

## 输入与附件：本地、worktree 和云执行位置

- 原包成员：`webview/assets/composer-utility-bar-882e7f195cb9.js`，SHA-256 `8b98c57a802d977612e7d7516013b51cd369ce71fc31ce290589ad0d75f2254a`。
- 精确锚点：`composer.mode.runInCloud` @ 63000；`composer.mode.newLocalWorktree` @ 76041；`composer.mode.remoteWorktree` @ 76878；`composer.mode.cloud.tooltip.forMultiRootProject` @ 75196。
- 证据/限制：多根目录不同位置访问条件有独立提示。

## 聊天与历史：侧栏会话重命名、归档、未读与 fork

- 原包成员：`webview/assets/app-initial-18b189e867e7.js`，SHA-256 `244653d55e434b27618a848bef14d6d6781569bf58e8656cf644445113ffc032`。
- 精确锚点：`sidebarElectron.renameThread` @ 7692955；`sidebarElectron.archiveThread` @ 7692629；`sidebarElectron.markThreadUnread` @ 7695266；`threadHeader.forkIntoWorktree` @ 7696486。
- 证据/限制：动作显示不等于运行成功。

## 聊天与历史：历史加载失败/编辑失败/写入者冲突

- 原包成员：`webview/assets/local-conversation-thread-2f594f841b07.js`，SHA-256 `af8e8ab2e97566d25d69249ef8adf5a86d0bf0bbf4c306e4fbc50c80e8837263`。
- 精确锚点：`localConversation.editLastMessageFailed` @ 370336；`localConversation.historyLoadFailed` @ 392187；`localConversation.writerConflict.retry` @ 407328；`localConversation.writerConflict.fork` @ 407581。
- 证据/限制：可观察错误与恢复入口，后端并发机制待验。

## 聊天与历史：从历史消息分叉到原或新 worktree

- 原包成员：`webview/assets/local-conversation-thread-2f594f841b07.js`，SHA-256 `af8e8ab2e97566d25d69249ef8adf5a86d0bf0bbf4c306e4fbc50c80e8837263`。
- 精确锚点：`localConversation.forkFromOlderTurnDialog.title` @ 269450；`localConversation.forkFromOlderTurnDialog.local.label` @ 270312；`localConversation.forkFromOlderTurnDialog.worktree.label` @ 271427。
- 证据/限制：旧消息分叉对象和复制边界待验。

## 聊天与历史：子智能体、后台终端、创建的聊天

- 原包成员：`webview/assets/local-conversation-thread-2f594f841b07.js`，SHA-256 `af8e8ab2e97566d25d69249ef8adf5a86d0bf0bbf4c306e4fbc50c80e8837263`。
- 精确锚点：`codex.localConversation.backgroundTasks.title.subagents` @ 51461；`codex.localConversation.backgroundTasks.title.backgroundProcesses` @ 51752；`codex.localConversation.createdTasks.title` @ 68190。
- 证据/限制：停止、权限和 session 所有权须实测。

## 审查与 Diff：云、本分支、上一轮、未暂存/已暂存和 commit

- 原包成员：`webview/assets/review-header-source-controls-45c786e8b02e.js`，SHA-256 `449b7d3fc5f140f1548c7e48091063cce26eb63136443c1e2b913cbd073c8607`。
- 精确锚点：`codex.review.source.cloud` @ 15111；`codex.review.source.local.lastTurnV2` @ 16186；`codex.review.stageFilter.unstaged` @ 16866；`codex.review.stageFilter.staged` @ 17030；`codex.review.source.local.commits` @ 17190。
- 证据/限制：代码对 cloud 源有显式分支。

## 审查与 Diff：大 diff、过滤、已查看和 stage 控件

- 原包成员：`webview/assets/thread-side-panel-tab-content-d2b583a29734.js`，SHA-256 `25c015eaf9f8e76c93503deb6f26b6cac948b466c7e16f50b39664b0cca01ff7`。
- 精确锚点：`codex.review.diffTooLarge.title` @ 14828；`codex.review.largeDiff.banner` @ 79858；`codex.review.fileDiff.markAsViewed` @ 47403；`diff.actionButton.stageSectionLabel` @ 87276。
- 证据/限制：写操作及撤销影响须真实受控验收。

## 审查与 Diff：仓库相对/项目相对/绝对路径及文件预览失败

- 原包成员：`webview/assets/review-file-source-item-1dd7be4eee73.js`，SHA-256 `6a4f7f0791a0ac83e639cbe89fd95308c87826af4fce8e564b7895581f5dcc89`。
- 精确锚点：`review.fileSource.copyRepoRelativePathButton` @ 14846；`review.fileSource.copyProjectRelativePathButton` @ 15136；`review.fileSource.copyAbsolutePath` @ 17044。
- 证据/限制：不同文件格式按能力处理。

## 设置：设置导航、搜索、集成和 Coding 分区

- 原包成员：`webview/assets/settings-page-4899da12a575.js`，SHA-256 `227b32492a169d848cb621b997aebdfcd52ebafd792d6fdd807ad6e1a6aba82e`。
- 精确锚点：`settings.nav.ariaLabel` @ 29786；`settings.search.label` @ 36818；`settings.nav.heading.integrations` @ 41558；`settings.nav.heading.coding` @ 43032。
- 证据/限制：仅入口清单，实际页和账号/平台门控需跟踪。

## 设置：主题、背景、对比、字体与字体大小

- 原包成员：`webview/assets/general-settings-eef28ee7c589.js`，SHA-256 `b66f8571697deae3ce36bb7071c10f6fed19390517cc21f8b6aa1e3ee90d9ad9`。
- 精确锚点：`settings.general.appearance.theme.light` @ 36349；`settings.general.appearance.chromeTheme.uiFontFamily` @ 37541；`settings.general.appearance.codeFontSize.row` @ 39503。
- 证据/限制：CSS 生效范围与原生效果须 macOS 上测量。

## 设置：完成通知与输入队列、终端位置偏好

- 原包成员：`webview/assets/notifications-settings-f978129b87c5.js`，SHA-256 `0c215179267e75cd7679076f32b008de6c3e5455b35f34e1718165c7a88fa1e0`。
- 精确锚点：`settings.general.followUpQueueMode.queue` @ 4446；`settings.general.followUpQueueMode.interrupt` @ 4618；`settings.general.defaultTerminalLocation.bottom` @ 7249；`settings.general.defaultTerminalLocation.right` @ 7420。
- 证据/限制：设置持久化及各模式继承策略待验。

## 定时任务：手动创建、使用 Codex 创建、历史归档

- 原包成员：`webview/assets/automations-page-f42fb2994576.js`，SHA-256 `244b2d825a836a68331d9151132b1da0c8fe4126bd30852796499fe462b16f41`。
- 精确锚点：`inbox.automations.createMenu.setUpManually` @ 8696；`inbox.automations.createWithCodex` @ 9038；`inbox.automations.history.archiveAll` @ 10306。
- 证据/限制：同包含 ChatGPT 设置项，需限定到一期 Codex。

## 定时任务：时区、同一/新聊天、云本地限制

- 原包成员：`webview/assets/configuration-schedule-19415060faff.js`，SHA-256 `71b4e0318646d50dd786209723d97f82e127d73c6b53ec2473ff10134cb0827b`。
- 精确锚点：`automations.configuration.timeZone` @ 7481；`automations.configuration.runsInNewChat` @ 12507；`automations.configuration.runsInSameChat` @ 12796；`automations.configuration.localDateUnavailable` @ 13095；`automations.configuration.localEventUnavailable` @ 13448。
- 证据/限制：最后两项有显式条件分支，实际执行验证待做。

## 定时任务：云任务更新/删除错误和已保存但启动失败

- 原包成员：`webview/assets/automations-page-f42fb2994576.js`，SHA-256 `244b2d825a836a68331d9151132b1da0c8fe4126bd30852796499fe462b16f41`。
- 精确锚点：`inbox.automations.cloud.updateError` @ 76511；`inbox.automations.cloud.deleteError` @ 77130；`scheduled.setup.startFailed` @ 68159。
- 证据/限制：分清保存和执行回执。

## 插件 Skills MCP：插件/技能主机切换、本地与 ChatGPT

- 原包成员：`webview/assets/plugins-skills-tabs-c731ebf7d521.js`，SHA-256 `47fd418434c414032e48cebc597d7e43772ca9e8f5cf0bb6a24362f93ab56af3`。
- 精确锚点：`skills.appsPage.hostDropdown.local` @ 4200；`skills.appsPage.hostDropdown.chatgpt` @ 4417；`plugins.page.loading` @ 23615。
- 证据/限制：产品模式和平台门控待验。

## 插件 Skills MCP：技能搜索、刷新、新建、安装

- 原包成员：`webview/assets/skills-page-96d0a75209f5.js`，SHA-256 `25572cad8f323141fd522e6b81ab7eee73d8eef485f72bfeb8421b5bbc7869c6`。
- 精确锚点：`skills.page.refreshSkills` @ 14595；`skills.page.search` @ 15165；`skills.page.createSkill` @ 16142；`skills.section.installed` @ 17760。
- 证据/限制：安装权限及本地来源需确认。

## 插件 Skills MCP：插件包含应用、MCP、hooks 与组织禁用

- 原包成员：`webview/assets/plugin-detail-view-7240e318ab04.js`，SHA-256 `659a2ebbd7ae9f0817b9df49e1346d94db92581adbcb0837695c913001544b1b`。
- 精确锚点：`plugins.detail.includes.mcpServers.title` @ 54489；`plugins.detail.includes.hooks.review` @ 64506；`plugins.detail.includes.disabledByAdminBadge` @ 69757。
- 证据/限制：hooks 是否允许执行须实际策略确认。

## 插件 Skills MCP：MCP STDIO 和 streamable HTTP 配置

- 原包成员：`webview/assets/plugins-settings-7a89487c0c4c.js`，SHA-256 `84d642678aab6059f3bb51b8d64d2e0f88c1f09200a46d166805e9c59d984935`。
- 精确锚点：`settings.mcp.detail.transport.stdio` @ 16197；`settings.mcp.detail.transport.http` @ 16352；`settings.mcp.detail.command` @ 16823；`settings.mcp.detail.http.bearerToken` @ 18981。
- 证据/限制：选择分支明确，但认证与写入回执未验。

## 插件 Skills MCP：MCP 连接、启用和 OAuth 注册策略

- 原包成员：`webview/assets/plugins-settings-7a89487c0c4c.js`，SHA-256 `84d642678aab6059f3bb51b8d64d2e0f88c1f09200a46d166805e9c59d984935`。
- 精确锚点：`settings.mcp.server.clientRegistration.label` @ 33222；`settings.mcp.server.login` @ 36262；`settings.mcp.server.enable` @ 36675。
- 证据/限制：自动/CIMD/DCR 是客户端选项，不证明所有服务支持。

## 终端与浏览器：终端连接、断开、重新打开与 cwd 提示

- 原包成员：`webview/assets/terminal-tab-d3a5a5a51dbb.js`，SHA-256 `dbdd8a4aa85ed99e4c0fd1b59cf134148427c584ebfb12bfe3a36c11a4946066`。
- 精确锚点：`cloudTerminal.reconnectingDescription` @ 2084；`cloudTerminal.inputInterrupted` @ 3026；`terminal.workspaceWarning.message` @ 8688。
- 证据/限制：重连提示明确旧命令不重跑；执行身份仍须验。

## 终端与浏览器：聊天旁标签中打开终端/浏览器等

- 原包成员：`webview/assets/thread-side-panel-new-tab-c74d1915bdc1.js`，SHA-256 `1fe10d5b1ce3caabeb3d177484073674e155cd2cb1c05bdf3a65eedf1bd5b0de`。
- 精确锚点：`threadWorkspace.newTab.tools.heading` @ 12719；`threadWorkspace.newTab.terminal.openBottom` @ 16388；`threadWorkspace.newTab.plugins.heading` @ 14445。
- 证据/限制：工具列表受上下文与权限限制。

## 终端与浏览器：内置浏览器设备模拟和扩展管理

- 原包成员：`webview/assets/toolbar-action-group-5285460fad8f.js`，SHA-256 `77ea576e6e13f397cbca4472503f945e412837cac948a4343a424fc1e5f31f24`。
- 精确锚点：`thread.browser.deviceToolbar.width` @ 32187；`thread.browser.deviceToolbar.iphone15Pro` @ 47416；`thread.browser.extensions.manage` @ 136561。
- 证据/限制：原生浏览器与普通 iframe 能力差异需单列。

## 终端与浏览器：网站工具的读/写分类与近期使用

- 原包成员：`webview/assets/toolbar-action-group-5285460fad8f.js`，SHA-256 `77ea576e6e13f397cbca4472503f945e412837cac948a4343a424fc1e5f31f24`。
- 精确锚点：`thread.browser.webMcpTools.read` @ 76560；`thread.browser.webMcpTools.readWrite` @ 76916；`thread.browser.webMcpTools.recentlyUsedSiteToolsWithCount` @ 83927。
- 证据/限制：仅证明工具展示，权限和操作执行未知。

## 通知与跨端：完成、审批、提问提醒与系统权限

- 原包成员：`webview/assets/notifications-settings-f978129b87c5.js`，SHA-256 `0c215179267e75cd7679076f32b008de6c3e5455b35f34e1718165c7a88fa1e0`。
- 精确锚点：`notifications.turnMode.off` @ 6283；`notifications.turnMode.unfocused` @ 6467；`notifications.turnMode.always` @ 6695；`notifications.permissions.label` @ 5973；`notifications.questions.label` @ 6139。
- 证据/限制：系统通知和网页通知能力不同。

## 通知与跨端：自定义音效大小/时长限制

- 原包成员：`webview/assets/notifications-settings-f978129b87c5.js`，SHA-256 `0c215179267e75cd7679076f32b008de6c3e5455b35f34e1718165c7a88fa1e0`。
- 精确锚点：`notifications.sound.importError` @ 7631；`notifications.sound.previewError` @ 8069；`notifications.sound.choose` @ 10965。
- 证据/限制：媒体持久化与播放条件待验。

## 通知与跨端：设备发现与控制、授权设备及撤销

- 原包成员：`webview/assets/remote-connections-settings-4dd0ca54883c.js`，SHA-256 `7482aef813a976818871f69b226660c46f6c70c239c82b92e6ee5ac26a7c5183`。
- 精确锚点：`settings.remoteConnections.localHost.remoteControl.label` @ 21564；`settings.remoteConnections.remoteControlClients.authorized` @ 16901；`settings.remoteConnections.remoteControlClients.revoke` @ 15087。
- 证据/限制：区别 SSH 主机与授权设备 relay；官方服务边界需验。

## 云端：云环境仓库、共享、脚本、变量/密钥、网络

- 原包成员：`webview/assets/cloud-environment-editor-8052c3f6abcc.js`，SHA-256 `bb25ed7765abdc0ec2dfd53a2aee1d13abee8a382a18f2549b65a331a28b1bd9`。
- 精确锚点：`settings.cloudEnvironments.editor.repository.select` @ 25360；`settings.cloudEnvironments.editor.secrets` @ 7845；`settings.cloudEnvironments.editor.setup.mode` @ 29896；`settings.cloudEnvironments.editor.network` @ 17634。
- 证据/限制：服务端身份/策略不可从 UI 推断。

## 云端：网络策略拒绝及域名限制

- 原包成员：`webview/assets/cloud-environment-editor-8052c3f6abcc.js`，SHA-256 `bb25ed7765abdc0ec2dfd53a2aee1d13abee8a382a18f2549b65a331a28b1bd9`。
- 精确锚点：`settings.cloudEnvironments.network.policy.blocked` @ 17042；`settings.cloudEnvironments.network.off.description` @ 17301；`settings.cloudEnvironments.editor.network.allowedDomains` @ 20742。
- 证据/限制：有 policy 条件分支，实施须核对 API/授权。
## 导航与快捷键：命令面板：搜索聊天、任务、设置、侧栏

- 原包成员：`webview/assets/command-messages-5647543f3fe2.js`，SHA-256 `c684e34a464c312735316dbb426f4b85ebc7018d5e01232af1588dcaecc463b8`。
- 精确锚点：`codex.command.searchChats` @ 20758；`codex.command.manageTasks` @ 24961；`codex.command.toggleSidebar` @ 25708；`codex.command.settings` @ 23974。
- 证据/限制：仅有命令消息定义，快捷键默认绑定与可达性须动态核对。

## 导航与快捷键：新建独立聊天、弹出窗口与侧聊聚焦

- 原包成员：`webview/assets/command-messages-5647543f3fe2.js`，SHA-256 `c684e34a464c312735316dbb426f4b85ebc7018d5e01232af1588dcaecc463b8`。
- 精确锚点：`codex.command.newProjectlessTask` @ 10639；`codex.command.openThreadInNewWindow` @ 10973；`codex.command.focusMainChat` @ 12957；`codex.command.focusSideChat` @ 13119。
- 证据/限制：窗口原生能力在 Web 端的映射要单独确认。

## 导航与快捷键：文件代码导航和查找

- 原包成员：`webview/assets/command-messages-5647543f3fe2.js`，SHA-256 `c684e34a464c312735316dbb426f4b85ebc7018d5e01232af1588dcaecc463b8`。
- 精确锚点：`codex.command.file.goToDefinition` @ 27625；`codex.command.file.findReferences` @ 27807；`codex.command.findInThread` @ 28364。
- 证据/限制：命令标签不证明语言服务器已就绪。

## 聊天与历史：会话正文错误边界及重试

- 原包成员：`webview/assets/local-conversation-thread-2f594f841b07.js`，SHA-256 `af8e8ab2e97566d25d69249ef8adf5a86d0bf0bbf4c306e4fbc50c80e8837263`。
- 精确锚点：`localConversation.turnRenderError.title` @ 310840；`localConversation.turnRenderError.retry` @ 311104；`localConversation.historyLoadFailed` @ 392187。
- 证据/限制：需区分正文渲染失败、历史加载失败和任务运行状态。

## 聊天与历史：上下文使用量

- 原包成员：`webview/assets/local-conversation-page-50ae20551907.js`，SHA-256 `b1293967bb28331c9b90c987c795a24f5ee9f93e1abe6a638e8b82d0bcad89d7`。
- 精确锚点：`threadUsagePopover.title` @ 20947；`threadUsagePopover.unavailable` @ 23241；`threadUsagePopover.reasoning` @ 26305。
- 证据/限制：运行时额度数据可能依账户和服务能力。

## 输入与附件：文件/照片、语音与计划模式入口

- 原包成员：`webview/assets/command-messages-5647543f3fe2.js`，SHA-256 `c684e34a464c312735316dbb426f4b85ebc7018d5e01232af1588dcaecc463b8`。
- 精确锚点：`codex.command.composer.addFiles` @ 17065；`codex.command.composer.addPhotos` @ 16892；`codex.command.composer.toggleDictation` @ 14860；`codex.command.composer.togglePlanMode` @ 18087。
- 证据/限制：命令定义属于静态候选，权限与设备能力需验。

## 输入与附件：引用聊天、先前上下文与 PR 附件

- 原包成员：`webview/assets/composer-content-b926d24ef280.js`，SHA-256 `cf56f37714e14488239f4eb715b845067e75f8c2e98851c768c4110d3eb6fd08`。
- 精确锚点：`composer.sharedThreadAttachment.identity` @ 84260；`composer.priorContext.label` @ 78809；`composer.pullRequestAttachment.label` @ 68469。
- 证据/限制：各类附件采集及发出的快照格式需独立验证。

## 输入与附件：本机与云端后续任务去向

- 原包成员：`webview/assets/composer-utility-bar-882e7f195cb9.js`，SHA-256 `8b98c57a802d977612e7d7516013b51cd369ce71fc31ce290589ad0d75f2254a`。
- 精确锚点：`composer.cloudFollowUp.local` @ 22369；`composer.cloudFollowUp.cloud` @ 22471；`composer.remote.currentEditsSuffix.followUp` @ 24195。
- 证据/限制：传输、Git 修改和运行身份语义需要实际服务证据。

## 项目运行环境：项目启动脚本与动作

- 原包成员：`webview/assets/local-conversation-thread-2f594f841b07.js`，SHA-256 `af8e8ab2e97566d25d69249ef8adf5a86d0bf0bbf4c306e4fbc50c80e8837263`。
- 精确锚点：`threadPage.runAction.setup.commandLabel` @ 83898；`threadPage.runAction.environment.createManually` @ 97838；`threadPage.runAction.environment.createWithCodex` @ 97146。
- 证据/限制：用户手势、进程归属与授权边界需要现场验收。

## 项目运行环境：后台 Agent/终端独立停止入口

- 原包成员：`webview/assets/local-conversation-thread-2f594f841b07.js`，SHA-256 `af8e8ab2e97566d25d69249ef8adf5a86d0bf0bbf4c306e4fbc50c80e8837263`。
- 精确锚点：`codex.localConversation.backgroundAgents.openSummary` @ 57371；`codex.localConversation.backgroundTerminals.stop` @ 54269；`codex.localConversation.backgroundTerminals.cleanError` @ 59765。
- 证据/限制：不等于授权自动终止历史任务或批量任务。

## 工件与输出：生成文件和项目预览的打开/复制

- 原包成员：`webview/assets/local-conversation-turn-e1ee3114316e.js`，SHA-256 `5418f035bacae03b6c31c59bec56bccc0f5b5dd959d9889b0847120834bddb48`。
- 精确锚点：`localConversation.endResource.downloadCopy` @ 39131；`localConversation.endResource.openResource` @ 39767；`localConversation.endResource.websiteTitle` @ 46049。
- 证据/限制：本地文件、外部链接和云引用需分离权限。

## 审查与 Diff：大 Diff 降载和异常恢复

- 原包成员：`webview/assets/thread-side-panel-tab-content-d2b583a29734.js`，SHA-256 `25c015eaf9f8e76c93503deb6f26b6cac948b466c7e16f50b39664b0cca01ff7`。
- 精确锚点：`codex.review.largeDiff.banner` @ 79858；`codex.review.largeDiff.previousFile` @ 80106；`codex.review.largeDiff.nextFile` @ 80679。
- 证据/限制：需对照无效数据及大文件内存预算。

## 插件 Skills MCP：MCP Apps 缓存管理

- 原包成员：`webview/assets/plugins-settings-7a89487c0c4c.js`，SHA-256 `84d642678aab6059f3bb51b8d64d2e0f88c1f09200a46d166805e9c59d984935`。
- 精确锚点：`settings.mcp.apps.data.description` @ 5579；`settings.mcp.apps.clearData` @ 4610。
- 证据/限制：清理是实际副作用，需保留显式动作。

## 终端与浏览器：站点批注可用/不可用状态

- 原包成员：`webview/assets/tab-content-8de26932704b.js`，SHA-256 `206928f06d69f263dc27e7375f361f9009917113a36e0a6ec146186969282afc`。
- 精确锚点：`thread.browser.commentModeUnavailableForSite` @ 100729；`thread.browser.siteTools.annotationFeaturesUpdateFailed` @ 103860。
- 证据/限制：站点能力与来源隔离不能仅依据 UI 控件推定。

## 通知与跨端：连接失败及需要重新登录的错误恢复

- 原包成员：`webview/assets/remote-connections-settings-4dd0ca54883c.js`，SHA-256 `7482aef813a976818871f69b226660c46f6c70c239c82b92e6ee5ac26a7c5183`。
- 精确锚点：`settings.remoteConnections.remoteControlClients.loadError.authRequired` @ 29775；`settings.remoteConnections.remoteControlClients.loadError.retry` @ 30385。
- 证据/限制：设备控制和远程机器 SSH 是不同链路。
