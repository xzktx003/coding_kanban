# 当前会话模式与 Mac 静态候选前 27 项逐条对照

时间：2026-11-03。此文仅是源码与仓库文档的只读审计，无浏览器、真实 Mac 应用、真实账号或 Agent 动态验收。待比对的 Mac 版本 26.1027.61615 的静态锚点见 docs/designs/chatgpt-desktop-mode-20261103/original-static-features.md:3-165；字符串、局部代码分支和可达/可运行功能不同。编号与该文前 27 个二级标题严格对应。下面的“已有”只指**旧会话模式源码中的所列能力**，不表示已证明 1:1 或证明新第四模式已实现。其余旧终端、Codex 模式不在此表结论之内。

路径约定：SM 指 /data01/home/xing.hu/vibe_codings/coding_kanban/apps/web/src/session-mode，仓库其他路径相对 /data01/home/xing.hu/vibe_codings/coding_kanban。行号一律为源码现时 1-based 行；记录已有组件/分支不等于已验证其部署版本或线上能力。

云能力特别说明：本次对 `apps/web/src` 的生产代码有界搜索只找到 `CloudTasksPanel.tsx` 的定义，未找到生产引入点。下文引用该文件仅证明候选代码存在，不证明当前会话界面可进入云任务页面，更不证明真实云功能可用；参见后半部分对照第 38 项。

## 1. Codex 模型目录加载与重试 — 明确差异（限所见 UI 分支）
- 证据：SM/components/codex/hooks/useModels.ts:29,64,77-83,230-232 有 pending/success/error 与 reload；SM/components/codex/composer/NativeModelSelector.tsx:274-279 对 OpenAI 目录错误禁选，1010-1016 的加载、错误与重试按钮分支只适用非 OpenAI provider。
- 边界：Mac 静态键显示模型加载/重试候选，尚未动态验证其可达状态；不可单靠此处断言旧产品全局没有其他 Codex 重试入口或目录来源一致。

## 2. 推理强度选择 — 已有（限所列代码）
- 证据：SM/components/codex/composer/NativeModelSelector.tsx:250-268,280-303 结合原生模型目录推理档位及当前选择。
- 边界：未验证真实目录各模型/账号所有档位、远程和云端表现或 Mac 外观。

## 3. 请求批准、自动审核、完全访问、自定义及组织策略 — 部分
- 证据：SM/components/codex/composer/AccessModePopover.tsx:20-68,74-115,197-211 提供权限选项、以原生能力门控自动审核及配置选择；SM/components/codex/composer/PermissionProfiles.tsx:102-123 按服务端 allowed 禁用配置。
- 边界：不可从前端选项推断实际 sandbox 执行、组织配置完整映射或新 Mac 的策略契约；需受控账号与运行实例验证。

## 4. requirements.toml 或云模式约束 — 部分
- 证据：SM/components/codex/composer/PermissionProfiles.tsx:102-123 显示策略禁用；SM/features/codex-host/CloudTasksPanel.tsx:115-139 根据能力阻止不可用操作。
- 边界：上述来源不证明与 Mac 的 requirements.toml 原因显示一致，也不证明云执行位置与权限菜单联动；真实组织要求和云条件未验。

## 5. 完全访问的确认流程 — 已有（限所列代码）
- 证据：SM/components/codex/composer/AccessModePopover.tsx:103-112 在选择 danger-full-access 前走确认；SM/components/codex/composer/NativeFullAccessConfirmation.tsx:14 开始定义确认界面。
- 边界：未验证 Mac 的文案/视觉、所有入口及实际权限策略；不操作真实权限。

## 6. 待审批卡片及自动审查 — 部分
- 证据：SM/components/codex/items/ApprovalItem.tsx:39-99 处理审批选项和目标；SM/components/codex/composer/AccessModePopover.tsx:88-99 门控自动审查；SM/components/codex/composer/AutoReviewDenialsSheet.tsx:33-62 展示自动审核拒绝相关 UI。
- 边界：可用决定取决于运行时原生请求；未用真实审批验证全套作用域、回执及 Mac 等价性。

## 7. 发送、排队、引导和中断 — 部分
- 证据：SM/components/codex/composer/Composer.tsx:295-306,451-452,715-738,1192-1213；docs/designs/session-mode-implementation-20261029/shared-management.md:7-11 记录队列调度和未知回执约束。
- 边界：源码有对应交互和调度意图，但跨设备竞争、真实写入成功、异常恢复和 Mac 的具体状态机未在本轮验证。

## 8. 中断后暂停队列时发送确认 — 部分
- 证据：SM/components/codex/composer/Composer.tsx:312-328,731-738 会读取中断/暂停并提示；SM/components/codex/composer/FollowupQueue.tsx:208-224,253-260 对恢复保存队列和暂停原因有确认/状态。
- 边界：恢复旧消息的确认不等于 Mac 静态锚点所指的暂停队列后新发送确认；后者是否具备、先后顺序及执行结果仍待专门验证。

