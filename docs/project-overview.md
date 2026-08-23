# Coding Kanban Project Overview

本文档按当前源码梳理仓库功能、模块边界、运行方式和注意事项。历史计划文档只作为背景，本页以 `apps/`、`packages/`、`scripts/` 和 `tests/` 中的实现为准。

## 产品定位

变更审查将“Codex 本次任务记录的文件操作”和“当前 checkout 的 Git 工作区状态”建模为两种独立数据产品。两者只共享 Diff 文件/行的视觉渲染，不共享归因、统计和缓存语义；任务记录无法可靠归因时显示不可用，禁止把当前 `git diff` 冒充 Codex 改动。本次任务视图复用完整记录的 tmux 进程定位能力，把当前卡片解析到精确 Codex session，并以最新 `task_started.turn_id` 为边界直接映射该轮 `item_completed/FileChange`；旧版 JSONL 仍按最后一条用户消息之后的 `apply_patch` 兼容读取。变更入口默认展示更完整的当前工作区，其中包含 tracked 修改/新增/删除以及未被忽略的 untracked 新文件；手机端使用紧凑下拉框选择变更文件，避免完整文件列表挤占 Diff 空间；桌面和手机的文件内容均可进入挂载于应用级 Portal 的独立全屏 Diff，避免被顶栏层叠上下文遮挡，并支持退出和复制路径。当前工作区额外提供带不可撤销确认的逐改动块还原：客户端只提交相对路径、块序号和块头，后端从已注册本机会话的当前实时 diff 重新定位并构造反向补丁，过期块会被拒绝；目标块在 index/worktree 中的对应内容会一起撤销，同文件其他改动和已完成的重命名保持不变，新增或 untracked 文件的唯一改动块还原后可能删除文件。远端会话和“本次任务”历史视图不执行 Git 写操作。

Coding Kanban 是一个面向 CLI Coding Agent 的本地/内网工作台。它把本地 PTY、SSH 远端 PTY、tmux 会话、扫描到的 Agent 工作目录、文件浏览器和 VS Code Web 放在同一个浏览器界面里，核心目标是：

- 同屏观察多个 Agent 会话。
- 快速切换到某个会话继续输入。
- 扫描并接入已有 tmux 或 Agent 工作目录。
- 在聚焦态旁边打开文件系统和 VS Code Web。
- 用一个后端统一处理 PTY、SSH、tmux、文件操作和 WebSocket。

`vibe-kanban/` 不属于本项目实现范围，只能作为参考，除非明确要求不要修改。

## 主要功能

### 会话看板

