# 终端模式与会话模式

终端模式继续管理 PTY/tmux/SSH；会话模式直接管理 Codex、Claude Code 与 ACP 的结构化会话。切换模式保留各自挂载状态、草稿和连接。两种模式通过共享项目目录访问相同的文件与 Git，但不会把一个已运行的 TUI 偷偷接管为聊天会话。

## 来源与目录

迁移来源为本地 Codexia 0.54.2，revision `4caaa26550814ba91bda9c221607366b558f1bc5`；保留 MIT 许可证、185 个原有 HTTP/WebSocket 路径及其 Rust 业务模块。来源清单在 `packages/session-runtime/UPSTREAM.json`、`UPSTREAM_ROUTES.json`，脚本测试检查端点覆盖。

- `apps/web/src/components/WorkbenchShell.tsx`：公共模式导航、懒加载与独立错误边界。
- `apps/web/src/session-mode`：迁移 UI，别名 `@session`，原有 Zustand 持久化键统一加 `kanban.session.` 前缀。
- `scripts/session-css-scope.mjs`：包含 Tailwind preflight 在内的迁移样式只作用于 `.session-mode`；Radix Portal 同样挂载在该容器。
- `apps/server/src/routes/session-mode.ts`：同源 HTTP/SSE/二进制/WebSocket 网关，只连接已配置的 loopback 运行层。游标、过滤参数、状态码与二进制内容保留。
- `apps/server/src/services/session-runtime-manager.ts`：启动、识别并复用应用拥有的运行服务。Node 热更新不终止 Agent；健康检查可以重新启动已退出的服务，仍存活但不可用的进程不会被重复启动或隐式终止。
- `packages/session-runtime`：独立 Rust 工作空间，剔除 Tauri 打包依赖，保留 Codex、Claude、ACP、Bots、自动化、文件/Git、工具、用量等业务逻辑。
- `/api/workbench/projects`：合并会话项目和本机终端目录，远端 SSH 路径保持独立。
- `/api/session-previews`：用户显式选择本机 HTTP 开发服务后注册短期预览地址；限制 loopback 与高端口，代理资源和 WebSocket，避免局域网浏览器把 localhost 误认为手机自身。

## 状态与恢复

Codex/Claude 的单会话、网格和列表统一由 Node 网关持久化并跨设备同步的关注标签集合管理，标签排序与窗口顺序一致，选中会话、阅读位置和布局保留在各设备；关闭只移出集合，不中断运行或清理 worktree。输入目标与工作目录由共用导航操作同步，刷新只恢复一次选中项，后台事件不得重新添加已关闭的标签。迁移与边界见 [会话标签](session-tabs.md)。

嵌入的 `AppLayout` 使用父容器可用高度（`h-full min-h-0`），避免整屏高度与工作台/会话导航重复叠加。消息区域承担滚动，输入区保留在布局内；`session-chat-layout.spec.ts` 在不发送真实消息、不写用户设置的浏览器上下文中验证三个 Agent 的长对话、输入聚焦和四种窗口尺寸。

应用数据默认放在 Git 忽略的 `.dev-runtime/session-mode`。SQLite、工作区设置、Bots 记忆、定时任务、配对状态、发布状态、语音模型与工具安装都与原 Codexia 独立。原生 CLI 的登录和原生历史继续沿用 CLI 的目录，不复制或修改登录凭证来完成迁移。

运行层为事件分配序号并保留重放窗口；SSE/WebSocket 重连携带 `since` 和命名空间。健康检查发现运行实例变化时重建事件订阅并恢复当前 Codex 历史；草稿与界面保持挂载。运行进程重启无法保住其已退出的外部 Agent 子进程，不把重启后的状态伪装成任务仍在运行。浏览器共享一个 SSE 连接以避免同源连接上限；Claude 消息在应用级持续接收，浏览器监听仅在 SSE 真正打开后报告就绪，并记录当前订阅的就绪状态，避免等待方漏掉提前到达的信号；卸载时释放状态。后台异常产生终结事件，防止一直显示加载中。

文件监听按路径引用计数，晚于组件卸载才完成的监听立即释放；递归遍历有目录数量上限，主目录、根目录与超大树使用浅层监听，打开文件仍有自己的父目录监听和手动刷新。保存文件前核对磁盘内容；有外部修改时明确确认覆盖，拒绝覆盖会保留草稿。工作树创建失败会拒绝启动，不静默改回共享目录。

