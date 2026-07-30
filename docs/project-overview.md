# Coding Kanban Project Overview

本文档按当前源码梳理仓库功能、模块边界、运行方式和注意事项。历史计划文档只作为背景，本页以 `apps/`、`packages/`、`scripts/` 和 `tests/` 中的实现为准。

## 产品定位

Coding Kanban 是一个面向 CLI Coding Agent 的本地/内网工作台。它把本地 PTY、SSH 远端 PTY、tmux 会话、扫描到的 Agent 工作目录、文件浏览器和 VS Code Web 放在同一个浏览器界面里，核心目标是：

- 同屏观察多个 Agent 会话。
- 快速切换到某个会话继续输入。
- 扫描并接入已有 tmux 或 Agent 工作目录。
- 在聚焦态旁边打开文件系统和 VS Code Web。
- 用一个后端统一处理 PTY、SSH、tmux、文件操作和 WebSocket。

`vibe-kanban/` 不属于本项目实现范围，只能作为参考，除非明确要求不要修改。

## 主要功能

### 会话看板

- 宫格展示所有未隐藏的 `AgentSessionRecord`。
- 卡片显示名称、状态、Agent 类型、主机、工作目录和轻量终端文本预览；受管 tmux 用独立的小号标签表达传输类型，不污染标题。
- 支持按服务器、Agent 类型、tmux 类别、目录关键字筛选。
- 支持创建、重命名和删除会话分组；创建第一个分组后，主页看板与聚焦视图右侧“其他会话”按同一配置分组展示，未指定归属的会话自动进入“未分组”。
- 主页卡片和聚焦侧栏卡片都提供分组选择菜单，可移动到已有分组、移回“未分组”，或新建分组并立即移入；删除分组只解除归属，不删除会话。
- 每个用户分组和“未分组”标题都可独立折叠/展开；折叠时保留名称与卡片计数，主页和聚焦侧栏共享并持久化折叠状态。
- 支持重命名、隐藏、关闭/脱离、终止 tmux、复制 tmux attach 命令。
- 宫格筛选行在卡片上方展示小号“等待输入 / 运行中”统计徽标，位置紧邻已隐藏会话入口。
- 已隐藏会话进入隐藏抽屉，可以恢复或删除。
- 双击卡片进入聚焦视图。
- 默认轻量预览模式下，卡片和聚焦右侧栏显示轻量文本预览；用户可从顶栏切换回完整小终端预览。
- 聚焦视图可以直接输入主终端，并在侧栏保留其它会话上下文。
- 聚焦视图支持单屏、左右双屏、上下双屏、左中右三屏、四屏、六屏、八屏终端监控；多窗格可以同时观察多个真实终端，但输入所有权始终只有一个“输入中”窗格，不做广播输入。
- 聚焦视图支持一键折叠右侧“其他会话”侧栏，方便在主终端和其它会话上下文之间切换。
- 前端交互使用轻量 CSS 动效增强观感：菜单、诊断面板、主机下拉、卡片、抽屉和弹窗只动画 `opacity` 与 `transform`，并通过 `prefers-reduced-motion` 对低运动偏好用户降级。

### 顶栏和快捷入口

- 顶栏分组展示：左侧是“电脑端 Coding Kanban”、会话数量徽标和“手机端 Coding Kanban”切换入口，中间保留新建会话、扫描、文件、VS Code 等高频入口，右侧提供“工具”“资源调节”、全屏和折叠入口。
- 顶栏右侧常驻“终端字号”滑杆，可在 10px 到 24px 之间拖动调整所有内置 xterm 终端字号。
- 手机端页面标题区对应显示“手机端 Coding Kanban”，并提供“电脑端 Coding Kanban”切换入口和 Agent 完成通知开关。
- `扫描` 菜单收纳扫描 tmux 和扫描会话；`工具` 菜单收纳操作提示和 Agent 完成通知开关；`资源调节` 菜单收纳终端预览模式、VS Code 省内存/保持状态、释放 VS Code 缓存和资源诊断。
- 顶栏可折叠；折叠状态保存在 `localStorage` 的 `agent-console-layout`。
- 会话分组配置保存在 `localStorage` 的 `coding-kanban-session-groups-v1`，两处桌面看板视图共享，当前不做跨浏览器同步。
- `资源调节` 菜单提供终端预览模式按钮：`轻量预览：开` 为默认省资源模式，`完整预览` 恢复旧版小终端模式。
- `资源调节` 菜单提供 `资源诊断` 面板，打开时每秒刷新浏览器侧资源指标与后端诊断：xterm/终端视图数量、终端 WebSocket 数、会话快照吞吐、终端实时流吞吐、终端历史缓冲裁剪状态、VS Code iframe 当前/隐藏数量、主线程长任务、VS Code 代理 HTTP/WS 吞吐和 Chromium JS heap；面板会给出当前压力源判读，用于区分完整预览、多终端 WebSocket、快照频率、活跃终端输出、终端 replay 裁剪、隐藏 VS Code iframe、code-server 代理流量和真实 retained-object 泄漏。
- `工具` 菜单中的“操作提示”弹出以下提示：
  - 双击卡片放大
  - `Alt+Q` 返回宫格
  - macOS 为 `⌘+E` 快连 tmux，其它平台为 `Ctrl+E`
  - Tab 切换焦点