- 主页状态看板展示所有未隐藏的 `AgentSessionRecord`，按“需响应 / 执行中 / 待验收 / 可继续”四列组织并显示各列数量。明确等待回答、权限或确认的 `awaiting_input` → 需响应；`running` → 执行中；`idle` / `exited` 在完成结果尚未查看时 → 待验收，查看后 → 可继续；`detached` → 可继续。查看需响应会话只打开上下文，不改变其等待输入状态；新输入或会话恢复运行会清除完成待验收标记并回到执行中。
- `AgentSessionRecord.hasUnreadCompletion` 独立记录完成结果是否待验收并随服务端状态文件持久化。桌面聚焦、终端窗格激活和手机会话查看统一通过 focus API 确认，保证刷新或跨页面后分列一致。
- 完成态卡片提供“标记已读 / 标记未读”操作，通过会话 PATCH API 更新持久化的 `hasUnreadCompletion`；运行中和明确需响应的会话不能被手动伪造为待验收。
- 卡片显示名称、状态、Agent 类型、主机、工作目录和轻量终端文本预览；本机 Codex 及本地 tmux 中明确登记为 Codex 的兼容卡片（`shell` / `node`）会按会话 ID 或工作目录匹配结构化 JSONL 记录，规则提取最后用户指令和最后 Agent 回复，作为紧凑“任务 / 回复”摘要展示，不调用大模型。OpenCode、Claude、Copilot 等明确非 Codex 会话不会读取同目录 JSONL。受管 tmux 用独立的小号标签表达传输类型，不污染标题。
- 本地卡片还通过固定参数的只读 Git 查询展示项目、分支或 detached HEAD、worktree、变更文件数和增删行数；摘要固定在卡片内部，不改变 240px 卡片高度。远端 Git 读取暂不执行。
- 看板工具栏提供“最近活动 / 项目 / 名称”三种列内排序。排序在状态分列之后、会话分组之前执行，因此不会改变四列语义和用户配置的分组顺序；选择持久化在浏览器 `localStorage`。
- 支持按服务器、Agent 类型、tmux 类别、目录关键字筛选。
- 支持创建、重命名和删除会话分组；主页看板将用户分组嵌套在对应状态列内，聚焦视图右侧“其他会话”继续按同一配置分组展示，未指定归属的会话自动进入“未分组”。
- 主页卡片和聚焦侧栏卡片都提供分组选择菜单，可移动到已有分组、移回“未分组”，或新建分组并立即移入；删除分组只解除归属，不删除会话。
- 每个用户分组和“未分组”标题都可独立折叠/展开；折叠时保留名称与卡片计数，主页和聚焦侧栏共享并持久化折叠状态。
- 分组标题使用稳定的分类色、放大的粗体名称、整行浅色背景和同色数量徽标形成组级视觉锚点；主页与聚焦侧栏共享色调，“未分组”使用中性色，同时保留文字、数量和折叠箭头以避免只靠颜色区分。
- 支持重命名、隐藏、关闭/脱离、终止 tmux、复制 tmux attach 命令。
- 状态数量由四列列头统一展示；筛选行保留已隐藏会话入口，不重复显示状态统计。
- 已隐藏会话进入隐藏抽屉，可以恢复或删除。
- 双击卡片进入聚焦视图。
- 默认轻量预览模式下，卡片和聚焦右侧栏显示轻量文本预览；用户可从顶栏切换回完整小终端预览。
- 四列在桌面端并排、窄屏纵向排列；大规模且未启用用户分组时继续虚拟化卡片，默认轻量预览不会为每张卡片创建真实终端 WebSocket。
- 聚焦视图可以直接输入主终端，并在侧栏保留其它会话上下文。
- 聚焦视图支持单屏、左右双屏、上下双屏、左中右三屏、四屏、六屏、八屏终端监控；多窗格可以同时观察多个真实终端，但输入所有权始终只有一个“输入中”窗格，不做广播输入。
- 每个监控窗格通过分组会话切换器选择内容：弹层复用看板现有分组顺序和稳定分类色，显示组内数量、会话状态、当前项及其他窗格占用编号；分组标题可独立折叠/展开并持久化，且不受主页看板或聚焦侧栏折叠状态影响。已占用项不可重复选择，未分组会话自动归入独立分区，长列表由弹层内部滚动。
- 聚焦视图支持一键折叠右侧“其他会话”侧栏，方便在主终端和其它会话上下文之间切换。
- 前端交互使用轻量 CSS 动效增强观感：菜单、诊断面板、主机下拉、卡片、抽屉和弹窗只动画 `opacity` 与 `transform`，并通过 `prefers-reduced-motion` 对低运动偏好用户降级。

### 顶栏和快捷入口

- 顶栏分组展示：左侧是“电脑端 Coding Kanban”、会话数量徽标和“手机端 Coding Kanban”切换入口，中间保留新建会话、扫描、文件、VS Code 等高频入口，右侧提供“工具”“资源调节”、全屏和折叠入口。
- 顶栏右侧常驻“终端字号”滑杆，可在 10px 到 24px 之间拖动调整所有内置 xterm 终端及“完整记录”正文的字号。
- 手机端页面标题区对应显示“手机端 Coding Kanban”，并提供“电脑端 Coding Kanban”切换入口和 Agent 完成通知开关。
- `扫描` 菜单收纳扫描 tmux 和扫描会话；`工具` 菜单收纳操作提示和 Agent 完成通知开关；`资源调节` 菜单收纳终端预览模式、VS Code 省内存/保持状态、释放 VS Code 缓存和资源诊断。
- 顶栏可折叠；折叠状态保存在 `localStorage` 的 `agent-console-layout`。
- 会话分组配置保存在 `localStorage` 的 `coding-kanban-session-groups-v1`，两处桌面看板视图共享，当前不做跨浏览器同步；分组颜色按配置顺序稳定分配，前 12 个使用醒目分类色，更多分组继续生成不同的高对比 HSL 色值；assignment 同时保存稳定会话和安全运行身份别名，以便重启后恢复归属。
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
- tmux 扫描、快速连接和加入看板时，`displayName` 使用真实 tmux session 名；`agentKind`、`workingDirectory`、`sshTarget` 和 `transportRef` 分别承载命令类型、目录、远端主机和 tmux 绑定，不再把这些信息拼成 `tmux:<session> (<command>)` 一类标题。服务端是 tmux 传输目标的规范化边界：tmux 会把 session 名中的 `.`、`:` 转换为 `_`，因此 PTY 启动、重连和状态恢复都使用同样的规范名，用户自定义 `displayName` 则保持原文。
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