用量统计的原生历史扫描在阻塞线程池运行，热力图、排行和筛选选项共用扫描结果，缓存 60 秒。并发与重入只运行一次扫描，取消网页请求不会重复启动扫描，失败不缓存；统计最多延迟 60 秒反映新的记录。`insight_codex.rs` 基于固定版本 agent-insights d653ec5 的字段语义，按行读取、跳过与统计无关的正文/图片，按文件大小及修改/创建时间复用记录；追加或删除会更新，支持原生 `CODEX_HOME`。回归对照固定版本的 token、工具、项目、模型等字段。Claude 后台批准请求同样保存在所属会话，并提供等待批准提示。

明确导入入口先预览，确认后合并项目、历史、Bots/ACP/笔记/自动化记录与记忆。SQLite 合并事务化，已有记录不覆盖；重复导入去重，所有导入定时任务暂停。原生账号、设备 Token 不在导入范围；后续步骤失败时显示部分导入的警告，允许修复来源后重试。

## 桌面能力的浏览器等价方案

| Codexia 能力 | 会话模式方案与差异 |
| --- | --- |
| 桌面窗口、托盘 | 工作台的会话/任务状态与浏览器通知；关闭网页不停止服务器任务，不安装 OS 托盘 |
| OS 全局快捷键 | 当前工作台内快捷键；隐藏模式不响应，浏览器保留其系统级快捷键 |
| 原生目录/文件对话框 | 浏览服务端目录、输入绝对路径；本机文件上传到独立附件目录 |
| 截图 | 浏览器用户授权后选择屏幕/窗口/标签页；不支持时使用图片附件 |
| 语音输入 | HTTPS 麦克风采集，16 kHz PCM，服务端本地 Whisper；模型由用户明确下载，最多 120 秒 |
| 系统通知 | 用户在设置中授权浏览器通知；权限不足时页面提示 |
| 保持系统唤醒 | 浏览器支持并允许时使用屏幕 Wake Lock；作用于当前可见设备，服务器任务独立运行 |
| ChatGPT 登录 | LAN 浏览器使用设备授权码，显示可点击链接和完成反馈，避免 localhost OAuth 回调指向手机 |
| 外部链接/打开编辑器 | 安全外链；项目工具栏在新标签页打开同源 VS Code Web，服务端文件也可在内置文件树打开 |
| Tailscale 手机配对 | 共用已部署的 HTTPS 工作台地址与二维码；同一服务器的会话在多设备浏览器访问 |
| 本机应用更新/开机启动 | 现有服务器启动与 Git 更新流程；后台只检查更新，用户明确确认后 fast-forward |
| ACP/Bots sidecar | Keke 固定到参考项目的 0.1.38，安装到独立应用目录，避免修改全局 npm 工具；其他 Agent 仍需要其可用程序及账号 |

普通 HTTPS 站点也可直接预览；站点自身禁止 iframe 嵌入时，使用“在浏览器打开”。本地开发服务代理覆盖常见根路径资源与 Vite HMR；自定义域名、绝对外部资源和特殊反向代理规则仍按项目部署方式配置。

## 启动与配置

```sh
pnpm install --frozen-lockfile
# 首次复制 .env.example 为 .env，再按需编辑
pnpm dev:restart  # 自动编译 shared 与默认 Rust 运行层
pnpm session:status
```

需要 Node/pnpm、Rust stable、C/C++ 编译工具与 CMake。Linux 构建使用 vendored OpenSSL/DBus，Whisper 使用预生成绑定，减少对系统开发头文件的依赖。默认以 debug 二进制启动；可通过 `SESSION_RUNTIME_BIN` 指定已构建的可执行文件（相对路径从仓库根目录解析），这时启动准备跳过 Rust 构建。准备或编译失败不会停止现有服务；已有 Rust 进程仍然复用，磁盘产物更新不会隐式激活。详见 [启动与更新指南](startup.md)。

`SESSION_MODE_ENABLED`、`SESSION_RUNTIME_BIN`、`SESSION_DATA_HOME`、`SESSION_RUNTIME_PORT`、`SESSION_CARGO_BIN`、`SESSION_CLAUDE_CONNECT_TIMEOUT_MS` 和 `SESSION_FS_WATCH_MAX_DIRS` 均在 `.env.example` 中说明。前端/后端/HTTPS 端口仍由原有 `.env` 配置；运行层仅绑定 loopback，不把参考项目的固定端口暴露给浏览器。定时任务 UI 明确显示服务器时区。

