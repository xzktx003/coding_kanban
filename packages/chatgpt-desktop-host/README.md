# ChatGPT 桌面宿主适配

第四 ChatGPT 模式的独立基础包，固定 Mac 前端 + Linux native 宿主。当前仍在开发，尚未交付完整登录、共享线程、分屏、SSH/云与系统能力；[实施进度](../../docs/designs/chatgpt-desktop-mode-20261103/implementation-progress.md)逐项记录边界。

普通 `pnpm dev` 不启动本包宿主。资源/profile/WS 已接入网关；没有显式 `CHATGPT_DESKTOP_PROFILE_FILE` 时，新模式显示未配置。所有端口、协议、显示服务和私有目录来自部署配置，不从 HTTP 接受命令或上游地址。

```sh
pnpm --filter @agent-orchestrator/chatgpt-desktop-host run check
pnpm --filter @agent-orchestrator/chatgpt-desktop-host test
```

原包专项需显式提供 `CHATGPT_DESKTOP_TEST_LINUX_ROOT`、`CHATGPT_DESKTOP_TEST_MAC_ASAR` 和 `CHATGPT_DESKTOP_TEST_NATIVE_CHUNK`。缺失对应值时测试会跳过，跳过不计原生验收。使用用户授权的测试副本；测试不自动连接默认 CLI IPC 或导入账号。

`preparePrivateRuntime` 只准备新 runtime，`startPrivateDesktopService` 才显式启动。服务管理器先核整包和实际 child 身份，再排他发布 profile；关闭服务撤销记录和自有 view，保留已发布 native 任务。准备与管理是服务端 API，下文的 CLI 只提供固定容器启动与只读状态，不接受原生命令。宿主 GTK/Xvfb、外部隔离和 Electron 沙箱仍有部署关卡，不在主机静默增加 `--no-sandbox`。

`./container-host-service` 导出的 `startContainerDesktopService` 是已做无账号、断网验证的替代宿主 API，使用固定镜像 digest、可执行文件 SHA、显式 CPU affinity 和全新私有目录；`./container-service` 可只建立上游。两者都有 TypeScript 声明，实际字段和生命周期见协议。容器默认 network none、空 HOME，尚未接入正式账号、共享线程或默认启动；`close()` 撤销 profile/view 并断开传输，保留 native/container，不能当成停止任务接口。

局域网工作区需要 HTTPS 安全上下文。缺少 `crypto.randomUUID`/`crypto.subtle` 时，入口在创建原生 view 前明确拒绝；不能通过 crypto polyfill 或忽略证书错误把明文 HTTP 记成通过。

资源与桥接 API、预算、关闭和未知结果见[协议说明](../../docs/designs/chatgpt-desktop-mode-20261103/host-and-bridge.md)。原版文件原件保留，但入口和清单内 JS 的适配字节有独立原/新摘要，不能把整个响应集合称为未修改原版。

## 显式容器启动与状态

在仓库根目录运行；配置必须为本人拥有的普通 `0600` JSON 文件，直接父目录 `0700`，路径规范且不经 symlink。配置最多 16 KiB，拒绝重复字段与未知选项。此入口不随 `pnpm dev` 启动，不新增端口或启动另一份看板。

```sh
node packages/chatgpt-desktop-host/src/service-cli.mjs start --config /absolute/private/service.json
node packages/chatgpt-desktop-host/src/service-cli.mjs status --config /absolute/private/service.json
```

配置使用 `{ "version": 1, "options": { ... } }`，`options` 直接对应 `startContainerDesktopService`：

