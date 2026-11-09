# Linux 原版运行与浏览器资源复用验证

本轮已完成官方 Linux 包下载、隔离启动、原始前端的浏览器正反对照及登录状态复用研究。用户随后明确授权方案完成后自行开发并验收，并允许复用已有 ChatGPT 登录和订阅。本文记录的是研究结果，不能替代第四模式的功能验收。

## 固定参考

| 对象 | 身份 |
| --- | --- |
| 官方安装文档 | <https://learn.chatgpt.com/docs/linux/linux-app> |
| 文档直接链接的安装包 | <https://persistent.oaistatic.com/codex-app-prod/linux/deb/latest/chatgpt_amd64.deb> |
| 下载包 | `chatgpt` / `26.1027.51404` / `amd64`，535,323,606 字节 |
| DEB SHA-256 | `46f1e22d028698fe9edaefd5847aece07c4509a30d3709e104220719d8c12822` |
| Linux ASAR SHA-256 | `1588e6a0e1dcfc615060152ef264d4adf2c3ff6bb7496986c72163b5853e2a2e` |
| 用户指定 Mac 参考 | `26.1027.61615` / build `24141`，ASAR `bb88615052255e79b5977885f9a0cc212c268589587c79d4d3b7c4b46e881a95` |

分段下载逐段核对 HTTP 206、固定 ETag 和完整 Content-Range；中断后丢失响应头的五个未完成分段已重新获取。拼接后独立重算整包哈希，`dpkg-deb --extract` 成功。没有在宿主机安装 DEB，也没有执行其维护脚本。APT 元数据访问遇到 403/超时，未完成发布者签名验证；HTTPS、分段和 ASAR 内部完整性不能冒充签名认证。逐成员结果见 [完整包对照](linux-package-comparison.md)。

## 隔离原版基线

基线为 Ubuntu 24.04 x64 Docker 容器，使用独立非 root 用户、只读根文件系统、`cap-drop ALL`、`no-new-privileges`、独立 PID/IPC 命名空间及 tmpfs HOME/工作目录。原应用资源只读挂载，未挂载正式 CLI socket、历史、SSH 目录或工作项目；`--network none` 阻断外网，Xvfb 不监听 TCP。Chromium `--no-sandbox` 仅在这个受限容器中使用，是测试环境差异。

原版 `ChatGPT` 进程正常启动，内置 `codex` app-server 完成 initialize，报告 `0.166.0-alpha.5.1`；显示真实的 `Sign in to ChatGPT` 页面。点击 `Sign in another way` 打开原版 API Key 表单，点击取消返回。未填入 API Key。该结果说明无账号条件下原宿主与 UI 能启动，不说明登录后工作区或实际任务已通过。

CDP 仅通过自有 Docker exec 转发到宿主 loopback 临时端口，未对 LAN 暴露调试协议。应用使用 `app://-/index.html`；当前 REA 的 Electron file-page 和 Inspector target 发现均不接受这个 URL。故运行结果使用直接 CDP/Playwright 记录，不声称完成 REA runtime reconciliation。四个捕获到的原版脚本 source SHA 与对应 Linux ASAR 成员一致，见 [桥接静态证据](bridge-static-evidence.md)。

## 浏览器正反对照

浏览器使用全新上下文、虚拟源 `https://audit.invalid`、禁止 Service Worker/WebSocket 和所有非虚拟源请求。每个响应均从选定 ASAR 原字节读取并核对其声明 SHA-256；不修改官方 HTML、JS 或 CSS。外置研究脚本提供原生同步 getter、一般消息通道，以及 MessageChannel 到隔离原宿主的往返。

| 实验 | 观察结果 | 能支持的结论 |
| --- | --- | --- |
| Linux 原资源、无桥 | 加载 308 个资源；限定观察内正文为空、仍为加载界面 | 普通静态加载未到达交互页；不单凭此证明唯一原因 |
| Linux 原资源、研究双桥 | 加载 349 个资源；440 个 AppHost 帧；登录页、打开 API Key 表单、取消返回均可观察 | 指定无账号流程可通过原版 UI 连接真实 Linux 宿主 |
| Mac 原资源、研究双桥，首次 15 秒窗口 | 308 个资源、66 帧，未到交互页 | 观察窗口不足，不能判定跨版本不兼容 |
| Mac 原资源、扩大窗口 | 349 个资源、440 帧，约 15.24 秒进入登录页，两次手势通过 | 指定 Mac 资源的无账号流程在该 Linux 宿主上可运行 |
| Mac 原资源、补齐一般消息回传 | 349 个资源、460 帧，约 10.29 秒进入登录页；收到真实 `persisted-atom-sync` 等回执，两次手势通过 | 一般状态通道和 AppHost 通道均有可追溯往返；时间是一次研究观察，不能当性能验收 |

