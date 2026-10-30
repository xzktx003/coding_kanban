# 本期范围追踪：174项功能与55类场景

主方案：[多会话管理与Codex体验开发方案](../session-mode-multisession-development-plan-20261029.md)。

源码基线f6699ba，原包26.51007.21434；2026-10-29。用户已确认所有非IDE、非云任务能力本期必做。A–H是本期批次，不是分成几个交付期。`保留并验收`表示已有能力也必须覆盖，不表示无需验收；`技术确认后实现`不能静默改为延期。混合来源只排除明确不适用子分支。

原始证据/偏移/调用关系：[审计主文档](../session-render-alignment/codex-client-full-audit-20261029.md)。本表是批准后的范围基线；逐项实现/验收进度见[实施台账](../session-mode-implementation-20261029/README.md)。历史通过或静态复用不等于本期最终源码动态验收通过。

## 功能逐行归属

| ID | 原审计功能 | 本期处理 | 批次 | 必验或排除边界 |
|---|---|---|---|---|
| CMP-01 | 新建/后续输入 placeholder：F:mPi 按 image markup、Goal、Plan、follow-up type、custom override 顺序选文案；退出模式恢复对应文案。 | 完善 | D | 统一普通/后续/Goal/Plan/图像标注placeholder；排除云或其他产品特有override |
| CMP-02 | 普通编辑器与紧凑/单行：F:bFa 的 `layoutState.layout=Zs?'single-line':'multiline'`，提交/附件可改变状态；F:ewa 随 props 渲染。 | 适配 | D/G | 保留手机固定高度；桌面按原包可达状态比较紧凑/多行 |
| CMP-03 | 焦点与隐藏输入：F:bFa 的 `disableAutoFocus`、focus target 与 `inputInert`；C:pd 排除 hidden/inert 只是另一个 Orbit 分支，不能混用当主输入证据。 | 保留并验收 | B/G | 可见/焦点/owner守卫，切窗口不串焦点 |
| CMP-04 | 普通文本、选区、撤销：F:bFa 持有 composerController/onUserInput/selection 回调，F:gMa 操作原 editor doc。 | 保留并验收 | D/G | 文字/选区/编辑undo独立于管理动作undo |
| CMP-05 | IME 与 Enter：F:gMa 屏蔽 composing/keyCode229/repeat；原 Enter 偏好经 `composerEnterBehavior` 读取。 | 保留并验收 | D/G | IME/keyCode229/repeat与Enter偏好 |
| CMP-06 | 手机 Return：官方按实际宿主/editor keymap 决策；F:gMa 全局 body Enter 也受语音状态约束。 | 保留适配 | G | 手机Return换行，外接键盘按明确组合提交 |
| CMP-07 | 三种发送键偏好 enter/cmdIfMultiline/cmdAlways；离开菜单保持偏好。F:gMa 的 background submit 要避开代码块/特定 CtrlEnter。 | 完善 | D | 三种Enter偏好和单次反向Queue/Steer，与网页快捷键共存 |
| CMP-08 | 空闲有内容主动作 Send；F:ewa 非 loading、交互允许、submitDisabled=false 才可发送；空消息解释 tooltip nonce。 | 完善 | D | Send与阻断原因，元数据未知不假装可写 |
| CMP-09 | 运行空草稿 Stop；F:ewa `D==='stop'&&!ve`，stopping 变 loading，Esc 文案取决确认可见。 | 保留并验收 | C/D | 精确Stop、stopping、失败恢复 |
| CMP-10 | 运行有草稿 Queue/Steer 唯一主动作；F:ewa 根据 `isQueueingEnabled` 切按钮语义。 | 保留并验收 | D/G | 运行有草稿唯一Queue/Steer主动作 |
| CMP-11 | Resume：F:ewa 在 resume pending 或 `existingThread && resumeEnabled && !running && !hasGoal && empty-message` 时渲染 Resume，调用独立 onResume。 | 新增/完善 | A/D | 显式Resume空输入新turn，独立durable receipt，非历史resume |
| CMP-12 | 主动作优先级：F:ewa 听写 finish-send→realtime send/end→Stop→Resume→voice start→normal Send；互斥渲染。 | 完善 | D/F | 听写finish-send/Stop/Resume/Send互斥优先级 |
| CMP-13 | 提交时捕获原目标、上下文、参数；F:bFa 向实际 submit controller 交出上下文，与 editor 执行分离。 | 保留并验收 | B/D/G | 捕获目标/设置/草稿版本，晚ACK不清新编辑 |
| CMP-14 | 确切失败 vs delivery unknown：Q:We 将 outcome-unknown 与普通 paused 错误分开；未证回执不自动重投。 | 保留并验收 | B/C/D | 明确失败/unknown分离，归档不能绕过未知回执 |
| CMP-15 | Queue waiting→pending/sending→accepted，运行中显式 steer 不 interrupt；Q:We `pending/sending && !paused` 显示 spinner。 | 保留并验收 | C/D | 服务端队列revision与运行态分开 |
| CMP-16 | 显式 Stop 后队列暂停与 Resume：Q:Be 的 interrupted header，首条 `canSendNow===false` 隐藏继续按钮。 | 完善 | C/D | 显式Stop/停止归档后的队列暂停原因及明确恢复 |
| CMP-17 | 每条队列送达未知：Q:We outcome-unknown tooltip 要用户查会话，不安全自动 retry。 | 保留并验收 | C/D | 送达未知只读核对，禁止自动重发 |
| CMP-18 | 队列 edit/delete/reorder，发送中禁 edit/delete；Q:We 用 dnd transform、hover handle，Q:Be 控制 reorderability。 | 保留并验收 | D/G | 队列编辑/删除/拖动，sending状态禁写 |
| CMP-19 | 队列 prompt 非模态全文预览与复制；Q:We 对文本+附件摘要最多80字符 aria，正文保持可读。 | 保留并验收 | D/G | 非模态预览/复制/附件组合及键盘 |
| CMP-20 | 队列菜单 toggle queueing、side chat、send now；Q:We SendNow 要 `canSendNow` 且运行附件守卫。 | 保留并验收 | D | queue/side chat/send-now和冻结设置 |
| CMP-21 | 桌面列表与手机展示：Q:Be 全队列滚动、30dvh、paused header；具体 floating presentation 有条件。 | 保留适配 | D/G | 手机compact shelf，完整队列仍可访问 |
| CMP-22 | Rail 进入/退出与组合：F:Iya 由 portal/sandbox/WSL/transcript/queue/Goal/subagent/status/header 多条件决定 mount/offset。 | 完善 | D/G | rail阻塞提示与Goal/queue/diff/notice全组合 |
| CMP-23 | Running changes 行主区与独立 View changes，当前 turn diff 结束后消失/保留依据上层。 | 保留并验收 | D/E | 运行变更主入口与View changes分别可达 |
| CMP-24 | Goal rail 与其他 item 共存；F:bFa 的 `threadGoal` 参与 rail，Goal draft 改 placeholder 和权限位。 | 保留并验收 | C/D | Goal与rail共存；设置目标不额外发turn |
| CMP-25 | Goal 替换/clear、退出 portal，F:ewa 的 `hasGoal/onClearGoal` 进入主控件。 | 保留并验收 | C/D | Goal替换/clear身份和旧清理守卫，不声称native CAS |
| CMP-26 | 附加菜单 `@`：F:W4t actual tooltip/aria 与 F:bFa toggleContextSuggestions，image markup 时改走 addFiles。 | 完善 | D/E | 附加菜单与引用/标注上下文切换 |
| CMP-27 | 文件/文件夹：F:bFa/Yba 保留 addedFiles、uploadedFileAttachments、pendingFiles、selectedText 分型和 host ID。 | 修复 | E | 设备上传与项目文件/目录选择拆开，保留真实路径 |
| CMP-28 | 图片上传、删除、失败与 pending 防重复，F:bFa 的 Ca/images 与 imageCommentGroups 独立传入 Yba。 | 保留并验收 | D/E/G | 图片上传/删除/restore、失败、晚返回归属 |
| CMP-29 | 图像标注与 sketch composer：F:bFa imageMarkupAttachment、imageCommentGroups、sketchComposer，markup ready 参与 submitReady。 | 完善 | D/E | 图像标注与草图payload/坐标/owner对齐 |
| CMP-30 | 文本粘贴附件、还原正文：F:bFa `pastedTextAttachments/pendingPastes/handleShowPastedTextInTextField`。 | 保留并验收 | D/E | 大粘贴上下文与还原正文，预算边界 |
| CMP-31 | 选中文本、响应注释、共享线程、MCP app context、appshot、Chrome selection、PR checks/conflict 等多个附件类型：F:bFa 明确传给 Yba。 | 按子能力适配 | A/D/E/F | 保留本地文件/手动引用/线程/MCP上下文及普通仓库PR checks/conflict/托管平台引用；只排除IDE自动选区、Codex云任务/云工作区及其他产品专属分支 |
| CMP-32 | drop 及 Shift overlay：F:bFa interaction 有 `showShiftOverlay`、drop portal、submit block；处理根据 placement。 | 技术确认后完善 | A/D/E | 网页文件拖入/Shift行为；只有本地Codex可达且适用于网页的语义纳入 |
| CMP-33 | 文件上下文快照更新/恢复/undo：官方附件 source/order tracking 由控制器管理。 | 保留并验收 | E | 上下文快照/来源变化/恢复/undo |
| CMP-34 | IDE 自动上下文：F:hDa 真实命令 ID `ide-context`，仅 `ideContextStatus==='connected'` enabled，选中时 `setIsAutoContextOn(!current)`，不要求清空输入。F:ewa 收 `isAutoContextOn/ideContextStatus`。 | 排除IDE实现/清理入口 | D | 移除无效/ide；自有项目文件上下文继续保留 |
| CMP-35 | `/init` 安全前置：F:vDa 对精确 cwd 的 AGENTS.md 走 `paths-exist`，存在则 toast 并 return，不提交任务。 | 修复 | A/D | 精确cwd的AGENTS.md预检；存在/未知不直接发init |
| CMP-36 | 本地/工作树位置切换：U:Uu 依据既有会话/跟随/工作树、busy与handoff决定能否改变 run location；U:Qd allowWorktree=`!followUp&&!response`。 | 新增/完善 | A/E | 新聊天/分支的真实本地/worktree执行位置 |
| CMP-37 | Worktree toggle/命令：U:qd `composer.toggleWorktreeMode`、slash id worktree、requiresEmptyComposer=false，受工作区/可用性/feature flags 门控。 | 新增/完善 | A/E | 网页worktree选择/命令；不用IDE或桌面command bridge |
| CMP-38 | 本地 environment dropdown：U:Qd 仅 `!followUp&&eligible&&workspaceKnown`，disabled/loading/error/reset；打开精确 configPath/workspaceRoot，没环境时转 `/settings/local-environments`。 | 新增/完善 | A/E | 本地environment选择/配置/错误，基于项目与已验证能力 |
| CMP-39 | 分支 dropdown：U:Qd `cn=...&&!follower&&!outsideEditor`；按 hostId:cwd key，existingWorkspace时readOnly。 | 新增/完善 | A/E | 分支选择与目标cwd绑定；运行中不偷偷换目录 |
| CMP-40 | 项目选择：U:Qd 为 openProjectPicker command 计算 enabled 并聚焦composer；选中的项目与 run location 共同决定 cwd。 | 保留并验收 | E/G | 已有项目导航/关注集合/输入目标联动 |
| CMP-41 | 模型默认/当前/未知/搜索：F:hCa 使用真实 authMethod/cwd/host/catalog状态、capabilities、当前model；F:lCa 包含 simple/advanced/default/locked/fallback。 | 完善 | A/D | 真实catalog与unknown/locked/default/custom模型呈现 |
| CMP-42 | Power/effort：F:lCa 原模型支持的effort、locked model、fallback power selection决定slider和radio；选择完成与打开menu不同。 | 保留并验收 | D | effort/power/canonical ID组合 |
| CMP-43 | Fast/service tier：F:lCa props selectedServiceTier/options/loading 与 onSelectServiceTier；F:hCa 根据账号/host选择目录来源。 | 保留并验收 | D | service tiers/Fast只来自实际支持信息 |
| CMP-44 | 权限 preset：P:vn 是真正 export，再按条件走旧tn或新yn；yn 读取 permission profiles、server default、requirements。不能把三个旧preset当全量权限。 | 新增/完善 | A/D | 真实permission profiles/server default/requirements |
| CMP-45 | Full Access确认/Cancel：P:Ht 根据code/work/cyber分支展示风险与外部link，确认后才写权限；取消回原选择。 | 完善 | A/D | Full Access/Ultra确认与实际fallback |
| CMP-46 | Plan是collaboration mode，不只是权限标签；F:bFa 有 activeCollaborationMode，F:mPi 改placeholder。 | 保留并验收 | D | Plan为collaboration mode，不混权限 |
| CMP-47 | 模型切换通知/升级/关闭：F:hCa 选择完成/菜单结束由独立回调，非所有store变化都等于用户选择。 | 完善 | D | 显式用户模型选择/公告/关闭优先级 |
| CMP-48 | 听写状态：F:ewa 从voiceControls读取 starting/dictating/transcribing/canRetry/micBusy，并在语音优先主动作中finish-send；F:gMa submit中先stopDictation('send')。 | 完善 | F | 听写finish-send、保留音频retry和owner冻结 |
| CMP-49 | 听写取消启动：官方voice模型有abort/cancel/preserve入口，主`gMa/ewa`优先级处理starting。C:dd的Escape细节是Orbit分支，不直接归普通VSCode。 | 修复 | F | starting可取消，晚授权停止tracks，文案与能力一致 |
| CMP-50 | 听写切目标/隐藏/卸载归属：原控制器按session和active输入守卫；C:dd另含hidden/inert防跨输入，仅作为共享设计参考。 | 保留并验收 | F/G | 跨会话/隐藏/卸载的音频和草稿归属 |
| CMP-51 | Realtime voice：F:ewa 用visiblePhase选择send/end/start，remote project unsupported禁用，mic/speaker控制另行。 | 技术确认后实现 | A/F | 普通Codex本地realtime客户端；不自建云后端、不移植Orbit房间；不支持时列技术阻塞 |
| CMP-52 | 展开编辑：原包普通editor controller可多行/代码块，但没有证明存在项目同样全屏 sheet。 | 保留并验收 | D/E/G | 展开编辑/代码/选区/返回草稿 |
| CMP-53 | 展开编辑提交/Stop：与主输入同frozen owner/submitLabel/queue-steer；运行草稿仍显式Stop。 | 保留并验收 | D/G | 展开输入沿同捕获目标/Stop/Queue/Steer规则 |
| CMP-54 | 错误可恢复性：原包按钮blockedReason、附件error、模型catalog retry、队列unknown分属不同轴，不能统一“已中断”。 | 完善 | B/D | 错误按权限/附件/连接/投递域投影，不统一成已中断 |
| T01 | 用户正文/Markdown | 保留并验收 | D/G | 原生消息/活动分组状态与当前实现逐组合对照，不重复开发已有能力 |
| T02 | 用户附件与引用 | 保留并验收 | D/G | 原生消息/活动分组状态与当前实现逐组合对照，不重复开发已有能力 |
| T03 | 助手流式正文 | 完善 | D | 有界渐进Markdown与最终语法一致，资源不退步 |
| T04 | 助手最终正文/行动条 | 保留并验收 | D/G | 原生消息/活动分组状态与当前实现逐组合对照，不重复开发已有能力 |
| T05 | commentary 与 final_answer分层 | 完善 | D | latest为默认，可展开全部过程 |
| T06 | 公开reasoning摘要 | 保留并验收 | D/G | 原生消息/活动分组状态与当前实现逐组合对照，不重复开发已有能力 |
| T07 | turn工作时长/折叠 | 保留并验收 | D/G | 原生消息/活动分组状态与当前实现逐组合对照，不重复开发已有能力 |
| T08 | 命令执行与解析动作 | 保留并验收 | D/G | 原生消息/活动分组状态与当前实现逐组合对照，不重复开发已有能力 |
| T09 | 连续命令分组 | 保留并验收 | D/G | 原生消息/活动分组状态与当前实现逐组合对照，不重复开发已有能力 |
| T10 | 工具活动聚合 | 保留并验收 | D/G | 原生消息/活动分组状态与当前实现逐组合对照，不重复开发已有能力 |
| T11 | 文件变更单项 | 保留并验收 | D/E/G | 自有文件/diff/图片/分支/复制/计划操作保持，原包对照及失败恢复 |
| T12 | turn文件汇总/diff入口 | 保留并验收 | D/E/G | 自有文件/diff/图片/分支/复制/计划操作保持，原包对照及失败恢复 |
| T13 | 撤销/恢复patch | 保留并验收 | D/E/G | 自有文件/diff/图片/分支/复制/计划操作保持，原包对照及失败恢复 |
| T14 | 代码审查结果 | 保留并验收 | D/E/G | 自有文件/diff/图片/分支/复制/计划操作保持，原包对照及失败恢复 |
| T15 | web search/search open/find | 保留并验收 | D/G | 原生消息/活动分组状态与当前实现逐组合对照，不重复开发已有能力 |
| T16 | image-view | 保留并验收 | D/G | 原生消息/活动分组状态与当前实现逐组合对照，不重复开发已有能力 |
| T17 | 生成图片占位与画廊 | 完善 | A/D | 生成图片失败/额度真实字段与画廊共存 |
| T18 | 生成图片编辑/下载 | 保留并验收 | D/E/G | 自有文件/diff/图片/分支/复制/计划操作保持，原包对照及失败恢复 |
| T19 | context compaction | 保留并验收 | D/G | 原生消息/活动分组状态与当前实现逐组合对照，不重复开发已有能力 |
| T20 | 普通MCP调用 | 保留并验收 | D/G | 原生消息/活动分组状态与当前实现逐组合对照，不重复开发已有能力 |
| T21 | MCP App交互widget | 新增/完善 | A/F | 完整MCP App资源/身份/握手/工具权限/卸载 |
| T22 | 动态工具注册表 | 按子能力适配 | D/F | 本地动态工具注册表/网页链接/普通仓库托管平台操作保留；只排除依赖Codex云任务或云工作区的专属目标 |
| T23 | 隐藏工具/协议噪声 | 定位并修复 | A/D | 控制事件噪声只进入诊断，序号/元数据保留 |
| T24 | 命令审批 | 完善与组合验收 | A/D/F/G | 所有适用native请求类型/allowed decisions、精确身份、失败和unknown |
| T25 | 文件变更审批 | 完善与组合验收 | A/D/F/G | 所有适用native请求类型/allowed decisions、精确身份、失败和unknown |
| T26 | 临时权限请求 | 完善与组合验收 | A/D/F/G | 所有适用native请求类型/allowed decisions、精确身份、失败和unknown |
| T27 | 同步request_user_input | 完善与组合验收 | A/D/F/G | 所有适用native请求类型/allowed decisions、精确身份、失败和unknown |
| T28 | 异步问题/回答消息 | 完善与组合验收 | A/D/F/G | 所有适用native请求类型/allowed decisions、精确身份、失败和unknown |
| T29 | MCP form elicitation | 完善与组合验收 | A/D/F/G | 所有适用native请求类型/allowed decisions、精确身份、失败和unknown |
| T30 | MCP form键盘Escape | 完善 | D | 有焦点表单Escape取消，IME/unknown期间守卫 |
| T31 | MCP表单图片/文件选择 | 完善与组合验收 | A/D/F/G | 所有适用native请求类型/allowed decisions、精确身份、失败和unknown |
| T32 | URL/auth/tool审批elicitation | 完善与组合验收 | A/D/F/G | 所有适用native请求类型/allowed decisions、精确身份、失败和unknown |
| T33 | 自动审批审核 | 完善与组合验收 | A/D/F/G | 所有适用native请求类型/allowed decisions、精确身份、失败和unknown |
| T34 | hook消息/统计 | 保留并验收 | D/G | 原生消息/活动分组状态与当前实现逐组合对照，不重复开发已有能力 |
| T35 | 模型改派通知 | 保留并验收 | D/G | 原生消息/活动分组状态与当前实现逐组合对照，不重复开发已有能力 |
| T36 | 子Agent工具活动 | 保留并验收 | D/G | 子Agent观察/权限/状态与主输入独立，不扩大停止范围 |
| T37 | 子Agent原生进展消息 | 保留并验收 | D/G | 子Agent观察/权限/状态与主输入独立，不扩大停止范围 |
| T38 | 子Agent侧栏与读写边界 | 保留并验收 | D/G | 子Agent观察/权限/状态与主输入独立，不扩大停止范围 |
| T39 | 加载历史失败提示 | 完善与组合验收 | B/D/G | 历史/恢复/阅读/身份跨窗组合，工具正文仍在浏览器前裁剪 |
| T40 | 更早消息分页 | 完善与组合验收 | B/D/G | 历史/恢复/阅读/身份跨窗组合，工具正文仍在浏览器前裁剪 |
| T41 | 断线/恢复提示 | 完善与组合验收 | B/D/G | 历史/恢复/阅读/身份跨窗组合，工具正文仍在浏览器前裁剪 |
| T42 | 历史failed与错误通知去重 | 完善与组合验收 | B/D/G | 历史/恢复/阅读/身份跨窗组合，工具正文仍在浏览器前裁剪 |
| T43 | 历史interrupted呈现 | 完善与组合验收 | B/D/G | 历史/恢复/阅读/身份跨窗组合，工具正文仍在浏览器前裁剪 |
| T44 | 长历史/大输出与详情 | 完善与组合验收 | B/D/G | 历史/恢复/阅读/身份跨窗组合，工具正文仍在浏览器前裁剪 |
| T45 | 消息copy富文本 | 保留并验收 | D/E/G | 自有文件/diff/图片/分支/复制/计划操作保持，原包对照及失败恢复 |
| T46 | 从回复分支并引用选区 | 保留并验收 | D/E/G | 自有文件/diff/图片/分支/复制/计划操作保持，原包对照及失败恢复 |
| T47 | 编辑用户消息/回退 | 保留并验收 | D/E/G | 自有文件/diff/图片/分支/复制/计划操作保持，原包对照及失败恢复 |
| T48 | 计划Markdown/展开 | 保留并验收 | D/E/G | 自有文件/diff/图片/分支/复制/计划操作保持，原包对照及失败恢复 |
| T49 | 计划文档open/download/copy | 保留并验收 | D/E/G | 自有文件/diff/图片/分支/复制/计划操作保持，原包对照及失败恢复 |
| T50 | todo-list计划进度 | 保留并验收 | D/E/G | 自有文件/diff/图片/分支/复制/计划操作保持，原包对照及失败恢复 |
| T51 | 文件引用与memory citation | 保留并验收 | D/E/G | 自有文件/diff/图片/分支/复制/计划操作保持，原包对照及失败恢复 |
| T52 | Sources完整聚合面板 | 新增/完善 | E | 完整Sources侧栏，复用文件跳转和只读详情 |
| T53 | 会话内查找与导航 | 完善与组合验收 | B/D/G | 历史/恢复/阅读/身份跨窗组合，工具正文仍在浏览器前裁剪 |
| T54 | 多窗口正文身份 | 完善与组合验收 | B/D/G | 历史/恢复/阅读/身份跨窗组合，工具正文仍在浏览器前裁剪 |
| LG01 | 关闭标签与实际任务解耦 | 保留并验收 | B/C/E/G | 管理外壳与自有文件/手机/窗口能力；其他模式不扩展 |
| LG02 | 跨设备关注标签集合 | 保留并验收 | B/C/E/G | 管理外壳与自有文件/手机/窗口能力；其他模式不扩展 |
| LG03 | 手机列表长按菜单 | 保留并验收 | B/C/E/G | 管理外壳与自有文件/手机/窗口能力；其他模式不扩展 |
| LG04 | 三模式与二级导航 | 保留并验收 | B/C/E/G | 管理外壳与自有文件/手机/窗口能力；其他模式不扩展 |
| LG05 | 项目选择与输入目标联动 | 保留并验收 | B/C/E/G | 管理外壳与自有文件/手机/窗口能力；其他模式不扩展 |
| LG06 | 列表内重命名 | 完善/修复 | A/C/D | 管理动作、归档生命周期、异步undo、中文、共享pin/read与分页 |
| LG07 | 会话动作菜单重命名可用性 | 完善/修复 | A/C/D | 管理动作、归档生命周期、异步undo、中文、共享pin/read与分页 |
| LG08 | 归档接入全局撤销 | 完善/修复 | A/C/D | 管理动作、归档生命周期、异步undo、中文、共享pin/read与分页 |
| LG09 | 全局撤销事务与覆盖范围 | 完善/修复 | A/C/D | 管理动作、归档生命周期、异步undo、中文、共享pin/read与分页 |
| LG10 | 归档成功即时反馈 | 完善/修复 | A/C/D | 管理动作、归档生命周期、异步undo、中文、共享pin/read与分页 |
| LG11 | 运行中归档语义与确认 | 完善/修复 | A/C/D | 管理动作、归档生命周期、异步undo、中文、共享pin/read与分页 |
| LG12 | 已计划任务/运行组合归档确认 | 完善/修复 | A/C/D | 管理动作、归档生命周期、异步undo、中文、共享pin/read与分页 |
| LG13 | 归档撤销恢复原置顶 | 完善/修复 | A/C/D | 管理动作、归档生命周期、异步undo、中文、共享pin/read与分页 |
| LG14 | 归档列表长历史分页 | 完善/修复 | A/C/D | 管理动作、归档生命周期、异步undo、中文、共享pin/read与分页 |
| LG15 | 归档设置页中文与错误文案 | 完善/修复 | A/C/D | 管理动作、归档生命周期、异步undo、中文、共享pin/read与分页 |
| LG16 | 列表操作中文标签 | 完善/修复 | A/C/D | 管理动作、归档生命周期、异步undo、中文、共享pin/read与分页 |
| LG17 | 置顶的数据域与撤销 | 完善/修复 | A/C/D | 管理动作、归档生命周期、异步undo、中文、共享pin/read与分页 |
| LG18 | 标记未读写入域 | 完善/修复 | A/C/D | 管理动作、归档生命周期、异步undo、中文、共享pin/read与分页 |
| LG19 | 复制为 Markdown | 保留并验收 | D/E | 复制/网页深链精确目标，排除必须IDE才可用的跳转 |
| LG20 | 复制深度链接 | 保留并验收 | D/E | 复制/网页深链精确目标，排除必须IDE才可用的跳转 |
| LG21 | 在新窗口打开聊天 | 保留并验收 | B/C/E/G | 管理外壳与自有文件/手机/窗口能力；其他模式不扩展 |
| LG22 | 文件浏览器移动端与未保存保护 | 保留并验收 | B/C/E/G | 管理外壳与自有文件/手机/窗口能力；其他模式不扩展 |
| LG23 | VS Code 面板保持挂载 | 保留现状/不扩展 | G | 现有可选VSCode iframe保持挂载；不开发IDE宿主能力 |
| LG24 | 设置页手机布局 | 保留并验收 | B/C/E/G | 管理外壳与自有文件/手机/窗口能力；其他模式不扩展 |
| LG25 | 自定义快捷键保存与重置 | 新增/完善 | D | 网页快捷键真实保存/重置/导航偏好，非VSCode配置桥 |
| LG26 | 数字键聊天/标签目标偏好 | 新增/完善 | D | 网页快捷键真实保存/重置/导航偏好，非VSCode配置桥 |
| LG27 | 插件安装与认证后续 | 完善与组合验收 | A/F/G | 现有真实插件/MCP/auth/usage/feedback路径，补scope和失败组合 |
| LG28 | 插件卸载与状态刷新 | 完善与组合验收 | A/F/G | 现有真实插件/MCP/auth/usage/feedback路径，补scope和失败组合 |
| LG29 | 插件/技能/连接器导航 | 完善与组合验收 | A/F/G | 现有真实插件/MCP/auth/usage/feedback路径，补scope和失败组合 |
| LG30 | MCP 重新认证状态机 | 完善与组合验收 | A/F/G | 现有真实插件/MCP/auth/usage/feedback路径，补scope和失败组合 |
| LG31 | MCP 认证账号/实例切换失效 | 完善与组合验收 | A/F/G | 现有真实插件/MCP/auth/usage/feedback路径，补scope和失败组合 |
| LG32 | MCP 管理页与配置 | 完善与组合验收 | A/F/G | 现有真实插件/MCP/auth/usage/feedback路径，补scope和失败组合 |
| LG33 | ChatGPT/API key/device code 登录 | 完善与组合验收 | A/F/G | 现有真实插件/MCP/auth/usage/feedback路径，补scope和失败组合 |
| LG34 | 登录取消与未知回执 | 完善与组合验收 | A/F/G | 现有真实插件/MCP/auth/usage/feedback路径，补scope和失败组合 |
| LG35 | 原生账户用量与复原 | 完善与组合验收 | A/F/G | 现有真实插件/MCP/auth/usage/feedback路径，补scope和失败组合 |
| LG36 | 反馈入口与权限预检 | 完善与组合验收 | A/F/G | 现有真实插件/MCP/auth/usage/feedback路径，补scope和失败组合 |
| LG37 | 反馈上传六态及关窗后继续 | 完善与组合验收 | A/F/G | 现有真实插件/MCP/auth/usage/feedback路径，补scope和失败组合 |
| LG38 | 听写启动/转录/失败重试 | 完善与组合验收 | F/G | 听写状态/重试与owner安全 |
| LG39 | 听写与会话草稿归属 | 完善与组合验收 | F/G | 听写状态/重试与owner安全 |
| LG40 | Ultra+Full Access 二次确认 | 完善 | A/D | 权限profile和每scope原生fallback，已有Ultra确认保留 |
| LG41 | 共享大应用设置的适用性 | 排除非本地分支 | 范围边界 | ChatGPT/家庭/账单/云端共享设置不当成本地会话缺口 |
| LG42 | 云端任务/服务器内部逻辑 | 排除 | 范围边界 | 云端任务与服务内部实现 |
| H01 | 扩展注册与入口 | 排除IDE宿主实现 | 范围边界 | 独立插件/companion/profile/code-server/部署机制不纳入；风险和审计证据保留 |
| H02 | 命令/快捷键/设置 | 网页语义适配 | D | 保留网页可用快捷键/字体/locale/偏好，不实现VSCode设置接口 |
| H03 | provider/Webview 初始化 | 排除IDE宿主实现 | 范围边界 | 独立插件/companion/profile/code-server/部署机制不纳入；风险和审计证据保留 |
| H04 | ready 与待发送消息 | 排除IDE宿主实现 | 范围边界 | 独立插件/companion/profile/code-server/部署机制不纳入；风险和审计证据保留 |
| H05 | 隐藏上下文保持 | Session等价责任 | B/C/G | 沿现有Session层实现生命周期/调度/身份/同步；不新增原插件宿主桥 |
| H06 | 多 editor/文档 | 排除IDE宿主实现 | 范围边界 | 独立插件/companion/profile/code-server/部署机制不纳入；风险和审计证据保留 |
| H07 | 本地 app-server 生命周期 | Session等价责任 | B/C/G | 沿现有Session层实现生命周期/调度/身份/同步；不新增原插件宿主桥 |
| H08 | RPC/通知/请求回到原 Webview | Session等价责任 | B/C/G | 沿现有Session层实现生命周期/调度/身份/同步；不新增原插件宿主桥 |
| H09 | 请求预热/放弃 | Session等价责任 | B/C/G | 沿现有Session层实现生命周期/调度/身份/同步；不新增原插件宿主桥 |
| H10 | 共享对象订阅/写入 | Session等价责任 | B/C/G | 沿现有Session层实现生命周期/调度/身份/同步；不新增原插件宿主桥 |
| H11 | 持久 atom 同步/更新/重置 | Session等价责任 | B/C/G | 沿现有Session层实现生命周期/调度/身份/同步；不新增原插件宿主桥 |
| H12 | 客户端协调/已读状态 | Session等价责任 | B/C/G | 沿现有Session层实现生命周期/调度/身份/同步；不新增原插件宿主桥 |
| H13 | 可能写出后的失败投递 | 排除IDE宿主实现 | 范围边界 | 独立插件/companion/profile/code-server/部署机制不纳入；风险和审计证据保留 |
| H14 | 桥接发送准入 | 排除IDE宿主实现 | 范围边界 | 独立插件/companion/profile/code-server/部署机制不纳入；风险和审计证据保留 |
| H15 | 刷新目标/实例隔离 | 排除IDE宿主实现 | 范围边界 | 独立插件/companion/profile/code-server/部署机制不纳入；风险和审计证据保留 |
| H16 | 私有刷新原型/租约/保温 | 排除IDE宿主实现 | 范围边界 | 独立插件/companion/profile/code-server/部署机制不纳入；风险和审计证据保留 |
| H17 | 历史只读与工具正文投影 | Session等价责任 | B/C/G | 沿现有Session层实现生命周期/调度/身份/同步；不新增原插件宿主桥 |
| H18 | 字体/语言/宿主设置 | 网页语义适配 | D | 保留网页可用快捷键/字体/locale/偏好，不实现VSCode设置接口 |
| H19 | diff/plan/open 文件容器 | 自有能力保留 | D/E | 文件/diff/plan/手动上下文走自有面板，IDE自动上下文排除 |
| H20 | IDE上下文与文件加入 | 自有能力保留 | D/E | 文件/diff/plan/手动上下文走自有面板，IDE自动上下文排除 |
| H21 | worker/fetch 取消 | Session等价责任 | B/C/G | 沿现有Session层实现生命周期/调度/身份/同步；不新增原插件宿主桥 |
| H22 | fatal与显式重启 | Session等价责任 | B/C/G | 沿现有Session层实现生命周期/调度/身份/同步；不新增原插件宿主桥 |
| H23 | 本机环境/WSL/CLI设置 | 排除IDE宿主实现 | 范围边界 | 独立插件/companion/profile/code-server/部署机制不纳入；风险和审计证据保留 |
| H24 | 实际部署与包身份 | 排除IDE宿主实现 | 范围边界 | 独立插件/companion/profile/code-server/部署机制不纳入；风险和审计证据保留 |

