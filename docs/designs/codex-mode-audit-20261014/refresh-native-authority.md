# Native 代次的持久授权锚

刷新候选的 `startPrivateService` 现在先启动独立授权观察进程，完成实际原生 initialize、账号初始通知与两次只读 `account/read(refreshToken:false)`，才发布服务 ready。观察进程跨创建者、管理器、网关和页面退出保留；它不读取 thread/正文、不提交用户操作，也不控制任务。默认入口仍未启用候选架构。

## 记录和接入

全新私有运行目录内的 `authority-config.json`、`authority.json` 均为 0600，目录为 0700。初始记录以完整文件原子发布，绑定授权域/native generation/PID/start ticks、初始账号类型与摘要，以及观察进程自己的 generation/PID/start ticks、私有 socket inode/dev 和随机能力。原始账号、邮箱、凭证、聊天正文不落入记录；能力不进入 wrapper、浏览器或状态快照。

新 `service.json` 保存观察进程身份。每个服务客户端保留独立的私有授权连接，检查原始身份并自行读取当前原生账号；摘要必须匹配原始锚。管理器和桥接在接入 loaded contexts 前再次确认原始锚，不能把重新读取的新账号改绑到旧 native。缺少授权锚的旧候选记录须显式处理，不补写、不接管、不停止原进程。

私有通道沿用 8 KiB JSONL、严格字段/UTF-8 和有界等待；最多 128 个连接。只有初始 hello，以及已握手连接的 revoke 元数据操作，没有用户输入、审批、native RPC 转发或 shutdown。观察进程接入本身不等于所有 profile 的自动注册已经完成。

## 撤销与实际写入

绑定后账号通知即使值相同也不可恢复地撤销该 native 代次；初始通知只允许一次。观察器失联、退出或 native 连接丢失均拒绝新接入，不允许新管理器安静重建观察器并采用旧上下文。

撤销先同步建立 `authority-revoked` 标记，再关闭自有接入通道；原始摘要永不更新。标记存在、无法确定标记不存在或目录不再私有时，实际写入 guard 均拒绝。客户端先观察到账号变化时，也向独立观察进程发送已握手的 revoke；即使写盘失败，观察进程仍关闭全部授权连接和自身观察连接。关闭只释放自己的连接，不发送 native shutdown、turn interrupt 或用户操作，不重放未知回执。

`createNativeClient` 的生命周期 guard 传到真正的 `ws.send`；官方桥接也通过 `assertAuthorizationCurrent` 同步检查原始锚与撤销文件，而不是等待观察连接的异步关闭通知。它仍不是原生提供的跨所有 socket 原子账号条件写入，不声称抵抗同 UID 恶意进程或覆盖未经此候选接入的外部客户端。

单请求 guard 同样按原请求 ID 保留到实际写入前，避免页面在输入排队期间重新可见却仍执行 unsubscribe。明确尚未发送的请求以 `NATIVE_NOT_SENT` 拒绝，该请求不写入 wire，其他订阅和连接保持；超过等待期已不在 pending 表的请求也不迟到发送。授权生命周期 guard 失败仍关闭自身连接，不能把账号撤销当作普通单请求 veto。没有自动重试。

## 资源与验证范围

资源监测器从可信服务记录自动加入 detached `authority` 进程根，计入完整进程树 RSS、task 和进程预算；调用方不能漏掉这个独立进程。其他 host/extensionHost/gateway 根仍须显式提供，自动全宿主注册和整体预算定标未完成。

证据目录 `.dev-runtime/codex-refresh-20261015-authority-anchor/`：缺失模块、管理器/桥接未确认原始锚、漏计观察器 RSS、NativeClient 未传实际发送 guard、客户端撤销写盘失败未关闭其他连接、官方 bridge 未同步检查原始锚，均保留实际失败记录。真实固定 CLI 使用全新无登录 HOME 和 loopback provider，覆盖创建者退出、管理器替换、同值 provider 账号撤销后新管理器拒绝、原运行轮次完成一次，以及观察进程 SIGKILL 后无撤销文件仍拒绝新接入。所有信号仅作用于当前夹具持有的精确自有 PID/start ticks。

这些证据不替代 ChatGPT/OAuth/组织变化、官方 UI、多端审批、两秒/180 次矩阵或 30 分钟资源长测。iPhone 16 仍按用户确认以 393×852/DPR 3/触控模拟验收，不能把独立 native 协议测试拼接成未执行的浏览器测试。