本次独立联调地址为 **HTTPS `https://10.30.0.24:50629`**，Node API 为 **HTTP `127.0.0.1:33123`**；正式工作台沿用原有 **HTTPS `https://10.30.0.24:8484`**。地址来自本次部署配置，源码不依赖该 IP。

## 验收

```sh
pnpm check
pnpm test
pnpm session:test
pnpm session:clippy
PLAYWRIGHT_SKIP_WEBSERVER=1 PLAYWRIGHT_FRONTEND_PROTOCOL=https \
  PLAYWRIGHT_BASE_URL=https://10.30.0.24:50629 \
  pnpm exec playwright test tests/e2e/session-mode.spec.ts
```

E2E 使用独立数据目录与服务，不在用户正在工作的目录执行写入实验。覆盖页面导航、375/768/1024/1440 宽度、CSS 隔离、模式切换草稿、项目选择/复用。运行层另外验证真实 Codex 回复、Keke→Codex ACP 会话、只读来源导入/重复去重/任务暂停、Whisper 音频转录及原有终端握手与真实 tmux 输入。

本机 Claude CLI 的实机调用当前未得到完整回复，并出现 `grok-4.7` 的原生模型告警；保持用户原有模型/服务配置，未把这项验证标为成功。启动连接有超时反馈，后台失败、中断和断开有独立回归覆盖；使用有效的 Claude 服务配置后可继续实机验证。

### 本次交付实测（2026-10-06）

- 正式 **HTTPS `https://10.30.0.24:8484/?mode=session`** 已启动，前端监听 `0.0.0.0`；按用户明确授权重启会话运行服务，原有 45 条终端记录及连接状态保持一致。
- `pnpm check` 通过；终端前端 511、后端 588、会话前端 83、脚本 80 个测试通过；后端有 1 项平台条件跳过。Rust 工作空间 108 个测试通过，3 个外部服务用例明确忽略；严格 Clippy 通过。
- 正式地址 E2E 2 项通过，覆盖模式导航/草稿、样式隔离、375/768/1024/1440 宽度、发送按钮/操作栏边界以及项目目录保存/复用；测试恢复原有项目设置。
- 真实 Codex 对话返回 `SESSION_MODE_OK`，隔离临时目录得到确认，浏览器页面错误为 0；Keke→Codex ACP 请求返回 `end_turn`。显式导入验证首次合并、重复去重和任务暂停；Whisper tiny 验证真实音频转录。
- 正式服务的大历史统计 3 个并发请求共用扫描并成功返回：首次约 81 秒，缓存后切换筛选约 46 毫秒；扫描期间 25 次健康检查全部成功，最慢 263 毫秒。页面明确提示首次整理的等待及可返回会话继续工作。
- 原有未提交改动保留；未创建 Git 提交或推送，原 Codexia 仓库保持未修改。

### Codex 长历史渲染与切换（2026-10-07）

`CodexThread` 使用已安装的 TanStack Virtual，仅挂载可见消息与两行缓冲。协议事件先按原命令聚合规则生成可见行；一次索引计算用户消息回退轮数，并按 turn 缩小文件汇总上下文，避免每行扫描整个会话。消息、运行状态与输入组件按相关会话/字段订阅；Git 工作区差异不监听聊天事件，收起面板保持挂载但不参与布局。

动态高度通过 ResizeObserver 的 border box 测量，视口尺寸也由 observer 提供；跟随最新消息的滚动合并到动画帧，避免渲染中反复同步读取布局。滚轮、触摸、键盘或鼠标交互后的阅读位置优先保留，新内容不强制滚到底部。审批、权限和用户问题位于虚拟消息列表后的独立区域。最近 50 个会话缓存阅读位置与展开状态，每个会话最多缓存 10000 行测量值；完整消息仍留在会话 store，缓存淘汰不删除历史。虚拟列表使浏览器原生页面查找仅覆盖已挂载消息；完整历史仍可通过滚动浏览。

恢复请求按 thread 去重。晚返回的请求只缓存对应历史，不能改变后来所选的会话；同一 thread 的新配置请求使旧结果失效。`historyLoadingMap`/`historyErrorMap` 提供加载与重试反馈，不写入服务器配置。原生恢复协议和运行服务保持不变。

