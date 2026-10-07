# Codex 结构化问题与协议功能审计

2026-10-07。会话模式网页入口：当前联调环境 `https://10.30.0.24:8484`（HTTPS、8484，前端绑定 `0.0.0.0`）；部署地址仍由 `.env` 决定。

## 实现范围和使用方法

Codex 发出 `item/tool/requestUserInput` 后，通过运行层的 `codex/request-user-input` 事件，在对应会话中显示问题表单。普通 Markdown 列表仍按文字展示，没有可靠的问题 ID、答案约束或待响应 RPC，不能猜测为表单。

表单逐题展示编号选项、说明和当前题数，支持上一题、下一步。选项不预选，选中或切换题目均不提交。协议允许 `isOther` 时提供自行填写，`options: null` 时直接输入，`isSecret` 时使用密码输入。跳过此题保留明确的空答案数组，最后仍需点击“提交回答”。关闭图标仅收起，按钮“继续回答”可以恢复。

答案严格按 `question.id` 发送 `{ answers: { [id]: { answers: string[] } } }` 到原始请求 ID；不调用 `turn/start`，不发送“实施计划”，不修改协作模式或权限。失败显示错误并保留草稿，同一请求在本设备提交时合并重复操作。

草稿按 thread、请求 ID（区分数字和字符串）、turn、item 隔离，切换会话或布局保留，但只驻留内存；浏览器刷新后需要重新填写。秘密答案不会写入 localStorage/sessionStorage。请求完成/取消/超时、对应 turn 完成、thread 关闭/删除后清理。`serverRequest/resolved` 同时清理命令/文件审批、MCP 表单和权限审批，另一设备回答后当前界面退出等待。

本机 `codex-cli 0.159.2` 的 `default_mode_request_user_input` 原本关闭。本项目在 thread/start 和 thread/resume 的 config 中加入 `features.default_mode_request_user_input: true`，仅影响新建/冷加载的会话，不写全局 CLI 配置，显式 resume overrides 仍保留。已经加载运行中的线程 rejoin 不能靠 resume config 热改 feature；这类旧会话可选择规划模式提问，或在下一次正常恢复后获得默认模式提问能力。能力暴露并不强制模型每次提问。

选择规划模式后，每次实际 `turn/start` 传递正式 `collaborationMode` 字段；原有把 `collaboration_mode` 写进 `thread/start.config` 的方式已移除。默认模式也明确传递（模型已选定时），允许已有规划会话返回默认模式。是否调用结构化提问工具取决于当前 Codex 版本、模式、能力及模型行为，UI 不会把一次普通文字回复变成工具请求。

## 刷新和重连

运行层 EventHub 为尚未结束的结构化问题维护独立内存集合，不依赖 2048 条最近事件缓冲。SSE/WS 连接在同一锁内取得 replay、pending snapshot 和后续订阅；先发送 replay，再发送 `codex/user-input-snapshot`，payload 为 `{ requests: [...] }`。snapshot 使用当前事件游标，可能与 replay 最后一条共享序号，网页按对账事件处理，不把它误判为重复消息。

新浏览器/刷新时恢复仍有效的问题；断线重连时空 snapshot 清除已回答或失效的问题。运行服务实例变化时先清理旧请求，防止向新实例提交旧 RPC。这里保留的是运行中的请求，不能在 Rust/app-server 已退出后把旧请求重新变为有效请求，也不属于项目/关注标签的磁盘记录。

**当前运行实例按用户要求保留。前端表单、逐题操作和 resolved 清理可通过前端更新使用；pending snapshot 的刷新恢复需要下一次项目重启加载新运行层二进制。已构建新二进制，但没有主动重启生产运行层。**

## Codex 功能遗漏审计

检查范围：当前仓库生成的 `ServerRequest`、`ServerNotification`、`ThreadItem`，Rust server request 分发，网页事件桥、通知处理、事件渲染和服务调用；不等同于官方 App 的所有商业产品功能测试。

