# 共享 SDK 可选宿主能力的明确拒绝（2026-11-07）

共享 SDK 初始化的真实回复须经原消费 ACK 后才开放原只读流程，不生成原 SDK 未发送的 initialized。连接、execution host、manager 和共享会话收发仍分别验收，connected 不能代替 ready。

真实原 SDK 后台先请求 native 私有 HOME 的附件索引、worktree 目录 metadata，之后出现 process/spawn。native 私有 HOME 与共享 daemon HOME 不同，不能按相同路径直接转发文件操作，也不能把拒绝变成空文件、exists、ENOENT 或虚假的进程成功。getMetadata 静态实现只传播错误，并无已经证实的“metadata 失败就自动 mkdir”行为；实际 command 未观测前不推断它的用途。

固定 CLI 0.166.0 原 ClientRequest schema 中的 66 个可选宿主方法由精确表识别，涵盖未实现的 fs/process、项目目录、技能/插件/应用目录及宿主能力查询。它们在现时账号、实例、正式初始化、规范请求 envelope、唯一 ID 和原预算全部有效时，收到适配器明确错误 -32601，data.source 为 kanban-shared-policy，data.code 为 SHARED_CAPABILITY_NOT_SUPPORTED，data.method 保留精确方法；错误不带参数、命令或路径。这只是识别不支持的方法，不解释或执行其中的参数，也不声称参数有效。

错误通过原有界回站队列和精确消费 ACK。不访问文件、不启动/终止进程、不写入 daemon、不创建上游响应 route、process handle 或任务权限。即使方法名是写文件、watch、kill 或安装插件，也只是明确拒绝，不能产生副作用。原来三种只读 fs/readFile/getMetadata/readDirectory 继续使用严格规范绝对 path 和 SHARED_READ_NOT_SUPPORTED 错误。

任务、审批、连接、认证变化以及已支持方法的非法变体不进入此负能力表；未知方法、未知回执、重复 ID、超过 64KiB、未初始化或身份撤销仍沿原拒绝/关闭规则。所有实际共享连接/写入权限及配置证明保持原关卡。能力缺失与传输/授权故障分开，不自动重发失败任务。

原 source 隔离重放证明，一条已知 readHomePaths 调用在 capability error 后可将 workspacesRoot 恢复为 null，同时保留 codexHome、释放 priority 和 pending process handlers；原 registry 创建失败会记录错误并清理 instance，保留 connection，不伪报 ready。REA ev_ba344ab57ad875395f26adbe3086758a7f748eb8d09b0e7c9726eeeabe726d00。该静态提取与隔离逻辑重放不能确定真实 process/spawn 的调用者，也不替代原 app 运行验收。

最小红绿灯为 shared-daemon-desktop-gate.test.mjs、shared-desktop-daemon-session.test.mjs：同一自有 Unix 连接连续接收明确能力错误后继续 account/read，验证没有负能力请求到达上游；任务/认证/未知方法、异常 envelope、重复 ID、超预算与撤销仍拒绝。真实 SDK 对文件读取错误的恢复已观测；统一负能力后的原注册与真实模型收发仍须独立验证。

后续真实运行：`.cg-real-sdk-core-djsd65n6` 已记录实际原 registry `unavailable → ready`，随后因另一未关注线程的全局 `thread/goal/updated` 被旧 desktop gate 拒绝，source 退休。瞬时注册与稳定可用分开计；新建与真实模型收发仍未通过。完整私有初始命令参数只存在 owned 0600 文件，未输出；没有执行或转发该命令。