直接回归：`pnpm --filter web test:session`、`pnpm check`，以及局域网地址上的 `tests/e2e/session-codex-performance.spec.ts` 和 `tests/e2e/session-chat-layout.spec.ts`。浏览器注入合成会话并拦截设置写入，不发送 AI 消息或接管用户任务。此次合成 1500 条格式化消息实测切换约 268ms（计时至最新行实际进入视口），30 次后台更新约 4ms，最新区域约 128 个 DOM 元素；此前同类全量渲染约 9.25 秒、43501 个元素。数字来自开发模式的独立浏览器页，首次原生历史接口耗时另计。

### 输入建议菜单（2026-10-07）

`ComposerSuggestionPanel` 统一 Codex/Claude 命令和 Lexical 技能建议的表头、列表、图标、选中状态与键盘提示。Codex 的手工 Portal 必须挂到 `sessionPortalContainer()`，避免逃出 `.session-mode` 后丢失作用域样式；Claude 继续使用已限定容器的 Radix Portal。样式全部使用现有主题变量，不新增固定主题色。

`ComposerSuggestionPopover` 观察输入区域尺寸、页面滚动、窗口与 `visualViewport` 变化；定位函数按可用空间选择上下方向并限制边界，桌面最大宽 460px/高 420px，手机最高 360px。空间非常少时隐藏辅助表头与键盘提示，列表单独滚动。事件与 observer 随组件卸载清理。菜单不是模态对话框，点击选项不夺取编辑器焦点；原命令执行和 mention chip 的发送文本保持不变。Lexical 触发器允许含连字符的技能名，最长查询 128 字符。

验收：`suggestionPosition.test.ts` 和 `tests/e2e/session-composer-menus.spec.ts`，覆盖 1440×900、768×1024、375×667、812×375、主题继承、边界、方向键、Esc、技能筛选/插入以及 Claude 鼠标选择焦点。测试使用合成技能并拦截配置写入，不调用真实 Agent 命令。

### 提交前复验（2026-10-07）

- `pnpm check`、`pnpm test`、`pnpm session:check`、`pnpm session:test`、`pnpm session:clippy` 全部通过。终端前端 511、后端 588、会话前端 92、脚本 80 项通过；后端 1 项平台条件跳过，Rust 108 项通过、3 项外部服务用例忽略。
- 在 **HTTPS `https://10.30.0.24:8484`** 复验长对话布局、Codex 长历史性能和输入菜单，4 项浏览器测试通过。测试仅注入合成会话并拦截设置写入，未发送真实 Agent 消息；1500 条历史切换约 327ms，30 次后台更新约 4.5ms，挂载元素 128 个。
- `.env`、构建产物、应用数据和独立工作树不纳入提交；保留迁移来源与许可证。

### 会话项目编辑入口（2026-10-07）

移除会话项目工具栏的 Run、Publish 和桌面 Open in 入口，改为 VS Code Web。`POST /api/workbench/vscode-web` 接受当前服务器项目的绝对目录路径；拒绝控制字符、非绝对路径、文件、不存在或不可访问的目录。它复用 Node 的 `VsCodeWebManager`，按 realpath 解析后的真实目录生成稳定编辑工作区 ID，保留当前局域网访问的 host/协议并通过现有 `/vscode/` 代理打开。无需创建终端记录或启动 AI 会话，重复打开复用现有编辑服务。迁移后端的上游发布接口仍保留以维持来源端点清单，但会话工具栏不再提供发布 UI。

浏览器使用右侧工具标签中的 VS Code iframe。按真实目录维护唯一容器，隐藏、关闭工具和切换项目保留编辑现场；通过本设备固定项目设置控制跟随行为。服务端合并并发本地服务启动。详见 [右侧 VS Code 工作区](session-vscode-panel.md)。

### 会话名称与品牌（2026-10-07）

`WorkbenchShell` 负责品牌，向终端 App 传递 `embedded`，内层 TopBar/MobileWorkbenchPage 通过 `showBrand` 保留操作与统计但隐藏重复 Logo/标题；独立使用仍显示品牌。GitHub 入口共用 `lib/product-links.ts`，仓库目标来自本项目的 GitHub remote。

`renameSession` 统一名称校验与提交。Codex 使用已有 `thread/name/set` 接口，成功后更新原生 thread 元数据与临时显示缓存；`thread/name/updated` 同步 name 字段、清理空名称缓存，不作为聊天正文渲染。Claude 与 ACP 使用工作台显示名称，写入运行服务 settings.json 根级 `sessionNames`，不改写原生 Claude JSONL 或调用 ACP 运行控制。ACP 键包含 agentId 与 sessionId，避免不同 Agent 的 ID 冲突；刷新及其他设备重新打开页面时从服务器恢复。

