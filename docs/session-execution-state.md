# 会话执行状态的权威来源

## 问题与边界

2026-10-27 用户反馈：Codex 仍在处理任务，但关注标签不再转圈，已排队消息旁也没有「立即引导」。现场对同一 thread／turn 的只读核对显示：当前运行层 metadata 为 active、最新轮次为 inProgress，而独立聊天历史 reader 将同一轮重建成 interrupted。原 view=chat 通道还拒绝 itemsView:notLoaded。终态 timing 的防迟到保护正确阻止普通 active 状态复活旧轮，却也保留了这个不准确的历史终态。

排队消息与运行标识分开：queue 接受消息后等待空闲，Goal 自动连续运行可能持续占用会话；steer 才是向精确当前轮次追加要求。恢复界面不得擅自把用户 queue 转为 steer、重发、恢复暂停队列或中断任务。

## 当前执行事实与历史正文分离

`POST /api/session/codex/activity` 只接受 threadId。`apps/server/src/routes/session-codex-activity.ts` 从当前运行层依次只读 metadata 和 turns/list(limit:1,desc,notLoaded)，返回精确 threadId、status、最新轮次 ID／状态／时间。身份、状态及时间校验失败或服务不可用返回503，不获取写入权，不调用 start/resume/steer/interrupt。每个上游响应最多64KiB，读取过程超限即取消；总截止15秒，调用者断线也取消。不缓存正文、完整响应或历史，不回退全量历史。

`followedSessionStatusSync` 仅在 active 状态与缺失／终态 timing 冲突时读取活动事实。有效的精确 inProgress 轮次才能恢复 timing、标签转圈及输入控制；真正 completed／failed 同轮不会被复活。独立 reader 推断的 interrupted 同轮允许被当前执行实例的明确 active + inProgress 事实纠正，普通 active 通知本身仍不能复活它。迟到结果须通过账号／运行 scope、状态／timing 引用、关注集合、取消和卸载检查；不会合成历史事件，不写正文，不借用其他标签的 currentTurnId。既有状态 watchdog 可重试小事实查询；不恢复静默完整历史轮询。

聊天历史继续走原独立 reader 与 token 级工具正文裁剪。网关将当前执行实例的最新轮次快照传给 `registerLocalChatHistoryChannel`；`ChatHistorySelector` 仅覆盖精确匹配的顶层 data[] 轮次执行字段，inProgress 清除旧 completedAt／durationMs，其他轮次和所有 items 保持原投影规则。小快照查询失败时不使用推断的 interrupted 冒充权威状态。原第四参数 env 兼容保留；第四参数也可显式传入只读快照回调。

view=chat + notLoaded 的窄查询（limit1、desc、无cursor、无额外字段）由网关返回同一小型活动快照，不启动独立 reader、不透传原始工具正文。其他未支持的 metadata 查询保持明确拒绝。full／summary 聊天投影的16MiB上限、排队预算和取消清理不变。

这是发送前／读取时的只读快照，不是跨进程原子事务。执行事实取自独立历史读取前，期间变化仍靠原生事件及后续只读核对收敛。未知执行身份或 startedAt 不可用时，不伪造可引导的轮次和耗时。

## 验证

- 前端状态、历史恢复、控制和队列单测；保持同轮 completed／failed 与迟到 active 的保护。
- 网关 activity 流式限额、超时、断线、投影和非法输入回归。
- 真实独立 fixture reader 返回 interrupted +20MiB 工具输出，当前 owner 返回同轮 inProgress：网关只修正执行字段，工具正文仍为 null，响应小于2KiB；自有 reader 只发送 initialize／initialized／thread/turns/list。
- 浏览器模拟漏掉 turn/started 及同轮误标 interrupted，验证转圈、草稿、队列保留；用户显式点引导后只产生一次精确 expectedTurnId 的 steer，没有 start／interrupt。
- 真实 HTTP/EventSource 工具投影、不可见正文回收、恢复和审批回归，保留原内存断言。长期30分钟RSS关卡未在本轮重跑。

本机联调入口为部署配置的局域网 HTTPS `https://10.30.0.28:8484/?mode=session`。真实现场只读取状态和有界聊天投影，不向用户任务投递测试指令、不主动发送飞书。运行层仍复用原进程；构建只更新独立库，不切换或停止 Agent。

### 本轮执行结果

`pnpm check` 通过；前端相关7文件127项单测、网关集成、activity流式限额／取消和运行层聊天投影回归通过。浏览器新增2项运行恢复用例通过，静默SSE恢复／异步提问5项通过；扩展回归中队列操作、不可见正文回收及真实HTTP/EventSource投影均通过。

扩展浏览器运行仍有两项旧夹具断言未通过：composer菜单测试查找已改名的「添加附件与上下文」，权限测试预期全局完全访问但当前线程显示「权限待确认」。本轮未修改权限或composer组件，不将这两项计入通过；完整浏览器套件仍有未通过项。30分钟RSS长测按默认配置跳过，不计验收。
