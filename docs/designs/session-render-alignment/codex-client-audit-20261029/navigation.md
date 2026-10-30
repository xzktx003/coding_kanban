# Codex 本地客户端对照审计：导航、归档、设置与外围功能

基线：`f6699ba064059009529a50b0c126cbed4402f093`；原包：`third_party/openai.chatgpt-26.51007.21434-linux-x64/extension`。审计日期：2026-10-29。

本文件是独立审计分片，供主报告合并。仅使用当前原包和当前源码；没有启动/停止正式任务、连接默认 IPC、读取登录数据、修改产品或发送反馈。原包定位使用从零开始的 **UTF-16 字符偏移**（不是 UTF-8 字节），每条 JSON 保留可重找 needle。

“已对齐”仅指列明的静态行为子集，不代表像素、真实浏览器、性能、真账号或所有门控分支已验收。“门控或未验证”不可直接列为已确定产品缺陷。所有 shared chunk 的源码存在性与 VSIX 入口可达性必须分开。

## 当前已确认且没有被旧文档覆盖的重点

- `appActionHistory.ts` 已存在，因此“没有全局撤销”过时；真正差异是归档和列表重命名未接入，以及缺少原生异步按目标事务队列。
- 列表归档已有中文成功/失败反馈；但列表操作标签和归档设置页仍是英文。
- ConversationMenu 的重命名仍因两个生产调用点未传 onRename 而 disabled；列表另一路支持重命名。
- 快捷键表单录入/重置未实现保存；官方共享设置 chunk 有真实 set/reset mutation，VSIX 暴露性还须单独确认。
- 本地归档页固定前 50 条且无继续游标；这是静态确认的本地限制，官方归档设置长列表 UI 尚未复验。
- Ultra 门控已实现；剩余差异是 permissionProfile 与 per-host 非 full access fallback。
- 本地网页听写缺官方失败后保留音频的 retry 分支；手机/多窗口的真实音频焦点未验。

## 功能清单与逐条对照

