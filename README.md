# Coding Kanban

<p align="center">
  <strong>面向 CLI Coding Agent 的本地 / 内网多会话工作台</strong><br />
  把看板、真实终端、tmux、SSH、结构化会话记录、Git Diff、文件浏览器、VS Code Web 和手机接管整合为一个连续工作流。
</p>

<p align="center">
  <a href="#快速开始">快速开始</a> ·
  <a href="#产品视图与功能导览">截图导览</a> ·
  <a href="#完整功能说明">完整功能</a> ·
  <a href="#典型工作流">工作流</a> ·
  <a href="#部署安全与边界">安全边界</a>
</p>

> [!WARNING]
> Coding Kanban 的后端可以执行终端、SSH、tmux、Git 只读查询和文件系统操作。它面向可信本机或内网环境，**不要直接暴露到公网**。

## 为什么需要 Coding Kanban

同时运行多个 Copilot、Codex、Claude 或 shell 会话时，真正困难的通常不是“再打开一个终端”，而是：

- 哪个 Agent 正在执行，哪个在等待确认，哪个已经完成但还没验收？
- 如何从几十个 tmux pane 中快速找到目标，并继续输入而不丢上下文？
- 如何在终端旁边查看任务摘要、Git 变化、文件和完整会话记录？
- 如何让桌面和手机使用同一套会话，不在移动端重新建立一套工作流？
- 如何控制大量终端 WebSocket、xterm 和 VS Code iframe 带来的浏览器资源开销？

Coding Kanban 将这些问题收敛为一条主流程：

```text
扫描 / 新建会话
      ↓
四列注意力看板
      ↓
聚焦一个终端或同时监控多个终端
      ↓
查看结构化记录、Git Changes、文件或 VS Code
      ↓
桌面继续工作，或在手机端接管
```

## 核心能力一览

| 能力 | 当前行为 |
| --- | --- |
| 注意力看板 | 自动分为“需响应 / 执行中 / 待验收 / 可继续”，列头显示数量 |
| 卡片上下文 | 展示最后用户任务、最后 Agent 回复、项目、分支/worktree、文件数及增删行 |
| 已读管理 | 完成态可主动标记已读/未读，状态由服务端持久化 |
| 排序与分组 | 按最近活动、项目、名称排序；用户分组在四列内独立折叠 |
| 真实终端 | xterm.js + WebSocket，支持 replay、resize、stdin、控制键和 OSC 52 |
| 多屏监控 | 1/2/3/4/6/8 屏；多个终端同时观察，但只有一个输入窗格 |
| tmux | 本地/SSH 扫描、创建、attach、接管、释放、刷新、终止 |
| Agent 扫描 | 扫描本地或 SSH 工作目录，识别结构化 Agent 会话并与 tmux 合并 |
| 完整记录 | 本机 Codex JSONL 结构化记录，隐藏 exec 噪声，Markdown/GFM/KaTeX 渲染 |
| 变更审查 | “本次任务”与“当前工作区”双 Diff，文件筛选、全屏查看、复制和引用 |
| 文件浏览器 | 本地/SSH 浏览、预览、编辑、上传、下载、拖拽、chmod、Markdown/LaTeX |
| VS Code Web | 本地与 SSH 远端 code-server，通过 `/vscode/` 内嵌并限制 iframe 缓存 |
| 手机工作区 | 注意力看板、活动、项目/文件、终端快捷键、完整记录和手机 Diff |
| 更新与恢复 | 用户确认后 fast-forward 更新；重启后恢复 managed tmux 和布局 |
| 资源诊断 | xterm、WebSocket、快照吞吐、终端流、VS Code iframe、long task、heap |

## 产品视图与功能导览

