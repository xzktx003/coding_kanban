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
- `pnpm dev:restart`：先检查两个端口的归属并完成编译，再按 `.env` 启动/恢复前后端；前端绑定 `0.0.0.0`。会话运行服务绑定 loopback，随后端热更新复用。运行层替换只向已核实的看板 runtime PID 发信号，不向进程组或共享官方 daemon 发信号。新启动默认连接官方 daemon；允许按配置调用官方 daemon start，不创建私有 app-server，不自动停止/重启/升级共享服务。旧私有运行层仍受活跃任务和未知状态保护，详见 `docs/startup.md`。
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
- Claude/ACP 最近页使用现有历史入口的 `?view=recent`，响应最多2MiB/256行，保留真实向前游标与源身份；`metadataOnly` 不读正文。ACP按本地SQLite源更新增量投影完整chunk/tool基线，不能盲截原始delta；大预览必须标记截断并保留按需只读详情。原raw接口保持兼容，恢复不得connect/load/resume Agent，见 `docs/designs/session-mode-implementation-20261029/auxiliary-history.md`。
- 已运行旧服务的Claude/ACP历史由独立 `@agent-orchestrator/session-runtime/auxiliary-history` 只读库兼容。网关须先核实固定数据目录、原进程/端口/代次及原生文件环境，读取前后复核；ACP源只读，派生缓存独立且创建前拒绝源交叠，CC别名不猜测。来源不明501、身份无法核实409，不回退raw或自动重启服务。仅显式raw消费者沿用原接口，见 `docs/designs/session-mode-implementation-20261029/auxiliary-history-compatibility.md`。
- Claude 刷新恢复只读 `session-snapshot`，`activeSessionIds` 不能代替后端 owner；明确发送先核对原运行实例/目录，只有 404 才按手势捕获配置恢复。canonical/native 别名同时约束历史、事件和活动保护；新建 UUID 使用 SDK sessionId，旧映射只存小身份元数据。巨型待审批参数按 runtime/session/request/execution/revision 精确分片读取，每片 JSON ≤64KiB、源单项8MiB/合计16MiB；超预算保留拒绝入口，不以预览代替完整审批。见 `docs/designs/session-mode-implementation-20261029/claude-live-recovery.md`。
- 不得因端口占用、过期 PID 或热更新而停止其他工作树/仓库的进程；运行服务重启不得重复创建仍存活的 Agent 服务。
- 运行层`/health.ownedAgents`仅暴露Claude/ACP连接、活动、待请求与未知状态计数，不留正文。自动过期替换遇自有连接或计数缺失须延后；显式`--restart-runtime`可按已授权维护结束精确归属的自有任务，活动未知须准确说明。相同cwd/entrypoint的其他进程只能列为只读候选，不能据此自动清理独立`SESSION_DATA_HOME`。

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
- 关注集合与正文可见消费者必须分开：按末节当前批准策略，默认在既有预算内保温，可见优先、压力或超预算回收；显式false保留约60秒离屏释放。休眠中的事件/历史/设备缓存不得直接重填正文，再热须有原预算、冷却与精确只读reader准入；后台任务状态与回执确认独立于正文挂载。修改该机制须运行 `session-idle-memory` 及恢复/审批回归。
- 完成提示音必须复用单个音频上下文，每声结束断开节点，空闲关闭；音频时钟挂起须有墙钟清理。不得改回每轮创建 AudioContext 或仅 stop 不 close；这类原生分配不计入 JS 堆。
- 按约定运行相关单测与原生 HTTP/EventSource 浏览器回归，记录传输量和内存测量边界；修改限制须提供等效或更好的实测证据，不能删除保护断言或单纯放宽阈值。纯文档修改只需核对路径、命令和记录一致性。

### 会话 Goal

