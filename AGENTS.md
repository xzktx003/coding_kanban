# 仓库指南

## 构建、测试与开发命令

- Harness 页面包装位于独立 `packages/harness-kanban`，只连接已有 Kanban，不随 `pnpm dev` 新启实例。专项检查 `pnpm --filter harness-kanban run check`、`pnpm --filter harness-kanban test`；浏览器验收须显式提供已有 Harness／Kanban 地址和私有启动日志，命令与 TLS／DS Bot 边界见包 README 及 `docs/designs/deepseek-harness-kanban-plugin-implementation.md`。安装走官方 bundle 管理接口，切勿为插件热加载重启活跃 Harness／Agent。
- 用户约定本机 Harness Web 默认使用 **3080（HTTPS）**，不要因 Kanban 包装另换默认端口；临时 3443 已停用。证书、登录链接与启动参数保存在私有部署配置；端口／协议变更须在确认无运行轮次和后台任务的窗口执行，并同步维护检查与私有登录链接。

- 全新受控宿主可显式添加 `--refresh-workspace-dir`，要求可见窗格模式及 service/domain/control 三项齐全。它为各独立 profile 选择同一已存在、规范、当前用户拥有且非 world-writable 的工作目录，允许0775项目；不得与本 profile 私有运行/控制/连接或登录目录交叠。原 `--project-dir` 仍须私有新空目录；公共目录不创建、不清空、不改权限，启动前重查。标准网关读取真实运行记录，不再依赖诊断子类改写；不等于自动profile或最终刷新验收。见 `docs/designs/codex-mode-audit-20261014/refresh-shared-workspace-20261016.md`。

- 刷新验收须在精确 native turn 完成后额外核对官方 composer 清稿、正确唯一目标及 busy/Stop/Queue 结束，不能把 completed 当作页面空闲。`codex-refresh-fixture.mjs` 只接受一个共享诊断 profile 或三个精确独立 profile，禁止无条件取首项作为三宿主证据。独立宿主仍有并发页面等待反例，两秒未通过；只读有界断言、模拟参数及清理见 `docs/designs/codex-mode-audit-20261014/refresh-client-settlement-20261016.md`。

- 原生网关仅能由服务端为固定profile显式注册 `webSocketCompression: true`，默认关闭，不接受HTTP参数开关。浏览器链路使用无跨消息字典的受限窗口压缩；回环上游不重复压缩，客户端解压后8MiB、上游2MiB及队列预算保持。原Service Worker的304和SDK共享状态传输须分开观察，不能据合成200判断脚本完整重传。该实验不能代替资源/两秒验收或正式启用，见 `docs/designs/codex-mode-audit-20261014/refresh-websocket-transport-20261016.md`。

- code-server 创建 extensionHost 前会清除 NODE_OPTIONS。新宿主的自有父进程启动 shim 只对固定 bootstrap、唯一 extensionHost type、固定 ESM 入口及同一 companion 配置的 fork，在 execArgv 加入固定 preload；其他子进程透传，原参数不改。provider 观察仍只在 extensionHost，捕获后恢复，直接保留钩子计数须归零；恢复被阻挡不能伪报零。发送适配精确门控 26.51002.51308/26.51007.21434，未知版本不探测 provider，不能仅凭单测认定新原包兼容。见 `docs/designs/codex-mode-audit-20261014/refresh-preload-fork-20261016.md`。

- 原生宿主只保留明确的 `NODE_USE_ENV_PROXY=0/1`，不因代理地址存在就启用，不继承任意 `NODE_OPTIONS`；实际支持依赖 code-server 自带 Node 版本。官方 SDK 初始化不改 feature flag、网络请求或缓存策略，分段证据与代理红绿灯见 `docs/designs/codex-mode-audit-20261014/refresh-initialization-proxy-20261016.md`。

