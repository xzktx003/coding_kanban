# 会话内存防回归约定

## 已确认有效的修复基线

2026-10-10，用户在部署修复后明确反馈：**“这次的内存修复很关键，内存控制住了。”** 对应代码提交为 `78884745a307282c854523355dad9f872b6d47fb`（`v1.3.0`，已同步 GitHub / GitLab）。这是用户现场确认；此前自动测试的结果及适用边界单独列在下文，不把用户反馈换算成未经测量的内存数字。

此前现象：Codex 执行任务时，浏览器标签页一两分钟涨到数 GB 后崩溃；没有对话时也缓慢增长，且没有打开右侧编辑器。多轮仅限制消息条数、隐藏工具行或裁剪前端缓存的修改未能完全解决。最终有效方案同时修复了**传输前裁剪、历史读取触发条件、空闲状态更新**，并保留此前的有界流式渲染和引用释放。

本文件是当前维护约定。[排查历史与测量详情](session-browser-memory.md)保留了早期方案；其中“工具正文仍通过网络进入浏览器”“保留工具预览”等阶段性描述，不得用作恢复旧行为的依据。

## 后续修改必须保持的边界

| 边界 | 必须保持 | 会重新引入问题的做法 |
| --- | --- | --- |
| 浏览器接收数据之前 | 浏览器 SSE 与 Codex 只读历史使用 `view=chat`；Node 网关在发送前裁剪隐藏工具正文，且不把该参数传给运行层 | 只在 React、store 或 `JSON.parse` 之后过滤；以“界面没有显示”为理由恢复原始大包 |
| 工具及内嵌数据 | 同时覆盖输出 delta、最终工具项、turn/thread 内嵌 items、raw response、hook、diff、自动审批复核等；子 Agent 的 prompt/message 仅保留有界预览，当前为 1024 字符 | 仅裁剪 command 输出；通过工具参数、`agentsStates.message`、元数据或旧缓存重新持有原始正文 |
| 协议与任务状态 | 保留原事件序号、轮次生命周期、真正的审批/提问及子 Agent 身份/状态；后台内部消费者继续使用原协议 | 直接丢掉序号造成缺口与重读风暴；混淆“自动审批复核提示”和“需要用户处理的审批请求” |
| 过大 SSE 帧 | 当前单帧上限 16 MiB；网关发出命名事件 `session-projection-error` 后释放上游，浏览器暂停接收并显示原因；显式重试恢复连接与只读历史 | 静默丢弃审批；伪造 `seq: 0`；自动无限重连并回放同一巨帧；为恢复页面而停止 Agent |
| 后台历史读取 | 首次加载、连接缺口、缺失回执、完成边界、手动/页面恢复触发补读；外部空闲会话由轻量状态列表的 `updatedAt` 变化触发 | 恢复“活动静默 5 秒 / 空闲 30 秒”完整历史轮询；把工具执行安静当作消息丢失；活动时间戳每次变化都重读正文 |
| 完成恢复 | `active → idle/systemError` 即使旧 timing 仍为 `inProgress` 也要补读；读取中发生完成须合并排队一次后续读取 | 为减少请求漏掉最终回复、未读状态或外部客户端保存的历史；读取中完成被直接忽略 |
| 空闲同步 | 相同项目/标签快照返回原 Zustand 状态，不通知订阅者；真实变化、操作确认与错误恢复仍正常发布 | 每两秒生成新根状态，即使字段相同也通知整片 Markdown、卡片和导航重渲染 |
| 前端留存与渲染 | 活动助手正文使用有界稳定分段，完成后再渲染最终 Markdown；显示缓存与线程元数据不重复持有工具正文；截断预览断开大字符串引用 | 每 token 复制历史数组、拼接全文或重跑 Markdown；用短 `slice` 的字符数证明原始大字符串已释放；移除预算和退出观察范围的清理 |

这些是行为和资源边界，不禁止有证据的替代实现。修改预算、协议或恢复策略时，必须记录替代方案、相同工作负载下的测量结果，并更新对应测试；不得仅删除断言、放宽阈值或关闭恢复能力使测试通过。浏览器预算不是 RSS 的硬上限，不在生产中强制 GC 或周期性刷新页面掩盖增长。

## 代码与回归入口

以下路径均相对仓库根目录。修改哪一条路径，就至少运行该行测试；涉及传输、历史或状态联动时，同时运行下面的整组验收。

