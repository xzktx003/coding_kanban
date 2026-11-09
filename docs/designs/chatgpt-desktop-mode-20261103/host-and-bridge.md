# 第四模式的私有宿主与浏览器桥接

本协议是自有适配层，不是 OpenAI 公开 API。原始 Mac/Linux 包固定身份见[运行审计](linux-runtime-audit.md)，实际验收及未完成范围见[实施进度](implementation-progress.md)。普通 `pnpm dev` 不启动原生进程；HTTP 也不接受启动命令、socket 路径或任意上游 URL。

## 连接和身份

服务端只读取启动时捕获的 `CHATGPT_DESKTOP_PROFILE_FILE`。profile 为规范绝对路径、本人拥有的 0600 普通文件，直接父目录 0700，不允许 symlink。完整 v1 字段是：`version,id,generation,pid,startTicks,uid,macAsarPath,macAsarSha256,linuxAsarPath,linuxAsarSha256,controlSocketPath`。ID 和 generation 为 UUID，进程 start ticks 防止 PID 复用；原包路径/哈希及 socket 的身份也参与变更比较。它是同 UID 私有部署信任边界，不能抵抗恶意同 UID 任意改写或调试。

`GET /api/chatgpt-desktop/status` 仅返回公共身份状态，不泄露路径/进程/账号。ready 表示已核实身份元数据，不代表模型、网络或 broker 健康。未配置 404，不可核实 503；默认入口无副作用。

`/chatgpt-desktop/<profileId>/<generation>/webview/*` 只服务该 profile 的 packed webview 成员。`__host/` 的浏览器入口、桥和 codec 是明确 allowlist 的自有脚本。WebSocket 只接受固定来源和当前 profile/generation，禁止压缩；其处理继承应用认证 hook。Vite 对 `/chatgpt-desktop` 保留 Host、转发 WS，前端联调服务绑定 `0.0.0.0`，具体协议/端口由部署配置给出。

浏览器 scope 还带每个新文档唯一 `viewId`。网关连接私有 Unix broker，hello 比较 profile/generation/管理进程 PID/startTicks；broker 向 native 发 `createView`，只能返回该 view 的 bootstrap。每次真正发送前重验固定身份，失败关闭自己的连接，不改绑另一宿主。

原版前端需要浏览器安全上下文及 `crypto.randomUUID`、`crypto.subtle`。局域网部署使用 HTTPS 和受信任证书；不能把明文 LAN HTTP 的空白页面当网络故障重试。第四模式在读取状态前检查安全上下文，直接打开资源入口也在创建 WS/view 前检查必要能力，缺失时明确提示 HTTPS。浏览器本身认定为安全上下文的 localhost HTTP 可用于本机诊断；不注入 crypto polyfill，不将不安全 origin 配成可信来代替验收。

## 消息层

浏览器与控制端传输版本化结构化值编码。每个业务帧包含 `v:1,scope,seq,type`，seq 为每方向严格连续序号。消息面分为一般 Electron 调用与 AppHost/Git MessagePort：

- `call` 与对应 `return/throw`：仅固定方法白名单，包含一般 view 消息、worker、菜单、ACK 和 fast-mode metrics 等。
- port 打开须先得到回执，再发送该 port 的结构化数据；`portMessage/portClosed`、worker 及 theme/view 消息仅能操作自身 scope 中已注册对象。
- 一般 preload getter 在 bootstrap 中只读提供；凭据不放入 bootstrap。原生无法在浏览器中表达的 File 路径/原生拖拽不伪造成功。
- native 侧创建全新私有 window，并通过原 WindowManager 注册和原 preload 取得真实可信 view；不从已使用的官方 sender 借用 MessagePort。

结构化值保留循环/共享引用、稀疏数组、ArrayBuffer/重叠视图及支持的内建对象。typed array 按 structured clone 的数据语义处理，额外自定义属性被忽略且不执行 getter；普通对象/数组同样忽略 Symbol 自有键且不读 descriptor/getter，Symbol 作为值仍拒绝。普通字符串属性仍拒绝 accessor、危险键及不支持的宿主对象。二进制受字节预算约束，不按每个整数索引计算图节点。Base64 分块以减少转换峰值，不改变协议预算。

