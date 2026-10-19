# Codex 工作台模式

伴随扩展实例标记早于 VS Code 完成原编辑器布局恢复，因此该标记不直接开放打开/聚焦操作。surface 读取原生 `code/didStartWorkbench` 时间点，并监听 PerformanceObserver mark 事件；完成后才发布实例身份，隐藏时停止观察。缺失原生完成标记时保留未就绪状态，不猜测已经恢复；普通性能 API 和记录保持。此屏障计入普通刷新耗时，不能排除后声称两秒达标。

原生打开回执按精确 URI 的当前 tab 组回报列号，不能把 `vscode.openWith` 之前预留的空组列号当成最终位置；恢复时该空组可能已被 VS Code 移除。已有未选中的新聊天聚焦原组，重复身份拒绝操作。此回执只用于定位，不能替代 composer、目标及原生焦点就绪验收。

应用提供会话、终端和独立 Codex 三种模式。Codex 模式使用与会话模式相同的自由分屏：窗口组可左右或上下嵌套，拖标签到边缘分屏，拖分隔线调整比例。每个窗格只显示当前标签对应的原生窗口，每个窗口保留官方插件自己的输入框。手机只显示当前窗口组，并用窗口组菜单切换。原生适配位于 `apps/web/src/codex-mode`，不替换会话模式的 renderer、草稿或 Agent 状态。顶栏的三个模式按钮直接切换；`?mode=codex` 可以直接进入，本设备保存选择，三个工作区访问后保留挂载状态。

## 实现边界

普通刷新与再次进入的 [恢复计划](designs/codex-mode-audit-20261014/refresh-recovery-plan.md) 已执行阶段 0：增加独立、版本/哈希门控的私有连接原型，通过真实匹配 CLI 和原版插件验证连接；页面性能关卡失败，正式入口仍保持现有路径。后台进程保留不等于官方本地页面已恢复，不宣称 10 项 LRU、独立草稿或 2 秒操作已支持。原型与未完成项见 [阶段 0 验收](designs/codex-mode-audit-20261014/refresh-recovery-stage0.md)。

按官方插件逐项跟踪的功能范围、证据和未闭合项见 [Codex 插件对照清单](codex-plugin-parity.md)。只有隔离真实浏览器操作、截图和对应回归都完成后，矩阵状态才可标为已验收。

未修改的官方 VSIX 由 `packages/native-codex-host` 的独立 code-server 宿主运行。自有伴随扩展默认不自动打开面板。`--auto-open-fixtures` 打开两个隔离 fixture；`--auto-open-new-chats` 启动时只打开一份原生新聊天，更多聊天由 `+ 新聊天` 追加。后者与 fixture 启动参数互斥。已有两份启动窗口的旧运行记录仍可恢复。新聊天采用白名单窗口 UUID 的 query URI，避免原插件固定新建 URI 被编辑器去重；输入与发送仍交给原插件。原版插件和伴随扩展单独安装，后续升级官方插件需要重新核对命令、DOM 与协议契约。

Node 网关只从本机环境配置读取上游和 owned0600 运行记录。`GET /api/native-codex/status` 返回可用状态、版本、界面 URL、fixture 标识和不含凭证的 `resumeAvailable`；只有上游与原生伴随扩展 broker 都就绪时才开放 Resume。私有 broker 凭证不进入浏览器。`/native-codex/` 提供同源 HTTP/WebSocket 代理，校验浏览器 Origin 与实际 Host。只有版本哈希路径 `GET /native-codex/stable-<40位十六进制>/static/` 下白名单脚本、样式、字体、图片及 WASM，在 HTTP 200 且 MIME 匹配时可补一年 immutable；拒绝目录穿越、非预期 query、Set-Cookie、按认证变化的 Vary，并保留上游 private/no-store/no-cache。HTML、错误页、接口、WebSocket 和未哈希路径不加入该静态缓存。浏览器只在 sessionStorage 记住上一次校验通过的同源 iframe 路径，状态返回前即可挂载；地址变化会替换，加载失败或服务不可用会丢掉缓存。原生路由使用独立方向限制：浏览器发来的单消息及待发队列各 8 MiB，宿主返回的单消息及浏览器待发缓冲各 2 MiB（上游连接完成后，待发达到 256 KiB 即暂停继续接收；握手期间队列也有 8 MiB 上限），保留终端既有接收限制。此上游无子协议需求，因此带子协议的握手明确拒绝。HTTPS Vite 转发保留 Host 并传递协议。

Codex 左侧项目栏复用会话模式的视觉结构：搜索、可折叠项目和项目下的会话行。它只读取 Codex 自己的项目和 thread 列表；展开、搜索和打开都留在 Codex 模式，不写入会话模式的项目、当前线程或关注标签。删除、归档、重命名和移除项目不在这个侧栏提供。顶栏的太阳/月亮读写会话模式同一份 `kanban.session.theme-storage`。`.session-mode` 与 `.codex-mode` 同时切换 `light`/`dark`，外壳使用同一套默认色板。原生编辑器通过伴随扩展只接受 `light` 或 `dark`，分别设置 `Default Light Modern` 与 `Default Dark Modern`；官方 VSIX 不修改。宿主尚未连接时外壳先变，连接后补发一次。

