# 精确会话的新浏览器窗口（LG21）

会话标签的操作菜单提供“在新窗口打开”，桌面和手机都可操作。它打开同源的新浏览器标签/窗口，是否显示为独立窗口由浏览器决定；不是复制链接、计划弹窗或看板分屏。官方原包锚为 `app-initial-41ab338a184f.js @2432947`，适配范围见原审计 `navigation.md`。本期入口覆盖已有关注集合中的 Codex/Claude 标签；ACP 使用独立 owner registry，不据裸 session ID 伪装成共享标签。

## 生命周期与来源

用户手势同步调用 `window.open(..., '_blank', 'noopener,noreferrer')`。浏览器在成功使用 noopener 时也可能返回 null，不能据此判失败、删除意图或自动再开一次。菜单打开后才加载 launcher，普通冷进入不请求新窗口模块；真正打开仍发生在点击该菜单项的同步手势内。

URL 只有 `mode=session&sessionWindow=<UUID>`，不携带 token、正文、草稿或用户配置。原页先保存小型 verifying 意图，再异步只读核对来源。新页在 App/输入区挂载前，通过 gate 等待同一个意图，并再次从自己的连接核对实际来源：

- 两端均读取固定 `/api/session/health` 的运行实例；账号、配对、连接变化使在途结果失效。
- Codex 读取实际 lifecycle context namespace，以及 `thread/metadata?view=chat` 的精确 ID/cwd。原生 metadata 使用 `includeTurns:false`，不读取长历史、不 acquire/resume。
- Claude 优先只读 `session-snapshot` 精确 SDK ID/cwd/runtime；只有 404 才分页读取同目录历史 metadata 验证精确 native ID，元数据累计最多 1 MiB，受原有期限限制。409/未知来源不能回退或启动 Query。
- 缺意图、重复/非法 UUID、过期、来源不同，或无法证明是同一原生端点/账号的运行代次变化，均保持局部错误，不显示替代 composer，不尝试停止、重启、继续或发送 Agent。

来源核对是本客户端观察到的范围，不是原生跨客户端 CAS。后续发送继续经过原有实际 owner/权限/未知回执处理。metadata 在检查完成与后续操作之间可能变化，不能据本次检查跳过发送前核对。

已验证意图放入该窗口自己的 sessionStorage，启动意图被消费。刷新重新核对该窗口的来源和后来选中的目标，不回跳首次打开的会话。启动意图最多 16 项在途、每项序列化 JSON 最多 8192 字符，超过 120 秒的有效旧意图在下一次手势回收；已打开窗口没有数量上限。这些记录仅含 UUID、时间、Agent/会话/目录及实际来源身份，不含 scopeToken、账号凭据、正文或草稿。

## 操作现场独立、管理状态共享

仅带合法新窗口 UUID 的页面使用 `.window.<UUID>` 设备持久键，分别保存标签选中、分屏、页面布局、Agent 选择、当前项目、文字/Goal/插件引用/子 Agent 引用草稿。普通页面保持原来的键和行为；关注/项目 journal、置顶/已读和官方线程设置仍走原共享管理链路，不把关注集合改成一个会话。

`sessionDraftKey` 同时加入该窗口身份，因此附件、图片、富上下文和其他使用同一 owner 的草稿与原页隔离；新页不迁移旧公共输入/Goal 标记。关闭或刷新不清理原页草稿、不改变原页选中或分屏、不取消任务。原 ACP recovery pointer 不会抢走明确打开的 Codex/Claude 目标。多个页面仍观察同一个官方任务；界面隔离不等于创建新的执行任务。

## 代码与红绿灯

- 入口：`components/agent/SessionTabs.tsx`、`services/openSessionWindow.ts`。
- 有界记录/范围：`sessionWindowContext.ts`、`sessionWindowRecords.ts`、`sessionWindowVerification.ts`。
- 恢复与 gate：`restoreSessionWindow.ts`、`components/common/SessionWindowGate.tsx`、`SessionWorkbench.tsx`。
- 设备存储：AgentCenter、Split、Layout、Workspace、AgentSettings、SessionDraft、GoalDraft store；只改明确新页面的 storage name/owner。

旧实现的手机真实菜单缺少入口已取得红灯；旧 scope 工具不能区分新窗口/非法重复 UUID 的三项测试先红，再实现。当前新增身份/连接/metadata/取消/刷新/nonce 在途撤销及相邻 store 回归 **11 文件 68 项通过**，日志 `.dev-runtime/extensions-resume-20261030/new-window-final-regression-unit.log`。此前全前端类型检查通过；最新一次遇到另域 CC union/test options 错误，已由对应 owner 修复，最终结果以 root 整合检查为准。

真实浏览器第一冻结 HTTPS `https://10.30.0.24:37295`（绑定 `0.0.0.0`）**6/6 通过，41.6 秒**：1440/393 两尺寸真实 popup、同源 UUID、opener null、B 唯一 composer/空草稿、在新页选择 C 编辑并刷新、原页 A/B 草稿和两组分屏保持，以及错 namespace/缺意图均拒绝且不挂 composer。全过程无任务写入/resume。该旧冻结之后还增加 launcher 按需加载、引用草稿持久隔离及下述窄恢复，不能把旧浏览器结果当作最终源验收。最终统一冻结为 **HTTPS `https://10.30.0.24:44723`**、`frozen1793314563632`，2885 项 manifest 与冻结时源码一致。该最终源的 **10/10 实际浏览器用例通过，1.5 分钟**，日志 `.dev-runtime/composer-finish-20261030/new-window-44723-final.log`：1440/393 两尺寸的 popup 保证精确 B 唯一输入/空草稿/单组窗口；新页切 C、插件/子 Agent 引用 metadata 的双页交错写入和刷新均保留各自内容，原页 A/B 草稿与两组窗口不变；同 namespace 与同 opaque endpoint identity 的新 runtime 保留原 UUID/C 稿只读恢复，未知/重复 nonce、错 metadata、不同 namespace/endpoint identity 均不挂 composer，恢复原端点重新核对后仍保留原稿。`opener === null`，任务写入/resume 为零。此处 identity A/B 是隔离 fixture，证明客户端 guard，真实端点派生单独见下文原生验证。30 次实际开窗性能独立记账；不是正式部署，也不将普通三页启动的 p95 当作新窗口身份 gate 的耗时。