每条 wire 编码及解码最多 8 MiB，节点最多 1,000,000、深度最多 128。浏览器最多 64 个 pending RPC、16 个 port；原始不可变端口快照独立固定池最多 1024（含在途），编码 RPC 等待仍最多 256、portPost 在途最多 32。原始快照、传输队列与延迟 native 数据共用 8 MiB 逻辑字节预算，同一快照在编码提升阶段避免重复记账。broker/native 每批最多八帧，未扩大其并发、队列或写前权限。浏览器链路以固定 KBC1/KBA1 消费确认维持八帧背压，ACK 只属于精确 view 的本地传输；部署必须同版，不接受旧协议自动回退。旧线上冻结实例不随源码升级，真实冷启动/续聊与旧 264 边界的替代证据见[本地队列分离验收](browser-queue-separation-20261106.md)。网关每连接 8 MiB 队列、全局 32 MiB；待接收帧每连接 64、全局 256；包括关闭中的连接最多 16。broker 也有独立数量/字节与释放预算，不能用 iframe 隐藏代替回收。

AppHost 的原 MessageChannel 仍由本次私有页面创建，port2 继续经过官方 preload 注册到官方服务；自有 port1 通过固定 `kanban-owned:app-host-port` 页面消息与同名 Electron IPC 移交主进程。主进程核对实际 sender/mainFrame、当前 view、精确 pending openPort ID 和已预留 portId，成功持有端口后才回复 openPort；后续 postMessage 的实际成功或失败直接回报。Git 和普通调用仍走原路径。`native-apphost-ports.cjs` 只管理自己的端点，关闭页面时精确释放，迟到事件不转入新页面；请求、端口和字节预算保持。此路径消除逐条 AppHost 数据绕行渲染器的转发，真实初始化及模型结果单列于核心验收。

native 来源读取遵守 subscriber 返回的写出完成 Promise，固定最多八个未完成后等待，直到 broker 的 Unix 实际写出才继续拉取。broker 的回站完成不能被 `void` 丢弃；关闭时立即释放在等待 guard 的输出完成，避免来源 reader 等待阻塞精确 viewClosed。来源读取块仍最多 64 KiB，broker 队列仍最多 64，字节预算不变。控制客户端仅对 exact 三字段的四种固定 broker error 保留安全码，未知或附带额外字段拒绝；它们与真正 v/scope/seq 不匹配分开，不把错误当作业务回复。

浏览器启动时普通调用和端口消息可能同时达到 64 项。后续请求按原顺序与端口快照共用既有有界等待额度，写前登记且不跳过序号；原在途、端口和字节预算不扩大。未写出的请求超时明确为未发送，写出后结果未知的请求不自动重发。变更只影响新页面，不重启已连接原生实例。

默认固定 control-client 的每次 socket.write 已包含完整 profile 核验，网关因此不再对同一入站帧提前重复读取；其他显式注入的 connector 仍保留网关检查。broker 回站按一次事件轮收集固定最多八帧，每批重新完整核验，随后在无 await 的同步段逐帧写入。期间到达的新消息属于下一批，scope、序号及原 64 项/8 MiB 等预算不变；关闭、撤销或写出错误拒绝未完成结果，不重试。这是有界传输批处理，不合并业务消息，也不提供跨进程原子授权保证。容器的固定文件、目录及 socket 身份在一次核验中并行读取，每次重新读取，不缓存跨请求身份；原进程、tmpfs、项目根及实际 native 写前授权顺序保留。

JSONL 模块为将来的 CLI 适配提供逐条严格 UTF-8 解析，原文保留 ID 表达，单条最多 32 MiB。这个层与浏览器 AppHost 的 8 MiB 是不同协议，不能互相替代或放宽。

## 资源转换