## 原55类场景的本期去向

排除IDE宿主不排除新聊天、运行、审批、刷新和收尾等用户场景；这些场景在Session链路重新验证。

| ID | 场景 | 本期处理 | 批次 | 证据边界 |
|---|---|---|---|---|
| M01 | 空白工作台：无关注会话、导航可操作、无隐式新建/发送 | 本期必测 | B/G/H | 按当前预热/回收/性能合同复验，保留传输/堆/RSS/正确正文证据 |
| M02 | 官方空白新线程：未发送 UUID、独立草稿、刷新仍相同目标 | Session场景必测；原IDE夹具不纳入 | A/B/C/D/G/H | 改用Session真实UI+隔离native协议，覆盖同一生命周期；不要求启动code-server或三个官方宿主 |
| M03 | 新线程首发：仅一次接受；新资源路由与 editor URI/thread 正确 | Session场景必测；原IDE夹具不纳入 | A/B/C/D/G/H | 改用Session真实UI+隔离native协议，覆盖同一生命周期；不要求启动code-server或三个官方宿主 |
| M04 | idle 已完成历史：最新回答动作始终可见、旧 turn 按原分组隐藏 | 本期必测 | D/F/G/H | 固定原组件对照与真实项目交互；动态/静态/native证据分别记录 |
| M05 | running+空草稿：显示 Stop；无“已中断”假终态；不显示错误引导 | 本期必测 | D/F/G/H | 固定原组件对照与真实项目交互；动态/静态/native证据分别记录 |
| M06 | running+草稿：主动作为 Queue/Steer，草稿不被旧完成覆盖 | 本期必测 | D/F/G/H | 固定原组件对照与真实项目交互；动态/静态/native证据分别记录 |
| M07 | 流式 assistant：增量与最终正文合并为一行，无闪失/重复 | 本期必测 | D/F/G/H | 固定原组件对照与真实项目交互；动态/静态/native证据分别记录 |
| M08 | 1万交错事件：有界行/字符串，最新答复可见，序号不丢 | 本期必测 | D/F/G/H | 固定原组件对照与真实项目交互；动态/静态/native证据分别记录 |
| M09 | tool 执行：command输出有界、显式展开详情、完成/失败状态 | 本期必测 | D/F/G/H | 固定原组件对照与真实项目交互；动态/静态/native证据分别记录 |
| M10 | running diff + queue rail：边框/计数/滚动/多行队列共存 | 本期必测 | D/F/G/H | 固定原组件对照与真实项目交互；动态/静态/native证据分别记录 |
| M11 | Markdown/代码/表格/图片：字体、wrap、高亮、copy/download | 本期必测 | D/F/G/H | 固定原组件对照与真实项目交互；动态/静态/native证据分别记录 |
| M12 | expanded composer：插入代码、选择区、关闭/刷新/返回主输入 | 本期必测 | D/F/G/H | 固定原组件对照与真实项目交互；动态/静态/native证据分别记录 |
| M13 | 完成通知/未读/提示音：后台收尾后状态独立于正文挂载 | 本期必测 | D/F/G/H | 固定原组件对照与真实项目交互；动态/静态/native证据分别记录 |
| M14 | pending审批：精确thread/turn/item/request/token、所有按钮可达 | 本期必测 | D/F/G/H | 固定原组件对照与真实项目交互；动态/静态/native证据分别记录 |
| M15 | 两客户端竞争同一审批：只有一次native accept，旧请求409 | 本期必测 | D/F/G/H | 固定原组件对照与真实项目交互；动态/静态/native证据分别记录 |
| M16 | 审批期间B断线再接：since游标补回新请求、旧token不得批准 | 本期必测 | D/F/G/H | 固定原组件对照与真实项目交互；动态/静态/native证据分别记录 |
| M17 | 审批失败：卡片保留可重试；已resolve/过期/账号变化不可迟到提交 | 本期必测 | D/F/G/H | 固定原组件对照与真实项目交互；动态/静态/native证据分别记录 |
| M18 | requestUserInput：选项/文字/schema验证；仅本轮自动展开一次 | 本期必测 | D/F/G/H | 固定原组件对照与真实项目交互；动态/静态/native证据分别记录 |
| M19 | 问题回复拒绝/未知ACK/远程已答：保留草稿、显式继续、不自动重发 | 本期必测 | D/F/G/H | 固定原组件对照与真实项目交互；动态/静态/native证据分别记录 |
| M20 | turn failed：错误source卡、Markdown链接、安全可点击、可重试 | 本期必测 | D/F/G/H | 固定原组件对照与真实项目交互；动态/静态/native证据分别记录 |
| M21 | 显式用户中断：停止精确turn一次，队列暂停；终态不能反复追加 | Session场景必测；原IDE夹具不纳入 | A/B/C/D/G/H | 改用Session真实UI+隔离native协议，覆盖同一生命周期；不要求启动code-server或三个官方宿主 |
| M22 | 刷新时旧 interrupted + 迟到 completed：真终态收敛，不凭连接失败捏造中断 | 本期必测 | D/F/G/H | 固定原组件对照与真实项目交互；动态/静态/native证据分别记录 |
| M23 | older-runtime 已暂停原因：中性文案，不误称“你中断了”，不自动resume | 本期必测 | D/F/G/H | 固定原组件对照与真实项目交互；动态/静态/native证据分别记录 |
| M24 | 无法加载历史：真实503仍提示错误，局部SSE不能伪装同步完成 | 本期必测 | B/G/H | 按当前预热/回收/性能合同复验，保留传输/堆/RSS/正确正文证据 |
| M25 | 重试history warning：双主题616/390尺寸、点击只读重试一次 | 本期必测 | B/G/H | 按当前预热/回收/性能合同复验，保留传输/堆/RSS/正确正文证据 |
| M26 | SSE断开→重连：清连接/同步提示、草稿不丢、无隐式写请求 | 本期必测 | B/G/H | 按当前预热/回收/性能合同复验，保留传输/堆/RSS/正确正文证据 |
| M27 | SSE序号gap/malformed/无完成：仅只读history修复、保留reader | 本期必测 | B/G/H | 按当前预热/回收/性能合同复验，保留传输/堆/RSS/正确正文证据 |
| M28 | 运行实例重启或较小快照：reset旧cursor，挡住旧实例ACK | 本期必测 | B/G/H | 按当前预热/回收/性能合同复验，保留传输/堆/RSS/正确正文证据 |
| M29 | 普通刷新：tabs/status/draft恢复，失败可重试，阅读位置不动 | 本期必测 | B/G/H | 按当前预热/回收/性能合同复验，保留传输/堆/RSS/正确正文证据 |
| M30 | 手机切后台/pagehide/refresh：运行不中断，排队保持，0新写 | 本期必测 | B/G/H | 按当前预热/回收/性能合同复验，保留传输/堆/RSS/正确正文证据 |
| M31 | 官方running刷新/关闭一端：精确turn持续active，完成一次，UI收尾 | Session场景必测；原IDE夹具不纳入 | A/B/C/D/G/H | 改用Session真实UI+隔离native协议，覆盖同一生命周期；不要求启动code-server或三个官方宿主 |
| M32 | 官方pending approval刷新：无composer不显示误导onboarding | Session场景必测；原IDE夹具不纳入 | A/B/C/D/G/H | 改用Session真实UI+隔离native协议，覆盖同一生命周期；不要求启动code-server或三个官方宿主 |
| M33 | 原生completed后composer settle：正确唯一thread、清稿、无busy/Stop/Queue、有Send | Session场景必测；原IDE夹具不纳入 | A/B/C/D/G/H | 改用Session真实UI+隔离native协议，覆盖同一生命周期；不要求启动code-server或三个官方宿主 |
| M34 | 翻页：保留native cursor、view=chat裁正文、滚动锚不跳，不acquire/resume | 本期必测 | B/G/H | 按当前预热/回收/性能合同复验，保留传输/堆/RSS/正确正文证据 |
| M35 | 1200项长历史+两页：独立位置/草稿/未读、后台不轮询大history | 本期必测 | B/G/H | 按当前预热/回收/性能合同复验，保留传输/堆/RSS/正确正文证据 |
| M36 | 首次cold history超显示预算：首次发布前有界，5MiB prompt头尾保留 | 本期必测 | B/G/H | 按当前预热/回收/性能合同复验，保留传输/堆/RSS/正确正文证据 |
| M37 | 高堆压不重复发布相同受保护附件：防渲染反馈循环 | 本期必测 | B/G/H | 按当前预热/回收/性能合同复验，保留传输/堆/RSS/正确正文证据 |
| M38 | 不可见正文按预算保温/压力回收→只读重显（适配原60秒用例） | 本期必测 | B/G/H | 资源充足超过60秒仍warm并接收完成更新；压力回收后晚读/delta不回填，重显只读恢复且状态/草稿不丢；原策略开关仍验60秒，预算/长测不放宽 |
| M39 | 自然长测：30min、真实HTTP/EventSource、RSS/堆/传输/回显都闭合 | 本期必测 | B/G/H | 按当前预热/回收/性能合同复验，保留传输/堆/RSS/正确正文证据 |
| M40 | composer模块加载失败：显式reload入口恢复草稿，无隐式task操作 | 本期必测 | B/G/H | 按当前预热/回收/性能合同复验，保留传输/堆/RSS/正确正文证据 |
| M41 | split多可见窗：每窗reading/更新/目标独立、拖拽不串输入 | 本期必测 | C/D/E/G/H | 共享状态与本地输入现场隔离；精确意图、回执、scope/revision |
| M42 | 跨设备tabs：共享关注/顺序/关闭，输入目标与布局/阅读本地 | 本期必测 | C/D/E/G/H | 共享状态与本地输入现场隔离；精确意图、回执、scope/revision |
| M43 | 20/50后台tabs：状态推进，slow history不阻塞其它窗，0大轮询 | 本期必测 | B/G/H | 按当前预热/回收/性能合同复验，保留传输/堆/RSS/正确正文证据 |
| M44 | owner外部占用：禁止retry/continue/重复投递，保留草稿/附件，可移除失败项 | 本期必测 | C/D/E/G/H | 共享状态与本地输入现场隔离；精确意图、回执、scope/revision |
| M45 | uncertain ACK：显式确认前不重发；reload后重试沿原意图ID | 本期必测 | C/D/E/G/H | 共享状态与本地输入现场隔离；精确意图、回执、scope/revision |
| M46 | 迟到send ACK：另一页新草稿/相同文字独立edit不能被清空 | 本期必测 | C/D/E/G/H | 共享状态与本地输入现场隔离；精确意图、回执、scope/revision |
| M47 | 附件异步upload/delete/restore：旧upload不能复活已删图，不误删其它页bytes | 本期必测 | C/D/E/G/H | 共享状态与本地输入现场隔离；精确意图、回执、scope/revision |
| M48 | 大粘贴/context/file引用/expanded draft：刷新保留、发送捕获冻结、undo不串设置 | 本期必测 | C/D/E/G/H | 共享状态与本地输入现场隔离；精确意图、回执、scope/revision |
| M49 | 模型/权限设置双页事务、晚read/ACK、A→B→A：不覆盖新意图 | 本期必测 | C/D/E/G/H | 共享状态与本地输入现场隔离；精确意图、回执、scope/revision |
| M50 | Goal完成清理晚ACK：新goal不被旧清除、只读完成不接管 | 本期必测 | C/D/E/G/H | 共享状态与本地输入现场隔离；精确意图、回执、scope/revision |
| M51 | 子Agent readonly观察：不改变主输入/project、不resume；审批精确身份 | 本期必测 | C/D/E/G/H | 共享状态与本地输入现场隔离；精确意图、回执、scope/revision |
| M52 | Enter/IME/touch：手机Return不误发；external keyboard明确组合发送 | 本期必测 | D/F/G/H | 固定原组件对照与真实项目交互；动态/静态/native证据分别记录 |
| M53 | 主工作台布局：控件不被裁、landscape/short viewport可达、hidden mode不监听键 | 本期必测 | D/F/G/H | 固定原组件对照与真实项目交互；动态/静态/native证据分别记录 |
| M54 | 单窗/三窗≤2s：导航/composer实际可输入，typing顺畅、样本分位数 | 本期必测 | B/G/H | 按当前预热/回收/性能合同复验，保留传输/堆/RSS/正确正文证据 |
| M55 | 三独立官方宿主刷新并发send：thread唯一、各输入仅一次、UI收尾、2s | Session场景必测；原IDE夹具不纳入 | A/B/C/D/G/H | 改用Session真实UI+隔离native协议，覆盖同一生命周期；不要求启动code-server或三个官方宿主 |

