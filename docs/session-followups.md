# Codex 运行中输入、队列与侧边会话

2026-10-07。会话模式的 Codex 输入支持排队、引导、停止、停止并发送；Node 网关拥有持久队列，浏览器只提交意图和显示状态。入口位于 `apps/web/src/session-mode`，协议与状态类型位于 `packages/shared/src/session-followups.ts`。

## 功能与交互

| 级别 | 功能 | 行为 |
|---|---|---|
| P0 | 运行中输入 | 默认排队；可切换引导。排队保留当前任务，引导通过 `turn/steer` 追加到精确的 `expectedTurnId`。引导不修改当前轮模型或权限。 |
| P0 | 停止与替换 | 停止立即暂停队列。停止并发送先请求中断，收到匹配的 `turn/completed` 后发送新请求；旧队列保持暂停，用户明确继续。中断 ACK 不等于结束。 |
| P0 | 队列管理 | 每个 thread 独立；编辑文字、删除、上下移动/拖动排序、清空、暂停/继续、立即引导、失败重试。最多 100 条待处理消息。 |
| P0 | 配置与快捷键 | 通用设置保存默认排队/引导、Enter 发送规则和审查方式。Ctrl/Cmd+Shift+Enter 临时执行相反方式；Shift+Enter 换行，输入法组合期间不发送。 |
| P0 | 持久投递 | 入队保存文字、图片路径、目录、模型、推理强度、权限和 Plan 参数快照；后续设置变化不改变已排队请求。断线或失败保留草稿/队列。 |
| P0 | 跨页与恢复 | 刷新、关闭浏览器、切换标签不取消服务端队列。多浏览器读同一 revision，编辑冲突返回 409。未知送达结果暂停，查看对话后明确确认才可重试。 |
| P1 | 代码选区 | 编辑器选区附带文件路径、起止行与代码块，追加到当前会话草稿，不覆盖已有问题。 |
| P1 | 侧边聊天 | 原生 `thread/fork` 创建独立 thread；独立记录、输入、附件、队列及停止按钮，主会话输入目标和草稿保持不变。可从队列复制消息到侧边草稿，原队列项由用户处理。关闭侧栏不停止任务，已创建会话仍在关注集合。 |
| P1 | 代码审查 | 当前会话或独立会话，范围支持未提交改动、相对分支、指定提交和自定义要求。内联审查与主队列串行；独立审查在侧栏打开，主任务继续。 |
| P1 | 既有能力衔接 | 模型、权限、Plan、Goal、技能、附件、历史回退沿用既有控件。运行中 Goal 草稿需先取消目标输入，再发送追加消息，避免混淆目标设置与引导。 |

侧边面板的打开状态仅属于本设备；其会话身份和服务端队列可恢复。配置不兼容的旧运行层会显式返回失败，不把引导静默降级为中断。新增能力针对 Codex，Claude/ACP 继续使用各自协议。

## 后端所有权与协议

`apps/server/src/routes/session-followups.ts` 注册：

- `GET /api/session/followups?threadId=...`：读取快照。
- `POST /api/session/followups/submit`：带稳定请求 ID 和参数快照提交 queue/steer/replace。
- `POST /api/session/followups/change`：携带 revision 执行队列操作。
- `POST /api/session/followups/stop`：先持久化暂停，再请求原生中断。
- `POST /api/session/followups/review`：串行检查会话/队列状态并调用原生审查。

队列写入会话应用数据目录的 `codex-followups.json`，沿用 `writeDurableJson` 原子写入和备份。Linux `flock` 锁由子进程持有，网关退出即释放；第二个网关拒绝消费同一文件，不清理其他进程。服务端轮询每秒执行，浏览器快照每 1.5 秒同步。关闭浏览器不会停止后台调度。

网关订阅独立 Rust 运行层 SSE，记录 seq 并以 `?since=` 恢复；新 runtime instance 或事件缺口暂停队列。状态查询仅在事件流连接时执行。每轮只投递一条，保存原生 turn ID，并等待匹配的完成通知再继续。查询期间的新事件先推进 thread epoch，防止迟到的 idle 快照覆盖 active。新建空会话尚未进入 Codex state DB，网关从可信 `thread/start`、`thread/resume`、`thread/fork` 响应及 `thread/started` 通知补齐状态，不因 thread/list 缺项直接假定空闲。

状态流转：`queued → sending → sent`；明确拒绝变为 `failed`，网络超时或发送后写盘失败变为 `uncertain` 并暂停。重启发现 `sending` 也转为 `uncertain`；已有接收回执但缺完成事件时暂停，等待完成确认或用户明确继续。不会盲目重投。失败/中断完成事件暂停后续任务。稳定请求 ID 基于草稿版本、目标和完整提交快照，HTTP 回执丢失后重试复用同一 ID；复用 ID 更改内容会被拒绝。