- Goal 的入口、六种状态、附件、首轮与后续设置、完成标记遵循 [Goal 规则](docs/session-goals.md)。已有线程只设置目标，不额外发送普通 turn；新线程首轮接受后不能因 GoalSet 失败重发首轮或删除已引用附件。Portal 表单必须阻止 submit 向公共 composer 传播。
- 只读恢复不 acquire/resume。未知写入回执先核对小 Goal 元数据，未确认前禁止重发；同值通知也推进修订以挡住旧回执。完成自动清理只走已有 owner／generation／精确目标的条件通道，原生不支持跨客户端 CAS，不得把本地 guard 描述为原子保证。账号事件的取消和有效只读账号确认分别处理，不用对象引用推断授权。
- 官方原组件对照用 `scripts/codex-goal-reference-server.mjs`，必须绑定 `0.0.0.0`，实际 HTTP LAN URL 由启动输出取得；缺少 `CODEX_GOAL_REFERENCE_URL` 的跳过不计验收。原生协议在全新私有目录和 loopback provider 中单独验收，不读登录、不连接正式 IPC、不切换活跃运行层。证据与命令见 [本轮验收](docs/designs/session-render-alignment/goal-parity-acceptance-20261016.md)。

### 独立 Codex 模式

- 工作台实现包含会话、终端、Codex、ChatGPT 四种模式，共用 `WorkbenchModeSwitch`；自 2026-11-09 起切换栏只显示前三种，ChatGPT 入口按用户要求隐藏。ChatGPT 代码和 `mode=chatgpt` 深链保留以便接续；在用户恢复开发前，不继续其功能实现或重启/清理相关服务。暂停进度见下节。
- 官方 VSIX 保持不修改；宿主与自有伴随扩展位于 `packages/native-codex-host`，同源网关位于 `apps/server/src/routes/native-codex.ts`。配置与阶段验收见 `docs/codex-workbench-mode.md`。
- surface 适配只能调整自有样式与观察，不得移动原生 iframe/父节点或替换 MessagePort；隐藏模式停止观察，保留 iframe。真实宿主验收使用隔离 HOME/fixture，不得停止正式 Agent。
- Codex 宿主显式 `--auto-open-new-chats` 打开两个独立原生新聊天，禁止与 fixture 参数混用。连接副本模式只复制用户授权的登录配置到全新私有 HOME，不导入历史；`--shared-codex-home` 仅在用户明确授权后创建私有链接视图，共用授权的登录配置和持久历史，同时隔离 IPC、app-server control、临时目录、日志和缓存，且不得接管默认 CLI socket。项目历史 Resume 必须使用精确 thread UUID 和受限列号；公共 composer 只能向会话 store 当前选中的单个 thread 提交，不得广播。原生新资源首发后的内部路由不等于编辑器 URI 更新，刷新验收须单独核对原生历史恢复。
- 项目历史 Resume 后，公共 composer 只有在 Session 当前 thread 与捕获的 native target 完全一致时，才经同源 gateway/companion 向官方插件当前 app-server 的精确 thread、项目和 editor 列发送；不得广播、回退到另一 Session writer 或覆盖 thread 原生设置。宿主只向自有 code-server 的 Node extensionHost 注入 `preload.cjs`，精确观察官方 custom editor provider 注册并在捕获后恢复钩子；官方 VSIX 保持不修改。伴随扩展桥接须按官方版本门控，发送前核对对应列中的原生 custom editor、thread cwd 和空闲状态；Session 队列存在 queued/sending/uncertain 条目、原生会话忙碌或回执未知时保留草稿并拒绝重复投递，空暂停队列不阻止原生发送。回执持久化不得保存正文。协议、验证与未完成的 queue/steer/replace 边界见 `docs/codex-workbench-mode.md`。


### 第四 ChatGPT 桌面模式（已暂停）

