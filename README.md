# Coding Kanban

面向 CLI Coding Agent 的本地/内网工作台。

Coding Kanban 把本地 PTY、SSH 远端 PTY、tmux、Agent 工作目录扫描、文件浏览器、VS Code Web、手机端终端控制页放到同一个浏览器工作台里。它的目标不是做公网 SaaS，而是把“同时观察多个 Agent → 聚焦一个终端继续输入 → 旁路查看文件或打开 VS Code → 必要时从手机接管”压缩成一个连续工作流。

> 安全边界：后端可以执行终端、SSH、tmux 和文件系统操作。请部署在可信本机或内网环境，不要直接暴露到公网。

## 你会用它解决什么

- **多 Agent 看板**：同时观察多个 `copilot`、`codex`、`claude` 或 shell 会话，快速判断谁在运行、谁在等待输入。
- **终端接管**：双击卡片进入聚焦视图，用真实 xterm.js 继续输入；多屏布局可同时监控多个终端，但输入只落到一个“输入中”窗格。
- **tmux 接入**：扫描本机/远端 tmux，把已有 pane 加入看板；也可以用快捷键快速创建或 attach tmux session。
- **远端工作流**：读取 `~/.ssh/config`，支持 SSH PTY、SSH tmux、远端文件浏览、远端 VS Code Web。
- **文件和编辑器**：聚焦终端旁边打开文件浏览器或 VS Code Web，不必在浏览器、终端、编辑器之间反复切窗口。
- **手机端控制**：用 `/?view=mobile` 打开手机端页面，提供 `Ctrl+C`、`Esc`、方向键、Tab、Enter、EOF、终端历史滑动和双指缩放。
- **资源控制**：默认轻量预览，避免每张卡片都开终端 WebSocket；资源调节菜单提供 VS Code iframe 省内存、缓存释放和浏览器资源诊断。

## 快速导航

