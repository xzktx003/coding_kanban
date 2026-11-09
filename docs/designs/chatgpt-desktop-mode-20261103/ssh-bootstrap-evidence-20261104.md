# 原版 SSH 启动的进程影响与隔离阻断研究

本记录依据用户提供的固定 Mac 应用包和对应 Linux 研究包。尚未连接任何真实 SSH 主机，也没有把研究策略接入已运行服务。阻断未接入期间，不能认为当前产品的 SSH 入口已受保护。

## 样本与静态证据

两包 `.vite/build/early-bootstrap-439-a0f25ba32c465de1.js` 成员均为 5,269,629 字节，SHA-256 `c23f63f8ff156b2a92a81ee2870d80ab959ced6ce6232d6fe7e54bbefe11d333`。Mac 成员重新读取时与其 ASAR 文件头的完整性哈希一致。以下为该成员内从零开始的 UTF-8 **字节**偏移，只适用于此哈希：

| 偏移 | 静态发现 |
| --- | --- |
| 4000653 | `eTi` 是标记为 `AppServerTransportSshWebsocket` 的 transport；该结论不覆盖所有可能的远程 transport。 |
| 4010123、4010446 | `ensureRemoteAppServer` 调用 `startRemoteAppServer`。首连在路径和版本探测后，会构造远端启动命令。 |
| 4011239 | 启动命令在远端按当前 UID 和 `codex.*[d]esktop-ssh-websocket-v0.sock` 模式执行 `pkill -9`，之后启动新的 app-server。远端环境变量 `CODEX_SSH_SKIP_APP_SERVER_BOOT=true` 可跳过命令中的这一段，但该环境不构成服务端身份校验。 |
| 4013482 | 另一 `killCodexProcess` 方法构造按当前 UID 和 `codex.* app-server.* --listen` 匹配的 `pkill -9`；它的潜在匹配范围更宽。该成员没有发现对它的直接 `.killCodexProcess(` 调用，实际调用链和触发条件尚未证明。 |
| 2722364 | `codex-app-server-restart` 消息分支将 `killCodexProcess` 参数交给选定 host 的 connection 重启方法。它是否最终调用上述 SSH 方法仍须沿跨模块调用链核实。 |

原 `connect` 的 `hasConnected` 重连分支会先尝试原有路径；这一布尔值不是服务端注册、远端进程/账号身份或活跃任务安全性的证明。网络错误后的回退也不能自动授权重启。

## 隔离策略与证据

[研究策略](../../../packages/chatgpt-desktop-host/src/ssh-bootstrap-policy.cjs)只接受上述完整成员哈希，并检查目标 `eTi` 类和九个方法的唯一锚点。它返回修改后的内存字节，不修改原 ASAR。由于当前没有经过验证的服务端远端身份注册与准入通道，这个版本对该 SSH transport 一律失败关闭，封住连接、回退连接、远端 boot、广义 kill、远端 shell 和 proxy 入口；它没有“环境变量已设置”“旧 socket 存在”或“曾连接”一类放行参数。

[红绿测试](../../../packages/chatgpt-desktop-host/test/ssh-bootstrap-policy.test.mjs)将固定原始 `eTi` 类放进 Node `vm`，用内存记录器代替 SSH/命令执行。原类确实构造两种 `pkill` 命令，并在模拟 `hasConnected=true` 时进入未验证重连；这些命令只作为字符串记录，没有执行。未加入阻断时，测试显示 `connect` 到达了模拟 shell 的副作用；加入策略后，首连、重连以及各单独入口均在任何记录的远端动作之前以 `SSH_REMOTE_UNAVAILABLE` 失败。测试还检查原成员哈希、类之外的原字节不变和修改后的完整成员可编译。

显式提供固定原成员后，3/3 测试通过；未提供时，未知哈希检查通过，2 个依赖原成员的测试明确跳过，不计为验收。独立运行的临时日志在 `/tmp/chatgpt-ssh-policy-trY3pY/`，包括测试前后源码哈希；临时目录不属于持久交付。

```bash
CHATGPT_DESKTOP_SSH_ORIGINAL_CHUNK=/absolute/path/to/early-bootstrap-439-a0f25ba32c465de1.js \
  node --test packages/chatgpt-desktop-host/test/ssh-bootstrap-policy.test.mjs
```

测试不覆盖真实 Electron 的组合启动、原 GUI 提示、远端账号、网络、远端任务或其他 transport。`codex-surface-policy.cjs` 也针对原成员哈希生效。以同一原始字节测试，SSH 策略单独输出哈希为 `3887e5208883b4aba58c1998222d2a6f3c6d4f976f7b302cc37c33e50bcafb8d`，Codex-only 单独输出哈希为 `f8fa2affe8e3ddfc04e36548afb9a7fd9c2bf5c851959904f3231aedfd90815e`；把任一输出直接输入另一策略分别得到 `CODEX_POLICY_DIGEST_MISMATCH` 或 `SSH_POLICY_DIGEST_MISMATCH`。正式接入须从同一固定原始输入设计一次受控组合，锁定最终字节并验证组合后的启动、报错和默认拒绝，不能加入公开的校验跳过开关。

