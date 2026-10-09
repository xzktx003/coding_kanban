# 终端模式 Codex 完整记录定位

「完整记录」读取本机 Codex 原生 rollout JSONL，按页返回用户和助手消息；不恢复、启动或中断 Codex。会话模式历史由独立 Rust 运行层管理。

终端活动会话优先根据活动 pane 进程持有的 rollout、明确的 resume ID 和与进程启动时间接近的 shell 快照定位。Codex 可能短暂打开 rollout，并在运行数小时后重新生成 shell 快照，此时这些依据都可能不可用。进程参数明确包含 `codex resume <session-id>` 时，该 ID 是只读历史的精确身份；已恢复对话可以保留创建时的工作目录，即使 pane 当前目录不同也应读取对应 thread。

明确 resume ID 不依赖 cwd 相同，但仍要求本机 sessions 目录中存在 ID 匹配且非子 Agent 的 rollout。仅历史接口允许使用卡片已登记的会话 ID 做最后回退：活动 pane 的进程树仍须包含 Codex，rollout 元数据中的工作目录须与活动 pane 的实际目录一致，并且记录不能是子 Agent。不会按文件修改时间猜测最近会话；活动 pane 没有 Codex 进程、目标记录不存在或目标是子 Agent 时保持不可用。

这个回退只用于读取历史，不证明当前进程的写入目标；不更新 registry，也不用于图片投递、消息回复、任务变更或飞书完成通知。进程内切换 `/new` 时，须有原有精确定位依据才能更新活动 ID。

回归命令：

```bash
pnpm --filter server exec tsx --test src/services/codex-session-locator.test.ts src/services/active-codex-session-resolver.test.ts src/routes/agent-sessions.transcript.test.ts
```

现场浏览器验证通过局域网地址 `https://10.30.0.28:8484/?mode=terminal`，内部历史接口经 HTTP 网关读取。端口与地址沿用本机 `.env` 配置。
