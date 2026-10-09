# 会话模式 Codex 每轮完成飞书通知

会话模式中的 Codex 每一轮成功完成都会向现有飞书接收目标发送结果卡片，包括连续排队的每轮；不要求当前标签聚焦、仍在关注列表或浏览器保持打开。Node 网关与会话运行层需要保持运行。失败、中断、等待批准与子 Agent 完成不会冒充主对话成功。

## 配置与使用

在会话模式“设置 → 常规 → 飞书完成通知”查看或切换。它和终端模式共用 `/api/settings/feishu-notifications` 的 `enabled` 开关和现有个人/群聊接收目标，只修改通知开关，不改变 `replyEnabled`。本机目标、凭证和通知记录均不提交。配置要求沿用 [终端飞书通知](codex-feishu-notifications.md)。

卡片沿用既有 Markdown、长正文分片与目录脱敏，只发送对应轮次的最终回复及会话名。优先使用原生 `final_answer`，兼容旧版没有 phase 的回复，不把 commentary 或工具输出当最终结果。没有最终文本时明确显示“任务已完成”。当前仅接入完成通知；终端专用的回复续跑、完整记录、快捷回复和文件操作按钮不添加到原生会话卡片，避免目标无法由终端注册表解析。

## 后端事件与持久化

`registerSessionModeRoutes` 复用现有飞书 settings/sender，`registerSessionFollowupRoutes` 在同一后台 SSE 中接收 `codex:notification / turn/completed`。观察器先将完成身份、对应事件及重放游标原子写入独立 outbox，随后后台读取目标轮次并发送，慢读取或飞书发送不阻塞聊天事件及下一轮派发。

`SessionCodexFeishuNotifier` 使用真实 threadId/turnId 去重；发送器以稳定 `session-codex:<threadId>` 和原 turnId 构建分片幂等键。状态保存在 `SESSION_DATA_HOME/codex-completion-notifications.json`，复用 durable-json 原子替换和 0600 权限。重启恢复 pending；读取或发送失败保留 pending 并定时重试，一个任务失败不会永久挡住其他结果。关闭通知期间到达的完成记为跳过，重新开启不补发这些任务。通知状态损坏时停止此通知器并记录错误，不覆盖原文件；无法写入 outbox 时记录错误并保留原持久游标，聊天仍继续，修复存储后需重新加载网关恢复通知器，重放仍受运行层缓存范围限制。

读取使用原生 `/api/codex/thread/metadata` 与 `/api/codex/thread/turns/list`（倒序每页 20 项、full），精确定位原轮次，核对线程和完成状态并过滤 parentThreadId/source.subAgent；不 resume、不占写锁，也不读取另一个轮次替代结果。读取失败或原生历史尚未写入时保留待核对记录。

相同运行实例重连和网关重启从持久游标继续接收，重复事件不重发；新运行实例不使用旧序号，不回放首次启用前的历史任务。运行层事件重放缓存有界（2048 项），网关长时间离线超过缓存范围或运行层重启清空缓存时，尚未观察到的完成事件不保证恢复；已经写入 outbox 的任务仍会重试。不要把首次启用通知当成历史任务补发工具。

## 验收

- 红绿灯覆盖每轮分别发送、精确目标/最终回复、旧任务不补发、失败/中断/子 Agent 过滤、重复事件与实例变化、持久 pending 恢复、关闭开关、不阻塞慢读取/发送、读取或发送异常重试、历史迟到、关闭后的迟到写入隔离与损坏状态保护。
- 后端 SSE 集成使用独立 Fastify 网关、模拟原生运行层和模拟 sender，不打开浏览器即可通知；同运行层下重启网关后恢复游标，离线期间下一轮完成仍通知。
- 会话设置页有读取/切换/未配置/错误重试测试，桌面与手机浏览器模拟设置 API，不更改部署实际通知开关。
- 局域网 HTTPS 联调入口：`https://10.30.0.28:8484/?mode=session`，前端绑定 0.0.0.0；验证原生只读 metadata/分页接口可用并保持原运行层 PID。没有向用户 Agent 投递测试消息。

实际飞书验收：通过同一 `SessionCodexFeishuNotifier → ScriptFeishuCompletionSender → lark-cli --as bot` 链路向已配置个人目标发送 1 张标注为验收的卡片，飞书接受成功；使用独立 outbox 和明确的验收结果，没有向用户 Agent 发送测试任务。验收回执仅保存状态/卡片数在被忽略的 `.dev-runtime/session-notify-live-acceptance.json`，无接收者 ID 或凭证。

本次提交的隔离副本完成 `pnpm check` 与 `pnpm test`：前端会话 205 文件/744 用例、终端 530 用例、后端 692 通过/1 跳过、脚本 95 通过；通知专项 18 项、设置页桌面/手机浏览器 2 项通过。共享工作区同时存在另一组进行中的会话内存优化改动，因此隔离副本只包含本次通知功能，保留并未提交其他范围的工作。生产构建仅有既有 Vite 大 chunk 警告。
