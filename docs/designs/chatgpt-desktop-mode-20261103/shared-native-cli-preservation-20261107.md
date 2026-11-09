# 共享 CLI 原配置保留证明（2026-11-07）

第四 ChatGPT 模式可以由服务端显式选择 `executionDomainPolicy: 'preserve-native-cli'` 和 `nativeAppTools: false`。入口为 `createOwnedSharedDesktopSourceFactory`，固定正式 daemon 身份、账号目录、CLI 版本和项目列表；此策略拒绝额外的 `verifyExecutionDomainSync` 回调，也拒绝注入 Desktop App Tools。它不自动启用，不改变已上线 HTTPS 8484 的原生实例。

## 证明范围

生产 observer 在已验证的同一 daemon 上执行 `config/read({cwd,includeLayers:true})` 和 `configRequirements/read(null)`。完整原生 JSON（包含未枚举字段、所有层、来源和 requirements）参与有界摘要；两次原生读取必须相同。原生声明的文件层保持 FD、设备/inode、权限、大小、修改时间与内容摘要；同步写前重查文件身份，项目各级新增 `.codex/config.toml` 也使证明失效。项目必须是同一路径、当前用户拥有、非 world-writable 的真实目录，允许 0775。原始配置与 MCP token/header 不写到报告中。

最低支持契约限定原 CLI 0.166.0、`requirements:null`，以及可核实的 file/project/sessionFlags 配置层；非文件的企业/MDM 层和未证明的 requirements 明确拒绝。此证据是 native 返回的项目配置快照，**不代表已知加载线程的完整 policy/MCP 配置**。`config/read` 参数不含 threadId，`thread/read` 也不提供完整线程审批、沙箱或 MCP 策略。

用户明确点击的现有线程仍绑定原来的 host/runtime/daemon/account/project/thread/view/client 八字段。最后同步写入检查仅消费一次原版最小 `thread/resume({threadId,excludeTurns:true})`，不夹带模型、权限、MCP 或启动配置。原生成功回执必须与绑定的 thread UUID、顶层与线程 cwd 一致；原生实际 policy/完整回执摘要形成连接后证明。原生错误原样保留，不形成成功证明；不明确回执不得重发。现有真实分页、空 turns 与原始 cursor 检查保持。

## 已验证与边界

文件变更、完整 JSON 未知字段变化、缺失配置新建、未证明的托管层、跨 cwd 回执、账号代次改变、重复 resume 及 App Tools 混用均有红绿灯；既有 source/authority/gate 行为回归和声明检查通过。这些检查不等于真实账号 SDK 收发成功。

真实配置/文件撤销已用同一版本独立 CLI 验证：原项目配置改变或新建项目 `.codex/config.toml` 均使证明失效。实际授权默认 daemon 的本线程只读 `thread/turns/list` 已返回 `itemsView:notLoaded` 与两个原生 cursor，不能把空线程反例推断为生产分页整体不支持。

真实独立无登录 CLI 0.166.0（SHA `b8a11fedf24b2dfb59a70c9e52b030f9a508dcd49cd2dd0d41956f4c785156b8`）已给出重要反例：自有空线程为默认 paginated，原生 rollout 确已落盘，另一个客户端的精确最小 resume 返回 `-32601: list_turns is not supported yet`。不修改请求参数、回执 cursor 或 historyMode 来绕过；legacy 对照与真实账号/原版 SDK 集成另列验收，不因这份组件实现而宣称共享发送已上线。无模型、turn 或真实用户任务被用于该空线程反例。

必要测试：`node --test packages/chatgpt-desktop-host/test/shared-execution-domain-proof.test.mjs packages/chatgpt-desktop-host/test/shared-preserve-native-factory.test.mjs packages/chatgpt-desktop-host/test/shared-daemon-rpc-gate.test.mjs`。真实配置/文件和双客户端脚本使用全新 owned 0700 HOME、项目和 Unix socket；不得连接默认 IPC、读取原登录、升级或重启共享 daemon。

## 创建线程的独立回执证明

原生空线程在首轮落盘前，另一客户端的最小 resume 可能返回 `no rollout found`。新建路径因此保持原创建 desktop socket，不能自动 resume 或把 ThreadStartResponse 伪装为分页 resume。`provider.resolveCreatedBinding({hostId,threadId,viewId,projectId}, receipt)` 只接收独立 creation authority 从实际 socket 响应铸造的一次性服务器品牌；真实同 daemon 线程 metadata 与配置双读完成后，才同步复核创建手势 deadline/signal/owned view 并消费品牌。结果另记 `policyOrigin: native-start-response` 与明确编码的原回执摘要。JSON 仿制品牌、已消费品牌和异步读取期间撤销的视图都拒绝。

此方法本身不开放 thread/start/turn/start；完整创建手势、原 SDK 与同 writer 首轮仍需单独接线及真实模型验收。失败时保留已创建的原生 UUID，不重发 start，也不以新回执补造旧历史或 cursor。

实际默认 daemon 集成进度：账号观察与本线程真实分页只读均通过；原 SDK 已获得真实 initialize 回执并进入 connected。真实时间戳与早到首个账号通知的适配已修；后续 SDK 配置读取仍受初始化状态差异阻塞。此状态不计共享新建、模型收发或线上启用通过。
