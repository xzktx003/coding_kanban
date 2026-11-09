# 共享原生 SDK 接线进度（2026-11-07）

共享代码已整合到工作树，尚未切换 8484。主入口继续使用[已验证的免密码版本](main-passwordless-20261107.md)。原版 SDK 已成功连接独立 CLI 并完成初始化；无登录且 `requiresOpenaiAuth: true` 时，原版不会创建 manager，共享宿主保持 unavailable 符合该规则。共享历史、继续对话和桌面工具均未完成验收。

## 实现边界

服务端通过 WeakSet 标记的 `sharedDesktopSource` 工厂显式提供来源，容器启动器保留旧 `sharedThread` 参数的 `CONTAINER_SHARED_NOT_READY` 拒绝。原版 owner 创建实际 AppServerConnection，仅对固定共享 host/config 替换传输；原连接、execution host 和 manager 必须完成注册才能发布 ready。账号、来源修订、进程/socket/归档身份与实际写前检查继续执行。点击会话的最小 resume、发送和审批分别授权，未知回执不重发。

浏览器目录和线程目录模块必须同时列入 host 包 exports 与服务端固定 SOURCES 白名单；缺前者返回 503，缺后者返回 404。本轮按这两个真实失败逐项修复并保留测试，不能仅验证文件存在。动态端口、路径、命令或来源仍不能从 HTTP 注入。

## 真实原版验证

在全新私有目录启动官方 `0.166.0-alpha.5.1` CLI，独立 Unix socket、无登录文件，不连接默认 IPC。实际只读请求确认 account/auth 为空、线程列表为空。另启动相同版本的全新隔离桌面宿主，使用同一冻结 checkpoint 的工厂和启动器。

原生日志明确记录固定共享 host 的 websocket transport start success、`initialize_handshake_result outcome=success` 和 connected。随后通过精确 profile/进程身份核验创建私有 control view，15 秒内只收到 `kanban-shared-host-state: unavailable`，未收到 ready；观察结束只关闭该 view，原 CLI/native 保持运行。没有创建、恢复、发送或审批线程。

继续核对实际只读 `getAuthStatus`，得到 `authMethod: null`、`requiresOpenaiAuth: true`。固定原 SDK 的 `ii` → `eyn.captureContext` → `R9.refreshEntry` 在该组合返回空身份，不创建 manager；因此 unavailable 是原版规则的预期结果。真实初始化验证已完成，不能为匿名环境伪造账号或放宽 ready。同日原版 App Tools 创建/config 回桥也已在另一全新匿名宿主实际通过，见[检查点](shared-sdk-mcp-checkpoint-20261107.md)；后续为正式配置等价性、已授权账号和共享线程/工具验证。

- CLI 只读证据：`/data01/home/xing.hu/.cgsdk-daemon-bour5mdh/real-read-result.json`。
- 实际 SDK 状态：`/data01/home/xing.hu/.cgsdk-host-8ama42un/real-sdk-state-result.json`；同目录保存原生日志和启动首因。
- 原生账号要求：`/data01/home/xing.hu/.cgsdk-daemon-bour5mdh/auth-requirement-result.json`；原件及运行证据链：`/data01/home/xing.hu/.cg-shared-core2-jveke10a/anonymous-sdk-conclusion.json`。
- 冻结代码：`/data01/home/xing.hu/.cg-shared-core2-jveke10a/checkpoint-01`，补丁 SHA-256 `b868a64c53611bb8b48f21314d3ce913ad5e94291cf178acd115c4a7ed646a55`。
- 资源红绿灯：`/data01/home/xing.hu/.cg-shared-integration-e6du8bct/sidecar-{red,green,final-green}.log`。

无登录的真实 SDK 初始化不是共享账号、正式 daemon 工具配置或模型收发验收；生产启用仍需原版 MCP/配置等价性、精确手势及真实会话验证。