| ID | 功能 | 状态 | 官方实际来源 | 本地实际来源 | 结论 |
|---|---|---|---|---|---|
| LG01 | 关闭标签与实际任务解耦 | 项目特色 | `app-initial-41ab338a184f.js` @2432947（源码实现） | `apps/web/src/session-mode/hooks/useSessionTabs.ts:20` | 本地 closeTab 只 removeCard/切到下一目标；不 interrupt/delete。官方本地聊天窗口操作有独立动作；不能把保留 Agent 当缺陷。 |
| LG02 | 跨设备关注标签集合 | 项目特色 | `app-initial-fee819fe4f22.js` @707234（协议注册，不证明官方同功能） | `apps/web/src/session-mode/stores/useAgentCenterStore.ts:5` | 本地 journal + shared revision + pending operations 保留跨设备关注集合；官方 thread/list 协议不等于此看板关注协议。官方对等跨设备集合未证实。 |
| LG03 | 手机列表长按菜单 | 项目特色 | `zh-CN-b05cfd55c534.js` @1766889（源码实现） | `apps/web/src/session-mode/components/codex/thread/ThreadList.tsx:455` | 本地自有 touch 长按定时器，pointer move/up/cancel 撤销；官方 VS Code 客户端是否同样在手机触发没有真实浏览器证据。 |
| LG04 | 三模式与二级导航 | 项目特色 | `app-initial-41ab338a184f.js` @3221688（源码实现） | `apps/web/src/session-mode/components/layout/SessionTopNavigation.tsx:93` | 本地会话/终端/Codex 与 agent/automations/设置共用导航，非官方 VS Code 侧栏路由等价物。 |
| LG05 | 项目选择与输入目标联动 | 项目特色 | `app-initial-fee819fe4f22.js` @706265（协议注册） | `apps/web/src/session-mode/hooks/useSessionTabs.ts:32` | 本地选标签同时切 agent、cwd、当前 thread；官方 project RPC 仅可证明协议能力，不能说明本地项目/跨设备交互一致。 |
| LG06 | 列表内重命名 | 已对齐 | `app-initial-41ab338a184f.js` @2433350（源码实现） | `apps/web/src/session-mode/components/codex/thread/ThreadList.tsx:426` | 列表已有真实编辑表单、保存/错误/迟到回执保护；仅重命名动作存在对齐。官方重命名额外进入 app undo，本地列表未登记，撤销语义见 LG09。 |
| LG07 | 会话动作菜单重命名可用性 | 确定差异 | `app-initial-41ab338a184f.js` @2433225（源码实现） | `apps/web/src/session-mode/components/codex/composer/ConversationMenu.tsx:423` | 菜单要求 onRename，Composer.tsx:877 与 SessionSecondaryHeader.tsx:16 均没有传入，因此有 thread 时动作仍 disabled；列表另一路可重命名不弥补菜单入口。 |
| LG08 | 归档接入全局撤销 | 确定差异 | `app-initial-41ab338a184f.js` @2425338（源码实现） | `apps/web/src/session-mode/components/codex/composer/archiveThreadUndo.ts:91` | 官方 s2n 用 bu 登记 perform/redo/undo 与 transitionQueueKey、restorePin:true。本地归档只给 toast 60 秒按钮，没有 recordAppAction；全局 undo 菜单虽然已存在，却不能撤销归档。 |
| LG09 | 全局撤销事务与覆盖范围 | 确定差异 | `app-initial-41ab338a184f.js` @2426203（源码实现） | `apps/web/src/session-mode/components/codex/composer/appActionHistory.ts:1` | 本地已有 past/future 栈，不能再报告“完全无全局撤销”；但只有同步 void 回调、无 host/thread 分区、无异步事务/失败回滚/60 秒窗口，列表重命名也未入栈。官方 s2n 的异步队列事务有明确差异。 |
| LG10 | 归档成功即时反馈 | 确定差异 | `app-initial-41ab338a184f.js` @2428311（源码实现） | `apps/web/src/session-mode/components/codex/thread/ThreadList.tsx:324` | 官方 local archive 的成功路径回调+d()，没有此处直接 success toast；本地列表与 OwnerForms 都显示“已归档聊天”及撤销。旧文档“列表静默/错误为英文”已过时。 |
| LG11 | 运行中归档语义与确认 | 差异/原生生命周期待验 | `app-initial-41ab338a184f.js` @3854891（源码实现） | `apps/web/src/session-mode/components/codex/composer/ConversationOwnerForms.tsx:97` | 官方运行确认明确 Stop and archive/停止工作。复核更正：本地 busy 仅为操作提交状态，不是 native running；菜单/列表没有运行或队列守卫。运行层 archive 可能先 resume，尚未验证 native archive 对运行线程的生命周期影响，因此表单“Agent 不会被停止”不能当保证。停止与归档语义须由方案明确。 |
| LG12 | 已计划任务/运行组合归档确认 | 门控或未验证 | `app-initial-41ab338a184f.js` @3855600（源码实现） | `apps/web/src/session-mode/components/codex/composer/ConversationOwnerForms.tsx:97` | 本地只有单一固定归档文案；官方当前源码可直接确认 Priority running 批量变体。计划任务四态细分在旧 handoff 有证据，本轮未逐条追到当前可达调用，不能扩大为所有宿主必缺。 |
| LG13 | 归档撤销恢复原置顶 | 确定差异 | `app-initial-41ab338a184f.js` @1723823（源码实现） | `apps/web/src/session-mode/components/codex/composer/archiveThreadUndo.ts:26` | 官方 unarchive 带 restorePin。当前本地捕获 thread/card 原索引并恢复关注行，不是原生 pin 事务；本地置顶另存 usePinStore。跨设备/重复撤销不能以普通 unarchive 成功代替 restorePin 验收。 |
| LG14 | 归档列表长历史分页 | 门控或未验证 | `app-initial-fee819fe4f22.js` @707234（协议注册） | `apps/web/src/session-mode/components/settings/codex/ArchivedThreadSettings.tsx:24` | 已确认本地固定 cursor:null/limit:50，无 nextCursor 消费及加载更多，因此第 51 条以后归档不可达。官方 RPC 支持列表不直接证明官方设置页分页呈现；此条是本地静态限制，官方长列表实际表现待补。 |
| LG15 | 归档设置页中文与错误文案 | 确定差异 | `zh-CN-b05cfd55c534.js` @1766889（源码实现） | `apps/web/src/session-mode/components/settings/codex/ArchivedThreadSettings.tsx:69` | 本地 Archived Threads/Refresh/Unarchive/Loading/Failed to load... 为硬编码英文；官方该版本中文资源提供归档和取消归档相关中文。页面整体布局未做像素判定。 |
| LG16 | 列表操作中文标签 | 确定差异 | `zh-CN-b05cfd55c534.js` @1779070（源码实现） | `apps/web/src/session-mode/components/codex/thread/ThreadList.tsx:503` | 当前仍是 Rename/Pin/Unpin/Fork/Archive/Delete/Copy Id；官方本地 Codex 中文资源有重命名聊天/归档聊天。不能用动作菜单的中文覆盖列表缺口。 |
| LG17 | 置顶的数据域与撤销 | 项目特色 | `app-initial-41ab338a184f.js` @2426613（源码实现） | `apps/web/src/session-mode/components/codex/composer/ConversationMenu.tsx:453` | 本地 usePinStore.togglePin，并登记本地 recordAppAction；官方 l2n 由原生 threadIds/useAppServerPins 决定。两种持久化和跨端域不同；不能称原生 pins 已完全复用。 |
| LG18 | 标记未读写入域 | 确定差异 | `app-initial-41ab338a184f.js` @2429464（源码实现） | `apps/web/src/session-mode/components/codex/composer/ConversationMenu.tsx:957` | 官方 GG 调原生 manager.markConversationAsUnread，受 canMarkUnread 约束。本地直接 useSessionAttentionStore.markUnread 并自有 toast，属于看板注意力语义，与官方原生 read-state 写入不同。 |
| LG19 | 复制为 Markdown | 已对齐 | `app-initial-41ab338a184f.js` @2432311（源码实现） | `apps/web/src/session-mode/components/codex/composer/ConversationMenu.tsx:898` | 当前已有捕获 thread 的复制 workflow/正文投影；本轮仅确认入口与目标绑定存在，不把 clipboard 权限、超长历史或全部原生 Markdown 语法判为通过。 |
| LG20 | 复制深度链接 | 门控或未验证 | `app-initial-41ab338a184f.js` @2427726（源码实现） | `apps/web/src/session-mode/components/codex/composer/ConversationMenu.tsx:907` | 官方 d2n 生成 codex://threads/UUID 并按 host/access 改写。本地请求 copyDeeplink workflow；最终看板 HTTP 路由与官方 URI schema 的开箱互通未执行真实跳转。 |
| LG21 | 在新窗口打开聊天 | 项目特色 | `app-initial-41ab338a184f.js` @2432947（源码实现） | `apps/web/src/session-mode/components/agent/SessionTabs.tsx:1` | 官方存在 open in new window。看板窗口/网格/标签/分享源属于网页编排；本轮没有逐一证明独立浏览器窗口与 VS Code 窗口焦点/唯一实例一致。 |
| LG22 | 文件浏览器移动端与未保存保护 | 项目特色 | `app-initial-fee819fe4f22.js` @704778（协议注册） | `apps/web/src/session-mode/features/files/FilesPanel.tsx:62` | 本地有文件编辑草稿、关页确认、手机树 overlay、项目根匹配与已访问文档保留；官方在 VS Code host 打开文件，两种编辑容器不同，不能当作原生缺失。 |
| LG23 | VS Code 面板保持挂载 | 项目特色 | `app-initial-41ab338a184f.js` @2432947（源码实现） | `apps/web/src/session-mode/features/vscode/VsCodePanel.tsx:102` | 本地每 canonical workspace 保留 iframe，隐藏 inert/hidden，不卸载；Bridge owner 变化只重绑桥。官方已运行于 VS Code，本地嵌套编辑工作区是看板专有。 |
| LG24 | 设置页手机布局 | 项目特色 | `settings-page-b3a9b4fa84ae.js` @35004（共享 chunk/可达性门控） | `apps/web/src/session-mode/components/settings/SettingsView.tsx:80` | 本地小屏 Select 切 section，桌面 Sidebar，section state 在组件内存；官方 shared settings router 的 mcp-settings 不是证明此 VSIX 侧栏所有大应用设置均可达。 |
| LG25 | 自定义快捷键保存与重置 | 确定差异 | `keyboard-shortcuts-settings-ae054b113aa1.js` @8969（共享设置实现，宿主门控待验） | `apps/web/src/session-mode/components/codex/composer/KeyboardShortcutsSheet.tsx:5` | 本地固定 9 项；录入只 setRecording，没有按键事件/持久化；全部重置无条件提示无法保存。官方此 chunk 有 set/reset mutation、缓存失效、onKeyDown 捕获。需要先验证当前 VSIX host 是否允许 webview 配置，不能直接等同 desktop 全量。 |
| LG26 | 数字键聊天/标签目标偏好 | 门控或未验证 | `keyboard-shortcuts-settings-ae054b113aa1.js` @6564（共享设置实现，宿主门控待验） | `apps/web/src/session-mode/components/codex/composer/KeyboardShortcutsSheet.tsx:5` | 官方该设置源提供 primary/secondary modifier 与聊天/标签目标偏好；本地固定清单不呈现该偏好。官方 VSIX 暴露性及本地全局快捷键能力需专门 browser/host 验证。 |
| LG27 | 插件安装与认证后续 | 门控或未验证 | `app-initial-fee819fe4f22.js` @705803（协议注册） | `apps/web/src/session-mode/features/plugins/hooks/usePluginsView.ts:102` | 本地真实 pluginInstall、appsNeedingAuth/installUrl、安装状态/详情重读/能力失效均存在；不能再报“纯占位”。本轮仅核协议和本地流程，当前 VSIX 插件页面可达/全部 authTargets 顺序交互未做宿主实测。 |
| LG28 | 插件卸载与状态刷新 | 门控或未验证 | `app-initial-fee819fe4f22.js` @706123（协议注册） | `apps/web/src/session-mode/features/plugins/hooks/usePluginsView.ts:155` | 本地精确 pluginUninstallId，成功刷新 detail/list 并 invalidatePluginCapabilities；原生安装/卸载错误、多个市场同 ID 与多窗口传播需真实夹具验收。 |
| LG29 | 插件/技能/连接器导航 | 项目特色 | `plugins-settings-db3c5e2f03ef.js` @1740（共享 chunk/可达性门控） | `apps/web/src/session-mode/features/plugins/hooks/usePluginsView.ts:20` | 本地 Plugins/Skills/Connectors 三主 tab + manage/add/detail overlay，自有 skill group/scope。官方 shared marketplace/settings 存在不等于 VSIX 所有分支开放。 |
| LG30 | MCP 重新认证状态机 | 已对齐 | `app-initial-fee819fe4f22.js` @6030106（源码实现） | `apps/web/src/session-mode/features/native-mcp-auth/controller.ts:42` | 已对齐已检查子集：required/context/login/prompt、重复挑战不重复 OAuth、取消提示不取消已发 OAuth、完成后 reload、失败可重试。官方 eQa 解析 scope，RPC 断线清理；本地 capability/version 门控附 threadId。未声明 OAuth 真账号/UI 全量已验。 |
| LG31 | MCP 认证账号/实例切换失效 | 项目特色 | `app-initial-fee819fe4f22.js` @6030106（源码实现） | `apps/web/src/session-mode/features/native-mcp-auth/service.ts:143` | 本地 pairing endpoint/凭据身份、account namespace、runtime restart 均重建 metadata controller；断开停止自有观察，不停止 MCP/native Agent。是网页多端适配额外身份约束。 |
| LG32 | MCP 管理页与配置 | 门控或未验证 | `mcp-settings-d97bd675286f.js` @496（源码实现） | `apps/web/src/session-mode/features/mcp/CodexMcpView.tsx:1` | 本地存在 MCP server form/card/add/default 与认证状态；官方设置 chunk 仅表明外部工具入口。安全配置文件写入/连接器多页一致性及 VSIX 页面真实呈现未验，不以文件存在声明全量对齐。 |
| LG33 | ChatGPT/API key/device code 登录 | 门控或未验证 | `app-initial-fee819fe4f22.js` @703816（协议注册） | `apps/web/src/session-mode/components/codex/CodexAuth.tsx:135` | 本地 OwnedLogin 捕获 epoch/source/runtime/loginId，支持 OAuth/device code/API key，异步早到 completed 保留后核对。真实账号登录/套餐策略本轮不读秘密、不发登录，因此保留未验证。 |
| LG34 | 登录取消与未知回执 | 项目特色 | `app-initial-fee819fe4f22.js` @703783（协议注册） | `apps/web/src/session-mode/components/codex/CodexAuth.tsx:61` | 本地显式 idle/sending/uncertain、runtime identity 变更使旧登录作废；关闭视图不冒充取消服务端登录。官方 exact cancellation GUI 及晚到通知对比仍待夹具。 |
| LG35 | 原生账户用量与复原 | 已对齐 | `app-initial-fee819fe4f22.js` @245967（源码实现） | `apps/web/src/session-mode/features/codex-account/NativeCodexUsage.tsx:49` | 已对齐子集：account/get(refreshToken:false)、rate-limits、多 bucket/window、remaining/reset、notification 与断线 resync。Claude 用量卡是看板特有；未验真实套餐/额度刷新，不能以百分比界面证明计费一致。 |
| LG36 | 反馈入口与权限预检 | 门控或未验证 | `app-initial-fee819fe4f22.js` @704661（协议注册及本地防护） | `apps/web/src/session-mode/features/native-feedback/preflightWorkflow.tsx:88` | 本地捕获可见 host/thread/cwd/draftOwner，打开和提交前只读预检，实例/账号/可见性变化 revoke，timeout 15 秒。属于已有实现，非缺失；官方组织/有效 config 分支与 ChatGPT 实际策略未动用账号验证。 |
| LG37 | 反馈上传六态及关窗后继续 | 已对齐 | `feedback-upload-10d8b6133f0f.js` @11978（源码实现） | `apps/web/src/session-mode/features/native-feedback/controller.ts:1` | 官方该原包上传错误映射 incomplete/disabled/failed/unconfirmed 与本地一致；本地上传 UI 关闭不取消已发任务，只有 failed 保存 submit 支持重试。只读源码子集对齐，未发送反馈。 |
| LG38 | 听写启动/转录/失败重试 | 确定差异 | `app-initial-fee819fe4f22.js` @4412674（源码实现） | `apps/web/src/session-mode/BrowserDictationButton.tsx:27` | 官方 u4i 明确 idle/starting/dictating/retry、canRetryDictation、retryDictation 和 cancel-start 分支。本地 browser starting/recording/processing/failure，stop 后 finally 清 chunks，失败无保留音频重试入口；移植了模型下载/Whisper fallback，非同一听写状态机。 |
| LG39 | 听写与会话草稿归属 | 已对齐 | `app-initial-fee819fe4f22.js` @4412674（源码实现） | `apps/web/src/session-mode/components/codex/composer/Composer.tsx:1126` | 本地 key={owner} 重建 DictationButton，onTranscript 闭包 readDraft(owner)/setText(owner)；BrowserDictationButton cleanup 停麦克风/断开音频节点。未发现仅凭 latest callback 可串写另会话的证据。官方起停状态可比，手机后台音频权限仍未实测。 |
| LG40 | Ultra+Full Access 二次确认 | 确定差异 | `app-initial-fee819fe4f22.js` @3221386（源码实现） | `apps/web/src/session-mode/components/codex/composer/ultraFullAccessGate.ts:24` | 确认框和 keep full access/fallback/dismiss 已实现，不能报缺失。官方 permissionProfileId 条件与 per-host preferred non-full-access；本地 permissionsKnown+sandbox，fallback 固定 workspace-write/on-request，不能产生原生无 fallback 的实际运行分支。 |
| LG41 | 共享大应用设置的适用性 | 门控或未验证 | `settings-page-b3a9b4fa84ae.js` @34799（共享 chunk，禁止当作已开放） | `apps/web/src/session-mode/components/settings/SettingsView.tsx:35` | 原包带 ChatGPT/家庭/账单/安全/云端 shared 代码，不能把路径枚举当 VSIX 本地可达功能。只有 host/feature gate/实际入口证明后才能进入本地缺口清单。 |
| LG42 | 云端任务/服务器内部逻辑 | 不适用 | `app-initial-fee819fe4f22.js` @977361（范围排除） | `apps/web/src/session-mode/components/settings/SettingsView.tsx:35` | 用户明确云端不考虑；仅保留客户端可观察错误/能力边界，不逆向模型云端内部，也不将云端调度/ChatGPT-only archive toast 列本地必须实现。 |