后续要复用既有远端，必须先由可信服务端登记并重新核实目标主机、账号、远端实例及连接代次，在实际发起和重新连接前检查；创建新远端服务则需要单独审计不干扰其他任务的唯一实例方案。上述注册、写前守卫、远端行为验证和最终用户入口均尚未实现，不能靠修改远端环境变量或进程匹配命令冒充完成。

## 2026-11-08 非破坏式连接候选

固定原版 transport 已有新候选策略：保留远端 Codex 路径/版本探测和原 SSH WebSocket proxy；按 SSH alias、目标、端口、用户及 identity 的哈希，使用同一远端 CODEX_HOME 下独立 `kanban-<hash>` socket、日志和 agent-forwarding 路径。不同客户端指向同一 SSH 身份时复用相同 socket；不再运行全 UID `pkill -9`。启动和 proxy 都显式使用该唯一 socket，避免覆盖默认 app-server 或其他连接。原 `killCodexProcess` 重启入口返回 `SSH_REMOTE_RESTART_UNAVAILABLE`；远端任务空闲与实例身份未核实前不停止进程。远程 shell 只准入固定的路径探测、版本探测和当前 transport 自己构造的启动命令。

本地 Codex CLI 帮助确认 `app-server --listen unix://PATH` 与 `app-server proxy --sock PATH` 是支持的参数形态。固定 Mac 原始成员及组合 host policy 的红绿测试 6/6 通过，检查了完整成员摘要、启动命令没有 `pkill/killall`、唯一 socket、shell 语法、重启拒绝及通用 shell 命令拒绝。SSH 策略摘要为 `573716d467b9163ccd891fe86a3bfdd8631ea7ba54ae67faeeb8c6c2a374308f`，组合 host policy 为 `50ed05593cd2edff9ff2ef0e3fc34c33d2be442ecf83e382b88ec6fbd9ae363f`。

这是候选源码验证，未部署到 8484，也未打开真实 SSH 连接。8484 的 SSH discovery 仍返回 `SSH_DISCOVERY_UNCONFIGURED`；固定原包的真实远端 UI、目标别名授权、首连/自动恢复边界、远端线程读取和跨客户端任务共享仍待验收。旧 profile 和当前 native 均未重启。


## 2026-11-08 transport 身份与服务器首连边界

2026-11-07 的目标字段哈希会让同目标的两个独立客户端选中相同 socket。这是命名隔离缺陷，不能当作远端进程所有权证明。现在固定原 `eTi` 构造器用原 crypto 模块生成随机 16 bytes，通过不可写属性保存；每个 transport 使用独立 `kanban-<32hex>` 路径，自己的重连继续使用同一路径。新 transport 不恢复旧 transport 的身份；关闭/销毁只结束自有 proxy，不自动停止或回收远端 app-server。远端进程身份和任务空闲尚未验证，不能自动删除旧目录或杀进程。既有禁用 `pkill/killall`、任意 shell 和远端重启的约束保留。

新用例运行固定原 class，仅将远端命令换成内存记录器：同 alias 的两个 transport 产生不同身份、属性不能重写，各自 boot 使用自己的路径，同一个 transport 二次 boot 路径保持不变。旧码在“两个身份不同”处失败，新码转绿。其余原危险命令录制、类外字节不变、完整成员语法、shell 语法与组合摘要一起验证；不执行 SSH、不读取真实配置或密钥、不连接 daemon。SSH 输出摘要 `275c446241ace020d7ec4215017c08970564c5d184d2d1275c504b75adf3a73d`；组合 host 输出 `9714f7b4288b3f1df2654b5d215cbf026c05d7b7530bd86dd9f383f938e5422c`。原归档和原始成员摘要不变。

完整 Add/Connect 还不能安全启用：`browser-ssh-alias-assets.mjs` 只将固定原 Settings 的 `sshConnections.discover()` 接到服务器，原 `save()`/`refresh()` 保持 native 服务。原 native window 服务构造为 `sshConnections:new ewh(...)`，实际 SSH transport 也运行于该隔离宿主；服务端发现 alias 不会把服务器的 SSH 配置、known_hosts 或认证执行域带进宿主。现有 HTTP 路由只有受 profile/generation 约束的 `/ssh/discover`，没有服务端自有连接注册与 proxy 通道。直接放行原 native 连接既不满足“由看板服务器发起”，也不能用原 native catalog 成功代替真实 SSH 握手。

下一步需要固定服务器 alias 的显式 Add/Connect 注册，将原服务实际调用与服务器自有 SSH 子进程/proxy 绑定，保留 host-key 检查和真实握手错误；不得从 HTTP 接受任意 host/path/command，不将私钥或口令送浏览器，不通过共享 socket 或 broad kill 接管其他客户端。当前改动只完成必要的 transport 身份修复，不宣称该连接通道或真实远端任务已验收；运行服务未变。

固定原件来源与 REA 证据：原 native 成员 SHA `c23f63f8ff156b2a92a81ee2870d80ab959ced6ce6232d6fe7e54bbefe11d333`，已有静态注册/入口证据 `ev_80b3412d4212bca60b8da16c45af06d3c414472125fca57001e4b683bdc8a349` 与原 Connections Settings 证据 `ev_893038c4f06a0681e8b8a651c11ab40b71d882757b642dafb91ba59f241639cf`；静态证据不能代替 SSH 运行验收。