## 9. 远程语音与附件夹限制 — 部分
- 证据：SM/features/realtime-voice/RealtimeVoiceButton.tsx:176-180,340-368 有实时语音入口、麦克风与安全连接前提；候选原文锚点实际仅表明远程项目语音提示，附件夹见第 10 条。
- 边界：未核实远程项目的功能门控，未实测语音设备与权限；不得据此推断远程语音支持或不支持。

## 10. 远程聊天的本机文件夹限制 — 部分
- 证据：SM/browser-dialog.tsx:14,44-74,91-145 区分目录选择与浏览器文件上传；SM/components/codex/composer/v2/ContextAttachments.tsx:26,49-51,157-163 区分目录引用与文件快照。
- 边界：上面不能证明远程聊天对用户本机文件夹与远端项目目录采取何种限制；静态候选亦不能证明各远程场景实际可达。

## 11. Goal 编辑、替换、暂停及 Token 预算 — 部分
- 证据：SM/features/goals/ThreadGoalCard.tsx:119-185,221,265-270,321-345；docs/session-goals.md:9-19,23-34 描述生命周期、内容与预算显示；文档第 14 行明确编辑既有目标不修改 token 预算。
- 边界：首次设定预算的全部场景及 Mac 状态转移、可编辑性需另验；未知回执不能靠重发判断成功。

## 12. 本地、worktree 和云执行位置 — 部分
- 证据：SM/features/workspace-execution/ExecutionLocationPanel.tsx:327-368 选择本地/独立工作树；SM/features/codex-host/CloudTasksPanel.tsx:115-139,149-185,225-270,375-469 有能力、环境、创建/续聊入口；apps/server/src/routes/session-codex-cloud.ts:25-49,61-113 有云路由。
- 边界：旧会话模式有云任务面板代码，不能笼统说没云；但它使用独立云任务消息字段和确认流程，尚未证明与本地/worktree 是 Mac 同一个执行位置选择器、也未证明服务器部署/真实账号可用。新模式尚未接入。

## 13. 侧栏重命名、归档、未读与 fork — 部分
- 证据：SM/components/codex/thread/ThreadList.tsx:340-376,447-474,526,574-581 处理重命名/归档/fork；SM/stores/useSessionAttentionStore.ts:64-65,83-105 定义未读状态操作。
- 边界：store 支持 markUnread 不证明该侧栏上存在同等显式入口，也不证明云/远程共享或跨端一致；归档撤销和真实 fork 未实测。

## 14. 历史加载失败、编辑失败、写入者冲突 — 部分
- 证据：SM/components/codex/thread/CodexHistoryNotice.tsx:11-40 有历史加载状态/重试；SM/components/codex/thread/CodexAccessNotice.tsx:169,210-241 提示访问或已有客户端占用与恢复；SM/features/thread-workflows/NativeInlineUserEditor.tsx 为会话消息编辑入口。
- 边界：未核对历史编辑失败分支全路径及原 Mac 的 writerConflict 分叉菜单，亦未制造并发写入或验证 writer 身份和回执。

## 15. 从历史消息分叉到原或新 worktree — 部分，精确组合未核实
- 证据：SM/features/thread-workflows/NativeMessageFork.tsx:23-98 可从消息轮次发起 fork；SM/features/thread-workflows/service.ts:12-26 只传原线程 lastTurnId；SM/features/workspace-execution/ExecutionLocationPanel.tsx:339-368 另有 worktree 选择。
- 边界：所见 fork 调用没有选择新 worktree 的参数，不能把另一个创建工作树入口当成二者已组合；未对真实项目发起 fork。

## 16. 子智能体、后台终端、创建的聊天 — 部分
- 证据：SM/features/subagents/SubagentPanel.tsx:90,240-275,284-359 有子 Agent 展示及动作；docs/session-subagents.md:3 附近规定只读恢复、身份与输入权限；终端工具在 SM/features/terminal 下。
- 边界：不能因不同面板各自存在，就断定 Mac 一处汇总的后台进程、创建聊天来源关系及权限完全等价；未操作运行任务。

## 17. 云、本分支、上一轮、未暂存/已暂存及 commit 审查 — 部分
- 证据：SM/features/git/SavedTurnDiffPanel.tsx:56-87 展示保存的轮次及基准分支、commit、未提交快照；SM/features/git/GitDiffTopBar.tsx:74-84 和 GitDiffPanel.tsx:155-168 区分暂存状态；云任务面板本身见第 12 条。
- 边界：云任务存在不证明云结果可作为此审查面板的 diff 源；“上一轮”、分支与 commit 的真实原生语义及快照/当前状态差别须逐项验证。

## 18. 大 diff、过滤、已查看和 stage 控件 — 部分
- 证据：SM/features/git/GitDiffFileItem.tsx:68-125,164-177,365-390 按文件加载及暂存；SM/features/git/GitDiffPanel.tsx:235-241,376-384 做路径筛选与批量暂存；SM/features/git/NativeGitHunkReview.tsx:25-31,48-53 有块级动作。
- 边界：上述不证明 Mac 的大 diff 阈值、已查看标记及跨设备持久化一致；写 Git 动作/丢弃变更未实测。