Codex 页面只展示原生 webview 窗口：自有适配样式隐藏宿主 IDE 外框、按窗口数量铺开。原生 iframe、父节点与 MessagePort 保持原位，既不复制 webview 正文也不修改插件。后台仍加载 IDE 运行框架，因此不承诺它与独立聊天页具有相同内存成本。隐藏模式暂停 DOM 观察器，保留原生 iframe；进入 Codex 模式后只在伴随扩展就绪前以 500ms 间隔有限轮询，最多 120 次；就绪、隐藏或重试会结束／取消该轮询。

Surface 只把父容器仍在视口内的官方 webview 作为窗口，并按屏幕横向位置排序；原生编辑器内部留下的离屏旧 iframe 不会被误计为额外列。就绪观察也监听原位启动遮罩的 class 变化。宿主外壳不接收鼠标事件，选中的原生 iframe 保留交互命中。HTTPS 开发代理向网关转发协议头，使同源校验按浏览器实际 HTTPS scheme 判断。

旧版启动窗口的同窗恢复兼容路径读取官方 composer 的 `data-above-composer-conversation-id`，只把两个启动时捕获窗口的 UUID→thread UUID 映射保存在当前浏览器 localStorage。刷新后的初始空 composer 稳定 800ms、无附件且没有用户交互时，前端串行调用同源 `POST /api/native-codex/restore`；后端验证来源、列号和 UUID，并从私有运行记录读取 broker 凭证。伴随扩展只接受捕获窗口对应的原生新聊天标签；先打开 `/local/<threadId>`，再关闭那一个干净新聊天标签。用户开始输入、当前已有 thread、编辑器关闭或标签有 dirty 状态时不替换。没有映射或恢复接口失败时保留原编辑器。当前多窗口集合优先使用下述 thread UUID 恢复。

项目导航调用既有会话项目接口取得本机项目，再从 Codex 会话服务分页读取各项目的 thread 历史；只展示已校验的本地 Codex 对话，不把子 Agent 或临时项计入会话数。点击一条记录经 `POST /api/native-codex/resume-beside` 打开对应的原生 custom editor；重复点击聚焦已有窗口。`+ 新聊天` 经 `POST /api/native-codex/new-beside` 打开另一份原生编辑器。两条新接口都要求当前浏览器原生宿主的实例 UUID；网关只从 owned0600 的实例记录找到其私有 loopback broker，并把经过 UUID 校验的目标送到该实例。固定 broker 的旧 `/resume`、`/restore` 和版本门控 `/send` 保留兼容，但多窗口界面不使用公共输入或 Session 草稿 store。每个窗口的输入、发送、审批和运行状态由对应官方 webview 处理；关闭工作台标签只移出本设备关注集合，不中断 Agent 或关闭原生标签。窗格标签已经显示会话名、项目和关闭，原生内容就绪后不再覆盖第二条标题或「已就绪」。加载失败仍在窗格内提示并可重试；官方引导和另一实例占用只在角落提示。官方插件自己的标题栏保留。

已有真实 thread UUID 的关注标签由 `GET/POST /api/native-codex/tabs` 在服务实例内跨浏览器、跨设备共享，持久化到 `SESSION_DATA_HOME/codex-followed-threads.json`，不写入会话模式的 `followed-sessions.json`。每个浏览器仍用自己的原生宿主实例按同一 UUID 调用 `resume-beside`；当前选中项、自由分屏树、原生列号和尚未产生 thread UUID 的空白新聊天留在本浏览器 localStorage。另一处关闭正在阅读的标签后，本窗口继续显示并提示「当前会话未关注」。同一 thread 可在多个浏览器同时打开，写入冲突由官方插件处理。旧的本机窗口缓存只由首个连接的浏览器迁移一次。已产生真实 thread UUID 的新聊天会加入共享集合，并以 `/resume-beside` 在其它浏览器打开；空白新聊天才继续用独立 UUID。旧版仅保存启动窗口 UUID→thread UUID 的映射时，`POST /api/native-codex/restore` 仍可按当前可见宿主实例做兼容恢复。原生 iframe、父节点和 MessagePort 不移动；surface 只调整自有样式与观察。实例未识别、窗口未渲染或打开失败时保留局部加载／错误状态与重试入口，其它窗口可继续操作。

最新官方插件的两个空白新聊天资源会在创建时复制已有未发送草稿，尽管它们的 editor URI 和 iframe 独立。因此工作台只在所有未提交的新聊天输入框已加载且为空时允许再点 `+ 新聊天`；否则提示先发送草稿。历史 thread 随时可追加，已形成 thread 的窗口可以并行发送。伴随扩展不修改官方插件的 composer。单独启动的 Codex app-server `thread/start` 虽返回 thread UUID，但零轮次不写 rollout，官方插件打开 `/local/<UUID>` 会报 `no rollout found`；此路径不用于新聊天。

授权连接有两种显式宿主方式。`--connection-profile-home` 把授权登录配置复制到新的私有 HOME，不导入历史；`--shared-codex-home` 为用户授权的 `$CODEX_HOME` 建立私有 overlay，认证配置及会话数据库／历史仍链接到原文件，`ipc`、app-server 控制端点、临时文件、日志和缓存留在隔离宿主。两种方式互斥。共享模式使用相同本机账号和持久历史，同时通过独立 IPC 避免接管用户默认 CLI socket；它不等于复用同一个运行中 app-server 进程。未经用户授权不启用该模式，也不得对真实历史发送测试任务。