## 状态机关系与必须区分的身份

1. **导航/窗口状态**：关注 cards（共享 revision/journal）→ 每页 selected/focus/cwd → 可见正文/composer。closeTab 只改变关注与当前目标；任务 running/approval 不由关闭标签控制。选择 A→B 时，异步 owner form、听写、反馈必须继续使用捕获的 A，而不能读取返回时的 B。
2. **归档动作状态**：本地 capture→archive RPC→移出 thread/card→toast(60 秒)→显式 unarchive→恢复行索引。官方 s2n 则是 app undo 事务 perform/redo/undo，按 [hostId,threadId] 串行，并恢复原生 pin。两者不能用“可恢复”一词合并。
3. **本地全局撤销**：past→undo(pop/call/push future)→redo；当前回调是同步 void，本地 pin toggle 已登记，归档未登记。失败、切账号、切运行实例与多页历史没有官方事务等价证明。
4. **MCP 认证**：startup config/inventory 或 runtime challenge→required/prompt→OAuth(login pending, optionally thread/scopes)→success clears context/reload 或 error→可重试；dismissal 与 issued OAuth 生命周期不同。endpoint/account/runtime 切换撤销自有观察，不停止 native task。
5. **账号登录**：OwnedLogin(epoch, source, runtimeInstance, loginId)；idle→start→ready/pending→completed核对→authenticated；cancel sending→uncertain 不推断成功；运行实例改变废弃旧回执。
6. **反馈**：可见目标/账号/实例预检通过才 open；提交前重验；上传 uploading→uploaded/incomplete/disabled/failed/unconfirmed，关 UI 只把结果转通知；只有已确认可重试 failed 保留 submit。
7. **网页听写**：idle→starting(getUserMedia)→recording→processing→text/failure；capture cleanup 独立于转录 HTTP，owner key 卸载阻止迟到结果改另会话。本地无原生 retry retained-audio 分支。