- `pnpm install --frozen-lockfile`；Node.js 要求 `^20.19.0 || >=22.12.0`。默认会话运行层使用 TypeScript/Node；PTY、SQLite 无预编译包时需要本机编译工具。语音在 Codex 已登录时使用其转写，否则使用外部 whisper.cpp CLI。
- 后端 `dev:app` 使用 `scripts/watch-server.mjs`：清单/锁文件变化先安装锁定依赖，再热更新网关；失败保留旧网关，保存源码/清单可重试。网关异常退出按 1/2/4 秒最多恢复三次；计划替换和关闭不触发重试，独立运行层仍复用。边界与回归见 `docs/startup.md`。
- 局域网开发页面通过 `scripts/vite-document-continuity.mjs` 保留断线前文档并重连 HMR；不兼容更新和服务代次变化只提示显式刷新，不自动整页重载或操作 Agent。仅 serve 生效；更新 Vite 时须验证其客户端结构契约，不能静默恢复自动刷新。手机尺寸／真实 HMR 回归与运行层启用边界见 `docs/session-interruption-safety.md`。
- `pnpm dev:prepare`：编译 shared 与默认 TypeScript 运行层；`SESSION_MODE_ENABLED=0` 跳过运行层，显式 `SESSION_RUNTIME_BIN` 只校验已有可执行文件。`pnpm dev` 与 `pnpm dev:restart` 自动执行准备。
- `pnpm session:status`：检查会话服务和运行产物；编译不替换已有运行进程或停止 Agent，详细流程见 `docs/startup.md`。
- `pnpm codex:status`：读取启动环境，只读核对 Codex 宿主、网关、私有 broker 及已部署 companion 内容；区分旧代码、不可达、等待浏览器激活和 broker 就绪，不启动、停止或发送任务，broker 就绪不代表模型对话已验证。见 `docs/codex-workbench-mode.md`。
- 命令详情网关使用运行包的独立只读库；后端 `build` 会编译该依赖，但不会替换活跃运行进程。关闭会话模式时不加载详情库；自定义运行服务没有默认库产物时保留网关和旧服务，通过既有只读接口明确返回支持状态。见 `docs/session-command-details.md`。
- `thread/turns/list?view=chat` 使用同包独立只读通道，原生只允许 initialize／initialized／thread/turns/list；每页保留原生游标，不 resume/acquire、不重试发送。工具正文在接收时丢弃，密集工具按投影字节有界留存；共享 RPC 的 32 MiB、聊天 16 MiB 和既有流式预算不得放宽。旧运行层继续复用，完整读取仍走原协议。故障恢复及最低验证见 `docs/session-codex-connection-recovery.md`。
- `pnpm dev:restart`：先检查两个端口的归属并完成编译，再按 `.env` 启动/恢复前后端；前端绑定 `0.0.0.0`。会话运行服务绑定 loopback，随后端热更新复用。
- `pnpm check`：共享包、TS 运行层、后端和前端类型检查及生产构建；`pnpm session:check`：TS 运行层检查。
- `pnpm test`：终端单测、迁移的会话 Vitest 单测及脚本测试；后端测试并发限制为 4，避免共享主机上的 tmux 测试争用。
- `pnpm session:test`、`pnpm session:clippy`：TS 运行层测试与类型检查（clippy 为兼容命令名），测试使用独立的应用/CLI 数据目录。
- 会话运行层 TS 实现位于 `packages/session-runtime/src`，新启动默认使用独立 Node 进程。`pnpm --filter @agent-orchestrator/session-runtime run audit` 核对原 208 个迁移契约方法/路径；新 Slack 预览 context/read 两个只读接口有独立行为验收，见 `docs/session-slack-preview.md`。注册通过不替代行为验收。已有 legacy 服务仍安全复用，禁止因新产物而隐式停止活跃 Agent，进度与验收见 `docs/session-typescript-migration.md`。
- `pnpm e2e`：浏览器测试；会话模式联调使用独立 `.env`、端口和 `SESSION_DATA_HOME`，详情见 `docs/session-mode-architecture.md`。
- 原生 Codex 实验宿主与只读适配器位于 `packages/native-codex-host`、`packages/native-codex-adapter`，不随 `pnpm dev` 启动。专项验收：`node --test packages/native-codex-host/test/*.test.mjs packages/native-codex-adapter/test/*.test.mjs`；启动参数与真实浏览器边界见各包 README 和 `docs/designs/session-render-alignment/native-prototype-acceptance.md`。不得连接默认 CLI IPC、未经用户明确授权复用登录数据或因实验部署重启正式 Agent；仅复用连接走私有 `--connection-profile-home`，明确授权共享账号和历史时可走 `--shared-codex-home`，两者互斥且 IPC 始终隔离。
- Codex 模式的常驻宿主可显式运行 `pnpm --filter @agent-orchestrator/native-codex-host service --config /absolute/private-service.json`；配置为 owned `0600`，由现有 launcher 每次分配全新私有目录，只有本次宿主健康后才原子发布固定网关记录。服务管理器负责重启；普通 `pnpm dev` 不自动启用，账号／历史复用仍要求明确授权。部署与验证见 `docs/codex-workbench-mode.md`。
- 刷新恢复的 `refresh-prototype` 为隔离组件，默认启动不启用；包含私有常驻进程、原生客户端/订阅适配器、事件管理器与默认 10 项 LRU。真实协议复验显式提供 `NATIVE_CODEX_REFRESH_CLI` 后运行 `test/refresh-native.test.mjs`、`test/refresh-lifecycle-native.test.mjs`、`test/refresh-service.test.mjs`（均在 `packages/native-codex-host` 下）；未提供时跳过，不能计为已验收。真实 11→10 回收与运行/审批保护不替代正式桥接、多端草稿、长测或两秒验收，完整启用仍未实现。进度与历史红灯见 `docs/designs/codex-mode-audit-20261014/refresh-recovery-progress-20261015.md` 和同目录 `refresh-recovery-stage0.md`。
- 刷新原型可在全新隔离宿主显式使用 `--refresh-service-config` / `--refresh-domain` 接入已验证私有服务；`--reconnection-grace-seconds` 仅控制该宿主断连宽限期（1–300 秒，默认 60）。profile 网关必须由服务端固定注册，`nativeClient=<UUID>` 不得接受端口/目录或回退到另一宿主；关注集合保持共享，布局、启动映射、iframe 缓存和旧实例身份按 profile 隔离。自动 profile 管理与正式启用仍未完成；独立管理进程和显式页面租约见下文，原型接入见 [原型启动契约](packages/native-codex-host/refresh-prototype/README.md#explicit-private-host-and-client-routing)。
- 默认 code-server profile 的浏览器全局存储按源共享，服务端目录/路径隔离不能证明原生草稿独立。`refresh-prototype/origin-listener.mjs` 仅为显式自有前端监听器原型，保留 HTTP/2、原始请求/升级 handler 和 WS 预算；持久源分配与资源准入未完成，不自动启用或复用不同客户端的源。保温管理器先通过只读原生账号/工作区核对建立初始绑定，之后账号变化使其失效，只关闭自身连接、不停止 native 任务；所有官方桥接的完整授权控制仍待实现。生成的 CLI 包装器每次启动及连接打开后均须重查固定服务域/代次/PID/start ticks，准入有界、可取消，旧身份不得回退到新实例。手机关卡按用户确认采用 iPhone 16 尺寸模拟，具体参数与边界见刷新计划。见原型 README 与持续进度。

- 隔离刷新管理器 `createRefreshManager` 要求显式 `resourceMonitor`：用自有进程创建时持有的 PID/start ticks 列齐 native、宿主、管理器及网关根；不得把同 UID 或 HTTP 提供的 PID 当成所有权。资源缺测、过期或超预算暂停新增空闲保温，不停止任务；自动全宿主注册、预算定标与最终恢复验收仍待完成，见 `packages/native-codex-host/refresh-prototype/README.md`。

- 官方待审批页可能没有 composer，只有原生明确 onboarding 才显示引导提示。`tests/e2e/codex-refresh-{approval,running,concurrent-send}-acceptance.mjs` 仅接受显式自有无登录 loopback 夹具及全新输出目录，不回退正式宿主；三端手势完成不等于协议写出或两秒通过。首次并发手机未提交的红灯、创建连接保留及实际计时边界见 `docs/designs/codex-mode-audit-20261014/refresh-official-lifecycle-20261016.md`。

- 受控 CLI 从配置附着时，每次启动仍完整校验固定 CLI/VSIX，比较完整 scope 后才访问记录中的 PID；同次调用不重复扫描，不提供跨启动缓存或公开验证跳过开关。账号/控制代次/实际写入 guard 保持，见 `docs/designs/codex-mode-audit-20261014/refresh-artifact-verification-20261016.md`。

- 显式 profile 可注册自有可见页面租约；网关必须核对实际实例及宿主记录中的完整 native domain/generation/PID/start ticks，缺失或变化不得登记到其他服务。浏览器仅上报可见 thread UUID，目录取自原生元数据；硬刷新保留短暂断连保护，新标签不能复用 opener 复制的租约。断连宽限不是保温池 TTL；默认入口不启用，自动 profile/源分配及最终验收仍未完成。协议与测试见 `docs/designs/codex-mode-audit-20261014/refresh-visibility-control.md`。
- `refresh-prototype/control-service.mjs` 可由本地所有者显式启动/附着独立持久管理进程；只接入已有且身份匹配的私有 native，不启动或重启 native。网关经独立私有 Unix 元数据通道注册页面，实际宿主核对仍通过反向 verify 执行；关闭网关不清空中央租约/保温池，控制进程退出只释放自身订阅。现有/过期目录记录不得自动覆盖恢复，PID 身份读取与完整 task/RSS 统计须保持各自契约。自动宿主资源注册与最终验收仍待完成，见 `docs/designs/codex-mode-audit-20261014/refresh-control-process.md`。
- 新私有刷新服务须在 ready 前建立原始 native 授权锚与独立账号观察进程；记录不可改绑，manager 重建也须确认原始锚。账号同值通知仍撤销，观察进程失联/缺失锚拒绝接入，不隐式补写、重建或停止 native。撤销写盘失败仍关闭自有授权通道；真正写入前同步核对锚，观察进程自动计入资源预算。协议、真实无登录 provider 验收及 ChatGPT/UI 未验边界见 `docs/designs/codex-mode-audit-20261014/refresh-native-authority.md`。
- 新隔离宿主可在已有 refresh service 参数上增加 `--refresh-control-root`，将每个生成 CLI 固定到控制与 native 双重运行身份，分别初始化只读账号观察连接并与 manager 摘要核对。初始账号通知仅允许一次，同值第二次也撤销；无关 turn 不改变账号版本。每条实际 JSONL 写入前的 guard 必须同步，未知回执不重发，显式 owner 关闭不停止 native。该参数未自动覆盖存量客户端；真实 ChatGPT/OAuth/官方 GUI、资源和两秒完整关卡仍待验收，见 `docs/designs/codex-mode-audit-20261014/refresh-bridge-authorization.md`。

## 任务完成前的最低要求

- 新显式刷新宿主的 settings 由 `buildHostSettings` 生成，关闭 VS Code 的旧编辑器自动还原，窗口目标仍走既有网页恢复和身份/焦点确认；普通及已存活宿主不因此改变。原生新聊天回归增加 `NATIVE_CODEX_REFRESH_VISIBLE_ONLY_EVIDENCE=1`，须核对每页当前实例的 tabGroups 只有正确显示目标，不能仅凭网页隐藏判定。`--auto-open-new-chats` 的首次打开语义不变，完整组合/性能仍需验收，见 `docs/designs/codex-mode-audit-20261014/refresh-editor-restore-20261016.md`。
- 新宿主可显式用 `--restore-visible-windows` 替代自动首开，要求 refresh service/domain/control 三项，并与自动新聊天及 fixture 启动互斥。伴随扩展不预开默认编辑器，由网页当前可见目标经精确实例与 UUID 请求；初始新聊天也请求打开。旧自动首开及其固定列 `/restore` 语义保持。缺少受控宿主记录不能回退为普通模式，未自动启用存量实例；协议、红绿灯和真实 UI 边界见 `docs/designs/codex-mode-audit-20261014/refresh-visible-startup-20261016.md`。

## 编码风格与命名约定

## 前端约定

- UI在开发的时候要保持美观。如果在开发中，你发现了一些不协调、不好看，就请顺手把它改的协调好看
- 终端模式位于原有 `apps/web/src`；迁移会话模式位于 `apps/web/src/session-mode`，别名 `@session`。
- 两种模式保留各自挂载状态；迁移样式和 Portal 必须限定在 `.session-mode`，隐藏模式不得处理全局快捷键。
- 会话／终端模式切换共用 `apps/web/src/components/WorkbenchModeSwitch.tsx`；项目列表入口共用会话模式的 `ProjectNavigationButton`，样式、焦点与响应式约定见 `docs/workbench-ui-polish.md`。
- 会话模式的标签、网格、列表共用 `useAgentCenterStore.cards` 关注集合；切换和关闭通过 `useSessionTabActions` 同步输入目标与项目。关闭标签只移出关注集合，不得中断 Agent 或清理 worktree；交互与恢复规则见 `docs/session-tabs.md`。
- 公共输入区的文字和附件以 Agent/session 隔离并在本设备持久保存；异步发送、上传、回滚使用捕获的原会话与提交版本，不得在返回时修改另一个会话的草稿。会话名称与聊天预览独立，规则与验收见 `docs/session-drafts.md`。
- 线程模型/权限偏好通过 `useThreadModelStore` 的实际意图及每thread IDB事务保存，禁止恢复整map回写；`nativePermissionMetadata` 始终只在内存。发送等待点击时的保存前缀，后续模型选择不能替换已捕获参数；显式冻结配置不得补入当前UI字段。账号/运行scope失效的只读结果不能记成历史同步成功，按原有有界队列恢复。全局排队/Enter/审查偏好与线程设置分开，规则及多页/HMR/Goal验收见 `docs/session-model-selection.md` 和 `docs/designs/session-render-alignment/thread-settings-persistence-20261027.md`。

## 后端约定

- Node 网关与运行服务管理位于 `apps/server/src`；独立 TS 会话运行层位于 `packages/session-runtime/src`。已替换的自有 Rust 源码与 Cargo 构建文件已移除；原生 Codex/Claude/ACP、PTY/SQLite/Whisper 属于外部依赖。
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
- 协议、恢复规则和原生隔离验收脚本见 `docs/session-subagents.md`；两份原生测试版本的问题由主线程发起，不绕过限制。启用新运行产物仍遵守活跃 Agent 安全窗口。
- 协作通信不得作为父子创建证据；身份与普通输入权限复用原生 metadata，同值新确认也须阻止迟到旧权限恢复。idle 后代释放仅按真实 initialize 精确版本门控，且只取消父订阅，已有子 Agent 仍由原运行实例控制；不得扩展为隐式整家族接管。兼容关卡：`python3 scripts/session-subagent-release-acceptance.py --codex /absolute/path/to/codex --output-dir /private/acceptance/output`，结果与边界见 `docs/designs/session-subagent-identity-release-acceptance-20261014.md`。

### 反馈入口与权限预检

- 反馈正常入口通过 `features/native-feedback/preflightWorkflow.tsx` 捕获可见输入宿主，并在打开与提交前调用只读 `/api/codex/feedback/preflight`。运行层从同一 native 连接读取精确会话 cwd、effective config、requirements 和必要账号权限，不得用公开配置投影、套餐或邮箱推导组织策略，也不得为预检 acquire/resume writer。观察只在工作流存续时保留元数据，撤销不停止已发送上传；旧运行服务缺端点时明确提示无法核实，不隐式重启 Agent。协议、原包证据和验收边界见 [反馈入口与预检](docs/designs/session-render-alignment/feedback-entry-preflight-20261016.md)。

### 会话内存防回归（用户已确认有效）

- 修改会话网关、SSE、历史同步、消息缓存/流式渲染或项目/标签 store 前，必须先读 [会话内存防回归约定](docs/session-memory-contract.md)。修复基线为 `7888474`，2026-10-10 用户已确认“内存控制住了”。
- 开发入口的 React 性能时间线留存保护须保留；验证会话内存时同时记录 JS 堆与 renderer RSS，不能只凭堆稳定判定标签页稳定。普通应用 measure/mark 与生产性能 API 不得被清空。
- 必须保留浏览器接收前的 `view=chat` 工具正文裁剪、事件驱动的历史恢复、相同快照不通知订阅者，以及有界流式正文和大字符串引用释放。不得恢复静默/空闲完整历史轮询，或用前端隐藏工具行替代网关裁剪。
- 内存优化不能丢失序号连续性、审批/提问、完成回复、未读状态和子 Agent 元数据；不得停止 Agent 或强制刷新页面掩盖增长。
- 关注集合与正文可见消费者必须分开：不可见正文在 60 秒宽限期后可回收，休眠中的事件/历史/设备缓存不得重新持有正文；重显只读恢复，后台任务状态与回执确认必须独立于正文挂载。修改该机制须运行 `session-idle-memory` 及恢复/审批回归。
- 完成提示音必须复用单个音频上下文，每声结束断开节点，空闲关闭；音频时钟挂起须有墙钟清理。不得改回每轮创建 AudioContext 或仅 stop 不 close；这类原生分配不计入 JS 堆。
- 按约定运行相关单测与原生 HTTP/EventSource 浏览器回归，记录传输量和内存测量边界；修改限制须提供等效或更好的实测证据，不能删除保护断言或单纯放宽阈值。纯文档修改只需核对路径、命令和记录一致性。

### 会话 Goal

- Goal 的入口、六种状态、附件、首轮与后续设置、完成标记遵循 [Goal 规则](docs/session-goals.md)。已有线程只设置目标，不额外发送普通 turn；新线程首轮接受后不能因 GoalSet 失败重发首轮或删除已引用附件。Portal 表单必须阻止 submit 向公共 composer 传播。
- 只读恢复不 acquire/resume。未知写入回执先核对小 Goal 元数据，未确认前禁止重发；同值通知也推进修订以挡住旧回执。完成自动清理只走已有 owner／generation／精确目标的条件通道，原生不支持跨客户端 CAS，不得把本地 guard 描述为原子保证。账号事件的取消和有效只读账号确认分别处理，不用对象引用推断授权。
- 官方原组件对照用 `scripts/codex-goal-reference-server.mjs`，必须绑定 `0.0.0.0`，实际 HTTP LAN URL 由启动输出取得；缺少 `CODEX_GOAL_REFERENCE_URL` 的跳过不计验收。原生协议在全新私有目录和 loopback provider 中单独验收，不读登录、不连接正式 IPC、不切换活跃运行层。证据与命令见 [本轮验收](docs/designs/session-render-alignment/goal-parity-acceptance-20261016.md)。

### 独立 Codex 模式

- 工作台现在包含会话、终端、Codex 三种模式，共用 `WorkbenchModeSwitch`，首次访问后保留各自挂载状态。原生插件适配开发集中在 `apps/web/src/codex-mode`，不得混入会话模式草稿/正文 store。
- 官方 VSIX 保持不修改；宿主与自有伴随扩展位于 `packages/native-codex-host`，同源网关位于 `apps/server/src/routes/native-codex.ts`。配置与阶段验收见 `docs/codex-workbench-mode.md`。
- surface 适配只能调整自有样式与观察，不得移动原生 iframe/父节点或替换 MessagePort；隐藏模式停止观察，保留 iframe。真实宿主验收使用隔离 HOME/fixture，不得停止正式 Agent。
- Codex 宿主显式 `--auto-open-new-chats` 打开两个独立原生新聊天，禁止与 fixture 参数混用。连接副本模式只复制用户授权的登录配置到全新私有 HOME，不导入历史；`--shared-codex-home` 仅在用户明确授权后创建私有链接视图，共用授权的登录配置和持久历史，同时隔离 IPC、app-server control、临时目录、日志和缓存，且不得接管默认 CLI socket。项目历史 Resume 必须使用精确 thread UUID 和受限列号；公共 composer 只能向会话 store 当前选中的单个 thread 提交，不得广播。原生新资源首发后的内部路由不等于编辑器 URI 更新，刷新验收须单独核对原生历史恢复。
- 项目历史 Resume 后，公共 composer 只有在 Session 当前 thread 与捕获的 native target 完全一致时，才经同源 gateway/companion 向官方插件当前 app-server 的精确 thread、项目和 editor 列发送；不得广播、回退到另一 Session writer 或覆盖 thread 原生设置。宿主只向自有 code-server 的 Node extensionHost 注入 `preload.cjs`，精确观察官方 custom editor provider 注册并在捕获后恢复钩子；官方 VSIX 保持不修改。伴随扩展桥接须按官方版本门控，发送前核对对应列中的原生 custom editor、thread cwd 和空闲状态；Session 队列存在 queued/sending/uncertain 条目、原生会话忙碌或回执未知时保留草稿并拒绝重复投递，空暂停队列不阻止原生发送。回执持久化不得保存正文。协议、验证与未完成的 queue/steer/replace 边界见 `docs/codex-workbench-mode.md`。