研究代理最初错误地只接受 `event.source === window`；原 preload 使用 `new MessageEvent(..., {data})` 回传，source 为 null，导致状态回执被漏收。修正限定接收后，真实持久状态同步到达。这是研究脚本的缺陷及修正，不是原版产品 bug。原版本身存在约 5 秒的状态同步 fallback，可解释其中一段等待，不能解释全部初始化时间。

仍有明确不完整项：`connectGitWorker` 在研究桥中未实现并被拒绝，遥测 `sentry-ipc:` 触发 CSP 错误；未测二进制、流、回调释放、worker 和完整错误路径。观察到启动时的本地持久偏好更新，因此这些探针不是“全程只读”的证明；它们的写入范围是自有隔离应用状态。

## 已授权登录状态研究

在用户明确允许复用已有授权后，另建独立在线容器。只读挂载授权文件并在 tmpfs 内生成应用状态副本，未挂载正式历史、项目或 CLI IPC；在线副本排除 refresh credential，避免在研究副本独立轮换原有刷新凭据。凭据不进入文档、Git 或实验命令参数；消息记录对敏感字段和 JWT 做脱敏。

原版在线主窗口可恢复授权并显示工作台、项目和历史、模型选择等界面。此时还存在空的 `detached-window.html` 和 avatar-overlay 窗口，不能取 CDP 列表首项作为主窗口。主窗口须精确匹配 `app://-/index.html`，附属窗口分别记录。早期取首项得到空正文的结果已保留，不能解释为原版工作台启动失败。

浏览器 Mac 资源的登录后探针尚未通过。首次 20 秒观察记录 47 帧，`threadReadState.open`、`statsig.getStableId` 等待未完成；该次记录已单独保留。自有在线容器触及最初 512 PID 上限，已核对容器身份后将该研究限制调至 1024，内存仍为 4 GiB；这是研究环境调整，不能当作资源验收。随后直接在自有原版 MessagePort 中读取 stable ID 约 14 ms 返回，说明不能把 `primary-runtime-install-progress` 推断为该服务的唯一依赖或失败原因。

随后复验的两个等待均已返回，浏览器加载 582 个原资源、观察 608 帧，但 20 秒末正文仍为空。旧日志把流中 TypedArray 展开为逐数字键，造成约 231 MB 私有记录；这不是合理的长期诊断留存方式。

改为有界协议元数据后，第一轮约 23 秒出现导航，34.3 秒有 61 个按钮及一个可编辑元素；第二轮约 63.1 秒出现可编辑元素，88.1 秒时完成 `settings.read → settings.write('conversationDetailMode','STEPS_COMMANDS') → settings.read`，configured/effective 均为 `STEPS_COMMANDS`，页面固定标签显示 Codex。第二轮读取 1,400 个未修改 Mac 资源，缺失 0；2,447 帧全部实际转发、清理前无待完成帧及转发错误。这证明指定 Mac 资源通过 Linux 原宿主的研究桥能够进入已授权的 Codex 模式可见工作台，**尚未证明输入可发送、历史可只读打开或完整功能可用**。

第二轮仍拒绝 4 次 Git worker 调用，并记录 32 条 console error（31 条 Sentry 相关，1 条资源读取失败）。类型回环确认 Playwright 能保留 Uint8Array、Date、BigInt，但裸 ArrayBuffer/DataView 丢失类型，不能用该研究桥替代完整 structured clone。两轮时间并非可重复的性能指标，也不能把去掉巨大日志认定为全部原因。报告、脚本和有界结果保存在 `evidence/account-browser-bounded/`；不保存账号正文或页面截图。在线原版同时存在账号信息请求的网络/访问错误，完整订阅和账号工作区语义仍需核验。

研究没有执行模型消息发送、审批回复、云任务创建或 SSH 连接。这些能力仍待独立真实验收。在线实例会初始化原版后台服务，后续实验必须继续核对其实际活动和自有资源生命周期。

## 复查材料

原始资料位于被 Git 忽略的私有目录 [Linux 研究证据](../../../.dev-runtime/chatgpt-linux-audit-20261103-7jyjn55e/evidence/)，包括：

- `download-manifest.json`、`container-launch.json`、`container-isolation.json`、`container-processes.txt`。
- `native-snapshot.json`、`native-interaction.json`、`native-runtime-scripts.json` 与对应截图。
- `linux-none-probe.json`、`linux-full-probe.json`、`attempt-1-mac-full-probe.json`、`attempt-2-mac-full-probe.json`、`mac-full-probe.json`。
- `mac-full-account-probe.json` 与 `account-native/`：授权后的研究结果和截图；仅本地私有保存，不提交账号数据。
- `double-bridge-static-report.md`、`linux-daemon-static-report.md`、`fourth-mode-entrypoints.md`。

正式新模式必须以受控、版本固定的协议适配替代 CDP 研究代理，并通过下述开发方案的行为、身份、资源和真实客户端关卡。Linux 原版不能替代指定 Mac 的最终视觉与平台行为验收。
