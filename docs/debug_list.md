# Coding Kanban Bug 修复记录

本文档根据现有仓库记忆整理历史 bug 修复记录。后续每次修复 bug，都应在本文件追加简短记录，说明现象、根因和关键修复点。

- `local-fs-service.test.ts` 中 chmod 测试使用 `640` 但 `validateChmodMode` 要求八进制模式必须以 `0` 开头（如 `0640`）。修复为更新测试值为 `0640`。
- `relativePaths` 解析后直接用于 `path.join(targetDirectory, relativePaths[fileIndex])`，未校验 `..` 分段，可构造 `../../../etc/passwd` 实现目录穿越上传。修复为在解析后逐条调用 `assertSafeFilesystemPath` 校验路径条目。
- `buildRemoteCommand` 对 `input.command` 仅做单引号包裹，未拦截反引号 `$() \"` 等危险 shell 元字符，攻击者可注入命令。修复为执行前用正则 `[\x00-\x1f\x7f`$\"\\]` 检测危险字符，超标则拒绝执行。
- `chmod` 路由对 mode 参数只做了 `assertSafeFilesystemPath`，但文件系统工具层的 `assertSafeFilesystemPath` 只检查 `..` 和控制字符，不校验 mode 格式（如 `0777`/`0x755`）或危险权限位（setuid/setgid/world-writable 组合）。修复为 `LocalFsService` 新增 `validateChmodMode` 校验八进制格式并阻断危险权限位组合。
- SFTP `chmod` 路由只调用 `assertSafeFilesystemPath`，未复用 `LocalFsService` 的 `validateChmodMode` 校验，导致远端 chmod 仍可接受非八进制格式和危险权限位组合。修复为将 `validateChmodMode` 提取到 `file-system-utils.ts` 共享模块，SFTP 和本地服务均使用同一校验。
- `App.tsx` 的 `handleCopyConnectCommand` 直接调用 `navigator.clipboard.writeText`，在 HTTP 页面或权限受限时失败。修复为使用已有的 `copyTextToClipboard` 工具，优先 API 失败时回退到 textarea + execCommand。

## 焦点与输入

- 文件浏览器右键文件或文件夹后点击“复制路径”在局域网 HTTP 页面会失败。根因是代码直接调用 `navigator.clipboard.writeText`，而 Clipboard API 在非安全上下文或权限受限时不可用。修复为增加剪贴板 helper，优先使用 Clipboard API，不可用或被拒绝时回退到隐藏 textarea + `execCommand('copy')`，并补右键文件/目录复制路径回归测试。
- 多屏聚焦视图中，选中不同终端后顶部标题栏和“改名”按钮仍指向最初进入聚焦页的终端。根因是标题栏直接读取 App 层 `focusedSession`，而多屏切换输入窗格在侧栏工具未打开时不会同步外层 focused session。修复为标题、状态、改名和重连按钮优先使用当前 active monitor slot 对应的 session，找不到时再回退到 `focusedSession`。
- 多屏聚焦视图从“其他会话”拖入屏幕时，浏览器拖拽缩影会混入多个其他会话预览。根因是未显式设置 drag image，浏览器默认截图包含终端预览的侧栏卡片时容易把相邻缩影一起带入拖影。修复为拖拽开始时创建只包含当前会话名称和少量输出的专用单会话拖影，拖拽结束或 drop 后清理。
- 聚焦视图静态区域点击后，Copilot CLI 会出现“界面还在但无法继续输入”或首字符重复。根因是 `AgentFocusView` 过度依赖 `keydown` 阶段补发事件，且把按钮/链接当作输入控件。修复为在静态区域 `pointerdown` 直接把焦点还给 xterm，并避免重复转发首字符。**修复：已在本版本实现。`handleKeyDown` 在转发前先检查 `active === document.body || active === null`，在点击静态区域后的短暂过渡期间（`focusActiveTerminalTextarea()` 异步调度 focus）跳过转发，由 textarea 原生 input handler 自然处理按键，避免同一按键被发两次。**
- 分栏模式下，从终端点击回 VS Code iframe 后，终端会把焦点抢回。根因是 `TerminalView` 只把原生表单控件视为“有意外部焦点”。修复为把 `iframe` 纳入允许外部焦点的白名单。
  - **修复**: `TerminalView.tsx:1104` — 在 `handlePointerDownCapture` 中增加 `isProtectedExternalFocusTarget` 检查，防止把 `iframe` 等受保护元素的点击事件误判为终端意图而抢回焦点。
- 分栏模式下，从终端切到文件浏览器编辑器或 VS Code 后，输入过程中焦点仍可能被终端抢走。根因是终端只看当前 `document.activeElement`，在 blur/focus 交接瞬间看到 `body` 就误判需要抢焦点；同时 VS Code 抽屉把 `reused` 变化当成新实例。修复为增加外部输入焦点保护窗口，并忽略 `reused` 单独变化带来的 iframe 重载。
  - **修复**: `TerminalView.tsx:1109` — 在 `handlePointerDownCapture` 保护返回分支中也调用 `rememberExternalPointerIntent`，让受保护元素（iframe）的点击同样启动 750ms 焦点保护窗口，防止后续 `scheduleFocusInteractiveTerminal` 把焦点从 VS Code 抢回。同时 `vscode-drawer-state.ts` 的 `applyVsCodeWebOpenResponse` 已忽略 `reused` 单独变化（`isSameResponse` 只比对 url/provider/workingDirectory）。
- VS Code 分栏打开时，用户已经点回终端输入，过一会仍可能再次失焦，必须再点一次终端才能继续。根因是 `TerminalView` 只在离散 blur/focus 事件上补救，缺少对“最近一次本来就是终端”的被动失焦修复；当 VS Code iframe 生命周期让焦点短暂掉到 `body` 时，终端不会自动补回。修复为记录最近一次终端/外部焦点意图，并仅在“最近一次是终端”时启动轻量焦点修复守护。
- 终端已经进入可输入状态时，空闲一阵后仍可能再次失焦，必须补点一下才能继续输入。根因是被动焦点修复把“从未有外部输入控件接管过焦点”的场景也判成了“没有足够证据归还终端”，导致活动终端在默认输入 owner 身份下发生焦点漂移时不会自动修复。修复为让 `TerminalView` 在没有受保护外部焦点记录时默认继续修复活动终端的 helper textarea。
- VS Code / 文件浏览器分栏打开时，用户点回终端后仍可能被后台 iframe 或编辑器的程序化 `focus()` 抢走，表现为过一会又要补点终端。根因是 `TerminalView` 把当前 `document.activeElement` 是 iframe/input 直接等价为“用户有意选择外部输入”，没有区分用户点击和后台被动 focus；隐藏保活的侧栏面板也仍可参与焦点竞争。修复为把焦点所有权改成最近一次用户意图模型：只有外部指针、外部键盘输入或带用户激活的 iframe focus 才能接管；终端点击后后台 focus 不再覆盖；非 active 侧栏面板加 `inert` 并在隐藏时释放内部焦点。
- 本机连接其他服务器时，看板文件浏览器报 `All configured authentication methods failed`、看不到远端文件列表。根因是终端会走系统 `ssh`，能自动使用默认私钥；但文件浏览器走后端 `ssh2` 的 SFTP 直连，只会在 `identityFile` 显式配置时携带私钥，导致未写 `IdentityFile` 的主机全部认证失败。修复为 SFTP 认证优先使用显式 `identityFile`，否则回退到标准默认私钥，并兼容 `SSH_AUTH_SOCK`。
- 远端 SSH 会话已在线时，打开文件浏览器仍偶发空白并报 `write ECONNRESET` / `No response from server`。根因是 `SftpService` 在 SSH 连接 `ready` 前就把连接对象放进池里，导致并发的首批 `/api/fs/list` 请求复用了半初始化连接。修复为复用现有连接前先等待 `ready` 完成，并在连接失败时及时从池里移除。
- 远端 SSH 会话已退出或目标并不提供 shell（如 Gerrit SSH 接口）时，kanban 卡片终端只显示 `[连接已断开]`，看不到真实错误。根因是 PTY 退出后 runtime handle 立即删除，terminal websocket 再连接时拿不到历史回放，只能 4004 关闭并让前端退化成泛化断开提示。修复为 terminal websocket 在 runtime 已退出但 session 仍存在时，回退到 registry 的历史输出回放。

## 终端协议与 TUI 握手

- live stdin 过滤掉 DA/DSR/OSC/DCS 应答时，Copilot CLI 等 TUI 会卡在能力握手阶段并静默丢输入。修复为只清洗 replay 内容，不过滤 live stdin 的握手/状态应答。
- 终端 focus-report mock 没有先进入 raw mode，会导致 `CSI I/O` 焦点事件被行缓冲，产生假红测试。修复为在断言聚焦输入前显式把 mock stdin 切到 raw mode。
- shell/prompt 行编辑态触发的 Secondary DA 原样转发会把终端版本串回显到提示符。修复为仅过滤这类会污染 shell 提示符的 Secondary DA，应答性能力握手仍保留。
- kanban 终端偶发回显 `11;rgb:... 10;rgb:... 4;...`。根因是 OSC 10/11/4 color-query replies 通过 live stdin 泄漏到 PTY。修复为在 live stdin 路径做窄化过滤，只屏蔽这类 rgb 回包，同时保留 DA/DSR/CPR 等握手回复。

## tmux 与终端渲染

