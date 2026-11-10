# 宿主门控功能逐项评估（G01 / G20 / CMP-36..39 / CMP-51）

> 任务：t4 host-capability。对照当前宿主/账号/授权边界，逐项评估 G01（IDE 自动上下文）、
> G20（local/worktree 新聊天）、CMP-36..39（worktree toggle / branch / local env）、
> CMP-51（实时语音）的可行性、所需宿主能力与实现路径。
> 规则：**不冒充已实现、不隐式动用账号能力**；宿主能力不具备或需要新授权的，明确记录为阻塞。
> 日期：2026-11-07。基准：官方 `26.51021.22027`（t1 解压钉定）。
> 证据分层沿用 matrix.md §0（P-S/P-C/O-S/O-C/O-N/O-F），详见
> [current-gap-inventory-20261107.md](current-gap-inventory-20261107.md) §0。

---

## 1. 当前宿主 / 账号 / 授权边界（客观事实，t4 复核）

以下为只读核对（`packages/native-codex-host/README.md`、`launcher.mjs`、`companion/*`、
`apps/server/src/routes/native-codex.ts`、`.ckx/record.json`、官方 `bin/linux-x86_64/codex-package.json`）。

| 维度 | 当前值 | 说明 |
|---|---|---|
| 宿主类型 | 隔离 code-server 原型（`packages/native-codex-host`），`service.mjs` 托管 | 独立 user-data/extensions/project/process/Cli home，官方 VSIX **不补丁**，`panelMode: new-chats` |
| 官方版本 | `26.51021.22027`（`extension/package.json` 与 `extension.vsixmanifest` 一致，t1 核验） | 官方资产均未修改；只以 `codex-goal-reference-server.mjs` 只读 serve |
| 账号复用 | `record.json`：`sharedCodexHome: /data01/home/xing.hu/.codex`，`connectionProfile: {enabled:true, storage:"linked", ipcIsolated:true}` | **显式授权**后的共享账号+历史；与 `--connection-profile-home`（仅连接副本，无历史）互斥。**默认不导入**，无授权时新宿主为隔离登出态（README:34-36,61-63,96） |
| 站点认证 | `record.json`：`authentication: "none"` | 该部署按用户“无口令”指示使用 `--unsafe-no-auth`（README:34）；与 Codex **账号**分开，不构成账号授权 |
| 原生 CLI 版本 | 扩展自带 `bin/linux-x86_64/codex` 的 `codex-package.json` = **`codex-cli 0.164.0-alpha.11.1`** | 宿主启动的 app-server 用扩展自带 CLI；`sharedCodexHome` 只共享账号/历史与目录，**不改变执行的二进制** |
| 实时语音 WebRTC 版本门 | `nativeRealtimeWebRtcSupported` 仅允许 **`0.163.0` / `0.165.0`**（`packages/session-runtime/src/codex/native-version.ts:10-14`） | 每个版本需实际私有 offer/SDP/text/stop + 浏览器证据；其余版本返回 false → 拒绝 realtime |
| 宿主桥接暴露的接口 | 仅 `POST /open`、`POST /restore`、`POST /release`、`GET /status` + `appserver-send` 发送桥（`companion/extension.cjs`、`companion/appserver-send.cjs`、`apps/server/src/routes/native-codex.ts`） | 以上三处 grep `ide-context/ideContext/worktree/branch/local-env/environment/voice/realtime` **均无命中** → 宿主桥**不具备** IDE 上下文、worktree、local env、branch、realtime 的任意 host API |

**授权边界结论**：当前宿主是"官方扩展在隔离 code-server 中运行 + 仅授权账号复用 + 只读/受限桥接"。
除发送/打开/恢复/关闭之外，任何需要新增 host API 的功能（IDE 上下文、worktree 探测、local env、branch、
realtime）都超出当前桥接能力；账号侧仅 `--shared-codex-home` 显式授权存在，且 realtime 还受 CLI 版本门控。

---

## 2. 逐项评估

### 2.1 G01 —— IDE 自动上下文

