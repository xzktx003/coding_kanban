# P4 编辑器宿主与旧版云任务进度

本记录只描述启用的原版 VSIX 能力。来源是隔离提取的 `plugin/extension/out/extension.js`、`plugin-readable/extension-host-handlers.js`、`cloud-*.js` 和 `app-initial-e98b9eaef8e3.js` 中实际启用的旧 `/wham/tasks` 分支。新增代码为独立实现；未移植账号凭证、遥测代码或原插件许可证，也未启用原版已关闭的 realtime voice、widgets、newWork。

## 架构与真实归属

- 协议包：`packages/shared/src/session-codex-host.ts`，通道 `coding-kanban.codex-host`、版本 1。外层面板和已挂载 iframe 都检查精确来源窗口、同源 Origin、版本、nonce、捕获的 `{cwd,threadId,draftOwner,agentId}`。后端通过原生只读 thread metadata / 已登记项目核验 owner，浏览器提供的 cwd 不能独立赋予权限。
- 后端对 cwd 和托管 `.code-workspace` 做 realpath 核验。draftOwner 保留原始 JSON 草稿标识，不因符号链接目录解析而改写。浏览器单页 clientId 是受长度和字符约束的随机标识；工作区文件以 canonical cwd + clientId 哈希命名，不接受任意路径作为 clientId。一个浏览器内继续按真实目录去重，不同窗口的编辑器选择不会串入另一个窗口。
- 配套扩展在 `packages/codex-host-bridge`，版本 0.1.0。`VsCodeWebManager.setCodexHostPreparation` 只向所选扩展目录复制自身包；不 reload 已打开窗口，不停止或重启编辑服务。托管工作区 URL 使用 workspace + kanbanCwd；同时传 folder 会让真实 code-server 忽略 workspaceFile，已通过实际运行定位并修正。
- 私有 companion 凭证只写入 SESSION_DATA_HOME 和托管 workspace 文件的私有兄弟文件。网关 onListen 使用真实监听端口生成 loopback HTTP 地址，凭证文件强制 0600。浏览器 API、iframe 消息、URL、MCP 返回值没有凭证内容。
- Broker 的命令同时绑定工作区身份和真实扩展 instanceId；实例替换、过期或 owner 离开时拒绝旧结果。TODO 上下文只投递给该工作区唯一活动 lease。隐藏/关闭工具标签保留 iframe；切换输入 owner 只变更 bridge binding。
- HTTPS 开发代理必须保留浏览器 Host，才能执行精确 Origin.host 校验。Vite 字符串代理隐式 changeOrigin:true 导致实际产品 POST 403；主线程将代理改为显式 changeOrigin:false。没有把任意 forwardedHost 当成授权依据。

## 已实现的编辑器与项目能力

`features/codex-host/bridge.ts` 与真实 iframe relay 连接。配套扩展使用 VS Code API 读取当前文本缓冲和实际选区（包含未保存内容），打开行列位置，通过只读内容 provider 打开原生 Diff，注册 TODO CodeLens 和编辑器上下文菜单。浏览器自有编辑器通过同一个 `addBrowserEditorContext` 将内容写入捕获 owner 的设备持久草稿。

`HostWorkspacePanel` 和 `CodexHostWorkspaceService` 提供真实 Git 分支列表/创建/切换、独立 worktree、AGENTS.md 版本核验保存、OpenAI 官方推荐技能读取与项目内安装。命令参数通过静态 execFile 参数数组传递；切换同时拒绝 Git 脏状态和实际 VS Code 未保存缓冲。配置表单按原始 draftOwner 保存本设备草稿并注册离开保护；异步结果只更新捕获 owner。普通注册目录的 AGENTS.md 读写不依赖 Git；Git 不可用时 branch/dirty 返回 null 并明确说明原因，不显示成游离 HEAD 或干净仓库。Git 读取返回 canonical repoRoot；若 git -C 找到的是当前项目外的上级仓库，面板显示真实根目录并禁用分支/工作区修改，服务端也拒绝 createBranch、checkout、createWorktree，普通确认不能扩大项目归属。

可选 LSP 默认关闭。明确开启 `codingKanban.host.lsp` 后，配套扩展调用实际 `vscode.executeDefinitionProvider`。`lsp-mcp.cjs` 提供 stdio MCP `vscode_find_definitions`，私有 server credential + 捕获 owner + workspace + 当前 instanceId 均再次核验；不会启动新的语言服务器，不会发送 Agent 消息。面板返回可复制的结构化 MCP 配置，不暴露 token。只读编辑器伴随扩展明确支持 untrusted workspace；未受信项目自己的配置不能开启 LSP。实际共享扩展环境此前未声明该能力，导致安装已登记但没有激活，已通过 manifest 红→绿测试修正并观察到真实 onStartupFinished 激活。