- tmux mouse mode 下直接拖拽会被 tmux/TUI 接管，浏览器侧 xterm 不会产生可复制 selection，导致 kanban 无法把 pane 内选择自动写入剪贴板。修复为 `TerminalView` 消费 OSC 52 clipboard 请求并调用浏览器剪贴板 API，让 tmux copy-mode 负责 pane 内选择边界，普通鼠标/二进制事件转发保持不变。
- 手机浏览器打开 Codex 长上下文终端时，用户在终端区域下拉查看历史会触发浏览器下拉刷新，或者滑动的是页面而不是 xterm 历史。根因是移动端仍复用桌面页面滚动结构，浏览器根滚动链路没有被锁住；首版终端 touch 监听只在冒泡阶段接管，遇到 xterm 内部 viewport/浏览器手势竞争时拦截不够早，且用户停留在桌面聚焦页时没有启用手机触控模式。修复为新增 `/mobile` 手机终端页，挂载时锁定 `html/body/#root` 滚动，并让 `TerminalView` 在手机触控模式下用捕获阶段的非 passive `touchstart/touchmove` 拦截单指滑动、滚动 xterm 历史，双指缩放字号；触屏设备的桌面聚焦页也启用同一逻辑。
- 手机访问 `/mobile` 进不去或 404。根因是部分当前运行入口只暴露根页面或只启动了后端，`/mobile` 这种 history route 依赖前端开发服务/静态服务提供 SPA fallback。修复为移动端按钮改用 `/?view=mobile` 根路径 query 入口，并保留 `/mobile`、`/m`、`#/mobile` 兼容解析。
- 手机端 Tab、Esc、Ctrl+C、方向键等快捷键在部分会话里会变成”控制键 + Enter”或不能作为真实按键送入 Codex。根因是手机端快捷键走已有 stdin 路由，而旧的非 PTY runtime 会给任意输入追加换行，tmux 控制路径也把输入按行拆分并总是补 Enter。修复为对 stdin payload 做控制字符识别：普通文本仍可补换行提交，Tab/Esc/Ctrl/方向键和多行粘贴按原始输入转发；tmux 接入路径把通用控制字符转换成 `send-keys` 按键名但不增加 tmux 专用快捷键按钮。
- 手机端快捷键缺少 Claude / Copilot CLI 常用控制键，`Shift+Tab`、`Ctrl+O`、`Ctrl+E` 以及行编辑组合无法从手机触发；同时新增类型里残留旧 `line-start/line-end` id，存在构建失败风险。修复为扩展快捷键表到 `Shift+Tab`、`Ctrl+U/W/K/Y/A/O/E`，并让本地 tmux 转换层把对应控制字符映射到 `BTab`、`C-o`、`C-e` 等 tmux key name，避免注入不可见 literal。
- 手机端快捷键说明弹窗缺少 `aria-modal`、`aria-labelledby` 和 Tab 聚焦陷阱，屏幕阅读器用户无法正确聚焦弹窗。修复为弹窗增加 `aria-modal=”true”`、`aria-labelledby` 指向标题、Tab 循环限制和 Escape 关闭，卸载时还原页面焦点。
- 手机端快捷键工具栏一度改成多行平铺后占用手机纵向空间，且不符合用户希望“单行左右滑动选择”的操作预期。修复为保持 `flex` 单行横向选择器，使用 `overflow-x: auto` 和 `touch-action: pan-x` 支持左右滑动，并把 `EOF` 按钮展示为真实快捷键名 `Ctrl+D`。
- 手机端输入框点“发送”后，Copilot、Claude 和 Codex 只把文字填进 Agent 输入框，需要再手动点一次 Enter 才真正提交任务。根因是移动端把文本和回车合并在同一个 stdin payload 里，部分 Agent TUI 只消费文本输入，没有把同批次的回车当作提交键。修复为“发送”和“粘贴执行”分两帧发送：第一帧 bracketed paste 文本，第二帧单独发送真实 Enter；“粘贴”仍保持只写入文本。
- 轻量预览下未开启完整小终端时，浏览器资源诊断仍显示 `/ws/agent-sessions` 达到数百 msg/s、数 MB/s，内存和网络持续增长。根因是每个终端输出帧都会触发后端发送一次全量会话 snapshot，前端必须持续 JSON 解析并刷新 React 状态。修复为对高频输出触发的全量看板快照做 trailing 合并广播，结构性操作仍即时刷新，同时避免 observe-only 会话输出时创建无效 awaiting_input timer。
- 加入大量 tmux 会话后，宫格页鼠标上下滚动明显卡顿，完整预览模式下更严重。根因是宫格一次性挂载所有卡片，完整预览会同步创建所有非交互 xterm 和 terminal WebSocket。修复为 `AgentGrid` 超过阈值后按可视区域虚拟化渲染，只挂载当前视口附近的卡片，并让虚拟行高与 CSS 卡片高度保持一致。
- Codex 产生很长输出后，切换/重开终端或从 tmux observe 刷新时只能看到最近一小段，像是丢了几百行。根因是 live PTY replay 只保留 256 KiB，tmux capture 固定 `-S -200` 且 detail 再截 200 行，registry fallback 也只留 200 条。修复为把 PTY replay、tmux capture、registry fallback 和前端 xterm scrollback 上限改成可配置默认值，并在资源诊断中展示 PTY 历史裁剪状态。
- 选定机器扫描 tmux 会话后，按钮会在“扫描中...”和“刷新”之间频繁交替。根因是 `TmuxDiscoveryPanel` 把全局 `sessions` 列表放进自动扫描 effect 依赖，WebSocket snapshot 刷新会话列表时会反复触发 `/api/agent-discovery/tmux/scan`；并发 scan 的旧请求也可能提前把 `loading` 改回 false。修复为扫描触发只依赖稳定 host key，`sessions` 更新只重新计算已加入标记，并用请求序号/host key 丢弃过期扫描结果。
- 非交互缩略图把真实 tmux 会话 resize 成小终端，导致布局和状态栏错乱。修复为缓存主终端几何尺寸，在前端做本地缩放预览，不把缩略图尺寸回写到后端。
- SSH -> tmux 场景中，仅调用 `node-pty.resize()` 不足以让远端 tmux 感知尺寸变化。修复为补发 `SIGWINCH`，确保 ssh 把尺寸变化转发给远端 client。
- 远端新建 tmux 会话时，`copilot` / `codex` / `claude` 这类非 shell agent 会在启动命令退出后把整个 tmux session 一起带没，看起来像“只能建 shell，不能建远端 tmux”。根因是前端 `buildTmuxLaunchCommand` 与服务端实现漂移，非 shell 分支少了 keep-pane-open 包装。修复为复用带 `exec "$SHELL_BIN" -i` 的 tmux pane 命令构造，保证 agent 退出后 pane 仍留在交互 shell 中。
- 远端 `10.30.0.24` 上从看板启动 Copilot 会话时，看起来像“tmux 创建失败”，实际是该主机把 `copilot` 解析到了一个缺少 `index.js` 的 `~/.nvm/.../bin/copilot` node shim。修复为远端 Copilot 启动命令先尝试健康的 `copilot` 可执行文件；若命中损坏 shim，则回退到 `node ../lib/node_modules/@github/copilot/npm-loader.js` 直接启动 CLI。
- 远端 `10.30.0.24` 上直接创建 shell tmux 时，默认名 `10.30.0.24_shell_tmux` 会被旧版 tmux 3.0a 拒绝并报 `bad session name`。根因是默认会话名生成器在 tmux 模式下仍保留 `.`。修复为 tmux 模式下对 host label 使用更严格的名字规范化，把 `.` 一并收敛成 `_`，生成 `10_30_0_24_shell_tmux` 这类 tmux-safe 名称。
- 本地 tmux 会话刚进入 focus view 后，浏览器已经通过 terminal WebSocket 发出了输入帧，但 tmux pane 里收不到 `stdin:<marker>`。根因是 WebSocket stdin 只写入 `tmux attach` 所在 PTY，attach 竞态或 pane 目标缺失时早期输入会丢失。修复为本地 tmux 会话优先通过已有 `LocalTmuxAdapter.writeInput` 的 `tmux send-keys` 队列写入目标 session/pane，并在失败时回退 PTY 写入。
- 本地 tmux 开启 mouse mode 后，在 kanban focus view 点击终端会把 `ESC[<...M` / `ESC[M...` 这类鼠标报告直接写进 pane，表现成字符码输入，点击无法被 tmux 处理。根因是 terminal WebSocket 对本地 tmux 会话统一优先走 `tmux send-keys`，鼠标报告绕过了 `tmux attach` client。修复为识别 xterm mouse report，有附着 PTY 时写回 PTY 让 tmux client 处理，没有 PTY 时不再把 mouse report 注入 pane；普通文本仍保持 `send-keys` 路径。
- 顶栏“终端字号”滑杆拖动时页面明显卡顿。根因是每个 range `input` 中间值都会立刻更新全局 `terminalFontSize`，所有挂载的 xterm 都同步执行 `fontSize`、`fit()` 和 `refresh()`。修复为拖动时只更新顶栏草稿值，鼠标松开、键盘调整结束或失焦提交后才应用到真实终端并持久化。
- 拖动顶栏“终端字号”滑杆后，Codex-like TUI 会收到 `focus-out`，松手后直接打字没有进入终端。根因是 `input[type=range]` 被终端焦点保护逻辑视为真实输入控件，鼠标提交字号后焦点仍停留在滑杆上。修复为鼠标提交字号后主动恢复当前 active terminal 的 xterm helper textarea 焦点，键盘调整滑杆仍保留控件焦点。
- 多屏 focus view 里把 sidebar session 拖到当前输入 pane，或在当前输入 pane 的下拉框切换 session 后，pane 会短暂变化又被恢复成原 focused session。根因是 `normalizeTerminalMonitorSlots` 会把 App 级 `focusedSession` 强制放回 active slot，而 active slot select/drag 在 `syncActiveTerminalWithFocus=false` 时没有同步 focused session。修复为 active slot select、拖入 active slot、从 active slot 拖出时同步 active slot/focused session，并让 sidebar 卡片单击即可切换 focus。

## 文件浏览器