| 维度 | 结论 |
|---|---|
| 官方行为 | `ide-context` 命令 ID，仅 `ideContextStatus==='connected'` 时 enabled；选中时 `setIsAutoContextOn(!current)`，不清空输入；webview 通过宿主桥 `te({workspaceRoot})` 拉取 IDE 上下文（`composer-utils`/`composer-content`，v26.51021.22027）。`ide-context` 是 footer inline 控件，`i!=='cloud'` 且某条件启用 |
| 当前项目 | `/ide` 斜杠命令**已移除**；`slashCommands.init.test.ts:35-37` 断言 registry 中无 `ide`/`ide-context`。源码中无任何 `ide-context`/`ideContextStatus`/`isAutoContextOn` 处理（Composer.tsx 无对应控件） |
| 宿主能力 | **缺失**。companion / appserver-send / native-codex.route 均无 IDE 上下文 host API；无任何来源报告 `ideContextStatus` |
| 授权 | IDE 上下文读取的是用户**活动编辑器/选区/工作区诊断**，属工作区范围，**不需要新的账号授权**；但需要宿主桥从 code-server 读取活动编辑器状态 |
| 结论 | **阻塞（宿主能力不具备）**。要实现的路径是：① 在 companion 扩展观察 `vscode.window.activeTextEditor`/selection/diagnostics，暴露只读 HTTP/WS 端点；② React 复用该端点报告 `ideContextStatus`（connected）并拉取上下文；③ 仅在 connected 时启用控件。当前均未建，属于新宿主桥开发，超出"像素对齐/验收"范围；且官方是否在当前 VSCode 启用该 flag 亦未证实 |
| 证据层 | P-C 仅剩"无该命令"断言；实现 / 未实现 = P-S；真实官方宿主行为 = O-F U |

### 2.2 G20 / CMP-36 —— local / worktree 新聊天（run-location 切换）

| 维度 | 结论 |
|---|---|
| 官方行为 | 主 composer 的 `composerMode local/worktree` run-location 选择器；`U:Uu` 依据既有会话/跟随/工作树、busy 与 handoff 决定能否改 run location；`U:Qd allowWorktree = !followUp && !response`；`composer.toggleWorktreeMode`、slash id `worktree` 受工作区/可用性/feature flag 门控 |
| 当前项目 | ① 有 `forkSlashLocal`（slashCommands.ts:275）与 `forkSlashWorktree`（:312）：读 thread cwd → `gitCreateWorktree` → 可选 `runLocalEnvironment` → `codexService.threadFork({cwd: worktreePath})`，含 execution tracking。**但这是"已有会话 fork + 建 worktree"，语义不同于官方"新聊天选 local/worktree 运行位置"**。② 主 Codex composer（`components/codex/composer/Composer.tsx`）**未渲染** run-location 选择器；`WorkspaceSwitcher`/`BranchSwitcher` 只在 `AgentComposer`（无 agent card 时的公共输入包外壳）使用，不在 Codex composer 工具栏 |
| 宿主能力 | 官方 webview 需宿主提供 `isWorktreeAvailable`、`executionTargetOverride`、`remoteSelectionState`、`threadHandoff`、`worktreePromptContext` 等。当前 companion **不提供**。但项目**自己的** git 运行时已具备 worktree 探测/列出/创建（`packages/session-runtime/src/git/index.ts` 的 `worktree list/inspect/create`，`automation/worktree.ts`） |
| 授权 | worktree 创建在用户项目内（workspace-scope），项目已用于 fork；**不需要新的账号授权**（仅需用户对该目录的已有写权限，与现 fork 一致） |
| 结论 | **部分可行 / 条件差异**。数据可用项目 git 运行时补齐（不依赖 companion）；但官方 UI 语义（新聊天模式切换、followUp/response 互斥、busy/handoff 判定）需按官方逻辑重做，且需先确认官方在固定宿主下该 flag 是否启用（CMP-37 同类）。若仅为像素对齐，需先证宿主 flag |
| 实现路径 | 若确定要做：a) 用 `gitInspectWorktree`/worktree inventory 提供 `isWorktreeAvailable` 与 worktree 清单；b) 在 Codex composer 增加 run-location/local/worktree 模式切换控件，复用 `gitCreateWorktree` + `threadFork`；c) `allowWorktree = !followUp && !response` 门控；d) 用官方 `composer-utility-bar` 像素做 diff。属"可使用现有运行时、需新 UI + 官方 flag 确认" |

### 2.3 CMP-37 —— worktree toggle / 命令

| 维度 | 结论 |
|---|---|
| 官方行为 | `U:qd`（`composer-utility-bar`）注册 `composer.toggleWorktreeMode`，`requiresEmptyComposer=false`，受工作区/可用性/feature flag 门控；slash id `worktree` |
| 当前项目 | slash registry 无 `worktree` 模式 toggle（仅有 `forkSlashWorktree`，另一功能）；Composer.tsx 无 `composer.toggleWorktreeMode` 对应处理 |
| 宿主能力 | 无对应 host API；项目侧 worktree 运行时存在但未接入 composer toggle |
| 授权 | worktree 创建属 workspace 范围，无需新账号授权 |
| 结论 | **条件差异（先证宿主 flag）**。官方该控件本身可能被 feature flag 隐藏；需在固定宿主确认是否 VSCode 必备，再决定是否开发。若确认要做，可复用现有 worktree 运行时，路径同 §2.2 |