截图位于 [docs/readme-assets](docs/readme-assets)。现有截图可以直接浏览；扩展截图脚本已覆盖最新看板、Diff、资源诊断和手机端视图。生成方式见[更新 README 截图](#更新-readme-截图)。

### 1. 四列注意力看板

主页不是简单的终端缩略图墙，而是按用户下一步动作组织会话：

- **需响应**：Agent 明确等待回答、权限或确认。
- **执行中**：当前任务仍在运行。
- **待验收**：任务已经完成，但结果尚未查看或被主动标记为未读。
- **可继续**：结果已查看、进程已分离，或可以继续输入新任务。

卡片固定高度，结构化“任务 / 回复”和 Git 摘要都收在卡片内部，不会因信息增多撑高布局。完成态还可以使用 `○ / ●` 主动标记未读或已读。

![四列注意力看板](docs/readme-assets/board-overview.png)

看板支持按服务器、Agent 类型、tmux、标签和目录筛选；支持按最近活动、项目和名称进行列内排序。用户分组嵌套在状态列中，同一个分组在四列内分别控制展开和收起。

下面的视图同时展示了排序菜单、结构化任务/回复摘要、Git 分支和增删行统计。摘要优先来自 Agent 的结构化对话记录，不调用大模型二次生成。

![看板排序与结构化摘要](docs/readme-assets/board-sorting-and-summaries.png)

### 2. 聚焦终端与多屏监控

双击卡片进入聚焦视图。主窗格是真实可输入的 xterm 终端，右侧继续保留全部会话上下文。

![聚焦终端](docs/readme-assets/focus-view.png)

支持单屏、左右双屏、上下双屏、三屏、四屏、六屏和八屏。多个窗格可以同时接收输出，但键盘输入始终只发送给带“当前输入”标识的一个窗格，避免误广播。

右侧会话卡片可以拖入窗格，窗格之间也可以拖拽换位；布局、slot 会话和当前输入窗格会保存到浏览器本地并在刷新后恢复。

### 3. 新建独立会话

每次只创建一个独立会话。可以选择：

- 本机或 SSH 主机。
- `copilot`、`codex`、`claude` 或 `shell`。
- `direct` 或受管 `tmux` 模式。
- 工作目录、显示名称和所属用户分组。

![新建会话](docs/readme-assets/new-session-dialog.png)

推荐使用受管 tmux：应用更新或后端重启后可以重新 attach；direct PTY 只能保留卡片元数据，无法恢复原进程。

### 4. 快速连接与扫描 tmux

按 `Ctrl/⌘+E` 打开快速连接。目标 session 存在时 attach，不存在时创建。

![快速连接 tmux](docs/readme-assets/quick-tmux-connect.png)

扫描入口支持本地或 SSH 远端：

- 扫描 tmux pane 并加入看板。
- 扫描 Agent 工作目录，识别 Copilot 会话状态。
- 合并能够确认属于同一会话的 tmux 与 Agent 记录，减少重复卡片。

Agent 工作目录扫描会先列出识别到的会话，由用户确认后再加入看板：

![Agent 会话扫描](docs/readme-assets/app-discovery-dialog.png)

tmux 扫描会展示 session/window/pane、工作目录、前台命令及当前接管状态：

![tmux 会话扫描](docs/readme-assets/tmux-discovery-dialog.png)

### 5. 文件浏览器

聚焦终端旁边可以展开文件浏览器，终端上下文不会丢失。

![文件浏览器](docs/readme-assets/file-browser-drawer.png)

支持：

- 本地文件系统和 SSH/SFTP。
- 面包屑、上一级、过滤、隐藏文件和排序。
- 名称、大小、修改时间、Owner、权限及可拖动列宽。
- 文本预览、编辑和保存。
- Markdown 编辑/预览/分屏，以及 GFM、表格、任务列表和 KaTeX。
- 新建、重命名、删除、chmod、上传、下载和拖拽上传。
- 右键复制路径、下载、上传到目录、重命名、删除和 chmod。

### 6. VS Code Web

本地和 SSH 会话都可以在当前工作台打开 VS Code Web。

![VS Code Web](docs/readme-assets/vscode-drawer.png)

后端优先复用 `code-server`，其次支持 `openvscode-server`；本机未安装时可以尝试安装官方 standalone。SSH 模式通过本地转发代理远端 code-server。

浏览器默认使用“省内存”模式，只保留当前 iframe；“保持状态”模式最多保留最近 3 个 iframe，也可以手动释放隐藏 iframe。

### 7. Git Changes 与双 Diff Review

聚焦页的“变更”入口区分两个完全不同的语义：

- **本次任务**：本机 Codex 根据最新用户任务后的结构化文件操作记录归因。
- **当前工作区**：根据该会话真实工作目录读取 checkout 的 Git 状态和 Diff。

面板支持按路径筛选文件、按状态分组、查看增删统计、复制路径、引用文件到输入框，以及把当前文件内容放大到全屏 Diff。任务记录无法可靠归因时会明确降级，不会拿当前工作区 Diff 冒充 Agent 本次修改。

![任务与工作区双 Diff](docs/readme-assets/changes-review.png)

全屏模式保留文件选择、Diff 统计与操作入口，适合审查长文件或在较小窗口中查看变更：

![全屏文件变更](docs/readme-assets/changes-fullscreen-diff.png)

### 8. 结构化任务摘要与完整记录

本机 Codex 以及绑定本地 tmux 的 Agent 卡片会优先读取结构化 JSONL：

- 卡片只提取最新用户指令和最新 Agent 回复。
- 不调用大模型重新总结。
- 清理空白和 Markdown 标记，并做长度限制。
- 找不到结构化记录时回退到轻量终端预览。

聚焦页和手机当前会话都提供“完整记录”：用户消息与最终回答使用安全 Markdown/GFM/KaTeX 渲染，工具过程折叠，`exec` 调用及其输出不展示，避免日志噪声覆盖真正对话。

### 9. 手机工作区

手机端入口：

```text
https://<局域网地址>:<WEB_PORT>/?view=mobile
```

兼容 `/mobile`、`/m` 和 `#/mobile`。

手机首页先展示轻量注意力看板，不会为每个会话创建真实终端。底部导航包括：

- 看板
- 活动
- 当前会话
- 项目/文件

进入当前会话后才挂载真实终端。快捷键栏提供 `Ctrl+C/D`、`Esc`、`Tab`、`Shift+Tab`、方向键、清屏和常见行编辑控制键；单指滚动终端历史，双指缩放字号。

手机变更视图使用下拉框选择文件，避免完整文件列表占满屏幕；Diff 可以全屏查看，并支持复制路径或引用到输入框。

| 手机注意力看板 | 当前会话终端 | 手机 Changes |
| --- | --- | --- |
| ![手机注意力看板](docs/readme-assets/mobile-workspace.png) | ![手机当前会话终端](docs/readme-assets/mobile-terminal.png) | ![手机文件变更](docs/readme-assets/mobile-changes.png) |

### 10. 隐藏会话与安全操作

低优先级会话可以隐藏到抽屉，而不是直接删除。

![隐藏会话](docs/readme-assets/hidden-sessions-drawer.png)

隐藏不会终止底层进程。关闭 direct 会话、终止 tmux 等破坏性操作会明确展示确认；tmux 的“脱离会话”和“终止底层 session”是不同操作。

### 11. 资源调节与诊断

默认轻量预览不为每张卡片创建 xterm 和终端 WebSocket。需要实时小终端时，可以手动切换到完整预览。

资源诊断按需显示：

- 挂载中的 xterm 和终端视图。
- 活跃/隐藏终端 WebSocket。
- 会话快照吞吐和终端实时流吞吐。
- PTY replay 是否裁剪。
- 当前/隐藏 VS Code iframe。
- VS Code 代理 HTTP/WS 吞吐。
- 主线程 long task 和 Chromium JS heap。

高频终端输出触发的全量看板快照会在后端合并广播，卡片摘要请求也按时间桶刷新，避免持续输出形成请求风暴。

![资源调节与运行诊断](docs/readme-assets/resource-diagnostics.png)

### 12. 演示视频

<video src="docs/readme-assets/20260423_151840.mp4" controls muted playsinline width="100%"></video>

如果 Markdown 渲染器不支持内嵌视频，请直接打开：

[查看演示视频](docs/readme-assets/20260423_151840.mp4)

## 快速开始

### 环境要求

必需：

- Node.js 20 或更高版本。
- pnpm；仓库声明使用 `pnpm@10.13.1`。

按需：

- `tmux`：扫描、创建、接管和恢复 tmux 会话。
- OpenSSH 客户端：SSH PTY、远端 tmux、远端文件和远端 VS Code。

```bash
# Ubuntu / Debian
sudo apt update
sudo apt install -y tmux openssh-client

# Fedora / RHEL
sudo dnf install -y tmux openssh-clients

# macOS
brew install tmux
```

### 安装

```bash
git clone <your-repo-url>
cd coding_kanban
pnpm install
cp .env.example .env
```

### 推荐启动

```bash
./scripts/restart-dev.sh
```

脚本会：

1. 在停止旧后端前捕获可迁移会话状态。
2. 校验并释放目标端口。
3. 启动 Fastify 后端和 Vite 前端。
4. 默认启用 HTTPS，并准备开发证书。
5. 绑定前端到 `0.0.0.0`，输出 Local、Network、健康检查和日志地址。

局域网访问示例：

```text
https://10.30.0.22:8484
```

实际端口以 `.env` 和脚本输出为准。

### 其他启动方式

```bash
pnpm dev

# 或分别启动
pnpm --filter server run dev:app
pnpm --filter web run dev:app
```

健康检查：

```bash
curl http://127.0.0.1:4000/api/health
```

## 配置说明

所有机器相关配置都放在被 Git 忽略的 `.env` 中。完整注释见 [.env.example](.env.example)。

### 服务与 HTTPS

| 变量 | 默认示例 | 说明 |
| --- | --- | --- |
| `SERVER_BIND_HOST` | `0.0.0.0` | 后端监听地址 |
| `PORT` | `4000` | REST + WebSocket 端口 |
| `WEB_HOST` | `0.0.0.0` | Vite 监听地址，局域网联调必须可见 |
| `WEB_PORT` | `8484` | 前端端口 |
| `WEB_BACKEND_HOST` | `localhost` | Vite 代理目标主机 |
| `WEB_BACKEND_PORT` | `4000` | Vite 代理目标端口 |
| `WEB_HTTPS` | `1` | 默认 HTTPS；局域网 Notification 需要安全上下文 |
| `VITE_DEV_HTTPS_CA_CERT` | 可选 | 可公开下载并用于信任前端证书的 CA 公钥证书 |

### 终端与持久化

| 变量 | 默认示例 | 说明 |
| --- | --- | --- |
| `TERMINAL_SCROLLBACK_BYTES` | `4194304` | 每个活跃 PTY 的后端 replay 字节上限 |
| `TERMINAL_TMUX_CAPTURE_LINES` | `20000` | tmux observe/refresh 捕获行数 |
| `TERMINAL_REGISTRY_OUTPUT_ENTRIES` | `5000` | 无 live PTY 时的 registry 回放条目 |
| `VITE_TERMINAL_SCROLLBACK_LINES` | `20000` | 浏览器 xterm scrollback 行数 |
| `SESSION_STATE_PATH` | `.dev-runtime/agent-sessions.json` | 可恢复会话元数据；不保存终端正文和凭证 |
| `GIT_AUTO_PULL_INTERVAL_MINUTES` | `10`、`30` 或 `0` | 后台只 fetch/check，绝不自动 pull |

### 文件与 VS Code Web

| 变量 | 说明 |
| --- | --- |
| `FILE_BROWSER_DEFAULT_LOCAL_PATH` | 文件浏览器首次打开目录 |
| `VSCODE_WEB_EXTENSIONS_DIR` | code-server 共用扩展目录 |
| `VSCODE_WEB_PUBLIC_HOST` | 浏览器访问 `/vscode/` 的公共主机 |
| `VSCODE_WEB_BIND_HOST` | 本地 code-server 内部监听地址 |
| `VSCODE_WEB_REMOTE_BIND_HOST` | SSH 远端 code-server 监听地址，默认 `127.0.0.1` |
| `VSCODE_WEB_REMOTE_PORT` | 远端 code-server 首选端口，默认 `13338` |

## 完整功能说明

### 会话生命周期与状态

- 会话记录统一使用 `AgentSessionRecord`，包含来源、Agent、工作目录、连接状态、交互状态、摘要、Git 元数据和传输绑定。
- `running → idle/exited` 时产生待验收状态；聚焦查看后确认已读；新输入或恢复运行后清除旧待验收。
- 已读/未读状态随服务端会话状态持久化，刷新页面和跨设备访问保持一致。
- 明确等待输入的会话不会因“查看”而自动清除，只有实际发送输入或底层恢复执行才离开“需响应”。
- 会话支持重命名、隐藏、恢复、关闭、脱离 tmux、终止 tmux 和重连。

### 终端协议与输入兼容

- replay 完成前缓冲 live frame，防止历史与实时输出乱序。
- WebSocket 支持文本 stdin、resize 和 tmux 鼠标等 binary 消息。
- 实时连接异常后以 250ms～5s 有界退避重连；长期停在 `CONNECTING` 时主动回收。
- 支持 DA、DSR、CPR 等终端能力握手，并避免陈旧回复写入 shell。
- 支持 bracketed paste、Safari `insertText` 补救、CSI-u 修饰键、macOS Option/Windows Alt Meta 键。
- 支持 OSC 52 剪贴板，限制 target 和 payload 大小。
- tmux 输入经 attached client 保持当前 pane 语义，兼容 prefix、command-prompt、confirm-before 和 vi status keys。

### SSH 与远端工作流

- 从当前用户 `~/.ssh/config` 读取主机。
- 新建会话前预检远端目录、Agent 命令和 tmux 可用性。
- SSH 会话退出后仍保留最后输出、退出码和重连入口。
- 文件浏览器使用 SFTP，优先显式 identity file，其次标准默认私钥和 SSH Agent。
- VS Code Web 通过 SSH 本地转发访问远端 code-server。

### Git 与变更安全边界

- 卡片 Git 摘要和 Changes 面板使用固定参数的只读 Git 命令。
- 当前工作区 Diff 不执行 stage、discard、commit、merge、rebase、reset 或覆盖。
- 自动更新后台只执行 fetch/check；只有用户确认后才尝试当前 upstream 的 fast-forward。
- 本地修改、未跟踪文件冲突、分支分叉或 Git 失败时保持工作区不变。

### 应用更新与恢复

- 后端计算覆盖 tracked、untracked、branch 和 HEAD 的源码 revision。
- 前端发现新 revision 时显示非模态提示，不会在终端输入过程中自动刷新。
- 用户确认更新后保存恢复意图并 reload；同一 revision 不形成刷新循环。
- managed tmux 在后端重启后重新 attach；不存在的 tmux 不会根据旧命令自动重建。
- direct 会话只能保留 exited 卡片和元数据，需要手动恢复。

### 浏览器资源策略

- 看板默认轻量预览，不为非活跃卡片挂载 xterm。
- 会话数量超过阈值时按视口虚拟化卡片。
- 高频输出触发的全量快照合并到约 1 Hz。
- 卡片任务摘要和 Git 摘要使用分桶刷新，减少持续输出下的请求频率。
- VS Code iframe 默认只保留当前项；保持状态模式最多 3 个。
- 所有轻量动效只使用 `opacity/transform`，并遵循 `prefers-reduced-motion`。

## 典型工作流

### 工作流 A：启动一个本地 Codex 任务

1. 点击“新建会话”。
2. 选择本机、`codex` 和 tmux 模式。
3. 选择工作目录和用户分组。
4. 创建后在“执行中”列观察任务摘要和终端片段。
5. 任务结束后卡片进入“待验收”。
6. 双击查看结果；确认后进入“可继续”。

### 工作流 B：接管已有远端 tmux

1. 在 `~/.ssh/config` 中配置目标主机。
2. 按 `Ctrl/⌘+E`。
3. 选择主机并输入 tmux session 名。
4. 已存在则 attach，不存在则创建。
5. 在聚焦终端继续输入，旁边可以打开远端文件或 VS Code。

### 工作流 C：审查 Agent 改动并反馈

1. 聚焦目标会话。
2. 点击“变更”。
3. 在“本次任务”和“当前工作区”间切换。
4. 按路径筛选或从状态分组选择文件。
5. 点击“全屏查看”阅读完整 Diff。
6. 使用“引用文件”把 `@path` 插入当前输入框，再补充审查反馈。

### 工作流 D：手机接管长任务

1. 手机打开脚本输出的 Network 地址并加 `/?view=mobile`。
2. 在注意力看板中选择需响应或待验收任务。
3. 进入当前会话，使用快捷键和多行输入继续操作。
4. 查看完整记录或变更面板。
5. 手机 Diff 使用下拉框选择文件，必要时全屏阅读。

### 工作流 E：安全更新应用

1. 后台周期性 fetch 发现 upstream 有更新。
2. 页面显示更新提示，但不自动修改工作区。
3. 用户点击确认后执行 fast-forward 检查。
4. 成功后保存 managed tmux 和布局状态并 reload。
5. 有本地修改或分叉时保持原状态，并显示具体冲突原因。

## 快捷键

| 快捷键 | 作用 |
| --- | --- |
| `Ctrl/⌘+E` | 快速连接本机或 SSH tmux |
| `Ctrl/⌘+Shift+S` | 打开本地 tmux 扫描 |
| `Alt+Q` | 从聚焦视图返回看板 |
| `Tab` | 常规焦点切换 |
| `Esc` | 关闭支持 Escape 的弹窗、菜单或全屏 Diff |
| `Shift+Enter` | 跨平台终端换行，避免系统抢占 `Alt+Space` |

## 仓库结构

```text
apps/web/                 React 19 + Vite + xterm.js 前端
apps/server/              Fastify + WebSocket + node-pty + SSH/tmux 后端
packages/shared/          前后端共享 DTO、类型和协议
scripts/                  启动、重启、截图、演示和测试辅助脚本
tests/e2e/                Playwright 端到端测试
docs/                     PRD、架构、功能、排障和截图资源
memories/repo/            仓库级排障记忆，不参与产品运行
```

## 技术栈

- **前端**：React 19、Vite、TypeScript、xterm.js。
- **后端**：Fastify、`@fastify/websocket`、node-pty、ssh2。
- **终端**：本地 PTY、SSH PTY、tmux attach/scan/control。
- **文件**：Node.js 本地文件系统 + SSH/SFTP。
- **编辑器**：code-server / openvscode-server + `/vscode/` 代理。
- **测试**：Node test runner、Playwright。
- **包管理**：pnpm workspace。

## 开发与验证

```bash
pnpm dev          # 并发启动前后端
pnpm dev:restart  # 安全重启开发服务
pnpm build        # 构建 shared / server / web
pnpm check        # 类型检查并构建
pnpm test         # workspace 单元/集成测试 + scripts 测试
pnpm e2e          # Playwright E2E
pnpm format       # 格式化 workspace
```

常用定向命令：

```bash
pnpm --filter web test
pnpm --filter server test
pnpm --filter shared build
```

仓库要求行为改动使用红绿灯测试，并同步维护：

- [docs/func_list.md](docs/func_list.md)
- [docs/debug_list.md](docs/debug_list.md)
- 相关设计或 PRD

## 更新 README 截图

截图脚本会创建临时 demo 会话、操作当前 UI、保存截图并清理会话：

```bash
README_BASE_URL=https://127.0.0.1:8484 \
README_API_URL=http://127.0.0.1:4000 \
NODE_TLS_REJECT_UNAUTHORIZED=0 \
node ./scripts/generate-readme-screenshots.mjs
```

计划生成的主要资产包括：

```text
board-overview.png
board-sorting-and-summaries.png
app-discovery-dialog.png
tmux-discovery-dialog.png
new-session-dialog.png
focus-view.png
changes-review.png
changes-fullscreen-diff.png
file-browser-drawer.png
vscode-drawer.png
resource-diagnostics.png
quick-tmux-connect.png
hidden-sessions-drawer.png
mobile-workspace.png
mobile-terminal.png
mobile-changes.png
```

> [!NOTE]
> 当前服务器若报缺少 `libatk-1.0.so.0`、GTK、Cairo 等 Chromium 动态库，脚本无法启动 Playwright。请在有权限的 Linux 环境执行 `npx playwright install` 和 `sudo npx playwright install-deps`，或在已经具备 Chromium 运行库的机器上生成截图。不要使用真实生产会话生成 README 素材。

## 故障排查

### 页面或健康检查不可用

```bash
./scripts/restart-dev.sh
curl http://127.0.0.1:4000/api/health
```

端口以 `.env` 和启动日志为准。

### 手机或局域网设备无法访问

- 确认 `WEB_HOST=0.0.0.0`。
- 使用启动脚本输出的 Network 地址，不要使用手机上的 `localhost`。
- 放行前端端口。
- HTTPS 首次使用时在设备上信任开发 CA。
- 手机入口追加 `/?view=mobile`。

### SSH 主机列表为空

- 检查当前用户的 `~/.ssh/config`。
- 使用明确的 `Host` 条目。
- 确认当前后端用户可读取配置、私钥或 `SSH_AUTH_SOCK`。

### tmux 不可用

- 本机和目标 SSH 主机都需要安装 tmux。
- 非标准路径可设置 `TMUX_BINARY`。
- “脱离”只关闭当前接入；“终止 tmux”会杀掉真实底层 session。

### VS Code Web 无法打开

- 检查本地或远端是否能运行 code-server。
- 检查 SSH 本地转发和 `/vscode/` 代理。
- HTTPS/局域网环境需要信任开发 CA，否则 Service Worker、webview 或 iframe 可能失败。
- 可检查 `VSCODE_WEB_*` 配置。

### 浏览器内存或网络持续增长

1. 保持轻量预览。
2. 将 VS Code 设为省内存模式。
3. 释放隐藏 VS Code iframe。
4. 打开资源诊断，确认压力来自 xterm、终端 WebSocket、快照、实时流、VS Code 代理还是 heap。
5. 若诊断无明显来源但 heap 持续增长，使用 Chrome Heap Snapshot 对比 retained objects。

### Playwright 无法启动

若报缺少 `libatk-1.0.so.0` 等系统库：

```bash
npx playwright install
sudo npx playwright install-deps
```

无系统权限时仍可运行：

```bash
pnpm test
pnpm check
```

## 部署安全与边界

- 仅部署在可信本机或内网，不提供公网多租户安全边界。
- 不提交 `.env`、Token、SSH 私钥或主机相关凭证。
- 后端命令、路径和主机参数必须经过固定参数调用或严格校验。
- 自动更新不接受 HTTP 传入 remote、branch、ref、仓库路径或任意 Git 参数。
- 后台定时任务只 fetch/check，不自动 pull、merge、rebase、stash 或 reset。
- Git Changes 当前只读，不提供 stage、discard、commit 或覆盖工作区。
- 多屏终端不广播输入；始终只有一个当前输入窗格。
- direct PTY 无法跨后端重启恢复；需要恢复能力时使用 managed tmux。
- 完整记录和任务归因首版主要支持本机 Codex；远端和其他 Agent 会明确降级。
- 当前不是 Electron 桌面包，默认通过浏览器访问。

## 进一步文档

- [功能清单](docs/func_list.md)
- [项目概览](docs/project-overview.md)
- [Bug 修复记录](docs/debug_list.md)
- [手机终端适配](docs/mobile-terminal-adaptation.md)
- [文件浏览器架构](docs/specs/2026-04-20-file-browser-architecture.md)
- [双 Diff 架构](docs/specs/2026-08-14-dual-diff-architecture.md)
- [v1.4.0 PRD](docs/plans/2026-08-12-v1.4.0-prd.md)

## License

参见 [LICENSE.txt](LICENSE.txt)。
