# 会话状态转换、错误恢复与验收

## 状态与优先级

输入栏、侧边输入、问题回答、标签、关注汇总、回滚编辑、审查、任务列表与退出检查统一使用 `codexRuntimeState`。相同轮次的完成/失败优先于遗留 active；systemError 无需等待历史即可显示失败；notLoaded 保持未知。新的明确启动回执会清理上一轮错误。运行中但未确认 turnId 时不得引导或停止未知轮次。

`acceptTurnStart` 拒绝同轮终态后的重复 started，以及 startedAt 早于已知新轮的 started。历史快照不能把相同已结束轮改回 inProgress，也不能覆盖时间更晚的已知轮；正常历史合并仍保留实时消息。回滚作为显式历史替换可以重置边界。HTTP turn/start 回执到达前若实时事件已结束该轮或开始新轮，保留实时事实。

运行服务实例变更使在途 resume 的版本及合并表失效，同时清理当前运行状态和加载标记；旧响应不能写回新实例，保留本地草稿与已有聊天历史。

## 待处理 RPC

请求身份包含实例代际、threadId、requestId 及可用的 turnId/itemId。重复通知去重，提交时捕获原请求对象；快照保留同一未变更请求的对象身份，迟到回执不能清除另一个请求。成功响应才移除卡片；明确 4xx/原生拒绝保留重试入口；超时、断网、无法确认的响应进入 uncertain，保留内容并禁止盲目重复发送，提供“核对状态”。原生问答与权限/MCP/命令文件审批共用这一发送保护。请求及敏感答案只保存在内存。

`serverRequest/resolved`、匹配轮次的完成/不可重试错误、线程关闭/删除和实例重启清理相应请求。可重试错误和其他轮次/会话不会被连带清理。

Rust EventHub 增加 `codex/pending-requests-snapshot`，结构为 `{ requests: [{ event, payload }] }`。它包含所有仍待处理的 Codex RPC，独立于有限长度事件缓存。刷新/重连时在原子游标处生成，允许与最后补发事件共享 seq；前端把它视作状态核对。原 `codex/user-input-snapshot` 保留兼容。WebSocket/SSE 均使用该快照，不回放新客户端的全部历史。

## 后台错误恢复

旧轮的 error 不暂停新轮；失败前积累的消息在 systemError/error/completed(failed) 后保持暂停。`resume` 是明确恢复动作。用户已经看到失败后输入一条新消息时，可携带 `recoverAfterError: true`，仅在无旧待发消息、无等待回执、无暂停状态时允许开始新轮；不能借此释放此前队列。这个标记不改变消息顺序，实例重启后也不自动恢复不确定发送。

## 主题

右上角太阳/月亮按钮一键切换浅色/深色。沿用 `kanban.session.theme-storage` 保存偏好；系统主题模式下按实际显示主题切换到相反的明确主题。切换不导航、不改变会话、草稿或布局，样式限定在会话模式。

## 审计勘误

原审计第 12 项使用非法 `{kind: "acp"}` 关注卡片构造测试。真实共享关注集合类型为 Codex/Claude，ACP 使用独立入口，因此撤销该项产品 bug 判定，没有擅自扩展关注集合协议。其余 11 类问题及跨实例恢复风险纳入本次修复。

## 验收

隔离浏览器访问地址：`https://10.30.0.24:8484`（HTTPS，8484）。测试接管会话/审批接口，不向真实 Agent 提交消息。截图位于 `.dev-runtime/state-audit/{light,dark}-{390,1440}.png`。

- 前端：`sessionState.transitions.test.ts` 覆盖状态分歧、旧事件、启动回执、历史恢复、实例变更、请求过期/去重/迟到回执、明确失败和送达不明；既有通知、回滚、问答、主题测试继续验收。
- 后端：`codex-followups.transitions.test.ts` 和既有队列/路由/HTTP 集成测试核对旧轮错误隔离、失败暂停、显式恢复以及消息顺序。
- Rust：EventHub 和 WebSocket 测试核对刷新、重连、缓存淘汰及待处理 RPC 快照；严格 clippy。
- 浏览器：`session-state-transitions.spec.ts` 与 `session-followups.spec.ts` 核对界面与实际请求，包含手机/桌面主题偏好持久化、草稿和选中会话保留。
- 变更没有重启当前真实 Rust 运行服务；新增运行层快照协议在运行服务下一次安全重启后生效。前端和 Node 网关沿用开发热更新。

完整执行日志保存在 `.dev-runtime/state-audit/`，当前修改未自动提交。

### 本轮执行结果

- `pnpm check`：共享包、后端、前端类型检查及生产构建通过；仅既有大 bundle 提示。
- 会话前端全量：158 个文件、491 项通过。其后对最后的重连/过期事件收敛改动再跑 27 项相关测试，通过；最终前端类型检查通过。
- 后端队列、路由和真实 HTTP adapter 集成：24 项通过。
- Rust web：45 项通过，包括新增全部待处理 RPC 快照和真实 WebSocket 刷新/重连；`cargo clippy -p codexia-web --all-targets -- -D warnings` 通过，`pnpm session:build` 通过。
- 浏览器：状态/主题/队列 8 项、三种 Agent 停止及后台标签恢复 4 项、手机/桌面回滚错误与重试 2 项，共 14 项通过。回滚夹具补齐完整历史加载标记，并让模拟后端与注入历史及回滚后的历史一致。
- 正式 runtime 的 PID 和 instance 前后相同且进程存活；没有为加载新程序中断现有 Agent。新快照协议尚未装入正在运行的旧进程。
