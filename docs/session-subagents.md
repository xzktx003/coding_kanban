# Codex 子 Agent

2026-10-08。对齐本仓库 `third_party/ChatGPT.app` 中 Codex 桌面应用的本地子 Agent 交互。调研包版本、VS Code 对照与批准方案见 [设计方案](designs/session-subagents/plan.md)，实际验证见 [验收记录](designs/session-subagents/acceptance.md)。

## 使用方式

主输入区上沿显示子任务摘要，文案为「子任务 · 进行中 N」。数量未确认时显示「进行中待确认」，不显示确定的 0。点击“查看子任务”在对话右侧打开子智能体侧栏，同一按钮变为“收起子任务”。侧栏标题为「子智能体」，按插件文案分成「已开启 · N」和「完成 · N」两段扁平列表：已开启先显示 4 条，完成先显示 10 条，可展开全部。有等待项时，已开启标题旁显示等待数量。详情返回按钮文案为「返回子代理列表」。嵌套后代进入同一列表，不再按树展开或按轮次筛选，也没有搜索框。点击一行进入该子会话，顶栏提供返回、名称和已记录的模型/推理等级。正文查看原生历史。没有可靠继承边界时保留原始历史并说明，不根据文本相似度删除父上下文。文件变更可在详情中查看；检查视图不提供历史编辑、回滚、撤销，也不改变主会话或项目的变更面板。

子任务不会自动加入主标签或关注集合。查看、收起侧栏、切换主标签都不启动、停止或接管 Agent，不改变主草稿、输入目标、项目或 VS Code iframe。

主输入工具栏的 `@` 可以引用已配置角色与原生明确允许交互的子 Agent。配置角色使用 `subagent://<roleName>`，已有实例使用 `agent://<threadId>`；引用作为原生 `mention` 和文字一起提交并排队。创建由主 Agent 的原生工具执行，引用或收到消息提交回执不等于已经创建任务。没有独立“手工新建子 Agent”执行器，不修改全局角色配置或静默开启多 Agent。

`canAcceptDirectInput === true` 时详情提供独立输入，文字、图片、引用按原线程保存，刷新后恢复；两个编辑视图共用提交锁。提交捕获原线程和草稿版本，返回时保留更新后的草稿。权限 false 或缺失时详情只显示原生历史，不放只读说明，也不插入主会话跟进指令。主输入区仍可用 `@` 引用该子 Agent。发送前再次验证家族归属与权限；未记录的模型/权限设置由原生子线程继承，不借用当前主输入区的配置。

已测试的 Codex 0.159.2 和 0.162.0-alpha.2 都要求原生 `request_user_input` 由主线程发起。主线程负责询问用户；子线程审批仍在实际子线程显示与回复，其权限独立于普通输入。历史暂不可读时，当前真实待处理请求仍可处理。

子任务侧栏不提供停止、停止后代或按轮次批量停止。中断只使用主会话已有的停止入口。网关和运行层仍保留按确认轮次中断的接口，供该入口使用；面板不再调用它。

## 状态与发现

家族关系使用 `parentThreadId` 或原生 source 的 thread-spawn 父标识，支持新旧命名。标题、项目路径、`forkedFromId` 不构成父子证据。旧 source 内的昵称/角色归一化读取。普通 fork 不纳入子任务。缓存按运行端 origin 隔离，缓存权限和执行状态不作为当前事实。

发现优先分页查询 `thread/list`，仅 `subAgentThreadSpawn`，使用 ancestor 过滤；原生明确不支持该过滤时才递归查询 parent。分页失败、循环、上限及不可用历史均显示不完整。已观察但 DB 缺失的 ID 只读补查，最大并发 2，恢复完整祖先链，不执行 resume。活跃薄元数据缺少 turn 时只读查最近轮次以确定停止目标。

仅 `collabAgentToolCall.tool === spawnAgent`、`subAgentActivity.kind === started` 创建事件与原生父元数据提供家族关系证据；send/resume/wait/close/interacted 等通信接收者不创建或改写父子关系。started/completed 共用 item ID 更新，不重复渲染。执行状态共用 `codexRuntimeState`，家族不维护第二套执行状态机。较晚快照不能回退其发起后已观察的实时状态；不可用节点保留名称与选择并撤销输入能力，状态显示待确认。通信项的模型/推理参数也不覆盖接收者的原生设置。

