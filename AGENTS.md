# 仓库指南

## 构建、测试与开发命令

- `pnpm install --frozen-lockfile`；Node.js 要求 `^20.19.0 || >=22.12.0`。默认会话模式需要 Rust stable、C/C++ 编译工具和 CMake。
- `pnpm dev:prepare`：编译 shared 与默认 Rust 运行层；`SESSION_MODE_ENABLED=0` 跳过 Rust，显式 `SESSION_RUNTIME_BIN` 只校验已有可执行文件。`pnpm dev` 与 `pnpm dev:restart` 自动执行准备。
- `pnpm session:status`：检查会话服务和运行二进制；编译不替换已有 Rust 进程或停止 Agent，详细流程见 `docs/startup.md`。
- `pnpm dev:restart`：先检查两个端口的归属并完成编译，再按 `.env` 启动/恢复前后端；前端绑定 `0.0.0.0`。会话运行服务绑定 loopback，随后端热更新复用。
- `pnpm check`：共享包、后端和前端类型检查及生产构建；`pnpm session:check`：Rust 运行层检查。
- `pnpm test`：终端单测、迁移的会话 Vitest 单测及脚本测试；后端测试并发限制为 4，避免共享主机上的 tmux 测试争用。
- `pnpm session:test`、`pnpm session:clippy`：运行层测试与严格 lint，测试使用独立的应用/CLI 数据目录。
- `pnpm e2e`：浏览器测试；会话模式联调使用独立 `.env`、端口和 `SESSION_DATA_HOME`，详情见 `docs/session-mode-architecture.md`。


## 任务完成前的最低要求

## 编码风格与命名约定

## 前端约定

- 终端模式位于原有 `apps/web/src`；迁移会话模式位于 `apps/web/src/session-mode`，别名 `@session`。
- 两种模式保留各自挂载状态；迁移样式和 Portal 必须限定在 `.session-mode`，隐藏模式不得处理全局快捷键。
- 会话／终端模式切换共用 `apps/web/src/components/WorkbenchModeSwitch.tsx`；项目列表入口共用会话模式的 `ProjectNavigationButton`，样式、焦点与响应式约定见 `docs/workbench-ui-polish.md`。
- 会话模式的标签、网格、列表共用 `useAgentCenterStore.cards` 关注集合；切换和关闭通过 `useSessionTabActions` 同步输入目标与项目。关闭标签只移出关注集合，不得中断 Agent 或清理 worktree；交互与恢复规则见 `docs/session-tabs.md`。
- 公共输入区的文字和附件以 Agent/session 隔离并在本设备持久保存；异步发送、上传、回滚使用捕获的原会话与提交版本，不得在返回时修改另一个会话的草稿。会话名称与聊天预览独立，规则与验收见 `docs/session-drafts.md`。


## 后端约定

- Node 网关与运行服务管理位于 `apps/server/src`；独立 Rust 会话运行层位于 `packages/session-runtime`。
- 应用数据由 `SESSION_DATA_HOME` 隔离；原生 CLI 登录目录沿用，禁止静默导入用户 Codexia 数据。
- 不得因端口占用、过期 PID 或热更新而停止其他工作树/仓库的进程；运行服务重启不得重复创建仍存活的 Agent 服务。


## 测试约定

### 终端能力握手（TUI Capability Handshake）红绿灯测试

## 安全与配置要求

- 严禁提交主机凭证、SSH 密钥或任何机器相关敏感信息。
- 本地覆盖配置放在被 git 忽略的 `.env` 文件中。
- 后端执行命令前，必须校验主机、路径、启动参数等所有输入。
- tmux 和 shell 命令参数必须做清洗或严格约束，防止命令注入。
- 中断、重启、接管附着等破坏性操作，必须在 UI 上显式呈现，不得隐式触发。

### 环境变量与端口可配置性纪律

- `HOST`、`PORT`、`WEB_HOST`、`WEB_PORT`、`WEB_BACKEND_HOST`、`WEB_BACKEND_PORT`、`WEB_HTTPS`、`FILE_BROWSER_DEFAULT_LOCAL_PATH`、`VSCODE_WEB_*`、`GIT_AUTO_PULL_INTERVAL_MINUTES` 等“用户会选择/机器相关”的配置，**严禁硬编码到源码**。
- `.env` 必须保持被 `.gitignore` 忽略（规则：`.env` + `.env.*` + `!.env.example`）。提交前执行 `git check-ignore -v .env .env.example`，确认 `.env` 被忽略且 `.env.example` 可被提交。

### 自动 Git 更新纪律

- 自动更新只能使用当前分支已经配置的 upstream，不得从 HTTP 参数接受仓库路径、remote、branch、ref 或任意 Git 参数。
- 后台定时任务只能执行 fetch 和版本关系检查，严禁自动 pull、merge、rebase、stash、reset 或强制覆盖；必须先在前端提醒，再由用户显式确认拉取。
- 用户确认后的更新只允许 fast-forward；分支分叉、本地修改阻塞或 Git 失败必须保持工作区不变并通过前端显式提示，不得创建 merge commit。
- 用户确认的 pull 成功后自动复用热更新与会话恢复链路，不再要求第二次确认；未经这次确认，后台任务不得刷新浏览器。

## 文档维护要求

- 引入新的适配器、协议事件或编排状态规则时，要在 `docs/` 中记录架构决策。
- 如果项目结构、命令名称或核心工作流发生变化，必须同步更新本文件。

以下内容是当前仓库的执行级补充规则，与上面的仓库指南同时生效。