- 用户此前授权方案完成后自主开发并验收；2026-11-09 最新指令为暂停开发并隐藏入口。暂停前目标仍是优先复用指定 Mac 原资源，首期为完整 Codex 工作区；前端位于 `apps/web/src/chatgpt-mode`，宿主/协议位于 `packages/chatgpt-desktop-host`，状态与资源路由独立于原 Codex 模式。默认启动不创建原生宿主、不接管或发送现有任务。当前边界和恢复步骤见 `docs/designs/chatgpt-desktop-mode-20261103/paused-progress-20261109.md`。
- 新模式项目、草稿和布局独立；真实 CLI 线程和任务共享必须通过执行域、配置和账号验证。仅初始化页面或取得 services 不代表任务、分屏/公共输入、SSH/云已验收；研究 CDP 代理不得作为正式 LAN 调用接口。
- 用户 2026-11-04 明确批准点击已有会话后按桌面原版连接：精确线程的最小 resume 须有一次性明确点击/键盘激活意图，与发送/审批权限分开，不夹带配置覆盖。模式切换、刷新、后台恢复不得自动连接、发送或重启任务。连接会更新原生客户端/MCP 策略，不能描述成纯只读；本地输入 scope token 也不能替代 native 授权。
- 共享连接仅发送 `{threadId,excludeTurns:true}`，须核验原生分页/tail hydration、空 turns 和两个必有 nullable cursor，缺失或未知不重发。原 sidebar 手势到请求的因果绑定和正式 daemon 工具配置仍未接通，不能据私有双客户端通过自动启用。
- 服务端可显式提供 WeakSet 标记的 `sharedDesktopSource` 工厂，旧 raw `sharedThread` 容器入口继续拒绝。原 SDK connected 不等于共享 host ready；原连接、execution host 与 manager 注册须齐全。浏览器共享目录两个模块须同时维护 host exports 和路由 SOURCES 白名单，完整冻结资源同版；真实匿名 SDK 已初始化，实际 requiresOpenaiAuth=true 时原 manager 按规则 unavailable，不放宽 ready；尚未启用 8484，见 `docs/designs/chatgpt-desktop-mode-20261103/shared-sdk-progress-20261107.md`。
- 共享 source 可显式选择 version 2 App Tools 回桥，保留原 eTw/ex5/handlers，经 owner IPC 接宿主 loopback 代理；工具 thread guard 必须穿过异步实例核验直到真正写前。最小 resume 不增加 MCP override，正式 daemon 的工具配置/执行域等价仍须独立证明，见 `docs/designs/chatgpt-desktop-mode-20261103/shared-sdk-mcp-checkpoint-20261107.md`。
- 共享 source 可显式选 `executionDomainPolicy: 'preserve-native-cli'`、`nativeAppTools:false`，固定 CLI 0.166.0，通过原生配置/requirements 双读与文件闭包核验保留原权威；不接受外部布尔证明或 App Tools 注入，最小 resume 只在明确手势后消费一次。实际默认 daemon 本线程分页只读已通过；空线程 rollout 反例不代表全部分页失效，真实账号 SDK 初始化与共享发送仍待验收。见 `docs/designs/chatgpt-desktop-mode-20261103/shared-native-cli-preservation-20261107.md`。
- 共享已绑定会话的只读 follower 与执行 proof 分开：config 变更不能丢最终/完成/审批提示；读取仍核原八字段、daemon/账号/view/held 根，write/审批回复/工具准入继续强 proof。read/write map 共享原 8192 entry 上限，账号/view/根失效全撤，不自动绑定/重核验/发送；见 `docs/designs/chatgpt-desktop-mode-20261103/shared-follow-read-binding-20261107.md`。
- `preserve-native-cli` 配置过期只撤销执行证明，读取仍须原 daemon/账号/容器/held 根身份；仅原 native 明确 bind/新建 scope 可双读全部固定项目和文件闭包重核验。版本/一次性 clientId 与创建 ticket 阻止旧意图和迟到回执借新证明复活，失败保持不可写，不自动 resume/发送。构造期账号修订可尚未发布，实际绑定必须核对当前值；见 `docs/designs/chatgpt-desktop-mode-20261103/shared-proof-revalidation-20261107.md`。
- 独立 candidate 两个构造入口支持固定 `sharedThread` 布尔选项，默认 false；与 `splitPane` 选择 2/3/4/5，HTTP 不改变配方。启用仅选择原资源/桥接，真实账号、原 registry 与同 writer 收发必须另验，见 `docs/designs/chatgpt-desktop-mode-20261103/shared-surface-factory-20261107.md`。
- SSH 发现仅由服务端固定 `sshDiscovery` 启用，配置、原件路径和 home 不从 HTTP 接收。只复用固定原 parser/discovery，不运行 ssh-G/Match exec/连接命令，完整 profile 与归档版本先核验；缺配置不改原设置资源。实际原版路径是 Settings→Connections→SSH→Add；8484 已加载别名发现，最近状态返回 2 个 alias、0 个连接。真实主机仍未选定或连接，见 `docs/designs/chatgpt-desktop-mode-20261103/ssh-discovery-20261107.md` 和 `ssh-server-bridge-20261109.md`。
- SSH 首连桥仅由 candidate 显式 `sshConnections: { runtimeRoot, sshBinary? }` 持有唯一 manager/child/UDS，只从 ready profile 的可选私有 serverSshSocketPath 读取 server-ssh.sock（host仅显式serverSsh:true发布），禁止从control父目录推导；原control/state与bridge的no-overlap保持；native/container 只作为 `/bridge/server-ssh.sock` client。CLI仅固定 CHATGPT_DESKTOP_SSH_RUNTIME_ROOT/CHATGPT_DESKTOP_SSH_BINARY，不接受 socket 目标；HTTP仅 metadata/alias 保存。受限 RPC 可创建/恢复线程、发送 turn，并只回复绑定活动 native request ID 的 command/file/permission approval；这些请求只经 UDS→假 SSH 专项验证。8484 尚未连接真实主机，因此真实远程项目、审批和模型回复仍待验收，见 `docs/designs/chatgpt-desktop-mode-20261103/ssh-server-bridge-20261109.md`。
- 资源只从服务端固定 `CHATGPT_DESKTOP_PROFILE_FILE` 的 owned 0600 配置读取；HTTP 不接受任意 ASAR、socket、PID、命令或上游 URL。`ready` 仅为 profile 时点身份，不代表资源摘要、原生界面或模型已通过。ASAR 每资源与整包分别校验，响应结束/关闭/错误释放有界租约。
- 正式桥用唯一 private view 和 AppHost MessagePort，不借用活跃原生窗口；每次写出重验实例，未知结果不重发。入口和固定清单 JS 的适配必须验证原/新 hash、使用新 ETag，并将适配响应租约与原 ASAR 预算分别计量。显式宿主管理器仅发布全新健康代次；关闭服务撤销持有 inode 和自有 view，不停止已发布 native。当前 Codex-only 新 wrapper 限制 Work executor，旧 wrapper/在线实例不因源码改变而受保护；协议见 `docs/designs/chatgpt-desktop-mode-20261103/host-and-bridge.md`。
- `startContainerDesktopService` / `startContainerDesktopUpstream` 仅为服务端显式容器 API，固定镜像 digest、可执行文件 SHA、允许 CPU affinity 及新私有目录；默认空 HOME、network none、只读 root、cap-drop/NNP 与资源隔离，不走宿主 no-sandbox 回退。首次 grant 未知保留可能运行的 owner，关闭 profile/view 不停止 native。profile 发布窗口中的等待沿用调用者绝对 deadline/取消，不因迟到 ready 补发。LAN 浏览器须使用 HTTPS 安全上下文，不能用忽略证书或不安全 origin 开关代替验收。
- 显式 bridge 网络可用固定授权账号源创建全新 tmpfs HOME，仅 id/access 与必要元数据、不刷新原登录、不复制历史。启动/重连 inspect 网络与挂载配置，逐写复核固定进程、文件/目录及 tmpfs HOME 身份；逐写不等于重新核验容器路由或 mountinfo。项目信任确认绑定实际 private view，不得落到隐藏启动窗口或过期视图。父 iframe 的模式激活租约与原 composer/footer 身份共同保护本地编辑，隐藏、文档替换和断线撤销；租约不授予 native 写入权。
- 第四模式共享新建/续聊沿原 composer、实际注册的共享 manager 和同 daemon writer；原点击时文字/模型必须在授权 await 前捕获，clientUserMessageId 保留。创建回执按真实配置采纳并注册原 shared-follow，项目以实际 AppHost cwd 映射；失效选择 render 可恢复、submit 仍拒绝，不得静默回本地。见 `docs/designs/chatgpt-desktop-mode-20261103/shared-composer-submit-wiring-20261107.md`。
- 原版 local 模型目录不能证明共享 daemon 支持所选模型；显式创建缺失证明时，仅用同一已核 observer 的固定只读 `model/list` 有界取证，保留原模型/effort，读后重核 ticket/账号/view，创建注册不跨 await。取消或变化不安装迟到目录，不因刷新/后台恢复创建或发送；见 `docs/designs/chatgpt-desktop-mode-20261103/shared-turn-selection-20261108.md`。
- 第四模式组合验收使用完整冻结快照，包导出、服务端 sidecar 白名单、浏览器入口与 native wrapper 必须同版。`native-app-policy` 组合固定原件的 Work/SSH 限制、信任和动态工具路由；动态工具仍经原版真实请求/回复，不伪造空工具。原 composer 因配置等待保留的提交可能自动继续，未见 turn 不等于没有待发送；验收取消后不得对同一页面重新开放许可或重复点击。
- 第四模式 broker 回站按固定最多八帧重新核验，再无 await 地逐帧写出；迟到消息属于下一批，原队列/字节/超时及实际 native 写前授权不放宽。默认固定 control-client 保留每次写前完整 profile 校验，其他 connector 仍需网关独立核验。首因诊断只保留固定枚举，不把原始参数、账号、路径或错误文本暴露到页面。
- 第四模式的 Node 字节流按需 `read(n<=65536)`，不得把默认异步迭代合并的多行读取误当单次来源预算。普通调用期限保持；仅明确打开目录选择器的两个请求等待既有 120 秒决策期与 10 秒传输余量。新容器的 `pidsLimit` 仅由服务端私有配置选择 256（默认）或 512，启动/重连严格核对；不从 HTTP 改预算，不修改存活容器，不以资源分配替代任务授权。核心真实收发与恢复结果见第四模式的 `core-live-acceptance-20261105.md`。
- 第四模式 native 回站 subscriber 的写出 Promise 必须传播至来源 reader，最多八个未完成后等待；不得 `void` 丢弃背压后靠扩大 broker 队列适配正常突发。关闭客户须释放在等 guard 的输出完成，保证读取仍能处理精确 viewClosed。broker 固定 error 与真正 scope/seq 不符分别处理，未知 error 拒绝，不得把队列错误覆盖成身份变化。
- 第四模式 `projectRoots` 只由服务端固定注册：最多八个已存在 owned、非 world-writable 根，同路径 RW 非递归挂载，保护目录不交叠；新目录不得创建在账号 HOME 内。启动、重连和实际写入前核对 held FD、Docker inspect 与精确 init 身份下的实际挂载 inode，不把检查描述成路径原子保证。选择器的 activation epoch 不授予账号/任务权限，原目录复核和 Trust 保留；协议及真实关卡见第四模式文档。
- 第四模式可显式配置 owned `0700`、非 tmpfs 的 `historyRoot`，持久化原生会话 rollout 和受限本地项目元数据；登录和任务队列不迁入。历史目录由账号摘要、排他租约及精确 native 进程身份共同保护，旧实例未确认退出不得复用或接管。项目快照只有在旧容器/native 确认退出、旧 HOME 与账号和固定项目根的身份可核验时才能封存恢复，未知保持原数据并明确失败；见 `docs/designs/chatgpt-desktop-mode-20261103/project-persistence-20261105.md`。`supervisor-init` / `supervise` 为私有配置显式管理新代次，状态未知拒绝重建；当前在线实例不自动切换。真实回复跨独立目录复制恢复已验证，机器重启后旧 HOME 消失与长期登录尚待验收，见 `docs/designs/chatgpt-desktop-mode-20261103/persistent-history.md`。
- 新建 supervisor 若在启动时记录完整身份锚，可在原 manager 退出后、旧 view 为零且输出流干净时复附着同一 native，并重开其精确历史 owner；缺锚、残留 view、账号/身份变化或发布结果未知时拒绝，不启动第二个 native、不自动 resume 或发送。恢复后的项目监视状态明确报异常并保留 pending；真实账号及 8503 尚未启用，见 `docs/designs/chatgpt-desktop-mode-20261103/manager-reattachment-20261105.md`。
- 第四模式原界面的错误重连按钮只在可信用户点击后读取固定 profile；同代刷新当前 iframe，换代更新目标，旧文档或隐藏模式的迟到结果不得生效，不能自动 resume 或发送。热更新须保留既有 iframe 与未发送草稿，验证和边界见 `docs/designs/chatgpt-desktop-mode-20261103/profile-reconnect.md`。
- 恢复第四模式开发后，最小专项检查为 `pnpm --filter @agent-orchestrator/chatgpt-desktop-host run check`、该包 `test`、服务端 profile/路由测试及前端第四模式、三种可见模式切换、直接深链和窄屏回归。当前用户已暂停开发，未执行这些检查。真实原包、账号与 Mac 关卡须单列；缺少夹具的跳过不计通过。方案、协议和剩余关卡见 `docs/designs/chatgpt-desktop-mode-20261103/`。