- 新建文件/目录弹窗把草稿名称字符串当作开关，输入框清空时弹窗直接卸载。修复为显式维护弹窗状态，并在名称为空时仅禁用提交而不关闭对话框。
- 多会话聚焦视图中，某个终端的文件浏览器折叠后，切到其他会话再切回时会自动展开。根因是折叠状态保存在全局 UI 状态里，并在当前会话没有侧栏打开时被清零；修复为把左右分栏折叠状态保存到对应 `agentSession` 的侧栏状态中，切换会话不再互相覆盖。
- 多屏聚焦视图里，切换输入终端时文件系统/VS Code 侧栏的跟随规则不符合预期：工具已打开时没有稳定切到对应终端的工具状态，工具未打开时又可能把外层 focused session 一起切走。根因是多屏 active slot 和 App 级 `focusedSession` 总是强绑定。修复为只有文件系统或 VS Code 已打开时才把 active terminal 同步到 `focusedSession`，并把当前工具类型带到目标 session；未打开工具时只切多屏输入窗格，不切侧栏绑定。
- 多屏中快速切换终端时，文件系统侧栏偶发出现、消失或未加载到对应终端路径。根因是每个会话各自保留 `activeTool`，切换时又通过 active slot effect 和 focused session 派生侧栏开关，多个旧会话状态会抢当前抽屉归属。修复为在 App 层维护全局单一 `openSidePanelTool`，切换终端时只把该工具独占写入当前输入终端，并清空其他会话的 `activeTool`。
- 进一步排查发现，`onActiveTerminalSessionChange` 的 React effect 也参与侧栏 retarget，会和用户点击 pane 时的同步 `onSwitchFocus` 路径竞争，导致快速切换时最终目标偶发被较晚提交的 effect 覆盖。修复为 effect 只记录当前 active terminal id，文件系统/VS Code 跟随只由用户激活 pane 的同步路径执行，并补快速 A/B/A/B 切换回归。
- 文件系统/VS Code 侧栏是否显示仍被误建模成“某个终端是否开启过工具”，导致全局文件系统已经打开时，切到一个从未开过文件系统的终端仍可能不显示或按旧会话状态判断。修复为完全移除 session 级 `activeTool` 作为运行时状态，文件系统/VS Code 是否显示只由全局 `openSidePanelTool` 和用户工具按钮控制；每个 session 只保存 host、折叠等配置，切换终端只更换侧栏目标内容。
- 文件系统/VS Code 侧栏折叠状态仍然绑定到 `focusedSession` 的 per-session `sideCollapsed/mainCollapsed`，导致多屏切换终端时一会儿折叠、一会儿展开。修复为把左右分栏折叠状态收回全局 `fileBrowserUiState`，只有用户点击折叠/展开按钮才改变折叠状态，切换终端只更新侧栏内容目标。
- 服务端构建在文件下载路由处报 `archiver` 没有导出 `ZipArchive`，改成默认导入后又在 Node ESM 运行时报 no default export。根因是 `archiver` v8 运行时导出 `ZipArchive`，但当前类型声明仍按旧的 `export = archiver` 函数形态暴露。修复为使用 namespace runtime import，并在类型层显式声明 `ZipArchive` 构造器，保留本地/远端目录下载逻辑。

## VS Code Web 与 WebSocket 生命周期

- kanban 里的内嵌 VS Code Web 在自签 HTTPS 下会出现 PNG 预览 / webview 打不开。根因不是 PNG 本身，而是 code-server 的 webview / 预览链路依赖 service worker；浏览器虽然允许你“继续访问”自签页面，但仍会因为证书不受信任而拒绝给 `/vscode/.../service-worker.js` 注册 service worker。修复为让 `restart-dev.sh` 在本机装有 `mkcert` 时优先生成浏览器信任的本地证书，并在只能回退到 OpenSSL 自签证书时明确告警。
- React StrictMode 下，CONNECTING 阶段的 WebSocket 在 effect cleanup 中被关闭，会制造“连接尚未建立就关闭”的假断开提示。修复为在 dev-only 清理路径上延后关闭，等到 `onopen` 后再真正回收。
- SSH 远端会话打开 VS Code Web 时总被判定为“不支持”。根因是 `VsCodeWebManager` 之前只实现了本地 editor 生命周期。修复为补充 SSH 远端 `code-server` 的启动/复用、健康检查，以及 `/vscode/` 代理目标切换，先支持像 `10.30.0.24` 这类可被后端直连的远端主机。
- `10.30.0.24` 上 SSH 远端会话虽然能返回 VS Code URL，但 iframe 仍然只显示 404：根因有三层叠加——tunnel helper 继承了 ssh config 里的 `RemoteForward 18888`、远端优先复用了 `.vscode-server/.../code-server` 这类返回 404 的 agent binary、而旧错误进程还持续占着 `13338` 端口。修复为让 VS Code tunnel 使用 configless ssh、远端只启动 standalone `code-server`、并在健康检查失败时先清理目标端口上的陈旧监听进程，再拉起新实例。
- SSH 远端会话在前端里依然打不开 VS Code，只剩文件浏览器可用。根因是 `App.tsx` 仍把 `vscodeAvailable` 写成了“仅本地会话可用”的布尔门禁，导致即便后端远端 `/vscode-web` 已经打通，SSH session 的 VS Code 按钮也会被禁掉。修复为让聚焦态 SSH 会话同样允许打开 VS Code Web，并同步修正文案。
- `10.30.0.23` / `10.30.0.21_host` 这类远端主机仍然打不开 VS Code：一层根因是部分机器根本没装 standalone `code-server`；另一层根因是 remote VS Code 的 configless tunnel 只规避了 ssh config 里的 `RemoteForward` 污染，却没有先解析 ssh config 里的 alias / port / identity，于是 `10.30.0.21_host` 这类别名和 `10.30.0.23` 这类靠 ssh config 改端口的主机都会把 tunnel 连错。修复为在目标机补装 standalone `code-server`，并让 tunnel 在 `ssh -F /dev/null` 前先通过 `ssh -G` 解析出真实 `hostname/port/identityfile` 再发起连接。
- 看板通过本地 `/vscode` 代理打开 VS Code Web 时，HTTPS 页面里的图片预览仍可能加载失败。根因是代理层之前只把后端看到的 `request.protocol/host` 原样转发给上游 `code-server`；当前端开发页经由 HTTPS 访问、后端实际走本地 HTTP 代理时，上游收到的却是错误的 `http + 本地端口`，从而生成了错误的预览资源来源。修复为让 `/vscode` 代理和 `/api/agent-sessions/:id/vscode-web` 一样，优先从浏览器的 `Origin/Referer` 或现有转发头推导公开 `host/protocol`，再转发给上游。
- 本地 HTTPS 开发证书已经回退到 OpenSSL 自签时，VS Code Web 的 webview / 图片预览仍会报 `Could not register service worker ... An SSL certificate error occurred`。根因是浏览器不会为不受信任的自签证书注册 service worker，而旧脚本在“复用现有证书”路径上既不会持续告警，也不会在后续装上 `mkcert` 后自动升级证书。修复为：1）修正现有证书 SAN 匹配，避免 IP SAN 误判导致行为漂移；2）为脚本生成的证书写入 metadata，复用 OpenSSL 自签证书时持续输出 VS Code 预览受限告警；3）一旦检测到 `mkcert` 已可用，自动淘汰旧自签证书并重签为受信任证书。

- 点击 `VS Code保持状态` 后，运行中的非聚焦终端窗格仍只显示轻量预览。根因是 `vscodeIframeCacheMode` 只保留 VS Code iframe，未同步切换 `useLightweightTerminalPreview`，两个内存/保真度开关在用户工作流里分裂。修复为把 VS Code cache profile 与终端预览保真度联动：保持状态时完整渲染运行终端窗格，省内存时恢复轻量预览。

## 开发环境与测试基础设施