补充：新窗口的插件/子 Agent 引用虽然 owner 已独立，原 whole-map 持久化仍可能回写原页过期 metadata。两条初始化/持久化真实反例先红，改为该窗口独立的 persist key 后转绿；普通页面保留原 key。图片/附件/富上下文仍使用原事务库，以包含窗口身份的 owner 隔离，不复制原始内容。该修复不增加全局观察器或改变原页面的快捷键/发送语义。


## 看板运行层替换后的窄恢复

官方 Codex 任务属于独立 daemon，看板自有运行层更换不应让已打开窗口失去原 UUID/草稿。仅对已有 sessionStorage 验证记录的 Codex 窗口，允许按固定只读通道核对新运行代次：原 namespace、原 `daemonIdentity`、精确 thread ID/cwd 均相同，且本次严格的 `context → metadata → context + health` 前后 scopeToken/namespace/daemonIdentity 和新运行代次都一致，才更新该窗口的小型 authority metadata。不会 resume/acquire、发送任务或移动草稿。新开意图、缺少 identity 的旧运行服务、不同 daemon/账号、二次代次变化均不能借此放行。

`namespace` 仅表示原生历史目录及协议可提供的账号类型/routing，不能证明 daemon 是同一实例。新增 `daemonIdentity` 为固定 Unix 端点的实际 descriptor（realpath/dev/inode/ctime）派生的 opaque SHA-256；运行层在 account read 前后验证端点，不把本看板 runtime UUID/连接代次放入该 identity。它证明所观察的端点绑定，不是 SO_PEERCRED、PID 或原生跨客户端 CAS 证明。网关只接收 64 位小写 hex，不传递未知字段或原生账号凭据，固定 context 响应 no-store。未知 transport/缺失 identity 的兼容服务仍可正常只读打开，但不启用此跨运行层恢复。生产者契约与独立原生证据见 [daemon 端点身份](daemon-endpoint-identity.md)。

Claude 暂不自动跨 runtime 重新绑定：仅凭历史 ID/cwd 不能证明原 live owner 或稳定历史来源未改变，继续明确拒绝未知来源，不调用恢复 Query。本期不将它写成已通过的 CC 跨代次证明。

跨运行层死路首先有真实失败用例，修复后同端点窄恢复、端点变化（即使看板 runtime 不变）、同值 scope 撤销、二次运行代次和 metadata 错配等 **6 文件 33 项**通过；前一整组实际近邻 **18 文件 117 项**通过，固定网关 passthrough 与 lifecycle 兼容 **19 项**通过，web/server 类型检查均已实际结束为零退出。详细日志为 `.dev-runtime/extensions-resume-20261030/new-window-runtime-rebind-red.log`、`new-window-daemon-final-unit.log`、`new-window-final-all-owned-unit.log`、`new-window-gateway-identity-{red,green}.log` 和 `new-window-{gateway,daemon-final}-types.log`。实际 runtime descriptor 原生验证由运行层记录，最终真实 popup 的同端点恢复及 30 样本性能仍由整合验收单列，不把 mock identity 当成正式 native 端点证据。

元数据投影补验：读取旧/不可信启动记录时只保留已定义的身份字段，不将额外 token/body/draft 字段带入窗口接受记录。一项原实现红灯后转绿；最终 source/gate 为6文件34项，日志 `new-window-record-projection-red.log` 与 `new-window-final-protocol-green.log`。

运行层真实端点补验：`.dev-runtime/session-full-implementation-20261029/daemon-identity-0163-native.log` 的私有官方 0.163 三项通过，分别核对完整资源清理、同 HOME 的官方 daemon 停启后端点 identity 改变但 namespace 不变，以及自有看板客户端替换时端点 identity 稳定且原任务完成。未操作正式 daemon、未复制账号、没有以 namespace 代替端点证明。对应 focused 单测 15/15，运行层全量 509 项中 500 通过、9 项显式 opt-in 跳过、零失败；构建已结束。该真实端点证明与前端 mock 协议恢复、实际浏览器操作分别记账。

## 实际开窗的两秒性能检查点

同一 44723 冻结上，先保留 30 个关注会话、父页面 4 个窗格及另外两页，再通过真实菜单连续测量第 4 页的 30 个独立 popup。精确 composer 为 p50 **1652.5 ms**、p95 **1722.6 ms**、最大 **1730.9 ms**；导航 p95 **1356.8 ms**、最大 **1365.5 ms**；真实键盘事件到两个动画帧的输入 p95 **39.8 ms**、最大 **40.3 ms**。每次 UUID 唯一、目标和独立空草稿正确；原生 HTTPS SSE 及真实 HMR 各观察到 33 条连接，控制台/页面/socket 错误和任务写入为零。

artifact 为 `.dev-runtime/composer-finish-20261030/popup-performance/session-new-window-actual--95875-s-with-three-existing-pages/new-window-performance.json`。它是 44723 的开窗检查点，不代表普通三页冷进入已通过，也不替代其后公共冷启动依赖调整的同源复验。没有改变 2 秒阈值或将历史正文局部加载算作输入可操作。