## 本期新增的组合关卡

| ID | 新增验证 | 主要关联 |
|---|---|---|
| N01 | 资源充足超过60秒仍保温、后台完成更新可读；压力回收后晚事件不回填；三页合并/公平性；原策略60秒回退保护 | B、M01/M34–40/M43/M54 |
| N02 | 共享pin/read修订、手动未读不被旧自动read清掉、provider/id碰撞迁移 | C、LG13/LG17/LG18、M42/M46 |
| N03 | 停止并归档持久gate覆盖Send/Resume/Steer/队列/Goal恢复；先冻结后核unknown；逐阶段失败与重启只读核对 | A/C、LG11–12、M21/M44/M45/M50 |
| N04 | 空输入Resume真实native接受一次，刷新/未知回执不重复 | A/D、CMP-11/12、M21/M22/M45 |
| N05 | fork/new worktree的native canonical cwd与UI一致，未知创建不重复 | A/E、CMP-36–39 |
| N06 | MCP App加载/身份/消息握手/授权/错误/隐藏资源释放全链 | A/F、T21、M09/M17/M38 |
| N07 | Sources聚合与路径跳转，详情按需且无大正文回灌 | E、T51/T52、M09/M34/M41 |
| N08 | 三provider常用负载和50/100关注压力，不把Codex协议硬套到Claude/ACP | G/H、Q3/Q10 |
| N09 | 听写启动取消、保留录音重试、finish-send、可达realtime客户端 | A/F、CMP-48–51、LG38/39 |
| N10 | 本地环境/分支选择真实生效与可取消/失败，任何命令执行显式呈现 | A/E、CMP-36–39 |

## 审计复核更正

- LG11的busy仅是操作提交状态，不是native running守卫；已同步更正原审计文本/JSON。native archive可能先resume，文案不能证明“不停止”。
- G21/CMP-27的浏览器适配器已核实：directory:false只上传设备文件；项目目录是另一条路径。
- Resume与worktree cwd的新源码证据见本目录[protocol-findings.json](protocol-findings.json)；均未做新的native执行验收。
