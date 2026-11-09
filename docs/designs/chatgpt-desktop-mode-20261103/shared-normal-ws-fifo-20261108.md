# 普通 daemon WS 帧调度（候选实现）

真实无登录自有 Unix WS peer 将 13 个合法 MCP startup 通知 cork 成同批。首帧要求原有 child probe 写 stdout JSONL，每帧真实同步 guard 模拟 10ms CPU。旧实现直到 13 帧后才读取该 JSONL；候选在第 2 帧后读取，未增加期限或伪造 ACK。red.log/green-session.log/green-admission.log 保留实际输出。这是传输与调度回归，不是真实模型收发验收。

首 initialize 和第一次账号确认保留同步原语义。已确认之后，原始 UTF-8 WS 帧进入同流 FIFO，每帧 setImmediate 派发；每次派发仍执行原 current/identity/gate 及原 receiveAuthority。暂停/恢复输入同时考虑普通输入、native 输出和 created hold，三个保留区及正在写的 IPC 共同计入原 8MiB/64 上限。每帧最多 2MiB。关闭清除调度和本组件 allocation，不停止真实 daemon 或模型任务。

撤销不能等 FIFO：任何后续 account/updated 入队前立即 failclosed；包括真实 observer 使用的 account/login/completed、account/gatewayOAuth/changed 在内的未知通知，维持原拒绝并在 admission 立即关闭。只对已经识别的原 metadata、两种 startup metadata 与四种 server request 类型延后完整派发，未增加可接受协议。

serverRequest/resolved 是额外实际授权撤销源：原 authority receiveEvent 同步 approvalGate.observeResolved 才退役审批。候选 admission 立即按其 requestId 设置真实 socket 响应写 barrier；此时服务器旧审批回复不得 ws.send，普通带 method 的 client RPC 不受同 id 混淆。只有按原 FIFO 实际 processMessage 完成才移除该计数；created hold 转移不移除，所以先前排队的 request 不会复活。独立真实 Unix WS 与实际审批 gate 已覆盖 string/number 两种 requestId：去掉最后写 barrier 的受控对照各写出旧回复 1 条，修复后均为 0，普通 client 同类型同 id 的只读 RPC 仍成功。

其余授权不是等待 writer 通知才撤销：source current 每次读取独立 observer/account revision、精确 PID/socket 与 held-root；execution scopeCurrent 每次同步复核配置文件身份/缺失证明；rawWrite 仍在真正 ws.send 前重新 current/identity。原 thread/settings/closed 通知只进入 follower，不改变 source 执行 map。独立审查确认上述状态更新路径；最终相关回归通过，真实模型收发及正式启用仍须另验。