- Agent 完成通知使用浏览器 Notification API：用户在桌面工具菜单或手机标题区开启并授权后，前端基于 `/ws/agent-sessions` 快照检测已知会话从 `running` 进入 `idle` 或 `exited`，并发送“任务已经完成，请及时查看”的系统通知；该轻量能力要求页面保持打开，不包含 Web Push 后台推送。
- 额外快捷键：
  - `Ctrl/⌘+E` 打开快速连接 tmux。
  - `Ctrl/⌘+Shift+S` 打开本地 tmux 扫描弹窗。
  - 聚焦视图中，非终端输入元素聚焦时不会抢走快捷键。

### 新建会话

新建会话弹窗支持本地和 SSH 目标：

- Agent 类型：`copilot`、`codex`、`claude`、`shell`。
- 启动方式：
  - direct：直接启动命令。
  - tmux：通过 `tmux new-session` 启动。
- 默认启动方式为受管 `tmux`；`direct` 适合一次性任务，但后端重启后不能恢复原 PTY。
- 名称为空时，前端根据主机、Agent 类型和启动方式自动生成唯一名称。
- 本地会话走 `/api/agent-launch/pty`。
- 远端会话走 `/api/agent-launch/ssh-pty`。
- SSH 目录输入支持目录建议，远端建议依赖免密 SSH 能力。

### 快速连接 tmux

快速连接 tmux 用于快速拉起或接入本机/远端 tmux：

- 主机列表来自 `~/.ssh/config`，并额外提供“本机”虚拟主机。
- 默认命令为 `tmux new-session -A -s <session> -c <dir>`。
- 本机走 `launchPtyAgent`，远端走 `launchSshPtyAgent`。
- 成功后自动进入聚焦视图。

### tmux 扫描和管理

后端 `LocalTmuxAdapter` 支持：

- 本地 tmux 扫描。
- 远端 SSH tmux 扫描。
- 把运行中的 tmux pane 作为可控制 PTY 接入看板。
- 把非运行/观察态 tmux 作为 `remote-tmux-discovered` 记录加入看板。
- 对 tmux 会话执行 refresh、takeover、release、kill。

注意：

- tmux 会话是底层真实进程，`kill` 会杀掉底层 tmux session。
- 对运行中 tmux 的接入会通过 PTY attach，不只是静态观察。
- `transportRef.tmuxSession` 和 `transportRef.tmuxPane` 是 tmux 绑定关系的关键字段。
- tmux 扫描、快速连接和加入看板时，`displayName` 使用真实 tmux session 名；`agentKind`、`workingDirectory`、`sshTarget` 和 `transportRef` 分别承载命令类型、目录、远端主机和 tmux 绑定，不再把这些信息拼成 `tmux:<session> (<command>)` 一类标题。
- `transportRef.runtimeId` 等内部标识可以继续使用 `tmux:` 命名空间，它们不直接作为用户可见标题。状态文件恢复只把可确定为旧版系统生成的标题迁移为真实 session 名，避免覆盖用户自定义标题。

### 扫描已有 Agent 工作目录

目录扫描接口为 `/api/agent-discovery/scan`，由 `scanAgentDirectory` 实现。

能力包括：

- 扫描本地目录。
- 扫描 SSH 远端目录。
- 识别 Copilot session-state。
- 合并匹配到的 tmux pane，减少同一个会话重复出现。
- 扫描结果可以按 direct 或 tmux 模式加入宫格。

### 终端和 WebSocket

聚焦主终端由 xterm.js 渲染，后端通过 `node-pty` 和 WebSocket 驱动。终端预览模式默认使用轻量文本预览，宫格卡片和聚焦右侧栏不创建真实 xterm 实例，也不打开 `/terminal` WebSocket；用户可从顶栏切换到完整预览模式，恢复旧版小终端行为。聚焦视图通过一个 `屏幕布局` 菜单提供单屏、左右双屏、上下双屏、左中右三屏、四屏、六屏和八屏监控布局，用于显式打开最多 8 个实时终端窗格。

聚焦视图右侧列表继续遵循现有分组、折叠、搜索和排序规则，同时显示全部可见会话。受管 tmux 小卡在真实标题后显示低对比度 `tmux` 标签，标签直接由现有 `transportRef.tmuxSession` 派生。已进入大屏布局的会话小卡会显示与窗格一致的编号；当前输入窗格和对应小卡共享黄色高亮。点击带编号小卡只激活已有窗格，点击未编号小卡才替换当前输入窗格。这些关联状态完全由前端 `terminalSlots` 和 `activeSlotId` 派生，不新增后端字段、接口或 WebSocket 事件。