- Paper Writer 前端打开后不稳定或打不开。根因是临时加入 `dist/index.html` 的自动同步脚本每 2 秒枚举并 HEAD 轮询所有已加载资源，真实浏览器会持续制造大量请求并可能触发 reload/卡顿。修复为移除当前运行入口里的轮询脚本，让静态页面恢复为只加载主 JS 和 CSS；后续热同步应放到受控开发模式实现。
- Paper Writer 进入任意编辑器页后显示 `Something went wrong / missing ) after argument list`。根因是手改当前运行构建产物新增预览翻译 hook 时，多写了一个闭合大括号，`EditorPage` 懒加载模块在 Chromium 中解析失败。修复为删除多余 `}`，并用 Playwright 直接动态 import `EditorPage` 与打开 `/editor/moe_prune` 做回归验证。
- Paper Writer 预览翻译点击后报 `ENOENT ... conversations/<project>/preview-translate-*.json`。根因是前端把随机生成的临时字符串当作 conversation id 传给 `/api/ai/send`，但后端会按该 id 读取已有会话 JSON。修复为翻译前优先复用当前会话；没有当前会话时先通过 `/api/conversations/:projectId` 创建真实 `Preview Translate` 会话，再把返回的 id 传给 AI 接口。
- Paper Writer 8787 服务停掉后无法重启，导致前端完全打不开。根因是当前运行目录里的 `app/apps/backend/src` 和 ESM `package.json` 缺失，且本地 LLM 配置没有落到后端会读取的 `.env`，服务启动时先遇到源码缺失/语法恢复噪音，随后因空 API key 直接退出。修复为从覆盖率产物恢复后端源码、清理 Istanbul 标记、补回 backend ESM package 声明，并把本机 Paper Writer 配置同步到被 git 忽略的 `app/apps/backend/.env` 后用 `setsid` 后台启动。
- Paper Writer 项目页侧栏同时显示 `所有项目`、`我的项目`、`已归档`、`回收站`，分类过多且 `所有项目` 与 `我的项目` 在常规场景含义重叠。修复为当前运行构建产物只展示 `开放项目` 和 `归档项目` 两类；开放项目过滤 `!archived && !trashed`，归档项目过滤 `archived && !trashed`。
- `papers/paper-agent` 投稿目录同时保留了最终上传文件和一份重复的源码工作副本，容易让人误以为需要上传散乱的 `sec/`、`main.tex`、`references.bib`。修复为只保留三个实际投稿文件 `cover-letter.pdf`、`main.pdf`、`paper-agent-spe-latex-source.zip`，删除重复源码树，并把 `README.md` 改成投稿清单。
- Playwright 只复用前端 Vite 服务时，可能在 `/api` 代理已经坏掉的情况下误以为测试环境可用。修复为前后端分别做健康检查，避免复用损坏环境。
- 多轮 Playwright e2e 后，Vite 或后端 `tsx watch` webServer 可能因 `EMFILE` / `ENOSPC: System limit for number of file watchers reached` 启动失败。根因是测试环境反复启动 watcher，命中本机 fd/watch 上限。修复为 Playwright 启动的 web dev server 默认设置 `CHOKIDAR_USEPOLLING=1`，后端 e2e 服务改用非 watch 的 `tsx src/index.ts`，且只有显式 `PLAYWRIGHT_REUSE_EXISTING_SERVER=1` 时才复用旧服务。
- HTTPS dev server 已在 `3333` 端口运行时，Playwright e2e 仍等待 `http://127.0.0.1:3333` 直到 webServer 超时，或者浏览器因本地开发证书报 `ERR_CERT_AUTHORITY_INVALID`。根因是 e2e 配置没有按前端 HTTPS 模式切换探测协议，且 `terminal-preview` 用例缺少本地证书忽略设置。修复为支持 `PLAYWRIGHT_FRONTEND_PROTOCOL`，HTTPS 协议下开启 `ignoreHTTPSErrors`，并给终端预览 e2e 补齐 HTTPS 测试约定。
- `pnpm dev` / `restart-dev.sh` 能启动页面但 API 代理可能连错端口。根因是后端和脚本默认使用 `3200/3100`，但 `apps/web/vite.config.ts` 仍写死前端 `3000`、后端代理 `4000`，且没有复用已有的 `resolveWebDevConfig`。修复为让 Vite 配置统一走 `resolveWebDevConfig`，按 `WEB_BACKEND_PORT -> SERVER_PORT -> PORT -> 3200` 解析后端代理，并同步 `.env.example` 默认值。
- `scripts/restart-dev.sh` 重启失败，先报缺少 `scripts/dev-https-cert.mjs`，补齐后又因 Vite/tsx native watcher 命中 `EMFILE`。根因是 HTTPS 证书生成 helper 在合并后缺失，且开发脚本没有为前后端 watch 模式设置 polling。修复为恢复 `dev-https-cert.mjs`，并在后端和前端启动环境都设置 `CHOKIDAR_USEPOLLING=1`。
- Ubuntu 主机缺少 Playwright Chromium 运行库时，浏览器测试无法启动。现有 workaround 是下载所需 `.deb`、提取到本地目录，并通过 `LD_LIBRARY_PATH` 注入依赖。
- `pnpm -r test` 全部断言通过后仍不退出。根因是多个服务级 idle timer 没有 `.unref()`，导致 Node event loop 一直存活。修复为所有仅用于空闲清理的 timer 创建后立即 `.unref()`，并补 `hasRef() === false` 回归。
- `awaiting_input` 相关单测在高负载下可能偶发超时。修复策略是调小测试专用的 `awaitingInputIdleMs` 覆盖值，而不是放大全局默认值。
- `awaiting-input timer retries when the first idle check fires early` 测试在引入 timer `.unref()` 纪律后失败，报假 timer handle 没有 `unref`。根因是测试 mock 的 `setTimeout` 返回数字句柄，已经不符合生产代码对 Node timeout 的最小契约。修复为让假 timeout 提供并断言 `unref()`，继续覆盖早触发重试逻辑。
- `launch does not surface npm config warnings before local Copilot starts` 单测稳定超时。根因是测试直接依赖当前机器真实 `copilot` 启动文案，而不是仓库已有的 `.playwright-bin/copilot` stub。修复为在该测试内显式启用 `PLAYWRIGHT_TEST=1` 并把 stub 目录加入 `PATH`，断言 fake 或真实 Copilot 启动均不得出现 `Unknown env config`。

## 兼容性与环境探测

- shell 解析逻辑曾默认依赖 zsh，导致 Linux/macOS 某些环境无法正常启动。修复为优先读 `SHELL`，再回退到 `bash -> zsh -> sh`。
- tmux 路径曾只假设单一路径，导致 Homebrew Intel/Apple Silicon 或 PATH 安装下行为不稳定。修复为支持 `TMUX_BINARY`、Homebrew 常见路径和 `PATH` 自动探测。
- 前后端端口和 Vite 代理目标曾被硬编码，切换环境后容易错连。修复为统一改成 `SERVER_BIND_HOST`、`PORT`、`WEB_HOST`、`WEB_PORT`、`WEB_BACKEND_*` 等环境变量驱动。`HOST` 仍兼容但优先级低于 `SERVER_BIND_HOST`，且会做格式校验防止 conda 等工具链污染。

## 终端焦点保留

