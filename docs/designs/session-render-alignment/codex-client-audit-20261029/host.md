# 宿主、生命周期与协议桥接审计

固定 VSIX 26.51007.21434，项目 f6699ba；2026-10-29。只读审计，不实施功能。所有偏移是零基UTF-16；manifest hash是package.json文件hash，不是VSIX hash。

## 24项对照

| ID | 功能/状态域 | 官方实际锚（out/extension.js，UTF-16） | 当前实现/证据 | 当前判断 |
|---|---|---|---|---|
| H01 | 扩展注册与入口 | manifest：onStartupFinished/onUri、sidebar/custom editor/chatSessions | host-manifest-inventory.json；packages/native-codex-host | 注册存在，不等于运行就绪；禁用 implementTodo 不算可用功能 |
| H02 | 命令/快捷键/设置 | 10 commands、1 Ctrl/Cmd+N、8 settings；存在 when/enablement | host-manifest-inventory.json；SessionTopNavigation/ComposerEnterSettings | 网页入口与 VS Code 命令宿主不同；共享快捷键设置不能假定全部开放 |
| H03 | provider/Webview 初始化 | Ch.initializeWebview @2306857；sidebar @2299450；custom editor @2301667 | packages/native-codex-host/companion/extension.cjs；apps/web/src/codex-mode | 自有 companion 捕获 provider、核精确官方版本；不是重写 VSIX |
| H04 | ready 与待发送消息 | Ch.onPanelReady @2309581；sendMessageToPanel @2309789 | apps/web/src/codex-mode；native gateway | HTTP/opened/frame 可见都不证明 composer 交互/实际接受；需精确目标证据 |
| H05 | 隐藏上下文保持 | Ch.createEditorPanel @2311448 retainContextWhenHidden:true | 独立 Codex iframe 保持挂载；Session 正文另按内存约定回收 | 有意架构差异：保留任务，不把 iframe 存活当正文内存无界的理由 |
| H06 | 多 editor/文档 | supportsMultipleEditorsPerDocument:false；Ch.editorPanels + ensurePanel @2312141 | SessionTabs/多窗 与 native profile/column 路由 | 同文档限制不等于整个扩展只能开一个窗口；网页pane也不等于独立宿主 |
| H07 | 本地 app-server 生命周期 | uF.startCodexProcess @2191051、teardownProcess @2193732、dispose @2203342 | Session runtime 独立进程；native host service | 两条运行链独立；重启/附着不得因页面恢复隐式停止别的任务 |
| H08 | RPC/通知/请求回到原 Webview | mcp-request @2317779、notification @2318547、response @2318656；deliverMcpResponseToOrigin @2327909 | Session runtime 原生服务及 request/token scope | 必须保留来源身份，不能 broadcast response 或用另一 writer 代发 |
| H09 | 请求预热/放弃 | thread-prewarm-start @2318219、mcp-request-abandon @2318399 | 当前 Session 只读恢复与显式发送流程 | 预热、放弃等待、native cancel/interrupt 是不同语义；本轮不把它们互相推导 |
| H10 | 共享对象订阅/写入 | shared-object-subscribe @2321364、shared-object-set @2321476 | 看板 stores/journal/revision/outbox | 共享对象存在不证明与看板跨设备关注集合等价，不能强行合并数据域 |
| H11 | 持久 atom 同步/更新/重置 | persisted-atom-* @2312529..2312816；readPersistedAtomState @2310904 | useThreadModelStore/本地偏好/IDB | 按 thread 事务、意图和 scope 保存；nativePermissionMetadata 不落盘是项目规则 |
| H12 | 客户端协调/已读状态 | registerClientCoordinationForWebview @2305275；getThreadReadStateContext @2324951 | 看板 attention 与 native 元数据分开 | LG18 未读写入域不同；真实多宿主同步未在本轮闭合 |
| H13 | 可能写出后的失败投递 | uF.failPendingRequests @2194364：failed + delivery.stage=outcome-unknown | companion/appserver-send.cjs:125-133,170；G25 | 隔离复现风险：failed 被误当 definite rejection 删除 receipt；默认 Session 发送无该调用 |
| H14 | 桥接发送准入 | uF provider/sendRequest @2195702/2195911；精确 target 路由 | companion/appserver-send.cjs:152-168 | 当前桥有版本、column/editor URI、cwd、thread idle、submissionId/hash保护；这些不消除H13分类问题 |
| H15 | 刷新目标/实例隔离 | Ch.resolveCustomEditor @2301667；initialRoute/pendingMessages | apps/server/src/routes/native-codex.ts；native-codex-gateway.ts | 固定profile/UUID/instance，不得因旧目标失联回退另一宿主；当前并非所有存量宿主自动启用原型 |
| H16 | 私有刷新原型/租约/保温 | 官方客户端连接/协调；无本项目同名refresh manager | packages/native-codex-host/refresh-prototype | 项目独有可选原型；授权锚/资源预算/租约保护存在，正式自动启用和全矩阵仍未完成 |
| H17 | 历史只读与工具正文投影 | Webview local history 与 native list/turn metadata | packages/session-runtime/src；thread/turns/list?view=chat | 项目独立只读通道、不resume/acquire、接收前裁正文；保留32MiB RPC/16MiB chat边界 |
| H18 | 字体/语言/宿主设置 | Ch.getChatFontSettings @2310170；localeOverride/extension settings | 会话 .session-mode 样式与设置；open-extension-settings @2319331 | 宿主font/locale与页面主题需分别记录；不是CSS近似便认定全部对齐 |
| H19 | diff/plan/open 文件容器 | show-diff @2320437、show-plan-summary @2320553、open-vscode-command @2319136 | features/git、PlanContentItem、features/vscode | 浏览器侧栏/下载/保留iframe 是适配容器；原生目标与可用动作需逐项核对 |
| H20 | IDE上下文与文件加入 | manifest addToThread/addFileToThread；Ch.addContextFile @2303306 | ComposerMenu/ContextAttachments、/ide；G01/G21 | 有手动文件能力不等于自动 IDE context；/ide 当前入口死路已确认 |
| H21 | worker/fetch 取消 | worker-request/cancel @2319221/2319242；fetch/cancel @2321013/2321120 | 自有 HTTP/API/文件读取超时与取消 | 该取消不是停止 native turn；共享fetch能力不证明支持任意云端动作 |
| H22 | fatal与显式重启 | Ch.reportAppServerFatalError @2298370；codex-app-server-restart @2316481 | runtime status/recovery、显式UI恢复 | fatal/传输断线/turn failed 分层；本轮不执行正式restart，不能宣称恢复已测 |
| H23 | 本机环境/WSL/CLI设置 | manifest cliExecutable/openOnStartup/runCodexInWindowsSubsystemForLinux | native host launcher/preload/service config | 跨宿主环境纪律不同；不硬编码机器端口，不继承任意NODE_OPTIONS；Windows行为本轮未验 |
| H24 | 实际部署与包身份 | 安装目录manifest/extension.js/index.html与固定原包一致 | host-runtime-status.json：host-ready-awaiting-browser，sendAvailable:false | 只读可达/已安装一致；未激活浏览器broker、真账号或完整turn，不能称端到端通过 |