- 终端 WebSocket：`/ws/agent-sessions/:id/terminal`。
- 终端字号由 `terminal-font-size` 本地存储项持久化，默认 14px；滑杆拖动过程中只更新控件显示，鼠标松开、键盘调整结束或失焦提交后才更新已有 `TerminalView` 的 `fontSize` 并触发 fit/resize，不需要重建 WebSocket。
- 会先发送 scrollback replay，再发送 `replay-complete`。
- live PTY replay 上限默认 4 MiB，可通过 `TERMINAL_SCROLLBACK_BYTES` 调整；tmux observe/refresh 默认捕获最近 20000 行，可通过 `TERMINAL_TMUX_CAPTURE_LINES` 调整；registry fallback 默认保留 5000 条，可通过 `TERMINAL_REGISTRY_OUTPUT_ENTRIES` 调整；浏览器 xterm 默认保留 20000 行，可通过 `VITE_TERMINAL_SCROLLBACK_LINES` 调整。
- replay 阶段会缓冲 live frame，避免新输出和历史输出乱序。
- 前端会在 replay complete 后解锁 stdin；8 秒兜底避免永久无法输入。
- 后端会过滤终端自动响应 payload，避免 CPR/设备属性响应被写回真实 PTY。
- 支持 resize 消息和 binary 消息，binary 用于 tmux 鼠标等二进制事件。
- 前端 `TerminalView` 支持 OSC 52 剪贴板写入，允许 tmux copy-mode、SSH 会话或 CLI 工具把当前终端 pane 内复制内容写入浏览器剪贴板；该能力只消费终端输出中的 clipboard target 请求，不改变 stdin、resize 或 tmux 鼠标事件转发。
- 轻量预览模式下，默认只有当前聚焦主终端发送 resize 和 stdin；非活跃区域依赖会话 `outputPreview` 展示轻量文本预览。
- 多终端监控模式会按所选屏幕布局显式挂载 1、2、3、4、6 或 8 个实时 `TerminalView`；所有窗格都能接收后端输出并保持实时观察，但只有当前“输入中”窗格开启 stdin、焦点修复和终端输入所有权，避免广播输入。
- 完整预览模式下，非活跃卡片和右侧栏会恢复只读 `TerminalView`，因此会重新建立终端 WebSocket，适合需要实时小窗预览的场景。
- 前端资源诊断会记录 `/ws/agent-sessions` 全量快照消息速率和大小、`/ws/agent-sessions/:id/terminal` 实时流速率、终端 WebSocket 生命周期、DOM 中的 xterm/预览/监控窗格/VS Code iframe 数量，以及浏览器暴露的 JS heap；同时每秒按需调用 `/api/diagnostics/terminal-history` 和 `/api/diagnostics/vscode-web-proxy` 读取后端终端历史与 VS Code 代理吞吐。诊断只在面板打开时刷新，不保存历史。
- 后端对终端输出导致的全量会话快照做约 1 秒的 trailing 合并广播，降低轻量预览长期运行时的网络流量、浏览器 JSON 解析和 React 更新频率；新建、删除、聚焦、重命名等结构性变化仍通过即时快照刷新。
- 本地 tmux 输入按语义分流：普通文本、快捷键和 bracketed paste 通过有序 `send-keys` 写入；鼠标协议及 `Ctrl+A` / `Ctrl+B` 前缀命令写入 attached tmux client PTY。鼠标或前缀命令成功进入 client 后，路由器会让后续 `send-keys` 以 tmux session 为动态目标，从而跟随 client 当前选中的 pane；连接清理或重建时恢复持久化 pane 绑定。CSI-u 的 `Shift+Enter` / `Ctrl+Enter` 保留原始字节，避免依赖 tmux 版本键名。
- `TerminalView` 开启 xterm 的 `macOptionIsMeta`，因此 macOS Option 与 Windows/Linux Alt 在浏览器能够接收事件时使用相同的 Meta 编码。adapter 在完整 CSI 键序列之后识别 `ESC+Space` 及常用 `ESC+字母/数字`，并原子映射为 tmux `M-*` 键，避免 Codex 把两个分离事件解释为 Escape 和普通输入；Windows 窗口管理器若截获 `Alt+Space`，使用已支持的 `Shift+Enter` 作为换行备用键。
- Safari 的快速文本输入额外经过短时恢复状态机：`TerminalView` 记录已经通过 xterm `onData` 发出的普通文本，并在原生 `insertText` 冒泡时按顺序抵消已发送部分，仅把缺失后缀送入原有 WebSocket 输入链路。状态按 100ms 过期，控制序列会清空状态，IME composition 不参与恢复，避免重复输入或跨按键误匹配。
- 滚轮按终端能力动态路由：当前交互终端启用 xterm mouse tracking 时，普通 wheel 事件放行给 xterm 并经 terminal WebSocket/attached PTY 到达 tmux 当前 pane；按住 `Shift` 时强制浏览本地 xterm scrollback。未启用 mouse tracking 或不具备输入所有权的监控窗格继续只滚动自己的 scrollback，弹层上的 wheel 也不会穿透。

### 应用更新与会话恢复

后端 `AppVersionService` 对配置的 `APP_SOURCE_ROOT` 计算本地 Git 指纹，`GET /api/app-version` 返回 process runtime id、Git branch/head 和 source revision。它只读取本地仓库，不 fetch 远程、不 checkout，也不接受来自 HTTP 的路径或命令参数。tracked `git diff --binary` 直接流入 SHA-256，不把大 diff 缓冲进内存；未跟踪文件使用有界 `FileHandle.read`。并发请求共享同一个进行中的计算，完成后使用短期缓存，避免多个浏览器标签重复启动 Git 扫描。

前端轮询该接口。检测到 revision 变化时展示显式“更新并恢复”按钮，不自动刷新。用户可以关闭提示，浏览器按 source revision 记录关闭状态；同一版本在轮询和 reload 后继续隐藏，新版本会重新显示。点击更新后把 revision 标记为已接受并 reload 一次，避免终端输入中断和重复刷新。恢复成功提示可主动关闭并在 5 秒内自动隐藏，恢复失败提示保持可见。

