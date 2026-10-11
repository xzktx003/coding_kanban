# 原版 Codex 接口逆向与可行性复评

2026-10-12。使用 [reverse-engineer-anything 技能](/data01/home/huxing/.agents/skills/reverse-engineer-anything/SKILL.md)。本记录修订 [首次评估](native-extension-feasibility.md)，不实施产品迁移。

## 复评结论

**保留官方 VSIX 文件不变，使用真实 VS Code 宿主、独立伴随扩展及版本化本地 IPC 适配器，具有比首次评估更明确的实现基础。** 公共输入框的发送链路不必假设只能由我们另开 App Server 写入；原插件已有 owner/follower 接口，可将操作交给原版会话 owner。

首次评估中的“没有找到公开插件接口”仍成立，但不能推出“没有可调用接口”。本次明确找到私有会话 URI、owner 发现、17 个 follower 请求、原生导航预填及宿主消息/RPC 链路。耦合从官方插件补丁转移到我们维护的私有协议适配器；官方包可独立替换，适配器的兼容工作不会消失。

尚不能承诺公共草稿与附件双向同步、任意网页网格直接承载纯聊天 Webview、同会话在同宿主重复展示或无验证升级。完整原版插件运行、真实 socket 和跨版本兼容仍需隔离原型验收。

## 取证范围与证据等级

固定原包为 `third_party/openai.chatgpt-26.51002.51308-linux-x64/extension`，版本 26.51002.51308；宿主文件 `out/extension.js` 为 2,540,960 bytes，SHA-256 `bc0b44429768ea49c559c6a5524dcd710c500d6193f3bfe62c81cab75c18661c`。

分析和验证产物位于 `.dev-runtime/codex-interface-re/`，该目录为本机忽略产物，不随文档提供可再分发的原插件副本。

- **REA 静态证据**：通过已安装 REA 6.4.0 CLI 执行。当前会话未暴露 REA MCP 工具，doctor 的注册检查正常；没有修改 MCP 配置或安装其他引擎。整宿主字节相同副本的 Evidence 为 `ev_35f718b10e1f49ff02d77355e38d9ab9091d6a4f67756bcf485523a29e12d2d4`。解析成功，但语义分析达到 2 GiB 堆限制，覆盖为 partial；不能用其中未出现的关系证明接口不存在。
- **缩小范围的 REA 证据**：55,969 bytes 的精确宿主声明摘录为 `ev_f5e22b0563a3ecb85022f56b53181ae4abf34b75063cffb1296e71f909dff3fb`；follower 注册/转发三原函数为 `ev_74a32d8dd302474b1e4fd71fae81a9d1efb42bceccfde3f024387ddcaae97f09`；Webview 消息、预填及 owner dispatch 三原函数为 `ev_25e701bd2f19292beb8e4a9b8eac0bb526d7e8cafdfe9f6cdb913dadffd890ee`。这些摘录的应用图覆盖 complete，语义覆盖 unknown；均是限定范围，外部依赖、初始化和整个插件运行未被证明。
- **补充静态证据**：两份调查报告 `host-routing-findings.md`、`webview-findings.md`；`host-routing-static-evidence.json`、`webview-functions.json` 保存函数、原文件摘要和 UTF-8/UTF-16 范围。这些普通工具提取的记录不是 REA Evidence。
- **函数级行为证据**：执行原包精确摘录的方法，依赖使用模拟 VS Code、IPC、composer 或 owner 服务。`native-panel-probe.json` 5项、`native-follower-probe.json` 5项、`native-webview-probe.json` 10项断言组通过。这证明被提取函数的相关分支行为，不能替代完整原生 UI/模型/上传链路验收。原函数范围与摘要随结果保存。

没有启动原插件实例、连接用户现有 IPC socket、读取凭证、发出真实 turn/审批/中断或修改原插件与产品代码。

## 已追踪的接口