- Codex CLI 运行后，鼠标滚轮有时滚动上下文，有时变成输入框历史记录上下翻页。根因是 xterm.js 在 TUI 开启鼠标追踪或无 scrollback 路径时会把 wheel 事件转换为鼠标协议或 Up/Down 方向键序列转发给 PTY。修复为前端接管 `attachCustomWheelEventHandler`，自己计算并滚动 xterm scrollback，返回 `false` 阻止 wheel 进入 stdin；输入历史翻页只保留给键盘上下箭头。
- 多屏或完整预览场景里，某个终端偶发无法用鼠标滚轮浏览上下文。根因是滚轮接管只挂在 xterm 内部自定义 wheel handler 上，事件落在终端外层容器、缩放后的空白区域或非输入预览终端时可能漏掉。修复为在 `TerminalView` 容器捕获阶段统一接管 wheel，所有终端视图都滚动自己的 xterm scrollback，并阻止 wheel 进入 stdin。
- 运行中的终端已经接收到滚轮事件后，仍可能刚滚上去就被实时输出拉回底部，表现为“滚轮滑不动上下文”。根因是 live `term.write()` 在持续输出时会刷新底部跟随，覆盖用户刚选择的 scrollback 视口。修复为滚轮离开底部后短暂锁定用户查看的 viewport，新输出写入完成后恢复到该行；用户滚回底部或点击“底部”按钮后解除锁定。
- 仍有很多运行中终端滚轮控制不了上下文：一层根因是旧用户滚动锁只有 10 秒，长输出终端停留阅读超过 10 秒后又会被 live output 拉回底部；另一层根因是 wheel 事件可能落在终端上方的遮罩、空白层或其他 document-level 目标上，没进入 `.terminal-view` 容器。修复为把用户滚动锁改成“只要未回到底部就持续锁定”，并增加 document capture 兜底，鼠标坐标落在真实 xterm 区域内时一律滚动对应终端 scrollback。
- commit `fc57a80` 引入的"保留显式用户焦点"修复过度：`rememberExternalPointerIntent` 只对"受保护目标"（input、iframe、dialog 等）记录外部点击意图，导致点击普通 div、按钮等非保护元素时终端立刻抢回焦点。`hasIntentionalExternalFocus` 里对非保护、非 body 元素直接返回 `false`，进一步放大了这个问题。修复为：1）`rememberExternalPointerIntent` 对 `.terminal-view` 以外的任意 `pointerdown` 都记录意图；2）`hasIntentionalExternalFocus` 简化为纯时间戳比较，不再区分 active element 类型。
- VS Code Web 与终端来回切换两轮后，点击 VS Code iframe 内部无法重新输入。上一轮修复只覆盖父文档能收到 `pointerdown` 的外部点击；真实 iframe 内点击不会稳定冒到父页面，导致 `lastTerminalIntentAt` 仍然更新于外部意图之后，`handleWindowFocus` / 被动焦点修复又把 xterm-helper textarea 抢回。修复为在父窗口 `blur`、被动终端聚焦前，基于当前 `document.activeElement` 补记 hovered iframe 的外部焦点意图，并补 VS Code -> 终端 -> VS Code round-trip e2e 回归用例。
- tmux attach 类型终端有时只能滚动当前窗口可见内容，像是没有上文。根因是浏览器 xterm 只收到 `tmux attach` 后绘制的当前屏幕，旧的 tmux pane 历史没有进入 PTY replay；tmux client 初始绘制还会发送 `CSI ?1049h` 进入 xterm alternate screen，使普通 scrollback 不可见；同时默认 tmux capture/registry 上限低于前端 xterm 上限。修复为tmux attach 前先 `capture-pane` 预灌 pane 历史到 PTY replay（本地直接 capture，SSH 远端通过非交互 ssh capture），并把 tmux capture 默认提升到 20000 行、registry fallback 默认提升到 5000 条，同时在接管已有 tmux session 前设置更大的 `history-limit`。
- tmux 扫描弹层覆盖单屏终端时，在扫描结果卡片上滚轮会误滚动后方终端上下文。根因是 `TerminalView` 的 document-level wheel 兜底只按鼠标坐标命中终端区域，没排除上层 discovery 弹层；弹层覆盖在终端上时 wheel 被后方终端接管并 `preventDefault`。修复为 document-level 终端滚轮兜底遇到 `.discovery-overlay` 事件目标时直接放行，让 discovery list 自己滚动。
- `scripts/restart-dev.sh` 启动后短时间内前后端端口又断开。根因是脚本用普通 `nohup` 启动 dev server，调用 shell 结束后进程仍可能跟随 session 掉线；同时脚本没有把后端代理 host/port 显式传给 Vite。修复为用 `setsid` 脱离调用 shell、保留 HTTPS 前端默认启动，并显式把后端代理 host/port 传给 Vite。
- focus view 点击按钮后，Copilot-like TUI 会收到 `focus-out` 并丢掉紧随其后的输入。根因是按钮等非文本控件被纯时间戳逻辑误判为有意外部焦点，且 keydown 补救路径可能先发送 stdin、后发送 `focus-in`；修复为 `hasIntentionalExternalFocus` 只保护真实输入面/iframe/dialog 和短暂 body handoff，并在 `TerminalView` 发送 stdin 前同步补齐已聚焦 helper 的 focus report。
- HTTPS 前端里扫描并加入本机 tmux 后，focus view 终端可能全部黑屏。根因是前端 WebSocket URL 构造在同源默认路径下固定使用 `ws://`，而 `restart-dev.sh` 默认启动 HTTPS 页面，浏览器会阻止 insecure WebSocket mixed content。修复为 HTTPS 页面默认生成 `wss://.../ws/...`，HTTP 页面仍生成 `ws://...`，并补 URL 回归测试。
- 多屏中把已打开 Codex 的会话切入终端窗格后，输入框会多出 `[I` / `[O`，方向键会输入 `OA` / `OB` / `OC` / `OD`。根因是 active PTY replay 把历史 `focus tracking`、application cursor、mouse、bracketed paste、keypad 等终端模式开关重新发送给新挂载的 xterm，导致浏览器端模式状态被污染；同时本地 tmux stdin 优先走 `tmux send-keys` 后，focus report 和 application-cursor 箭头序列没有分别进入正确路径，前者会被注入 pane，后者会被拆成 Esc + 字面量。修复为 replay 只保留显示内容并清理模式开关，focus/mouse 控制报告改走 attached PTY，application-cursor 箭头在 tmux send-keys 路径映射成真实方向键。
- `./scripts/restart-dev.sh` 重启后仍跑到 HTTPS/3100，而不是预期的 HTTP/8484。根因是脚本和 `.env.example` 仍保留旧的 `WEB_HTTPS=1`、`WEB_PORT=3100` 默认值，前端 dev proxy 也残留后端 `3200` 默认值；同时 restart 脚本测试没有纳入根 `pnpm test`。修复为默认 HTTP、前端 8484、后端 4000，并把脚本测试加入根测试链路。
- 多屏 sidebar 双击其他会话替换当前输入 pane 时，当前 Codex 终端仍会出现 `[I`，且双击替换有时失效。根因有两层：1）本地 tmux terminal WebSocket 仍把手动 focus report `ESC [ I/O` 作为控制输入写回 attached tmux client，部分 Codex/tmux 组合会把它落成 prompt 字面量；2）sidebar card 同时绑定 click 和 dblclick，真实双击会先触发单击替换，DOM 换位后第二次点击可能落到刚换出的旧会话上，把 pane 又替换回去。修复为本地 tmux 会话直接丢弃 focus report、只保留 mouse report 走 attached PTY；sidebar 单击改为短延迟执行，双击取消单击并只替换一次。
- 当前终端右键粘贴后，Codex 输入框会出现 `[200~` / `[201~`：根因是 xterm 在 bracketed paste 模式下发送 `ESC[200~` / `ESC[201~` 起止符，本地 tmux WebSocket 路径又优先走 `tmux send-keys`，旧解析器把 `ESC` 当成 Escape 键、把 `[200~` / `[201~` 当成普通文本写进 pane。修复为在 `LocalTmuxAdapter.buildTmuxSendKeySteps` 中仅对本地 tmux send-keys 路径剥离 bracketed paste 起止符，保留粘贴正文和既有控制键映射，并补单元与真实 WebSocket+tmux 回归。
- 当前看板终端里按 `Shift+Left` 会在 Codex 输入框里出现 `[1;2D` / `D` 并可能伴随换行，同类 `Ctrl/Alt/Shift` 方向键和 Home/End/Delete/PageUp/PageDown 也存在字面量泄漏风险。根因是本地 tmux WebSocket 输入优先走 `tmux send-keys` 后，`LocalTmuxAdapter.buildTmuxSendKeySteps` 只识别普通箭头和 application-cursor 箭头，不识别 xterm 的修饰键 CSI 序列（如 `ESC[1;2D`）及常见导航键序列，于是把 `ESC` 当 Escape 键、把余下内容当普通文本注入 pane。修复为在 tmux send-keys 转换层解析 xterm 修饰键方向键、Home/End、Insert/Delete、PageUp/PageDown 和 F1-F12 tilde 序列，映射成 tmux key name；前后端过滤层补测试确保这些键序列不会被误删。
- 当前看板终端里对 Codex 会话右键粘贴多行内容时，每一行都会被当成一次回车提交：根因是上一版为避免 `[200~` / `[201~` 泄漏而剥离 bracketed paste 起止符，导致区块内真实换行继续被 `buildTmuxSendKeySteps` 映射成 tmux `Enter`。修复为完整保留 `ESC[200~ ... ESC[201~` bracketed paste 区块并整体通过 `tmux send-keys -l` 注入，区块外的 `\r` / `\n` 仍按普通 Enter 处理，确保 Codex/TUI 能按一次粘贴接收多行文本。
- Codex 会话中右键粘贴多行内容仍可能被逐行提交：根因是 xterm/WebSocket 可能把一次 bracketed paste 分成多帧发送，上一版只在单帧内识别完整 `ESC[200~ ... ESC[201~`，第一帧之后的裸文本帧失去了 paste 上下文，里面的 `\r` 又被映射成 tmux `Enter`。修复为 `LocalTmuxAdapter` 按 agent session 记录 bracketed paste open 状态，直到收到结束符前所有输入帧都走 literal；新增 WebSocket+真实 tmux 回归，断言 split paste 三帧最终按原始字节进入 pane。
- `restart-dev.sh` 在 conda 环境（如 `xh2`）里启动失败，报 `getaddrinfo EAI_AGAIN x86_64-conda-linux-gnu`。根因是 conda activate 脚本把 `HOST` 环境变量设为平台编译三元组（cross-compilation triplet），而 `restart-dev.sh` 的 `SERVER_BIND_HOST` 回退链 `${HOST:-0.0.0.0}` 拿到了这个无效值并传给后端 Fastify `listen()`。修复为脚本不再回退到 `$HOST`，默认直接 `0.0.0.0`；同时后端 `resolveServerRuntimeConfig` 优先读 `SERVER_BIND_HOST`，并对 HOST 值做格式校验，含 `_` 或不符合 IP/hostname 模式时直接报错提示用户使用 `SERVER_BIND_HOST`。
- `pty-runtime-manager` 的 tmux 历史回放测试在窄 detached pane 环境中稳定超时。根因是测试 marker 过长，tmux capture 会按 28 列默认宽度把 `_080` 拆到下一行；同时 tmux shell-command 中的 `%03d` 会被 tmux 格式处理干扰。修复为测试生成短 marker，并用 shell 补零逻辑代替 `%` 格式符，避免测试依赖 tmux pane 宽度或 tmux 格式扩展。
- 合并 GitLab 的连接状态与空态 UX 提交后，前端构建报缺少 `focus-view-state`、`file-browser-ui-state`、`side-panel-session-state` 模块。根因是该提交引用了拆分后的状态解析模块但远端分支未包含文件。修复为补齐三个轻量状态解析模块，并给文件浏览器宽度状态 updater 补明确类型，恢复 `pnpm check` 通过。
- 手机端快捷键在本地 tmux/Codex 会话里存在不一致风险，表现为 `Tab` 按钮没有触发 Codex 队列提交。根因是手机端按钮走 REST `/stdin`，本地 running tmux 会话却直接写入 attached PTY；桌面终端 WebSocket 已优先走 `tmux send-keys` 到目标 pane，两条路径语义不一致。同时 `Backspace`、`Ctrl+Z`、`Shift+Enter`、`Ctrl+Enter` 在 tmux 映射层不完整，CSI-u Enter 序列会被拆成 Escape 加普通文本。修复为 REST `/stdin` 对本地 tmux 会话同样优先走 `tmuxAdapter.writeInput`，只让鼠标/PTY 控制 payload 回落 attached PTY；补齐 `BSpace`、`C-z`、`S-Enter`、`C-Enter` 映射，并新增真实 tmux raw-stdin 回归测试，逐个断言手机端所有快捷键最终到达 pane 的字节序列。
- Coding Kanban 发送完成通知再次失效，尤其是接管/刷新本地 tmux 中的 Codex 会话后长期不弹“任务完成”。根因是 `syncCapturedScreen()` 每次捕获可控 tmux 屏幕都会无条件把会话写回 `running` 并刷新 `lastHeartbeatAt`，即使屏幕内容完全没变；idle 扫描因此一直看不到静默窗口，前端也收不到 `running -> idle` 的通知边沿。修复为只有屏幕内容变化时才刷新 `lastOutputAt` 并保持 `running`，重复捕获只更新刷新时间，不再阻止 idle 广播；新增回归测试覆盖连续相同 tmux refresh 后仍进入 idle。

---

## PM 审计修复 (2026-06-16)

### #32: shellQuote/formatWorkingDirectory 去重

- **现象**: `shellQuote` 和 `formatWorkingDirectory` 在前端 `session-matching.ts`、后端 `agent-sessions.ts`、前端 `QuickTmuxConnect.tsx` 三处重复实现。
- **修复**: 提取到 `packages/shared/src/shell-utils.ts`，三处改为从 `@agent-orchestrator/shared` 导入并 re-export。
- **测试**: `packages/shared/src/shell-utils.test.ts` — 12 个测试用例覆盖 shellQuote 和 formatWorkingDirectory 的各种边界情况。
- **文件**: `packages/shared/src/shell-utils.ts`, `packages/shared/src/index.ts`, `apps/web/src/lib/session-matching.ts`, `apps/server/src/routes/agent-sessions.ts`, `apps/web/src/components/QuickTmuxConnect.tsx`

### #21: 宫格空态引导增强

- **现象**: 空态只有"暂无 Agent 会话"和两个按钮，缺少快速上手指引。
- **修复**: 增加三步快速入门指引（1.新建会话 2.双击进入聚焦 3.快捷键），样式使用步骤编号圆点 + kbd 标签。
- **测试**: `apps/web/src/components/AgentGrid.test.ts` — 验证空态显示引导文本、新建会话按钮、扫描 tmux 按钮。
- **文件**: `apps/web/src/components/AgentGrid.tsx`, `apps/web/src/app.css`

### #29: 聚焦视图折叠标题栏增强

- **现象**: 标题栏折叠后只显示名称和展开按钮，缺少状态和类型信息。
- **修复**: 折叠时在名称后显示状态徽标和 agentKind 标签。
- **测试**: Playwright 集成测试验证。
- **文件**: `apps/web/src/components/AgentFocusView.tsx`, `apps/web/src/app.css`

