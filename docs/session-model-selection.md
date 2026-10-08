# Codex 会话模型隔离与切换提示

## 行为

- 已有 Codex 会话按 thread ID 保存模型与思考强度。切换 A 的配置不会改变 B 的显示、实际发送参数或新聊天默认值。
- 新聊天从全局默认值创建。创建请求开始时捕获配置，原生响应只绑定返回的 thread ID；用户随后选择的默认模型不会被迟到响应覆盖。
- 恢复历史读取 `thread/resume` 返回的模型、提供商与思考强度；分叉读取原生 fork 响应。已有会话尚未取得模型信息时显示“选择模型”，发送时保留原生模型默认值，不借用另一会话的配置。
- 模型选择从后续发送生效。正在运行的轮次使用原模型；引导消息仍通过 `turn/steer` 进入原轮次。已经入队的消息继续使用入队时冻结的配置。
- 选择不同模型后，输入栏上方显示“本会话模型：旧模型 → 新模型”，注明下次发送生效。确认原生设置后显示“后续发送使用当前模型”。提示可收起；只保留最新一条，手机收起按钮保持 44px，长模型 ID 可换行。
- 初次历史恢复、重复选择同一模型、单独调整思考强度不产生模型切换提示。收起状态随本机缓存保留，确认和重复通知不会重新展开；下一次切换生成新提示。

本次覆盖 Session 模式的 Codex 显示、直接发送、异步答题继续、后台排队和侧边会话发送链路。

## 状态归属

`useConfigStore` 的模型字段只作为新聊天默认值；`useThreadModelStore` 保存已有会话设置，缓存键为 `kanban.session.codex-thread-models`。`useThreadModelSettings(threadId)` 是模型选择器与输入栏的共享入口，回调捕获所属 thread ID。

每条会话设置包含本机选择、原生已观察设置、修订号与待生效标记。恢复请求捕获修订号，晚到响应不能覆盖请求之后的新选择或新原生事件。待生效选择在收到旧原生设置时保持原值，只在模型、提供商和已指定强度匹配后确认。

`thread/settings/updated` 按事件的 thread ID 归并，覆盖前端此前忽略的协议通知。事件不作为普通聊天内容插入，不触发消息发送或任务中断。模型切换提示参考 Codex VS Code 扩展的旧模型/新模型提示形式。

`codexService.turnStart(threadId)` 与 `followupParameters(threadId)` 都读取目标会话的配置。队列的实际派发仍由原网关负责，本次不改变队列派发规则和原生运行服务。

## 验收记录（2026-10-08）

先红：两项服务用例复现了 B 发送借用新聊天默认模型，以及迟到创建响应覆盖新选择。修复后转绿。

- 最终会话全量测试：162 个文件、507 项通过。包括原生 settings 通知隔离、冷加载清除过时提示和配置快照回归。
- `pnpm check`：共享包、后端、前端类型检查及生产构建通过。Vite 保留现有大资源块与混合导入提示。
- 最终构建日志：`.dev-runtime/session-models/check.log`；最终模型浏览器结果：`.dev-runtime/session-models/final-playwright`。
- 桌面 1440px、手机 375px：两个浏览器流程通过，验证真实页面中的选择操作、HTTP 提交参数、A/B 切换、刷新持久化、独立草稿、收起去重、无横向溢出和手机 44px 点击区域。
- 输入栏 V2 浏览器回归：10 项场景通过，覆盖长粘贴、引用、附件、绘图、代码编辑、撤销、软键盘及 320–1440px 布局。首轮 9 项通过；旧夹具原来通过全局配置设置已有会话模型，改为原生会话设置后，剩余一项重跑通过。结果分别位于 `.dev-runtime/session-models/composer-regression` 与 `composer-regression-fixed`。

测试页面通过局域网 HTTPS 地址 `https://10.30.0.24:8484/?mode=session` 访问；浏览器 Agent/API 使用隔离 fixture，不操作正式任务。截图位于 `.dev-runtime/session-models/notice-375.png` 与 `notice-1440.png`。

主要回归用例：`useThreadModelStore.test.ts`、`AgentModelTrigger.isolation.test.tsx`、`codexService.models.test.ts`、`useServerNotificationHandler.models.test.tsx`、`tests/e2e/session-models.spec.ts`。