窗格标题栏的 `TerminalSessionSwitcher` 从同一 `SessionGroupState` 派生分组列表，并复用既有折叠状态机制，但使用独立的 `terminal-switcher` 作用域，因此主页看板、聚焦侧栏与切换弹层互不联动。分组标题是可键盘操作的展开/折叠按钮，收起后仍显示组名和数量；通过 portal 挂载到页面根层，避免被终端窗格的裁切边界截断，并根据触发器和视口空间向上或向下定位。弹层只让外层分组列表承担滚动，分组容器使用不创建滚动祖先的裁切方式，因此组标题可以相对外层列表吸顶，并在下一组到达时自然上推替换。当前 slot 与其他 slot 的占用标记由现有 `terminalSlots` 投影生成，选择动作继续复用原有 slot 更新逻辑。搜索框按会话名或分组名过滤该投影：搜索期间匹配分组自动保持展开且暂时禁用折叠；分组命中保留组内全部会话，会话命中只保留对应项，清空搜索后恢复各分组持久化的折叠状态。

- 终端 WebSocket：`/ws/agent-sessions/:id/terminal`。
- 每个仍挂载的实时 `TerminalView` 在终端 WebSocket 异常关闭后使用 250ms 起步、最大 5 秒的指数退避重建连接；连接在 3 秒内未完成握手也会主动关闭并进入同一恢复链。新连接完成 replay 后才重新开放 stdin，并重新同步 resize 和焦点。组件卸载会取消待执行的重连，避免隐藏终端或旧会话产生后台连接。
- 手机终端继续由输入框和快捷键通过既有 stdin 接口驱动，不让 xterm 的隐藏输入框长期抢占软键盘焦点。由于 tmux replay 只有屏幕内容和最终坐标、不一定包含 xterm 用来初始化光标的控制序列，触控监控终端在 `open` 后通过一次同步 `focus → blur` 初始化 xterm 光标，再归还挂载前仍有效的页面焦点；活动与失焦光标都使用高对比度下划线，因此用户用方向键调整已粘贴文字时仍能看到 TUI 当前编辑位置。桌面终端保持块状活动光标和轮廓失焦光标。
- 完整记录 HTTP 接口：`GET /api/agent-sessions/:id/transcript?limit=30&cursor=<byte-offset>`。它只根据 registry 中可信的本机会话元数据访问 `~/.codex/sessions`，不接受客户端文件路径；服务端从 JSONL 尾部以 64 KiB 块向前扫描，只解析足够组成当前页的 user/assistant message 与非 `exec` 工具记录，并返回下一页字节游标，不再使用 `readFileSync` 全量读取大型历史。本地 tmux 会通过固定参数调用 `tmux display-message` 获取 pane PID，再只读遍历该 pane 的 `/proc` 子进程和已打开文件，从对应 Codex 进程持有的 JSONL 中选择工作目录一致、非 subagent 的顶层 session；解析成功后把精确 ID 回写会话绑定，Codex 在同一 tmux 内重启时也会重新识别。只有进程身份不可用时才使用既有 `agentSessionId`，仍缺失则按 `workingDirectory` 匹配最近活动记录。多屏聚焦页不再保存打开瞬间的会话对象，而只保存弹窗开关；弹窗会话始终由当前活动窗格派生并以会话 ID 作为 React key，活动窗格变化会卸载旧请求视图、重新读取新会话。xterm helper textarea 被视为终端内容而非外部编辑器，点击它同样更新 `activeSlotId`。解析层忽略 developer/system/reasoning，并在倒序扫描时把工具调用与输出作为不可拆分记录组，因此跨页仍能同时过滤 `exec` 调用和对应输出；前端按最新记录在前展示，用户与 Codex 消息复用按需加载、memo 化的安全 Markdown/GFM/KaTeX 渲染器。轻量预览最多保留连续 90 条、完整预览最多保留 300 条；继续向前浏览时释放窗口外较新记录，刷新可回到最新。工具输出仍为等宽原文，两类记录正文共享全局终端字号。终端继续承担实时交互，完整记录弹窗承担不会被 ANSI/TUI 重绘覆盖的追加式历史浏览。
- 终端字号由 `terminal-font-size` 本地存储项持久化，默认 14px；滑杆拖动过程中只更新控件显示，鼠标松开、键盘调整结束或失焦提交后才更新已有 `TerminalView` 的 `fontSize` 并触发 fit/resize，不需要重建 WebSocket。
- 会先发送 scrollback replay，再发送 `replay-complete`；手机终端连接携带服务端校验的 `replayBytes=262144`，只回放最近 256 KiB，桌面端保持配置允许的完整回放。
- PTY 重连沿用稳定 session ID，但每次生成独立 runtime handle；只有当前 handle 可以追加输出、删除运行时或把会话标记为退出。被替换 PTY 的迟到 data/exit 回调必须忽略，避免并发恢复或手动重连后新 PTY 被旧回调误下线。
- live PTY replay 上限默认 4 MiB，可通过 `TERMINAL_SCROLLBACK_BYTES` 调整；tmux observe/refresh 默认捕获最近 20000 行，可通过 `TERMINAL_TMUX_CAPTURE_LINES` 调整；registry fallback 默认保留 5000 条，可通过 `TERMINAL_REGISTRY_OUTPUT_ENTRIES` 调整；浏览器 xterm 默认保留 20000 行，可通过 `VITE_TERMINAL_SCROLLBACK_LINES` 调整。
- replay 阶段会缓冲 live frame，避免新输出和历史输出乱序。
- 前端会在 replay complete 后解锁 stdin；8 秒兜底避免永久无法输入。
- 后端只清理会污染提示符的 Secondary DA 与 OSC 色彩回复；其余 live DA/DSR/CPR 按终端输出查询类型匹配后写回 PTY。输出 `CSI c`、`CSI 5n`、`CSI 6n` 后，普通 stdin 会在 250ms 上限内等待对应回复，陈旧或类型不符的回复直接丢弃，避免 `5Rnode` 这类协议残片进入 shell。
- 支持 resize 消息和 binary 消息，binary 用于 tmux 鼠标等二进制事件。
- 前端 `TerminalView` 支持 OSC 52 剪贴板写入，允许 tmux copy-mode、SSH 会话或 CLI 工具把当前终端 pane 内复制内容写入浏览器剪贴板；该能力只消费终端输出中的 clipboard target 请求，不改变 stdin、resize 或 tmux 鼠标事件转发。
- 轻量预览模式下，默认只有当前聚焦主终端发送 resize 和 stdin；非活跃区域依赖会话 `outputPreview` 展示轻量文本预览。服务端只用包含足够可读字母、数字或中日韩字符的输出块更新预览，并对受管 tmux 使用更严格的碎片阈值；纯光标、擦除和边框绘制块仍参与活动检测但不会覆盖已有可读文本。前端继续清理 ANSI 与终端字符集切换序列。
- 多终端监控模式会按所选屏幕布局显式挂载 1、2、3、4、6 或 8 个实时 `TerminalView`；所有窗格都能接收后端输出并保持实时观察，但只有当前“输入中”窗格开启 stdin、焦点修复和终端输入所有权，避免广播输入。`activeSlotId` 是当前输入目标，任何会改变它的窗格点击、会话替换、拖放、关闭补位或侧栏切换都会同步 App 级 `focusedId`，保证标题和文件/VS Code 工具不会继续引用旧会话；重复选择非活动窗格中已经显示的当前项仍是无操作。
- 完整预览模式下，非活跃卡片和右侧栏会恢复只读 `TerminalView`，因此会重新建立终端 WebSocket，适合需要实时小窗预览的场景。
- 前端资源诊断会记录 `/ws/agent-sessions` 会话状态消息速率和大小、`/ws/agent-sessions/:id/terminal` 实时流速率、终端 WebSocket 生命周期、DOM 中的 xterm/预览/监控窗格/VS Code iframe 数量，以及浏览器暴露的 JS heap；同时每秒按需调用 `/api/diagnostics/terminal-history` 和 `/api/diagnostics/vscode-web-proxy` 读取后端终端历史与 VS Code 代理吞吐。诊断只在面板打开时刷新，不保存历史。
- `/ws/agent-sessions` 每次连接先发送完整 `snapshot`，此后发送仅含变化会话、删除 ID、焦点与时间戳的 `delta`；前端合并后继续向应用暴露完整列表，断线重连后重新以全量快照建立基线。后端仍对终端输出导致的状态更新做约 1 秒 trailing 合并，新建、删除、聚焦、重命名等结构性变化即时广播。
- 本地 tmux 先用 `tmux list-clients` 将 attached client PID 与 PTY PID 精确匹配；回放可见但 attach 尚未完成时，首个输入不会误写入启动 shell，而是短暂等待或安全回退 pane adapter。确认后 attached tmux client PTY 是普通文本、快捷键、bracketed paste、鼠标协议及 `Ctrl+A` / `Ctrl+B` 前缀的唯一实时输入通道，确保输入始终跟随可见的当前 pane；tmux client 不支持 extended keys 的 CSI-u 修饰键例外用 `send-keys -l` 保留原始字节。路由器仍查询当前 `prefix` key table，记录 `command-prompt` / `confirm-before` 状态以便连接关闭、重连和恢复时用 Ctrl+C 清理残留 prompt；`status-keys vi` 的 Escape 仅切换编辑模式。
- 服务生命周期把 Fastify 关闭与 PTY 关闭绑定：SIGTERM/SIGINT 先执行 `app.close()`，`onClose` 再统一 dispose 本进程创建的 PTY，最后退出。这样 `tsx watch` 与脚本重启不会把旧 `tmux attach` 进程留给 PID 1，也不会持续增加 session 的 attached client 数量。
- `TerminalView` 开启 xterm 的 `macOptionIsMeta`，因此 macOS Option 与 Windows/Linux Alt 在浏览器能够接收事件时使用相同的 Meta 编码。adapter 在完整 CSI 键序列之后识别 `ESC+Space` 及常用 `ESC+字母/数字`，并原子映射为 tmux `M-*` 键，避免 Codex 把两个分离事件解释为 Escape 和普通输入；Windows 窗口管理器若截获 `Alt+Space`，使用已支持的 `Shift+Enter` 作为换行备用键。
- Safari 的快速文本输入额外经过短时恢复状态机：`TerminalView` 记录已经通过 xterm `onData` 发出的普通文本，并在原生 `insertText` 冒泡时按顺序抵消已发送部分，仅把缺失后缀送入原有 WebSocket 输入链路。状态按 100ms 过期，控制序列会清空状态，IME composition 不参与恢复，避免重复输入或跨按键误匹配。
- 滚轮按终端能力动态路由：当前交互终端启用 xterm mouse tracking 时，普通 wheel 事件放行给 xterm 并经 terminal WebSocket/attached PTY 到达 tmux 当前 pane；按住 `Shift` 时强制浏览本地 xterm scrollback。未启用 mouse tracking 或不具备输入所有权的大屏监控窗格继续只滚动自己的 scrollback；聚焦页右侧小卡即使启用完整 xterm 预览也使用 `wheelPassthrough` 被动命中面，滚轮只滚外层会话侧栏。
- 文件/VS Code 侧面板分隔条使用 pointer capture 跨越 iframe 保持拖动；宽度通过 latest-value animation-frame scheduler 直接写入面板 DOM，React 状态和 localStorage 只在松手时提交一次。`TerminalView` 的 fit 使用 frame + trailing 合并调度，并在侧面板拖动期间只保留 trailing fit，避免 xterm、VS Code iframe 和整个 App 同时高频重排。

