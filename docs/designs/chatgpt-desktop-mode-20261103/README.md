# ChatGPT 桌面版参考：第四工作模式审计与方案

> **当前状态（2026-11-09）：用户已暂停开发，ChatGPT 模式入口已隐藏。实现代码、`mode=chatgpt` 深链、服务与数据保留；接续条件和验收边界见[暂停进度](paused-progress-20261109.md)。

> 主入口已上线单会话核心体验版：**HTTPS 8484** 已完成原版新建、真实回复与追问。见[8484 使用与验收](main-8484-core-20261106.md)。分屏、文件工具和其他扩展仍在独立候选实施。

> 最新结果：Mac 原版 v4 已完成双线程五轮真实收发及分屏操作，但全新上下文重开又出现 waiting_count 队列满，8515 仍是候选。见 [真实收发与重开阻塞](core-split-usable-20261106.md)。文件工具另受原生沙箱限制，完整交付继续实施。


2026-11-06：接续指定 Harness 会话后，Mac 原资源 version 2 已在新原生实例完成同线程中文两轮真实收发、清稿和切模式保留；入口认证及重开正在验收，见[Mac 本轮记录](mac-core-live-acceptance-20261106.md)。完整一期仍未完成。

最新进度：用户于 2026-11-06 要求接续指定 deepseek-harness 会话。独立 8507 入口已通过官方 Linux 原生界面的真实两轮收发，见[本轮核心交付](core-live-acceptance-20261106.md)；完整中文首轮和追问已逐字节验收，浏览器重新接入已通过。8505 的 Mac 资源首屏队列问题保留，不将 Linux/VNC 结果扩大为 Mac 1:1 完成。[此前交接](handoff-20261105.md)与[AgentTeams profile](agent-teams/README.md)保留历史状态。

状态：暂停前用户曾授权自主开发并允许复用现有 ChatGPT 登录和订阅；2026-11-09 用户要求暂停第四模式开发。历史授权不覆盖这条暂停指令。入口已隐藏，代码和数据保留；尚未证明第四模式全功能或 Mac 1:1 已验收。

暂停前曾并行开发原版 Codex 的项目选择、单次发送与回复。后续恢复时，应先核对源码快照、浏览器入口、宿主资源清单是否同版，再继续真实端到端验收。

## 已确认的目标

1. 长期目标是复刻 ChatGPT 桌面应用；首期以桌面版 Codex 工作区为范围，ChatGPT 普通聊天和 Work 留待后续。
2. 新增第四种模式；现有会话、终端和 Codex 模式在新模式开发期间保持不动。第四模式保留多会话分屏，分屏共用一个公共输入框，输入目标必须明确且唯一。用户表示新模式完成后旧模式会删除；具体删除范围和切换方式待确认，本轮不执行删除。
3. 桌面版 Codex 的云任务和云工作区纳入首期审计及方案。同一主机、账号下，第四模式应与已有 Codex CLI／看板共享真实线程和运行中的任务；切换模式不隐式接管、重启或发送任务。
4. 首期远程 SSH 由看板部署服务器发起，而不是读取访问者 Mac 本机的 SSH 配置。用户表示后续可能使用具备屏幕访问能力的 ChatGPT 桌面端协助开发和原版验收；本次尚未接入 Mac 屏幕或取得实际运行证据。
5. 暂停前的方案要求保留四模式切换顶栏，顶栏以下以桌面版界面为参考；2026-11-09 起 ChatGPT 入口临时隐藏。未来恢复后仍按该方案沿用自由分屏；新模式项目独立，草稿、选中会话和布局独立。真实线程和运行任务仍按第 3 项共享。
6. 优先复用所提供的原版前端资源；目前采用原资源加独立宿主适配的路线，并以分阶段运行关卡控制接入。Mac 实机取证和旧模式最终删除范围仍待确定；不因此阻止已授权的实现，也不提前删除原模式。

## 参考身份与证据边界

