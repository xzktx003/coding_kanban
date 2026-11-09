# 服务器 SSH 首连桥（2026-11-09）

本轮新增服务器持有的 SSH stdio 连接与私有 UDS 桥，原版 native 负责发送自己的 initialize 与后续 RPC，服务器不编造原生目录、线程或握手结果。8484 已加载 `thread/start`、`thread/resume`、`turn/start` 和绑定活动请求 ID 的 command/file/permission approval 回执白名单；原版 SSH Add 对话框实际显示服务器配置的别名。2026-11-09 重载 gateway 后，隔离浏览器从原版 Codex composer 新建本地会话，以 GPT-6.1 Sol 完成两轮真实文字收发：首轮精确收到 `Live 8484 post-restart real Codex reply.`，同线程追问于 6.6 秒收到 `Follow-up received in the same Codex conversation.`；未使用路由拦截或模拟回复。私有验收回执记录两轮原文。浏览器日志另有 sentry-ipc CSP 错误和 `ws.chatgpt.com` 连接重置；本地两轮仍完成，这不证明后台 websocket 健康。尚未选定或连接真实 SSH 主机，因此远端项目、真实 SSH 审批和远程模型回复仍未验收。

## 唯一所有者与启用

`apps/server/chatgpt-candidate/chatgpt-desktop-candidate.ts` 只有显式 `sshConnections: { runtimeRoot, sshBinary? }` 才启用，并要求现有固定 `sshDiscovery`。candidate 单独持有 `ChatGptSshConnections`、连接 Map、SSH 子进程及 UDS；native/container 仅安装 client，不创建第二 manager。

启用前须有 ready 的完整 profile。宿主只有在 `serverSsh:true` 时才发布可选私有字段 `serverSshSocketPath`，值固定为 bridgeRoot 下的 `server-ssh.sock`，映射到 native 的 `/bridge/server-ssh.sock`。candidate 只读取该字段，缺失明确拒绝启用；禁止从 `controlSocketPath` 父目录推导，control 仍位于独立 state 目录，原 no-overlap 规则保留。SSH 父目录须 owned 0700、全路径无 symlink；尚未创建的 leaf 允许，已存在时必须为 owned 0600 真实 UDS，已有路径不覆盖。profile reader 在前后两次快照核对父目录与可选 socket inode，私有字段纳入 HTTP 资源和 WS 的完整身份比较。管理器绑定初始 profile 全身份与 generation，每次实际写入及回复前重核；换代不改绑、不回退到其他实例。

CLI 仅接受固定服务器环境配置：

```sh
CHATGPT_DESKTOP_SSH_RUNTIME_ROOT=/absolute/private/ssh-runtime
# 可选，默认 /usr/bin/ssh；只接受服务器配置的绝对可执行文件。
CHATGPT_DESKTOP_SSH_BINARY=/absolute/path/to/ssh
```

原 `CHATGPT_DESKTOP_SSH_CONFIG_FILE` 与 `CHATGPT_DESKTOP_SSH_NATIVE_CHUNK_FILE` 仍须显式配置；可选 home 仍走原固定发现适配器。runtimeRoot 须已存在且 owned 0700。禁止 `CHATGPT_DESKTOP_SSH_CONTROL_SOCKET`，路径不由环境或 HTTP 指定；不要另启占用同一 UDS 的 broker。

## 有限协议

HTTP 只保留相同 profile/generation 下的 `GET /api/chatgpt-desktop/:id/:generation/ssh/connections` 和 `POST .../ssh/aliases`（仅 `{aliases: string[]}`）。拒绝 query、未知字段及错误代次。返回 alias、state、opaque connectionId 和固定 reasonCode，绝不返回 socket/config 路径、初始化结果或正文。公开 connect/disconnect 端点不存在；连接只来自原 native 的私有 UDS。

UDS 每行 JSON，控制连接只接一个请求：

```json
{"v":1,"type":"request","id":"<UUID>","profileId":"<UUID>","generation":"<UUID>","method":"save","params":{"aliases":["selected-alias"]}}
```