| 能力 | 当前结论 | 本次处理 / 剩余边界 |
| --- | --- | --- |
| 原生问题表单 | 原来有接线，但交互和语义不完整，默认模式工具未启用 | 本次为新建/冷恢复会话启用默认模式提问，修复逐题选择、自由输入、跳过、明确提交、失败重试、敏感输入、草稿隔离和去重 |
| 规划模式影响实际发送 | 原来字段放置错误，已有线程的模式切换未发送 | 本次改为正式 `turn/start.collaborationMode` |
| 问题刷新/新设备恢复 | 原来首次 SSE 只接收新事件，pending 丢失 | 本次独立 pending snapshot，需更新运行层实例 |
| 请求已处理事件 | 原来明确忽略 `serverRequest/resolved` | 本次清理问题、命令/文件审批、MCP 和权限审批 |
| 命令/文件审批 UI | 已有 `ApprovalItem` 和响应接口 | 刷新恢复仍缺独立 pending 集合；现有按钮没有全面映射 `availableDecisions`、网络审批专用文案，需后续补齐 |
| MCP 表单/URL 和权限审批 | 已有表单及响应链路，Rust 转发 | 同样缺刷新时 pending 恢复；表单错误反馈/字段约束/输入隔离应继续审计；未启用 `openai/form` 能力 |
| 非阻塞问题 / 自动超时 | 类型包含 `autoResolutionMs`，可接收并手动回答 | 本次没有自动选择答案或自动授权；服务端 resolved 到达后清理。未实现客户端倒计时和自动空答 |
| 已提交问题的历史摘要 | 原 RPC 回复会继续原会话 | 当前 UI 未提供独立可持久恢复的问题/答案摘要，不应宣称完整问卷历史 |
| 动态工具 `item/tool/call` | 生成类型有，Rust 分发未处理 | 没有注册客户端动态工具的完整执行回传链路；不能静默把请求当成功 |
| 外部 ChatGPT Token 刷新 | `account/chatgptAuthTokens/refresh` 未处理 | 当前主要使用 CLI 原生登录；不是已完成的外部令牌托管流程 |
| 证明 / 当前时间 / 旧审批 RPC | `attestation/generate`、`currentTime/read`、旧 `applyPatchApproval`/`execCommandApproval` 未分发 | 证明能力初始化已明确关闭；当前时间和旧协议若由服务端请求则没有回应，属于版本兼容缺口 |
| 图片生成、查看图片、搜索、子 Agent 活动 | ThreadItem 含这些类型，部分进入 JSON 折叠回退 | 有数据回退不等于完整专用 UI；需要单独的图片/搜索结果展示设计 |
| 全局警告和新通知 | 无 threadId 的很多事件不会进入 thread 事件渲染 | 未完整呈现 hook、guardian/config/deprecation 警告、环境/remote-control/realtime 等能力；实时音频/语音问卷未实现 |
| 推理正文 | Rust 主动过滤 reasoning | 现有设计策略，不作为本次丢消息 bug |

后续建议优先：其余审批请求刷新恢复及精确决策 UI；已回答问题历史；新 ThreadItem 专用展示。动态工具、外部登录托管和实时语音属于新增能力，需要另行定义范围，不能因为生成了类型就认为已经支持。

协议依据：[官方 App Server 文档](https://developers.openai.com/codex/app-server/)、[Codex request_user_input 源码](https://github.com/openai/codex/blob/main/codex-rs/core/src/tools/handlers/request_user_input.rs)。正式问题与普通文字分开，遵循 JSON-RPC 响应及 `serverRequest/resolved` 生命周期。

## 红绿灯验证

- `RequestUserInputItem.test.tsx`：先复现 5 个失败，再通过逐题/提交、隔离/收起、自填/跳过/重试、去重/ID、秘密输入；补充键盘和协议限制用例。
- `codexService.test.ts`：实际 turn 缺 collaborationMode 的失败用例，再修复既有会话模式切换及新建/恢复时的会话级提问 feature。
- `serverRequests.test.ts` / `eventStream.test.ts`：所有交互请求 resolved 清理、同序号 snapshot 仍被处理。
- Rust EventHub：待答请求被大量输出挤出 replay 后，新浏览器仍恢复；resolved/完成清理及 namespace；WS 实际重连确认 replay + snapshot + 新事件。
- `tests/e2e/session-user-input.spec.ts`：局域网前端，隔离 API/SSE，375px 和 1440px、两个浏览器设备，刷新、选择、回退、自填、失败重试和远端清理；截图 `.dev-runtime/user-input-375.png` / `user-input-1440.png`。
- 此浏览器测试使用合成协议事件及隔离响应接口，没有向用户真实会话提交答案，也未重启真实 Agent。Rust 传输层另行使用临时端口验证。

本次验证结果：32 个相关前端单测、43 个运行层 web 库测试、2 个手机/桌面双设备浏览器用例通过，`pnpm check` 与 `pnpm session:build` 通过。本机隔离 Codex app-server 的 thread/start 已接受默认提问 feature override；没有发起模型生成。空的新线程尚无 rollout，不能把它当已落盘会话测试 resume，resume 配置覆盖通过前端协议测试验证。
