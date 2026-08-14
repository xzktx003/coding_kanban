# 仓库功能记录

- 会话看板：宫格展示会话卡片，支持状态/主机/目录/Agent 类型展示、筛选、隐藏、恢复、重命名、关闭、重连与 tmux attach 命令复制。
- 聚焦视图：双击卡片进入主终端输入态，保留其它会话上下文，支持侧栏折叠与快捷返回宫格；多屏监控时当前输入窗格使用高亮边框和“当前输入”角标提示，且仅当前输入窗格标题栏支持右键菜单进行单屏展示、还原多屏展示、关闭看板展示该窗口或彻底删除；关闭当前窗格展示时优先用右侧第一个其他会话补位。
- 其他会话：聚焦视图右侧其他会话卡片支持右键菜单，可关闭看板展示该窗口或彻底删除终端；关闭看板展示会隐藏会话但不终止底层终端。
- 终端交互：鼠标滚轮固定滚动终端 scrollback 上下文，不转发为 Codex CLI 的输入历史翻页；输入历史翻页保留给键盘上下箭头。
- 顶栏入口：文件浏览器、VS Code Web、新建会话、扫描 tmux、扫描会话、快速连接 tmux、操作提示、菜单栏折叠。
- 新建会话：支持本机/SSH，支持 `copilot`、`codex`、`claude`、`shell`，支持 `direct` / `tmux` 两种启动方式。
- 快速连接 tmux：支持本机和 SSH 远端，通过 `tmux new-session -A -s <session> -c <dir>` 直接创建或接入。
- tmux 管理：支持本地/远端扫描、接管 live pane、refresh、takeover、release、kill。
- Agent 目录扫描：支持本地/SSH 扫描、Copilot session-state 识别、tmux 合并、direct/tmux 两种加入方式。
- 终端与 WebSocket：支持可配置 scrollback replay、live output、stdin、resize、binary、tmux 鼠标事件、缩略图几何缓存；资源诊断会显示 PTY replay、tmux capture、registry fallback 和 xterm scrollback 上限及裁剪状态。
- 文件浏览器：支持本地与 SSH/SFTP，支持树、面包屑、显示隐藏文件、过滤排序、预览编辑、新建、重命名、删除、chmod、上传下载、拖拽上传。
- VS Code Web：本地聚焦会话可打开内嵌 `code-server` / `openvscode-server`，支持稳定 workspace 与共享扩展目录。
- VS Code 窗口观察：可把本地 VS Code 窗口作为观察卡片加入看板并跟踪活动状态。
- SSH/环境适配：主机来自 `~/.ssh/config`，shell 与 tmux 路径自动探测，端口和代理由 env 驱动。
- 布局持久化：顶栏、聚焦态、文件浏览器布局、侧边工具和 VS Code 缓存状态持久化到本地存储。
- 双 Diff 审查：桌面和手机支持“本次任务”与“当前工作区”两个独立变更视图；后端分别通过 `CodexChangeService` 的任务后 `apply_patch` 记录和 `GitChangesService` 的可信工作目录读取数据，任务 Diff 无可靠记录时不降级冒充工作区 Diff。
- 手机工作区首页：默认显示按注意力排序的轻量会话摘要列表；主导航提供看板、活动、当前会话和项目/文件，只有进入当前会话后才挂载一个真实终端。