- 用户提供的 `third_party/ChatGPT.app`：`CFBundleIdentifier=com.openai.codex`，`CFBundleShortVersionString=26.1027.61615`，`CFBundleVersion=24141`。这是本次固定参考，不将“用户提供的版本”扩大为对官方最新版本的独立保证。
- `Contents/Resources/app.asar` SHA-256：`bb88615052255e79b5977885f9a0cc212c268589587c79d4d3b7c4b46e881a95`。原包是 macOS ARM64；本次执行宿主是 Linux x86_64，未运行原版 Mac 应用。
- 独立按 ASAR 索引重算 22,534 个带声明哈希的成员：22,527 匹配；7 个解包原生文件的大小及哈希均不匹配，包括 SQLite、PTY、Objective-C 与外设相关组件。原因未知，不据此推断损坏、签名原因或恶意；包内声明与实际字节一致也不等于已核验官方签名或来源。完整成员索引及 7 项实际/声明值在被忽略的私有证据目录。与原生文件不一致无直接关联的已核验 JS 成员，仍可作静态证据使用。
- REA 全包分析在客户端等待 300 秒后超时，找回的全包 Evidence 为 **partial/truncated**：17,534 个相关文件中仅 2 个 JavaScript 文件完成 AST 分析。缺项不能视为功能不存在。两个经成员哈希核验的小模块分别完成文件级静态解析，但不代表运行可达：布局 `ev_b4d486c0057c7d55cb2e7d9b10e5eba1cd1db671b315d4adbaac9c95608f55a4`；远程连接配置 `ev_ca51df2b28aec65fd315d48b2b2a2aa26c7be2c34fecb7d293991482d4a2d489`。
- 全包部分 Evidence：`ev_e87282ac95e587953df2412dec1c791886b5c1983900a494c433a875ae7f2aef`；其摘要 `ev_508b85b78b7614449c1f601789ae5bec0240be1c894c3adee4fe639b91a111c1`。导出证据包 SHA-256 `2c722d017d3e3c607a1569ddb2429553c06cca8085dc5d62374fdcc75f48609f`，约 326 MiB，仅保存在下述被忽略的私有目录，不纳入 Git。
- 用户提供一张桌面版截图；窗口缩放、账号门控及点击行为尚未实测。所有原包条目需区分“文案存在”“静态代码分支”“原版实际可达”和“行为／协议实测”。
- 对现有会话模式做过一次隔离浏览器观察：使用独立浏览器存储、全 API fixture，WebSocket 关闭；1728×1000 下验证两个模拟会话窗口及唯一公共输入框。该结果不触达真实 Agent，不是账号、网络、原版 Mac 或生产服务验收。
- 对照时工作区有其他任务的并发修改。事后为两份对照中 80 个可识别源码／文档路径记录了 SHA-256，参考 HEAD 为 `052c8eee23a8e8b8d2d8e53230c2786f372db302`；这不是原子快照，不能保证后算的哈希与每次先前读取完全同时。正式实施和复验须重新核对当时文件。

## 材料索引

