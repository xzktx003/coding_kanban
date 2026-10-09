# 终端模式 Codex 完整记录定位

「完整记录」读取本机 Codex 原生 rollout JSONL，按页返回用户和助手消息；不恢复、启动或中断 Codex。会话模式历史由独立 Rust 运行层管理。

终端活动会话优先根据活动 pane 进程持有的 rollout、明确的 resume ID 和接近进程启动时间的 shell 快照定位。Codex 可能短暂打开 rollout，并在运行数小时后重新生成 shell 快照，此时前三种依据都可能不可用。

仅历史接口允许恢复卡片已登记的会话 ID：校验仍有活动 Codex 进程，rollout 属于相同工作目录且不是子 Agent，优先采用 `session_meta.payload.timestamp`，与 Linux 进程启动时间相差不超过两分钟，并要求所有候选中只有一个 ID 满足该时间条件且与已登记 ID 相同。缺少或歧义的元数据保持不可用，不按文件修改时间选择最近会话。

这个兜底只用于读取已登记历史，不证明当前进程的写入目标；不更新 registry，也不用于图片投递、消息回复、任务变更或飞书完成通知。进程内切换 `/new` 时，须有原有精确定位依据才能更新活动 ID。

回归命令：

```bash
pnpm --filter server exec tsx --test src/services/codex-session-locator.test.ts src/services/active-codex-session-resolver.test.ts src/routes/agent-sessions.transcript.test.ts
```

现场浏览器验证通过局域网地址 `https://10.30.0.28:8484/?mode=terminal`，内部历史接口经 HTTP 网关读取。端口与地址沿用本机 `.env` 配置。