### 应用更新与会话恢复

后端 `AppVersionService` 对配置的 `APP_SOURCE_ROOT` 计算本地 Git 指纹，`GET /api/app-version` 返回 process runtime id、Git branch/head、source revision 和独立的 Git 自动更新状态。指纹计算本身仍只读取本地仓库：tracked `git diff --binary` 直接流入 SHA-256，不把大 diff 缓冲进内存；未跟踪文件使用有界 `FileHandle.read`。并发请求共享同一个进行中的计算和短期缓存。

`GitAutoUpdateService` 由 `GIT_AUTO_PULL_INTERVAL_MINUTES=10|30` 显式启用，`0` 或未设置时关闭。它在后端启动时检查一次，之后按周期执行固定参数的 `git fetch --prune`，解析当前分支的既有 upstream，并只维护远程版本提醒；后台定时器绝不执行 pull 或 merge。Git ref 会经过严格格式校验，命令使用 `execFile`、禁用终端凭证提示、限制输出和超时；HTTP 只能触发无参数 `POST /api/app-update/check` 与 `POST /api/app-update/apply`，不能传入路径、remote、branch 或命令。

更新状态机为 `disabled / idle / checking / available / updated / conflict / error`。定时器与手动操作共享 single-flight；发现上游领先时只进入 `available` 并提醒用户。只有用户点击“拉取并更新”后，apply 端点才允许 `merge --ff-only <remote-head>`。HEAD 与 upstream 分叉时不创建 merge commit；本地修改或未跟踪文件阻止 fast-forward 时保留原 HEAD 和工作区；Git 错误只返回有界、去机器路径的用户消息。