## 开发与部署

### 连接检查与 10.30.0.28 部署修复（2026-10-19）

先运行 `pnpm codex:status`。命令复用启动环境，仅核对文件和发送 GET，不启动、停止或发送任务。它比较当前仓库和已安装自有 companion 的四个打包文件内容，忽略安装器添加的 manifest 元数据；即使两边版本号都是 `0.1.0`，也能报告 `stale`。宿主不可达为 `unreachable`，网关仍指向其他项目或启动窗口为 `gateway-mismatch`，插件／私有 broker 未就绪为 `host-ready-awaiting-browser`，激活完成为 `broker-ready`。后者不证明账号、模型请求、浏览器当前窗口或历史恢复成功。公共 `sendAvailable=false` 是旧公共输入桥的版本门控结果，独立 Codex 模式使用官方 composer，不依赖此桥。

本机此前 `.env` 仍指向 10 月 13 日的旧安装。它没有当前前端需要的 `Kanban host <UUID>` 标记、私有实例 broker 和窗口控制接口，导致插件内部已打开而外层一直显示“正在连接”。另一个部署边界是 watcher 已继承的 `NATIVE_CODEX_*` 环境优先于 `.env`：只改文件、触发普通源码热更新，并不能激活这两项新配置。须按当前进程归属安全重载网关启动环境，保留独立会话运行层和 Agent。

此次在全新私有目录部署当前 companion，官方 VSIX 保持不修改，复用已授权的连接副本，不导入历史；新宿主只监听 loopback，由用户级 `coding-kanban-native-codex-20261019.service` 管理。旧宿主与正式 Agent 保留。当前局域网入口为 **HTTPS https://10.30.0.28:8484/?mode=codex，端口 8484**；新浏览器须在官方面板完成 Next 引导。该临时用户服务不保证机器重启后恢复，旧运行记录也不代表服务在线。诊断、真实对话与刷新验收边界见 [本次记录](designs/codex-connection-check-20261019.md)。

在被忽略的 `.env` 配置 `NATIVE_CODEX_UPSTREAM_URL` 和 `NATIVE_CODEX_RUNTIME_RECORD`；前者必须是明确的 loopback HTTP 地址，端口匹配运行记录，后者为启动器生成的记录。不可从请求参数选择主机或文件路径。上游、broker 端口和各运行目录全部由启动参数配置。

开发入口继续使用 `pnpm dev` / `pnpm dev:restart`。正式应用中选择 Codex 或打开 `?mode=codex`，不向用户提供裸 IDE 作为入口。当前联调地址：**HTTPS https://10.30.0.24:8484/?mode=codex，端口 8484**；地址属于本机部署记录，不是源码默认值。用户已要求关闭站点密码，此部署显式使用启动器的无认证选项。已有会话运行服务及 Agent 不因原生宿主启动或网关热更新而停止。

独立原生宿主不随 `pnpm dev:restart` 自动启动。2026-10-13 联调曾把 launcher 留在交互式执行会话中；该会话结束后，`.env` 仍指向已经停止的端口，网关正确返回“Codex 宿主暂不可用”。2026-10-14 为加载更快的会话打开逻辑，已停止 v15 并用全新私有目录启动用户级 `coding-kanban-native-codex-v16.service`，`.env` 指向 `runtime-v16.json`。当前将隔离宿主交给该服务管理；检查需同时覆盖服务进程、loopback 端口、`/api/native-codex/status` 和原生嵌套 webview。重新进入隔离 Chrome 的官方首次引导后，实际显示原生输入框且状态为 `available=true`、`resumeAvailable=true`；[恢复截图](../.dev-runtime/native-multiwindow/host-recovery-v15.png)。这个临时用户级服务只保证当前登录会话中的常驻运行，机器重启后须按宿主 README 用新的私有运行目录重新启动；旧运行记录不能代表仍在线。

## 最小验收与阶段范围

- 模式选择、URL/设备偏好、隐藏工作区保留与焦点恢复由导航红绿灯测试覆盖。
- 代理测试覆盖元数据过滤、路径/端口、跨站请求、HTTP/WS、握手取消、分片大小和子协议拒绝。
- 伴随扩展覆盖显式自动打开、取消、并发锁、监听冲突与监听建立期间关闭。
- Codex 页面覆盖同源 URL、不可用状态、限时就绪轮询与 iframe 保留；surface 测试核对原 iframe/父节点/窗口身份与样式恢复。
- 初版浏览器基线使用隔离 Codex HOME 和两个空 fixture，检查官方登录页、同源资源、窗口尺寸和模式切换；该记录本身不证明真实登录、发送/流式回复、审批、中断、看板窗口组和公共输入。项目 Resume 与单条公共输入的后续真实验收见下方 2026-10-13 记录。云任务继续延期。

运行 `pnpm check`，及 `pnpm --filter web exec vitest run --config vitest.session.config.ts src/codex-mode`、网关与宿主对应测试。真实宿主测试可按 `tests/e2e/native-codex-mode.spec.ts` 的环境开关运行；不得通过恢复正式线程或停止活跃 Agent 代替隔离验收。