ASAR 整包验证一次后持有 FD，成员发送前后再次核对 FD/路径身份并验成员 SHA-256。仅索引范围内且有摘要的 packed 成员允许读取，link/unpacked/越界/双解码路径拒绝。原始响应租约总计 32 MiB、等待最多 64，直到 finish/close/error 才释放。

入口 HTML 的唯一 module script 被改成自有浏览器入口和固定 JSON manifest；原 root/加载图标保留。入口先取得 bootstrap 并建立桥，再加载原 module；失败显示可手动重载的明确状态，不自动刷新或重发。

桥接失败提示保留外层 `data-error-code`，并仅在首个 bridge 失败时附加固定枚举 `data-bridge-error-code`，用于区分队列、序号、未知回执等原因。只读取错误的自有数据属性并经过明确 allowlist，不保存任意错误文本、对象、参数、账号或路径；普通提示文字及重连行为不变，后续错误不能覆盖首因。

首期 Codex-only 还适配一个精确 Mac 成员 `webview/assets/app-runtime-b179428fcc1e.js`。原 hash `8f01cd3d7abe83168a66a85464bb1502f9f1fd1671da1d7840cdcda172956d2a`，新 hash `0add79691f44702ef8408a02ef3b71337f55320a832e77b43ce924d64ba98be7`；只跳过原 effect 的 Work 自动授权。未知 hash/非唯一 marker 拒绝。原件未改，服务响应是明确修改的字节。

适配器为服务端固定 `{members,adapt}` 描述器，最多 8 个 members，HTTP 不选择函数。转换前限制输入 512 KiB，输出最多 512 KiB（入口 256 KiB）；每项提前预留最大输出 512 KiB，总计 4 MiB，输出在响应结束前计账。保留释放回调并丢弃不再需要的原 Buffer 引用；原始资源预算与适配输出分别计量。同步转换仍有临时字符串和 Buffer 分配，这些限额不等于整个进程 heap/RSS 上限，需实测。

响应 `private, no-store`，适配后重新计算 ETag/Content-Length，`x-original-content-sha256` 标识原内容；条件请求比较新 ETag。发送前发现身份变化时移除内容头并返回固定错误，不发送旧资源。

## 新宿主、阶段限制与关闭

`preparePrivateRuntime` 只准备新私有 runtime/HOME。固定 Linux 原二进制与 ASAR 不改；自有 wrapper ASAR 包含 view 捕获、私有 preload、app 协议和 Codex Work 阶段策略。主 chunk 在内存中作六处限制：拒绝 Work 的 true 授权/启用、直接 start、已启用 restart、clearRegistrations 和 setDisplayName；原有 false 分支不改。`CODEX_TPP_LOCAL_EXECUTOR_ENABLED=1` 在原程序加载前拒绝。固定原 chunk `c23f63f8…` 经 Work 与私有项目信任路由得到 `007f0a85…`，再组合受限 SSH 入口成为 `34ab1b66…`；文件夹选择与两个明确的直传目录分支成为 `3eb5413f…`，最后组合独立验证的动态工具路由为 `a4e946f29cdf8dcbd8f000be2d213c8668439dd4b5e6411273d54ae621264d14`。每阶段核验唯一 marker 及完整 hash，拒绝用已改写字节作为原件。旧 wrapper 不会热更新这些约束。

动态工具初始化保持原请求、回复身份和十秒期限。AppHost 的原 manager 服务按实际私有 sender 绑定，原 manager 调用及其异步 Promise 存续期内，动态工具请求选择同一存活 view；无关原生调用沿用原路由。同一线程的跨 view 并发 resume 被明确拒绝，以避免原 manager 合并请求后借用另一 view 的工具。关闭、退役或失效作用域不回退到任意窗口。此适配不伪造空工具回复，也不授予线程写入权。

`startPrivateDesktopService` 仅显式调用：验证 Mac 整包、准备 runtime、固定 executable/args/环境、等待一次精确 native ready，然后单独核对 child PID/UID/startTicks。profile/hello 绑定管理进程；native 身份只在管理器内部独立核实。继承 NODE_OPTIONS、LD_*、CODEX_HOME、SSH_AUTH_SOCK 等不进入 child，DISPLAY/XAUTHORITY/LANG 和明确 0/1 的 Node 代理开关只能由服务端配置传入。