用户确认后的安全 fast-forward 成功后，source revision 变化会自动复用既有热更新链：前端记录恢复意图并 reload 一次，不再要求第二次确认，随后恢复受管 tmux。未经“拉取并更新”确认，后台检查不会修改源码或刷新浏览器。版本和恢复提示是非模态的，只有其操作按钮接收指针事件，提示本身不会截获底下终端或顶栏控件的输入；恢复成功提示可主动关闭并在 5 秒内自动隐藏，恢复失败提示保持可见。

生产入口使用 `FileSessionStateStore` 把稳定会话目录保存到 `SESSION_STATE_PATH`，默认 `.dev-runtime/agent-sessions.json`：

- 保存稳定 session id、显示信息、工作目录、tmux/SSH 绑定、隐藏状态和标签。
- 不保存 terminal output、进程 PID、runtime id 或密钥内容。
- 后端启动时先恢复离线卡片，再由 `POST /api/agent-sessions/restore-managed` 重新 attach 仍存在的受管 tmux。
- 恢复端点使用 single-flight 协调，多标签页同时请求时只执行一轮 tmux discovery 和 PTY reconnect。
- 缺失的 tmux 只报告失败，不执行旧命令重建；direct 会话保留为手动恢复卡片。
- 状态文件使用原子替换，并按稳定元数据去重写入，终端输出、连接运行态和纯时间戳变化不会持续触发磁盘 I/O；文件不可写时记录错误但不阻断后端启动和会话操作。