有限方法为 discover、save、refresh、connect、disconnect、version；version 仅接受已保存 alias，服务器只执行固定 `codex --version`，不接收命令字段。连接 alias 须先保存并仍存在于固定发现结果。选择列表保存在服务器 constructor 固定 runtimeRoot 下的 `selected-aliases.json`，只含 `version:1/profileId/generation/aliases`，最多 32 个 alias、16 KiB；不保存连接 ID、状态、auto-connect、host、identity、凭据或正文。同一 profile/generation 的 candidate 重启只恢复名称并显示 disconnected，必须用户再次点击 Connect；连接时仍核对现有 SSH 发现结果。保存采用 owned 0700 根、owned 0600 无 symlink/单链接普通文件、独占临时文件、fsync/原子 rename。读取采用 no-follow 有界读取并复核 inode；根/文件权限或身份变化、损坏 schema/错误代次均 fail closed，不能以空列表覆盖损坏文件。未保存的新目录允许空列表；同一进程加载后文件被替换/删除也明确拒绝。回复为 `type: reply`，含原请求 id 和 result 或固定错误 code。connect 只返回 `alias/connectionId/state: connecting`，不表示已握手。

RPC 另开同一固定 UDS，以 `type: open` 与该 connectionId 单次 claim；收到 `type: opened` 后，双向帧均为 `{v:1,type:rpc,text:<原 AppServer JSON 文本>}`。服务器将原 text 加换行写到独立 SSH 子进程，原回复按原文返回。成功 initialize 回执实际投递后才变为 connected；兼容原 SDK 不发送 initialized 通知，存在该通知时仍透传。

已准入 initialize、可选 initialized，以及 thread/list、thread/read、thread/turns/list、account/read、model/list、config/read、configRequirements/read。明确写操作仅有 `thread/start`、`thread/resume`、`turn/start`，且必须是带请求 ID 与对象 params 的原生 JSON-RPC request；每帧仍在固定 profile/generation 与 alias 身份下重核并原文转发。依据为仓库提供的 OpenAI Codex Linux extension 26.51021.22027：`third_party/openai.chatgpt-26.51021.22027-linux-x64/extension/out/extension.js` 的 outbound method registry 含这些原生方法，`sendProviderRequest` 以 `{id,method,params}` 组帧；本服务只开放这三个线程基础方法，不开放 fork、queue、steer、工具审批或任意 shell。service 专项测试用该原生 envelope 经真实 UDS→独立假 SSH 逐字核验三种方法的请求/回复，不代表模型输出或真实远端验收。

原 SDK339 的 post-init 还需 `getAuthStatus`：只准入恰好 `{includeToken:false,refreshToken:false}` 两键的请求；索取 token、刷新认证、缺键或额外键均以 `-32601 / SSH_METHOD_UNAVAILABLE` 拒绝，且不写入 SSH。受控假远端回复仅 `{authMethod:null,requiresOpenaiAuth:false}`，不含 authToken。command/file/permission approval 的客户端回执只在服务器先发出的同方法活动请求中匹配 ID 并单次转发；permission grant 限于原请求权限，且只接受原版 UI 可产生的文件权限策略投影（原请求 entries 的保序子集，read/write 置 null），不能添加或扩展权限。其他 approval、未请求或超范围权限修改、thread fork/queue/steer 和未列出的方法均拒绝，未知请求不能静默成功。

## 进程与预算

SSH 使用现有 `ssh-command.ts` 的校验与参数构造：固定 `-F` 配置、选中 alias、`BatchMode=yes`、`StrictHostKeyChecking=yes`、`ControlMaster=no`、`-S none`、关闭转发、TTY 和 LocalCommand，固定远端命令 `exec codex app-server`。不使用 pkill/killall，不复用共享 control master/socket，不安装或升级远端 CLI。服务器 SSH 配置中的 RemoteCommand 冲突按真实 OpenSSH 行为失败，不用 `RemoteCommand=none` 伪装清空。远端 codex 须在该 SSH shell 的 PATH 中。

子进程环境只保留 HOME、PATH、可选 SSH_AUTH_SOCK 与禁用 askpass 的标记，不复制其他服务 secrets。每条连接用新随机私有目录，首因只记固定元数据；HTTP 不转发 stderr。断线只结束本 manager 创建的 SSH 子进程，绝不按 PID 搜索或停止共享 daemon。断线时远端任务最终状态可能未知，客户端不得自动重发；同 connectionId 不二次 attach。