## 场景矩阵（此分片范围）

| 场景 | 官方静态可确认 | 本地静态可确认 | 当前差异/证据边界 |
|---|---|---|---|
| 空闲 | local rename/archive/pin/unread/copy 动作存在 | 列表/菜单/owner form 分离；关闭标签不停止任务 | menu rename disabled；归档未入全局 undo |
| 运行中 | Stop and archive 文案/动作变体 | 本地 busy 仅指操作提交，未拦截 native running 或队列；标签可关闭 | native archive 生命周期未验，不能把文案当不停止保证 |
| 归档/重命名失败 | 原生 app action error/undo error 独立提示 | 列表与表单报错；toast undo 失败可再次点击 | 全局同步历史不能表达异步事务失败回滚 |
| 断线 | MCP rpcBroken 清理自有订阅 | MCP controller 停止，initialized 重建；反馈 preflight 失效 | 不代表任务被中断，真实迟到 auth/feedback RPC 未试 |
| 页面刷新 | 原生客户端状态恢复由宿主层决定 | tabs journal/本设备偏好保存；app undo/history 纯内存 | 本分片没有刷新后原生 composer/Task proof；不得把归档 undo 60秒当跨刷新持久保证 |
| 长历史 | thread/list/turn 列表是协议能力 | 归档设置只请求 50 条，nextCursor 未用 | 归档第 51 条不可达；Markdown/主历史分页交由主报告 |
| 多会话窗口 | hostId/threadId 分区的 archive transition key | 当前输入目标与 cards 分开；听写 key=owner | app history 无 host partition；真实并发 native UI/手机窗口未测 |
| 多设备 | 官方客户端协调通知存在 | shared cards revision/journal；local pin/attention 与原生域不同 | 同一集合不等于同一 selection/draft/原生 pins |
| 手机触摸/后台返回 | VSIX Webview 的 host 可达性受平台限制 | 长按菜单、设置 Select、文件树 overlay、mediaDevices 授权 | 触摸实现存在；后台音频/焦点/系统回收恢复仍未验 |
| 账号/实例变更 | 客户端 RPC/账号通知作用于 host | 登录 epoch、MCP identity、反馈 target guard | 不能以套餐/邮箱替代有效原生组织策略；本轮未登录 |

