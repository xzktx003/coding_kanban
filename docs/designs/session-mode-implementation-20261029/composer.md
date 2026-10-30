# 公共输入、快捷键与首屏依赖实施记录

日期：2026-10-30。以已批准的174功能/55场景为范围；本记录负责D输入与网页设置，也列出C队列、E执行环境、F正文共同所有的边界。实现存在、测试通过、原组件对照和真实原生任务是不同证据，不合并成“全部完成”。

## 目前可核实的结果

- 公共主动作使用独立决策：听写结束发送、实时语音、Stop、Resume、普通Send/Queue/Steer；Resume使用持久操作ID，未知只核对原操作，不再发送一遍。`/status`、`/rename`、`/fork`、`/mcp`、`/personality`、`/autoreview`接真实面板/动作；`/init`在精确cwd先核对完整AGENTS.md目录结果。
- 网页快捷键可录入、即时生效、保存和重置。LG26的数字目标偏好原先缺失，本轮补齐：Ctrl/Cmd+Shift+1–9为优先集合，Ctrl/Cmd+Alt+Shift+1–9为另一集合；可交换当前窗口标签/全部关注聊天。网页保留浏览器自身数字标签快捷键。每次选择复用现有标签动作，正确同步输入目标、项目、窗口和草稿，不直接操作Agent。
- 临时标签选择器原先卸载时会清空仍挂载的主选择器，现每个注册独立回收并恢复上一有效owner。隐藏模式、模态表单、IME、重复按键不执行数字导航。
- ACP选择早期修复阻止了隐式停止与迟到覆盖，但“确认后停止旧连接”仍不满足多任务管理目标，不能作为最终选择器语义。最终由B/G线接续为多个已知owner的元数据注册与只读恢复，提供方/连接切换只导航，Stop保持独立显式动作；本记录的旧26项停止确认用例仅保留为中间反例证据。
- H18补齐网页本机聊天/代码字体和字号。逐字段保存，跨页重读当前值；仅作用于`.session-mode`。没有自定义值时保持原组件默认样式；显式代码字号覆盖原生fence固定12px，真实正文和代码均验证生效。语言仍使用已有LanguageSelector/locale能力，不实现VSCode设置桥。

## 首屏与目标恢复

`App`直达`AppLayout`，避免layout barrel提前求值所有面板。项目侧栏和右侧工具第一次可见时才下载，之后继续保留同一树；下载错误由局部边界承接，主聊天/草稿不卸载。Git元数据观察独立于右面板，GitActions直达导入，不再因无关GitStatsIndicator拉入framer-motion。

`SessionWorkbench`在layout阶段先恢复ACP本机连接指针屏障；普通Codex/Claude保存目标在App仍下载时只读准备。目标、旧sender、cwd、账号/运行scope和可见性都必须继续匹配，否则取消迟到准备。该路径不执行native resume/start/acquire。

ComposerRail使用原生CSS150ms进出场、立即inert/aria-hidden以及reduced-motion短路；队列/预览的完整界面仍在首次使用时加载。队列本身的最后一条删除/撤销寿命由C线继续验收，本记录不据Rail用例代替。

开发source map外部化保留：真实map仍由Vite自身保存并从原`.map`读取，无第二缓存，JS/query/304/HEAD/HMR契约有红绿。同一冻结websrc、仅开关该serve中间件的两组交叉诊断，external六个样本2216–2286ms，inline六个样本2254–2437ms且多数约2400ms；脚本总量约21MB→12.88MiB。样本小且共享主机有噪声，只证明保留优化有依据，不证明达标。两版使用同一旧warm=false基线，仅隔离maps变量；当前已修回批准的默认warm=true。两秒完整验收由G线最终冻结true源码执行，以上诊断不得计入30样本p95。

## 功能逐项映射