## 云任务与账号能力

独立服务 `codex-cloud.ts` 从原生 Codex CLI 登录目录读取 ChatGPT 账号，或使用明确配置的 CODEX_CLOUD_AUTH_FILE；API Key / 自定义 provider / 缺失或过期登录显示实际不可用原因，不静默导入 Codexia。远程账户凭证仅用于服务端请求。

已实现真实环境与任务列表、Git 工作区 tar.gz 快照、文件清单/摘要、签名 URL 上传、finish_upload 核验、新建、真实 turn 续聊、结果/轮次/日志读取。新建与续聊使用原版启用的 `/wham/tasks` payload。请求 receipt 保存在隔离数据目录，未知提交结果不会自动重复发送。原会话委派使用独立 `projectCodexPriorConversation`：按顺序投影用户文字、已完成助手文字和原生 turn diff；不把 reasoning、工具输出、当前全局 Git Diff 或内部 JS 导出当成 prior conversation。

账号/只读任务权限与 snapshot 权限分别呈现。快照创建端点 403/404 只标记 snapshot 不可用，保留账号、环境、任务读取能力。打开云面板不会创建任务或上传文件；上传与创建都有当前项目/文件清单/消息范围的明确确认。

## 验证与证据

隔离编辑验收使用新建项目、独立 SESSION_DATA_HOME、扩展目录、用户目录和端口；实际产品复核只登记新建测试项目与独立浏览器 clientId，复用已有编辑服务。未发送真实 Agent 消息，未重启正式运行层或停止 Agent。

- 普通目录与 Git 项目范围：`host-project-scope-red.log` 三例先失败，修改后 targeted 5 例通过；`host-project-ui-red.log` 两例先失败，最终合并前端 16 例通过。仅在新建 /tmp 项目中验证 AGENTS CAS 与 Git 分支/worktree 拒绝，没有改变真实用户项目。
- Node 相关测试：`host-server-green.log` 当前 39 例通过（包含 manager 20、workbench route 4 和 host/cloud 15）；私有凭证重用权限/多字节输入另有红→绿日志 `host-private-credential-{red,green}.log`。
- 前端：`host-workspace-ui-red.log` 两例先失败，`host-ui-green.log` workspace 4 + bridge 3 + cloud 3 + 原有 VS Code 面板 6 共 16 例通过。最终前后端类型检查均退出 0，`host-{server,web}-types.log` 为空。
- 配套扩展/MCP：`host-native-lens-red.log`、`host-untrusted-manifest-red.log` 与 `host-native-green.log`；TODO 命令边界改用 URI + Range，避免将 live TextDocument 作为 RPC 参数，4 例通过。
- 实际隔离 LAN：HTTP `http://10.30.0.24:45025`，`host-e2e/data/real-browser-proof.json` 记录真实 Monaco dirty 选区、完整缓冲与磁盘内容不同、nonce 伪造被拒绝、原会话草稿上下文、原生 Diff、定义查询。stdio MCP initialize / tools/list / tools/call 对同一真实扩展实例成功；定义落在项目文件第 1 行第 14 列。截图 `real-host-unsaved-selection.png`、`real-host-diff.png`。验收完成后仅关闭本次独立 harness，45025 不再监听；正式产品 `/api/session/health` 仍返回 200。
- 实际产品 HTTPS：`https://10.30.0.24:8484`。`product-origin-proof.json` 显示 capability GET 200；故意不存在 workspace 的同源 bind 返回 409（修正前为 403），证明代理后的来源校验通过。`host-e2e/data/product-mounted-proof.json` 记录真实 mounted iframe 的 owner/nonce 连接、原生 openLocation、实际 Vim 整行选区 `// captured product selection`（第 4 行第 1–30 列）、实际“添加选区”按钮写入捕获的原 draftOwner，以及真实关闭工具、通过“打开工具 → VS Code”重新打开后仍复用同一个已连接 iframe；retained:true、reopened:true、page errors 为空。截图 `product-mounted-context.png`。已有产品 auto-save 将该测试文件保存，因此本次 dirty:false；未修改用户设置，独立测试的 dirty:true/full-buffer/LSP/CodeLens 证据单独保留。测试期间仅关闭自己的配套扩展 onboarding（Skip）与项目信任提示（No Trust），没有登录或增加信任。
- TODO 原生命令选择器点击与直接行内渲染/点击均已实测投递到原草稿。`real-browser-proof.json` 的 todoInlineAfterFocus:true、todoPickerUsed:false、contexts 两条记录，截图 `real-native-todo-inline.png`。首次 todoVisible:false 是编辑器失焦后 native CodeLens debounce 被取消；重新聚焦真实文件的 TODO 行并等待 provider 更新即可显示。没有将第一次失败删去或当作产品成功。
- 推荐技能实际从 `https://github.com/openai/skills.git` 读取 39 个条目，并在独立项目安装 aspnet-core，SKILL.md 实际存在；`host-catalog-e2e/proof.json`。

