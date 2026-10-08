# Codex 子 Agent

2026-10-08。对齐本仓库 `third_party/ChatGPT.app` 中 Codex 桌面应用的本地子 Agent 交互。调研包版本、VS Code 对照与批准方案见 [设计方案](designs/session-subagents/plan.md)，实际验证见 [验收记录](designs/session-subagents/acceptance.md)。

## 使用方式

主输入区上沿显示子任务摘要，点击“查看子任务”打开右侧工具标签，在同一位置收起。右侧支持本轮/全部历史、状态分组、搜索、分批显示、后代展开/收起、嵌套路径与完整原生历史。没有可靠继承边界时保留原始历史并说明，不根据文本相似度删除父上下文。文件变更可在详情中查看；检查视图不提供历史编辑、回滚、撤销，也不改变主会话或项目的变更面板。

子任务不会自动加入主标签或关注集合。查看、关闭工具面板、切换主标签都不启动、停止或接管 Agent，不改变主草稿、输入目标、项目或 VS Code iframe。

主输入工具栏的 `@` 可以引用已配置角色与原生明确允许交互的子 Agent。配置角色使用 `subagent://<roleName>`，已有实例使用 `agent://<threadId>`；引用作为原生 `mention` 和文字一起提交并排队。创建由主 Agent 的原生工具执行，引用或收到消息提交回执不等于已经创建任务。没有独立“手工新建子 Agent”执行器，不修改全局角色配置或静默开启多 Agent。

`canAcceptDirectInput === true` 时详情提供独立输入，文字、图片、引用按原线程保存，刷新后恢复；两个编辑视图共用提交锁。提交捕获原线程和草稿版本，返回时保留更新后的草稿。权限 false 或缺失时只读，通过“在主会话中跟进”插入可编辑指令，不伪造向子线程送达。发送前再次验证家族归属与权限；未记录的模型/权限设置由原生子线程继承，不借用当前主输入区的配置。

已测试的 Codex 0.159.2 和 0.162.0-alpha.2 都要求原生 `request_user_input` 由主线程发起。主线程负责询问用户；子线程审批仍在实际子线程显示与回复，其权限独立于普通输入。历史暂不可读时，当前真实待处理请求仍可处理。

停止提供单任务、任务及后代、本轮、全部历史四种明确范围，先确认名称与轮次。主会话不在其中；搜索和折叠也不偷偷改变批量范围。本轮停止不包含旧轮或创建轮次未确认的任务。只对确认的运行 turn 发中断，轮次变更则不发送。收到接口回执显示“已请求”，原轮出现 interrupted 才显示“已确认停止”；部分失败、未发送与回执不明逐项呈现。

## 状态与发现

家族关系使用 `parentThreadId` 或原生 source 的 thread-spawn 父标识，支持新旧命名。标题、项目路径、`forkedFromId` 不构成父子证据。旧 source 内的昵称/角色归一化读取。普通 fork 不纳入子任务。缓存按运行端 origin 隔离，缓存权限和执行状态不作为当前事实。

发现优先分页查询 `thread/list`，仅 `subAgentThreadSpawn`，使用 ancestor 过滤；原生明确不支持该过滤时才递归查询 parent。分页失败、循环、上限及不可用历史均显示不完整。已观察但 DB 缺失的 ID 只读补查，最大并发 2，恢复完整祖先链，不执行 resume。活跃薄元数据缺少 turn 时只读查最近轮次以确定停止目标。

实时创建和两类协作 item（`collabAgentToolCall`、`subAgentActivity`）即时建索引；started/completed 共用 item ID 更新，不重复渲染。执行状态共用 `codexRuntimeState`，家族不维护第二套执行状态机。较晚快照不能回退其发起后已观察的实时状态；不可用节点保留名称与选择并撤销输入能力，状态显示待确认。

已关注家族按主会话计入全局运行/待处理汇总，多个子 Agent 不增加多个“运行会话”。请求按 thread/request/turn/item/实例标记去重。主轮结束、子任务仍运行时单独提示。子完成不逐个弹桌面通知；后台待处理事项按主会话合并通知，保留实际发起者。

页面刷新、重新打开工具标签、重连、前台恢复、网关热更新都只读核对；运行实例变更会撤销缓存权限和旧异步回执。每个主会话单独保存侧面板选择。后台巡检只跟随现有关注集合，页面或会话模式隐藏时暂停轮询；普通刷新保留上次确认事实，失败后才标未确认。主轮与数量尚未确认时不显示确定的零，主摘要重新打开保留上次检查选择。

## 协议与执行权

Node 网关新增 `/api/session/subagents/snapshot`、`verify`、`roles`、`stop`。请求只能提供受校验的线程/轮次身份，停止最多 200 个且禁止重复线程。verify 返回确认后的祖先链。角色查询 cwd 来自原生主线程元数据；返回只有名字与说明，不返回 config_file、密钥或全配置。旧 Rust 端点不存在时，用已有只读 metadata/history 和有效 config/read 回退。

Rust 新增 `/api/codex/thread/metadata` 与 `/api/codex/agents/roles`。普通输入、引导、审查、回滚等受限写入在获取执行权前只读校验身份与子线程能力；未知/禁止直接输入不触发 resume。中断独立判断，复用已有所有权协调器与队列停止，不改变队列调度、失败恢复或清理策略。

运行层向真实待处理 RPC 增加非凭证 `requestToken`，区分运行实例重启后重复使用的 request ID。新网页回复携带原 thread/request/turn/item/token，运行层按当前待处理集合、请求类型校验并原子认领，一份请求不能重复回复。旧实例、错线程、错轮次、错 item、过期请求、正在提交都在写入前拒绝。发送结果不明保持认领，等待实际解决，不自动重发。旧客户端缺少 request 上下文仍保持原 API 兼容；新客户端与新运行层共同启用才具有完整保护。

阅读不取得或延长写入权；显式输入和停止遵循原协调器，CLI 占用时不强制抢占。主轮结束不解除后代、待处理请求与后台工作的资源保护。新二进制已在隔离环境编译和验收；正式 Rust 进程仍须在活跃 Agent 的安全窗口启用，不能为了展示新 UI 停止现有任务。

## 最小回归

- 网关：`pnpm --filter server exec tsx --test --test-concurrency=4 src/routes/session-subagents.test.ts src/services/codex-subagents.test.ts src/routes/session-followups.test.ts src/services/codex-followups.test.ts`。
- 前端：`pnpm --filter web test:session src/session-mode/features/subagents src/session-mode/hooks/useFollowedSessionStates.test.tsx src/session-mode/components/codex/hooks/serverRequests.test.ts src/session-mode/components/codex/items/RequestUserInputItem.test.tsx`。
- 原生：编译运行层后，`python3 scripts/session-subagent-acceptance.py --codex <已验证的 Codex 可执行文件> --questions`，再单独执行 `--approvals`；V2 二进制加 `--v2`。脚本使用独立数据目录与本地确定性模型，只清理自己的进程，不接触用户登录或活动会话。
- 浏览器：`tests/e2e/session-subagents.spec.ts`；同时回归固定高度输入、草稿、执行权交接和 VS Code 面板保活。