下表中的测试路径均在`apps/web/src/session-mode`下，省略该前缀。`composer/`表示`components/codex/composer/`；`v2/`为其子目录。列出复用测试只说明本轮执行覆盖，不把旧测试自动升级成新缺陷红绿。共享所有行还需对应owner的原生/组合验收。

| 功能ID | 实现位置与结果 | 直接证据/边界 |
|---|---|---|
| CMP-01 | composer/nativeComposerPlaceholder、Composer | nativeComposerPlaceholder.test；Goal/Plan/markup文案 |
| CMP-02 | ComposerEditor、v2/RichDraftEditor、composer样式 | RichDraftEditor.test、ComposerEditor.external-sync.test；展开/多行 |
| CMP-03 | composerFocus、useComposerInput、session-dom | composerFocus.test；真实隐藏模式/精确owner浏览器 |
| CMP-04 | ComposerEditor、RichDraftEditor | formatSelection.test、RichDraftEditor.test；选区/撤销 |
| CMP-05 | imeSubmitKey、editor/submitIntent | imeSubmitKey.test、submitIntent.test；composing/229/repeat |
| CMP-06 | useComposerInput及手机输入CSS | session-composer-enter、v2手机回归；尺寸模拟非实体设备 |
| CMP-07 | ComposerEnterSettings、useFollowupSettingsStore | ComposerEnterSettings.test；enter/cmdIfMultiline/cmdAlways |
| CMP-08 | composerPrimaryAction、NativeSubmitButton | composerPrimaryAction.test、NativeSubmitButton.test；普通发送 |
| CMP-09 | 同上与useComposerSubmit | Stop/停止中独立；捕获原owner，C原生Stop另验 |
| CMP-10 | 同上与FollowupQueue | Queue/Steer主动作；C共享队列原生验收 |
| CMP-11 | services/resumeInterruptedTurn | resumeInterruptedTurn.test；真实browser仅1POST+同ID只读核对 |
| CMP-12 | composerPrimaryAction | 完整优先级单测；实时音频整链见extensions-workspace |
| CMP-13 | useComposerSubmit、v2/delivery-context | delivery-context.test、drafts-recovery.test；capture-boundary浏览器 |
| CMP-14 | composer提交恢复与resume服务 | 明确失败/unknown分开；unknown不自动重投 |
| CMP-15 | FollowupQueue、native队列store | FollowupQueue.recovery.test；C独立原生共享调度证据 |
| CMP-16 | FollowupQueue暂停/继续 | FollowupQueue.recovery.test；Stop后暂停由C验收 |
| CMP-17 | FollowupQueue未知回执 | recovery.test；旧冻结条目显式迁移由C验收 |
| CMP-18 | FollowupQueue、QueueReorder | sort.test、QueueReorder.lifecycle.test；C删除撤销组合 |
| CMP-19 | QueueMessagePreview | preview.test、attachment/lifecycle.test；完整预览按需加载 |
| CMP-20 | queue菜单与sidechat | plugin.test、SideChatPanel权限/identity/close测试；C/E原生边界 |
| CMP-21 | 队列CSS与Rail | ComposerRail.queue.test；desktop/phone真实UI |
| CMP-22 | ComposerRail、ComposerRailItem | 组合、150ms退出/inert/reduced-motion红绿 |
| CMP-23 | RunningTurnChanges | RunningTurnChanges.test；独立View changes入口 |
| CMP-24 | Goal rail、goalDrafts | goalDrafts.test及原Goal专项；不据此代替原生Goal全场景 |
| CMP-25 | Goal draft清理、主控件 | goalDrafts.test、slashCommands.goal.test |
| CMP-26 | ComposerMenu、context建议 | ComposerMenu.attach.test、mentions.refresh.test |
| CMP-27 | 设备附件与项目文件/目录引用 | ContextAttachments.test、delivery-context.test；项目reference完整证据见E |
| CMP-28 | useCodexImageAttachments与ContextAttachments | 原owner上传/删除/pending；完整上传/删除与PNG原图、单图重新标注/Undo真实browser绿（deep-browser-2） |
| CMP-29 | DrawingEditor、drawingTool、ContextAttachments | drawing/drawingTool/storage测试；新增所选图片预览缺少标注入口真红→绿，PNG/原图/重新标注/Undo完整browser已绿（deep-browser-2） |
| CMP-30 | 大段paste附件与还原 | v2/context/drafts测试；完整large paste/真正final正文选区/刷新/冻结/Undo 1项8.7s绿（F复验） |
| CMP-31 | 上下文附件分型、thread-workflows、MCP App | 本地/手动/线程引用复用；MCP与PR/托管引用子能力由E/F分别提供，不用单个附件用例代替整行 |
| CMP-32 | composerDrop与Shift overlay | composerDrop.test；session-composer-drop 1440/390×明暗4组合绿，完整context与重试/原owner保持 |
| CMP-33 | contextReferenceUpdate、ContextAttachments、UndoNotice | ContextAttachments.test、v2/drafts.test；文件快照/更新/还原真实browser绿（deep-browser-2） |
| CMP-34 | slashCommands及菜单 | 不提供/ide或ide-context命令；删除未使用的ide dialog类型；自有项目文件入口保留 |
| CMP-35 | slashCommands/init | 精确线程cwd、目录完整性和已有AGENTS保护红绿 |
| CMP-36 | workspace-execution、ComposerTargetMeta | 真实cwd/worktree；E全部执行环境证据 |
| CMP-37 | 同上与slashCommands/worktree | slashCommands.worktree.test；E原生目录/持久意图 |
| CMP-38 | LocalEnvironment控制 | E核对精确configPath/owner及错误/取消 |
| CMP-39 | 分支控制和原生工作区 | E核对真实分支、已有线程只读 |
| CMP-40 | projectpicker、builtinInputNavigation | 复用真实项目选择；target-startup/数字导航/browser |
| CMP-41 | NativeModelSelector、native model目录 | default/unknown/identity/cardinality/keyboard等完整测试 |
| CMP-42 | effort/power selector | nativeReasoningOptions、power choices、wheel与真实选中测试 |
| CMP-43 | NativeServiceTierControl | 原生loading/options/selection测试，不推断账号能力 |
| CMP-44 | threadPermissionProfiles、AccessModePopover | native目录、未知失败、scope和send boundary测试 |
| CMP-45 | FullAccess确认 | full-access-confirmation.test；取消与准确原权限 |
| CMP-46 | thread collaborationMode、placeholder | Plan为真实mode，slash/placeholder测试 |
| CMP-47 | ModelChangeNotice、NativeModelSelector | 用户选择完成/结束通知测试；不把所有store变化当用户行为 |
| CMP-48 | BrowserDictationButton、主动作 | BrowserDictationButton.test，owner/失败/重试/finish-send |
| CMP-49 | 同上启动取消 | startup取消/late mic lease守卫；E音频控制器另验 |
| CMP-50 | dictation captured owner与可见性 | 目标/隐藏/卸载不改其他草稿；实体手机未测 |
| CMP-51 | RealtimeVoiceDialog与主按钮 | E官方私有daemon/WebRTC/typed/owned-stop整链；在线模型音频未测 |
| CMP-52 | v2/ComposerSheet、RichDraftEditor | v2展开代码编辑/模式/关闭/刷新真实browser绿（deep-browser-2） |
| CMP-53 | expanded submit与Stop | 共用冻结owner/mainLabel；v2手机footer/真实提交目标 |
| CMP-54 | 各独立错误面板/OptionalSessionPanel | model/optional模块503、草稿与可编辑目标浏览器；不统一写“已中断” |
| LG04 | WorkbenchShell/WorkbenchModeSwitch、SessionTopNavigation/SessionSecondaryHeader | 三模式保留各自树；SessionTopNavigation与AppLayout挂载测试、session-navigation两尺寸组合由C/E日志单列；本轮导航菜单3真实browser绿，模式隐藏不处理快捷键 |
| LG05 | useSessionTabActions/builtinInputNavigation、restoredInputTarget、ComposerTargetMeta | 精确card种类+ID/cwd、ACP恢复屏障；session-input-target-startup与数字导航两尺寸绿，捕获project/model边界2browser绿；4个leave-return新反例红→57领域组合绿 |
| LG19 | ConversationMenu→threadWorkflowActions.copyMarkdown | ConversationMenu.native.test、ThreadWorkflowClipboard.http.test；dialog-controls浏览器执行中 |
| LG20 | 同上copyDeeplink/copyLink、threadLink | 精确thread网页URL；HTTP clipboard测试、真实菜单浏览器执行中 |
| LG24 | GeneralSettings与SessionSecondaryHeader | typography两尺寸真实设置/返回/草稿绿；既有secondary/return导航回归 |
| LG25 | sessionKeyboardShortcuts、KeyboardShortcutsSheet | 录入/冲突/保存/重置；两尺寸刷新后真实手势绿 |
| LG26 | useSessionNumberNavigation、sessionTabSelect | 数字两目标、持久偏好、选择器owner恢复；两尺寸切换/草稿/刷新/无写入绿 |
| LG38 | BrowserDictationButton、microphoneLease、pcm-audio | 本机浏览器捕获/取消/权限状态；5项原组件单测，新增真实Chrome媒体网页验收执行中，后端转写明确fixture |
| LG39 | 同上与Composer captured owner/finish-send | 同录音重试/原owner/离开失效单测；桌面/手机媒体资源关闭与权限拒绝浏览器执行中，不复用Realtime WebRTC证据 |
| LG40 | ultraFullAccessGate、ModelReasonSelector | ultra-full-access.test及fullaccess取消/未知权限测试 |
| H02 | 网页命令、shortcuts、GeneralSettings | 上述LG25/26、slash真实面板；VSCode命令桥排除 |
| H18 | TypographySettings/useTypographyStore、LanguageSelector | 本机逐字段/越界拒绝/跨页/默认重置；正文18px/code20px真实browser绿 |