名称与工作区配置写入在浏览器内串行，写前读取服务端设置并保留 remote 等未知键；读取失败拒绝写入，避免用默认值覆盖现有配置。名称保存不改变会话 ID、历史或运行状态。输入限制 128 字符，空白禁用，保存中防止重复提交，失败保留草稿。列表、固定列表、卡片和当前标题使用同一名称来源。终端原有重命名流程不变。

回归包括 TopBar/MobileWorkbenchPage 单测、名称校验/失败/持久化/配置保留测试，以及 `tests/e2e/session-identity.spec.ts` 的单品牌、Issues 链接、三类名称保存与刷新恢复、键盘、失败重试和手机弹窗边界。

### Codex 回滚协议与会话归属（2026-10-07）

运行版本与源码版本必须分开验证：Node 网关热更新会复用 detached Rust 服务，替换磁盘二进制也不会更新已运行的进程。2026-10-08 复现的旧 `thread/rollback` 错误来自仍在运行的旧实例；用户要求保留时不得自动重启。回退错误在确认框内显示，旧接口拒绝给出重启说明，技术详情折叠且限高，不再将完整协议列表放入 toast。浏览器回归见 `tests/e2e/session-rollback-errors.spec.ts`；只有隔离验证通过并经授权完成服务替换后，才能宣称正式实例已生效。

本机 Codex 0.159.2 的生成协议不再包含 `thread/rollback`，使用 `thread/revert { threadId, beforeTurnId }`。新接口保留会话 ID，只返回线程元数据及保留历史的倒序游标，`thread.turns` 为空。现有 `POST /api/codex/thread/rollback` 路径继续保留：先尝试旧接口，仅在 JSON-RPC 明确报告方法不存在时转用新接口，业务失败（例如任务运行中）不得重新执行另一种回滚。新接口成功后通过 `thread/turns/list`、`itemsView: full` 和连续倒序游标加载所有保留轮次，再恢复正序给前端；回滚成功但加载失败须明确提示重新打开会话，不能伪装成未执行。

前端传入实际消息的 turn ID 和兼容旧版本的轮数；服务对同一边界的并发请求去重，不同边界的并发回滚拒绝。每次编辑均显示明确的回滚确认，操作期间禁用重复提交，运行中的任务不能回滚。请求晚返回时不得切换后来选中的会话或覆盖其草稿；回滚成功使先前的恢复请求失效，丢弃轮次的计时状态清理。确认窗口说明只修改对话历史，不恢复代码文件，也不自动重新发送消息。

`SessionAgentBadge` 为项目内 Codex/Claude 会话、跨项目置顶会话和 ACP 会话提供常驻文字标签。ACP 标签包含保存的 Agent 标题或 ID；标签限制宽度、保持可访问名称并允许会话标题收缩，窄侧栏也可识别归属。它不影响会话 ID、切换、重命名、运行状态或置顶行为。

红绿灯覆盖 Rust 协议兼容/分页/业务失败、前端回滚边界/晚响应/重复请求/确认/失败重试，以及 `session-rollback-agent.spec.ts` 的完整浏览器操作。隔离的本机 Codex 和确定性本地模型提供商实测三轮撤回到一轮、ID 不变、保留完整消息与项目文件不变，不读取用户账号或操作真实任务。


### 输入区停止按钮状态

Codex 输入区优先使用当前 thread 的 `turnTimingMap` 判断轮次是否仍在执行；在轮次尚未收到时回退到当前轮次 ID 与 thread 状态。历史恢复同步 thread 状态、末轮状态及当前轮次 ID；流式完成事件优先于迟到的启动 HTTP 响应。停止 HTTP 响应不能清空其他 thread 或新轮次。停止成功后的完成通知负责恢复发送入口。

Claude 的 `sessionLoadingMap` 保存各会话运行状态，切换读取该会话的值。停止失败不得清除运行标志，成功只更新请求捕获的会话。ACP 的取消由原有运行状态通知/提示请求完成链路确认。三种输入区共用停止请求防重与失败提示，发送的附件校验不阻塞停止；空输入的 Enter 不隐式执行停止。

### 会话提示、悬浮侧栏与图片（2026-10-07）