浏览器使用 `focus-view-state` 和 `terminal-monitor-workspace-v1` 恢复聚焦视图、布局模式、slot-to-session 分配、当前输入 slot 和主动关闭的 slot。稳定 session id 让这些状态跨后端重启继续有效。`restart-dev.sh` 会在停止旧后端前尝试捕获当前 `/api/agent-sessions`，用于首次升级迁移；迁移脚本在写盘前先投影稳定字段，不会把旧快照中的 terminal output、PTY PID 或 runtime id 写入状态文件。若目标端口上确有本仓库后端而迁移捕获失败，脚本会在任何 kill 前退出；无本仓库监听器或只有外部监听器时跳过迁移捕获。

重启脚本会先把 `.env` 作为 dotenv 赋值数据读取，再计算 `SERVER_PORT`、`PORT` 和 `WEB_PORT` 的默认值；它绝不 `source` 或执行配置内容。未加引号的空格值会完整保留，单/双引号只用于包裹值且在传入进程前移除；非 `KEY=value` 或未闭合的引号会在任何服务停止前报出行号并退出。

受管本地 tmux 的 attach/reconnect 和带显式命令的 direct PTY 使用非交互 `/bin/sh` 执行，不加载用户 `zsh/bash` 登录启动文件，避免 shell 初始化钩子抢先启动 Agent TUI；未指定命令的 direct PTY 仍使用用户原生交互 shell。WebSocket 写入者关闭、手动重连、自动恢复、删除或终止会话时，输入清理与既有队列有序执行，取消遗留 tmux 前缀并清除跨帧 bracketed paste 状态；只读预览连接关闭不会清理活跃输入状态。

### 手机端终端控制页