生产入口使用 `FileSessionStateStore` 把稳定会话目录保存到 `SESSION_STATE_PATH`，默认 `.dev-runtime/agent-sessions.json`：

- 保存稳定 session id、显示信息、工作目录、tmux/SSH 绑定、隐藏状态和标签。
- 不保存 terminal output、进程 PID、runtime id 或密钥内容。
- 后端启动时先恢复离线卡片，再由 `POST /api/agent-sessions/restore-managed` 重新 attach 仍存在的受管 tmux。
- 恢复端点使用 single-flight 协调，多标签页同时请求时只执行一轮 tmux discovery 和 PTY reconnect。
- 缺失的 tmux 只报告失败，不执行旧命令重建；direct 会话保留为手动恢复卡片。
- 状态文件使用原子替换，并按稳定元数据去重写入，终端输出、连接运行态和纯时间戳变化不会持续触发磁盘 I/O；文件不可写时记录错误但不阻断后端启动和会话操作。

浏览器使用 `focus-view-state` 和 `terminal-monitor-workspace-v1` 恢复聚焦视图、布局模式、slot-to-session 分配、当前输入 slot 和主动关闭的 slot。稳定 session id 让这些状态跨后端重启继续有效。`restart-dev.sh` 会在停止旧后端前尝试捕获当前 `/api/agent-sessions`，用于首次升级迁移；迁移脚本在写盘前先投影稳定字段，不会把旧快照中的 terminal output、PTY PID 或 runtime id 写入状态文件。若目标端口上确有本仓库后端而迁移捕获失败，脚本会在任何 kill 前退出；无本仓库监听器或只有外部监听器时跳过迁移捕获。

受管本地 tmux 的 attach/reconnect 和带显式命令的 direct PTY 使用非交互 `/bin/sh` 执行，不加载用户 `zsh/bash` 登录启动文件，避免 shell 初始化钩子抢先启动 Agent TUI；未指定命令的 direct PTY 仍使用用户原生交互 shell。WebSocket 写入者关闭、手动重连、自动恢复、删除或终止会话时，输入清理与既有队列有序执行，取消遗留 tmux 前缀并清除跨帧 bracketed paste 状态；只读预览连接关闭不会清理活跃输入状态。

### 手机端终端控制页

手机端终端控制页是面向手机浏览器的专用终端控制页，不复用桌面分屏和侧栏布局。默认入口为 `/?view=mobile`，并兼容 `/mobile`、`/m` 和 `#/mobile`；这样即使部署入口不支持 SPA history fallback，手机也能通过根页面 query 进入。它复用已有 `AgentSessionRecord`、`/ws/agent-sessions/:id/terminal` 终端输出通道和 `/api/agent-sessions/:id/stdin` 输入通道，不新增后端协议。

- 手机端页面采用单会话全屏终端：顶部显示桌面入口、当前会话状态和会话选择器，中间为 xterm，底部为快捷键条和多行输入框。
- 快捷键条是单行横向滑动选择器，发送真实终端控制字符，支持 `Ctrl+C/D`、`Esc`、`Tab`、`Shift+Tab`、`Enter`、方向键、`Ctrl+L`、`Ctrl+U/W/K/Y/A/O/E` 等 Claude / Copilot CLI 常用焦点切换、面板打开和行编辑快捷键；用户可点击“说明”查看每个快捷键的作用。
- 多行输入框通过普通 `<textarea>` 承载手机输入法，支持“发送”“粘贴”“粘贴执行”，避免依赖 xterm helper textarea 直接唤起软键盘；“发送”和“粘贴执行”会分两帧写入：先 bracketed paste 文本，再单独发送 `Enter`，保证 Copilot、Claude 和 Codex 把内容当作任务提交而不是只停在输入框里。
- 手机端标题区的通知按钮复用桌面 Agent 完成通知状态；手机浏览器支持并授权通知时，页面保持打开即可收到任务完成提醒。
- 页面挂载时会锁定 `html/body/#root` 滚动，并在终端区域用捕获阶段的非 passive `touchstart/touchmove` 接管单指滑动，防止 Codex 长上下文下拉时触发浏览器下拉刷新；触屏设备即使仍停留在桌面聚焦页，也会给真实终端窗格启用同一触控模式。
- 单指滑动滚动 xterm scrollback；双指 pinch 调整终端字号并触发 fit/resize，同步 PTY cols/rows；终端右下角提供“底部”按钮回到最新输出。

### 文件浏览器

聚焦视图中可以打开文件面板：

- 本地和 SSH 远端文件列表。
- 面包屑、返回上级目录、显示隐藏文件、过滤、排序。
- 文件预览，文本文件可编辑保存。
- Markdown 文件默认渲染 GFM 和 KaTeX 数学公式；支持 `$...$` / `\(...\)` 行内公式与 `$$...$$` / `\[...\]` 块级公式。反斜线分隔符只在普通 Markdown 文本中规范化，行内代码、fenced code 和缩进代码保持原样。单击使用文件面板内联预览，双击打开浏览/编辑大窗口。桌面端大窗口可从右下角拖动调整宽高，并受当前视口边界约束；窗口支持预览、源码编辑和实时分屏，保存前显示未保存状态，原始 HTML 不注入页面。
- 新建文件/目录、重命名、删除、chmod。
- 上传、下载。
- 支持拖拽上传。
- 文件面板宽度、预览高度等状态保存在 `localStorage`。