### 开发source map契约

- serve-only外部source map复用Vite自身map与同源`.map`路由，不额外缓存map正文、不删除调试信息。当前固定Vite7.3.1；升级先跑 `scripts/vite-external-sourcemaps.test.mjs`、文档连续性与React留存保护回归，未知结构明确失败。此优化不改变生产构建或自动刷新规则，也不能替代两秒真实输入验收，见 `docs/startup.md`。

- 会话标签新浏览器窗口仅以 `sessionWindow=<UUID>` 明确启用独立设备现场：固定只读 runtime/native 范围及精确 ID/cwd 核对完成后才挂 App/composer。普通页面持久键不变；新页的 selection/layout/workspace/draft owner 使用窗口身份，关注/项目 journals 仍共享。不得据 `window.open(...,noopener)` 返回 null 认定失败或重复打开，不得复用旧 ACP pointer 抢明确目标，见 `docs/designs/session-mode-implementation-20261029/new-window.md`。


### 当前批准的关注预热默认值

- 本期完整多会话方案的用户Q5/Q8及 `docs/designs/session-mode-multisession-development-plan-20261029.md` §5.3要求：无持久偏好的设备默认启用有界关注近期页预热/保温（`warmFollowedSessions: true`）；聚焦、可见优先，资源不足可回收，不是永久保留全部历史。2026-10-30本轮用户再次明确“统一为：预算允许时持续保温”；已有true/false均保留，显式保存的false继续尊重。
- 不得依据更早体验优化方案恢复“默认false/一律60秒后回收”，也不得为通过内存长测关闭默认保温。当前标准RSS红灯继续独立记录；修改该批准行为须有新的明确用户决定及对应验收，测试夹具必须真实核对所有已关注正文的预热前置条件。