### #16: 快速连接 tmux 记忆历史

- **现象**: 每次打开快速连接弹窗都需要重新选择主机、填写会话名。
- **修复**: 新增 `recent-connections.ts` 模块，连接成功后自动保存到 localStorage（最多 8 条），下次打开时在主机搜索前显示"最近连接"快捷入口，支持一键填充。
- **测试**: `apps/web/src/lib/recent-connections.test.ts` — 5 个测试用例覆盖保存、加载、去重、上限、清空。
- **文件**: `apps/web/src/lib/recent-connections.ts`, `apps/web/src/components/QuickTmuxConnect.tsx`, `apps/web/src/app.css`

### #20: 聚焦视图侧栏会话搜索

- **现象**: 聚焦视图右侧"其他会话"侧栏没有搜索能力，会话多时难以定位。
- **修复**: 当其他会话超过 2 个时，在标题下方显示搜索输入框，支持按名称、类型、工作目录模糊过滤。
- **测试**: Playwright 集成测试验证。
- **文件**: `apps/web/src/components/AgentFocusView.tsx`, `apps/web/src/app.css`

### #19: 会话标签/分组支持

- **现象**: 所有会话平铺展示，无法按自定义维度分组。
- **修复**: `AgentSessionRecord` 新增可选 `tags: string[]` 字段；FilterBar 新增标签筛选器（仅在存在标签时显示）；卡片 footer 显示用户标签（蓝色样式）；App.tsx 过滤逻辑支持标签过滤。
- **测试**: 已有 FilterState 相关测试覆盖标签字段。
- **文件**: `packages/shared/src/index.ts`, `apps/web/src/components/FilterBar.tsx`, `apps/web/src/components/AgentGridCard.tsx`, `apps/web/src/App.tsx`, `apps/web/src/app.css`

### #23: 文件浏览器拖拽路径到终端

- **现象**: 文件浏览器中无法将文件路径拖拽到终端。
- **修复**: 文件条目添加 `draggable` 属性和 `onDragStart`（设置 `text/plain` MIME 为文件路径）；TerminalView 添加 `onDragOver` 和 `onDrop` 处理器，接收文件路径后写入当前终端输入。
- **测试**: Playwright 集成测试验证。
- **文件**: `apps/web/src/components/FileBrowserDrawer.tsx`, `apps/web/src/components/TerminalView.tsx`

### VS Code Web 端口错连

- **现象**: Kanban 打开 VS Code Web 失败，`.dev-runtime/server.log` 反复出现 `listen EADDRINUSE: address already in use 0.0.0.0:4000`，前端 `/api` 和 `/vscode` 实际代理到另一个项目服务。
- **根因**: `paper_wrighting` 占用默认 `4000/8484`，当前仓库后端没有成功启动；陈旧 `coding_kanban` watcher 持续重启并污染日志，导致看起来像 `code-server` 异常。
- **修复**: 清理当前仓库陈旧 watcher，用 `SERVER_PORT=8282 WEB_PORT=8584` 拉起可用实例并验证 `code-server` 代理返回 VS Code HTML；随后按当前运行策略调整 `restart-dev.sh`，重启时强制回收目标 `SERVER_PORT/WEB_PORT` 上的监听进程，即使监听进程来自其他仓库。
- **测试**: `node --test scripts/restart-dev.test.mjs`；手动验证 `https://10.30.0.22:8584`、`POST /api/agent-sessions/:id/vscode-web`、`/vscode/` HTML。
- **文件**: `scripts/restart-dev.sh`, `scripts/restart-dev.test.mjs`

### 聚焦视图其他会话滚动过早且卡片过大

- **现象**: 右侧“其他会话”数量增加后，要么所有会话卡片一股脑挤在侧栏里越压越小，要么卡片固定为较大高度后过早出现滚动。
- **根因**: 侧栏虽然有滚动容器，但焦点页和侧栏 flex 链路没有完整的高度约束；第一版修复又把卡片完全固定，缺少“先缩到指定下限、再滚动”的中间态。
- **修复**: 超过阈值时为右侧栏开启紧凑滚动模式；侧栏和滚动容器固定在焦点页高度内，卡片与终端预览允许在最小高度约束内收缩，真实溢出后才通过滚轮/滚动条浏览更多会话。
- **测试**: `pnpm --dir apps/web test -- AgentFocusView.test.ts` 覆盖多会话启用滚动模式和少量会话保持自动模式。
- **文件**: `apps/web/src/components/AgentFocusView.tsx`, `apps/web/src/components/AgentFocusView.test.ts`, `apps/web/src/app.css`

### 文件浏览器缺少 Owner 列和列宽调整

- **现象**: 文件系统列表已有名称、大小、修改时间、权限，但缺少 Owner；各列宽度固定，长文件名或元数据列无法按当前窗口手动调整。
- **根因**: `FileEntry` 数据模型没有 owner 字段，前端文件列表表头和行使用固定 CSS grid 模板，没有列宽状态或拖拽分割线。
- **修复**: 本地文件列表从 uid 解析 owner，SFTP 列表优先从 longname 解析 owner；前端新增 Owner 列，并用可持久化列宽状态和表头分割线支持左右拖动调整各列宽度。
- **测试**: `pnpm --dir apps/web test -- FileBrowserDrawer.test.ts`；`pnpm --dir apps/server test -- local-fs-service.test.ts sftp-service.test.ts`。
- **文件**: `packages/shared/src/index.ts`, `apps/server/src/services/file-system-utils.ts`, `apps/server/src/services/local-fs-service.ts`, `apps/server/src/services/sftp-service.ts`, `apps/web/src/components/FileBrowserDrawer.tsx`, `apps/web/src/app.css`

### VS Code Web 中文 IME 标点无法输入

- **现象**: 看板内嵌 VS Code Web 编辑器中，中文和英文字符可输入，英文标点可输入，但中文 IME 标点无法提交到文档。
- **根因**: 现象只影响 IME 标点提交，不是整体焦点丢失；根因指向 VS Code Web/EditContext 输入路径与 CJK IME 标点提交兼容性问题。
- **修复**: 本地 code-server managed `settings.json` 写入 `editor.editContext=false` 和旧版兼容键 `editor.experimentalEditContextEnabled=false`；SSH 远端 code-server 启动脚本也在启动前合并同样设置，确保本地/远端 VS Code Web 都回到稳定输入路径。
- **测试**: `pnpm --dir apps/server test -- vscode-web-manager.test.ts`（实际通过 server 全量测试：132 pass，1 skip）。
- **文件**: `apps/server/src/services/vscode-web-manager.ts`, `apps/server/src/services/vscode-web-manager.test.ts`, `docs/project-overview.md`

### Kanban tmux 卡片改名只能继续改一次

- **现象**: tmux 管理的 Kanban 卡片第一次改名后，再次改名可能没有任何反应。
- **根因**: 用户输入的显示名允许包含 `:`，但 tmux 会把 session 名规范化为下划线，或在后续 `-t name:part` 中把冒号解析成 window 分隔；服务端仍把用户输入原文保存到 `transportRef.tmuxSession`，第二次改名用这个错误 target 找不到真实 tmux session。前端又吞掉 PATCH 异常，表现为“只能改一次”。
- **修复**: tmux 改名前后都通过 pane id 查询真实 `#{session_name}`；改名前用真实 session 修复已有坏状态，改名后把 registry 的 `transportRef.tmuxSession` 写成 tmux 实际名称，同时保留用户输入作为 `displayName` 和 pane title。前端改名失败时弹出具体错误，不再静默忽略。
- **测试**: `pnpm --dir apps/server exec tsx --test --test-name-pattern "renames the tmux session" src/routes/agent-sessions.tmux-add.test.ts`。
- **文件**: `apps/server/src/services/local-tmux-adapter.ts`, `apps/server/src/routes/agent-sessions.tmux-add.test.ts`, `apps/web/src/App.tsx`

### SSH 远程会话连接成功后立即退出且没有原因

- **现象**: 新建 SSH 远程终端时接口返回成功，卡片随后立即退出；目录不存在、Agent 未安装或 tmux 缺失时，页面只显示笼统的创建失败或 exited 状态。
- **根因**: `/api/agent-launch/ssh-pty` 在 SSH PTY 创建后立即返回 `201`，没有先验证远端目录和交互式 shell PATH；新建会话窗口的 catch 分支又丢弃了后端错误正文。
- **修复**: 服务端在注册会话前执行有超时和输出上限的只读 SSH 预检，分别返回目录、Agent、tmux 和连接错误；前端保留并显示后端具体消息。预检通过后的运行期退出继续使用既有 registry 逻辑保留终端输出和退出码。
- **测试**: `remote-launch-preflight.test.ts`、`agent-sessions.remote-preflight.test.ts`、`session-launch-error.test.ts`。
- **文件**: `apps/server/src/services/remote-launch-preflight.ts`, `apps/server/src/routes/agent-sessions.ts`, `apps/server/src/app.ts`, `apps/web/src/components/NewSessionDialog.tsx`, `apps/web/src/lib/session-launch-error.ts`

### 删除 tmux 后历史会话恢复失败通知永久停留

- **现象**: 删除 tmux 终端并执行 `exit` 后，页面显示“历史会话部分恢复失败”，例如提示 `paper_writing: tmux 会话不存在或当前不可访问`，但通知没有关闭按钮且不会自动消失。
- **根因**: 恢复成功通知实现了关闭按钮和 5 秒自动关闭，恢复失败分支没有渲染关闭按钮，自动关闭判定函数也只接受 `restore-complete` 状态。
- **修复**: 恢复失败通知增加可访问的 `×` 按钮，并设置 10 秒自动关闭；恢复成功继续使用 5 秒，恢复进行中保持常驻。状态变化或手动关闭时 React effect 会清理未触发的定时器。
- **测试**: `apps/web/src/components/AppUpdateBanner.test.ts` 覆盖失败通知关闭按钮、成功/失败差异化自动关闭时间和恢复中不自动关闭。
- **文件**: `apps/web/src/components/AppUpdateBanner.tsx`, `apps/web/src/App.tsx`

