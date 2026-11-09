# 共享 CLI 的原版 SDK 与 App Tools 检查点

本阶段只提供显式启用的服务端能力，未将共享源自动接入 8484，也没有接管默认 CLI。主入口继续使用既有冻结实例。原有 `sharedThread` 回调入口仍拒绝启动；新入口要求 `createOwnedSharedDesktopSourceFactory` 返回的不可伪造能力，并由同一包实例的容器 launcher 接入。

## 原版 SDK 的实际结果

2026-11-07 的新匿名宿主已真实完成原 SDK initialize，官方日志确认 websocket connected，未发送模型轮次。该实例的原 `getAuthStatus` 返回 `authMethod:null`、`requiresOpenaiAuth:true`。原 SDK module 98475 的 `iOi`（函数 `ii`）据此返回空身份；`eyn.captureContext`、`threadReadState.getContext` 返回空 context，`R9.refreshEntry` 不创建 manager。`R9.getCurrent` 和 `Et.open` 因此仍返回 unavailable。

这同时证明了 SDK 初始化成功和匿名 manager 不可用；不能把前者当作共享模型对话成功，也不能为匿名验收造身份或放宽 ready。若 `requiresOpenaiAuth:false`，原函数允许 execution-storage 身份，因此不能把所有 `account:null` 一概解释成同一种结果。连接可用的断言仍要求真实原 manager/resource。

## App Tools 的实际接线

固定原件的适配在原 `eTw` 入口选择受控 transport，保留原 `createAppServerConnection` 的 standard 分支、原 `desktopAppTools` 闭包以及原 `ex5` session builder。原 `ex5/ex6` 创建的 native HTTP endpoint 和 bearer 留在原生容器，只将固定 metadata 送到宿主。宿主创建自己的 127.0.0.1 ephemeral HTTP endpoint/bearer，经受控 owner IPC 转发原始请求和响应。

SDK 的 `desktopMcpServerConfig` getter 已按原件确认会读取 transport 同名属性。新 transport 在原 session 和宿主 config 握手完成后才开始 SDK 连接；普通共享检查点仍可显式使用 version 1，App Tools 使用 version 2。该选择来自服务端 opaque factory，HTTP 参数不能启用。

宿主代理拒绝 Origin、其他 Host/路径、重复认证头、未经本代理初始化的 session，以及未核验的工具 thread。每个工具请求的 scope/thread 检查闭包传到现有异步容器身份校验后的真正 stdin 写入处，账号、实例、source 以及请求 thread 在该处再次同步核对。只读目录或一个合法 token 不授予工具权；必须已有精确点击触发且真正写出的 resume 或仍有效的 follower。

请求正文 64 KiB、响应正文 2 MiB、并发 8、组件累计 8 MiB，继续叠加既有共享预算。仅本 stream 的取消 nonce 可幂等记为有界 tombstone，阻止迟到 HTTP 请求，不重发未知结果，不影响正式任务进程。

## 最小 resume 与正式依赖

共享线程连接仍只能发送 `{threadId,excludeTurns:true}`，不会携带新的 MCP override。新代理存在不代表正式 daemon 已使用它。`verifyExecutionDomainSync(scope, mcpConfig)` 由服务端独立证明真实 daemon 的工具配置、执行域与原生配置等价；没有该证明时继续拒绝。不得通过向 resume 偷加配置、空工具列表或模拟账号绕过此依赖。

## 验证边界与下一步

已完成同一 source、受控原生 relay、实际 loopback HTTP 和自有合成 Unix/WS peer 的组合验证；原 HTTP 403 拒绝沿双跳完整返回。该检查使用明确的协议夹具，不是原版工具或模型成功。

2026-11-07 已在全新匿名宿主实际运行同冻结根的 launcher 与 `test/fixtures/readonly-native-sdk-source.mjs`（`appTools:true`）：原 `ex5` session/config 注册为 1，真实 SDK 初始化并保持 connected，真实 CLI 为 `0.166.0-alpha.5.1`。唯一自有 control view 按原规则返回 unavailable，身份未变；宿主和 native 保留供核对。Docker 实际配置仍为 network none、非 root、cap-drop ALL、no-new-privileges、只读 root、2 GiB/512 pids，无端口发布；原 daemon 记录与只读回执的 inode/hash/权限/mtime 保持。私有证据文件为 `actual-original-mcp-result.json`，完整原日志另留快照。

这一轮没有工具 HTTP scope、resume、turn、审批或模型调用；永久拒绝来自同一路径只读策略，没有伪造原生回复。factory 与 launcher 必须从同一冻结根导入。已授权账号的真实原工具调用、真实线程收发及正式 daemon 配置等价性仍待单列验收，不能把原 `ex5` 握手通过描述为工具/模型通过，也不能因匿名 manager unavailable 重启原生任务。
