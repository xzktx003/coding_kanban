# Codex 工作台模式

应用保留会话与终端模式，新增独立 Codex 模式。原生 Codex 插件的适配与后续多窗口开发放在 `apps/web/src/codex-mode`，不替换会话模式的 renderer、草稿或 Agent 状态。顶栏共用三模式切换；`?mode=codex` 可以直接进入，本设备保存选择，三个工作区访问后保留挂载状态。

## 实现边界

按官方插件逐项跟踪的功能范围、证据和未闭合项见 [Codex 插件对照清单](codex-plugin-parity.md)。只有隔离真实浏览器操作、截图和对应回归都完成后，矩阵状态才可标为已验收。

未修改的官方 VSIX 由 `packages/native-codex-host` 的独立 code-server 宿主运行。自有伴随扩展默认不自动打开面板。`--auto-open-fixtures` 打开两个隔离 fixture；`--auto-open-new-chats` 打开两份独立原生新聊天面板，后者与 fixture 启动参数互斥。新聊天采用白名单窗口 UUID 的 query URI，避免原插件固定新建 URI 被编辑器去重；输入与发送仍交给原插件。原版插件和伴随扩展单独安装，后续升级官方插件需要重新核对命令、DOM 与协议契约。

Node 网关只从本机环境配置读取上游和 owned0600 运行记录。`GET /api/native-codex/status` 返回可用状态、版本、界面 URL、fixture 标识和不含凭证的 `resumeAvailable`；只有上游与原生伴随扩展 broker 都就绪时才开放 Resume。私有 broker 凭证不进入浏览器。`/native-codex/` 提供同源 HTTP/WebSocket 代理，校验浏览器 Origin 与实际 Host；原生路由使用独立方向限制：浏览器发来的单消息及待发队列各 8 MiB，宿主返回的单消息及浏览器待发缓冲各 2 MiB（上游连接完成后，待发达到 256 KiB 即暂停继续接收；握手期间队列也有 8 MiB 上限），保留终端既有接收限制。此上游无子协议需求，因此带子协议的握手明确拒绝。HTTPS Vite 转发保留 Host 并传递协议。

Codex 页面只展示原生 webview 窗口：自有适配样式隐藏宿主 IDE 外框、按窗口数量铺开。原生 iframe、父节点与 MessagePort 保持原位，既不复制 webview 正文也不修改插件。后台仍加载 IDE 运行框架，因此不承诺它与独立聊天页具有相同内存成本。隐藏模式暂停 DOM 观察器，保留原生 iframe；进入 Codex 模式后只在伴随扩展就绪前以 500ms 间隔有限轮询，最多 120 次；就绪、隐藏或重试会结束／取消该轮询。

Surface 只把父容器仍在视口内的官方 webview 作为窗口，并按屏幕横向位置排序；原生编辑器内部留下的离屏旧 iframe 不会被误计为额外列。就绪观察也监听原位启动遮罩的 class 变化。宿主外壳不接收鼠标事件，选中的原生 iframe 保留交互命中。HTTPS 开发代理向网关转发协议头，使同源校验按浏览器实际 HTTPS scheme 判断。

新聊天同窗恢复读取官方 composer 的 `data-above-composer-conversation-id`，只把两个启动时捕获窗口的 UUID→thread UUID 映射保存在当前浏览器 localStorage。刷新后的初始空 composer 稳定 800ms、无附件且没有用户交互时，前端串行调用同源 `POST /api/native-codex/restore`；后端验证来源、列号和 UUID，并从私有运行记录读取 broker 凭证。伴随扩展只接受捕获窗口对应的原生新聊天标签；先打开 `/local/<threadId>`，再关闭那一个干净新聊天标签。用户开始输入、当前已有 thread、编辑器关闭或标签有 dirty 状态时不替换。没有映射或恢复接口失败时保留原编辑器。

项目导航调用既有会话项目接口取得本机项目，再用当前 Codex 会话服务分页读取各项目的 thread 历史；只展示已校验的本地 Codex 对话，不把子 Agent 或临时项计入会话数。选中一条记录后，`POST /api/native-codex/resume` 只接受精确 thread UUID 和列号，由伴随扩展固定打开该 thread 的原生 custom editor。打开回执成功后，会话 store 与公共输入目标都绑定同一项目、thread 和列。公共 composer 只向该目标发送，不广播；发送由伴随扩展转交给当前官方插件自己的 app-server 连接，使用原生 thread 设置，不经过会话运行层的另一条 writer 实例。为避免官方扩展激活事件先于伴随扩展回调完成，隔离宿主只给 Node extension host 注入私有 `NODE_OPTIONS` preload；它只观察 `chatgpt.conversationEditor` provider 注册，成功捕获后立即恢复 Module loader 与 VS Code API 方法，官方 VSIX 不作修改。伴随扩展按官方版本门控，要求目标标签仍在指定列、thread 项目匹配、原生会话空闲；待处理的 Session 队列、忙碌或未知回执会保留草稿并拒绝发送，不会改道到另一会话。发送回执只保存提交哈希、thread、轮次和状态，不保存正文。队列中断、替换及忙碌轮次中的排队仍需后续扩展。

公共输入只把 `queued`、`sending`、`uncertain` 的 Session 消息视为待处理；队列暂停但没有未决条目时，仍可提交到原生 Codex。