## 19. 仓库相对、项目相对、绝对路径及预览失败 — 部分
- 证据：SM/features/files/FileOperations.tsx:142-147,441-462 实现文件面板绝对路径及相对当前显示根目录的复制；SM/features/files/explorer/FileTreeNode.tsx:122-123 提供文件树动作。
- 边界：文件面板的相对路径不自动等同 Mac 审查里的“仓库相对”和“项目相对”两种选项；文件格式预览错误及跨根路径未验。

## 20. 设置导航、搜索、集成和 Coding 分区 — 部分
- 证据：SM/components/settings/SettingsView.tsx:35-76,85-106,127-168 有设置分区导航；SM/features/plugins/components/PluginsViewContent.tsx:102-120,132-155 在其他页面提供插件/技能/连接器内容。
- 边界：将分散页面算作同一设置 IA 会夸大一致性；Mac 风格设置内搜索、integration/Coding 分组、账号门控未确认。

## 21. 主题、背景、对比、字体与字号 — 部分
- 证据：SM/components/settings/TypographySettings.tsx:10-94 涵盖聊天/代码字体和大小；SM/components/settings/GeneralSettings.tsx:179-209,244 有主题及外观相关设置。
- 边界：不能据此断言系统 chrome 背景/对比度及精确 Mac 字体、颜色和像素表现；无 macOS 截图或视网膜对比。

## 22. 完成通知、输入队列与终端位置偏好 — 部分
- 证据：SM/components/settings/GeneralSettings.tsx:97-109 切换 queue/steer；SM/components/settings/codex/TaskSettings.tsx:25-34 有浏览器任务通知许可。
- 边界：queue/steer 不是原包静态候选中的 queue/interrupt 同一语义；默认终端放底部/右侧的持久化选项与系统原生通知未证实。

## 23. 手动创建、使用 Codex 创建及历史归档定时任务 — 部分
- 证据：SM/features/automations/AutoMationsView.tsx:76-79,202,244-249 有空白和模板创建；SM/features/automations/ManageDialog.tsx:152-173 创建任务；SM/features/automations/TaskDetailPanel.tsx:644 附近有任务详情/历史。
- 边界：手动创建不等同让 Codex 从对话创建；历史整体归档动作及权限未确认，未启动任何任务。

## 24. 时区、同一/新聊天及云本地定时限制 — 部分，现有时区呈现有明确边界
- 证据：SM/features/automations/ScheduleEditor.tsx:23-24,32-39 明示执行时间使用服务器本地时区，并从健康接口读取显示；SM/features/automations/ManageDialog.tsx:152-167 提交项目与 schedule。
- 边界：此表单不是已证实的时区选择器；同一/新聊天及云/本地日期、事件门控均未确认。Mac 锚点含时区标签不能单独证明可自由选择时区。

## 25. 云定时任务更新/删除错误及已保存但启动失败 — 部分
- 证据：SM/features/automations/ManageDialog.tsx:179-203,252-263 对现有自动化更新/删除失败提示；SM/features/codex-host/CloudTasksPanel.tsx:119-135 对一般云任务调用失败显示 error。
- 边界：前两者并未证明连接 Mac 云端定时任务，更不能证明“已保存但启动失败”与成功保存分别有可靠回执；未经真实故障注入。

## 26. 插件/技能主机切换、本地与 ChatGPT — 部分
- 证据：SM/features/plugins/components/PluginsViewContent.tsx:102-120,132-155 提供 Plugins/Skills/Connectors 与 Codex/Keke/CC 的连接器配置；SM/features/codex-host/CloudTasksPanel.tsx:115-139 单独查询云账号能力。
- 边界：Agent 种类切换不是本机/远程/ChatGPT 插件主机身份切换；云任务能力也不证明云插件安装，目标主机隔离与服务端 SSH 均需独立设计和验证。

## 27. 技能搜索、刷新、新建与安装 — 部分
- 证据：SM/features/skills/SkillsView.tsx:23-35,57-58,73-97 搜索并刷新已安装集合；SM/features/skills/BrowseTab.tsx:100-115,133-174 搜索市场与安装；SM/features/plugins/components/PluginsViewHeader.tsx:198-205 有刷新入口。
- 边界：对相关 skills/plugins 源码的关键词搜索未发现可确认的新建 skill 工作流；组的创建不等于技能创建。安装来源、权限、主机目标与真实执行未验。

## 统一动态边界

第四模式需独立实现但与旧模式共享同主机/账号上的真实线程及运行任务，并由服务端发起 SSH；此文件不能证明线程所有权、并发写入隔离、远程多主机、云账号、真实 UI 像素或旧模式迁移兼容。每个静态候选应在受控 Mac/账号/项目下验证可达条件、动作、回执、失败恢复与可见 UI；涉及写操作须使用隔离项目/账号。原 Mac 的静态能力候选既不等于已通过动态实验，也不保证所有功能对所有账号开放。