## 最新多窗口浏览器验收（2026-10-13）

隔离宿主使用官方 code-server `4.141.0` 和未修改的官方 `openai.chatgpt` Linux x64 `26.51007.21434`；真实 Chrome 经 `https://10.30.0.24:8484/?mode=codex` 操作，复用用户已授权的真实账号与历史，但测试消息只发到一次性项目 `/tmp/ck-multiwindow-v11-20261013/project`。默认一个窗口；在两份空白窗口里先后填入 A、B，切换后两份草稿均保持各自文字。[双草稿截图](../.dev-runtime/native-multiwindow/draft-isolation-v11.png)。有未发送草稿时点击 `+ 新聊天`，窗口数保持为 2 且提示原因；[提示截图](../.dev-runtime/native-multiwindow/draft-guard-v11.png)。

用官方原生发送按钮从 A、B 分别发送独立短任务，两个线程 `01a134f6-cd7e-7442-84ac-4b1a81e2620a`、`01a134fb-9fd6-76f2-9631-5d6ef9e41eb6` 各自完成并在自己的原生窗口显示 `ACK11_A`、`ACK11_B`。发送后 `+ 新聊天` 追加第三窗口，三窗口分屏可见；[桌面截图](../.dev-runtime/native-multiwindow/three-window-v11.png)、[390px 手机截图](../.dev-runtime/native-multiwindow/mobile-v11.png)。源码回归：Codex 前端 52 项、原生宿主与适配器 112 项、原生网关 26 项，`pnpm check` 通过。

刷新后工作台仍显示三个关注窗口，但旧 code-server 扩展宿主在重连宽限期内持有 B 的原生 writer，新的插件实例先显示“在另一个应用中打开”；这是当时尚未闭合的原生恢复边界。确认两条测试任务均已完成后，仅终止这次浏览器测试留下的旧隔离扩展宿主，再点原生 Retry，B 的消息与 `ACK11_B` 恢复；[恢复截图](../.dev-runtime/native-multiwindow/refresh-recovered-b-v11.png)。正式 Agent、会话运行服务和其他宿主未停止。后续显式交接实现与验收见下文；旧实例仍有运行任务时不得自动结束它。

后续修正把默认首窗已发送的 thread 也按精确 UUID 重新打开，并复用宿主中已存在的同一原生编辑器组；若原生内容和输入框已就绪，重复打开请求的冲突不再覆盖就绪状态。源码先红后绿；在全新隔离 code-server `4.141.0`／插件 `26.51007.21434` 宿主中预置上一轮已保存的首窗状态，真实 Chrome 显示 A 的本地 thread `01a134f6-cd7e-7442-84ac-4b1a81e2620a`、原生输入框和 `ACK11_A`，卡片为“已就绪”；[首窗恢复截图](../.dev-runtime/native-multiwindow/default-thread-restore-v12-final.png)。这仍要求旧 writer 已释放，不代表刷新时可以安全中断仍运行的旧宿主。

官方首次引导、登录页和 composer 都算原生界面已出现：没有启动遮罩且存在按钮或输入框时撤掉「正在加载」并显示 iframe。引导阶段卡片写「请完成官方引导」，当前窗口立即可以点击官方按钮；工作台不代点 Next、Back 或 Sign in。根节点观察保持到 composer 出现，不设提前停止。焦点请求失败只在角落提示，不再盖住引导。

打开历史会话时，伴随扩展只等新编辑器组创建完成，不等官方 `openWith` 把整页历史渲染完；渲染继续在后台进行，页面仍以原生内容出现为准。已经位于前台的同一会话再次点击时直接返回，不再重复调用 `openWith`。焦点请求也等到该窗口的原生界面出现后才发送。

旧实例提示只在官方明确显示被其他实例占用、且刷新前实例仍存活时出现。空白引导或普通新聊天不暂停打开，也不提供释放。释放仍须用户点击“释放旧实例并恢复”，经同源 `POST /api/native-codex/release-instance` 发起；刷新交接使用浏览器当前标签的 sessionStorage 记录上一次原生宿主 UUID。网关校验两个不同 UUID、确认当前实例仍活跃，再从私有 0600 实例记录调用旧实例的独立 loopback broker。旧伴随扩展仅在自己的实例 broker 接受请求，回应后向**自身 PID**发送 SIGTERM；固定 broker 与任意命令入口都不能执行释放。用户也可选择保留旧实例继续打开，但原生插件可能要求手动处理 writer 占用。工作台只观察官方 webview 的占用状态，显示“另一实例占用 · 请点原生 Retry”，不改动官方插件或代点按钮。

新版隔离宿主的真实 Chrome 刷新验收使用已完成的 B 会话 `01a134fb-9fd6-76f2-9631-5d6ef9e41eb6`：刷新前原生历史显示 `ACK11_B` 和输入框；刷新后页面显示[显式交接提示](../.dev-runtime/native-multiwindow/refresh-handoff-pending-v14.png)，释放请求携带精确旧/新 UUID，旧扩展宿主 PID `1414473` 实测退出。新实例显示同一原生 thread、`ACK11_B` 和可交互输入框，持续 3 秒后未出现 writer 占用或页面错误；[恢复截图](../.dev-runtime/native-multiwindow/refresh-handoff-recovered-v14.png)。这一证据证明**用户显式释放后的刷新恢复**，不证明有正在运行任务时无损迁移；关闭显示标签仍不结束 Agent。原生插件偶发延迟显示占用时，用户可在原生界面点击 Retry，工作台状态不会把占用误报为“已就绪”。