### 第四模式 GUI 候选入口

- 主 8484 入口可在私有 `.env` 显式设置 `CHATGPT_DESKTOP_CANDIDATE_PORT`，只代理第四模式三类固定路径到已运行的 loopback 网关；空值/未配置与生产 build 不改变普通路由，不启动 native。2026-11-07 用户明确要求去掉 ChatGPT 模式密码：主入口显式使用 `CHATGPT_DESKTOP_ACCESS_MODE=workbench` 与固定 `CHATGPT_DESKTOP_WORKBENCH_ORIGIN`，不再要求额外 Cookie/口令；保留固定 HTTPS Host/Origin、跨站拒绝及原生账号/逐写校验。普通独立候选默认 token，不能从 HTTP 选择访问模式。必须保留原重定向和文档连续性，见 `docs/designs/chatgpt-desktop-mode-20261103/main-passwordless-20261107.md`。

- 独立认证候选支持固定同源“登录工作台”及手输工作台口令；`scripts/prepare-chatgpt-candidate-web-env.mjs` 只从显式主看板配置复用 `WEB_BACKEND_HOST`/`WEB_BACKEND_PORT` 到全新 owned 0600 输出，native/login 路由仍优先固定候选。使用私有 env 部署，不把机器地址写进源码。分屏 v4 的真实五轮交付、关闭后台窗格草稿规则及当前工具沙箱阻塞见 `docs/designs/chatgpt-desktop-mode-20261103/core-split-usable-20261106.md`。