### 返回宫格后双击终端卡片无法再次进入主窗口

- **现象**: 从聚焦主窗口返回宫格后，双击卡片的终端区域有时不会再次放大到主窗口，尤其容易受完整 xterm 预览和卡片内部控件的鼠标事件影响。
- **根因**: 仅等待浏览器最终派发 `dblclick` 仍不够可靠；终端在两次点击之间接管焦点或更新命中节点时，最终双击事件可能不再派发到同一张卡片。
- **修复**: 卡片在捕获阶段识别第二次主键按下（`mousedown.detail === 2`）并立即进入单屏，不再依赖更晚到达的 `dblclick`；按钮、输入框、分组选择器、链接等真实控件仍被排除，xterm helper textarea 则明确按终端区域处理。
- **测试**: `apps/web/src/components/AgentGridCard.test.ts` 覆盖第二次主键按下、非主键和真实控件过滤；`tests/e2e/agent-orchestrator.spec.ts` 覆盖终端区域进入单屏、返回宫格、再从卡片底部进入单屏。
- **文件**: `apps/web/src/components/AgentGridCard.tsx`

### 看板长时间运行后浏览器内存再次持续增长

- **现象**: 宫格已使用轻量预览且没有挂载 xterm/VS Code iframe 时，真实资源诊断仍显示 12 张卡片持续接收约 `4.2 msg/s`、`84 KB/s` 的全量会话快照；长时间运行会反复分配和解析数 GB JSON。保持状态模式还允许同时保活 8 个重量级 code-server iframe。
- **根因**: 之前的快照合并窗口只有 250ms，活跃终端会稳定触发约 4 次/秒的全量看板 payload；资源诊断只按消息数判断，漏报低频大包。VS Code 成功响应缓存没有淘汰策略，iframe 保持上限也偏高。
- **修复**: 输出触发的全量快照默认收紧到约 1 次/秒，结构性操作和聚焦终端实时流保持即时；诊断同时按消息频率和 `64 KB/s` 吞吐判压；保持状态 iframe 上限降为 3；VS Code 打开响应改为最多 16 条的有界最近缓存，并吞掉派生 Promise 的已处理拒绝，避免历史错误对象被未处理链路保留。
- **测试**: 服务端覆盖默认 1 秒合并预算；前端覆盖高吞吐诊断、3 iframe 上限和历史响应淘汰；真实 Chromium 复测资源面板和反复宫格/单屏切换。
- **文件**: `apps/server/src/services/agent-session-registry.ts`, `apps/web/src/lib/resource-diagnostics.ts`, `apps/web/src/lib/vscode-cache.ts`, `apps/web/src/lib/vscode-web-open.ts`

### 聚焦视图监控会话从右侧卡片列表消失

- **现象**: 会话进入大屏监控窗格后会从右侧小卡片分组中消失，用户无法从卡片判断其对应的窗格序号，也看不到当前黄色焦点的双向关联。
- **根因**: 右侧列表直接排除了 `terminalSlots` 中已显示的会话，并且小卡片没有接收窗格序号或活动窗格状态。
- **修复**: 右侧列表改为继续渲染全部未隐藏会话并保留原分组；监控中的卡片显示对应序号，活动窗格与卡片同步黄色高亮。点击已监控卡片只激活原窗格，点击未监控卡片继续沿用替换当前窗格的行为。
- **测试**: `pnpm --filter web test`（242/242）；`tests/e2e/terminal-preview.spec.ts`（12/12），覆盖编号、黄色关联、不搬移激活和未监控会话替换。
- **文件**: `apps/web/src/components/AgentFocusView.tsx`, `apps/web/src/components/FocusSidebarSessionCard.tsx`, `apps/web/src/components/AgentFocusView.test.ts`, `apps/web/src/app.css`, `tests/e2e/terminal-preview.spec.ts`

### 扫描或接入 tmux 后标题出现 `tmux:dev (bash)`

- **现象**: tmux 会话扫描、新建或接入后，卡片标题被自动改成 `tmux:<session>`、`tmux:<session> (<command>)`，远端扫描还会拼接目录和主机；用户无法把真实会话名与连接元数据分开阅读。
- **根因**: 本地/远端 tmux adapter、Agent scanner 和加入路由分别自行构造 `displayName`，把传输类型、命令、目录和主机都编码进用户可见标题；旧状态文件又会持久化这些系统生成标题。
- **修复**: 统一用真实 tmux session 名生成扫描、快速连接和加入后的标题，命令、目录、SSH 和 tmux 绑定继续使用现有结构化字段，内部 runtime id 保留命名空间；加载状态文件时只迁移可确定的旧版系统标题并保留自定义标题。宫格和聚焦右侧小卡用独立低调的 `tmux` 标签表达传输类型。
- **测试**: `tmux-display-name.test.ts`、`session-state-store.test.ts`、`local-tmux-adapter.test.ts`、`agent-scanner.test.ts`、`agent-sessions.tmux-add.test.ts`、`AgentFocusView.test.ts` 和 `terminal-preview.spec.ts` 覆盖标题、旧数据迁移、元数据、内部 ID、侧栏标签、窗格序号与黄色关联。
- **文件**: `apps/server/src/services/tmux-display-name.ts`, `apps/server/src/services/session-state-store.ts`, `apps/server/src/services/local-tmux-adapter.ts`, `apps/server/src/services/agent-scanner.ts`, `apps/server/src/routes/agent-sessions.ts`, `apps/web/src/components/FocusSidebarSessionCard.tsx`, `apps/web/src/app.css`

### tmux 中 Codex 的 Option/Alt+Space 无法换行

- **现象**: macOS 浏览器中的 `Option+Space` 不会到达 Codex；Windows/Linux 的 `Alt+Space` 即使被浏览器接收，也可能在 tmux 输入链路中失去组合键语义。
- **根因**: xterm 默认关闭 `macOptionIsMeta`，macOS Option 被当作字符输入修饰；后端又把 Meta 的 `ESC+Space` 拆成独立 `Escape` 和字面空格发送，Codex 无法把它识别为同一个快捷键。
- **修复**: xterm 统一开启 Option-as-Meta；本地 tmux adapter 在完整 CSI 键之后把 `ESC+Space` 和常用 Meta 字母、数字组合原子映射为 `M-*`。Windows 系统若在浏览器之前占用 `Alt+Space`，继续使用已支持的 `Shift+Enter` 换行。
- **测试**: `local-tmux-adapter.test.ts` 验证原子 `M-Space`/`M-b` 计划；隔离 Playwright E2E 分别模拟 macOS 和 Windows，验证 xterm WebSocket 帧及真实 tmux raw stdin 最终均为 `1b20`。
- **文件**: `apps/web/src/components/TerminalView.tsx`, `apps/server/src/services/local-tmux-adapter.ts`, `tests/e2e/hot-update-session-restore.spec.ts`

### tmux 当前窗格无法用鼠标滚轮控制

- **现象**: tmux/Codex 已开启 mouse tracking，点击可以选中对应 pane，但滚轮没有响应；只能滚 Kanban 的 xterm 历史。
- **根因**: 为防止普通 Codex 输入框把滚轮误解释为上下方向键，`TerminalView` 曾在 capture 阶段无条件 `preventDefault` 并停止所有 wheel 事件，连已明确开启 mouse tracking 的 TUI 也无法收到滚轮。原 E2E 又在滚轮前点击并只比较总帧数，把点击帧误判成滚轮帧。
- **修复**: 根据交互权和 `term.modes.mouseTrackingMode` 分流：交互 TUI 的普通滚轮放行给 xterm/tmux 当前 pane，`Shift+滚轮` 明确滚本地 scrollback；普通 shell、非输入监控 pane 和弹层仍保持原有本地滚动/防穿透行为。
- **测试**: `terminal-wheel.test.ts` 覆盖路由矩阵；修正后的 `tmux-enhancements.spec.ts` 在点击后重新取基线，并只接受 SGR/legacy wheel code `64/65`。同时回归普通终端历史、tmux 预灌历史、持续输出锁定、多屏非输入 pane 和扫描弹层防穿透。
- **文件**: `apps/web/src/components/TerminalView.tsx`, `apps/web/src/lib/terminal-wheel.ts`, `tests/e2e/tmux-enhancements.spec.ts`

### VS Code Web 无法读取浏览器剪贴板

- **现象**: Kanban 内嵌 VS Code 执行粘贴或读取剪贴板时提示 `Unable to read from the browser's clipboard`，即使 Kanban 使用 HTTPS。
- **根因**: `VSCodeDrawer` 的 iframe 没有通过 `allow` 委派 `clipboard-read` / `clipboard-write`；`/vscode/*` 代理也没有返回明确的同源剪贴板 Permissions-Policy。
- **修复**: iframe 显式声明两项剪贴板权限；代理保留上游已有的其他权限策略，替换剪贴板指令为 `clipboard-read=(self), clipboard-write=(self)`。
- **测试**: `VSCodeDrawer.test.ts` 断言 iframe 权限委派；`app.vscode-web-proxy.test.ts` 断言代理保留 `geolocation=()` 并追加同源剪贴板策略。
- **文件**: `apps/web/src/components/VSCodeDrawer.tsx`, `apps/server/src/routes/vscode-web-proxy.ts`

### tmux 重连后窗口显示在线但无法输入

- **现象**: 受管 tmux 窗口长时间运行或在手动重连与热更新恢复相邻发生后，pane 和内部 Codex 进程仍存活，但 Kanban 会话可能变为离线并无法输入。
- **根因**: `PtyRuntimeManager` 的旧 PTY `onData` / `onExit` 回调只按稳定 session ID 更新状态；新 PTY 替换旧 PTY 后，旧 runtime 的迟到退出仍会删除当前 handle 并执行 `markExited`，覆盖新 runtime 的在线状态。
- **修复**: 所有本地/远程 PTY 启动与重连回调在处理 data/exit 前校验当前 Map 中的 handle 身份；只有仍为当前 runtime 的 handle 可以写入输出或改变连接状态。
- **测试**: `pty-runtime-manager.test.ts` 真实启动并替换 PTY，等待旧进程退出后断言 registry 仍指向新 runtime、状态保持 online 且 manager 仍持有新 handle。
- **文件**: `apps/server/src/services/pty-runtime-manager.ts`, `apps/server/src/services/pty-runtime-manager.test.ts`

