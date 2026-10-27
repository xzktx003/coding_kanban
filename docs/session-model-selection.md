# Codex 会话模型隔离与切换提示

## 行为

- 已有 Codex 会话按 thread ID 保存模型与思考强度。切换 A 的配置不会改变 B 的显示、实际发送参数或新聊天默认值。
- 新聊天从全局默认值创建。创建请求开始时捕获配置，原生响应只绑定返回的 thread ID；用户随后选择的默认模型不会被迟到响应覆盖。
- 恢复历史通过既有只读聊天投影与元数据通道读取模型、提供商与思考强度，不 resume/acquire；分叉读取原生 fork 响应。已有会话尚未取得模型信息时显示“选择模型”，发送时保留原生模型默认值，不借用另一会话的配置。
- 模型选择从后续发送生效。正在运行的轮次使用原模型；引导消息仍通过 `turn/steer` 进入原轮次。已经入队的消息继续使用入队时冻结的配置。
- 切换模型或提供商时，新模型支持当前推理强度就保留，不用新模型的默认值覆盖。仅在强度未指定或新模型不支持时回退到该模型的默认强度；模型目录尚未加载或手动输入未知模型 ID 时保留已有偏好。新聊天首次自动选定模型也遵循此规则。
- 性能提醒只来自明确的强度/最近模型操作，使用原生样式的独立临时通知；普通模型radio、任意store变化及只读恢复不因此误弹。升级横幅独立展示，详细入口、轮次去重及正式SDK门控边界见[实际原组件对照](designs/session-render-alignment/model-change-notice-behavior-20261027.md)。
- 待生效选择与通知身份分别保存；跨页关闭只认领精确通知，不能因数字修订碰撞关闭另一页的新提示。

本次覆盖 Session 模式的 Codex 显示、直接发送、异步答题继续、后台排队和侧边会话发送链路。

## 状态归属

`useConfigStore` 的模型字段只作为新聊天默认值；`useThreadModelStore` 保存已有会话设置，使用 IndexedDB `kanban.session.thread-models.v1` 按会话事务保存；旧 `kanban.session.codex-thread-models` 键只作一次迁移的只读备份。`useThreadModelSettings(threadId)` 是模型选择器与输入栏的共享入口，回调捕获所属 thread ID。

每条会话设置包含本机选择、原生已观察设置、修订号与待生效标记。恢复请求捕获设置组的编辑身份和本页运行代次；旧数字修订仍用于本页兼容，不能充当跨页唯一身份。晚到响应不能覆盖请求之后的新选择或新原生事件。待生效选择在收到旧原生设置时保持原值，只在模型、提供商和已指定强度匹配后确认。

`thread/settings/updated` 按事件的 thread ID 归并，覆盖前端此前忽略的协议通知。事件不作为普通聊天内容插入，不触发消息发送或任务中断。原生权限观察仅保留在内存，持久化及恢复均剥离，缓存不能授予写入权限。

`codexService.turnStart(threadId)` 与 `followupParameters(threadId)` 都读取目标会话的配置。普通发送捕获不可变设置，等待点击时已在保存队列中的意图完成；后来切换模型或输入目标不改变本次捕获参数。保存失败、冲突或原运行代次撤销则保留草稿，不自动重发。子 Agent 原生参数、回滚重发和新 Goal 首轮的完整冻结配置不从当前UI补字段；已有 Goal 只设置目标信息，不依赖模型偏好保存。

同源多页的不同线程/独立设置组可合并；同组冲突保留本机选择并提示核对后显式重试。存储操作各有10秒截止，失败入口在输入状态面板；不会扩大历史、并发或任务写入权限。协议、有限队列、HMR和真实双页验收见[本轮持久化修复](designs/session-render-alignment/thread-settings-persistence-20261027.md)。队列实际派发仍由原网关负责，不替换原生运行服务。

## 验收记录（2026-10-08）

先红：两项服务用例复现了 B 发送借用新聊天默认模型，以及迟到创建响应覆盖新选择。修复后转绿。

- 最终会话全量测试：162 个文件、507 项通过。包括原生 settings 通知隔离、冷加载清除过时提示和配置快照回归。
- `pnpm check`：共享包、后端、前端类型检查及生产构建通过。Vite 保留现有大资源块与混合导入提示。
- 最终构建日志：`.dev-runtime/session-models/check.log`；最终模型浏览器结果：`.dev-runtime/session-models/final-playwright`。
- 桌面 1440px、手机 375px：两个浏览器流程通过，验证真实页面中的选择操作、HTTP 提交参数、A/B 切换、刷新持久化、独立草稿、收起去重、无横向溢出和手机 44px 点击区域。
- 输入栏 V2 浏览器回归：10 项场景通过，覆盖长粘贴、引用、附件、绘图、代码编辑、撤销、软键盘及 320–1440px 布局。首轮 9 项通过；旧夹具原来通过全局配置设置已有会话模型，改为原生会话设置后，剩余一项重跑通过。结果分别位于 `.dev-runtime/session-models/composer-regression` 与 `composer-regression-fixed`。

测试页面通过局域网 HTTPS 地址 `https://10.30.0.24:8484/?mode=session` 访问；浏览器 Agent/API 使用隔离 fixture，不操作正式任务。截图位于 `.dev-runtime/session-models/notice-375.png` 与 `notice-1440.png`。

主要回归用例：`useThreadModelStore.test.ts`、`AgentModelTrigger.isolation.test.tsx`、`codexService.models.test.ts`、`useServerNotificationHandler.models.test.tsx`、`tests/e2e/session-models.spec.ts`。

### 推理强度保留回归（2026-10-08）

新增测试先复现模型切换及新聊天初始化把 `high` 覆盖为 `low`；桌面浏览器也在选择默认 `low`、同时支持 `high` 的模型后失败。修复统一的强度兼容判断，并让新聊天初始化复用该判断。

- 相关 6 个测试文件、32 项单测通过，覆盖兼容强度保留、不兼容回退、未知目录、提供商切换、A/B 会话与新聊天默认值隔离。
- 局域网 HTTPS 页面 `https://10.30.0.24:8484/?mode=session` 的 375px/1440px 两项浏览器回归通过；连续切换默认强度不同的模型后仍为 `high`，刷新后保留，实际提交参数为 `high`，B 的 `low` 和两份草稿互不影响。
- 浏览器/API 采用隔离夹具，未向正式 Agent 发消息、修改原生模型配置或重启运行服务。结果位于 `.dev-runtime/reasoning-effort/green-browser`；前端构建日志位于 `.dev-runtime/reasoning-effort/build.log`。