同一 LAN HTTPS 页面在 390px Chrome 视口下刷新后，[交接提示和两个按钮](../.dev-runtime/native-multiwindow/mobile-handoff-pending-v14.png)均位于屏幕内，文档宽度保持 390px；点击释放后提示消失，保留一个原生窗口，页面无 JS 错误。该手机用例使用空白新聊天，未发送模型任务。

## 初版验收记录（2026-10-12）

主分支已部署到上述 HTTPS LAN 入口，站点密码关闭。真实 Chromium 使用当前开发证书的 SPKI 信任配置，未复用用户浏览器、账号或正式线程；实际两份官方登录页在桌面与 390px 视口中可见，宿主菜单已隐藏。两个原 iframe 保持原父节点；自有容器标记解除宿主编辑器的 `clip-path`/overflow 裁剪，清理按共享窗口引用计数恢复，只调整自有属性与样式，不改原 inline 几何。

隔离原生 E2E 已通过双页面、窗口尺寸、30 秒无原生连接关闭、会话/终端切换的 iframe 身份保持与刷新恢复。浏览器与生产构建按顺序执行，避免 shared 编译触发网关热更新干扰稳定性测量；编译不停止会话运行服务或 Agent。源码测试还覆盖实际窗口命中区域，防止只凭 DOM 可见性误判画面可见。

`pnpm check` 与 `pnpm test` 已通过，初次完整测试记录为 3,660 项通过、1 项跳过；后续传输/绘制修复分别通过最新网关 19 项、Codex UI 10 项和独立复审。宿主与适配器共 72 项通过。单独额外运行旧 `app.vscode-web-proxy.test.ts` 仍有一个既有 HTTP/HTTPS 期望不一致，该文件没有改动，也不属于当前 `pnpm test` 的路径范围；没有以删除断言代替通过。

官方安装产物 `out/extension.js` 与本地原包摘要一致：`bc0b44429768ea49c559c6a5524dcd710c500d6193f3bfe62c81cab75c18661c`；官方 VSIX 摘要保持 `c5f534abf7dd1f08330483b5db6754001f2ad452096fc8e63925e597d3761373`。这证明本轮未改该原版宿主代码及 VSIX，不代表跨版本升级已验收。实际发送、流式回复、登录/OAuth、审批、中断、附件、窗口组与公共输入、物理手机及长期内存验收继续保留为后续范围；初版提供独立原生开发入口。

## 真实连接与新聊天宿主

启动器增加显式 `--connection-profile-home <绝对目录>`：仅复用用户已授权的现有登录文件、选定模型及该模型服务配置，写入全新 owned0700 `CODEX_HOME` 中的 owned0600 文件。源文件不写入，不复制历史、IPC、MCP、项目权限或其他模型服务；目标已有内容则拒绝。默认不读取用户登录目录。服务引用的环境变量只向子进程传递，不进入状态或运行记录；禁止覆盖 HOME、PATH、shell 初始化及动态库加载变量。状态只公开是否启用和限定登录类型。

`--auto-open-new-chats` 不预先创建 fixture 线程或发送模型任务。启动时只捕获并打开一份新聊天，通过自身伴随扩展调用原生 `vscode.openWith`，保留原 custom editor、输入器与原生首次引导。`+ 新聊天` 仍可追加独立窗口。伴随扩展命令只允许已捕获的一或两份窗口身份；HTTP broker 没有新聊天写接口，原有固定 fixture 白名单保持。站点无密码与 Codex 账号登录分别配置，本部署遵循用户无密码要求。

连接导入、服务环境变量隔离、新聊天 URI／互斥／取消与启动器私有记录已有红绿灯回归；两份原生已登录 onboarding 与输入框已在隔离宿主实际显示。真实模型轮次、流式、中断及刷新历史的验收结果单独记录，不能以输入框或预先创建线程替代回复证据。

## 真实聊天链路验收（2026-10-12）

入口继续为 **HTTPS https://10.30.0.24:8484/?mode=codex，端口 8484**，站点密码关闭，主分支源码部署。使用当前已授权 ChatGPT 连接的私有副本及空隔离项目；源登录文件与导入副本字节比较一致，正式会话运行服务保持存活。官方扩展 26.51002.51308 的安装文件摘要仍与原包一致；实际原生会话元数据为 `source=vscode`、CLI `0.162.0-alpha.2`、模型 `gpt-6.1-sol`。实际轮次权限是 `workspace-write / on-request`，不从 fixture 权限推断；测试提示明确禁用工具、命令、文件及网络请求。

