# 子线程身份误判与会话释放滞留：已审修改方案

日期：2026-10-14。状态：**用户已批准按计划开发并严格验收；实现与结果见 [验收记录](session-subagent-identity-release-acceptance-20261014.md)。正式运行层启用仍遵守活跃 Agent 安全窗口。**

本方案针对截图中的会话模式提示。独立 Codex 模式的刷新常驻方案仍按原文档 review；本次不扩展到宿主重构，也不修改官方 VSIX。

## 结论与证据边界

两条提示属于不同状态，不能都解释成“会话被其他客户端使用”。

| 截图提示 | 实际含义 | 本次确认的问题 |
| --- | --- | --- |
| 仍有已加载的子 Agent，等待其退出后释放 | 本项目运行层仍保留父会话实例；当前状态可为 `owned`。 | 所有 loaded 后代都阻止释放，包括已完成且空闲的子线程；这一分支没有自动收敛路径。它本身不会禁止主会话发送。 |
| 当前子线程由主 Agent 调度，不能直接发送消息 | 前端认为当前目标是不能接受普通输入的子线程。 | 协作消息接收者被推断为发送者的子节点，可能把主会话误分类；Composer 又优先相信该观察节点，忽略原生主线程身份。真正受限的子线程仍须保留输入限制。 |

已复现当前源码的两个缺陷；尚未取得截图当时的 thread UUID、原生元数据和事件序列，不能断言截图必然来自同一条误判链。

`pnpm session:status` 显示当前服务为 TypeScript，且运行进程与磁盘产物不一致。健康接口确认 `codexOwnership` 可用；这不证明新源码已激活。因此实现前还须只读记录运行产物、实例代次及实际 Codex 版本；构建通过不能代替部署验证。

## 官方 Codex 对照

本地未修改包：`third_party/openai.chatgpt-26.51007.21434-linux-x64/extension`，版本 `26.51007.21434`。以下是包内静态实现证据，不宣称完整 VS Code UI 已端到端验证。

| 官方实现 | 对本次方案的约束 |
| --- | --- |
| Webview 的 topology discovery 只从 `collabAgentToolCall.tool === spawnAgent`、`subAgentActivity.kind === started` 发现创建关系。历史扫描同样区分创建与通信。 | `sendMessage`、`sendInput`、wait、close 等接收者不能新建或改写父子边。创建事件可以提供发现线索，最终身份由原生元数据核实。 |
| 线程父身份来自 `parentThreadId` 或原生 `source`；`isSubagentSource` 根据元数据判断。 | “观察索引中有这个 ID”不能代替子线程身份。标题、项目路径、普通 fork 和历史通信也不能代替父关系。 |
| 官方子任务详情用 `canInteract === true` 开放交互；包中 V1 spawn 与 V2 activity 的交互能力处理不同。 | 不把官方前端的工具分类直接移植成写入权限。本项目按仓库约定继续要求原生 `canAcceptDirectInput === true`，且发送前重新验证。未知能力不能提升为允许输入。 |
| 官方 inactive owner 策略保留上限 10 项、3 小时 TTL，并保护活动视图、stream followers、运行任务及待处理请求；其保留判断不使用笼统的 loaded 子线程数量。 | 已加载可以只是保留的实例，不等于正在工作或被其他客户端占用。本次借鉴状态区分和保护条件；不顺带改动本项目已有缓存策略，也不替换另一份待审刷新方案的配置选择。 |
| 官方 app-server `thread/unsubscribe` 只移除当前 connection 对指定 thread 的订阅。 | 不把 ACK 当作已经卸载，也不把父订阅释放替换成停止子 Agent。 |
| 原生 listener 在无订阅且非 active、超过卸载延迟后，执行指定线程的 shutdown；整棵树关闭有独立入口。 | loaded 是加载状态，不能直接换算成任务仍运行。安全释放方案仍须核对父与后代的真实活动资源，并以实际包内 CLI 的隔离验证决定是否启用。 |

Webview 证据入口：

- `extension/webview/assets/app-initial-c4ebaa710049.js`：`discoverForSpawn`、`isSubagentSource`、父元数据归一化与历史创建扫描。
- `extension/webview/assets/app-initial-41ab338a184f.js`：子任务 `canInteract` 的生成。
- `extension/webview/assets/local-conversation-subagents-panel-tab-e1ae2765a53e.js`：详情交互能力门控。

入口已确认：`webview/index.html → index-a81e152b9706.js`，静态 imports 与 app-main 的预加载依赖包含上述两大 app-initial bundle。`c4ebaa` 的 SHA-256 为 `50e2af3d8c3d0e3c52612beb2d95940cc818dfe979d6d85a9fa61af5526640bc`；`41ab338` 为 `c755dbca916c0f830a554fe2e3057f8642b32394bea7701338e5d506f692ad56`。