## 本轮日志与测试边界

所有私有日志位于忽略目录`.dev-runtime/composer-closure-20261030`，不提交登录/Token/机器私有配置。浏览器在自有`0.0.0.0`监听的HTTPS LAN fixture上执行，无API代理、无正式native写入端点；每个场景显式安装隔离协议fixture。

- `final-unit.log`：118文件985项通过，包含composer目录、快捷键/数字导航/目标恢复、conversation action、权限profiles、layout寿命。该轮之后增加的ACP/字体用例另列，不误报为同一次全量。
- `acp-switch-red-2.log`与`acp-switch-target-green.log`：隐式stop/lateACK真反例；后者3文件26项绿。随后9组件用例与font/target/layout组合24项通过，见`typography-integration-green.log`。
- `maps-browser.log`：25项通过，覆盖两个尺寸的命令面板、真实Resume unknown、快捷键、首次model/menu手势、模块被持住/503、早期精确目标、数字导航。
- `accepted-browser.log`：9项通过，新增真实正文/代码设置、刷新、重置、草稿与原输入保留；其余包含optional layout/target/数字导航。font真实fence最初两个尺寸均测得12px为红，见`typography-browser-red-2.log`，覆盖后20px为绿。
- source map真实server脚本与连续性/React/icon保护共12项通过；最后同步lookup版本map单测2项通过。尚未把该实验列为性能已通过。
- `performance-*`均为每页1个诊断样本，`acceptanceEligible:false`。此前导航约1.8秒、输入约2.1–2.4秒，门槛没有放宽。G线最终30样本、50/100压力和30分钟JS堆/RSS仍独立。