聊天呈现与观察索引分开：按 26.51002.51308 原包规则，`collabAgentToolCall.tool === wait` 不生成可见聊天行；事件、轮次、接收者和状态仍完整用于家族观察。其他协作调用默认折叠，子活动使用原名称格式和状态文案，展开／查看保持只读观察入口。截图故障及回归见 [恢复修复记录](designs/session-render-alignment/render-recovery-progress.md)。

已关注家族按主会话计入全局运行/待处理汇总，多个子 Agent 不增加多个“运行会话”。请求按 thread/request/turn/item/实例标记去重。主轮结束、子任务仍运行时单独提示。子完成不逐个弹桌面通知；后台待处理事项按主会话合并通知，保留实际发起者。

页面刷新、重新打开工具标签、重连、前台恢复、网关热更新都只读核对；运行实例变更会撤销缓存权限和旧异步回执。每个主会话单独保存侧面板选择。后台巡检只跟随现有关注集合，页面或会话模式隐藏时暂停轮询；普通刷新保留上次确认事实，失败后才标未确认。主轮与数量尚未确认时不显示确定的零，主摘要重新打开保留上次检查选择。

## 协议与执行权

Node 网关新增 `/api/session/subagents/snapshot`、`verify`、`roles`、`stop`。请求只能提供受校验的线程/轮次身份，停止最多 200 个且禁止重复线程。verify 返回确认后的祖先链。角色查询 cwd 来自原生主线程元数据；返回只有名字与说明，不返回 config_file、密钥或全配置。旧 Rust 端点不存在时，用已有只读 metadata/history 和有效 config/read 回退。

默认 TypeScript 运行层提供 `/api/codex/thread/metadata` 与 `/api/codex/agents/roles`。普通输入、引导、审查、回滚等受限写入在获取执行权前及串行锁内恢复前只读校验身份与子线程能力；未知/禁止直接输入不触发 resume。中断独立判断，复用已有所有权协调器与队列停止，不改变队列调度、失败恢复或清理策略。

运行层向真实待处理 RPC 增加非凭证 `requestToken`，区分运行实例重启后重复使用的 request ID。新网页回复携带原 thread/request/turn/item/token，运行层按当前待处理集合、请求类型校验并原子认领，一份请求不能重复回复。旧实例、错线程、错轮次、错 item、过期请求、正在提交都在写入前拒绝。发送结果不明保持认领，等待实际解决，不自动重发。旧客户端缺少 request 上下文仍保持原 API 兼容；新客户端与新运行层共同启用才具有完整保护。

阅读不取得或延长写入权；显式输入和停止遵循原协调器，CLI 占用时不强制抢占。主轮结束不解除活动/未知后代、待处理请求与后台工作的资源保护。全部资源空闲且 native 版本通过兼容关卡时，可以仅取消父订阅；子 writer 及跨进程控制边界见 [执行权](session-ownership.md)。2026-10-08 的原生运行层曾按用户明确的中断授权正式激活；后续更新仍须等待活跃 Agent 的安全窗口或取得明确的中断授权，不能为了展示新 UI 停止现有任务。

## 最小回归

- 网关：`pnpm --filter server exec tsx --test --test-concurrency=4 src/routes/session-subagents.test.ts src/services/codex-subagents.test.ts src/routes/session-followups.test.ts src/services/codex-followups.test.ts`。
- 前端：`pnpm --filter web test:session src/session-mode/features/subagents src/session-mode/hooks/useFollowedSessionStates.test.tsx src/session-mode/components/codex/hooks/serverRequests.test.ts src/session-mode/components/codex/items/RequestUserInputItem.test.tsx`。
- 原生：编译运行层后，`python3 scripts/session-subagent-acceptance.py --codex <已验证的 Codex 可执行文件> --questions`，再单独执行 `--approvals`；V2 二进制加 `--v2`。脚本使用独立数据目录与本地确定性模型，只清理自己的进程，不接触用户登录或活动会话。
- 父订阅释放兼容：`python3 scripts/session-subagent-release-acceptance.py --codex /absolute/path/to/codex --output-dir /private/acceptance/output`。精确版本门控与双版本结果见 [2026-10-14 验收](designs/session-subagent-identity-release-acceptance-20261014.md)。
- 浏览器：`tests/e2e/session-subagents.spec.ts`；同时回归固定高度输入、草稿、执行权交接和 VS Code 面板保活。