## 待用户 review 的开发候选（不构成实施许可）

A. 接通 ConversationMenu 重命名；统一列表/归档设置中文。
B. 设计归档/重命名/置顶共用的异步、按 host/thread 隔离应用撤销，明确跨刷新与跨页边界。
C. 决定是否保留现有不停止 Agent 的归档，或新增明确的“停止并归档”入口。
D. 归档列表使用原生游标分页；并发恢复需按请求代次和精确 thread 处理。
E. 快捷键保存/重置仅在已确认当前 host 能力后接入，无法保存时不能伪装录入完成。
F. 网页听写失败保留可控音频 retry 与取消状态；手机后台/权限拒绝/多个 composer 单麦克风归属列真实关卡。
G. Ultra permissionProfile 与 per-host fallback 需原生元数据和能力验证后补齐。

## 验证与限制

执行了只读源码/原包定位、生产调用点核对、当前 HEAD 与清洁工作区核对。没有运行产品测试（纯审计，无产品行为改动）；没有把已有测试通过、HTTP 200 或 iframe onLoad 记成实际 UI 验收。归档设置页 50 条与快捷键 placeholder 属本轮静态确认，shared chunk 的 host 可达性明确保留未验。

机器可读清单：同目录 `local-gap-audit.json`；构建器保存 needle 并计算原包 UTF-16 偏移，方便根报告复核。