broker 用唯一短 helper 绑定私有隐藏 Unix socket，并通过 Node IPC 交接监听 FD。发布路径为其硬链接；helper 正常关闭自身监听和隐藏路径后退出，broker 保留 FD。这样 broker 关闭或正常退出不会让 Node 根据旧路径误删替换对象。已发布路径可以留下旧代次记录，后续清理仅由该私有代次所有者显式处理，不能按路径盲删。

profile 也先写 0600 私有临时 inode，再以排他 hard link 发布，禁止覆盖已有记录。撤销写持有的原 FD，不删除可能已被替换的公开路径。发布回执未知按可能已发布处理，保留 native owner；错误可带非枚举 retainedOwner 供调用方继续等待。撤销写失败为 `HOST_REVOCATION_FAILED`，关闭 broker 后仍可重试撤销，不能因此声称旧记录已失效。

hard link 出现与发布器最终核验完成之间存在窗口。首个客户端可以完成只读身份握手，但真正写出要等待同一宿主进入 active；不得提前把 published 置为真。等待沿用 broker 调用方的绝对 `performance.now()` deadline 和 AbortSignal。超时、断线、撤销、关闭会取消等待，迟到发布不再补发。`upstream.explicitDispatch` 的 `onDispatch` 在最终身份/队列检查后、实际 transport write 的同一同步栈调用；预检拒绝不算已写，实际尝试后的未知结果也不重试。清理 view 有独立取消范围，不能因浏览器断开而自动取消其清理请求。

关闭浏览器仅销毁自身 view，需等 `viewClosed`，未确认即未知，不重复投递。关闭服务撤销 profile 并关闭自身 broker/view，保持已发布 native IPC 和进程，不向其发停止信号。未发布失败子进程的精确清理仍需核对 PID/startTicks/UID/父子归属；不按进程组或同 UID 猜测所有权。

独立宿主在异步 profile 核验之后重新核对退役状态：核验开始后 close 撤销记录，迟到的 false 不再把正常退役误判为身份遭替换。普通写入仍被退役状态拒绝，只有已有精确 view 的关闭通道继续；文件、进程和 socket 身份检查保留。该竞态已先红后绿，宿主/控制服务组合 56/56，不涉及停止 native。

原版 Work executor 不能根据 `ready` 或空 SQLite 判断没有任务，其所谓 graceful shutdown 也会终止仍存命令。先前未知在线实例保留原样；新阶段策略仅防止新宿主加入 Work，不是对旧实例的排空协议。

## 显式容器宿主

`startContainerDesktopService` 将同一 profile 发布器和 broker 组合到独立 Linux 容器。`startContainerDesktopUpstream` 提供不发布 profile 的较低层接口。二者均为服务端显式 API；普通启动不调用，不提供 HTTP 启动参数。配置要求固定本地镜像 digest、原包目录、全新私有 runtime/bridge 目录、实际 Docker/Python/Node 路径及 SHA、允许的 CPU 编号。源项目目录可为当前用户的 0775，不为实验修改其权限；固定源码校验后复制到新私有只读 bundle。

容器使用只读 root、cap-drop ALL、no-new-privileges、独立 PID/IPC/cgroup namespace、默认 seccomp，默认 network none、256 个 pids、2 GiB 内存和 256 MiB shared memory。服务端私有配置可显式选择 `memoryLimitMiB:2048/4096/8192` 和 `pidsLimit:256/512`，启动及重连按所选预算严格核对 Docker 配置，不接受 HTTP 参数，不修改存活容器。v10 创建新页面时实际出现 `pids.events max 32`，而内存无 OOM，因此后续新实例显式分配 512 线程预算；真实结果见[核心收发验收](core-live-acceptance-20261105.md)。CPU affinity 明确来自配置；仅 CPU quota 不能阻止原程序按全部可见 CPU 建线程并耗尽 pids。临时目录 noexec，固定原二进制单独只读绑定。`--no-sandbox` 仅存在于已核验外部隔离的容器内；不回退宿主、不改系统 AppArmor/user namespace 策略、不使用 privileged、host PID 或 Docker socket 挂载。