### 2.4 CMP-38 —— 本地 environment dropdown

| 维度 | 结论 |
|---|---|
| 官方行为 | `U:Qd` 仅 `!followUp && eligible && workspaceKnown` 渲染，disabled/loading/error/reset；打开精确 `configPath/workspaceRoot`；无环境时转 `/settings/local-environments` |
| 当前项目 | `forkSlashWorktree` 可选执行 `runLocalEnvironment(cwd, {cwd, id: environmentId, version: environmentVersion, confirmed:true})`（slashCommands.ts:331-336），并校验 `setup.status==='completed'`。**说明项目已有"local environment 设置命令"能力**；但主 composer 无等价 dropdown，也无 `/settings/local-environments` 页面，无 `workspaceKnown`/`followUp` 等门控状态 |
| 宿主能力 | 无 host API；项目以 `executionSelection.environmentId/baseBranch` 携带环境，来源为项目自有的环境/workspace 管理 |
| 授权 | local env 设置命令在用户项目/环境内执行，项目已用于 fork（`confirmed:true` 需要用户显式确认），**不需要新账号授权**；但需确认"桌面 workspace 管理 flag 在 VSCode 启用" |
| 结论 | **条件差异 / 部分可行**。设置能力已有；dropdown UI、`workspaceKnown` 门控、`/settings/local-environments` 跳转为缺口。是否开发取决于官方 flag 是否启用，及其是否属于本批次像素对齐目标 |

### 2.5 CMP-39 —— 分支 dropdown

| 维度 | 结论 |
|---|---|
| 官方行为 | `U:Qd` 分支选择器，条件 `cn && !follower && !outsideEditor`；按 `hostId:cwd` 键控；`existingWorkspace` 时 readOnly |
| 当前项目 | `BranchSwitcher`（`features/branch/`）用 `gitBranchInfo/gitListBranches/gitCheckoutBranch/gitCommit/gitStatus`，在 `AgentComposer` 的 `WorkspaceSwitcher` 内使用；项目 git 运行时亦有 branch 能力（`runtime git/index.ts`、API `gitBranchList`）。**但不在 Codex composer**，且无官方 `hostId:cwd`/`follower`/`outsideEditor`/`existingWorkspace readOnly` 门控语义 |
| 宿主能力 | 无 host API；项目侧 git branch 运行时已具备，可投射分支数据 |
| 授权 | 分支读取/切换在用户 git 仓库内（workspace scope），无需新账号授权 |
| 结论 | **部分可行 / 条件差异**。分支数据可复用项目 git 运行时；官方门控语义（follower/outsideEditor/hostId:cwd/readOnly）需按官方逻辑实现或确认是否需要（matrix 评审决定：`composer.md:107` "是否需要UI迁入由review决定，不能把所有Git能力说成缺失"） |

### 2.6 CMP-51 —— Realtime voice（实时双向语音）

| 维度 | 结论 |
|---|---|
| 官方行为 | `F:ewa` 用 `visiblePhase` 选择 send/end/start 主动作；`remote project unsupported` 禁用；mic/speaker 控制另行；**feature/auth/host 门控**（composer.md:119,128） |
| 当前项目 | `RealtimeVoiceButton`（`features/realtime-voice/`）+ 运行层 `ThreadRealtime`（`packages/session-runtime/src/codex/realtime.ts`，`/api/codex/realtime/{preflight,start,stop,append-text}`，走官方 app-server `thread/realtime/*` + `/v1/realtime/calls` WebRTC）。**项目已实现一套实时语音**（含 preflight 目标校验、scope/account 变化撤销、回执 unknown/abandon 防重发、mic/speaker 静音、原 owner 隔离）。但**未匹配官方 `visiblePhase` 主动作优先级**，且被 `visiblePhase`-样式主动作与其他控件联动（CMP-12/48 同类） |
| 宿主能力 | 需要：① 真实登录的 Codex 账号；② app-server 实时会话支持；③ 特定 CLI 版本；④ 官方 feature/auth/host flag。**WebRTC 版本门**：`nativeRealtimeWebRtcSupported` 仅 {`0.163.0`,`0.165.0`}；当前宿主扩展自带 CLI = **`0.164.0-alpha.11.1`** → **不在验证集** → 运行层 `realtime.ts` 会拒绝/不开启 WebRTC。本地也存在 `0.165.0`/`0.166.0` 的 app-server-daemon 版本，但**当前连接的 app-server 版本未被证明为验证集**，且 0.166.0 不在集内 |
| 授权 | **需要真实账号授权 + app-server 实时能力**。当前宿主 `--shared-codex-home` 显式授权了账号复用，但① realtime 是"账号 + 宿主 feature + CLI 版本"三重门；② 官方明确 "remote project unsupported 禁用"，当前 run location 若为 remote 则禁用 |
| 结论 | **阻塞 / 门控（版本 + 授权 + feature flag）**。当前 WebRTC 版本门对扩展自带 CLI（0.164.0-alpha.11.1）返回 false → 运行层不提供 realtime；需先连到验证集版本（0.163.0/0.165.0）并取得真实账号/app-server realtime 证据 + 官方 flag，才谈得上"上推 O-F"。项目现有 `RealtimeVoiceButton` 是一套**项目侧实时语音**，不等于官方 webview 的 `visiblePhase` 主动作/UI，不能冒充官方 CMP-51 parity |