默认本地路径规则：

- 如果设置了 `FILE_BROWSER_DEFAULT_LOCAL_PATH`，优先使用它。
- 否则向上寻找 `pnpm-workspace.yaml`，找到则用仓库根目录。
- 找不到时使用当前进程目录。

### VS Code Web

聚焦本地会话和 SSH 远端会话时都可以打开 VS Code Web 面板。

后端 `VsCodeWebManager` 支持：

- 优先查找 `code-server`，其次 `openvscode-server`。
- 如果未找到 code-server，会尝试自动执行官方 standalone 安装脚本。
- 一个后端进程内复用一个全局 VS Code Web server。
- 本地会话生成稳定的 `.code-workspace` 文件；SSH 远端会话直接打开远端工作目录。
- 用户配置和扩展放在持久目录；扩展目录会优先复用当前用户的 `.vscode-server/extensions`：
  - `~/.local/share/coding-kanban/vscode-web/config.yaml`
  - `~/.local/share/coding-kanban/vscode-web/user-data`
  - `~/.vscode-server/extensions`，若不存在则回退到 `~/.local/share/coding-kanban/vscode-web/extensions`
  - `~/.local/share/coding-kanban/vscode-web/workspaces`
- SSH 远端首版会通过系统 `ssh` 在远端启动/复用 `code-server`，再建立一个本地 `ssh -L` 转发，让当前后端继续把 `/vscode/` 代理到本机回环端口。

注意：

- 旧版本曾把 code-server 配置放到 `/tmp/coding-kanban-vscode-*`，如果看到每次都要重新配置，先检查是否还有旧 code-server 进程。
- VS Code Web 面板左上角只保留重新加载按钮，不再常驻展示 provider/reused 状态标签。
- `reused` 只表示后端进程复用了同一个 VS Code Web server，不等同于浏览器 iframe 缓存。
- 浏览器侧 iframe 默认使用“VS Code 省内存”模式，只保留当前打开的 iframe；“VS Code 保持状态”模式最多保留最近 3 个 iframe。VS Code Web 打开响应使用有界最近缓存，历史会话不会永久累积在页面内存中。
- 顶栏提供“释放 VS Code 缓存”按钮，用于卸载非当前 VS Code iframe，释放浏览器内存；这不会停止后端 code-server 进程。
- 自动超时卸载 VS Code iframe 暂不默认启用，后续可在确认用户体验后作为第二阶段策略。

## 架构和模块

### 顶层目录

```text
apps/web/        React + Vite + xterm.js 前端
apps/server/     Fastify + WebSocket + PTY/SSH/tmux 后端
packages/shared/ 前后端共享 DTO 和类型
tests/e2e/       Playwright 端到端测试
scripts/         本地开发、截图、测试 tmux 辅助脚本
docs/            当前文档、计划、设计说明和截图资源
memories/        仓库记忆，不是产品运行依赖
```

### 共享模型

核心类型在 `packages/shared/src/index.ts`：

- `AgentSessionRecord`：看板主模型。
- `AgentSourceType`：
  - `local`
  - `remote-connect`
  - `remote-tmux-discovered`
- `InteractionState`：
  - `running`
  - `idle`
  - `awaiting_input`
  - `detached`
  - `exited`
- `AgentTransportRef`：保存 terminal、process、tmux、runtime、SSH 等底层引用。
- `SshTarget` / `SshHostPreset`：SSH 目标和从配置解析出的主机。
- `ScanResult`：目录扫描和 tmux 扫描结果。
- `OpenVsCodeWebResponse`：VS Code Web 打开结果。
- 文件浏览器 DTO：`FileEntry`、`ListFilesInput`、`FilePreviewInput` 等。

### 后端服务边界

`apps/server/src/app.ts` 负责组装：

- `AgentSessionRegistry`：内存会话注册表、排序、订阅、状态快照。
- `PtyRuntimeManager`：本地/远端 PTY 生命周期、scrollback、输入、resize。
- `LocalProcessRuntimeManager`：旧的本地进程运行管理。
- `SshRuntimeManager`：远端连接类运行管理。
- `LocalTmuxAdapter`：tmux 发现、详情、输入、接管、释放、杀会话。
- `LocalTmuxInputRouter`：统一 REST/WebSocket 的本地 tmux 输入队列，并区分 pane 输入、鼠标协议和 tmux 前缀命令。
- `AppVersionService`：计算本地 Git source revision 和 backend runtime version。
- `FileSessionStateStore`：校验、投影并原子持久化稳定会话目录。
- `restoreManagedSessions`：分类并恢复仍存在的受管 tmux，会话缺失时保持显式失败边界。
- `LocalFsService`：本地文件系统。
- `SftpService`：远端 SFTP 文件系统。
- `VsCodeWebManager`：code-server/openvscode-server 生命周期。

### 后端 HTTP 和 WebSocket

主要路由：

