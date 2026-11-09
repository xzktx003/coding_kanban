# 第四模式的独立局域网候选入口

第四模式可以使用独立网关和 HTTPS 前端运行候选版本。原 8484 服务、其固定 profile 和已运行任务不因启动候选而被替换。候选使用单独的 supervisor、profile、原生容器和持久历史目录；账号同步只在服务端显式配置授权文件后启用，认证源与默认 CLI IPC 不挂入候选容器。同步的令牌范围、撤销与长期登录限制见 [账号快照同步](account-snapshot-sync-20261105.md)。候选历史与现有模式历史是独立的。

## 路由和访问边界

`apps/server/src/chatgpt-desktop-candidate.ts` 只在 loopback 上注册既有第四模式资源、状态和 WebSocket 路由，启动时从服务端配置固定 profile 文件，浏览器不能选择路径、进程或上游。资源和桥分别继续校验 profile/generation，桥继承原来的同源检查与收发预算。

`apps/web/vite.chatgpt-candidate.config.mjs` 复用现有前端配置，将 `/api/chatgpt-desktop/…` 和 `/chatgpt-desktop/…` 优先转发到固定的候选 loopback 网关，其余代理沿用原配置。它需要 HTTPS、绑定 `0.0.0.0`、严格占用指定端口，并禁用相邻 HTTP 重定向监听，避免与已有实例争用。后端与前端各自的 `CHATGPT_DESKTOP_CANDIDATE_PORT` 是启动方提供的同一个本机网关端口；网关另需服务端私有的 `CHATGPT_DESKTOP_PROFILE_FILE`。前端仍使用原有 `WEB_BACKEND_HOST`、`WEB_BACKEND_PORT` 和 HTTPS 证书配置。

这继承现有局域网入口的访问策略：当前部署没有额外的用户登录鉴权，候选也没有新增一套登录；不得将其描述为已认证的服务。示例候选地址为 `https://10.30.0.26:8500/?mode=chatgpt`，实际地址及端口由部署配置决定。候选不会改变原 8484 入口；它只应部署到与现有入口相同的可信网络范围。

## 启动和恢复边界

supervisor 必须使用全新、私有的部署根和单独的持久历史目录；账号授权、用户项目根和原程序资源均通过固定服务端配置给出，不由页面选择宿主路径。账号来源、运行控制文件和临时 HOME 相互隔离。候选首次启动时，原项目仍须经原版目录选择和信任交互才能使用；单纯挂载目录不等于授予项目内操作。

验证候选目前使用用户级 transient systemd 服务分别管理 supervisor、loopback 网关和 Vite。进程崩溃时由服务管理器按各自策略重启；supervisor 在状态未知时阻止接管或创建第二个 native。**transient 服务不保证机器重启后自动启动**，持久化的 journal、profile 发布和历史目录不会使这项能力自动成立；需要配置持久服务单元并另行验收后才能宣称开机恢复。

2026-11-05 运行的候选还沿用了原服务配置中的 `/tmp` Docker 诊断包装器：它校验固定 Docker 程序并转发请求，将有界的命令阶段和 stderr 写入私有临时日志。这个包装器或日志被清理后，身份核验可能使候选不可用；不能把它当作永久部署依赖。候选前端的 `node_modules` 还链接到活工作树，当前 `surface-host-bridge` 与冻结快照的内容一致，但后续活树修改不能视为已经隔离。已开放的候选不为修复这些问题而重启或替换活跃 view；应在新的候选版本中改用经身份校验的持久 Docker 可执行文件和完整隔离的依赖树。

## 检查与验收

路由红绿灯测试：

```sh
node --test apps/web/chatgpt-candidate-proxy.test.mjs
apps/server/node_modules/.bin/tsx --test apps/server/src/chatgpt-desktop-candidate.test.ts
```

测试检查固定 loopback 上游、两个精确命名空间的代理顺序、HTTPS 要求、真实 Vite 代理初始化、旧代理保留、独立网关的有限路由以及跨来源 WebSocket 拒绝。一次实际部署的 LAN 状态检查已确认原入口和候选入口均返回 ready，且 profile/generation 不同；候选的跨来源 WebSocket 返回 403。

实际 Workbench 页面使用自建空项目，经原版浏览器目录选择与 Trust 对话框后，核对项目、选中项、workspace root 和关闭的 Work executor。两条测试消息各按一次 Enter，原版界面均显示预期回复、composer 清稿且 Stop 不可见；该候选的独立历史中只有一个 rollout，记录两个不同且各自完成的 turn、每条提示各一次、两次准确回复、无工具调用，模型均为 `gpt-6.1-sol`。UI 的 Queue 状态未单独记录，不将其计为完整页面空闲验收。

更正：该两轮收发的浏览器 context 使用了 `ignoreHTTPSErrors:true`，不能计入严格 HTTPS 浏览器验收。使用开发 CA 对该 LAN 地址的独立 TLS 链和主机名验证已通过，但尚不能代替受信任浏览器的完整收发。

首次打开候选时，bridge 已连接且资源请求没有报错，但该 view 在 240 秒后仍停留原版加载图标；后续独立 view 可显示 Codex 和 New chat 并完成上述对话。首次冷启动原因仍未确定，不能以 profile ready、后续页面成功或这次两轮对话证明首次连接稳定。模型账号长期续期、机器重启恢复和完整 1:1 功能也不在本次通过范围内。

后续使用受信任浏览器的新 view 在发送前出现 `BRIDGE_QUEUE_FULL / waiting_count`，不能自行恢复。该次未发送消息，已保留首因；在问题修复及真实复验前，不应把 8500 的新页面打开视为可靠。

新候选 8503 固定独立源码及依赖快照，Docker 使用固定 `/usr/bin/docker`；配置的实际项目根为 `coding_kanban`，历史与其他候选独立。三项用户服务已启用并运行，当前用户管理器未启用 linger，不能保证机器启动后无人登录自动恢复。大帧优化后已完成真实两轮和一次有历史的新页面检查；其他冷启动、长期登录和重启恢复仍待验收。
