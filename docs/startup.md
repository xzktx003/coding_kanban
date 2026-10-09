# 启动、编译与更新

推荐入口是仓库根目录的 `pnpm dev:restart`（等价于 `./scripts/restart-dev.sh`）。它先完成构建，再重启本仓库前后端，最后分别检查 Node 网关、前端和会话运行层。启动成功后使用输出的 `Open` 局域网地址；例如 HTTPS `https://10.30.0.22:8484/?mode=session`，实际主机、端口及协议以 `.env` 和输出为准。

## 首次安装

需要 Git、Node.js `^20.19.0 || >=22.12.0`、pnpm 10.13.1。默认启用会话模式，还需要 Rust stable、C/C++ 编译工具和 CMake；原生终端依赖需要 Python 3。Linux 重启脚本需要 Bash、curl、lsof、setsid、ps 和 readlink；默认 HTTPS 需要 mkcert 或 OpenSSL。安装示例见 [README](../README.md#环境要求)。

```bash
pnpm install --frozen-lockfile
cp .env.example .env  # 仅首次执行；不要覆盖已有配置
# 编辑 .env 中的主机、端口、证书及可选配置
pnpm dev:restart
```

第一次 Rust 编译需要下载依赖，耗时明显长于后续增量构建。依赖缺失、构建失败、无效端口或其他仓库占用端口时，脚本报错退出；这些检查都发生在停止已有服务之前。脚本不会自动安装系统工具或覆盖本机配置。

## 日常启动与拉取更新后

```bash
# 首次安装或依赖清单更新后执行
pnpm install --frozen-lockfile
pnpm dev:restart
pnpm session:status
```

`dev:restart` 会编译 shared，并对默认 Rust 运行层执行增量 Cargo build。随后保存可迁移的终端状态，重启本仓库 Node/Vite；前端固定绑定 `0.0.0.0`，使用指定端口，端口冲突不会静默换端口。HTTPS 默认开启。局域网会话界面依赖浏览器安全上下文（例如 `crypto.randomUUID`），应保留 HTTPS 并信任证书；`WEB_HTTPS=0` 仅适合终端模式或 localhost 调试，不作为局域网会话入口。

运行中的 Rust 服务和 Agent 保持复用。重启后端并不重启 Rust；前后端准备完毕但会话健康检查失败时，脚本返回非零状态并输出运行层日志路径。

## 构建和运行版本是两件事

| 命令 | 作用 |
| --- | --- |
| `pnpm dev:prepare` | 只编译 shared / 默认 Rust，不重启服务 |
| `pnpm dev:restart` | 准备完成后重启前后端，复用已有 Rust 服务 |
| `pnpm dev` | 相同构建准备后在当前终端启动前后端，默认 HTTP |
| `pnpm session:build` | 单独构建 Rust debug 二进制 |
| `pnpm session:status` | 检查会话健康；Linux 下核对所属进程的运行文件与磁盘产物 |
| `pnpm check` | shared、Node 后端、Web 类型检查和构建，不包含 Rust |
| `pnpm session:check` | 单独检查 Rust 编译 |

当状态显示“运行中的二进制与磁盘构建产物不同”，当前 Agent 仍使用已有运行文件，新 Rust 代码尚未激活。应在任务结束后安排明确的运行层重启；日常启动脚本不会自动终止它。该检查比较运行文件身份，不等同于源码版本证明；非 Linux 或无法核对归属时会明确显示无法判断。

`session:status` 不发送停止命令；健康接口沿用现有管理器行为，服务已退出时可以按持久身份重新启动，仍存活但不可用时不会强杀或重复启动。禁用会话模式时只报告配置状态，不检测终端健康。

## 可选配置

- 仅使用终端模式：`.env` 设置 `SESSION_MODE_ENABLED=0`，启动准备跳过 Rust。
- 已有自定义产物：设置 `SESSION_RUNTIME_BIN` 为可执行文件。相对路径统一从仓库根目录解析；启动准备只校验文件，不代为编译或覆盖它。
- Cargo 不在默认位置：通过 `.env` 的 `SESSION_CARGO_BIN` 指定可执行路径。启动准备及 `session:*` 构建命令都读取该配置。
- 自定义 Cargo 输出目录：构建完成后设置 `SESSION_RUNTIME_BIN`；默认启动只查找 `packages/session-runtime/target/debug/codexia-web`。
- 会话数据：保持 `SESSION_DATA_HOME` 一致以恢复项目和关注记录；独立联调必须使用独立目录、端口和 CLI 配置目录。

需要分开启动时，先运行 `pnpm dev:prepare`，再在两个终端分别运行 `pnpm --filter server run dev:app` 和 `pnpm --filter web run dev:app`。前台方式不释放占用端口，也不执行重启脚本的证书准备；局域网会话必须使用 HTTPS 推荐入口；前台 HTTP 调试请在本机通过 localhost 访问。Ctrl+C 停止前台前后端不会自动停止独立 Rust 服务。

## 故障定位与验收

1. 提示依赖缺失：运行 `pnpm install --frozen-lockfile`；Node 版本不满足时先切换版本。
2. Cargo 编译失败：按首个编译错误补齐工具或依赖，然后重新启动；已有服务仍保留。
3. 端口被其他工作区占用：修改本仓库 `.env` 端口，或确认归属后自行处理；脚本不会清理外部进程。
4. 前端可打开但会话不可用：运行 `pnpm session:status`，检查输出中的运行层日志及 `.dev-runtime/server.log`；不要把 `/api/health` 成功当作会话验收。
5. 在同网段设备打开输出的 `Open` 地址，确认页面加载和会话连接；服务器本机的 HTTP 检查不能代替其他设备连通性检查。

### 终端一直显示“服务已更新，等待恢复 tmux 会话”

这是网关从持久快照加载卡片后的待恢复状态，不代表 tmux 窗口已经消失。检查 `POST /api/agent-sessions/restore-managed` 是否完成，再检查 `tmux list-sessions` 能否在几秒内返回。只确认 `/api/health` 正常不足以验收终端恢复。

如果查询卡住，可通过 tmux 服务进程的 `/proc/<pid>/limits` 与 `/proc/<pid>/fd` 数量检查文件描述符是否耗尽。确认 PID、用户和控制 socket 的归属后，可在现有硬上限内提高该进程的软上限；不要重启 tmux 服务、杀死 pane 或清理未知客户端。此次现场将软上限从 1024 提高到 8192 后恢复查询；这属于运行进程调整，不会自动持久到新 tmux 服务。

网关现在在 `preClose` 阶段释放自己管理的 PTY 客户端，避免 HTTP/WebSocket 排空拖延清理；不结束 tmux pane 中的 Agent。tmux 本机查询默认最多等待 5 秒，远程 SSH 查询最多等待 10 秒，超时只回收该次查询子进程并报告失败。同步历史和选项查询也有对应上限。

2026-10-09 验收：两项失败用例先红后绿；恢复、关闭与查询相关 36 项测试通过；隔离 tmux socket 连续三次创建/关闭网关，客户端数每次回到零，原 pane ID 与进程 PID 不变。PTY 既有回归首轮 21 项通过，1 项带点名称的客户端就绪测试触及其 1 秒时限，定点复测通过。共享包/后端构建和最终类型检查通过。

通过实际局域网 HTTPS 页面 `https://10.30.0.24:8484/?mode=terminal` 验证恢复接口返回 200、33 个本机 tmux 卡片在线、等待提示清零、真实终端 WebSocket 历史回放完成，页面脚本无错误。2 个远程会话不可访问，10 个 direct PTY 保持手动恢复；未重新启动它们。现场数据、日志和浏览器记录保存在被忽略的 `.dev-runtime/tmux-recovery/`，未验证另一台物理设备访问。

脚本回归：`node --test scripts/*.test.mjs`；运行层管理器回归：`pnpm --filter server exec tsx --test src/services/session-runtime-manager.test.ts`。联调应在隔离目录通过真实 `pnpm dev:restart` 验证首次启动、重复启动复用运行服务、准备失败保留原进程，再检查局域网页面及 API。


### 本次验收（2026-10-08）

- `pnpm dev:prepare`：shared 与默认 Rust 增量编译通过；当前运行层 PID 保持不变。
- `pnpm check` 通过；脚本测试 95 项、运行层管理器测试 3 项通过。
- 独立副本、独立端口和数据目录实际执行启动及重启，确认复用同一 Rust PID / instance；故意设置不存在的运行层产物时，命令失败且三个服务的 PID 不变。
- 浏览器通过独立 **HTTPS 局域网地址** 验证前端代理的两层健康接口、会话/终端切换、刷新和手机尺寸；`dev-startup.spec.ts` 与 `session-mode.spec.ts` 的导航用例共 2 项通过。旧导航用例引用已移除的顶栏选择器，此次已改为校验当前导航。
- HTTP 局域网试运行暴露出浏览器安全上下文限制，已在指南和脚本输出中明确要求会话入口使用 HTTPS。未声称独立物理手机或另一台同网段设备已验收。
- 测试服务结束后清理；当前正式会话运行层保留。日志位于本机被忽略的 `.dev-runtime/startup-refresh/`，不提交证书、数据和截图。