## 必须遵守

1. 前端地址必须局域网可见

- 前端开发服务必须绑定 `0.0.0.0`，禁止只绑定 `127.0.0.1` 或 `localhost`。
- 对外说明、联调、截图、测试记录中，优先使用局域网可访问地址，例如 `https://10.30.0.22:3100`。
- 如果同网段设备无法访问该地址，则视为联调准备未完成。

2. 变更范围必须受控

- 新功能代码必须写入本项目约定目录，例如 `apps/web`、`apps/server`、`packages/*`。

3. 安全与配置必须合规

- 严禁提交任何密钥、凭证、Token、SSH 私钥或机器相关敏感信息。
- 本地差异配置写入 `.env*`，并保持 git 忽略。
- 后端执行命令、路径和主机参数时，必须做输入校验与注入防护。

4. 提交前必须完成最小验证

- 至少运行与改动直接相关的检查；涉及跨端或共享类型时，必须同时验证前后端类型检查。
- 常用命令包括：`pnpm check`、`pnpm test`、`pnpm lint`、`pnpm format`。

5. 不得破坏现有工作区状态

- 不得回滚或覆盖与当前任务无关的改动。
- 未经明确指令，不得使用破坏性 git 命令，例如 `git reset --hard`。

6. 新功能必须同步功能清单与红绿灯测试

- 每次新增功能，必须同步更新 `docs/func_list.md`，确保功能清单与当前实现一致。
- 如果新增功能改变了产品概览、架构边界或使用方式，也必须同步更新 `docs/project-overview.md`。
- 每次新增功能，必须新增或更新对应的红绿灯测试，遵循先红后绿，并将其纳入该功能的最小验收范围。

7. 每次修复 bug 必须同步记录到 bug 清单

- `docs/debug_list.md` 是面对仓库读者的 bug 修复记录。
- `memories/repo/debug_list.md` 是仓库级 bug 记忆镜像。
- 每次解决一个 bug，都必须至少在 `docs/debug_list.md` 中追加一条简短记录；如适合沉淀为仓库记忆，也同步更新 `memories/repo/debug_list.md`，写明问题现象、根因或关键修复点，便于后续排查和防回归。

8. 涉及设计逻辑或功能行为的代码改动必须做红绿灯测试

- 任何影响设计逻辑、交互流程、协议语义、状态流转或功能行为的代码改动，都必须补充或更新对应测试。
- 没有现成测试时，默认先写一个能复现问题或需求的失败用例，再让实现转绿。
- 只有纯文档、纯注释、纯样式且不改变行为的改动，才可以不补红绿灯测试。

## 推荐执行习惯

- 在文档、注释和 PR 描述中明确写出“局域网访问地址 + 端口 + 协议（HTTP）”。
- 任何需要协作联调的前端改动，默认附上可复现的访问方式，包括示例地址、启动命令和验证步骤。

### 会话导航边界

- 会话模式的合并顶栏由 `SessionTopNavigation` 管理；`WorkbenchShell` 通过回调切换模式并保留两种模式的挂载状态。
- 关注状态汇总与窗口组选择必须复用现有关注集合，未知状态不得显示成确定的零；导航不得隐式审批、停止或启动 Agent。
- 四个功能页复用 `SessionSecondaryHeader`；页面跳转通过 `useLayoutStore.setView` 接入历史与离开保护。显式保存表单使用 `useSessionLeaveGuard`，返回行为与验收见 `docs/session-page-navigation.md`。

### Session VS Code 编辑工作区

- VS Code 在右侧工具标签内打开，入口与终端相邻；遵循 `docs/session-vscode-panel.md` 的项目跟随、固定和目录唯一规则。隐藏或关闭工具标签不得卸载已打开的 VS Code iframe；编辑工作区按项目真实目录去重，本地编辑服务的并发启动必须合并。

### Codex 子 Agent 边界

- 子 Agent 位于 `features/subagents`，独立观察集合不得自动加入关注标签或改变主输入/项目。打开原生历史只读，不 resume 或获取写入权。
- 普通输入只有原生明确 `canAcceptDirectInput === true` 才开放；审批按实际 thread/request/turn/item/实例标记回复，中断权限独立。批量停止须显式确认范围与轮次，默认本轮不包含旧轮或未知创建轮次。
- 协议、恢复规则和原生隔离验收脚本见 `docs/session-subagents.md`；两份原生测试版本的问题由主线程发起，不绕过限制。启用新 Rust 二进制仍遵守活跃 Agent 安全窗口。

### 会话内存防回归（用户已确认有效）

- 修改会话网关、SSE、历史同步、消息缓存/流式渲染或项目/标签 store 前，必须先读 [会话内存防回归约定](docs/session-memory-contract.md)。修复基线为 `7888474`，2026-10-10 用户已确认“内存控制住了”。
- 必须保留浏览器接收前的 `view=chat` 工具正文裁剪、事件驱动的历史恢复、相同快照不通知订阅者，以及有界流式正文和大字符串引用释放。不得恢复静默/空闲完整历史轮询，或用前端隐藏工具行替代网关裁剪。
- 内存优化不能丢失序号连续性、审批/提问、完成回复、未读状态和子 Agent 元数据；不得停止 Agent 或强制刷新页面掩盖增长。
- 按约定运行相关单测与原生 HTTP/EventSource 浏览器回归，记录传输量和内存测量边界；修改限制须提供等效或更好的实测证据，不能删除保护断言或单纯放宽阈值。纯文档修改只需核对路径、命令和记录一致性。