手机端入口是面向手机浏览器的专用 Agent 工作区，不复用桌面分屏和侧栏布局。默认入口为 `/?view=mobile`，并兼容 `/mobile`、`/m` 和 `#/mobile`；这样即使部署入口不支持 SPA history fallback，手机也能通过根页面 query 进入。进入后默认直接打开“当前会话”并按需挂载一个真实终端；底部主导航继续提供看板、活动、当前会话和项目/文件入口，看板按“需响应 / 待验收 / 执行中 / 可继续”的注意力顺序展示独立会话轻量摘要。终端复用已有 `AgentSessionRecord`、`/ws/agent-sessions/:id/terminal` 输出通道和 `/api/agent-sessions/:id/stdin` 输入通道，并为手机连接增加有界回放参数。

- 当前会话页面采用单会话全屏终端：顶部显示桌面入口、当前会话状态和单实例页面内会话选择器，“完整记录 / 变更 / 文件”在同一行操作组；“文件”就地切换到当前会话的文件系统并提供“返回终端”，中间终端仅在返回后重新展示。会话列表不使用浏览器原生选择层，实时快照更新时不会重复堆叠，支持点外部或 Escape 关闭。
- 快捷键条是单行横向滑动选择器，所有快捷键常驻而不增加二级“更多”菜单；高频的 `Esc`、`Ctrl+C`、`Enter`、`Tab`、方向键和退格前置，一次性 `Shift` 与其余组合键继续保留。方向键和退格支持短按一次，只有静止按住满 3 秒才开始串行重复；从重复键上横向滑动会先取消按键计时并交由原生滚动处理。上一笔 stdin 请求完成后才安排下一笔，避免慢网络产生松手后继续执行的积压；用户可点击末尾“说明”查看每个快捷键的作用。
- 多行输入框通过普通 `<textarea>` 承载手机输入法，只保留“发送”和“粘贴”：两者都以 bracketed paste 写入文本，“发送”再单独发送 `Enter`。失败时输入框保留原文并就近显示“重试”；若粘贴帧已成功而提交帧失败，重试只续发提交帧，避免重复内容。
- 手机端标题区的通知按钮复用桌面 Agent 完成通知状态；手机浏览器支持并授权通知时，页面保持打开即可收到任务完成提醒。
- “项目/文件”按主机与项目目录聚合会话，并提供适配触屏的文件系统入口。本地项目直接读取工作目录，SSH 项目沿用会话的远端连接信息；用户可进入目录、搜索当前目录、切换隐藏文件、在独立纵向滚动区预览文本或图片并复制路径。路径工具栏的“新建”打开触屏底部菜单，用户选择空文件或文件夹后输入单层名称；前端拒绝空名称、`.`、`..`、空字节和路径分隔符，再复用 `useFileBrowser` 的本地/SFTP 创建与刷新链路。文件预览默认只保留一行紧凑标题栏，路径、复制路径、查看方式和分段导航收进可折叠的“文件选项”，展开区域自身有高度上限和滚动边界，避免挤占正文。Markdown 文件复用电脑端按需加载的安全 GFM/KaTeX 渲染组件，默认显示渲染结果，也可通过触屏友好的“渲染 / 源码”控件查看原始 Markdown；窄屏下图片自适应、表格和代码块可横向滚动。大型 UTF-8 文件不再固定截取开头：前端通过 `/api/fs/preview` 的 `offset` 继续请求 64 KiB 窗口，用户可前后切换；切换查看方式不会复制内容，翻段后也会替换而非追加内容，因此浏览器内存与文件总大小无关。文件条目长按 600ms 弹出底部操作菜单，滑动超过 12px 会取消，避免滚动误触；菜单可进入/预览、下载、重命名、删除和复制路径，删除继续使用现有本地/SFTP 安全校验并要求确认。
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
- 浏览器 `/vscode` WebSocket 和 code-server 上游 WebSocket 是两个独立握手；代理会在上游进入 OPEN 前用 1 MiB 有界队列保留浏览器首包，随后按顺序冲刷，避免扩展宿主初始化消息在连接竞态中丢失。

注意：