| 项目           | 实测结果                                                                                                                                            |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 原生发送／回复 | A、B 各经官方输入器发送唯一标记，助手显示完整回复；私有 JSONL 中同线程、同轮次有 `task_started` 与 `task_complete`                                  |
| 窗口隔离       | A 首轮期间 B 未发送草稿不变；B 流式与中断期间 A 草稿不变，两个实际 thread UUID 不同                                                                 |
| 流式           | B 在原生 Stop 可见时采到多个不同、持续增长的助手正文快照；没有以用户提示中的标记作为回复证据                                                        |
| 中断／继续     | 原生 Stop 点击后记录实际 `turn_aborted`；同一 B 线程的后续原生发送再次 `task_complete`                                                              |
| 模式切换       | 会话、终端往返后外层原生 iframe 身份与 A 未发送草稿保持，不重建插件或停止 Agent                                                                     |
| 历史           | 刷新后通过原生历史入口打开 A/B 的 `/local/<threadId>` 资源，按原生 assistant role 与 conversation/turn 元数据恢复实际回复；读取前后用户发送数量一致 |
| 主题绘制       | 原生 webview 为浅色黑字／透明底，自有 surface 显示 workbench 根背景 `rgb(243,243,243)`，所有 IDE 后代继续隐藏；实际截图文字清晰                     |

验收用 A 线程 `01a12ded-adf7-7f51-8bb2-cc78e3a1c3b3`，B 线程 `01a12df1-e577-7d83-8fd7-d210fd1d4ea5`。这些为隔离测试身份，不能作为正式会话的权限白名单或源码默认值。私有原始证据位于被忽略的 `.dev-runtime/native-chat/`，不提交登录文件、浏览器状态或原始账户日志。

历史恢复与自动同窗恢复分开记录：首发只改变插件内部路由，新建 custom editor 的资源地址仍为 `/extension/panel/new?...`，原先刷新会回新聊天。现在前端身份映射、网关路由和精确标签替换已实现并通过专项回归；**真实登录 Webview 的首发后刷新恢复尚未行为验收**。本轮私有授权宿主停在空白编辑器，因此没有发送真实测试消息，也未把该项标记为已验收。旧 code-server extension host 在重连宽限期内仍可能持有线程，原生历史页会显示“在另一个应用中打开”；等待其正常释放后，原生历史读取已成功。未强行接管、关闭正式 Agent 或缩短保留期。

本轮通过 `pnpm check`，原生宿主／只读适配器 97 项及 Codex UI 10 项；最后绘制调整是自有限定样式，UI 10 项复测通过。真实首次 OAuth 登录流程、审批／附件、多窗口组／公共输入、跨版本升级与长期内存仍不在本轮聊天链路通过范围，云任务继续延期。

## 项目历史导航与公共输入绑定（2026-10-13）

Codex 模式项目导航复用会话模式的项目索引，并通过会话服务读取本地 Codex thread 历史及分页会话数。点击一条对话会把精确 UUID 和所选列提交给原生伴随扩展；打开回执成功后，会话模式 store 与公共输入目标选择同一项目、thread 和列。公共 composer 通过同源 gateway 将消息送入官方插件自己的 app-server 连接；原生标签、thread UUID、列号和项目路径必须逐一匹配，插件版本不受支持或会话忙碌时保留草稿并明确失败。它不回退到 Session runtime，也不广播。

宿主的 `--shared-codex-home` 在独立的私有 `CODEX_HOME` 建立授权 HOME 的链接视图。授权文件与 thread 数据库、WAL/SHM、thread history、sessions 和 writer locks 链接到原文件；`ipc`、app-server control/daemon、`HOME`、XDG、临时目录、日志及缓存隔离在本次宿主目录。它共享本机账号和落盘历史，但不接管默认 CLI IPC，也不复用同一个运行中 app-server 进程。此路径仅在用户明确授权时使用。

红绿灯覆盖项目/线程过滤与分页、精确 thread/列、broker 就绪门控、composer 目标可见、精确原生投递、重复提交回执、extension-host preload 捕获和共享文件链接边界。隔离浏览器曾在两列打开两条真实历史；Session runtime 对该原生拥有的 thread 返回 `SESSION_OWNED_ELSEWHERE`，因此公共输入改由官方插件 app-server 处理。新的 companion、gateway、web、preload 和 UI 单测已通过。

2026-10-13 的真实浏览器验收使用一次性项目和专用测试 thread，没有触碰正式 thread。项目导航显示该项目 1 个会话；Resume 最终返回 HTTP 202，broker 与可见原生编辑器均确认同一 thread 位于第 1 列。公共 Session composer 显示相同 thread、项目目录和“Codex 窗口 1”；唯一获准的测试提交返回 HTTP 202，原生历史有两轮已完成 user/assistant，第二轮助手正文精确为 `WORKBENCH_FOLLOWUP_OK_20261013`。第 2 列仍是原来的空新聊天。可复核截图位于被忽略的 `.dev-runtime/native-chat/codex-project-resume-20261013.png` 与 `.dev-runtime/native-chat/codex-public-composer-20261013.png`。验收后使用原生界面归档测试 thread、移除临时项目登记并清空目标；项目列表恢复为 7 项。

此证据只覆盖单项目、单列、单条空闲 thread 的发送闭环，不代表忙碌轮次 queue/steer/replace、多窗口组同步、附件双向同步、重复提交实浏览器场景、正式部署刷新或全部插件能力已闭合。