详见 [session-interactions.md](session-interactions.md)。完成回执是浏览器侧独立状态，仅实时成功完成事件创建，不从历史加载或运行中断推断；阅读按前台、选择归属和最新内容的交集确认。Sidebar 浮出状态不写入持久布局，只在桌面可见模式响应悬浮；临时浮出不增加布局占位。图片草稿按 Agent/会话隔离，Codex/Claude 复用既有图片路径，ACP 新增可选 image_paths，并转为协商过的原生图片块；健康接口声明 acpImages 能力，使旧运行服务不能静默忽略新参数。运行服务升级会中断它拥有的 Agent，构建新二进制不自动重启当前实例。

## 会话工作台 UI 状态边界

`AppLayout` 在桌面、窄屏、手机和非聊天页面复用同一辅助工具树；隐藏内容采用 `hidden`/`inert` 并停用所属键盘事件，而非通过新 key 重建 Agent 或终端。文件编辑器按路径保留已访问实例和草稿，截断预览不进入可保存编辑器，加载完整内容后才启用编辑。保存失败保留草稿与可执行反馈。

审批 UI 的 pending/error 绑定连接、会话与请求身份，只有成功且仍匹配的响应才能移除原提示；失败或迟到响应不影响新会话。列表加载采用请求归属防止旧项目响应污染，分叉窗口绑定接口返回的新身份。以上不修改执行权限或会话持久化格式。

验证使用独立 `.env`、端口及 `SESSION_DATA_HOME`。浏览器在真实局域网前端运行，API/事件以隔离 fixture 驱动，不发送真实 Agent 指令；测试访问地址由环境变量注入，源码不固定主机或端口。辅助终端资源释放及 ACP 生命周期的额外调整需用户单独确认。

命令摘要的各 action 保留原 commandExecution item ID 与输出来源，完成事件按 ID 更新本次渲染推导的局部来源对象，避免把首条 ID/最后输出应用到整个组。不增加协议事件，不改变持久化历史。

Bot 草稿和发送/停止反馈按 Bot 存储在非持久化 UI 缓存；捕获请求身份，成功/失败只更新对应对象，停止全局显示状态还需当前 ACP 身份匹配。阅读跟随只在读者处于底部时继续，旧历史不会被新增输出抢走；明确返回最新重新启用跟随。

项目集合与关注标签由 Node 网关分别持久化在同一个 `SESSION_DATA_HOME` 中，带上一版备份；相对数据路径统一以仓库根解析。浏览器缓存及待提交操作使断线刷新后仍能恢复记录，重连逐项合并。当前目录、Agent 和访问历史保留在设备，旧 workspace 设置不再整份回写。迁移、边界与重启验收见 [工作区记录](session-workspace-records.md)。

### Codex 待答请求对账

`codex/request-user-input` 经事件桥进入按 thread/request/turn/item 隔离的内存状态。EventHub 为待答问题独立保存集合，在 SSE/WS 连接时按 replay、`codex/user-input-snapshot`、live 顺序传输；snapshot 可与最后 replay 共用 seq，前端按对账帧处理。响应仅回传原 JSON-RPC，resolved/turn 完成清理，runtime 实例变化废弃旧请求。详见 [协议与验收](session-codex-user-input.md)。

### Codex 关注历史恢复队列（2026-10-08）

`SessionWorkbench` 在服务 ready 时同时启动关注状态快照与 `followedSessionHistorySync`，离线/卸载时清理调度。历史成功标记与流式 `events` 分离；启动和连接恢复按关注 ID 补齐，队列并发上限为 2，失败后重试，后台 `threadResume` 禁止选择会话或递增输入聚焦计数。恢复订阅共享成员到达，但只恢复一次设备端选中项，后续同步不导航。状态查询的轮次冲突触发补查而非静默遗失。详见 `docs/session-tabs.md`。

状态派生统一由 `codexRuntimeState` 承担；轮次事件、历史和 HTTP 回执遵守终态与轮次新旧规则。运行实例替换会作废在途历史请求。待处理交互增加内存级 `codex/pending-requests-snapshot`，覆盖原生问题、命令/文件审批、权限和 MCP 交互，允许与补发事件共享游标。详情与兼容边界见 [状态转换](session-state-transitions.md)。

## Codex 执行权交接

只读历史不调用 resume；`ownership::Ownership` 在原生传输入口统一串行化每会话的执行、恢复和安全释放。Node 队列通过内部 holds 接口报告执行需求与不确定投递，浏览器代理禁止调用该内部接口。原生取消订阅后必须核对 loaded/list，后台终端、目标、子 Agent、待交互或未知资源禁止自动卸载。见 [协议与发布边界](session-ownership.md)。