官方源码快照为 `third_party/codex` 的 `0a2a64e94200b03af3901bad4cd918030739c697`，工作区干净。主要路径：

- `codex-rs/app-server/src/request_processors/thread_processor.rs:1022`：取消指定 connection 的订阅。
- `codex-rs/app-server/src/request_processors/thread_lifecycle.rs:20`、`:377`、`:427`：卸载条件、单线程 shutdown、延迟卸载的实例匹配。
- `codex-rs/core/src/session/handlers.rs:290`：会话运行资源关闭。
- `codex-rs/core/src/thread_manager/shutdown.rs:127`：独立的 agent-tree shutdown。

源码快照不能证明正在运行或 VSIX 内 CLI 与其一致。REA 的整包语义分析受超时/内存限制，不能声称全包覆盖；本方案采用有限原文定位及当前自有代码的原函数复现。完整版本、hash、有限摘录和工具覆盖说明保存在本轮临时审计目录。

## 当前源码复现

### 输入被错误禁用

`features/subagents/store.ts:159` 遍历所有协作接收者，默认令其 `parentId = senderThreadId`，只在创建轮次字段上区分 `spawnAgent`。`Composer.tsx:202` 只要找到观察节点，就按其能力判断，未核对 `verified`、当前实例或原生 source。

使用原始函数及纯内存数据复现：

1. 原生确认 `child` 的父线程是 `root`。
2. `child` 向 `root` 发一条 `sendMessage`。
3. 当前代码建立 `root → child` 的错误父关系，令主线程进入不可输入状态。
4. 再送入 `root.source = vscode` 的原生主线程元数据，并刷新真实子线程快照，错误节点仍保留，输入仍被禁用。

V2 的真实通信形状也已核对：官方 `send_message` 可向 `/root` 发送，成功后产生 `subAgentActivity.kind = interacted`。当前 `store.ts:197` 对该类型的所有 kind 都写入子关系；原函数 fixture 同样确认 interacted 把 root 误记为 child 的子节点。官方历史 discovery 则明确跳过 interacted。

对另一个独立主线程发协作消息也会制造相同误分类。原函数复现未向真实线程发送消息；真实子线程能力为 false 的对照仍正确被禁用。

### 释放不收敛及相关反例

`ownership.ts:207` 只根据 loaded 集合建立父图；任何 loaded 后代都会阻止父 unsubscribe。`client.ts:126` 只扫描既有 Ownership entry，原生创建子线程不会自动登记一个负责释放它的 entry。

纯内存 RPC fixture 确认：

| 当前行为 | 拟验收结果 |
| --- | --- |
| 父与 idle 子线程 loaded；12 次 sweep 后仍 owned，unsubscribe 为 0。 | 在原生兼容关卡通过、所有资源条件满足后，父订阅能够释放；不无限等待“子线程退出”。 |
| 活跃孙线程的中间祖先不在 loaded 集合，父释放检查漏掉它。 | 只读补齐祖先链，仍保护该活跃后代。 |
| 无关家族形成环，也阻止当前父会话释放。 | 已确认无关的家族不影响当前目标；当前家族的环或归属未知仍保守保留。 |
| 无关线程正文事件改动全局 revision，反复作废释放检查。 | 无关正文不阻塞；当前家族的活动、成员变化、请求及实例变更仍作废检查。 |
| loaded 查询期间新子线程出现，但 revision 在查询之后才捕获。 | 从检查开始捕获代次，查询期间的创建事件不能被吸收成“已检查”的基线。 |

现有 ownership/client 9 项测试通过，未覆盖这些反例。8 秒释放超时只作用于已经发出 unsubscribe 的 `releasing`，不能修复一直保持 `owned` 的子线程阻塞。

## 拟修改内容

### 1. 按官方规则分开创建关系与通信关系

- 创建候选边只来自 spawn、started 及经过验证的原生父元数据。普通协作事件只更新已知对象的活动记录；未知接收者可作为待查身份，不写成子节点。
- 防止自环、反向主子关系和跨家族误连；通信不能改写已验证创建关系。普通 fork 保留原语义。
- 当前原生元数据明确确认主线程时，清除与其矛盾的推测子边，并使依赖该边的旧家族结论失效；元数据只是缺字段或来源 unknown 时，不擅自认定为主线程。
- 刷新、运行层更换、旧历史回放及迟到快照都经过身份/版本核对。历史发现不能恢复旧权限，较旧的 capability 响应不能覆盖新事件。

### 2. 修复公共输入门控，恢复旧错误缓存