原包对照依据固定`openai.chatgpt-26.51007.21434-linux-x64`的实际F/Queue/Permissions/LocalWorkspace/shortcut模块及已有原始图标/tooltip交互断言。上述jsdom图标/tooltip断言不是本轮完整官方Webview视觉对照；不能据命名含native就宣称所有菜单、语音、在线账号或实体手机已经通过。


## 深层回归发现与跟进

本轮另跑旧有23项深层真实browser，首轮14绿/9红，日志`composer-deep-browser.log`。红灯不能跳过：所选单图预览缺少标注按钮是真缺陷，已补ready门控和精确item回调，新组件两个反例转绿，完整PNG/原图/撤销用例重跑中。其余包含旧UI标签（排队消息→加入队列、斜杠命令入口→快捷命令、High→高以及窄屏effort分级折叠）和历史虚拟滚动假设，逐项按真实手势适配；不删除原有内容/像素/草稿/未知回执断言。若出现实际quote选择、排队或滚动问题，继续先复现再修复，未闭合项不计通过。

默认关注预热已按批准Q5/Q8纠正为true；新设备与旧版本缺键三项先红，改后6项绿，显式false保留。资源不足时仍按统一预算回收，后台状态/审批/草稿不依赖正文挂载。修正记录在`warm-default-{red,green}.log`。