宿主用户直接运行全量 `pnpm test` 时，会话运行层 187 项中 186 项通过，文件监听用例因主机 `EMFILE: too many open files, watch` 失败；单独以并发 1 重跑该文件仍复现。随后在无网络隔离的 rootful Docker 中，用只读源码挂载、隔离 HOME、遮蔽本机 `.env` 与 `.dev-runtime`、单独临时构建/Vite 缓存目录，并将 workspace 并行度设为 1，完整 `pnpm test` 以 exit 0 通过；末段脚本测试 120 项全通过。没有停止其他服务、改系统限额或放宽断言。最终记录保留两种环境结果：完整套件已在隔离环境通过，宿主用户 watcher 配额仍会阻塞其直接运行。

## 刷新恢复的隔离进度（2026-10-15）

显式 profile 新增可见页面保护连接，按当前宿主实例和完整 native 运行身份登记，只上报可见 thread UUID，目录由原生元数据确定。硬刷新断连保留短暂保护，新标签独立，隐藏释放自身消费者；真实 native 11→10、可见保护与冷恢复已有回归，自有通道的 iPhone 16 浏览器平台检查也已通过。独立持久管理进程现可显式接入已有 native，网关关闭不清空中央租约/池；默认入口仍未启用，完整 CLI 授权、自动 profile/资源注册及官方 UI/两秒验收尚未完成。见 [可见保护设计](designs/codex-mode-audit-20261014/refresh-visibility-control.md)及[独立管理进程](designs/codex-mode-audit-20261014/refresh-control-process.md)。

原生首次发送的 thread 发现、启动列竞争与引导遮挡已补充行为回归；Codex 外壳的布局、启动 thread 映射、项目和侧栏宽度使用标签内视图快照，设备存储仅作为新标签初始模板。关注成员同步沿用原契约。该变化不接管官方 composer 的草稿。

`packages/native-codex-host/refresh-prototype` 的私有常驻进程、版本门控独立连接、原生资源探测与 LRU 已有真实原生测试。它们没有接入默认 launcher、网关或正式宿主；已有安装的 companion 也不会随源码测试被替换。创建管理进程退出不结束 native turn；旧代次/PID、已有记录和端点均拒绝隐式接管。配置、组件 API 及测试见 [组件说明](../packages/native-codex-host/refresh-prototype/README.md)。

两秒性能、官方多端草稿、profile、长历史和长期 RSS 关卡仍未通过或未完成。三页草稿试验的失败与后续页面恢复失败分别保留，不改写为多端已支持；在线配置/认证/状态/历史/RPC 不进入静态缓存。详见 [持续进度与证据边界](designs/codex-mode-audit-20261014/refresh-recovery-progress-20261015.md)。