| 字段                                | 配置要求                                                                                                                                                                                                                  |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `imageDigest`                       | 已安装且经过核验的固定 `sha256:…` 镜像 ID，不接受浮动 tag                                                                                                                                                                 |
| `sourceRoot`                        | 固定 Linux 原包目录                                                                                                                                                                                                       |
| `runtimeRoot`                       | 本次全新且尚不存在的私有运行目录，父目录须已存在并为 `0700`                                                                                                                                                               |
| `bridgeRoot`                        | 本次全新、已存在且为空的 owned `0700` 目录；Unix socket 路径长度仍受原 API 限制                                                                                                                                           |
| `cpuId`                             | 当前进程允许使用的 CPU 编号                                                                                                                                                                                               |
| `memoryLimitMiB`                    | 可选服务端内存预算，仅 `2048` / `4096` / `8192` MiB，默认 `2048`；启动和重连按同一预算严格核验 Docker Memory，不接受 HTTP 选择或 Docker 单位字符串；不改变其他隔离、队列与任务限制 |
| `pidsLimit`                         | 可选服务端进程/线程预算，仅 `256`（默认）或 `512`；新实例启动和重连严格核验 Docker PidsLimit，不接受 HTTP 选择、字符串或任意上限，不修改存活容器 |
| `macAsarPath` / `macAsarSha256`     | 固定参考 Mac ASAR 的规范绝对路径与完整摘要                                                                                                                                                                                |
| `profileFile` / `controlSocketPath` | 同一私有目录下本次尚不存在的固定记录和 socket；不覆盖旧实例                                                                                                                                                               |
| `dockerPath` / `dockerSha256`       | 已核验 Docker 可执行文件路径与摘要                                                                                                                                                                                        |
| `pythonPath` / `pythonSha256`       | 已核验 Python 可执行文件路径与摘要                                                                                                                                                                                        |
| `nodePath` / `nodeSha256`           | 已核验 Node 可执行文件路径与摘要                                                                                                                                                                                          |
| `startupTimeoutMs`                  | 可选，沿用底层 API 的 100–180000 ms 范围                                                                                                                                                                                  |
| `initialMode`                       | 可选且仅为 `"codex"`；使用原版 Codex 启动偏好，不设置 feature flag；省略时保持 API 原行为                                                                                                                                 |
| `serverSsh`                         | 可选布尔值，默认关闭；仅 `true` 为本次新宿主启用固定私有 SSH UDS，不接受自选 socket 路径或 SSH 命令配置 |
| `networkMode`                       | 可选 `"none"` / `"bridge"`，默认 none                                                                                                                                                                                     |
| `accountSnapshot`                   | 可选 `{ "sourceFile": "/absolute/authorized/auth.json", "homeRoot": "/absolute/new/tmpfs-home" }`，必须显式选择 bridge；所有原 API 的权限、tmpfs、空目录、范围与写前校验保持                                              |
| `connection`                        | 可选 `{ "httpProxy": "http://proxy.example:8080", "httpsProxy": "http://proxy.example:8080", "noProxy": "localhost,127.0.0.1" }`，必须显式选择 bridge；至少提供一种代理，仅接受无凭据、路径、query 的 HTTP(S) 代理 origin |
| `projectRoots`                      | 可选，最多 8 个服务端固定的规范绝对目录；当前用户拥有且非 world-writable，允许 `0775`；同路径 RW、禁用递归 bind，不接受 HTTP 选择根或挂载选项                                                                             |

CLI 只读取配置中的凭据源**路径**；实际授权快照由既有容器 API 校验和创建，状态命令不读取凭据源。配置及账号路径只保存在被 Git 忽略的私有部署目录，不放进命令行、普通输出或提交。bridge 允许一般外部及 LAN 出站，并非出站白名单；快照不刷新原登录。

`connection` 只作用于本次新 native，省略时保留原空环境与直连行为。它分别设置 CLI 子进程使用的小写代理环境，以及 Electron 原生 `net.fetch` 使用的 Chromium `--proxy-server` / `--proxy-bypass-list`；不替换官方网络请求或 `webRequest` 策略。HTTP 与 HTTPS 映射独立，只提供 `httpsProxy` 时 HTTP 保持直连；不猜测全协议 fallback。`noProxy` 同时设置两个大小写环境名，并将域名后缀、IPv6 与 CIDR 转为 Chromium 的 bypass 列表。只复制服务端配置中明确给出的值，不读取或复制账号源的模型 provider、feature flags、历史或其它配置。连接值只进入 owned `0600` 私有 grant，不发布到浏览器 profile，仍受原 4096 字节 grant 预算限制。