## 真实云端验收的限制

主线程授权的单任务验收只准备新建项目的 `.gitignore` 和 README.md，237 字节 tar.gz；清单中没有仓库/用户配置/凭证文件。`cloud-e2e/data/snapshot-manifest.json` 记录两文件清单、commit 和摘要。预定提示为“List files in this snapshot and quote README.md content. Do not modify files or make network calls.”，未发送现有对话或代码。

实际 ChatGPT 登录可用、Pro，环境列表与任务列表 GET 都成功且为空。第一次 upload_url POST 返回明确 404；从原版 primary code 核验 originator/User-Agent/base/path/header 后，主线程授权纠正协议请求再试一次，仍返回明确 404。当前没有签名 URL，没有 PUT/finish_upload，没有创建远程任务，也没有模型完成结果。没有尝试未记录的替代接口或自动创建重试。完整远程新建/续聊/模型结果验收依赖该账号/API 重新提供旧快照接口，或提供已授权环境；HTTP 200 fixture 单测不能替代这项真实验收。

主线程负责同步 `docs/func_list.md`、`docs/project-overview.md`、`docs/debug_list.md` 和整体计划矩阵。产品整行选择与 iframe 关闭/重新打开验收已完成；真实云端模型完成仍被旧快照 API 404 阻塞。

## 开发实例预构建缓存隔离

真实 LAN media 验收发现 Vite 8484 的 live Streamdown transform 引用已删除的 `mermaid-NOHMQCX5-AHTENGO2.js`（HTTP 504），但磁盘 metadata 已换到另一个 browserHash 和新的 Mermaid chunk。进程检查确认主树与 mobile-terminal-ui 工作树的多个 Vite 通过 node_modules 符号链接共用主树 `apps/web/node_modules/.vite`。另一优化器替换 deps 后，正在运行的 Vite 仍持有旧 transform。这是开发缓存归属问题；未修改 Markdown renderer、原生资源或 URL 来掩盖失败。原始证据保存在 `visual-native-prebundle-http-evidence.md` 和对应 live/disk 快照。

`vite.config.ts` 仅在 command=serve 时使用 `scripts/vite-dev-cache.mjs`；构建配置保留默认行为。缓存归属为 canonical 项目目录 + mode 哈希 + 每个进程的 PID/随机实例标记，目录位于已忽略的 `.dev-runtime/vite-cache`，名称最多 48 字符。实例标记存放在 Node 进程的 Symbol 状态，正常配置重载复用同一目录，不因反复编辑配置产生新的缓存目录；不从端口或任意路径参数推导缓存归属。没有清理共享缓存，没有停止任何其他工作树、Rust、Agent 或 code-server。正式 Vite 原 PID 2873879 由自身机制重载，新并发进程使用独立目录。

`host-vite-cache-red.log` 三例先失败；`host-vite-cache-green.log` 三例通过，包含第二优化器替换 deps 不删除第一实例 chunk、重复配置求值/真实目录 alias 保持实例目录、路径与标记长度约束。测试位于 `scripts/*.test.mjs`，已纳入 pnpm test 的脚本通配符。合并 dev port 测试的 `host-vite-dev-config-green.log` 13 例通过。`.d.mts` 声明已同步，`host-vite-web-types.log` 为空、web tsc 退出 0。

实际 HTTPS `https://10.30.0.24:8484` 已核验新的 CodexMarkdown、Streamdown、Mermaid plugin URL 和新实例目录中的两个生成 Mermaid chunk 均 HTTP 200，证据为 `host-vite-cache-http-proof.json`、`host-vite-cache-mermaid-http-proof.json` 与 `host-vite-cache-mermaid-chunks-proof.json`；metadata 已生成 109 个依赖。基础模块的 HTTP 200 不代替 Mermaid 图形渲染验收；Visual 已原样重跑两个真实 LAN media 用例，`e2e-native-markdown-media-cache-fixed.log` 2/2 通过（1440/390，真实 Mermaid SVG/节点、Math、代码和控件，无 ErrorBoundary/pageerror），两张 PNG 已独立审查。深色箭头对比问题另由 Visual 在主线程授权范围内处理，不混为缓存失败。运行源码和配置在发出统一稳定信号后保持冻结，随后只更新文档。

随后 Visual 完成同版 Mermaid 与 ELK 依赖安装，当前实例自身的再次优化替换了动态 chunk；该现象与不同实例共享缓存是两个原因。依赖固定后仅更新配置文件时间，触发 Vite 自身正常配置重载，正式 PID 与实例缓存目录均保持原值，没有清缓存或手工停止服务。`host-vite-dependency-checkpoint-proof.json` 记录当前 live transform、插件、主 chunk、实际 flowDiagram 动态 import 和两个 Mermaid chunk 均通过 HTTPS 返回 200，URL 的 `v=e3347122` 与 metadata browserHash 一致。已通知 Visual 按原 LAN URL 继续实际图形验收，HTTP 检查本身不代表布局完成。