原始 RPC 每帧最多 2 MiB，排队合计 8 MiB/64 帧，计入正在等待实际身份/写入核验的活动帧；UDS 外层行最多 4 MiB+1 KiB。read(n) 每次至多 64 KiB，所有队列保持 FIFO；超限明确关闭，不截断伪装结果。最多 8 个活动连接、64 次创建及 32 个已选 alias。

## 验证及边界

本轮 service 专项覆盖真实 node:net UDS → 独立假 SSH 可执行文件 → initialize/read、thread/start/resume/turn/start 与 command/file/permission approval 请求/回执，另验原文保真、请求 ID、决策范围、原版权限策略投影、单次消费、坏握手、过期身份、重复 claim、消息预算和精确 SSH argv；最新 manager 专项为 25 pass、0 fail。首个 thread/start 红灯记录在 `/tmp/ssh-remote-codex-rpc-first-red.log`；command/file approval 首红在 `/tmp/ssh-approval-roundtrip-first-red-direct.log`；permission 子集首红在 `/tmp/ssh-permission-subset-first-red.log`；绿灯记录分别为 `/tmp/ssh-remote-codex-rpc-full.log`、`/tmp/ssh-approval-roundtrip-full.log` 和 `/tmp/ssh-permission-subset-manager-full.log`。假 SSH 不是实际远端，不能代替真实远端 UI、审批或模型回复验收。

原 native/SDK 适配由另一独立模块保留原 registry/catalog 发布，不以本文件的连接状态代替 UI 可用。它已通过固定原 native 与 SDK 的 initialize→thread/list 假 SSH 组合验证；真实远端账号、原版实际页面和远程任务仍须在用户明确指定的主机验收。

服务端 profile 契约另有 3 项先红后绿：可选字段缺失的旧 profile 兼容、独立 bridge 父/可选 UDS 的 owned 权限与替换拒绝；profile 全文件 18 项及资源/WS 隐私身份 4 项通过。新的无账号真实宿主 profile 已通过共享 reader 只读核验，私有字段与实际 bridge 匹配，public status 不含路径；这仍不是 SSH 主机或远程任务验收。

## 原 WebSocket producer 的版本检查

原 SDK 的完整 `connectAndWaitForOpen` 在 transport open 后、initialize 前还会直接调用 `getInstalledCodexVersion`；只替换 eTi.connect 不足以消除隔离容器的 SSH 版本探针。新宿主适配保留完整原 getter 与 `el.jZe` parser，把精确 `codex_version_probe / codex --version` 经固定 UDS 的 version 控制方法发到同一服务器 owner。native connect 清旧缓存，要求实际 CLI 输出经原 parser 得到非空版本并通过原 `el.dlm` 后才建立 app-server；SDK 后续查询读同次缓存，不再执行容器命令。其他原 remote command 在 serverSsh opt-in 下明确拒绝，未放宽原 allowlist。

探针使用独立自有 SSH 子进程，权限、配置、alias、环境及完整 profile 重核与连接相同。stdout/stderr 各限 4 KiB、10 秒超时；非零或过期身份拒绝，版本未知不跳过兼容检查。它与 app-server 共享八个活动进程/连接和 64 次创建预算，不接管默认 daemon、共享 socket 或已有任务。userAgent 不是 CLI 版本证据，本适配不使用它替代探针。

回归执行固定 c23 原 transport、完整 SDK339 connectAndWaitForOpen/startAppServerProcess/waitForConnectionOpen/listThreads，经真实 UDS 和假 SSH 可执行文件传输：旧码确实记录一次容器 SSH probe，修后只执行服务器固定版本命令，再原文 initialize/thread/list。另覆盖空、非零、不兼容版本、命令字段拒绝，以及默认/共享两份适配输出的固定摘要。静态 REA 对原 transport/SDK 片段保留证据 `ev_eaecdd2a9910573aed0a6a8eacb65ae32b763e549ea7ccb2c27449edb789e7c9`，其动态调用与外部依赖仍有未知，不能代替上述受控运行或真实 SSH/UI 验收。
