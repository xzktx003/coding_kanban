# 会话执行权交接验收

日期：2026-10-08。方案已实现；本轮没有重启正式 Rust 会话服务。工作区有其他并行 UI 改动，未回滚、暂存或提交这些改动。

## 最终结果

| 验证 | 结果 |
| --- | --- |
| `pnpm check` | shared、server、web 类型检查及生产构建通过；保留既有大 chunk 构建提示 |
| `pnpm test` | 全部通过：前端终端 526、会话 590、后端 635、脚本 95；后端 1 个既有跳过项 |
| `pnpm session:test` | 133 通过，3 个既有忽略项（Gemini/Grok 真实服务及远程 Git clone） |
| `pnpm session:clippy` | 工作区全部 target、`-D warnings` 通过 |
| 浏览器联合回归 | 31 通过：ownership、state-transitions、followups、models、drafts、stop |
| 返回窗口的历史刷新补验 | ownership 三项再次通过；focus 不抢执行权、不丢草稿 |
| 真实原生 0.159.2 | 隔离 Rust 服务 + 独立 Codex 进程，同 ID 交替写入通过 |
| VSIX 原生 0.162.0-alpha.2 | 相同协议矩阵通过，包括真实 paginated 历史读取 |
| `git diff --check` | 通过 |

浏览器访问：`https://10.30.0.24:8484/?mode=session`，协议 HTTPS，端口 8484，使用局域网地址；页面测试的 API 为隔离路由/测试网关。原生验收另用脚本创建的临时数据目录、loopback 随机端口与本地 Responses 服务，不操作正式会话。

原生每个版本分别产生 3 次本地测试回复、0 次远端模型调用。验收以内核 FLOCK、真实 app-server 回执和历史内容为依据，不把前端状态或 unsubscribe ACK 当作交接完成。

## 已核对的行为

- 打开、刷新、切换、后台历史补拉、返回浏览器窗口都走只读 API，不发 resume。
- 外部进程持有原 ID 时可读取 legacy 和 paginated 历史；发送得到 HTTP 409，模型调用次数保持不变。
- 外部释放后，网页执行入口恢复同一 ID 并发送一次；回复完成后内核写锁实际释放，独立进程再次恢复同一 ID。
- unsubscribe 回执返回时写锁仍占用；随后的发送等待真实卸载再恢复，无重复请求，原历史保留。
- 活动轮次、待审批、待续发队列、送达不明、后台终端、活动目标、资源接口异常阻止卸载；过期/乱序队列快照不能误清保护。
- 已加载子 Agent 按父子关系阻止父会话释放；无法确定归属时保守保留。
- 取得执行权失败明确“尚未发送”；实际执行回执丢失保持送达不明，不自动重发。外部占用的显式重试保留原 clientUserMessageId、文本和附件。
- 旧 close 事件不能清空新执行代数；轮次完成、迟到错误、重试、停止、审批恢复沿用并回归原状态矩阵。
- 关闭/重开标签、刷新、重开浏览器的文字和附件字节恢复通过；手动释放和外部占用提示不会清空输入。
- CLI 新设置可由只读 Thread 字段刷新；字段缺失不覆盖原设置，用户进行中的选择优先。

后台终端、目标、未知资源、事件竞态主要由注入响应的 Rust 生命周期测试验证；浏览器状态矩阵由隔离请求和事件验证。真实原生进程重点验证锁、历史、发送、卸载和版本兼容，没有伪称对所有真实工具和外部应用 UI 做过端到端遍历。

## 红绿灯与修正

1. Rust 所有权接口最初不存在，测试编译失败；实现协调器后转绿，并补充送达不明、资源失败、过期心跳和迟到关闭测试。
2. Node 的未加载会话续发及 hold 握手测试先失败：旧实现只接受 idle/systemError，且没有执行需求握手；补接口后通过。
3. 只读前端 API 测试先因缺少 threadRead 失败，新增只读实现后通过；404 不退回 resume。
4. 返回浏览器窗口的刷新测试先失败；补 focus 的只读刷新及清理后通过。完整 `pnpm test` 曾包含这个红灯，最终全量重跑通过。
5. 原生脚本最初的合成历史缺少 turn 事件，原生历史 API 无法重建旧消息；补足测试历史格式后验证原消息可见，没有用跳过历史断言掩盖问题。
6. 一轮浏览器联合回归收到 SIGTERM，未作为通过证据；使用独立输出目录完整重跑 31 项通过。

## 可复验材料

- `scripts/session-ownership-acceptance.py --codex /path/to/codex`：真实原生验收；可用 `--runtime` 指定构建二进制，用 `--output` 保存 JSON。仅终止脚本自身创建的进程组，并核对临时服务 instance。
- `packages/session-runtime/crates/codex/src/ownership.rs`：生命周期与分页单测。
- `apps/server/src/services/codex-followups.test.ts`、`routes/session-mode.test.ts`：队列保护与代理边界。
- `tests/e2e/session-ownership.spec.ts`：交接 UI 的请求和草稿断言。
- 本地运行日志：`.dev-runtime/session-ownership-research/` 下的 `all-tests-green.log`、`check-final.log`、`rust-tests-final.log`、`clippy-final.log`、`browser-final.log`、`browser-focus.log` 和 `implementation-native-{159,162}.json`；目录被 Git 忽略。

## 正式生效边界

最终 `pnpm session:status` 确认正式会话服务健康，同时明确报告“运行中的二进制与磁盘构建产物不同，新 Rust 代码尚未激活”。本轮代码构建与隔离验收完成，正式占用释放规则仍需在现有 Agent 的安全窗口更新运行层后生效。

旧运行层不支持只读历史/自动释放时前端明确提示，不悄悄通过 resume 抢锁。没有杀掉正式 Agent，也没有强制更新运行层来制造“已上线”的结果。