## 第二轮深层闭合（2026-10-30）

- `selectCodexInputTarget`集中原有当前thread/currentTurn推导的纯store步骤，工作台layout立即准备正确输入；native history仍由原服务只读恢复。最新CPU诊断的导航后主长任务约367→256ms、晚到target回调消失；单测`target-navigation-integration.log`为6文件73项绿，不计两秒通过。后补selection/sender/cwd/provider离开再返回的4个真实反例，准备一旦失去owner便永久取消，短期订阅在完成/取消时释放。
- Git提交表单与关注菜单正文从触发器静态图分离，已访问Git表单保持原树。首次键盘打开关注菜单时，模块到达后仅在焦点仍属于原菜单时聚焦首个可用项；不会抢回用户已移开的焦点。Git慢模块加载反馈修复为同scope可点击浮层，真实桌面加载取消、commit草稿和菜单键盘回归已过；手机组合继续以实际“更多功能”入口与Dialog卸载后再导航核对。
- 主composer会话菜单原先依赖可选onRename回调，正常宿主未传该回调，因此“重命名聊天”永远禁用。现无回调时复用捕获owner的表单：名称与pending按原thread保存，跨目标仍写原thread，scope撤销保留内容并拒绝写入。两个新增反例先红，连同旧owner表单/原菜单2文件106项全绿，`menu-rename-red.log`/`menu-rename-green.log`。
- 真实深层旧测试的各类漂移分别处理：Queue文案、Plan的真实状态面板、窄屏控件分级、当前会话操作的附加菜单入口；不通过改产品为旧测试提供隐藏入口。已完成回答和运行commentary须分清，引用选区场景仍保留大paste、刷新、Queue冻结和Undo全链，不以固定sleep掩盖。
- source-map脚本测试补自有随机端口、listen失败finally释放和5秒请求诊断；Vite的port:0会选默认5173，不能作为隔离随机端口。默认端口确有其他自有fixture占用时2项仍通过，见`source-maps-owned-port-green.log`，不停止占用者换绿。


冷图最后一轮消除13个barrel消费者：App初始化直达lifecycle，任务服务按codex/git/skills/threadOps实际拥有者导入，通知/模型/Slash/目录/automation直达模块；4个RPC store、useCodexEvents和CC manager直达API。兼容`services/index`/`apiAdapt/index`导出保持，未改native请求/observer或事件顺序。原测试mock追随实际入口，`barrel-integration-green.log`21文件184项全绿，`types-barrel.log`前端tsc零错误；该批尚不宣称性能收益，正式新冻结需包含它和root的Radix保护。


## 听写真实浏览器收尾（2026-10-30）