| 修改位置 | 必查测试 |
| --- | --- |
| `apps/server/src/routes/session-mode.ts` | 同目录 `session-mode.test.ts`；`tests/e2e/session-network-memory.spec.ts`（真实 HTTP → 网关 → 浏览器原生 EventSource） |
| `apps/web/src/session-mode/lib/eventStream.ts`、`services/apiAdapt/codex.ts` | `lib/eventStream.test.ts`、`services/apiAdapt/codex.history-page.test.ts`、`services/apiAdapt/codex-ownership.test.ts`、`components/codex/thread/CodexAccessNotice.test.tsx` |
| `services/followedSessionHistorySync.ts`、`services/followedSessionStatusSync.ts`（位于 session-mode） | 对应两个 `.test.ts`；`tests/e2e/session-background-sync.spec.ts`、`session-restoration.spec.ts`、`session-state-recovery.spec.ts` |
| `stores/useAgentCenterStore.ts`、`stores/useWorkspaceStore.ts`（位于 session-mode） | 对应两个 `.sync.test.ts`，尤其 `unchanged polling snapshots do not notify UI subscribers` |
| `services/codexTranscriptVisibility.ts`、`codexTranscriptMemoryBudget.ts`、`components/codex/stores`（位于 session-mode） | 对应单测；`tests/e2e/session-codex-stream-memory.spec.ts`、`session-transcript-memory.spec.ts`、`session-memory-governor.spec.ts` |

仓库根目录执行类型检查、构建和单测：

```sh
pnpm check
pnpm --filter server exec tsx --test src/routes/session-mode.test.ts
pnpm --filter web exec vitest run --config vitest.session.config.ts
```

浏览器验收前准备隔离 fixture 使用的前端，前端绑定 `0.0.0.0`；`PLAYWRIGHT_BASE_URL` 设置为实际局域网可访问 URL，协议与 `PLAYWRIGHT_FRONTEND_PROTOCOL` 一致。下列命令复用已启动前端，不向真实 Codex 任务发送压力数据：

```sh
PLAYWRIGHT_SKIP_WEBSERVER=1 pnpm exec playwright test \
  tests/e2e/session-network-memory.spec.ts \
  tests/e2e/session-codex-stream-memory.spec.ts \
  tests/e2e/session-transcript-memory.spec.ts \
  tests/e2e/session-memory-governor.spec.ts \
  tests/e2e/session-background-sync.spec.ts \
  tests/e2e/session-restoration.spec.ts \
  tests/e2e/session-state-recovery.spec.ts
```

涉及字段裁剪还须核对审批/提问和子 Agent 回归：`tests/e2e/session-async-questions.spec.ts`、`session-message-delivery.spec.ts`、`session-subagents.spec.ts`。接口新增 query 参数时，fixture 按 pathname 或可选 query 匹配，确保失败注入和慢读场景确实执行，不能只改断言。

## 验收证据与判断方法

- **传输证据**：基线测试送入 24 个 4 MiB 工具帧，加审批与最终回复，原始数据 100,669,814 字节；浏览器收到 4,964 个 SSE 数据字符，26 个序号连续，审批和最终回复保留。17 MiB 单帧只收到一次命名错误，不收到巨量普通消息。新实现至少保持“大工具正文没有进入浏览器”的断言；具体字节数会随元数据变化。
- **真实页面空闲观测**：稳定代码、真实后端、未发任务、未开右侧面板，125 秒 renderer RSS 从 266.5 到 253.8 MiB，范围 230.4–288.7 MiB，未强制 GC；最近历史读取 3 次，旧采样为 16 次。这是一次观测，不是所有设备必须达到的固定阈值。
- **前端物理留存**：保留 `SlicedString` 回归；逻辑字符数、事件数和 DOM 行数不能替代 GC 后留存量测量。直接调用假 EventSource 回调的测试不能替代原生网络测试。
- **现场反馈**：用户已确认本次修复后内存控制住。未来若再次出现增长，分别记录任务活动/空闲、网络入站量、读取次数、JS heap、renderer RSS、自然 GC 后的趋势及观察时间；区分短期分配、持续留存与其他进程，不凭单个峰值判断泄漏。不用开发热更新/构建中的采样充当稳定代码对照。
- **独立未解决项**：1 万条历史 / 30 标签的输入延迟阈值尚未稳定达标，旧版本对照也超过 200ms；这与本次内存修复的用户确认分别记录，不能因此声称所有性能问题都已解决。

维护本约定时同步更新 [bug 清单](debug_list.md)及[仓库记忆镜像](../memories/repo/debug_list.md)。未来发现更好的实现，应保留这里的故障背景和验证理由，让下一位维护者知道为什么这些限制存在。