- `GET /api/health`
- `GET /api/agent-sessions`
- `GET /api/agent-sessions/:id`
- `POST /api/agent-sessions/register`
- `POST /api/agent-sessions/focus`
- `PATCH /api/agent-sessions/:id`
- `DELETE /api/agent-sessions/:id`
- `POST /api/agent-launch/local`
- `POST /api/agent-launch/remote`
- `POST /api/agent-launch/pty`
- `POST /api/agent-launch/ssh-pty`
- `POST /api/agent-sessions/:id/resize`
- `POST /api/agent-sessions/:id/stdin`
- `POST /api/agent-sessions/:id/reconnect`
- `GET /api/app-version`
- `POST /api/agent-sessions/restore-managed`
- `POST /api/agent-discovery/tmux/scan`
- `POST /api/agent-discovery/tmux/add`
- `POST /api/agent-sessions/:id/tmux/kill`
- `POST /api/agent-sessions/:id/tmux/takeover`
- `POST /api/agent-sessions/:id/tmux/release`
- `POST /api/agent-sessions/:id/tmux/refresh`
- `POST /api/agent-discovery/scan`
- `POST /api/agent-sessions/:id/vscode-web`
- `GET /api/ssh-hosts`
- `POST /api/directory-suggestions`
- `POST /api/fs/list`
- `POST /api/fs/preview`
- `POST /api/fs/operation`
- `POST /api/fs/chmod`
- `POST /api/fs/download`
- `POST /api/fs/upload`
- `GET /ws/agent-sessions`
- `GET /ws/agent-sessions/:id/terminal`

### 前端模块

主要组件：

- `App.tsx`：全局状态、会话订阅、路由弹窗、聚焦/宫格切换、侧栏工具状态。
- `AppUpdateBanner.tsx`：源码更新提示、恢复进度和失败结果。
- `TopBar.tsx`：分组顶栏、显示/工具菜单、操作提示、主入口、折叠。
- `AgentGrid.tsx` / `AgentGridCard.tsx`：宫格和卡片。
- `AgentFocusView.tsx`：聚焦终端和会话切换。
- `TerminalView.tsx`：聚焦主终端的 xterm.js、WebSocket、replay、输入所有权。
- `TerminalPreview.tsx`：宫格卡片和聚焦右侧栏的轻量文本预览，不建立终端 WebSocket。
- `resource-diagnostics.ts`：浏览器资源诊断采样、WebSocket 吞吐统计和压力源分类。
- `terminal-font-size.ts`：终端字号范围、持久化和归一化逻辑。
- `terminal-preview-mode.ts`：终端预览模式持久化，默认轻量模式，可切换完整预览。
- `app-update.ts`：已接受 revision 和一次性 reload 恢复意图。
- `terminal-workspace-state.ts`：多屏 slot、输入 slot 和关闭 slot 的版本化持久化。
- `NewSessionDialog.tsx`：新建本地/SSH/direct/tmux 会话。
- `DiscoveryDialog.tsx`、`TmuxDiscoveryPanel.tsx`、`AppDiscoveryPanel.tsx`：扫描和加入宫格。
- `QuickTmuxConnect.tsx`：快速连接 tmux。
- `FileBrowserDrawer.tsx`：文件浏览器。
- `MarkdownFilePreview.tsx` / `MarkdownFileDialog.tsx`：按需加载的安全 Markdown/GFM/KaTeX 渲染、实时编辑、分屏和双击大窗口。
- `VSCodeDrawer.tsx`：VS Code Web iframe 管理。
- `HiddenSessionsDrawer.tsx`：隐藏会话管理。
- `FilterBar.tsx`：筛选条。

前端状态持久化：

- `agent-console-layout`：顶栏折叠状态。
- `file-browser-ui-state`：文件浏览器主/侧面板尺寸和折叠。
- `side-panel-session-state`：每个会话打开的是文件还是 VS Code，以及选中的主机。
- `focus-view-state`：聚焦会话和视图模式。
- `terminal-monitor-workspace-v1`：分屏模式、slot 会话、当前输入 slot 和关闭 slot。
- `coding-kanban-accepted-revision-v1`：浏览器已接受的 source revision。
- `terminal-font-size`：所有内置 xterm 终端共用字号，默认 `14`，范围 `10` 到 `24`。
- `terminal-preview-mode`：终端预览模式，`lightweight` 为默认轻量预览，`full` 为旧版完整小终端预览。
- `vscode-iframe-cache-mode`：VS Code iframe 缓存模式，`memory-saving` 为默认省内存模式，`preserve-state` 为最多保留最近 3 个 iframe 的保持状态模式。
- `file-browser-preview-height`：文件浏览器内部预览高度。

## 启动和访问

### 安装依赖

```bash
pnpm install
```

### 推荐启动

```bash
./scripts/restart-dev.sh
```

该脚本会：

- 清理默认端口监听。
- 启动后端和前端。
- 默认使用 HTTP。
- 写日志到 `.dev-runtime/server.log` 和 `.dev-runtime/web.log`。

常用变量：

```bash
WEB_PORT=8484 SERVER_PORT=4100 ./scripts/restart-dev.sh
WEB_HTTPS=1 WEB_HTTPS_SAN='DNS:localhost,IP:127.0.0.1,IP:10.30.0.22' ./scripts/restart-dev.sh
```

### 手动启动

前端：

```bash
pnpm --dir apps/web dev -- --host 0.0.0.0
```