### Safari 快速输入时终端漏字

- **现象**: Safari 中连续快速输入字母时，Codex/tmux 输入框会间歇漏字；降低输入速度后字符完整。
- **根因**: WebKit 快速输入时可能在 xterm 仍记录着活动 `keydown` 的情况下派发 composed `insertText`；xterm 6 使用单个 `_keyDownSeen` 状态判断原生 input 是否已经由键盘事件处理，因此会忽略这条仍有效的文本事件且不触发 `onData`。
- **修复**: 仅在 Safari 中记录 xterm 已发送的短时普通文本；当 xterm 忽略的原生 `insertText` 冒泡到 `TerminalView` 时，按顺序抵消已发送字符并只补发缺失部分。恢复状态 100ms 后过期，控制序列会清空状态，IME composition 和非 Safari 浏览器保持原路径。
- **测试**: `terminal-safari-input.test.ts` 覆盖浏览器识别、完整去重、缺失后缀、交错按键和过期状态；Playwright 复现 WebKit 的 `keydown`/`insertText` 交错并断言完整字符串到达真实 tmux raw stdin，同时回归窗口切回、helper textarea 失焦和标题失焦后的普通输入。
- **文件**: `apps/web/src/components/TerminalView.tsx`, `apps/web/src/lib/terminal-safari-input.ts`, `tests/e2e/tmux-enhancements.spec.ts`

### 聚焦视图右侧轻量预览变成空白或竖线

- **现象**: tmux/Codex 主窗格仍正常，但聚焦视图右侧小卡片只显示空白、连续 `│` 或 `(B` 等乱码。
- **根因**: `outputPreview` 直接采用最后一个 PTY 数据块；TUI 高频重绘的末尾数据块经常只包含光标定位、擦除、边框绘制或终端字符集切换，覆盖了之前的可读预览。
- **修复**: 服务端先清理终端控制序列和框线，仅让包含足够可读字母、数字或中日韩字符的输出行更新预览，并对受管 tmux 使用更严格的短碎片阈值；绘制块仍更新活动状态但保留旧预览。前端补充清理 `ESC(B` / `ESC(0` 等字符集切换序列。
- **测试**: `agent-session-registry.test.ts` 覆盖绘制块不覆盖可读预览；`terminal-preview.test.ts` 覆盖终端字符集切换清理；实际 Chromium 聚焦页截图验证右侧卡片恢复可读文本。
- **文件**: `apps/server/src/services/agent-session-registry.ts`, `apps/web/src/lib/terminal-preview.ts`

### Markdown 预览中的 LaTeX 公式无法渲染

- **现象**: `.md` / `.markdown` 文件中的数学公式在内联预览、双击弹窗和实时分屏中显示为原始源码；尤其是论文文档常用的 `\(...\)` 和 `\[...\]` 即使接入 `remark-math` 后仍无法解析。
- **根因**: 初始 Markdown 渲染链没有数学 AST 和排版引擎；后续接入的 `remark-math` 官方语法又只识别美元分隔符，不识别目标文档使用的 LaTeX 反斜线分隔符。
- **修复**: 使用 `remark-math`、`rehype-katex` 和 `katex` 渲染美元分隔符；在 Markdown 解析前把普通文本区域的 `\(...\)` / `\[...\]` 规范化为对应美元分隔符，同时跳过行内代码、fenced code 和缩进代码。长块级公式允许横向滚动，错误公式降级为可见错误文本，原始 HTML 仍不执行。
- **测试**: `MarkdownFilePreview.test.ts` 覆盖四种公式分隔符、块级积分/分式、KaTeX display、MathML 和代码区域保护；目标 `APA_RF_LABC_RANKSTATIC_UNIFORM_BME_COMPARISON.md` 完整渲染得到 93 个 KaTeX/MathML 节点、37 个块级公式和 0 个 KaTeX 错误。
- **文件**: `apps/web/src/components/MarkdownFilePreview.tsx`, `apps/web/src/components/MarkdownFilePreview.test.ts`, `apps/web/src/app.css`

### 热更新与历史会话恢复

- 本地 tmux 的普通输入、移动端快捷键和分帧 bracketed paste 曾全部走 attached client PTY，导致 `Ctrl+A` / `Ctrl+B` 前缀与普通 TUI 输入互相干扰。修复为 `LocalTmuxInputRouter` 统一 REST/WebSocket 队列：普通输入走目标 pane，鼠标和 tmux 前缀及其下一条命令走 attached PTY，CSI-u Enter 保持原始字节。
- 单个 tmux window 左右分屏后，鼠标可以把活动 pane 切到右侧，但键盘和输入法内容仍进入左侧。根因是鼠标报告通过 attached client 改变了 tmux 活动 pane，而后续普通输入仍按会话接入时保存的固定 `tmuxPane` 执行 `send-keys`。修复为鼠标或前缀命令经过 client 后切换到 session 级动态目标，让普通输入跟随 tmux 当前活动 pane；连接清理后恢复固定 pane 绑定。
- WebSocket 关闭或重连后可能遗留半个 `Ctrl+A` / `Ctrl+B` 前缀或未结束的 bracketed paste，后续输入被 tmux 当成前缀命令或粘贴正文。根因是清理不完整且可能早于排队输入执行；修复为把清理作为同一 session 队列中的屏障，按序发送 best-effort Escape、清除 paste 状态，并在重连、恢复、删除和 kill 前等待完成，只读预览关闭不触发清理。
- 页面 reload 后，持久化的聚焦会话会在首个真实 session snapshot 到达前被当成“不存在”并清空。修复为清理 `focusedId` 前同时等待 `isLoading=false` 和非空 snapshot，稳定 ID 恢复后再校验。
- 会话状态文件指纹曾包含 `updatedAt`、连接态和交互态，终端输出或 idle/running 切换会造成持续落盘。修复为只对稳定元数据计算指纹，并把持久化运行态规范化为离线恢复态。
- 多个浏览器标签可同时触发 managed restore，重复 reconnect 同一稳定 session ID 并互相 kill PTY。修复为后端 restore single-flight，同一轮并发请求共享结果；Git 版本指纹读取也使用同类合并与缓存。
- 首次升级迁移曾把 `/api/agent-sessions` 原始快照直接写盘，短时间保留 `outputPreview`、PTY PID 和 runtime id。修复为迁移脚本写入前投影稳定允许字段，并用原子替换保存。
- 状态文件不可写时，registry 的首次订阅保存会直接阻止后端构建；重复 session ID 也会在 Map 恢复时静默覆盖卡片。修复为持久化错误只记录日志，并在加载时拒绝重复 ID。
- 大型 tracked binary diff 会超过 `execFile` 缓冲区并把版本检测永久降级为固定 revision，未跟踪大文件则先整体读入内存再截断。修复为流式哈希 tracked diff、循环有界读取未跟踪文件，并对超时 Git 子进程执行确定性终止。
- `restart-dev.sh` 即使活跃的本仓库后端会话目录捕获失败也继续停止进程，可能丢失首次迁移现场。修复为先识别仓库归属监听器，只有本仓库后端存在时才要求捕获成功，并在失败时于任何 kill 前退出；PID 只接受严格正整数并使用安全数组传给 `kill --`。
- 受管 tmux 恢复后浏览器终端可能显示用户 `.zshrc` 自动启动的 Claude，而真实 pane 仍是 Bash；同一问题也会让显式 direct 命令超时或被 TUI 吞掉。根因是命令经用户交互式登录 shell 执行，初始化脚本抢在目标命令前运行；修复为服务端生成的 tmux attach 和显式 direct 命令统一走非交互 `/bin/sh -c`，仅无命令终端保留用户原生交互 shell。
- 更新与恢复提示会长期遮挡大屏终端。修复为版本提示提供按 revision 持久化的关闭按钮，新 revision 才重新出现；恢复成功提示提供关闭按钮并在 5 秒内自动隐藏，恢复失败信息继续保留。
- 热更新 E2E 曾继承开发机 `.env` 的 Git 轮询开关，使无 upstream 的隔离仓库进入错误状态并遮住本地源码更新提示。修复为隔离运行时始终显式设置 `GIT_AUTO_PULL_INTERVAL_MINUTES=0|10|30`，测试行为不再受本机配置污染。
- 用户恰好在后台 Git 检查未结束时确认拉取，旧 single-flight 会把 apply 合并成 check，导致按钮已点击却没有 pull。修复为用户确认的 apply 等待当前 check 完成后继续执行；并发 apply 仍合并为一次，后台 check 也不会重复运行。

### 新建会话弹窗无法用鼠标滚轮滚动

- **现象**: 新建会话弹窗覆盖在终端卡片上时，鼠标滚轮不能滚动弹窗内容，滚轮操作反而作用到后方看板或终端。
- **根因**: `TerminalView` 的 document capture 滚轮兜底会按坐标命中被弹窗遮挡的终端，但此前只排除了 `.discovery-overlay`，没有识别 `.new-session-backdrop`；弹窗滚到边界后也没有独立阻断滚动链。
- **修复**: 将发现弹层和新建会话遮罩统一纳入终端滚轮阻断目标；新建会话遮罩使用 `overscroll-behavior: none`，弹窗滚动容器使用 `overscroll-behavior: contain`，确保滚轮留在当前弹窗内。
- **测试**: `terminal-wheel.test.ts` 覆盖弹层目标路由；Playwright 在短视口中验证弹窗 `scrollTop` 增长、背景看板不滚动，并覆盖弹窗到达底部后的滚动链隔离。
- **文件**: `apps/web/src/components/TerminalView.tsx`, `apps/web/src/lib/terminal-wheel.ts`, `apps/web/src/app.css`, `tests/e2e/discovery-new-session-ui.spec.ts`