隔离冻结前端绑定 `0.0.0.0`，局域网 HTTPS 地址为 `https://10.30.0.24:46477`；没有 API 代理或正式 native 任务端点，所有测试写入由私有 fixture 接收。`session-dictation.spec.ts` 与 `session-dictation-permission.spec.ts` 共四项真实 Chromium 用例通过（13.1 秒），日志 `.dev-runtime/composer-finish-20261030/dictation-browser-final.log`：

- 桌面 1440px 和手机 393px 均由原生 `getUserMedia`、AudioContext 和 audioprocess 取得非空 PCM；Stop 后所有 track ended、所有 context closed。503 后显式重试使用逐字节相同的录音，只申请一次流，不写其他目标或发送任务。
- 结束并发送将原草稿与转写文本合并，私有队列只生成一项；明确 fixture tick 后仅一个 `turn/start`，thread 为 ux-0，提交内容准确、原草稿已清空。转写服务是 fixture，不将此结果写作真实线上模型转写已验收。
- 权限拒绝使用完整 headless Chromium (`channel: chromium`)、仅 fake-device，不启用绕过权限的 fake-UI；CDP denied 与 Permissions API denied 相符，实际媒体调用产生 `NotAllowedError`/`DOMException`，页面显示专用权限提示、资源释放、原草稿仍可编辑，零任务写入。默认 headless shell 在无 fake-UI 时 granted/denied 都返回 NotSupportedError；fake-UI 又会绕过拒绝，所以两者均不算本权限关卡的证据。原生能力对照保存在忽略目录 `native-permission-variants.json`，初始失败日志保留。

单测 `BrowserDictationButton`、主动作优先级和恢复输入目标三文件 23 项通过（2.85 秒）。外置 source map 的真实 server/304/HMR 与直接 Radix 的冷图/context 身份四项通过（0.34 秒）。这些专项通过不替代最终全部源码整合、两秒性能、长时 RSS 或实体手机验收。


## 全量整合的测试边界修正

第一次本轮全量扫描 735 文件、4478 项，保留 33 文件失败和 12 个异步错误的原日志（`.dev-runtime/composer-finish-20261030/web-final-full.log`）。其中 30 文件的实际协议 fixture 仍 mock 已移出冷图的 `apiAdapt` 总导出，真实消费者已直达 codex/filesystem 等所属模块；原 fixture 因而漏拦截读写，并非模型、审批或历史功能全部失效。现在 fixture 绑定实际所有者，保留真实 hook/cache/组件、逐字段断言及无意外网络保护；native nonmodal 的模型与 RPC mock 合并到同一实际模块，防止相互覆盖。菜单 parent-lifetime 测试改用真实空撤销栈的禁用项，不能再把已修复的正常重命名表单当禁用项。上述三组专项合计 30 文件、409 项通过，另三文件的 JSON/telemetry 边界由读取负责人单独验收。最终仍需再跑完整源码的全量零失败/零未处理错误关卡，专项不得替代。

ACP 的旧两个新建测试不再要求弹出“中断并新建”或发 cancel。使用带真实 runtime/connection/独立 historySessionId 的运行中 A，桌面与窄屏真实新建手势触发独立 B 的 start 503；原 A、草稿、停止按钮和来源均保留，cancel/new-session/stop 为零。两项通过 11.9 秒；原目录显式与整套响应式第二项内容保持，补跑两项通过 16 秒。该批前端是负责人自有 `0.0.0.0` 监听的 HTTPS `https://10.30.0.24:39831`，无正式 API 代理；新多 owner 成功、审批和恢复由性能负责人另一套用例独立验收。


## 冷图剩余 Radix 总导出修正