- 使用一个共同的线程身份判定：已确认主线程、已确认子线程、身份待确认。输入判断以当前原生身份与能力为准，观察节点只提供发现线索。
- 已确认主线程不因观察索引存在同 ID 而被禁用；真正子线程只有原生明确允许时才提供普通输入。身份或能力未知时显示“正在核对线程身份/输入权限”，不显示确定的“由主 Agent 调度”。
- 同一判定覆盖主 Composer、SideChatPanel、子任务详情/独立输入、Agent mention 与公共提交服务。后端的发送前只读验证继续保留；source 已确认是子线程但父字段缺失时也不能被当主线程绕过权限。
- 旧持久化观察关系按新 schema 迁移为待验证线索，移除可证明的通信伪边、自环与循环。保留草稿、附件、关注标签、名称和面板选择；节点不可用时保留可解释的检查状态，不切换输入目标。
- 提供轻量“重新核对”入口，仅读取元数据与现有状态。相同快照不通知正文订阅者，请求并发合并、有限重试、失活取消和 epoch 保护继续保留。

### 3. 让父会话释放能够安全收敛

**推荐候选：只释放本项目对父 thread 的订阅，不对子线程发 close、interrupt、tree shutdown 或试探性输入。** 实际启用以第 0 阶段通过为前提。

- loaded 子线程不再单独作为永久阻塞理由。检查父与真实后代的运行/重试状态、审批/提问、原生目标、后台终端、待发队列、送达未知、新线程首条消息及其他未知资源。
- 活跃或状态未知的相关后代继续保护父实例；不能根据主轮已 completed 就认为整家族空闲。仅 idle/completed 不够，须同时通过上述资源核对。
- 使用原生只读元数据补齐祖先链，包括未加载的中间节点；有限并发、分页完整性、循环/上限保护和取消保持。无法排除与当前家族相关的未知关系，继续保留并显示具体待确认原因。
- 在检查开始捕获运行实例、目标 generation、成员与家族状态版本；动作前重新核对，避免 snapshot 与新任务竞态。无关正文事件不反复触发全局“忙碌”；家族创建、当前请求、相关队列和连接变化仍使结果失效。
- unsubscribe ACK 后保持 releasing，直到本进程 loaded/list 确认该父 ID 已离开；丢失 close 事件也能收敛，迟到 close 不能清掉新 generation。
- 超时只提示未确认与只读复核，不重复提交消息或停止任务。若实际 native 卸载不符合关卡，保留原安全策略，带证据重新 review，不自动改用子线程关闭。

### 4. 将提示放在正确的位置

- 正常 owned/readonly 的生命周期信息放入状态详情；日常聊天不长期悬浮显示“等待退出后释放”。释放检查的原因不伪装成 external writer 冲突。
- 真正影响发送的 external、releasing、输入权限未知或送达未知，在输入区紧凑显示准确原因；可编辑草稿和附件保留。
- 真实受限子线程按官方检查视图保留只读能力；不借修复给它增加未经确认的普通输入，也不自动跳回父会话或转发草稿。
- 真实子任务仍活跃时显示任务状态与人数；已完成、仅 loaded 的实例不显示成“正在运行”。未知数量不显示确定的零。
- 重试只复核当前原 thread。提示样式、位置和窄屏布局保持一致，不能覆盖正文、子任务摘要或发送区域。

真正的 external writer 冲突仍沿用用户显式“重新连接并发送”的交接流程；只读快照不能证明外部 writer 已释放，不据此自动清掉冲突或重发。

## 实施顺序与停止条件

用户已于本轮批准按以下顺序执行。

| 阶段 | 工作 | 通过条件 |
| --- | --- | --- |
| 0：版本与原生兼容关卡 | 记录实际 VSIX/CLI/运行层版本；用匹配 CLI、独立 HOME/数据目录与本地确定性 fixture 验证父 unsubscribe。 | 父+idle 子线程场景能够卸载父并释放 writer；原父/子 UUID、历史和后续恢复仍正确。活跃/待交互/目标/后台命令场景不被本方案卸载；无真实凭证和正式任务参与。 |
| 1：身份及缓存修复 | 先加入下述失败用例，再修关系索引、共同身份判断、缓存迁移和只读复核。 | 主会话误禁消失；真实子权限不扩大；切换/刷新/迟到结果不恢复错误关系，不改变草稿或目标。 |
| 2：安全释放与状态呈现 | 关卡通过后实现家族资源检查、祖先恢复、代次核对与准确提示。 | idle 家族收敛，活动/未知资源受保护，ACK 与卸载确认分离，无关家族不阻塞。 |
| 3：联动验收与启用 | 类型检查、浏览器与内存回归；同步文档；在安全窗口启用运行层。 | 实际运行产物已验证，消息唯一性/审批/历史/草稿正确；正式活跃 Agent 自然完成后再切换。没有安全窗口时交付验证结果并保持旧运行进程。 |

关卡失败，或需要改变原生权限、关闭子任务、抢占 writer、修改 VSIX/用户 Codex 配置时，停止该分支并带证据重新提交 review。前端身份修复可独立验收，不以原生关卡失败为由停住已获批准的独立工作。

