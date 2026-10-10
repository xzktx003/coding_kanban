# Codex 原生只读配置与历史搜索适配

本适配只开放三个固定 native method，不接受 RPC 名称、原生浏览器路径或写入参数。路由复用运行层现有设备认证；Node 网关沿用 `/api/session/api/codex/...` 转发。产品局域网入口为 `https://10.30.0.24:8484`（HTTPS），这不是源码中的固定端口配置。

当前启用状态（2026-10-10 15:17 +08）：新版Rust已正式启用，PID79218，运行文件与磁盘构建一致。正式config/read、config/requirements/read、model/list、thread/loaded/list均HTTP200，健康声明codexAccountMutationsV1:true。本文下方“正式服务待启用”为此前隔离验收时的历史状态；账号取消/退出的真实动作仍未作为部署测试执行。历史搜索仍受原生CLI支持限制，云入口和API保留原实现。

| REST（POST） | native method | 请求与返回边界 |
|---|---|---|
| `/api/codex/config/read` | `config/read` | 仅 `{}`；运行层固定 `includeLayers:false`。返回 `{config:{approvals_reviewer,approval_policy,sandbox_mode,permissions}}`，未知或未提供值保持 `null` |
| `/api/codex/config/requirements/read` | `configRequirements/read` | 仅 `{}`；native 无参数。返回 `requirements:null`，或只含 allowedApprovalPolicies、allowedApprovalsReviewers、allowedSandboxModes、allowedPermissionProfiles、defaultPermissions |
| `/api/codex/thread/search-occurrences` | `thread/searchOccurrences` | `{threadId,searchTerm,cursor?,limit?}`；limit 整数 1–250，opaque cursor 保持原样；返回 native `{data:[{turnId,itemId,snippet,snippetMatchRange:{start,end},turnCursor}],nextCursor}`，范围为 UTF-16 code units |

配置接口是**全局默认值**读取，不带 cwd，因此不能证明另一项目或捕获线程的审批策略，不能以 enum 存在或 `allowedApprovalsReviewers:null` 自动启用 reviewer。没有读取或回传 origins、layers、provider credentials、instructions、网络代理、配置文件路径。权限 profile 名称只保留有界的普通名称。前端 `nativeConfigCapabilities.ts` 提供类型化只读调用，未将全局值写入 Agent 配置。

搜索参数只接受所列字段：threadId 最多 512 字节，searchTerm 最多 8192 字节，cursor 最多 65536 字节，不接受 NUL；threadId 不接受控制字符。该接口不调用 resume/start、不订阅线程、不获得输入权或 writer lock。无效参数返回 400；原生 `-32601`，或旧协议 `-32600` 明确 unknown variant/method 且指向白名单 method，返回 501，且不自动重试或改用其他操作。其他原生错误保留失败状态。前端只对明确的不支持响应使用现有已加载历史搜索，不能把业务错误称作不支持。

## 验证与启用状态

`review-readonly-rust-red.log` 记录未实现行为的 6 个失败；`review-readonly-rust-green.log` 7/7 通过；旧版本拒绝映射补充红绿灯后共 8 个新用例。`review-readonly-rust-lib-final-v2.log` 完整 Rust web lib 54/54 通过；`review-readonly-rust-check-final-v2.log` / build-final-v2.log 成功。最后 `review-readonly-web-types-v2.log` 无错误，退出 0。测试覆盖固定 method、禁止路径/任意 RPC、私有字段裁剪、未知值保持 null、granular policy 有界投影、Unicode / cursor / actual identity 透传和无重试。

忽略目录 `.dev-runtime/session-render-alignment/review/readonly-native-http-proof.py` 构建合成配置、合成 rollout 与独立应用数据，启动新二进制到自动分配的私有 loopback 端口，只关闭本脚本自己的进程组。两个实际 CLI 均已验证：已安装 `0.161.0` 和 VSIX `0.162.0-alpha.2` 的 config/read 与 configRequirements/read 返回 200；路径/任意 method/超限请求返回 400；loaded threads、rollout 字节、writer locks 与四个预先存在的 runtime PID 不变。

**这两个 CLI 的 `thread/searchOccurrences` 都实际返回 `-32601` “not supported yet”，适配器返回 501。** 因此没有成功的实际 native 搜索命中/历史 hydration 证据，UTF-16 与 hit identity 成功路径由定向适配测试覆盖。不能从已生成 SDK 类型推断二进制已实现。早期 fixture 列表为空和随后 native unsupported 的失败回执保留，后续有效 gate 是配置读取、参数拒绝、确定的不支持映射与隔离行为。

实际回执为 `review-readonly-native-http-receipt-0.161.0.json` 与 `review-readonly-native-http-receipt-0.162.0-alpha.2.json`。**正式运行层未重启或替换，正式路由启用仍待授权安全窗口**；当前正式二进制没有这些新增 REST 适配，前端应如实处理缺失或不支持。

## 显式账号动作的独立边界

新增 POST `/api/codex/account/login/cancel` 接收 `{loginId,runtimeInstance}`；只取消捕获的原生登录请求，strip guard 后发送 native `{loginId}`，原样区分 `canceled` / `notFound`。POST `/api/codex/account/logout` 接收 `{runtimeInstance,expectedAccount}`。退出是用户确认的全局当前账号动作；执行前用 native `account/read` `{refreshToken:false}` 对比最小公开 Account 快照，strip guard 后只发送 native `account/logout` 无参数。

公开快照限于 apiKey `{type}`、ChatGPT `{type,email,planType}` 或 Bedrock `{type,usesCodexManagedCredentials}`。这只是检测页面状态过期，**不把邮箱当作账号 ID 或安全权威，不读取私有 auth/token 文件**。未知/null 当前账号、公开快照不一致或 runtimeInstance 改变时返回 409，绝不发送账号 mutation；私有/多余字段或缺失 scope 返回 400；回执不明返回 502，不自动重试；native method not found 返回 501。

新编译运行层的 `/health.capabilities.codexAccountMutationsV1:true` 只表示受限 REST 适配已部署。`/health.instance` 与 mutation guard 共用同一 runtime_instance helper；未提供有效实例即不能发起动作。正式旧二进制没有 flag，前端取消/退出入口必须保持 unavailable；不能以 mutation 请求作为能力探测。公开快照相等不保证原生提供条件式/原子账号 logout，原生协议只有当前账号退出；UI 必须明确其全局范围。

定向注入 request 测试从缺失契约/缺失 guard 的失败证据转绿，10 个 auth 用例覆盖捕获登录 ID、400/409、null/错误公开快照、只读 recheck→无参数 logout、未知回执和不重试。`review-account-auth-green.log` 完整 Rust web lib 64/64；check/build 通过。`review-account-auth-http-receipt.json` 是新二进制独立目录的实际 200 health capability、400/409 拒绝证据，仅实际调用 readonly account/read；runtime log 中 native cancel/logout RPC 均为 **0**，不进行真实账号取消或退出验收。正式运行层 PID 不变，正式启用仍待授权安全窗口。