后端：

```bash
pnpm --dir apps/server dev
```

注意：

- 前端默认端口 8484，后端默认端口 4000。
- 手动启动前端默认是 HTTP，访问 `http://10.30.0.22:8484/`。
- `scripts/restart-dev.sh` 默认也使用 HTTP，地址形如 `http://10.30.0.22:8484/`。
- 如果只启动前端，页面会打开，但 API、WebSocket、tmux、文件浏览器、VS Code Web 都不可用。
- Vite 前端代理 `/api` 到 `http://localhost:4000`，代理 `/ws` 到 `ws://localhost:4000`。

### 健康检查

```bash
curl http://127.0.0.1:4000/api/health
```

预期：

```json
{ "status": "ok" }
```

## 环境变量和配置

### 前端

- `VITE_API_BASE_URL`：覆盖 API 基础地址。默认空字符串，使用同源代理。
- `VITE_DEV_HTTPS=1`：前端 dev server 使用 HTTPS。
- `VITE_DEV_HTTPS_CERT`、`VITE_DEV_HTTPS_KEY`：HTTPS 证书路径。

### 后端

- `HOST`、`PORT`：Fastify 监听地址和端口。
- `TMUX_BINARY`：指定 tmux 二进制路径。
- `SHELL`：本地/远端交互 shell 优先选择。
- `FILE_BROWSER_DEFAULT_LOCAL_PATH`：文件浏览器默认本地目录。
- `VSCODE_WEB_PUBLIC_HOST`：覆盖返回给浏览器的 VS Code Web host。
- `VSCODE_WEB_BIND_HOST`：VS Code Web server 绑定地址，默认 `0.0.0.0`。
- `VSCODE_WEB_EXTENSIONS_DIR`：覆盖 VS Code Web 的扩展目录；默认优先使用 `~/.vscode-server/extensions`。
- `VSCODE_WEB_REMOTE_BIND_HOST`：SSH 远端 code-server 的绑定地址，默认 `127.0.0.1`。
- `VSCODE_WEB_REMOTE_PORT`：SSH 远端 code-server 的固定端口，默认 `13338`。
- `APP_SOURCE_ROOT`：更新检测读取的本地源码根目录，默认仓库根目录。
- `SESSION_STATE_PATH`：稳定会话目录文件，默认 `.dev-runtime/agent-sessions.json`。

### SSH

主机列表从当前用户 `~/.ssh/config` 解析，主要使用：

- `Host`
- `HostName`
- `User`
- `Port`
- `IdentityFile`

远端文件浏览、目录建议、SSH PTY、远端 tmux 都依赖 SSH 客户端可用。

## 数据和持久化

### 后端运行态

会话运行句柄仍在内存中，但稳定目录会写入 `.dev-runtime/agent-sessions.json`。后端重启后：

- 受管 tmux 卡片保持稳定 id，并在底层 tmux 仍存在时自动重新 attach。
- direct 卡片保留元数据并标记为需要手动恢复，原 PTY 不会伪装成仍然存活。
- terminal scrollback 不写入状态文件，持久历史继续由 tmux 负责。

### VS Code Web 持久数据

路径：

```text
~/.local/share/coding-kanban/vscode-web/
├─ config.yaml
├─ user-data/
├─ extensions/
└─ workspaces/
```

如果发现每次打开 VS Code 都像新环境：

1. 检查是否有旧 code-server 进程仍使用 `/tmp/coding-kanban-vscode-*`。
2. 杀掉旧进程。
3. 删除旧 `/tmp/coding-kanban-vscode-*` 目录。
4. 刷新前端，重新打开 VS Code 面板。

### 前端 localStorage

多个 UI 偏好存在浏览器本地。如果布局异常，可清理相关 key：

- `agent-console-layout`
- `file-browser-ui-state`
- `side-panel-session-state`
- `focus-view-state`
- `file-browser-preview-height`
- `agent-completion-notifications`

## 验证命令

根目录：

```bash
pnpm test
pnpm check
pnpm build
pnpm format
```

前端：

```bash
pnpm --dir apps/web test
pnpm --dir apps/web build
pnpm --dir apps/web format
```

后端：

```bash
pnpm --dir apps/server test
pnpm --dir apps/server build
pnpm --dir apps/server format
```

共享类型：

```bash
pnpm --filter @agent-orchestrator/shared build
```

E2E：

```bash
pnpm e2e
PLAYWRIGHT_SKIP_WEBSERVER=1 pnpm exec playwright test tests/e2e/hot-update-session-restore.spec.ts
```

注意：

- Playwright 需要浏览器和系统依赖。当前某些 Linux 环境可能缺 `libatk-1.0.so.0`，会导致 Chromium 无法启动。
- E2E 会启动 server/web，并可能依赖 `.playwright-bin`、tmux 和测试辅助脚本。

## 开发注意事项

### 不要混淆项目范围

- 不要在 `vibe-kanban/` 下新增本项目代码。
- 新功能优先放在 `apps/web`、`apps/server`、`packages/shared`、`docs`、`scripts`。

### 会话是领域模型，transport 是实现细节

UI 和 API 应围绕 `AgentSessionRecord` 工作。不要让 terminal id、tmux pane id、PTY process id 变成主要产品模型。

### 远端和 shell 命令必须谨慎

