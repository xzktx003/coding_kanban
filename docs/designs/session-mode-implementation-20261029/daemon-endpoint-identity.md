# 共享官方 daemon 的只读端点身份

看板运行层与官方 Codex daemon 的生命周期独立。旧 `operationContext.namespace` 是历史目录和协议可提供的账号类型/routing 摘要，不能用于证明仍连接同一个 daemon；反过来，看板 runtime UUID 改变也不能证明官方任务换了来源。新窗口恢复按 [LG21](new-window.md) 消费独立的 `daemonIdentity`。

## 身份来源和失效

真实共享传输在连接时固定已有 Unix 端点 descriptor：规范 realpath、设备号、inode 和 ctime。`daemonIdentity` 是带版本域的该 descriptor SHA-256，不包含看板 runtime UUID、连接随机数、路径明文或凭据。返回 context 时，运行层在只读 `account/read` 前后重新校验固定 descriptor，同时保持原有 operation scope 和连接可用性核对。固定路径被重新绑定、端点不可读、连接/账号代次改变均拒绝迟到结果，不退回另一端点、不启动或恢复任务。

该值证明当前观察到的端点绑定，**不是 SO_PEERCRED、native PID/start ticks 或原生跨客户端 CAS 证明**。官方 daemon 在同一 HOME 停止/重新启动，实际端点重新绑定后值变化；看板客户端关闭/重新连接相同存活 daemon，值保持。stdio 测试传输和无法验证的旧服务不提供此字段，消费者必须对跨 runtime 恢复保持拒绝。身份元数据不会授予 writer、审批或中断权限，后续操作仍经过原 owner/账号/运行 scope 和未知回执处理。

## 红绿灯和原生边界

日志位于忽略的 `.dev-runtime/session-full-implementation-20261029/`：

- `daemon-identity-red.log`、`daemon-identity-missing-red.log`：原实现缺少稳定字段和端点变更核对，真实 Unix HTTP/WebSocket 用例先失败。
- `daemon-identity-targeted-green.log`：15 项通过，包括不同看板 runtime 同端点稳定、固定端点换绑失效、held account/read 期间换绑拒绝，以及未知 transport 缺字段。
- `daemon-identity-0163-native.log`：3 项实际私有官方 0.163.0 通过，覆盖 updater/native 资源回收、同 HOME 官方 stop/start 端点身份改变、同一真实任务期间仅替换看板 CodexService 后端点身份稳定。官方重启仅在新建无登录隔离 HOME；不操作正式共享 daemon。
- `daemon-identity-runtime-build.log` 和 `daemon-identity-runtime-all.log`：运行包构建通过；完整 509 项，500 通过、9 项显式原生用例默认跳过、零失败。显式原生结果按上一条单列，不将默认跳过计为通过。

网关只透传合法 64 位小写 hex，context 不缓存；Web 的 context/metadata/context/health 严格前后核对及真正 popup 恢复另由 LG21 验收。上述运行层测试不替代正式部署、新窗口性能或长期内存验收。
