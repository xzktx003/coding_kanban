# 原会话远程压缩失败的恢复验收（2026-10-31）

用户明确授权向报错会话发送“继续”，观察是否恢复，失败后进行修复。目标始终是 `xh2modelzoo_2` 的原线程，没有把诊断副本作为替代会话。

## 失败复现

初次发送前核对精确 thread、当前 turn、ownership 与持久队列。原轮次正在运行，因此唯一一次“继续”通过 steer 加入原轮次；回执sent与原生handler均确认唯一接收。约33秒后出现 `Failed to run pre-sampling compact`，只读历史确认该轮failed，错误为 `Error running remote compact task: stream disconnected before completion: Transport error: network error: error decoding response body`。sent仅表示输入被接收，不代表执行成功。

随后只对目标发起一次原生手动压缩。两次重试的日志分别约在+123和+247秒；实际failed终态在+370秒。`max_retries=2` 是三次尝试，不能把第二条重试警告误当终态。上游虽早已返回200，完整响应体仍读取失败。请求约3.96MB、传输压缩后约2.52MB，目标属于官方ChatGPT，原客户端使用responses HTTP路径，不能笼统认定是第三方compact路由不兼容。

同一代理的自有TLS/gzip空闲130秒对照，直连和代理均完整成功。因此既不能归因于浏览器SSE，也不能仅凭123秒间隔确定代理通用超时。初始SSE观察器自身15秒无事件超时已单独标记，原生失败结论以原生日志和线程终态为准，不把观察器超时当成模型故障。

## 新客户端诊断

原运行层的原生子进程仍是0.161.0，虽然本机CLI已安装0.165.0。构建、源码热更新、CLI安装和健康200均不会自动升级存活的原生进程，这是保护活跃任务的既有规则。

启动自有0.165.0 stdio诊断客户端，明确只读、禁用项目工具/钩子/插件，读取原历史并建立临时ephemeral fork，没有resume/acquire原会话。源Goal为null且保持不变。唯一诊断输入仅要求回复OK；该fork确实触发ContextLimit/PreTurn压缩，经responses WebSocket进度事件后完成回复，耗时168.4秒。初始化存在配置类警告，不宣称所有警告为零。只关闭自有诊断进程，临时fork不作为修复交付。

该对照同时改变了原生版本与传输方式，只能证明“0.165.0＋WebSocket＋同一源历史/代理”可行，不能单独证明版本或代理的唯一因果。

## 受控启用与安全边界

启用前重新查询全部26个loaded线程：23个idle、3个systemError，无activeFlags，26个Goal均null。全部队列无awaiting、sending或uncertain；另三个历史队列的待发/失败项均已暂停。进程树仅有已核实的Codex Node启动器、原生进程及code-mode进程，没有其他Claude/ACP/终端子进程。旧服务健康不提供完整ownedAgents计数，仍明确记录activityUnknown，没有伪造该字段为零。

通过已有 `session-runtime-replace.mjs` 的身份校验与额外独立预检，仅向本仓库已核实旧运行PID3349013发送SIGTERM；未使用SIGKILL、进程组信号或共享daemon stop/restart。保留现有SESSION_RUNTIME_BIN选择，管理器重建同一用户配置的legacy服务，新PID3580847启动原生0.165.0（PID3581008）。旧原生及启动器正常退出。现有共享Codex服务0.166.0未停止、未更新。

网关协议适配按实例固定，原网关会对新instance正确拒绝旧scope。重建自有网关应用后取得新context；前端没有重启或强制刷新。原会话ID、目录、模型gpt-6.1-sol、xhigh和原权限参数保留。目标空队列的失败暂停经显式恢复后，发送唯一一条修复后的“继续”；其他暂停队列没有被自动重放。它是前一次确认失败后的新输入，不是对送达不明请求的重试。

## 原会话结果

原会话新轮次约150秒完成压缩，经responses WebSocket继续生成回复，随后执行命令并创建子Agent。四分钟原生日志观察记录到实际工具活动，未出现ERROR、响应体解码错误或compact retry warning；存在模型元数据/历史协议警告，不能说完全无警告。

最终只读历史在提交后261秒显示原线程仍inProgress、error为null，38个原生项包括1个contextCompaction、22个commandExecution、2个subAgentActivity和助手回复。该项计数与日志ToolCall计数口径不同，不相加。此后产生的子Agent是原任务真实工作，不得再把它们视为维护前的空闲资源或重启服务。

证据位于忽略目录 `.dev-runtime/continue-observation-20261031/`：提交/回执、手动压缩与失败终态、26线程/Goal清单、启用身份、只读诊断报告、修复后提交与原线程进度。记录不包含认证材料、完整模型请求或上游URL。最后于提交后480秒只读核对，修复后的原轮次已completed、error为null，原生起止时间相差408秒。这证明本轮恢复并正常结束，不等于该项目所有后续工作都已完成；新建子Agent不能被当成维护前的空闲资源。此证据不是长期网络稳定保证。