- 所有路径、主机、命令参数都要避免拼接注入。
- 已有工具中尽量使用 `quoteForPosixShell`、`buildInteractiveShellCommand`、`buildTmuxCommand` 等封装。
- destructive 操作如 kill tmux、delete 文件、关闭运行中会话，UI 必须显式确认。

### tmux 行为

- attach/kill/scan 都可能影响真实用户会话。
- 远端 tmux 操作需要 SSH 可用。
- tmux mouse binary payload 需要走 binary WebSocket 分支，不能当普通 UTF-8 文本处理。

### 终端输入

- 前端会管理 terminal input owner，确保真实 stdin 默认只落到当前聚焦主终端。
- 终端 replay 未完成前默认不解锁 stdin，避免 replay 阶段误输入。
- 后端会过滤设备响应；如果新增终端控制序列，需要补充 `terminal-control-filter` 测试。

### VS Code Web

- code-server 自动安装需要网络访问 `https://code-server.dev/install.sh`。
- code-server 返回 URL 使用请求 host 或 `VSCODE_WEB_PUBLIC_HOST`。
- 启动时会先解析当前用户的 login shell 环境，尽量复用 `PATH`、`SHELL`、`HOME` 和 rc 文件里导出的工具链变量。
- 会在 code-server 的 `user-data/User/settings.json` 里写入 Linux 终端默认 profile，让集成终端继承这份 login 环境，并以 interactive shell 方式启动当前用户 shell。
- 同一份 `settings.json` 会关闭 VS Code Web/EditContext 输入路径，规避浏览器内嵌编辑器中中文 IME 标点提交被吞的问题；本地和 SSH 远端 code-server 启动路径都应用该设置。
- 启动前会清理继承的 `npm_config_*` 变量，避免 `nvm` 因 `npm_config_prefix` 等脚本环境污染而失效。
- 扩展默认复用当前用户的 `~/.vscode-server/extensions`；如果需要单独目录，可设置 `VSCODE_WEB_EXTENSIONS_DIR`。
- 启动时会清理继承的 `VSCODE_IPC_HOOK_CLI`，避免从 VS Code 终端拉起时误连到已有实例。
- SSH 远端模式依赖后端到目标主机的 SSH 本地转发能力，不要求远端额外暴露 HTTP 端口。
- 前端和 code-server 均使用 HTTP 协议，无混合内容限制。

### 文件浏览器

- 本地和远端文件操作共用 UI，但底层分别走 `LocalFsService` 和 `SftpService`。
- 上传限制为 500MB。
- 预览要区分 utf8 和 binary。
- Markdown 渲染使用 `react-markdown`、`remark-gfm`、`remark-math`、`rehype-katex` 和 `katex`；不启用原始 HTML 解析，KaTeX 保持默认非信任模式，外部链接使用新窗口和 `noopener noreferrer`。
- 远端路径和身份要随 `sshTarget` 一起传，避免不同 SSH identity 混用。

### 设计和 UI 约束

- 当前 UI 是工作台，不是营销页。
- 避免嵌套卡片和过度装饰。
- 卡片、弹窗、工具条保持 8px 左右圆角。
- 顶栏菜单可折叠，提示信息集中在“操作提示”按钮中。
- VS Code Web 左上角只保留重新加载按钮；provider/reused 仅作为后端返回字段，不在面板上常驻展示。

## 常见问题

### 前端能打开但没有数据

确认后端是否启动：

```bash
curl http://127.0.0.1:4000/api/health
```

如果失败，启动：

```bash
pnpm --dir apps/server dev
```

### 访问前端没有内容

手动 `pnpm --dir apps/web dev` 默认是 HTTP。应访问：

```text
http://10.30.0.22:8484/
```

如需临时测试 HTTPS，请显式设置 `WEB_HTTPS=1` 或配置 `VITE_DEV_HTTPS`、证书路径。确保后端也已启动。

### VS Code 每次都像重新配置

检查是否还有旧临时 code-server：

```bash
ps -ef | grep code-server | grep coding-kanban-vscode
```

新实现应使用：

```text
~/.local/share/coding-kanban/vscode-web/
```

旧实现可能使用：

```text
/tmp/coding-kanban-vscode-*/
```

### Playwright 无法跑

如果报缺 `libatk-1.0.so.0` 等系统库，需要安装 Playwright 浏览器依赖或在具备依赖的环境运行。

### `pnpm --filter server dev` 没启动

在当前 workspace 中，可靠方式是：

```bash
pnpm --dir apps/server dev
```

同理前端：

```bash
pnpm --dir apps/web dev -- --host 0.0.0.0
```

## 当前限制和后续方向

- direct PTY 无法跨后端进程重启，更新后需要用户显式重新连接。
- 更新检测只覆盖本地工作树和 HEAD，不主动查询远程分支是否有新提交。
- 会话状态文件不保存 terminal output；非 tmux 会话没有持久 scrollback 保证。
- SSH 远端 VS Code Web 当前依赖远端 `code-server` 和后端维持的单实例 SSH 本地转发，不支持更复杂的多实例调度。
- SSH 能力依赖本机 SSH 配置和免密/可用认证。
- Playwright 视觉验证依赖系统浏览器库。
- 远端路径建议和文件浏览器能力依赖 SSH/SFTP 权限。
- Electron 打包仍是 TODO。