- [原版 Codex 的 54 条静态功能候选及字节锚点](original-static-features.md)：覆盖模型权限、输入、历史、Diff、设置、自动化、插件、MCP、远程、云和工具等。独立脚本回读 29 个相关成员、核对 SHA-256，并在声明的零基 UTF-8 字节偏移核实了全部 170 个文字锚点。它们是已找到的候选，**不是原版功能总量，也不是 54 项运行通过**。
- [全包文件名候选领域](unreviewed-candidate-domains.md)：25 个可重叠的检索分类只覆盖 21,395 个 webview 资源中的 5,187 个；其余资源以及 ChatGPT/Work 共享代码仍需判断，文件名不能证明功能可达。
- [原版 UI 与布局静态证据](original-ui-evidence.md)：包含侧栏、项目、输入、侧聊、内容标签和 CSS token。静态尺寸不能代替 macOS 实际计算样式和截图。
- [原版前端无宿主桥的隔离启动探针](original-renderer-probe.md)：无账号、无网络、无 Electron 桥时资源能加载并发出 `connect-app-host`，8 秒内仍停留加载图标；原因和完整复用可行性尚未确定。
- [第四模式执行方案](development-plan.md)：包括已选技术路线、共享执行域、分屏、远程／云、实施依赖和验收门槛；已获自主实施授权。
- [官方 Linux 下载与隔离运行审计](linux-runtime-audit.md)：原版和浏览器的正反对照、授权账号副本、当前未通过的登录后关卡。
- [Mac/Linux 完整包字节对照](linux-package-comparison.md)：固定包身份、全部成员哈希与跨版本的可比范围。
- [双宿主桥的 REA 静态证据](bridge-static-evidence.md)：一般 preload 通道、AppHost RPC 和 Evidence ID；不将静态解析扩大为完整运行证明。
- [实施进度与验收](implementation-progress.md)：已实现模块、红绿测试及未完成关卡。
- [私有宿主与桥接协议](host-and-bridge.md)：固定 profile、正式通道、资源适配、预算和 view/进程生命周期。
- [写前守卫局部减耗](guard-hot-path-20261106.md)：组合源码、固定 pin、既有红绿回归和一次性私有计时边界，真实冷启动效果另行验收。
- [Mac 原版待执行取证清单](mac-reference-checklist.md)：覆盖项目、远程、云、分屏、输入、工具和视觉状态；目前尚未进行 Mac 实测。
- 会话模式逐项对照：[候选 1–27](session-comparison-01-27.md)及[候选 28–54](session-comparison-28-54.md)。两份文件定位当前工作树源码和差异，不能替代新模式或原版 Mac 实测。
- [项目、主机、远程与工作区专项对照](project-remote-comparison.md)：补充 54 条候选以外的产品壳、身份、SSH、多主机、云和分屏结构差异。
- [SSH 远程项目目录选择](ssh-remote-project-picker-20261109.md)：原版 hm21 目录浏览、隔离目录创建和信任交互已实测；项目持久化及远端对话仍未验。
- 完整 ASAR 清单、原生文件差异、REA 证据包、隔离测试脚本和截图位于本地忽略目录 `.dev-runtime/chatgpt-desktop-audit-20261103-kmy767aq/`；其中 `asar-inventory.csv.gz` 和 `unpacked-conflicts.json` 可复核成员与差异，`feature-anchor-validation.json` 保存候选清单的锚点核验结果，`session-source-hashes.json` 保存非原子源码哈希快照。
- [旧版审计身份](../session-render-alignment/evidence.md)曾使用另一个桌面版 ASAR；[174 项客户端审计](../session-render-alignment/codex-client-full-audit-20261029.md)主要针对 VS Code 扩展并当时排除云端。旧文件名、偏移和验收不能直接作为本次 Mac 新包的证据。

## 关键架构事实

- [模式类型和 URL](../../../apps/web/src/lib/workbench-mode.ts)及[工作台容器](../../../apps/web/src/components/WorkbenchShell.tsx)保留第四模式路由；[切换按钮](../../../apps/web/src/components/WorkbenchModeSwitch.tsx)按 2026-11-09 暂停指令只显示三种可见模式。真实宿主和所有任务工作流仍需后续关卡。
- 当前会话模式已有项目树、聊天和分屏；项目记录主要按路径字符串表示（`useWorkspaceStore` 和 `/api/workbench/projects`），不能直接表达多台主机上相同路径的独立项目。终端已有 SSH/SFTP；这些不能自动等同于完整远端结构化会话。
- 原包远程项目代码区分 `hostId`、项目身份和远端路径，UI 也分别呈现 SSH 与设备远程控制；第四模式须给项目、线程、审批、队列、文件和终端建立一致执行域，不能仅增加主机标签。
- 当前 [`CodexCloudService`](../../../apps/server/src/services/codex-cloud.ts)是旧 VSIX 云协议适配器；原包存在新版环境管理和任务分支，但能否复用、真实账号和服务协议是否可用均未验证。
- 原包 `.vite/build/preload.js` 的一般消息通道和 AppHost MessagePort RPC 已分别接入正式私有桥。Mac 原资源在无登录正式链路通过登录页/表单打开和取消；登录后新阶段宿主、共享线程和完整功能仍待验收，不把登录页验证当作完整复用。

实现和修正按执行方案持续推进；验收、依赖及红灯保持可追溯，不将未实测或不可达项目标绿。