Visual 随后原样执行 `e2e-native-mermaid-layout-cache-green.log`，1440/390 与深浅色四例全部通过，核验原生节点实际 60px 几何、viewBox、open marker、复制/缩放/重置/实际 SVG 下载、Math 与普通代码块。四张 PNG 已由 Visual 审查，依赖与配置保持冻结。

## 旧输入区回归用例迁移

本轮仅修改 `tests/e2e/session-composer-compact.spec.ts`，没有改产品、通用 fixture 或其他测试。主线程整体回归的 `e2e-final-root-content-v2.log` 中原有七例失败：旧状态/模型选择器、桌面固定高度与所有宽度统一 44px、窄屏身份位于正文下方、全局协作/目标状态等假设已不符合已批准的原生输入区规则。状态改用 native 标记；手机 surface 精确 124px，桌面校验当前内容与工具栏构成的自动高度以及长文增长/内部滚动；附件数量、浮动通知、删除/撤销保持对应基线。身份在实际容器宽度 ≤840 时位于输入框上方，宽桌面仍位于正文下方。320–430 使用真实触控浏览器，768–1440 使用实际 fine-pointer 桌面，保留对应 44px/28px 控件尺寸、文字与边界校验。规划通过该 thread 的 `changeThreadModel` 设置，目标通过捕获的 `activeDraftOwner()` 设置。

队列测试仍使用真实 native 参数，浏览器请求转交独立临时 Fastify 的实际 `registerSessionFollowupRoutes`，未删掉 serviceTier/approvalsReviewer、未伪造成功回执。测试暴露白名单不接收这两个实际参数的问题后，由主线程按 Node 红→绿修复产品；本 Agent 未修改该路由。实际浏览器验证立即引导入口、删除菜单、浮动队列与原始 240px 图片，隔离 queue 的 autoStart=false，没有运行真实 Agent。

首次迁移复测 `host-composer-compact-migration-red.log` 为 6/7，通过后剩余桌面空白 placeholder 高度会随填字缩小，进一步改为精确的填字附件基线。最终 `host-composer-compact-final.log` 为 7/7（45.0s），实际 LAN `https://10.30.0.24:8484`、单 worker、无 skip。保留图片 ≥手机80px/桌面64px 且高60px、直接移除与 Undo、正文与展开草稿不丢失、慢上传/失败/retry 时禁止发送、长文内部滚动、直接工具入口与真实队列；fixture 的运行调用和 pageerror 都为空。已查看手机运行状态、浮动队列和浅色宽桌面截图。该证明是实际 LAN 渲染与隔离服务联调，不代表已完成真实云端模型任务。

## 隔离 WebKit 测试依赖

主线程后续授权补充手机兼容测试环境。当前主机 Ubuntu 24.04 x86_64 的已安装 WebKit2248 实际由 Ubuntu22.04 构建，默认 launch 因 GTK、ICU70、GStreamer、AVIF13 等缺库失败，证据 `host-webkit-launch-red.log`。仅在已忽略的 `.dev-runtime/session-render-alignment/webkit-libs` 提取有限 26 个官方 Ubuntu 包，HTTPS 来源仅 `archive.ubuntu.com`，每个包在提取前核验 SHA256；Noble 文件名/校验值来自现有 APT 索引，ICU70/AVIF13/dav1d5/gav1/Abseil 的 Jammy 旧 ABI 来自官方包下载页。没有将新 ABI 改名为旧 SONAME，没有安装系统包、执行 maintainer scripts、修改产品/依赖清单或重启任何服务。下载合计 18,224,820 字节，提取目录约60MB。

原 MiniBrowser shell wrapper 会覆盖 LD_LIBRARY_PATH，因此新增独立 ignored `launch-webkit.sh` 作为测试显式 executablePath，保留原 bundle 与 sys/lib 后追加隔离库目录，原浏览器缓存不改。`linker-proof.json` 覆盖 GTK/WPE 的全部29个 ELF，缺失库和未定义符号均为0。实际 headless launch/close 成功，`launch-close-proof.json` 为 Linux/WPE WebKit26.0、connected:true、closed:true；不需要跳过 host validation 的环境变量。完整清单、官方URL/校验值和复现命令在该目录的 `manifest.json` 与 `README.md`。

本 Agent 仅启动并关闭新的测试浏览器，没有运行产品 E2E、headed GTK 或视频解码验收；主线程继续使用此 launcher 做实际 LAN 手机兼容回归。Linux WebKit 的测试结果不能称为实体 iPhone/Safari 实测。