- 旧版本曾把 code-server 配置放到 `/tmp/coding-kanban-vscode-*`，如果看到每次都要重新配置，先检查是否还有旧 code-server 进程。
- VS Code Web 面板左上角只保留重新加载按钮，不再常驻展示 provider/reused 状态标签。
- `reused` 只表示后端进程复用了同一个 VS Code Web server，不等同于浏览器 iframe 缓存。
- VS Code iframe 显式委派 `clipboard-read` / `clipboard-write`，`/vscode/*` 代理响应保留上游 Permissions-Policy 的同时把两项剪贴板权限限制为同源；浏览器仍可按站点设置要求用户确认剪贴板访问。
- iframe 挂载前会使用独立 scope 注册并立即注销一个最小 Service Worker，提前验证当前浏览器是否真正信任 HTTPS。远端浏览器拒绝证书时，面板会提供当前开发 CA 的公有证书下载和 Safari/macOS 信任步骤；下载路由只输出重新编码的 CA 公有证书，不读取或暴露私钥。
- 浏览器侧 iframe 默认使用“VS Code 省内存”模式，只保留当前打开的 iframe；“VS Code 保持状态”模式最多保留最近 3 个 iframe。VS Code Web 打开响应使用有界最近缓存，历史会话不会永久累积在页面内存中。
- 拖动 VS Code 与终端之间的分隔条时暂时禁用 iframe pointer events，并由分隔条持有 pointer capture；鼠标进入编辑器区域不会中断拖动，终端 fit/resize 在拖动稳定后合并执行。
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
- `GitAutoUpdateService`：按配置周期只 fetch/check 当前 upstream；用户确认后才执行安全 fast-forward，并维护可用更新、冲突和错误状态。
- `FileSessionStateStore`：校验、投影并原子持久化稳定会话目录。
- `restoreManagedSessions`：分类并恢复仍存在的受管 tmux，会话缺失时保持显式失败边界。
- `LocalFsService`：本地文件系统。
- `SftpService`：远端 SFTP 文件系统。
- 本地与 SFTP 预览共用有界窗口协议：`offset` 和 `maxBytes` 控制读取范围，响应返回 `previousOffset` / `nextOffset`、实际字节数和文件总长度。服务端将单次请求硬限制为 256 KiB，并在 UTF-8 字符边界分段，避免分页乱码。
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
- `POST /api/app-update/check`
- `POST /api/app-update/apply`
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
- `AppUpdateBanner.tsx`：远程更新提醒与确认拉取、冲突/错误提示、恢复进度和失败结果。
- `TopBar.tsx`：分组顶栏、显示/工具菜单、操作提示、主入口、折叠。
- `AgentGrid.tsx` / `AgentGridCard.tsx`：宫格和卡片。
- `AgentFocusView.tsx`：聚焦终端和会话切换。
- `TerminalSessionSwitcher.tsx`：多终端窗格的分组会话选择、占用标记和视口内弹层定位。
- `TerminalView.tsx`：聚焦主终端的 xterm.js、WebSocket、replay、输入所有权。
- `TerminalPreview.tsx`：宫格卡片和聚焦右侧栏的轻量文本预览，不建立终端 WebSocket。
- `resource-diagnostics.ts`：浏览器资源诊断采样、WebSocket 吞吐统计和压力源分类。
- `terminal-font-size.ts`：终端字号范围、持久化和归一化逻辑。
- `terminal-preview-mode.ts`：终端预览模式持久化，默认轻量模式，可切换完整预览。
- `app-update.ts`：已接受 revision、用户确认拉取基线和一次性 reload 恢复意图。
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
- 默认使用 HTTPS，并在 `mkcert` 可用时复用其 CA 签发开发证书。
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
- `scripts/restart-dev.sh` 默认使用 HTTPS，地址形如 `https://10.30.0.22:8484/`；局域网内其他设备首次访问时必须信任启动日志给出的开发 CA，否则 VS Code WebView 的 Service Worker 会被浏览器拒绝。
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
- `VITE_DEV_HTTPS_CA_CERT`：由启动脚本传给 Vite 的 CA 公有证书路径，仅用于 VS Code WebView 证书信任恢复入口。

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
- code-server 由同源 `/vscode/` 代理提供；HTTPS 前端会先验证 Service Worker 能力，避免证书不受信任时进入不可恢复的空白 WebView。

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

推荐使用 `./scripts/restart-dev.sh` 启动默认 HTTPS 服务；手动测试 HTTPS 时需显式配置 `VITE_DEV_HTTPS` 和证书路径。局域网客户端还必须信任签发该证书的 CA，单纯在浏览器警告页选择继续访问不足以启用 Service Worker。

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