- 独立 LAN Mac 候选的认证入口位于 `apps/server/chatgpt-candidate`，不随默认开发启动。运行 `node --import tsx chatgpt-candidate/chatgpt-desktop-candidate.ts`（cwd `apps/server`）须显式提供候选端口、固定 profile；默认 token 模式还要求 `CHATGPT_DESKTOP_CANDIDATE_AUTH_TOKEN_FILE`，owned `0600` 私有口令兑换限期 Cookie。显式 workbench 模式仅用于用户授权取消第二次登录的部署，必须配置固定 HTTPS origin，与 token 文件互斥；不读取或自动注入口令。测试为同目录 `candidate-{auth,workbench-access}.test.ts`、`tsconfig.json` 和前端 candidate proxy 测试。不得把未配置认证的旧隔离工厂当成 LAN 部署入口，见[候选访问认证](docs/designs/chatgpt-desktop-mode-20261103/candidate-access.md)。独立 CLI 的 `CHATGPT_DESKTOP_SPLIT_PANE=1` 固定启用 v4，未设/空/`0` 保持 v2，其他值拒绝；自定义 wrapper 需显式调用 factory 的 `splitPane: true`。HTTP/query/header/body 不得覆盖此服务端选择；回归见同目录 `candidate-surface.test.ts`。

- 第四模式的 Linux GUI/VNC 为显式 opt-in 候选：`apps/web/vite.chatgpt-vnc.config.mjs` 只启动独立前端，`packages/chatgpt-desktop-host/gui-vnc-prototype/` 只提供 loopback broker，不启动或重启 native。机器配置与双重口令留在私有文件，默认 Mac 资源桥及其他模式不替换。GUI 验收必须等待真实像素并从浏览器实际收发；Connected/尺寸/模拟回包不能替代。最新部署与边界见 `docs/designs/chatgpt-desktop-mode-20261103/core-live-acceptance-20261106.md`。

- 第四模式开发代理可由私有 `CHATGPT_DESKTOP_CANDIDATE_LEGACY_ROUTES` 显式保留至多四个精确 profile/generation→loopbackPort 旧路由，优先处理旧 tuple 的 HTTP/WSS，失联不回落新宿主；与主候选端口一起严格校验。配置仅来自服务端，不接受请求指定目标。Vite 配置重载会关闭物理 socket，文档连续性只阻止自动页面刷新，不得宣称物理 WS 无损迁移；升级前保留旧网关、native、目录与历史，并在新地址实测完整收发。