| 接口 | 包内实际链路 | 能支持的候选能力 | 边界 |
| --- | --- | --- | --- |
| `chatgpt.newCodexPanel` | command → `createNewPanel` → `vscode.openWith` | 打开原生新会话面板 | 恒定新面板 URI；重复调用未证明独立空面板 |
| `openai-codex://route/local/<conversationId>` | `QN/ZN` → `chatgpt.conversationEditor` → summary/initial route | 外层选择已有会话、安排编辑器列 | 私有 URI；真实宿主及会话归属待验 |
| `thread-owner-discovery` | 本地 IPC → host/thread owner 查询 | 查找原会话 owner、选择目标 client | 必须捕获 hostId、conversationId 和当前 client；不能自己宣称 owner |
| `thread-follower-start-turn` | IPC `U3e/_Vt` → clientCoordination RPC → Webview `HCn` → 原版 `startTurn` | 公共输入框把提交交给原插件 | method version 2；需要准确的 `turnStart` 与 owner；不是完整草稿同步 |
| `thread-follower-steer-turn` | 同上 → 原版 `steerTurn` | 活跃轮次的引导输入 | 保留附件、serviceTier、message identity/context 等字段；不得盲目降级到 start |
| follower history/settings/approval/queue | 同上 → 原版相应处理函数 | 历史观察、设置、审批、队列协作 | 每项有独立身份/轮次/响应语义；队列不等于未发送草稿 |
| `navigate-to-route` 的 state | 原生 router → `Xla/$la` → composer controller | 既有会话文本预填、聚焦候选 | 预填不是发送；onlyIfEmpty、防重复及路由清理必须保留 |
| `composer_prefill` | shared object → `MCa` → 新会话 composer | 新会话草稿/上下文交接候选 | 已有 local conversationId 时不应用，不是通用已有会话入口 |
| `codex-micro-insert-composer-text` | 活动 composer 分发 | 当前输入框插入 | 不按指定 threadId 路由 |
| `mcp-request` / `vscode-capn-rpc-*` | Webview → 原版宿主 → App Server 或独立宿主服务 | 原版 UI 宿主桥 | 不等于全部标准 JSON-RPC 透传；完整替代宿主成本较高 |

### 本地 IPC 的具体契约

原包使用本地 socket 的长度前缀 JSON：4-byte little-endian 长度 + UTF-8 JSON。初始化 request 为 `initialize`，参数包含 `clientType`，返回 `clientId`。Unix 目录/端点实现带当前用户所有权及 0700/0600 权限处理。本次没有读取或连接实际端点；后续需用独立 CLI home/socket，避免构造 client 时启动路由器或处理用户的旧端点。

请求带 `requestId/sourceClientId/method/params/version`，可包含 `hostId/targetClientId/timeoutMs`。targeted 请求仍经过对方 willingness/discovery。注册侧按原 Webview `getThreadRole(...) === 'owner'` 筛选，owner Webview 再执行 `assertThreadFollowerOwner(conversationId)`，回复方法必须相符。`supportsUntrustedAppInput: true` 是 discovery 返回能力字段，不能解释成跳过我们产品的来源、项目和用户授权校验。

除 owner discovery，实际注册的17个 follower 方法为：start-turn、load-complete-history、compact-thread、steer-turn、interrupt-turn、update-thread-settings、update-daybreak、read-model-settings、edit-last-user-turn、command-approval-decision、file-approval-decision、permissions-request-approval-response、submit-user-input、submit-mcp-server-elicitation-response、set-queued-follow-ups-state、remove-queued-message、clear-queued-messages，均带 `thread-follower-` 前缀。

原版本表中 start-turn 为2、interrupt-turn为4（缺少 expectedTurnId 的兼容分支为3）、edit-last-user-turn为2、stream-state-changed为11、read-state-changed为3；指定远程 hostId 的版本处理还有额外分支。不能只写一个通用 version=1 的客户端。审批／中断保留实际 request/turn/owner 身份，不因兼容失败改投其他会话。

`HCn` 的 start 分支接受 `{conversationId, turnStart}` 并调用原版 `startTurn`；steer 分支将 input、restoreMessage、serviceTier、attachments、clientUserMessageId、additionalContext、toolOutput 传给原版 `steerTurn`。这补足了“宿主确实注册”到“原版 Webview 确实处理”的静态链路。函数级模拟证明转发和 guard 顺序；模型执行、resume、回执、附件上传和权限匹配仍未在完整实例验证。