`projectRoots` 省略或为空时保留原六项挂载。固定根须互不覆盖，拒绝与原包、服务端源码、运行、bridge、profile/control、Mac ASAR、账号源/HOME 和工具路径交叠；不创建、清空或改权限。新 runtime 的私有原生配置只写入这份固定列表，保留 16 KiB 上限。服务持有根目录 FD，核对 Docker 的完整 Mounts/HostConfig 及非递归选项；启动和重连在验证本次 init PID/start ticks、UID、cgroup、PID/mount namespace 后，沿该进程真实 root 核对挂载 inode，grant 和每次实际写入前再同步验证。目录替换、权限或进程身份变化会拒绝写入，不重试或停止 native。断连保留根 FD 供重连，启动失败或已知 native 退出才释放；host 自身验证 FD 在 profile 关闭时释放。首期先选仓外独立 scratch 项目；要接整仓库，须先将原包、私有 runtime 和服务端部署移出项目根，不能为此放宽保护路径覆盖。

看板网关须预先将 `CHATGPT_DESKTOP_PROFILE_FILE` 设为同一个 `profileFile`，在既有 HTTPS 局域网地址访问 `/?mode=chatgpt`。已有网关加载环境变更仍按仓库的安全热更新流程操作，不为此重启 Agent 或官方 daemon；CLI 不改变现有地址、协议、端口或浏览器文档。

启动成功输出 `published` 和公共 profile/generation UUID。它只证明本次 profile 发布成功，不代表账号、模型会话、UI 或原版全部能力通过。`status` 在本地复核 profile、manager PID/start ticks 与 socket 身份，并只进行 broker hello；不创建 view，不发送 AppHost/native RPC，不连接/继续线程。`broker_ready` 不等于 native/模型已验收，输出明确标记 `nativeState:not_observed`、`resourcesVerified:false`；资源内容仍由看板既有正式验证链核对。

配置 `serverSsh:true` 时，`status` 还要求 profile 的 `serverSshSocketPath` 精确等于 `bridgeRoot/server-ssh.sock`；省略或 `false` 时拒绝该额外字段。此处只核对声明路径，仍只连接原 control socket 做 hello，不探测 SSH UDS 或远端，不能将状态结果当作 SSH 握手成功。该选项仅供新宿主启动，恢复入口继续拒绝 SSH 重挂载。

每次启动以 `profileFile + ".launch"` 排他创建 owned `0600` 私有记录，防止并发或失败后重复尝试。它包含本次 manager 身份与必要的私有容器元数据，不输出这些路径或容器 ID。已有 profile、socket 或启动记录均拒绝覆盖；需要新一次启动时显式使用新配置与新目录，不按过期 PID 自动清理、接管或重试。

前台 Ctrl+C 或服务管理器发 SIGTERM 只调用本次服务的 `close()`：撤销 profile、关闭自身 view 并断开传输，保留 native/container。只有 close 成功并持久写入 `retired` 后，CLI 排空自身输出并退出自己的 manager 进程；这不会向 native/container 发停止信号。启动中取消会等待该单次启动结果，迟到成功立即关闭自身服务，不发布 ready 事件；未知启动/关闭结果保留为 `retained_unknown`，不会强制退出 manager 或重复原生操作，也不把它报告成任务已停止。CLI 不提供强制重启、停止任务或删除旧记录的命令。

隔离验收若需定位 `CONTAINER_DOCKER_FAILED`，可在服务端夹具中显式调用 `test/fixtures/docker-command-diagnostic.mjs` 的 `prepareFixtureDockerDiagnostic({ directory, dockerPath, dockerSha256, pythonPath, pythonSha256 })`，将返回的 `dockerPath`、`dockerSha256` 传给本次新服务配置。它只生成私有工具包装器，不启动 Docker 容器；每次固定校验真实 Docker 路径与摘要，原样透传 stdin/stdout，在 owned `0600`、总计 256 KiB 的私有日志记录命令阶段、退出码、errno、信号、耗时及最多 16 KiB stderr，不记录参数值、环境或 stdin。外层终止只转发到本次 Docker CLI 子进程，`timeout:null` 表示无法区分外部终止与调用方超时；不据耗时推断原因，不重试失败命令或停止原生任务。此夹具不进入普通启动、HTTP 路由或产品配置默认值。