授权连接有两种显式宿主方式。`--connection-profile-home` 把授权登录配置复制到新的私有 HOME，不导入历史；`--shared-codex-home` 为用户授权的 `$CODEX_HOME` 建立私有 overlay，认证配置及会话数据库／历史仍链接到原文件，`ipc`、app-server 控制端点、临时文件、日志和缓存留在隔离宿主。两种方式互斥。共享模式使用相同本机账号和持久历史，同时通过独立 IPC 避免接管用户默认 CLI socket；它不等于复用同一个运行中 app-server 进程。未经用户授权不启用该模式，也不得对真实历史发送测试任务。

## 开发与部署

在被忽略的 `.env` 配置 `NATIVE_CODEX_UPSTREAM_URL` 和 `NATIVE_CODEX_RUNTIME_RECORD`；前者必须是明确的 loopback HTTP 地址，端口匹配运行记录，后者为启动器生成的记录。不可从请求参数选择主机或文件路径。上游、broker 端口和各运行目录全部由启动参数配置。

开发入口继续使用 `pnpm dev` / `pnpm dev:restart`。正式应用中选择 Codex 或打开 `?mode=codex`，不向用户提供裸 IDE 作为入口。当前联调地址：**HTTPS https://10.30.0.24:8484/?mode=codex，端口 8484**；地址属于本机部署记录，不是源码默认值。用户已要求关闭站点密码，此部署显式使用启动器的无认证选项。已有会话运行服务及 Agent 不因原生宿主启动或网关热更新而停止。

## 最小验收与阶段范围

- 模式选择、URL/设备偏好、隐藏工作区保留与焦点恢复由导航红绿灯测试覆盖。
- 代理测试覆盖元数据过滤、路径/端口、跨站请求、HTTP/WS、握手取消、分片大小和子协议拒绝。
- 伴随扩展覆盖显式自动打开、取消、并发锁、监听冲突与监听建立期间关闭。
- Codex 页面覆盖同源 URL、不可用状态、限时就绪轮询与 iframe 保留；surface 测试核对原 iframe/父节点/窗口身份与样式恢复。
- 初版浏览器基线使用隔离 Codex HOME 和两个空 fixture，检查官方登录页、同源资源、窗口尺寸和模式切换；该记录本身不证明真实登录、发送/流式回复、审批、中断、看板窗口组和公共输入。项目 Resume 与单条公共输入的后续真实验收见下方 2026-10-13 记录。云任务继续延期。

运行 `pnpm check`，及 `pnpm --filter web exec vitest run --config vitest.session.config.ts src/codex-mode`、网关与宿主对应测试。真实宿主测试可按 `tests/e2e/native-codex-mode.spec.ts` 的环境开关运行；不得通过恢复正式线程或停止活跃 Agent 代替隔离验收。

## 初版验收记录（2026-10-12）

主分支已部署到上述 HTTPS LAN 入口，站点密码关闭。真实 Chromium 使用当前开发证书的 SPKI 信任配置，未复用用户浏览器、账号或正式线程；实际两份官方登录页在桌面与 390px 视口中可见，宿主菜单已隐藏。两个原 iframe 保持原父节点；自有容器标记解除宿主编辑器的 `clip-path`/overflow 裁剪，清理按共享窗口引用计数恢复，只调整自有属性与样式，不改原 inline 几何。

隔离原生 E2E 已通过双页面、窗口尺寸、30 秒无原生连接关闭、会话/终端切换的 iframe 身份保持与刷新恢复。浏览器与生产构建按顺序执行，避免 shared 编译触发网关热更新干扰稳定性测量；编译不停止会话运行服务或 Agent。源码测试还覆盖实际窗口命中区域，防止只凭 DOM 可见性误判画面可见。

`pnpm check` 与 `pnpm test` 已通过，初次完整测试记录为 3,660 项通过、1 项跳过；后续传输/绘制修复分别通过最新网关 19 项、Codex UI 10 项和独立复审。宿主与适配器共 72 项通过。单独额外运行旧 `app.vscode-web-proxy.test.ts` 仍有一个既有 HTTP/HTTPS 期望不一致，该文件没有改动，也不属于当前 `pnpm test` 的路径范围；没有以删除断言代替通过。

官方安装产物 `out/extension.js` 与本地原包摘要一致：`bc0b44429768ea49c559c6a5524dcd710c500d6193f3bfe62c81cab75c18661c`；官方 VSIX 摘要保持 `c5f534abf7dd1f08330483b5db6754001f2ad452096fc8e63925e597d3761373`。这证明本轮未改该原版宿主代码及 VSIX，不代表跨版本升级已验收。实际发送、流式回复、登录/OAuth、审批、中断、附件、窗口组与公共输入、物理手机及长期内存验收继续保留为后续范围；初版提供独立原生开发入口。

## 真实连接与新聊天宿主

启动器增加显式 `--connection-profile-home <绝对目录>`：仅复用用户已授权的现有登录文件、选定模型及该模型服务配置，写入全新 owned0700 `CODEX_HOME` 中的 owned0600 文件。源文件不写入，不复制历史、IPC、MCP、项目权限或其他模型服务；目标已有内容则拒绝。默认不读取用户登录目录。服务引用的环境变量只向子进程传递，不进入状态或运行记录；禁止覆盖 HOME、PATH、shell 初始化及动态库加载变量。状态只公开是否启用和限定登录类型。

`--auto-open-new-chats` 不预先创建 fixture 线程或发送模型任务。两份新聊天通过自身伴随扩展调用原生 `vscode.openWith`，保留原 custom editor、输入器与原生首次引导。伴随扩展命令只允许已捕获的两份窗口身份；HTTP broker 没有新聊天写接口，原有固定 fixture 白名单保持。站点无密码与 Codex 账号登录分别配置，本部署遵循用户无密码要求。

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
