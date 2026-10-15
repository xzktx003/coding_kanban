# 启动、编译与更新

推荐入口是仓库根目录的 `pnpm dev:restart`（等价于 `./scripts/restart-dev.sh`）。它先完成构建，再重启本仓库前后端，最后分别检查 Node 网关、前端和会话运行层。启动成功后使用输出的 `Open` 局域网地址；例如 HTTPS `https://10.30.0.22:8484/?mode=session`，实际主机、端口及协议以 `.env` 和输出为准。

## 首次安装

需要 Git、Node.js `^20.19.0 || >=22.12.0`、pnpm 10.13.1。默认会话运行层使用 TypeScript / Node.js，无需 Rust 工具链。原生终端和 SQLite 依赖在缺少平台预编译包时需要 Python 3、C/C++ 编译工具；语音推理使用独立外部可执行程序。Linux 重启脚本需要 Bash、curl、lsof、setsid、ps 和 readlink；默认 HTTPS 需要 mkcert 或 OpenSSL。安装示例见 [README](../README.md#环境要求)。

```bash
pnpm install --frozen-lockfile
cp .env.example .env  # 仅首次执行；不要覆盖已有配置
# 编辑 .env 中的主机、端口、证书及可选配置
pnpm dev:restart
```

首次安装会下载 Node 依赖并准备平台原生组件；随后编译 shared 和 TypeScript 会话运行层。依赖缺失、构建失败、无效端口或其他仓库占用端口时，脚本报错退出；这些检查都发生在停止已有服务之前。脚本不会自动安装系统工具或覆盖本机配置。

## 日常启动与拉取更新后

```bash
# 首次安装或手动拉取源码后执行；在线确认更新会自动完成这两步
pnpm install --frozen-lockfile
pnpm dev:restart
pnpm session:status
```

`dev:restart` 会编译 shared，并构建 `packages/session-runtime/src` 至 `dist`。没有存活会话服务时，默认使用当前 Node 可执行文件启动 `packages/session-runtime/dist/main.js`。随后保存可迁移的终端状态，重启本仓库 Node/Vite；前端固定绑定 `0.0.0.0`，使用指定端口，端口冲突不会静默换端口。HTTPS 默认开启。局域网会话界面依赖浏览器安全上下文（例如 `crypto.randomUUID`），应保留 HTTPS 并信任证书；`WEB_HTTPS=0` 仅适合终端模式或 localhost 调试，不作为局域网会话入口。

看板的在线更新在用户确认 fast-forward 后会自动等待目标版本、运行 `pnpm install --frozen-lockfile`，再执行 `pnpm dev:restart`。用户无需另行安装依赖或再次确认重启；运行中的独立会话服务和 Agent 会复用（包括升级前的 legacy Rust 服务）。更新日志保存在 `.dev-runtime/online-update.log`。若页面没有恢复，先查看该日志，再按下方步骤手动运行依赖安装和重启命令。

运行中的会话服务和 Agent 保持复用。重启后端不会重启独立运行层；前后端准备完毕但会话健康检查失败时，脚本返回非零状态并输出运行层日志路径。

## 后端热更新的依赖保护

`dev:app` 使用 `scripts/watch-server.mjs` 监听后端/shared 源码及 workspace 的依赖清单、锁文件。首次启动或清单变化时先运行 `pnpm install --frozen-lockfile`，成功且后端声明的运行依赖可解析后，才停止旧 Node 网关并加载新源码。普通源码保存不重复安装；同一批文件变更合并处理，安装期间的新变更在替换网关前重新检查。

依赖安装失败（网络、锁文件不一致等）时记录错误并保留当前网关；修复原因后保存受监听源码或清单可重试。在线更新安装失败也跳过重启。此保护针对依赖准备顺序，不保证新源码的语法、启动逻辑错误零停机；已运行代码后续动态导入新文件也不在保护范围。原 Rust 会话运行层与 Agent 不受热更新管理。

网关意外退出（包括 OOM 后的退出信号）会经同一依赖准备与串行队列按 1/2/4 秒重试，连续失败最多三次，耗尽后明确记录原因并等待源码/清单保存。存活至少 60 秒或显式保存后恢复重试预算；计划热更新、关闭 watcher 会取消待执行恢复，避免双重启动。仅恢复 Node 网关，已有独立会话运行服务、原生宿主和 Agent 保持原进程。此措施恢复掉线服务，不能作为内存泄漏已解决的证据；OOM 现场仍需保留日志并调查增长来源。

相关回归：`node --test scripts/watch-server.test.mjs scripts/finalize-online-update.test.mjs`，包含真实隔离 watcher 进程在安装失败时保持旧网关存活、修复后替换及关闭子进程检查。局域网入口仍使用 `dev:restart` 输出的 HTTPS 地址与 `.env` 端口，前端绑定 `0.0.0.0`。

## 构建和运行版本是两件事

| 命令 | 作用 |
| --- | --- |
| `pnpm dev:prepare` | 只编译 shared / 默认 TS 运行层，不重启服务 |
| `pnpm dev:restart` | 准备完成后重启前后端，复用已有会话服务 |
| `pnpm dev` | 相同构建准备后在当前终端启动前后端，默认 HTTP |
| `pnpm session:build` | 先构建 shared，再编译 TS 会话运行层至 `dist` |
| `pnpm session:status` | 检查会话健康、归属和实现；TS 比较全部 JS 构建指纹，legacy 比较可执行文件身份 |
| `pnpm check` | 依次构建 shared、TS 会话运行层、Node 后端和 Web，并执行类型检查 |
| `pnpm session:check` | 先构建 shared，再检查 TS 会话运行层类型 |
| `pnpm session:test` | 先构建 shared，再运行 TS 会话运行层测试 |
| `pnpm session:clippy` | 历史命令名兼容入口，目前等同于 TS 类型检查 |

当状态显示“运行中的二进制与磁盘构建产物不同”，当前 Agent 仍使用已有运行代码，新构建尚未激活。TS 服务的身份记录保存启动前整个 `dist/**/*.js` 的 SHA-256 指纹，状态命令比较磁盘当前产物；legacy 服务仍比较 Linux 可执行文件身份。这个检查不等同于源码版本或完整功能验收；非 Linux、记录不完整或无法核对归属时明确显示无法判断。

默认入口改成 TS 后，已有 legacy Rust 服务继续复用，状态命令会明确提示。构建、网关热更新、改变 `SESSION_RUNTIME_BIN` 都不会替换存活运行服务。应在任务结束并确认安全窗口后安排显式切换，不能通过删除 `runtime.json`、启动锁或重复启动来绕过存活服务检查。迁移范围和行为验收另见 [TypeScript 迁移清单](session-typescript-migration.md)。

`session:status` 不发送停止命令；健康接口沿用现有管理器行为，服务已退出时可以重新启动，仍存活但不可用或身份无法核对时不会强杀或重复启动。启动锁避免两个网关同时创建服务，持久身份以原子替换写入。损坏身份或无法判断归属的锁会明确报错，先保留记录、日志和相关进程再排查。禁用会话模式时只报告配置状态，不检测终端健康。

## 可选配置

- 仅使用终端模式：`.env` 设置 `SESSION_MODE_ENABLED=0`，启动准备跳过会话运行层构建。
- 已有自定义产物：设置 `SESSION_RUNTIME_BIN` 为可执行文件。相对路径统一从仓库根目录解析；启动准备只校验文件，不代为编译或覆盖它。
- 默认 TS 入口由 Node 启动，无需执行权限；`SESSION_RUNTIME_BIN` 是独立可执行程序兼容接口，不能直接填入没有启动器的 JavaScript 文件。
- 会话数据：保持 `SESSION_DATA_HOME` 一致以恢复项目和关注记录；独立联调必须使用独立目录、端口和 CLI 配置目录。

需要分开启动时，先运行 `pnpm dev:prepare`，再在两个终端分别运行 `pnpm --filter server run dev:app` 和 `pnpm --filter web run dev:app`。前台方式不释放占用端口，也不执行重启脚本的证书准备；局域网会话必须使用 HTTPS 推荐入口；前台 HTTP 调试请在本机通过 localhost 访问。Ctrl+C 停止前台前后端不会自动停止独立会话服务。

## 故障定位与验收

1. 在线更新后仍提示依赖缺失：查看 `.dev-runtime/online-update.log`；需要手动恢复时运行 `pnpm install --frozen-lockfile` 和 `pnpm dev:restart`。Node 版本不满足时先切换版本。
2. TS 编译或原生 Node 依赖安装失败：先运行 `pnpm install --frozen-lockfile`，再按首个错误修复并运行 `pnpm session:check` / `pnpm session:build`；已有服务仍保留。
3. 端口被其他工作区占用：修改本仓库 `.env` 端口，或确认归属后自行处理；脚本不会清理外部进程。
4. 前端可打开但会话不可用：运行 `pnpm session:status`，检查输出中的运行层日志及 `.dev-runtime/server.log`；不要把 `/api/health` 成功当作会话验收。若接口提示“会话服务尚未启动”，还须核对网关进程实际继承的 `SESSION_MODE_ENABLED`；启动环境中的 `0` 会禁用会话，即使 `.env` 没有这一项。需要会话模式时，在本机 `.env` 显式设置 `SESSION_MODE_ENABLED=1`，再执行 `pnpm dev:restart`。
5. 在同网段设备打开输出的 `Open` 地址，确认页面加载和会话连接；服务器本机的 HTTP 检查不能代替其他设备连通性检查。

### 终端一直显示“服务已更新，等待恢复 tmux 会话”

这是网关从持久快照加载卡片后的待恢复状态，不代表 tmux 窗口已经消失。检查 `POST /api/agent-sessions/restore-managed` 是否完成，再检查 `tmux list-sessions` 能否在几秒内返回。只确认 `/api/health` 正常不足以验收终端恢复。

如果查询卡住，可通过 tmux 服务进程的 `/proc/<pid>/limits` 与 `/proc/<pid>/fd` 数量检查文件描述符是否耗尽。确认 PID、用户和控制 socket 的归属后，可在现有硬上限内提高该进程的软上限；不要重启 tmux 服务、杀死 pane 或清理未知客户端。此次现场将软上限从 1024 提高到 8192 后恢复查询；这属于运行进程调整，不会自动持久到新 tmux 服务。

网关现在在 `preClose` 阶段释放自己管理的 PTY 客户端，避免 HTTP/WebSocket 排空拖延清理；不结束 tmux pane 中的 Agent。tmux 本机查询默认最多等待 5 秒，远程 SSH 查询最多等待 10 秒，超时只回收该次查询子进程并报告失败。同步历史和选项查询也有对应上限。

2026-10-09 验收：两项失败用例先红后绿；恢复、关闭与查询相关 36 项测试通过；隔离 tmux socket 连续三次创建/关闭网关，客户端数每次回到零，原 pane ID 与进程 PID 不变。PTY 既有回归首轮 21 项通过，1 项带点名称的客户端就绪测试触及其 1 秒时限，定点复测通过。共享包/后端构建和最终类型检查通过。

通过实际局域网 HTTPS 页面 `https://10.30.0.24:8484/?mode=terminal` 验证恢复接口返回 200、33 个本机 tmux 卡片在线、等待提示清零、真实终端 WebSocket 历史回放完成，页面脚本无错误。2 个远程会话不可访问，10 个 direct PTY 保持手动恢复；未重新启动它们。现场数据、日志和浏览器记录保存在被忽略的 `.dev-runtime/tmux-recovery/`，未验证另一台物理设备访问。

脚本回归：`node --test scripts/*.test.mjs`；运行层管理器回归：`pnpm --filter server exec tsx --test src/services/session-runtime-manager.test.ts`。联调应在隔离目录通过真实 `pnpm dev:restart` 验证首次启动、重复启动复用运行服务、准备失败保留原进程，再检查局域网页面及 API。


### 历史验收（2026-10-08，原 Rust 默认入口）

- `pnpm dev:prepare`：shared 与默认 Rust 增量编译通过；当前运行层 PID 保持不变。
- `pnpm check` 通过；脚本测试 95 项、运行层管理器测试 3 项通过。
- 独立副本、独立端口和数据目录实际执行启动及重启，确认复用同一 Rust PID / instance；故意设置不存在的运行层产物时，命令失败且三个服务的 PID 不变。
- 浏览器通过独立 **HTTPS 局域网地址** 验证前端代理的两层健康接口、会话/终端切换、刷新和手机尺寸；`dev-startup.spec.ts` 与 `session-mode.spec.ts` 的导航用例共 2 项通过。旧导航用例引用已移除的顶栏选择器，此次已改为校验当前导航。
- HTTP 局域网试运行暴露出浏览器安全上下文限制，已在指南和脚本输出中明确要求会话入口使用 HTTPS。未声称独立物理手机或另一台同网段设备已验收。
- 测试服务结束后清理；当前正式会话运行层保留。日志位于本机被忽略的 `.dev-runtime/startup-refresh/`，不提交证书、数据和截图。

### 终端历史文件读取失败或看板为空

终端记录使用 `SESSION_STATE_PATH`（默认 `.dev-runtime/agent-sessions.json`），浏览器分组和排版另存于该设备的 localStorage。历史文件损坏或不支持时，网关明确报错并阻止覆盖原文件；只有文件不存在才按首次启动处理。重启脚本也不会用空接口结果覆盖已有非空历史或损坏文件。先备份现场，再用已验证快照恢复原 ID，不要通过重新创建会话替代历史恢复。仅恢复仍存活的 tmux；direct PTY、已消失及不可达目标保留手动恢复，不自动重跑历史命令。

实际恢复的只读浏览器验收可设置 `TERMINAL_RECOVERY_LIVE=1` 并运行 `tests/e2e/terminal-history-recovery-live.spec.ts`；测试用独立浏览器存储验证分组刷新关联，不读取或覆盖用户设备布局。

## 文件监听配额降级（2026-10-14）

TypeScript 运行层的文件监听遇到 EMFILE/ENOSPC 时，使用 500 ms 的元数据轮询降级。每个登记路径最多保存 4096 项轮询元数据，stat 并发上限为 8，递归目录仍遵守原 maxDirectories 边界；超过预算明确报错，不无限扫描。合并同一路径/别名的引用，取消监听和关闭服务时释放计时器与快照，不终止其他监听进程。此运行层改动经编译后仍按既有活跃 Agent 安全窗口启用，不因网关热更新而隐式替换运行进程。

### 2026-10-14 开发网关监听配额降级

`scripts/watch-server.mjs` 对 EMFILE/ENOSPC 使用整组元数据轮询降级，避免 Node recursive 监听部分注册后漏掉源码保存。每条路径快照最多 4096 项，不读取正文或追随符号链接，默认 1 秒扫描且不重叠，退出时关闭定时器。权限和其他错误不冒充配额耗尽。降级不改变依赖准备、失败保留旧网关、保存重试及独立运行层复用规则；覆盖真实子进程启动与模拟晚到配额错误的测试在 `scripts/watch-server.test.mjs`。现有 watcher 进程不会因脚本更新自行重启。

原生刷新候选路径的显式隔离启动：新宿主的 `--refresh-service-config` 和 `--refresh-domain` 仅接入已验证的私有服务；检查发生在登录副本导入和扩展安装前，失败不重启服务。可选 `--reconnection-grace-seconds` 为 1–300 秒（该显式模式默认 60），不是 thread TTL。独立客户端路由由服务端按 UUID 注册，`/?mode=codex&nativeClient=<UUID>` 只选择已注册宿主；关注集合共用，布局、原生状态目录和连接分别隔离。默认 `pnpm dev`、正式运行服务和已有 Agent 不因这些参数改变。完整参数及当前红灯见 [组件说明](../packages/native-codex-host/refresh-prototype/README.md#explicit-private-host-and-client-routing) 和 [持续验收](designs/codex-mode-audit-20261014/refresh-recovery-progress-20261015.md)。

生成的隔离 CLI 包装器每次执行都重查固定服务域、代次、PID 和 Linux start ticks，连接打开后、initialize 转发前再次核对；失效不附着新实例。保温管理器启动在线程操作前核对两次原生只读账号/工作区身份及初始通知，等待有界（默认 15 秒）。这些步骤失败只关闭自己的连接，不重启服务或停止任务。手机验收按用户确认使用 iPhone 16 尺寸模拟，参数、浏览器引擎和系统键盘边界记入原始结果。