宿主通过固定 Python helper 的公开 SO_PEERCRED 获得对端身份，再核对容器配置、host PID/start ticks/UID、NSpid、cgroup、namespace 和父子关系，之后才能发初始 grant。image ENV 中的 LD_* 等在 entrypoint 执行前清空，Python 使用隔离参数，Node/native 环境单独构建。首次 grant 在写出尝试前即记为 unknown；只有确认回执才改为 written，失去回执不重发并保留可能已启动的 owner。native PID 与管理器 PID 分开监测，传输断开不等于进程退出。

关闭容器服务会撤销 profile、等待自有 view 关闭并断开传输，仍保留 native/container。较低层接口只在自有 views 和发送队列均为空时允许 detach/reconnect，并重验同一实例。只有明确无登录、无任务的自有验收夹具才在收到 viewClosed 后清理固定容器，并额外等待真实 native 退出；在线或未知任务实例不按账本猜测空闲。

显式 `networkMode:'bridge'` 可搭配 `accountSnapshot:{sourceFile,homeRoot}`；默认仍为 none，HTTP 不选择这些参数。源文件/父目录要求 owned 0600/0700，O_NOFOLLOW/FD 身份前后核对且严格限制 256 KiB/fatal UTF-8。仅复制授权 ChatGPT id/access 与必要元数据，refresh 置空；不改原登录、不复制历史或配置偏好。目标为 owned 0700、真正 tmpfs 中的空 HOME，以 held FD 相对路径新建 `.codex/auth.json`，独占写入、不重放。挂载/源/runtime/control 路径拒绝交叠。启动/重连 inspect 精确 Docker 配置、网络与挂载；每次真正写出前复核固定进程/PID namespace/cgroup、文件/目录与 tmpfs HOME 身份，但不重新 inspect 网络、路由或容器 mountinfo。bridge 允许外部及 LAN 出站，不是出站白名单或长期 token 刷新方案；实际账号两轮收发已通过，临时 HOME 的长期历史和登录续期仍未实现。

服务端可显式设置 `connection:{httpProxy?,httpsProxy?,noProxy?}`，仅 bridge 网络允许。值进入 owned 0600 私有 grant，保留其 4096 字节上限，不进入浏览器 profile，不继承任意环境。CLI 使用明确代理环境，Electron 使用对应 Chromium 代理规则；仅 https 配置不推导 http 代理。无账号的固定 Electron `net.fetch` 对照验证了传输机制，不能代替账号授权、Statsig 完成或模型回复。

## 固定项目目录与浏览器选择

`projectRoots` 是服务端启动时固定的最多八个已存在根目录，不接受 HTTP 提供 root 或 mount destination。目录规范、当前用户拥有、非 world-writable，允许 0775；根之间及与账号 HOME/源登录、runtime、bridge、固定工件、工具、profile/control 目录不得交叠。宿主不创建、清空或改权限。原包和部署代码须在实际项目根之外，不能为绑定整仓库放宽保护交叠。

根以同一绝对路径 RW、非递归 bind 进入容器；默认未配置时仍为原六项挂载。Docker inspect 核对完整 Mounts/HostConfig 和 NonRecursive，持有的目录 FD 与经已验证 init PID/startTicks/UID/cgroup/namespace 的 `/proc/<pid>/root` 实际挂载 inode 对照。启动、重连与真正 stdin.write 前核验；耗时后重查原控制 deadline/abort，不续预算。这些是条件核对，不保证之后路径不会变化。退出或失败释放自有 FD，断连保留以便同一实例恢复，不停止任务。