### 草稿与面板的限制

`$la` 的文本预填会检查 `consumeLocationPromptPrefill(key)`，支持 format 和 onlyIfEmpty；后者同时要求没有未发送内容和文本为空。没有设置 onlyIfEmpty 时可能覆盖已有草稿。原版 `Xla` 还观察 `prefillComposerDraft/prefillAddedFiles/prefillCommentAttachments/prefillMcpAppAttachments`；对象结构和上传生命周期没有穷尽，不能仅列字段就宣称附件同步完成。

这些接口未证明可由普通伴随扩展获取另一扩展的 Webview 对象。Webview 接收函数 `B2e` 检查消息 origin；外层跨 origin 普通 postMessage 不能直接利用上述预填。真实宿主/预载桥可以承接协议，标准伴随扩展是否有可用投递路径仍需验证。公共输入先以本项目逐会话草稿为唯一权威，通过 follower 提交，是比同时编辑两份原生草稿更小的候选范围。

原插件注册 `supportsMultipleEditorsPerDocument:false`。多条不同 thread URI 有多面板基础，但同一会话在同宿主创建两个独立编辑器不能直接承诺。每 Webview 有独立 RPC session 与 IPC client，同一次扩展激活共享 App Server。关闭回调的已检查范围没有 turn interruption；关闭 owner 后 follower 可用性仍需实测。隐藏保留上下文不等于后台内存低。

## 建议架构与升级策略

优先验证 **原版插件 + 真实宿主 + 伴随扩展 + 版本化 follower IPC 适配器**。项目、窗口组、关注集合和公共输入草稿仍由本项目管理；原生聊天和执行由原插件负责。外层通过发现真实 owner 协作，不再让两个 App Server 同时争用同一会话写入权。

桌面先使用真实宿主的原生编辑器分栏；网页外层网格可选择完整工作台容器，但需测资源成本。拆出纯聊天 Webview 要额外维护宿主资源、CSP、持久状态、chunked messages、Cap'n RPC、fetch/clipboard/文件服务等，不是仅增加 IPC 即可完成。修改可由我们维护的宿主层承担，官方插件文件仍可保持不变；这属于比标准伴随扩展更大的候选方案。

按 VSIX／host digest 保存兼容描述，包括 URI、IPC method versions、请求/响应 schema、身份和能力。未知版本先拒绝执行型调用并提示兼容状态；新窗口验证通过后采用新组合，不热替换活跃会话 owner。回退不能停止现有 Agent。

本机已安装扩展 manifest 版本26.1002.51308，但其宿主文件摘要与固定参考包完全相同。因此本次对该文件的重复观察**不能作为独立跨版本兼容证据**。还需另一个宿主／Webview实现确实不同的官方版本做相同验收。

## 下一轮最小验收

1. 独立宿主、独立项目/CLI home/用户和扩展目录，安装未修改官方包。前端端口来自配置、绑定0.0.0.0并记录实际局域网URL；正式窗口和Agent保持原样。
2. 用两个不同真实 thread URI 打开原面板；验证项目、输入目标、隐藏/关闭、恢复和 owner/follower 发现。此时不发模型请求。
3. 仅通过隔离 IPC 做 owner discovery／只读设置与状态；保存字段结构和method versions，不记录凭证、私人正文或将完整工具输出送入网页。history/follower snapshot 接入仍遵守 view=chat 裁剪和正文回收边界。
4. 用专用测试会话验证公共输入、附件、队列、审批、回执及失败恢复；保留原生 owner 身份，禁止盲重试/双写和隐式停止。
5. 使用不同实现摘要的官方版本重复以上契约；验证源包字节不变、适配器可独立升级以及版本不兼容时正确拒绝。
6. 对实际多面板记录 JS 堆和renderer RSS、切换耗时、后台传输；手机软键盘和触控另验。

本次接口调查和复评已完成；完整迁移、真实原版双面板和升级验收未完成，不以函数模拟或静态工具输出替代。