最新三页资源诊断（冻结 1793310557647）中，导航前仍由 button/sidebar 的 Slot、sheet 的 Dialog 和 popover 的 Popover 引入 `radix-ui` 总目录：226,888 字节的目录脚本在 637–713ms 加载，另带共享 chunk。现在这四个入口直达项目已经锁定的 primitive 包，不新增依赖、不延后当前输入、权限或后台任务同步。扩展冷图用例先复现总目录仍被引入，再转绿；旧 tooltip/separator 加新四入口、原组件 provider/context 身份四项脚本通过（0.41 秒）。

本地实际包比较确认 Dialog/Popover 仍为同一个 1.1.15 实例，各 Root/Portal/Overlay/Content/Trigger 等严格相同；Slot 是既有直接依赖 1.2.4，对照旧总目录的 1.2.3，以真实 DOM 属性、style 优先级、事件/defaultPrevented 顺序、组合 ref attach/null 及实际 asChild Button 单目标行为验证兼容。Slot/Sheet 焦点/嵌套菜单/关注菜单五文件 18 项通过，前端 tsc exit 0。日志 `.dev-runtime/composer-finish-20261030/radix-remaining-{cold-red,cold-green,behavior}.log` 与 `radix-final-types.log`。冷图证明和行为证明不等同于两秒正式样本通过；新冻结三页与实际 popup 性能另验。


## 实际新窗口输入性能（独立于普通三页冷进入）

LG21 在 HTTPS 局域网 `https://10.30.0.24:44723`（`0.0.0.0`，冻结 1793314563632）的专项完成 30 次真实菜单点击、同步 `window.open`。原页 30 个关注、4 个可见窗格，另有两个已加载页面；每次测量实际第四页的唯一目标和可编辑输入区，核对新 UUID、`opener === null`、单窗格空草稿、输入保存与原页现场不变。原生 HTTPS EventSource 开启 33 次，实际自有 Vite HMR 连接 33 次；浏览器未过滤的 console/page/socket error 和原生任务写入均为零。此项通过 2.1 分钟，不能替代普通三个页面同时冷进入的另一个关卡。

| 实际手势到可用状态 | p50 / ms | p95 / ms | 最大值 / ms |
| --- | ---: | ---: | ---: |
| 导航 | 1294.5 | 1356.800048828125 | 1365.5 |
| 正确目标、可编辑 composer | 1652.5 | 1722.599853515625 | 1730.89990234375 |
| 原生 keydown 至两个动画帧且正文已更新 | 28 | 39.800048828125 | 40.300048828125 |

首次试跑的红灯同样保留：文件搜索 fixture 返回 `{}` 而真实协议应为 `[]`，造成可见 console error；输入计时还包含了断言与 CDP 往返，不能当作浏览器两个帧的耗时。修正 fixture 的真实数组响应，改为在原生 keydown 内安排两个 RAF 并核对文本后，原门槛 2000 / 100ms、完整 30 样本及零错误要求均通过；产品没有为此次重测改动。详见 `.dev-runtime/composer-finish-20261030/popup-performance{,-red}.log` 及各输出目录的 `new-window-performance.json`。冻结前端关闭正式 API 代理，模型、登录和磁盘历史延迟不在此专项内；模拟桌面浏览器不等于物理手机。共享主机的系统负载只作观察，不能声称整机无其他负载。


最新完整 Web 扫描保留 `.dev-runtime/composer-finish-20261030/web-clean-final.log`：752 文件、4606 项，751 文件 / 4605 项通过，仅旧运行代次取消断言失败（538.07 秒，无未处理错误）。该断言仍要求 UI 恢复 Promise 抛 AbortError，但当前公开契约是 UI 静默消费来源切换取消、后台历史消费者通过 `reportScopeChanges:true` 收到明确类型错误并保持待恢复状态。测试同时建立这两类消费者，仍验证旧传输已中止、新请求可入场、迟到旧快照不能覆盖新轮次；两文件 21 项转绿，产品未改。此记录不是最终全量通过，最终零失败扫描另行记录。