TypeScript 运行层启动 smoke：`pnpm session:build` 后运行 `python3 scripts/session-subagent-acceptance.py --smoke`，使用独立目录，不启动原生 Agent、不请求模型。完整 `--questions` / `--approvals` 验收仍须主线程发起。

## 后台汇总批量停止的范围确认（2026-10-11）

安全审查发现后台汇总把所有后代都标为 current，且直接发送停止请求。现复用 inParentTurn / selectStopTargets，只有已核实且本轮创建的目标参与；旧轮和未知创建轮次不默认包含。确认框明确显示数量和名单，取消不发送。确认前再次核对根会话、父轮次、各子轮次、运行 epoch、账号工作区和连接范围；变化后撤销本次确认，重复点击只发送一次。参数仅保存捕获的 threadId/turnId，不保存任务正文。

该确认遵循仓库用户规则，是浏览器宿主的明确适配，不宣称原插件所有 canStopAll 分支均已核实。审批和直接输入能力仍分别判断，未借此扩大中断权限。5 项安全单测覆盖旧轮/未知/未验证排除、取消、父/子轮次变化、同 email 工作区变化和重复确认；浏览器使用隔离子线程验证名单、取消与过期确认，未停止真实 Agent。

2026-10-11 确认失效规则补充：确认期间的轮次、工作区、实例和目标集合只要变化过，之后身份值恢复也不能复活旧确认。弹窗挂载期间使用同步元数据订阅记录失效，关闭／取消／卸载即释放；正文更新不触发重复名单扫描，不停止或恢复 Agent。对应确定性单测先红后绿，6 项安全用例通过；浏览器原失败及新范围返回测试分别保留验收记录。

## 2026-10-14 历史关系元数据与实时状态

`observeSubagentHistory` 只补充缺失的关系和创建轮次元数据，不清除只读快照已经确认的 unavailable，不覆盖已验证身份的原生状态/权限，也不提高已有节点的实时 revision。这样旧 spawn 记录不会推翻在途 snapshot 的不可用结论。独立实时事件继续走 `observeSubagents` 的状态更新路径，可确认线程重新可用；相同历史数组和事件的 WeakSet 去重仍保留。面板在发现不完整时保留已知行，以待确认提示数量及不可用状态，不能据历史正文开放输入权限。回归包括 `features/subagents/events.test.ts` 与真实浏览器的 incomplete discovery 用例。

## 2026-10-14 主身份纠正与有限只读核对

已确认的原生 main 身份会移除旧通信误建的子节点；明确 subAgent 源即使缺父标识也不会归为 main。缺 source 且无子线索的旧 metadata 仅保持既有输入兼容，不断言主身份。公共、侧边、子输入与 @ 候选复用同一身份规则；未知、不可用或真实子能力不明确时不能普通发送。

v1 缓存仅迁移待核实线索，不恢复权限；剔除已确认 main 的伪边、自环与环。轻量身份不持有 turns/preview/status，节点不保留工具正文。疑似子身份的核对合并并发请求，5 秒 deadline、一次 1.5 秒重试，取消/失活停止请求与重试。只读 metadata 不 resume、不发消息；错误保留草稿并提供“重新核对”。

同值 live metadata 也推进内部每线程观测标记，迟到旧请求不能恢复已撤销的能力，或将新确认节点误标不可用；观测标记不进入 UI state。相同业务快照保持引用且零通知，无关线程更新不作废目标读取。重连/运行实例变化撤销旧标记和权限，历史不推进 live 权限。来源对照、反例与验收见 [方案](designs/session-subagent-identity-release-plan-20261014.md) 和 [结果](designs/session-subagent-identity-release-acceptance-20261014.md)。