固定数组写入新 wrapper 的私有 config，仍受 16 KiB 上限。浏览器选择器经原 `sendMessageFromView` 通道发送单调 sequence 和可撤销 activation epoch；入口等专门 ACK 后才加载原页面。每次选择、验证、handoff 和最终原生项目操作核同一 view/epoch、部署身份及固定根。隐藏、换代、关闭、120 秒过期或乱序旧回复拒绝；未完成原检查仍计入全局 16 项预算。epoch 只控制本地失效，不能代替账号或任务授权。

目录结果仍走原 XJ 的 `#r9`、原项目管理及同 view 的 Trust。明确的 `t.root` 添加路径和 `t.roots` 更新路径也经过固定根检查；不能据此声称原版全部 AppHost/FS RPC 都被此选择器限制。当前正式 API 和原码隔离回归已通过，真实原生“添加项目→选择→Trust”正在验收。

## 本地输入作用域原型

`createBrowserInputScope` 是本地剪贴板/编辑事务的保护，尚未接入正式文档，也不是 native 写权限。文档 identity 固定 profile/generation/view；只有原 composer 已提交的真实 hostId/conversationId/clientThreadId 可以注册。最多 16 个 owner，只有唯一有效 owner 才返回不透明 token；token 必须保持本实例对象身份，复制、伪造或其他文档不能通过。

原版新聊天允许明确的 `conversationId:null`，但仍要求实际提交的非空 hostId/clientThreadId；缺字段、undefined 或猜造 thread ID 不可作为输入目标。分配到真实 conversation 后，旧新聊天 token 立即撤销。

每次目标更新（包括同值新确认）推进修订；无效更新先撤销旧 token，再报错。多个 owner 同时存在时拒绝编辑，释放后生成新 token；旧 owner 重复 cleanup 不改变后来目标。菜单异步读取剪贴板后必须再次检查 token 及元素/内容/选区，失败不能重发或把结果写入当前另一输入。真实 GI、账号变化与原版编辑器的事务接入仍待动态证明。

## 独立分屏布局状态

`createDesktopPaneLayout` 提供与旧会话/Codex store 分开的纯呈现状态：分屏树、组内标签、当前组/标签和单调修订。支持四边拖入、中心合并/排序、15–85% 调整比例、关闭、聚焦和独立序列化恢复。拆出唯一标签时保留空新聊天组，不复制同一目标；关闭空组折叠树，关闭标签只改变布局。已移除的真实线程由外部已核实集合 reconcile，只删除布局引用，不自动打开未知目标。

快照及嵌套数组只读冻结，相同布局不发布新快照；一次操作超出预算时保留原树、选择和通知状态。持久内容上限 32 KiB、128 个标签、64 组、16 层，恢复拒绝额外字段、重复节点/目标、非法选择和无当前组。目标 key 是来自调用方的稳定呈现标识，不能作为线程身份或写权限；原版已提交的 composer scope 仍独立核实。此模块尚未接入 GI/XI，不代表自由分屏界面或公共输入已经可用。

## 已有线程的明确连接

用户于 2026-11-04 明确批准点击已有线程后按原版连接。策略按只读观察、一次性连接和一次性发送分别授权；连接只发送 `{threadId,excludeTurns:true}`，不带覆盖配置，也不授予 turn/start、queue/start 或审批权限。原版依赖分页历史、turns-list experimental 和 tail hydration；须验证 `historyMode:'paginated'`、空 turns，以及 `itemsBackwardsCursor`/`turnsBackwardsCursor` 两个必有的 nullable string（各最多 4096 字符）。缺失、超限或未知回执撤销意图且不重发。模式切换、刷新、后台恢复不创建连接意图。本地输入 scope 仅保护编辑器，不能作为连接或发送凭证。

私有 alpha/stable 双客户端已观察到：运行中原审批与队列保持，第二客户端最小 resume 后能收到同一审批；原 owner 在第二客户端仍连接时回复审批，两者收到同一 turn 完成。这支持该场景下增加订阅，不支持零副作用。官方 stable 源实现还会更新客户端信息/MCP elicitation 策略，并在特定路径持久化；未知版本或更广状态仍须门控。原版 sidebar 的真实手势到 native 请求的因果接入尚在实现，不能仅靠策略单测接正式 daemon。