## 红绿灯与最小验收

先把当前缺陷改写成断言预期行为的失败用例，再实现转绿；不能把“复现当前坏结果的脚本成功”当成修复测试通过。

| 场景 | 必须检查 |
| --- | --- |
| 子向父发消息、兄弟互发、跨主会话通信、self receiver | 不创建父子伪边；主输入身份、项目及草稿不变化。 |
| 主线程已有错误缓存；收到明确主 source | 自动纠正且不需刷新页面；重开/刷新也不复活伪边。 |
| 创建线索存在但 metadata 缺失/失败；真实子能力 false/null/true | 明确区分待确认与受限；false/null 无 resume/start，true 仍重新校验目标。 |
| 新旧 snapshot/历史/运行 epoch 交错 | 旧响应不能改新身份或开放权限；真实 pending request 身份仍正确。 |
| 父 idle + 已完成但仍 loaded 子线程 | 通过资源与原生关卡后释放父，确认实际 writer 可被另一隔离客户端取得，原历史与子身份保留。 |
| 子/孙仍运行、审批/提问、活动 goal、后台终端、队列 uncertain | 不执行父 unsubscribe；未知信息不解释为空闲。 |
| 中间祖先 unloaded；无关家族环/持续事件 | 活跃孙线程仍受保护；已证明无关的状态不阻塞目标。 |
| 检查各 await 边界新任务/新后代出现 | 本次释放作废，不能释放新运行实例。 |
| ACK、缺 close、卸载超时、迟到 close、释放后重新发送 | 不提前 readonly，不自动重发，旧事件不影响新 generation。 |
| 外部 writer 冲突及队列服务锁冲突 | 分别呈现；拒绝无原生 turn，失败不伪装成已送达。 |
| 切换、刷新、多端及异步返回 | 草稿/附件不串会话；一次提交只有一次接受，恢复不 resume/stop。 |
| 1440px 桌面、375px 手机视口 | 提示不覆盖正文/输入；恢复入口可操作，真实受限子线程状态清楚。 |

最小命令范围：

```sh
pnpm --filter @agent-orchestrator/session-runtime exec tsx --test src/codex/ownership.test.ts src/codex/client.test.ts
pnpm --filter server exec tsx --test --test-concurrency=4 src/routes/session-subagents.test.ts src/services/codex-subagents.test.ts src/routes/session-followups.test.ts src/routes/session-followups.integration.test.ts
pnpm --filter web test:session src/session-mode/features/subagents src/session-mode/components/codex/composer src/session-mode/components/codex/thread/CodexAccessNotice.test.tsx src/session-mode/stores/useCodexAccessStore.test.ts
pnpm check
```

按改动补充公共输入与 identity selector 的测试文件，再加入上述命令。浏览器覆盖 `session-subagents`、`session-ownership`、`session-message-delivery`、`session-failed-delivery`、`session-drafts`、`session-state-recovery`、审批/提问与 `session-idle-memory`；遵守 [内存约定](../session-memory-contract.md)，保留 view=chat 裁剪、事件驱动恢复、不可见正文回收及相同快照不通知。记录传输量、JS 堆和 renderer RSS，不放宽原保护断言。

当前用户入口为 HTTPS `https://10.30.0.24:8484/?mode=session`，前端 `.env` 配置 `WEB_HOST=0.0.0.0`。实施联调使用 `.env` 配置的独立端口、数据目录与局域网地址；不把本机地址写入源码。另一台物理电脑/手机的可达性与操作须独立验收，本轮未验证。

## 修改范围与交付

主要范围：`apps/web/src/session-mode/features/subagents/{store,model,service,hooks}`、主/侧/子输入与访问提示、必要的共享身份归一化、`packages/session-runtime/src/codex/{ownership,client}`，以及对应测试。网关只在实际需要透传稳定原因/身份时修改，不顺带重构发送队列或原生宿主。

实现同步 `docs/session-subagents.md`、`docs/session-ownership.md`、`docs/func_list.md`、`docs/debug_list.md` 与仓库 bug 镜像，以及恢复入口对应的 `docs/project-overview.md`。验收记录区分源码修复、隔离验证与正式运行层是否启用。

本轮原函数复现及审计产物：

- `/tmp/ck-subagent-plan-20261014-root/frontend-probe.cjs`、`frontend-probe-results.json`。
- `/tmp/ck-subagent-plan-20261014-runtime-audit/README.md`、`runtime-fixture.mts`、`runtime-results.json`。
- `/tmp/ck-subagent-plan-20261014-official-audit/`：官方有限摘录、hash 与覆盖说明。

这些临时文件不提交；计划中的源码路径、坏结果和预期测试已在本文记录，后续实施需将验收用例纳入正式测试。