刷新候选的显式 profile 路由已经接入前端和隔离宿主。`nativeClient=<UUID>` 只选择服务端预先注册的宿主，所有原生操作与发送经对应 API；关注集合仍使用公共 journal。缓存地址必须属于同一 profile 的精确入口，布局模板、启动映射与旧实例身份也按 profile 保存；无效或重复选择器拒绝请求，不切回默认宿主。此路径不自动创建 profile，不改变官方 VSIX 或 MessagePort，也未完成两秒/真实多端验收。启动参数、断连宽限期和边界见 [显式隔离启动](../packages/native-codex-host/refresh-prototype/README.md#explicit-private-host-and-client-routing)。

后续隔离试验确认同源不同路径仍共用 code-server 默认 profile 的原生浏览器存储。新增显式独立源监听器，复用同一自有前端 HTTP/2、请求与 WS handler；不增加服务器浏览器或修改官方 bundle。一个 code-server、同一 native thread、三页独立源的已有会话草稿已保持完整输入并分别刷新保留，三个官方 Send 均取得精确原生轮次回执且历史各出现一次；390 px 页只算模拟。刷新到接受仍为 14.627–16.147 秒，批次保留请求失败，完整验收未通过。持久源分配、防端口复用串扰及整体资源准入仍待实现。

用户随后确认以 iPhone 16 尺寸模拟替代实机：393×852/DPR 3、触控及缩小视口已在原生页面验证，系统键盘边界单列。打开回执、错误与超时按宿主实例和数字页面代次校验，实例变化或同实例 iframe 重载清理旧恢复标记；当前选中目标的有效回执才重试焦点，后台打开不抢焦点。等待不保留旧 iframe 文档。相关红绿灯通过后，已有 thread 的三页草稿/官方发送回归保持；后续时间点确认原布局恢复会覆盖早期新聊天打开；以原生 workbench 完成事件门控实例、完成命令后读取精确注册列，已在两个桌面标签与 iPhone 16 尺寸页通过 9 项每端单个空白新聊天的独立草稿及刷新检查。既有同浏览器未发送新聊天限制保持，两秒关卡继续失败，见持续进度。

原生聊天输入现在等待当前宿主实例、窗口及目标的焦点回执，过期回执不能开放另一目标，后台窗格就绪也不再重新聚焦当前输入；无 composer 的官方引导与 Retry 仍可点击。保温管理器收到无 thread ID 的账号变化后停止报告热就绪，阻止迟到协议写入和资源读取后的成功返回，仅关闭自己的连接，不释放或停止原生任务。初始账号身份绑定与全部桥接的授权控制仍未完成。

原生快照现在重新核对当前 iframe 的文档，文档读取失败同步撤销旧 ready/thread，恢复后同一 UUID 可再次发布。一次透明预渲染实验虽缩短诊断时间，但 CSS inert 对已有焦点不能阻止全部原生键盘事件，候选已撤回；产品仍按原隐藏方式工作，不拦截官方输入事件。隔离原生连接仍有实际 2 MiB 大消息兼容失败，关闭清理和有界错误元数据已补回归，不能据此宣布兼容或两秒验收通过。


原生内容观察在 portal 的 UUID 与当前历史请求精确相符时直接更新临时身份，不依赖外层 workbench 的另一次 DOM 变化。portal 已就绪后保留最多 64 层直接父链的 childList 观察，支持整体替换；不观察兄弟聊天正文的子树、属性或字符流。原有 30 秒占用观察独立保留，不能用其掩盖之后的结构恢复；暂停、文档更换和异常时释放所有观察及父链引用。此规则只观察官方 DOM，不替换输入、通道或 native API。

## 常驻宿主恢复（2026-10-19）

本节为 `10.30.0.22` 的部署记录；`10.30.0.28` 的旧 companion 问题与连接副本验收见上文，两个主机的运行记录、授权方式和 PID 不可互用。

本机故障现场的 `/api/native-codex/status` 返回 `available:false`、原因“Codex 宿主暂未配置”；网关 `.env` 缺少 upstream 和 runtime record，且没有对应宿主或用户服务。先前其他主机的临时实验记录不能作为当前部署。此处为本机连接失败的已确认原因，与会话模式运行层是否健康无关。

新增维护入口 `packages/native-codex-host/service.mjs`，由显式服务管理器运行；配置校验、每次启动的新私有目录和子进程归属继续复用原 launcher。只有本次 launcher 记录与端口匹配、loopback `/healthz` 成功后，才原子替换 owned `0600` 固定记录；启动失败保留上一份记录，不寻找或终止其他进程。普通开发启动不隐式开启宿主、账号导入或实验刷新原型。私有配置与部署流程见 [Managed native host](../packages/native-codex-host/README.md#managed-native-host)。

本机已启用独立用户服务，并在被忽略的 `.env` 配置同源网关 upstream／固定记录。用户明确授权复用本机账号和历史后，使用 `sharedCodexHome` 链接视图；连接、IPC、临时文件、编辑器数据保持独立。原 Session 运行服务 PID `1970238` 在部署前后不变，新编译产物未替换活跃 Agent。

另一个经真实 HTTP 回归复现的问题是 broker 响应超限后仅 `response.destroy()`，Node 可能只触发 `aborted/close` 而没有 `end/error`，导致状态或操作 Promise 永不结束。四类读取现于超限时立即收敛，并处理异常关闭；保留既有响应预算、实例匹配及授权检查。此缺陷独立复现，不冒充本机最初缺少宿主配置的现场原因。

### 本轮验证

- `pnpm check`：共享包、会话运行层、网关与 Web 类型检查／生产构建通过；构建不激活新运行层。
- 宿主／常驻入口 35 项、网关响应／路由／可见保护 51 项测试通过。超限读取的失败回归先红后绿。
- 实际 Chromium 从局域网 **HTTPS `https://10.30.0.22:8484/?mode=codex`，端口 8484** 打开官方 `26.51007.21434` 界面，识别授权账号。完成官方引导后，原生输入框真实点击、键盘输入成功并清空；刷新重新连接后、393×852 窄屏下分别复验输入，页面错误为零。
- 浏览器验收仅将关注集合替换为空，并阻止恢复、发送、释放实例等写接口，防止诊断操作触及真实对话。宿主代理、WebSocket 与官方界面为实际部署；测试草稿未发送，没有据此宣称模型回复、历史写入占用迁移或物理手机验收通过。私有截图及结果保留于忽略的 `.dev-runtime/native-codex/`。
- 官方原始 VSIX SHA-256 为 `75cee7497cf38c721cfeaa7383b579537b4e4439086f996258705de5da03ad56`；缓存归档需保留内容并使用 `.vsix` 后缀，避免 code-server 将无后缀路径当作扩展标识。未修改官方包。

当前官方版本的旧公共发送桥仍按原规则禁用，`sendAvailable:false` 不代表各窗口的官方输入框失效。本轮未启用刷新实验，也未放宽已知的 WebSocket 大消息预算或承诺两秒恢复。

已知限制：官方四页引导在本次刷新后重复出现，重新完成后输入正常。另以持久 Chromium profile 专项核对同源 IndexedDB，仅读取 `openai.chatgpt` 中精确的引导布尔标志；完成后与刷新后 `viewed2025-09-15-nux` 均为 `true`，排除未落盘。官方源码的引导判断把初始化读取失败／缺值按未完成处理，进入引导后不会因稍后恢复为已完成而自动退出；这能够解释现象，尚未捕获具体失败 RPC，不能断言已查明那次读取的原因。此为保留的官方初始化兼容问题，没有通过补写标志、自动点击或修改官方 VSIX 掩盖；不表示账号或历史被清空。