## 私有项目信任对话框

原 `projectsManager` 为共享服务，缺少 caller 时会选 focused window 或不可见启动窗口。自有 wrapper 只对已登记私有 view 的原 AppHost projects service 建立 Proxy/AsyncLocalStorage 作用域，原 confirm 选择该 view 的 window；关闭、过期、完成或迟到请求直接拒绝，不回退别的窗口。保留 retired webContents 的 WeakMap 身份，防止迟到服务被当普通非私有调用。固定原模块仍负责对话框与用户决定，未直接设置 trust。启动/deeplink 的配置导入不走该 service，不据本修复声称所有路径均已覆盖。

## 模式激活与本地编辑租约

外层 `DesktopSurface` 给实际同源 iframe 安装只读 bind 入口，并以已提交的 active 状态控制 activation。子入口只在 native bootstrap/profile/generation/view 校验后，针对实际 Window/Document 取得租约；暴露只读 `getSnapshot/isCurrent/subscribe`，不暴露 setter。隐藏、同值新确认、文档替换、连接丢失及关闭同步撤销旧 opaque token，旧文档 cleanup 不能清除新绑定。HMR/切模式保留 iframe，不重启 native。

该租约仅限制自有本地编辑适配，还需要原 composer 已提交身份与自有唯一 footer/pane owner。它不证明原生账号、不授予 RPC/连接/发送权限，也不能用 DOM 可见性替代 pane 所有权。固定 sidecar 与普通桥同样受当前 profile 身份校验；实际 GI/footer 的组合仍在验收。

`browser-surface-controller` 为该组合准备稳定、初始关闭的菜单代理：先装 bridge，再显式初始化已固定的原 capability，最后连接 rich editor/menu；未就绪或失败不回退 native 隐藏菜单。模式租约撤销同步取消本地菜单/富文本工作，重显只重建自有本地对象，不关闭 native。初始化中失联会销毁迟到 capability，不重试。模块导入本身不加载原 bundle；真实宿主组合完成前不在默认文档启用。

native 回站最多保留八个未完成回执；任一回执完成即释放槽位，按原顺序继续读取。失败会唤醒等待中的读取并请求关闭来源，未知结果不重放；队列、字节和身份校验预算不变。该优化尚未部署，不能据此认定 8500 的队列满问题已解决。

网关向浏览器回站时，同样按发送回调逐项释放最多八个槽位；新进入的固定批次仍重新核对 profile，保持次序和失败关闭。隔离原版页面的单次对照未显示启动提速，该实现尚未部署到 8503。

wire 编解码对长字符串使用有界临时缓冲计数，并在 Node 可用时使用原生 Base64；浏览器继续使用可用的原生接口和原 fallback。字节、节点、深度预算及格式校验不变，native 固定源码哈希随实现同步。

浏览器端已验证的 AppHost 数据快照可与固定根帧直接组合，避免发送时再还原和重建整个对象；数据快照仍按原字节占额直至原生回执，接近原节点、深度或字节边界时回退原编解码路径。该改动不减少身份校验，不提前确认或重发消息。

## 共享线程与分屏的显式组合

服务端可选择 v5 文档、`sharedThread: true` 与 `splitPane: true` 资源配方：先固定分屏标记，再等待共享导航的原生生命周期就绪，最后加载原版入口。共享导航仍要求当前租约、明确可信手势和 native 授权；初始化不恢复或发送任务。组合只适配八个固定原包资源，项目创建弹窗保留原版；v1–v4 原配方保持。当前仅完成资源与入口回归，native 共享授权接线和真实组合页面尚未验收，默认入口未启用。

共享 catalog 的取消只清理本代已登记的精确 request/view；页面退休、读取失败或最终 ACK 后的迟到取消可幂等结束。账号撤销使旧取消登记失效，8192 lifetime ID、pending、字节及逐写授权限制保持。协议、红绿反例与真实宿主待验边界见[页面关闭清理](shared-catalog-close-20261107.md)。