- [截图导览](#截图导览)
- [快速启动](#快速启动)
- [核心功能](#核心功能)
- [常用工作流](#常用工作流)
- [资源与性能策略](#资源与性能策略)
- [仓库结构](#仓库结构)
- [常用命令](#常用命令)
- [截图更新](#截图更新)
- [故障排查](#故障排查)
- [当前边界](#当前边界)

## 截图导览

截图素材位于 `docs/readme-assets/`。如果你刚改过 UI，可以按 [截图更新](#截图更新) 重新生成。

### 架构总览

![架构总览](docs/readme-assets/architecture-overview.svg)

### 使用工作流

![使用工作流](docs/readme-assets/usage-workflow.svg)

### 安装和启动流程

![安装流程](docs/readme-assets/install-flow.svg)

### 看板总览

宫格展示未隐藏会话，卡片上直接显示名称、状态、Agent 类型、主机、工作目录和轻量终端预览。默认轻量预览不会为每张卡片打开真实 xterm 或终端 WebSocket。

![宫格总览](docs/readme-assets/board-overview.png)

### 聚焦终端

双击卡片进入聚焦视图。主区域是真实可输入终端；右侧保留其他会话上下文，也可以折叠减少桌面占用。

![聚焦终端](docs/readme-assets/focus-view.png)

### 新建会话

新建会话支持本机和 SSH 主机，Agent 类型支持 `copilot`、`codex`、`claude`、`shell`，启动方式支持直接创建或从 tmux 创建。

![新建会话](docs/readme-assets/new-session-dialog.png)

### 快速连接 tmux

按 `Ctrl/⌘+E` 打开快速连接 tmux，会话存在即 attach，不存在则创建。该入口适合临时接管本机或远端已有工作区。

![快速连接 tmux](docs/readme-assets/quick-tmux-connect.png)

### 隐藏会话

不想临时处理的会话可以隐藏到抽屉里，之后再恢复或关闭，避免看板被低优先级任务占满。

![隐藏会话](docs/readme-assets/hidden-sessions-drawer.png)

### 演示视频

<video src="docs/readme-assets/20260423_151840.mp4" controls muted playsinline width="100%"></video>

如果 Markdown 渲染器不支持内嵌视频，可以直接打开：

[docs/readme-assets/20260423_151840.mp4](docs/readme-assets/20260423_151840.mp4)

## 快速启动

### 环境要求

必需：

- Node.js 20 或更新版本。
- pnpm，仓库声明使用 `pnpm@10.13.1`。

按需安装：

- `tmux`：创建、扫描、接管、恢复 tmux 会话时需要。
- OpenSSH 客户端：连接 SSH 远端时需要。

常见系统安装：

```bash
# Ubuntu / Debian
sudo apt update
sudo apt install -y tmux openssh-client

# Fedora / RHEL
sudo dnf install -y tmux openssh-clients

# macOS
brew install tmux
```

### 安装依赖

```bash
git clone <your-repo-url>
cd coding_kanban
pnpm install
```

### 配置环境变量

推荐复制模板：

```bash
cp .env.example .env
```

常用配置：

| 变量                              | 作用                              | 默认值                                   |
| --------------------------------- | --------------------------------- | ---------------------------------------- |
| `HOST`                            | 后端 Fastify 监听地址             | `0.0.0.0`                                |
| `PORT`                            | 后端 REST + WebSocket 端口        | `3200`                                   |
| `WEB_HOST`                        | Vite 前端监听地址                 | `0.0.0.0`                                |
| `WEB_PORT`                        | Vite 前端端口                     | `3100`                                   |
| `WEB_BACKEND_HOST`                | 前端代理到后端的主机              | `localhost`                              |
| `WEB_BACKEND_PORT`                | 前端代理到后端的端口              | `3200`                                   |
| `FILE_BROWSER_DEFAULT_LOCAL_PATH` | 文件浏览器默认本地目录            | 自动探测仓库根目录                       |
| `VSCODE_WEB_EXTENSIONS_DIR`       | VS Code Web 扩展目录              | `~/.vscode-server/extensions` 或内置目录 |
| `VSCODE_WEB_PUBLIC_HOST`          | 浏览器访问 `/vscode` 的公共主机名 | 当前请求 Host                            |
| `VSCODE_WEB_BIND_HOST`            | 本地 code-server 绑定地址         | `0.0.0.0`                                |
| `VSCODE_WEB_REMOTE_BIND_HOST`     | SSH 远端 code-server 绑定地址     | `127.0.0.1`                              |
| `VSCODE_WEB_REMOTE_PORT`          | SSH 远端 code-server 固定端口     | `13338`                                  |

说明：

- `.env` 会被 git 忽略，适合写本机端口、路径和主机配置。
- `scripts/restart-dev.sh` 会读取 `.env`。
- 如果没有 `.env`，`restart-dev.sh` 自身默认前端 `3100`、后端 `3200`。
- 如果直接复制 `.env.example`，其中 `WEB_PORT=3100`、`PORT=3200` 会保持脚本默认端口。

### 推荐启动方式

```bash
./scripts/restart-dev.sh
```

脚本会完成这些事：

- 释放目标端口上的旧前后端进程。
- 启动 Fastify 后端。
- 启动 Vite 前端并绑定 `0.0.0.0`，方便局域网访问。
- 默认使用 HTTPS 协议，并自动准备开发证书。
- 输出 Local / Network 前端地址、后端健康检查地址和日志路径。

从手机或同网段机器访问，使用脚本输出的 `Network` 地址，例如：

```text
https://10.30.0.22:3100
```

### 备用启动方式

```bash
pnpm dev
```

或分别启动：

```bash
pnpm --filter server dev
pnpm --filter web dev
```

健康检查：

```bash
curl http://127.0.0.1:4000/api/health
```

如果你用 `.env` 改了端口，请替换成实际后端端口。

## 核心功能

### 1. 会话看板

- 展示所有未隐藏的 `AgentSessionRecord`。
- 卡片显示名称、状态、Agent 类型、主机、工作目录和轻量终端文本预览。
- 支持按服务器、Agent 类型、tmux 类别和目录关键字筛选。
- 支持重命名、隐藏、恢复、删除、关闭/脱离、终止 tmux、复制 tmux attach 命令。
- 筛选行展示小号“等待输入 / 运行中”统计徽标，快速判断当前任务状态。
- 双击卡片进入聚焦视图。

### 2. 聚焦终端和多屏监控

- 聚焦视图主区域是真实 xterm.js 终端。
- 支持单屏、左右双屏、上下双屏、左中右三屏、四屏、六屏、八屏布局。
- 多窗格可以同时观察多个真实终端。
- 输入所有权始终只有一个“输入中”窗格，不做广播输入。
- 右侧其他会话卡片可拖入分屏窗格；窗格头部也可以互相拖拽交换会话位置。
- 右侧“其他会话”侧栏可折叠，折叠后只保留窄标签。

### 3. 终端 WebSocket 和轻量预览

- 聚焦终端通过 `/ws/agent-sessions/:id/terminal` 接收 scrollback replay 和实时输出。
- replay 完成前会缓冲 live frame，避免历史输出和新输出乱序。
- 支持 stdin、resize、binary 消息，binary 用于 tmux 鼠标等二进制事件。
- 默认轻量预览模式下，宫格卡片和聚焦侧栏不打开真实终端 WebSocket，只展示 `outputPreview`。
- 可从“资源调节”菜单切换到完整预览模式，恢复旧版小终端实时预览。
- 后端会合并高频终端输出触发的看板全量快照，降低网络流量和浏览器 JSON 解析压力。

### 4. 手机端终端控制页

- 默认入口：`/?view=mobile`。
- 兼容入口：`/mobile`、`/m`、`#/mobile`。
- 手机端使用单会话全屏终端，不复用桌面分屏和侧栏布局。
- 底部快捷键条支持中断、Esc、Tab、Enter、EOF、方向键、清屏、行首、行尾。
- 快捷键按原始 stdin 控制字符发送，Tab、Esc、Ctrl+C、方向键不会被额外追加 Enter。
- “说明”按钮会展示各快捷键作用。
- 多行输入框用普通 `<textarea>` 承载手机输入法，支持发送、粘贴、粘贴执行。
- 终端区域接管触控滚动，避免长上下文下拉时触发浏览器刷新。
- 单指滑动滚动 xterm scrollback，双指 pinch 调整终端字号。

### 5. 新建、扫描和接入

- 新建会话支持本机和 SSH 主机。
- Agent 类型支持 `copilot`、`codex`、`claude`、`shell`。
- 启动方式支持 `direct` 和 `tmux`。
- 名称为空时，前端会根据主机、Agent 类型和启动方式生成唯一默认名。
- 支持扫描本机或 SSH 远端 tmux，并把运行中的 pane 接入为可交互终端。
- 支持扫描本地或 SSH 远端 Agent 工作目录，识别 Copilot `session-state`，并和 tmux pane 合并减少重复卡片。

### 6. 文件浏览器

- 聚焦视图中可打开文件浏览器。
- 支持本地文件系统和 SSH/SFTP 远端文件系统。
- 支持面包屑、返回上一级目录、显示隐藏文件、过滤、排序。
- 支持文本预览和编辑保存。
- 支持新建文件/目录、重命名、删除、chmod、上传、下载、拖拽上传。
- 右键菜单支持上传到当前目录或选中目录、下载、重命名、删除、复制路径、chmod。
- 文件面板宽度、预览高度等状态保存在 `localStorage`。

### 7. VS Code Web

- 聚焦本地会话和 SSH 远端会话时都可以打开内嵌 VS Code Web。
- 本地优先复用 `code-server`，其次支持 `openvscode-server`。
- 找不到 code-server 时，会尝试自动安装官方 standalone 版本。
- SSH 远端通过 SSH 启动/复用远端 code-server，再由当前后端代理到 `/vscode/`。
- 本地会话使用稳定 `.code-workspace` 文件；SSH 远端会话直接打开远端工作目录。
- 扩展目录优先复用用户的 `~/.vscode-server/extensions`。
- 浏览器 iframe 默认使用“VS Code 省内存”模式，只保留当前 iframe。
- 可切换到“VS Code 保持状态”模式，最多保留最近 3 个 iframe。
- “释放 VS Code 缓存”只卸载非当前 iframe，不停止后端 code-server 进程。

### 8. 顶栏、快捷键和状态持久化

- 桌面标题区显示“电脑端 Coding Kanban”，并提供“手机端 Coding Kanban”入口。
- 手机端标题区显示“手机端 Coding Kanban”，并提供“电脑端 Coding Kanban”入口。
- 顶栏按“端切换品牌 / 主操作 / 当前会话工具 / 工具 / 资源调节 / 窗口控制”分组。
- `Ctrl/⌘+E` 打开快速连接 tmux。
- `Ctrl/⌘+Shift+S` 打开本地 tmux 扫描。
- `Alt+Q` 从聚焦视图返回宫格。
- `Tab` 用于常规焦点切换。
- 顶栏折叠、文件浏览器布局、聚焦视图状态、侧边工具选择、VS Code iframe 缓存模式等 UI 偏好保存在浏览器本地。

## 常用工作流

### 新建一个本地 Agent

1. 点击“新建会话”。
2. 选择“本机”。
3. 选择 `copilot`、`codex`、`claude` 或 `shell`。
4. 输入工作目录。
5. 选择 `direct` 或 `tmux`。
6. 创建后双击卡片进入聚焦视图。

### 连接 SSH 远端

先配置 `~/.ssh/config`：

```sshconfig
Host devbox
  HostName 10.30.0.24
  User your-user
  Port 22
```

然后在新建会话、扫描会话、扫描 tmux、快速连接 tmux 或文件浏览器中选择该主机。

### 扫描 tmux

1. 点击顶栏“扫描”。
2. 选择“扫描 tmux”。
3. 选择本机或 SSH 主机。
4. 把已有 tmux pane 加入看板，或接管为可交互终端。

快捷键：`Ctrl/⌘+Shift+S` 会直接打开本地 tmux 扫描。

### 快速连接 tmux

1. 按 `Ctrl/⌘+E`。
2. 选择本机或 SSH 主机。
3. 输入 tmux session 名和工作目录。
4. 系统运行 `tmux new-session -A -s <session> -c <dir>`。

### 打开文件浏览器

1. 双击卡片进入聚焦视图。
2. 点击顶栏“文件”。
3. 使用面包屑或名称旁的上箭头切目录。
4. 预览、编辑、上传、下载或右键管理文件。

### 打开 VS Code Web

1. 双击本地或 SSH 会话进入聚焦视图。
2. 点击顶栏“VS Code”。
3. 根据需要在“资源调节”里切换“VS Code 省内存 / VS Code 保持状态”。
4. 如果浏览器内存偏高，点击“释放 VS Code 缓存”卸载非当前 iframe。

### 手机接管终端

1. 在同网段手机浏览器打开桌面页的同一个 Network 地址。
2. 点击标题区的“手机端 Coding Kanban”，或直接访问 `/?view=mobile`。
3. 选择会话。
4. 用底部快捷键条发送 `Ctrl+C`、`Esc`、方向键、Tab、Enter 等控制字符。
5. 单指上下滑动查看终端历史，双指缩放字体。

## 资源与性能策略

Coding Kanban 的默认策略是“先省资源，再按需打开完整实时能力”。

- **轻量预览默认开启**：卡片和侧栏只展示轻量文本预览，不为非活跃会话打开终端 WebSocket。
- **完整预览按需开启**：需要实时小终端预览时，可在“资源调节”里切换回完整预览。
- **会话快照合并广播**：高频终端输出不会逐帧触发全量看板快照，默认最多约每秒刷新一次卡片摘要。
- **VS Code iframe 省内存**：默认只保留当前 iframe；保持状态模式最多保留最近 3 个。
- **释放 VS Code 缓存**：可手动卸载隐藏 iframe，释放浏览器内存。
- **资源诊断**：展示 xterm 实例数、终端 WebSocket 数、会话快照吞吐、终端实时流吞吐、VS Code iframe 数、VS Code 代理吞吐、主线程 long task 和 JS heap。
- **轻量动效**：菜单、诊断面板、主机下拉、卡片、抽屉和弹窗只动画 `opacity` 与 `transform`，并遵循 `prefers-reduced-motion`。

## 仓库结构

```text
apps/web/                React + Vite + xterm.js 前端
apps/server/             Fastify + WebSocket + PTY/SSH/tmux 后端
packages/shared/         前后端共享 DTO、类型和协议
packages/agent-protocol/ Agent 运行时协议定义
packages/ui/             预留的跨应用 UI 原语
scripts/                 开发、重启、截图和辅助脚本
tests/e2e/               Playwright 端到端测试
docs/                    功能说明、项目概览、设计文档和截图资源
memories/                仓库级排障记忆，不参与产品运行
```

## 技术栈

- 前端：React 19、Vite、TypeScript、xterm.js。
- 后端：Fastify、@fastify/websocket、node-pty、ssh2、TypeScript。
- 文件系统：本地 FS + SSH/SFTP。
- 终端：本地 PTY、SSH PTY、tmux attach/scan/control。
- VS Code Web：code-server / openvscode-server + `/vscode/` 代理。
- 测试：Node test runner、Playwright。
- 包管理：pnpm workspace。

## 常用命令

```bash
pnpm dev          # 并发启动前后端
pnpm dev:restart  # 调用 scripts/restart-dev.sh
pnpm build        # 构建 shared / server / web
pnpm check        # 类型检查 + 构建
pnpm test         # 运行所有 workspace test
pnpm e2e          # 运行 Playwright E2E
pnpm format       # 格式化全仓库
```

更常用的定向验证：

```bash
pnpm --filter web test
pnpm --filter server test
pnpm --filter shared build
```

## 截图更新

截图脚本：

```bash
node ./scripts/generate-readme-screenshots.mjs
```

运行前请先启动前后端。脚本会读取 `.env`，默认使用当前配置里的前端和后端地址。也可以手动覆盖：

```bash
README_BASE_URL=http://localhost:3000 \
README_API_URL=http://127.0.0.1:4000 \
node ./scripts/generate-readme-screenshots.mjs
```

脚本会创建临时 demo 会话、截图、再清理 demo 会话。建议使用一套干净的临时开发服务生成截图，避免真实会话混入 README 素材。

Linux 上如缺少浏览器依赖：

```bash
npx playwright install
sudo npx playwright install-deps
```

如果环境不能安装系统依赖，可以在具备 Playwright Chromium 运行库的机器上生成截图后提交 `docs/readme-assets/`。

## 故障排查

### 页面打不开

```bash
./scripts/restart-dev.sh
curl http://127.0.0.1:4000/api/health
```

如果复制了 `.env.example`，后端端口可能是 `4000`。如果你使用自己的 `.env`，请按实际 `PORT` 检查。

### 手机或局域网设备访问不了

- 确认前端绑定 `0.0.0.0`，不要只绑定 `localhost`。
- 使用 `restart-dev.sh` 输出的 `Network` 地址。
- 确认前端绑定 `0.0.0.0`（已默认）。
- 检查防火墙是否放行前端端口。
- 手机端默认入口为 `/?view=mobile`。

### SSH 主机列表为空

- 检查 `~/.ssh/config` 是否存在。
- 使用明确的 `Host` 条目，避免只依赖通配符。
- 确认当前用户可读取该文件。
- 远端目录建议、远端 tmux、远端 VS Code Web 依赖当前用户可用的 SSH 认证。

### tmux 功能不可用

- 确认本机已安装 `tmux`。
- 如果 tmux 不在标准路径，设置 `TMUX_BINARY`。
- SSH 远端 tmux 需要远端主机也安装 tmux。
- `kill tmux` 会终止底层真实 tmux session，请确认后再执行。

### VS Code Web 打不开

- 确认本机或远端能启动 `code-server`。
- 本地找不到时会尝试 `openvscode-server` 或自动安装 code-server standalone。
- SSH 远端依赖后端能建立 SSH 本地转发。
- 如遇预览或 webview 异常，检查 code-server 是否正常运行。
- 可检查 `VSCODE_WEB_EXTENSIONS_DIR`、`VSCODE_WEB_PUBLIC_HOST`、`VSCODE_WEB_BIND_HOST`、`VSCODE_WEB_REMOTE_BIND_HOST`、`VSCODE_WEB_REMOTE_PORT`。

### 浏览器内存继续增长

- 保持“轻量预览”模式。
- VS Code iframe 使用“省内存”模式；只有需要保留编辑器状态时再切到“保持状态”。
- 用“释放 VS Code 缓存”卸载非当前 iframe。
- 打开“资源诊断”查看增长来源：xterm、终端 WebSocket、会话快照、终端实时流、VS Code iframe、VS Code 代理流量、JS heap 或主线程 long task。
- 如果资源诊断没有明显压力源但 heap 持续增长，应抓取 Chrome Heap Snapshot 对比 retained objects。

### Playwright 无法启动

如果报缺 `libatk-1.0.so.0` 等系统库，需要安装 Playwright 浏览器依赖：

```bash
npx playwright install
sudo npx playwright install-deps
```

在无法安装系统库的环境中，可以只运行 Node 测试和构建：

```bash
pnpm test
pnpm check
```

## 当前边界

- 会话注册表主要存在当前后端进程内存中，后端重启后仍需要重新扫描/接入。
- 底层 tmux 会话通常仍存在，可以通过扫描重新加入看板。
- 本地 direct PTY 一般会随后端退出而结束。
- VS Code iframe 自动超时卸载暂未默认启用。
- 多终端监控不支持广播输入，设计上只允许一个“输入中”窗格。
- 本项目面向可信内网环境；不要把执行能力直接暴露到公网。
- Electron 打包仍是后续方向，不是当前默认分发方式。

## 进一步文档

- 功能清单：`docs/func_list.md`
- 项目概览：`docs/project-overview.md`
- Bug 修复记录：`docs/debug_list.md`
- 手机端适配说明：`docs/mobile-terminal-adaptation.md`
- 文件浏览器设计背景：`docs/specs/2026-04-20-file-browser-architecture.md`
