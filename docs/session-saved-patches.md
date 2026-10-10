# Codex 保存的轮次变更

聊天中的文件变更与当前 Git 工作区是两种来源。运行中变更条位于公共输入区上方的浮层；已完成轮次的文件摘要保留悬浮 Diff、手机预览入口及完整文件列表。点击它们打开保存的 patch，不自动切换主会话或全局项目，也不以当前 Git diff 替换历史内容。

## 查看与归属

`completedTurnChanges` 优先采用同 thread/turn 的最后一个 `turn/diff/updated` 净 patch；最终 item 快照及已完成 item 回执用于补齐文件类型和精确操作范围。失败或拒绝的 patch 不进入已应用操作集合；旧格式缺失 apply status 的记录只读展示。

`useSavedTurnReviewStore` 克隆 threadId、turnId、cwd、patch、原生 fileChange 批次及选中文件。右侧保存视图保持这个快照，切项目或收到新历史不改变它。统一／并排视图保留 hunk 原行号、语法色与逐词标记；文件入口在所属项目打开并定位首个可用行。可明确返回当前工作区，现有暂存／还原能力仍在工作区 Git 面板。

## 撤销与重新应用

前端请求 `POST /api/session/saved-patches/apply`，只携带 requestId、threadId、turnId、action、expectedChanges 及可选原文件路径；不接受客户端 cwd、Git 参数或任意 patch。服务端通过原生只读 `thread/read` 核实会话目录、终态轮次及完整已应用回执，不 resume、不接管、不停止 Agent。运行中的会话拒绝文件操作。

服务端按原批次顺序重新应用，按反序撤销。同一文件的多次修改逐步在内存核对；context 不符、新增文件已被修改、重命名目标被占用等均拒绝整次操作。最终准备的是当前文件到目标内容的净 patch，通过 Git 一次校验后应用；不使用 checkout/reset，不改变 Git index。路径限制在所属仓库真实目录内，拒绝 `.git`、越界、符号链接及二进制或超限输入；重命名保留执行位。

磁盘写入可能失败，不能把所有 Git 非零退出都当作“没有改动”。只有逐文件验证仍等于操作前内容及执行位才记录 conflict；写入部分完成、超时、信号退出或回执落盘失败保持 uncertain，不擅自恢复或重试。

撤销按钮明确确认项目、轮次和文件范围。只有匹配的 success 回执才切换到“重新应用”；conflict 显示实际原因。发送前在浏览器保存操作身份，网络结果不明时禁用重复提交并提供只读核对 `GET /api/session/saved-patches/status`；刷新仍保留 uncertainty。

服务端日志在 `SESSION_DATA_HOME` 的 `codex-saved-patches.json`，只保存操作 hash／结果，不复制源码。内核 flock 锁协调热更新重叠的网关，记录在执行前持久落盘；同 requestId 只读取已有结果，不能改变范围。未确认的旧操作会阻止该会话发起新的 patch 操作。

## 验收与限制

局域网 HTTPS：`https://10.30.0.24:8484/?mode=session`。`session-codex-saved-review.spec.ts` 在 1440/390px、浅深色下连接真实路由和 Git 服务，原生会话回执使用隔离 fixture，文件位于独立临时仓库；核验保留后续修改/index、Undo/Reapply、冲突及历史显示不跟随当前磁盘内容。它不等同于向正式 Agent 发出操作，也不证明完整插件像素一致。

原生完整 review findings、行选区注释、按 hunk 暂存／还原、checkpoint 以及全部原包组件像素对照仍按整体复刻计划推进。保存视图的修改前／后仅代表 hunk 片段，不是整份历史文件。旧格式或缺少完整回执的变更不能用全文件 Git 回滚替代。
