# 共享 CLI 的原版创建与采纳（2026-11-07）

新路径仅用于服务端明确注册的 `preserve-native-cli` / `nativeAppTools:false` 宿主。原版 composer 的明确提交生成一次性创建手势；切模式、刷新、后台预热均不创建线程。已有会话和其他模式不因此改变。

## 写入与首轮

1. 固定 owned view、账号/运行/daemon 代次和规范 cwd。AppHost 的本地项目 record ID 与服务端授权项目 ID 分属两个命名域：建立 scope 时按已注册 cwd 唯一映射，原 UI 项目记录保持；后续请求全部核服务端完整 scope。
2. 仅原 `startConversation` 同因果上下文可授权一次 `thread/start`。默认 collaboration model/effort 保留，并由同 daemon 的真实 `model/list` 校验；不支持的显式权限、provider、指令、MCP/config 等选择在写出前明确报错。宿主自动注入的默认配置按固定原件映射为继承 CLI 配置，不开放任意覆盖。
3. gate 在原 desktop writer 实际同步写前消费权限。只有真实回执可铸品牌和 UUID；原错误保留。未知结果不得重发。
4. 原创建回复及其后帧暂存在既有 2 MiB 单帧、8 MiB 合计和 64 项预算内。实际同 daemon 的线程 metadata 与 config 双读完成，原创建回执形成 `native-start-response` 证明，再由独立的一次性 source 品牌采纳 binding；不伪造目录页 token、分页或空线程 resume。
5. 成功后按原字节先释放创建回复，再释放后帧；原 SDK 保持同 writer 执行首轮，首轮发送 nonce 与创建 nonce 独立。采纳失败保留 `createdThreadId`，不重发、不停止原生任务。

已知的其他 daemon 线程 metadata/stream 仅分类并丢弃，不绑定、不向本视图传正文。已绑定线程仍走原有有界 follower，账号变化仍撤销，未知/非法通知仍拒绝。

## 当前证据与限制

隔离无登录的真实 CLI **0.166.0**（SHA256 `b8a11fedf24b2dfb59a70c9e52b030f9a508dcd49cd2dd0d41956f4c785156b8`）已通过实际同 writer 创建、真实 metadata/config 证明、source 采纳后释放原回复。记录的顺序为 `real-metadata-config-adopted` → `original-create-reply-released`，没有发送 turn、模型请求、工具调用或 resume。该夹具使用匿名账号代次，不能代替生产账号、完整 source 初始化、原版 GUI 收发或 8484 部署验收。自有 native 按 PID/start ticks 与 CLI 摘要核实后已关闭。

新增反例覆盖：AppHost/server 项目 ID 不同、错误 cwd/项目借用、品牌仿造/重复、异步采纳时 view 更换、预算耗尽、授权 ACK 后原手势取消，以及另一个真实任务的已知 metadata/stream 不误杀当前 writer。默认 CLI 保留工具配置，Desktop App Tools 和其他扩展仍需后续验证。

必要组件回归（不代表模型验收）：

```sh
node --test packages/chatgpt-desktop-host/test/shared-created-thread-adoption.test.mjs packages/chatgpt-desktop-host/test/shared-thread-creation-ipc.test.mjs packages/chatgpt-desktop-host/test/native-shared-thread-creation-routing.test.mjs packages/chatgpt-desktop-host/test/shared-desktop-daemon-session.test.mjs
```

创建采纳后仍须在已有 authority channel 注册原 shared-follow 的一次 attempt 入口；否则 client.follow 会在首轮前被拒绝。注册只接受品牌创建回执和精确绑定，沿用原 16 项预算/30 秒期限，不新增 wire、不 resume、不因完成 create 手势取消已建立 follower。