最终完整 Web 验证已通过：`pnpm --filter web exec vitest run --config vitest.session.config.ts`，752 / 752 文件、4606 / 4606 项，exit 0，537.82 秒，无未处理错误。使用原配置 `maxWorkers=2`，未删除失败断言、放宽时间或跳过用例；旧失败扫描均保留。日志 `.dev-runtime/composer-finish-20261030/web-clean-final-green.log`，本次与上次唯一变化为已明确的 UI / 后台调度取消契约测试修正。该全量结果不替代真实浏览器、连续内存和部署后原生服务关卡。


后续源码边界：上述 752 文件 / 4606 项是 metadata/list 完整连接来源隔离补丁之前的精确全量结果。该窄补丁正在由来源隔离负责人以独立红灯复现、修复和验收；不能把此日志或旧冻结 44723 的 LG21/popup30 结果标成补丁后的测试。最终新冻结及其补验另记，旧证据不覆盖、不删除。


## metadata/list 来源隔离补丁后的新窗口终验

最新普通冻结为 HTTPS `https://10.30.0.24:38337`（`0.0.0.0`，冻结 1793325611544，2887 个 Web 文件 + 89 个 shared 文件；真实 HMR 开、文件监听关，无 API 代理或 HTML 夹具注入）。`codexService.ts` SHA-256 为 `9279231f64059f08999d904106f38dd50442aa911061bc72a61f7bf5c611b3a5`。同一最新源码完成 30 次实际第四窗口手势，exit 0，2.0 分钟；三已有页面、原页 30 关注 / 4 可见窗格、唯一目标、独立空草稿及父页面现场保留均保留原断言。

| 最新源码实际手势指标 | p50 / ms | p95 / ms | 最大值 / ms |
| --- | ---: | ---: | ---: |
| 导航 | 1261.5 | 1365.2998046875 | 1366.39990234375 |
| 正确目标、可编辑 composer | 1629.599853515625 | 1715.7998046875 | 1719.199951171875 |
| 原生 keydown 至两个 RAF 且文本已更新 | 23.099853515625 | 32.89990234375 | 37.2998046875 |

33 条原生 HTTPS EventSource、33 个真实自有 HMR 连接；未过滤的 console/page/socket error 与任务写入均为零。原 2000/100ms p95 门槛、完整 30 样本和所有错误记录保持。日志 `.dev-runtime/composer-finish-20261030/popup-performance-38337.log`，原始结果位于同名输出目录的 `new-window-performance.json`，开始前源码/驱动摘要为 `new-window-38337-source.json`。普通三页的原生 HTTP 正式 90 样本另由性能文档记录：其 p95 通过，包含真实冷服务首轮最大 4.63 秒，不能写成所有加载都硬性低于两秒，也不能归因为单纯缓存收益。此处 popup 结果不替代该普通冷进入或自然 30 分钟内存验收。


同一 38337 新冻结补跑 LG21 全部十个功能浏览器用例，10 / 10 通过（1.4 分钟）：桌面 1440 与手机 393，单一正确输入目标、原页分屏及草稿、插件/Agent 富引用交错保存和刷新隔离、同一端点重新绑定、未知/重复 URL、不同 namespace/端点及错误线程元数据的拒绝路径均保留断言，任务写入为零。日志 `.dev-runtime/composer-finish-20261030/new-window-38337-final.log`。全量 Web 补丁后扫描另行记录；不能用旧 752/4606 日志冒充其结果。


metadata/list 窄修后已先后通过753/753两次：旧9279231 guard源753/4618、533.84秒见 `.dev-runtime/composer-finish-20261030/web-post-source-fence-final.log`；新budget/SSE/cache/shared source 753/4635、535.76秒见 `.dev-runtime/session-full-implementation-20261029/web-after-budget-offline-20261030.log`。LG21十项功能与30个popup样本仍由旧38337独立记录；历史红灯和跨源结果均保留。连续内存、真实官方CLI交互及正式LAN部署由各自关卡独立记录。