---

## 3. 可行性汇总

| 项 | 官方门控 | 宿主能力提供 | 账号授权 | 数据可由项目运行时提供 | 结论 |
|---|---|---|---|---|---|
| G01 IDE 自动上下文 | connected flag | 缺失 | 不需要（workspace 范围） | 无 | **阻塞**（宿主桥缺失；/ide 已移除） |
| G20 / CMP-36 local/worktree 新聊天 | 工作区/flag | 缺失 | 不需要 | **可**（git 运行时 worktree） | **条件差异**（可复用运行时 + 需官方 flag 确认 + 新 UI） |
| CMP-37 worktree toggle | feature flag（可能隐藏） | 缺失 | 不需要 | **可** | **条件差异**（先证宿主 flag） |
| CMP-38 local env dropdown | `!followUp&&eligible&&workspaceKnown` + 桌面 flag | 缺失 | 不需要（设置命令需用户确认） | **部分可**（`runLocalEnvironment` 已有） | **条件差异 / 部分可行** |
| CMP-39 branch dropdown | `!follower&&!outsideEditor` | 缺失 | 不需要 | **可**（git branch 运行时） | **条件差异**（评审决定是否迁入） |
| CMP-51 Realtime voice | feature/auth/host + `remote unsupported` | 缺失（无 host API）；需 app-server realtime | **需要真实账号** | 项目有整套实时语音 | **阻塞**（版本门 0.164.0-alpha.11.1 不在 {0.163.0,0.165.0}；+ 账号/feature/remote 门控） |

**不冒充已实现**：除 CMP-51 项目已有一套**项目侧**实时语音与 G20/CMP-38 已有 fork/工作树/环境设置能力外，
其余均未被证明与官方 webview 等价，也不因"有近似组件"就升格为 parity；
G01 与官方 `composer.toggleWorktreeMode`/run-location/local-env/branch/realtime **主动作**均未在 Codex composer 中实现。

**不隐式动用账号能力**：账号复用仅经 `--shared-codex-home` 显式授权；realtime 需真实账号 + 版本 + feature 三重门；
site auth `authentication:none` 不代表账号授权；本评估未读取任何登录/令牌内容。

---

## 4. 建议与下一步（供 captain/review）

1. **G01、CMP-51 记为阻塞**，需新宿主桥（IDE 上下文 / app-server realtime 版本）能力或真实授权账号；
   CMP-51 具体阻塞点是 `nativeRealtimeWebRtcSupported` 验证集未含当前 CLI（0.164.0-alpha.11.1），
   需换 0.163.0/0.165.0 或扩展验证集（但注释要求"实际私有 offer/SDP/text/stop + 浏览器证据"）。
2. **G20/CMP-36..39 为条件差异**：数据面可用项目 git/worktree/branch/local-env 运行时补齐，
   但官方 UI 语义 + 宿主 feature flag 未证实。**先证官方 flag 是否在固定宿主启用**，再决定是否开发，
   不要为"像素对齐"把项目特色的 WorkspaceSwitcher/BranchSwitcher/fork 全量替换成官方不可达控件。
3. 若 t3 做官方 webview 像素 diff，应把上述未实现控件作为"宿主门控/条件差异"排除在"必对齐"之外，
   或在固定宿主显式开启相应 flag 后纳入。
4. 验证/验收留待 t3（像素 + 真实登录 Playwright 双轨）；本评估输出为 t4 结论，供后续任务消费。

---

## 5. 已知限制

- 对照对象为当前工作区 working tree；官方宿主行为（O-F）仍需 t3 双轨验收，本文件不能证明。
- 未读取任何登录/令牌内容；`sharedCodexHome` 的账号登录态未在此核实。
- 官方 feature flag 是否在固定宿主启用未证实（CMP-37/38/39/51 均依赖）。
