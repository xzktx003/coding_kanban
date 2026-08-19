# 双 Diff 变更审查架构

## 语义

- **当前工作区**：`HEAD → 当前 working tree`，回答当前 checkout 有什么未提交变化，包含用户、其他 Agent、staged、unstaged 和未跟踪文件。
- **本次任务**：当前本机 Codex JSONL 中最后一条用户任务之后可识别的 `apply_patch` 文件操作，回答本轮 Codex 记录改了什么。首版可信度为中，Shell 或外部编辑造成的间接变化可能遗漏。

任务记录找不到可靠边界时必须返回不可用，不能将工作区 Diff 作为降级结果。

## API

- `GET /api/agent-sessions/:id/git-changes`
- `GET /api/agent-sessions/:id/task-changes`

两个路由都只接受稳定会话 ID，工作目录从后端 registry 获取；远端 Git 和非本机 Codex 首版返回明确不可用原因。

## UI

桌面聚焦视图和手机终端页均提供“变更”入口。面板固定显示来源、可信度/分支、文件数和增删行；文件列表支持路径筛选、复制路径和统一 Diff。首版只读，不提供 stage、discard、commit、reset、merge。

## 后续扩展

后续应增加任务基线快照和 `AgentTaskRun`，覆盖任务开始前已有脏工作区与 Shell 间接修改；再增加行范围评论、内容指纹和过期锚点检测。共享 checkout 下不可证明归因时继续保持不可用，而不是降低语义准确性。