## 验收

红绿灯覆盖队列顺序、持久恢复、送达不明、版本冲突、状态竞态、停止并发送、内联审查互斥、新建空会话与参数快照。HTTP 集成测试使用真实 Fastify 网关、SSE、持久文件和内核锁，验证无浏览器调度与单一所有权。浏览器测试使用隔离的运行层响应与实际队列服务，禁止操作现有 Agent。

```sh
pnpm check
pnpm test
# 使用当前 .env 对应的局域网前端地址；此值仅为本次联调环境。
PLAYWRIGHT_SKIP_WEBSERVER=1 PLAYWRIGHT_BASE_URL=https://10.30.0.24:8484 pnpm e2e tests/e2e/session-followups.spec.ts tests/e2e/session-stop.spec.ts tests/e2e/session-tabs.spec.ts
```

本次局域网入口为 HTTPS `10.30.0.24:8484`，前端绑定 `0.0.0.0`。真实 Codex 冒烟使用独立临时目录和新建测试 thread，验证两轮顺序投递、同轮引导、停止并发送、原生 fork 与审查，不重启既有 Rust 运行层。

## 对照来源

- [Open VSX Codex 扩展](https://open-vsx.org/extension/openai/chatgpt)：查验公开扩展包的队列、即时引导与侧边交互。
- [Codex IDE 设置](https://learn.chatgpt.com/docs/developer-settings?surface=ide)：默认 follow-up queue 与快捷键语义。
- [App Server 协议](https://learn.chatgpt.com/docs/app-server)：turn/steer、turn/interrupt、thread/fork、review/start。

真实 CLI 0.159.2 的 review/start 还存在 review turn ID 与 turn/started 执行 ID 不同的情况。网关持久化二者关联，接受匹配审查 ID 的完成回执；前端通过同一快照纠正审查计时，刷新后也可恢复，且不覆盖后来启动的其他轮次。该差异已纳入红绿灯测试。

CLI 0.159.2 的 paginated history thread 明确拒绝原生 detached review。仅收到这一确定的能力拒绝时，网关先 `thread/fork`，再在独立 thread 上启动 inline review，保留“主任务继续、结果独立”的交互。其他错误或送达不明不会自动改路重试，避免重复执行。

最终验收记录：`pnpm check` 通过；`pnpm test` 通过，终端 526、后端 619、会话前端 349、脚本 80 项通过，另 1 项依赖真实 tmux cwd alias 的既有环境测试跳过。最后补充的事件缺口竞态修复单独重跑 16 项后端队列/路由/HTTP 集成测试及后端构建，均通过。浏览器覆盖 5 项 follow-up、3 项停止、2 项标签回归。真实 Codex 的两轮队列、同轮引导、停止替换、fork、内联审查和分页历史独立审查均已跑通；Rust runtime instance 在联调前后保持相同。

### 错误后的再次输入

`systemError` 是终止状态，输入栏即使仍缓存旧轮的 `inProgress` 或旧 `currentTurnId`，也必须恢复普通发送；主输入栏与侧边会话共用此规则。收到系统错误通知或匹配轮次的不可重试错误时结束缓存中的运行状态，新的 `turn/started` 才恢复运行与引导。`willRetry: true` 和旧轮迟到错误不能结束正在执行的新轮。

再次输入按新轮提交，不携带失败轮的 `expectedTurnId`。已有队列失败暂停仍需用户点“继续队列”；继续后 `systemError` 与 `idle` 均允许派发新轮，不改变排队顺序，不自动重发送达不明消息。浏览器隔离回归使用局域网 HTTPS 地址 `https://10.30.0.24:8484`，所有会话和队列接口由测试 fixture 接管，不向真实 Agent 发送消息。

本次修复验收：前端相关 37 项通过，另补齐并行新增事件逻辑所需的测试桩后，通知处理与轮次控制 11 项重跑通过（其中 8 项与前述重复）；后端队列/路由/HTTP 集成 20 项通过；浏览器 4 项通过，包含正常引导、停止替换和两种错误重发。`pnpm check` 与最终前端类型检查通过。全量会话测试批次为 431 项通过、3 项旧测试桩失败，上述 3 项修正后单独转绿；未将该批次表述为一次全绿。日志保存在 `.dev-runtime/error-retry-*.log`。

## 输入栏 V2 扩展

新增可选 `contexts` 内容快照和受 token/revision/消息状态共同校验的 `undo` 队列操作。Codex 文件选区改为独立卡片，不再直接拼进正文；最终提交仍包含文件路径、行号及完整内容。协议、存储和双端交互见 [输入栏 V2](session-composer-v2.md)。