## 10 commands

| command | title | enablement / gate |
|---|---|---|
| `chatgpt.implementTodo` | Implement with Codex | `false` |
| `chatgpt.openSidebar` | Open Codex Sidebar | `按注册/菜单上下文` |
| `chatgpt.openCommandMenu` | Open Codex Command Menu | `按注册/菜单上下文` |
| `chatgpt.newCodexPanel` | New Codex Agent | `按注册/菜单上下文` |
| `chatgpt.addToThread` | Add to Codex Thread | `按注册/菜单上下文` |
| `chatgpt.addFileToThread` | Add File to Codex Thread | `按注册/菜单上下文` |
| `chatgpt.newChat` | New Chat in ChatGPT Sidebar | `按注册/菜单上下文` |
| `chatgpt.showLspMcpCliArgs` | Copy Codex CLI args for LSP MCP | `按注册/菜单上下文` |
| `chatgpt.dumpNuxState` | Debug: print NUX state to console | `chatgpt.sidebarView.visible` |
| `chatgpt.resetNuxState` | Debug: reset NUX state | `chatgpt.sidebarView.visible` |

## 8 settings

| setting | default | enum / type |
|---|---|---|
| `chatgpt.commentCodeLensEnabled` | `true` | `"boolean"` |
| `chatgpt.cliExecutable` | `null` | `["string", "null"]` |
| `chatgpt.openOnStartup` | `false` | `"boolean"` |
| `chatgpt.followUpQueueMode` | `"queue"` | `["queue", "steer", "interrupt"]` |
| `chatgpt.composerEnterBehavior` | `"enter"` | `["enter", "cmdIfMultiline", "cmdAlways"]` |
| `chatgpt.reviewDelivery` | `"inline"` | `["inline", "detached"]` |
| `chatgpt.localeOverride` | `null` | `["string", "null"]` |
| `chatgpt.runCodexInWindowsSubsystemForLinux` | `false` | `"boolean"` |

唯一注册快捷键：`chatgpt.newChat`，ctrl+n / mac cmd+n，when=`chatgpt.supportsNewChatKeyShortcut`。完整menus/views/customEditors/chatSessions/languages在host-manifest-inventory.json。

## 主分发器全部154个case

实际读取Ch.handleMessage @2312471..2322286：29 implemented、120 explicit-no-op、5 explicit-unsupported。这是Webview桥接主switch，不是所有原生RPC全集。分组fallthrough按最终执行体分类；共享archive/electron/browser字符串不能凭出现就当支持。原体摘要见host-message-cases-classified.json。

| case | 分类 | 原包 UTF-16 offset |
|---|---|---:|
| `ready` | explicit-no-op | 2312511 |
| `persisted-atom-sync-request` | implemented | 2312529 |
| `persisted-atom-update` | implemented | 2312607 |
| `persisted-atom-reset` | implemented | 2312737 |
| `browser-sidebar-webview-destroyed` | explicit-no-op | 2312816 |
| `inbox-item-set-read-state` | explicit-no-op | 2312862 |
| `inbox-automation-runs-mark-all-read` | explicit-no-op | 2312894 |
| `inbox-items-create` | explicit-no-op | 2312936 |
| `local-thread-activity-changed` | explicit-no-op | 2312967 |
| `subagent-thread-full-fidelity-changed` | explicit-no-op | 2313009 |
| `app-shell-shortcut-state-changed` | explicit-no-op | 2313059 |
| `electron-window-zoom-changed` | explicit-no-op | 2313098 |
| `keyboard-layout-map-changed` | explicit-no-op | 2313133 |
| `browser-sidebar-runtime-close-comment-preview` | explicit-no-op | 2313173 |
| `browser-sidebar-runtime-open-comment-preview` | explicit-no-op | 2313225 |
| `global-dictation-enabled-changed` | explicit-no-op | 2313276 |
| `global-dictation-force-lock-changed` | explicit-no-op | 2313315 |
| `browser-sidebar-comment-overlay-close` | explicit-no-op | 2313363 |
| `browser-sidebar-comment-overlay-delete` | explicit-no-op | 2313407 |
| `browser-sidebar-comment-overlay-mounted` | explicit-no-op | 2313452 |
| `browser-sidebar-comment-overlay-preview-open-changed` | explicit-no-op | 2313498 |
| `browser-sidebar-comment-overlay-design-scrub-changed` | explicit-no-op | 2313557 |
| `browser-sidebar-comment-overlay-annotation-selection-hover-state` | explicit-no-op | 2313616 |
| `browser-sidebar-comment-overlay-annotation-selection-modifier-state` | explicit-no-op | 2313687 |
| `browser-sidebar-comment-overlay-annotation-selection-pointer-state` | explicit-no-op | 2313761 |
| `browser-sidebar-comment-overlay-remove-annotation-selection` | explicit-no-op | 2313834 |
| `browser-sidebar-comment-overlay-submit` | explicit-no-op | 2313900 |
| `browser-sidebar-comment-overlay-tweaks-open-changed` | explicit-no-op | 2313945 |
| `browser-sidebar-design-overlay-add` | explicit-no-op | 2314003 |
| `browser-sidebar-design-overlay-delete` | explicit-no-op | 2314044 |
| `browser-sidebar-design-overlay-update` | explicit-no-op | 2314088 |
| `browser-sidebar-runtime-cancel-editor` | explicit-no-op | 2314132 |
| `browser-sidebar-runtime-design-modifier-state` | explicit-no-op | 2314176 |
| `browser-sidebar-runtime-annotation-selection-modifier-state` | explicit-no-op | 2314228 |
| `browser-sidebar-runtime-annotation-suspension` | explicit-no-op | 2314294 |
| `browser-sidebar-attach-dragged-image` | explicit-no-op | 2314346 |
| `browser-sidebar-runtime-exit-comment-mode` | explicit-no-op | 2314389 |
| `browser-sidebar-runtime-toggle-annotation-mode` | explicit-no-op | 2314437 |
| `browser-sidebar-runtime-request-annotation-permission` | explicit-no-op | 2314490 |
| `browser-sidebar-command` | explicit-no-op | 2314550 |
| `open-browser-tab` | explicit-no-op | 2314580 |
| `browser-sidebar-runtime-focus-editor` | explicit-no-op | 2314603 |
| `browser-sidebar-runtime-image-drag-ended` | explicit-no-op | 2314646 |
| `browser-sidebar-runtime-image-drag-started` | explicit-no-op | 2314693 |
| `browser-sidebar-runtime-mouse-navigation` | explicit-no-op | 2314742 |
| `browser-sidebar-runtime-open-design-editor` | explicit-no-op | 2314789 |
| `browser-sidebar-runtime-open-editor` | explicit-no-op | 2314838 |
| `browser-sidebar-runtime-comment-screenshot-ready` | explicit-no-op | 2314880 |
| `browser-sidebar-runtime-update-anchor` | explicit-no-op | 2314935 |
| `browser-settings-webview-mounted` | explicit-no-op | 2314979 |
| `browser-settings-webview-theme-changed` | explicit-no-op | 2315018 |
| `browser-settings-webview-unmounted` | explicit-no-op | 2315063 |
| `browser-sidebar-sync` | explicit-no-op | 2315104 |
| `browser-use-session-route-capture` | explicit-no-op | 2315137 |
| `browser-use-cursor-arrived` | explicit-no-op | 2315177 |
| `browser-use-session-activity-ended` | explicit-no-op | 2315210 |
| `browser-sidebar-owner-sync` | explicit-no-op | 2315251 |
| `pending-worktree-cancel` | explicit-no-op | 2315290 |
| `pending-worktree-create` | explicit-no-op | 2315320 |
| `pending-worktree-dismiss` | explicit-no-op | 2315350 |
| `pending-worktree-retry` | explicit-no-op | 2315381 |
| `pending-worktree-continue` | explicit-no-op | 2315410 |
| `pending-worktree-update-metadata` | explicit-no-op | 2315442 |
| `heartbeat-automation-thread-state-changed` | explicit-no-op | 2315481 |
| `codex-runtimes-config-changed` | explicit-no-op | 2315535 |
| `archive-thread` | explicit-no-op | 2315577 |
| `avatar-overlay-element-size-changed` | explicit-no-op | 2315604 |
| `avatar-overlay-drag-end` | explicit-no-op | 2315646 |
| `avatar-overlay-drag-move` | explicit-no-op | 2315676 |
| `avatar-overlay-drag-release` | explicit-no-op | 2315707 |
| `avatar-overlay-drag-start` | explicit-no-op | 2315741 |
| `avatar-overlay-close` | explicit-no-op | 2315773 |
| `avatar-overlay-hide` | explicit-no-op | 2315800 |
| `avatar-overlay-open` | explicit-no-op | 2315826 |
| `avatar-overlay-open-state-request` | explicit-no-op | 2315852 |
| `avatar-overlay-keyboard-interaction-changed` | explicit-no-op | 2315892 |
| `avatar-overlay-pointer-interaction-changed` | explicit-no-op | 2315942 |
| `mac-menu-bar-enabled-changed` | explicit-no-op | 2315991 |
| `debug-run-eval-control-request` | explicit-no-op | 2316026 |
| `debug-run-eval-control-response` | explicit-no-op | 2316063 |
| `debug-window-client-analytics-history-changed` | explicit-no-op | 2316101 |
| `debug-window-origin-conversation-changed` | explicit-no-op | 2316153 |
| `dynamic-tools-for-thread-start-response` | explicit-no-op | 2316200 |
| `open-codex-bundle` | explicit-no-op | 2316246 |
| `quit-app` | explicit-no-op | 2316270 |
| `reload-bundled-plugins` | explicit-no-op | 2316285 |
| `set-primary-runtime-install-release` | explicit-no-op | 2316314 |
| `toggle-trace-recording` | explicit-no-op | 2316356 |
| `tray-menu-threads-changed` | explicit-no-op | 2316385 |
| `unarchive-thread` | explicit-no-op | 2316423 |
| `power-save-blocker-set` | explicit-no-op | 2316446 |
| `codex-app-server-restart` | implemented | 2316481 |
| `view-focused` | implemented | 2316579 |
| `checkout-webview-presentation-changed` | explicit-no-op | 2316638 |
| `workspace-settings-webview-presentation-changed` | explicit-no-op | 2316682 |
| `electron-window-focus-request` | explicit-no-op | 2316736 |
| `electron-avatar-overlay-feedback-diagnostics-changed` | explicit-no-op | 2316778 |
| `electron-avatar-overlay-restore-ready` | explicit-no-op | 2316837 |
| `electron-sparkle-gates-changed` | explicit-no-op | 2316887 |
| `remote-hosted-pip-active-thread-changed` | explicit-no-op | 2316930 |
| `remote-hosted-pip-host-layout-changed` | explicit-no-op | 2316976 |
| `electron-desktop-features-changed` | explicit-no-op | 2317026 |
| `browser-sidebar-tweaks-enabled-changed` | explicit-no-op | 2317072 |
| `browser-sidebar-annotation-multi-select-enabled-changed` | explicit-no-op | 2317117 |
| `browser-sidebar-site-annotation-api-enabled-changed` | explicit-no-op | 2317179 |
| `open-in-main-window` | explicit-no-op | 2317243 |
| `open-browser-in-main-window` | explicit-no-op | 2317269 |
| `open-current-main-window` | explicit-no-op | 2317303 |
| `open-in-new-window` | explicit-no-op | 2317334 |
| `global-dictation-pet-renderer-ready` | explicit-no-op | 2317359 |
| `global-dictation-renderer-ready` | explicit-no-op | 2317401 |
| `global-dictation-stop-requested` | explicit-no-op | 2317439 |
| `global-dictation-pointer-interaction-changed` | explicit-no-op | 2317477 |
| `global-dictation-recording-stopped` | explicit-no-op | 2317528 |
| `global-dictation-dismiss` | explicit-no-op | 2317569 |
| `global-dictation-close` | explicit-no-op | 2317600 |
| `global-dictation-completed` | explicit-no-op | 2317629 |
| `global-dictation-record-history-item` | explicit-no-op | 2317662 |
| `global-dictation-in-app-started` | explicit-no-op | 2317705 |
| `global-dictation-failed` | explicit-no-op | 2317743 |
| `mcp-request` | implemented | 2317779 |
| `thread-prewarm-start` | implemented | 2318219 |
| `mcp-request-abandon` | implemented | 2318399 |
| `mcp-notification` | implemented | 2318547 |
| `mcp-response` | implemented | 2318656 |
| `open-in-browser` | implemented | 2318754 |
| `navigate-in-new-editor-tab` | implemented | 2318824 |
| `open-vscode-command` | implemented | 2319136 |
| `worker-request` | implemented | 2319221 |
| `worker-request-cancel` | implemented | 2319242 |
| `open-extension-settings` | implemented | 2319331 |
| `open-keyboard-shortcuts` | implemented | 2319450 |
| `open-config-toml` | implemented | 2319566 |
| `set-telemetry-user` | implemented | 2319885 |
| `install-wsl` | implemented | 2320141 |
| `show-diff` | implemented | 2320437 |
| `show-plan-summary` | implemented | 2320553 |
| `show-settings` | implemented | 2320684 |
| `update-diff-if-open` | implemented | 2320752 |
| `fetch` | implemented | 2321013 |
| `cancel-fetch` | implemented | 2321120 |
| `log-message` | implemented | 2321186 |
| `electron-app-state-snapshot-trigger` | explicit-no-op | 2321273 |
| `electron-app-state-snapshot-response` | explicit-no-op | 2321315 |
| `shared-object-subscribe` | implemented | 2321364 |
| `shared-object-unsubscribe` | explicit-no-op | 2321438 |
| `shared-object-set` | implemented | 2321476 |
| `electron-set-window-mode` | explicit-no-op | 2321554 |
| `electron-pick-workspace-root-option` | explicit-unsupported | 2321591 |
| `electron-onboarding-skip-workspace` | explicit-unsupported | 2321718 |
| `electron-add-new-workspace-root-option` | explicit-unsupported | 2321843 |
| `electron-create-new-workspace-root-option` | explicit-unsupported | 2321976 |
| `electron-update-workspace-root-options` | explicit-unsupported | 2322115 |
| `electron-set-badge-count` | explicit-no-op | 2322248 |

## 投递风险的隔离验证

原包`uF.failPendingRequests` @2194364..2194662在连接关闭时发出`type:"failed", delivery.stage:"outcome-unknown"`。本地onRequestDelivery仅看type failed，标knownRejected并删除pending receipt。fake连接/私有临时回执文件对照：此shape首发503、receipt=0、同ID第二次显式send可调用第二次turn/start；对照type outcome-unknown首发409、receipt=1，二次409且turn/start仅1次。

这是本地重准入语义复现，不证明native已接受第一条、真实重复执行或UI可达。当前sendToNativeCodex只在导出与测试出现，没有生产UI调用；风险仅适用于显式companion send API，不适用于默认Session提交链。证据host-delivery-risk-repro.json；本轮未修改或补运行层测试。
