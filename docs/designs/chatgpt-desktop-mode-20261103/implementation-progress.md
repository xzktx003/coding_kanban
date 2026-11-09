# 第四 ChatGPT 模式实施进度

> 最新核心交付：Mac 原版 v2 已通过三轮真实收发（第三轮在关闭重开后续聊），地址为 HTTPS 8512。见 [核心可用交付](core-mac-usable-20261106.md)。下文旧实验失败记录保留为历史证据。


2026-11-06 更新：Mac 原资源 version 2 在 8508 同线程完成两轮真实模型回复，原编辑文档清空、模式切换保留同一 iframe；独立入口认证与重开继续验收。首次 version 4 卡页样本保留 unknown 且未重发；后续成功独立记证，详见[本轮 Mac 验收](mac-core-live-acceptance-20261106.md)。

2026-11-06 已按用户指令接续指定 Harness 会话：以[8507 本轮真实核心交付](core-live-acceptance-20261106.md)为最新状态。官方 Linux 原生 GUI 已完成同线程真实两轮；完整中文长输入和中文续聊已通过；Mac 资源及其余功能的边界单列。下文与[11-05 交接](handoff-20261105.md)是此前阶段记录。

用户已授权方案完成后自主开发并验收。本文件记录真实实现及其验证范围；未接入宿主的基础模块不是可使用的新模式。

## 当前交付范围（2026-11-05）

本轮聚焦第四模式的原版 Codex 新建、真实收发和同会话续聊。默认保持原单窗输入实现，分屏和共享协议扩展暂不接入。当前 LAN 为 `https://10.30.0.26:8484/?mode=chatgpt&view=agent`；已发布授权账号的隔离宿主，从该页面实际点击发送并取得两轮 `gpt-6.1-sol` 回复、上下文连续、清稿与空闲证据，精确原生 CLI 线程也有对应完成回合。

v8 后新页面暴露了合并读取误判，v10 另外记录真实线程上限拒绝；均已保留首因并修复。v14 完成自有 MessagePort 端点和输出背压后，两个页面均可加载，进程随后退出，已提交消息不重发。v15 采用独立服务托管；修复首连请求额度竞争后，新页面真实完成同会话两轮。当前账号与历史使用临时隔离目录，重启后的持久化与共享旧线程尚未通过。最终运行版本与边界以[核心收发验收](core-live-acceptance-20261105.md)为准。

管理员已把临时 inotify 实例上限提高到 512，并已实读确认。浏览器可见 RPC 投影不具备完整 native 覆盖，不能据零计数推导没有任务。失败保留首因，未知提交不重发；已有真实任务和旧 native 实例保留。

## 历史集成记录（2026-11-04，当前结果以上节为准）

用户要求多 Agent 并行，并优先打通原版 Codex 的项目、发送和回复。浏览器入口、原组件作用域、native 路由、账号连接及文件夹选择分工推进；组合验收使用完整冻结快照，避免工作树并行更新造成入口、包导出和服务端白名单错配。

- 正式 v2 入口已接入固定四资源 recipe、可撤销的本地编辑作用域及原版单页 footer 的自动输入目标。保留原版 React、Gac/ProseMirror、原生权限与配置。真实无网 Chromium 的原组件与合成 GI 已通过；这些结果不代表真实 native 发送或自由多会话分屏。
- 显式 `initialMode:'codex'` 只在全新 HOME 写原版 `desktop.conversationDetailMode`，不复制模型或功能偏好。两条真实固定原包准备链与相关 API 共 42 项通过，未据此宣称账号初始化已通过。显式 CLI 的新无账号、断网宿主启停和 status 有独立证据；退役管理器保持 native 存活。
- 真实原 GI 已能输入。一次 Enter 因原 `localConfigPending` 分支留在待提交状态，尚无 `turn/start`。原 PG 会在配置就绪后自动继续提交，因此该样本的发送许可永久撤销，不二次点击或恢复许可；无 native turn 不能当没有待发送。
- 同一样本发现动态工具初始化选中了启动空窗口，原请求最终报 `The Codex app renderer is unavailable`。按真实 AppHost sender 绑定 manager 的修复已进入新 wrapper；固定原包组合、完整 wrapper 和路由共 25/25，原 ROP/订阅链另独立 2/2。实际 GUI 收发仍待新样本，尚不能将此错误认定为本地配置等待的唯一原因。
- 有账号样本仍在加载页。原始日志分别记录 post-login Statsig bootstrap 超时及 CLI 远程插件目录响应解码失败。已确认 Statsig 经原生 AppHost HTTP 服务，浏览器请求计数不能解释其网络；隔离环境丢失源环境代理是具体差异，修复和真实复验仍在进行。
- Wave A 为 80 文件完整快照，常规包测 457 项中 374 通过、83 条显式外部夹具关卡跳过。Wave B1 在其上仅组合动态工具路由，82 文件 manifest SHA `1d0d2733e9570db9d8eb34e1f2e3398d24fadad3c0f7169efce642e758c84535`。不能将跳过或旧快照结果当作新版本完整验收。

上述阶段之后，文件夹选择、activation epoch、两个直接目录分支和固定项目挂载已进入正式容器 API 与 wrapper。Wave C 的最终 native chunk 为 `a4e946f2…`，80 个产品文件 manifest SHA 为 `cacb520e7bb76c679e1d6f6a3f0085c1a3f2995211a50b97ad07d53e9edc2b65`。完整包测 511 项中 439 通过、72 个外部关卡跳过、0 失败；真实固定原件和 wrapper 已显式执行，跳过不计通过。文件夹 epoch/直传目录专项 32/32、前端入口 62/62、服务端资源闭包 34/34、合成 native 的真实 Chromium 组合 1/1。真实原生添加项目正在进行。

动态工具修复在新真实 GI 样本确认：六对请求/响应均对应同一 view，旧 renderer unavailable 报错为零。但样本先建空线程再按已有历史导航，随后 `thread/turns/list` 与 resume 返回 `-32601 / list_turns is not supported yet`。原代码表明未 resumed 会保持模型和权限 loading；不能据此认定 CLI 版本不兼容，首轮尚未落盘本就可能出现该历史错误。下一步按正常 New chat 的实际创建返回绑定首轮，不按 first/latest 预热线程猜目标。

原 New chat 首页的本地 capability 缺口已补齐：原 composer 的明确 new/home/local 作用域接入 GI 共用的唯一输入所有权登记。Wave D 共 81 个产品文件，manifest SHA `5b2a5505f654b994039957071c70ed3ad52090dd0140b01bba5757ebe9eb8a86`；native chunk 沿用 C，四项适配资源数量及原预算不变。固定 Mac 原包的首页组合由 root 独立复验 6/6，真实原首页已取得 capability。当前原版 Send 已进入 new/local 提交链；私有夹具先后因漏算原版消息的精确尾换行、误要求编辑 token 跨正常提交 commit 保持同一而拦下，均未到 native turn。夹具正按点击时捕获的一次提交意图及原 afterCreated 精确线程映射修正，尚未标绿首轮发送。

有账号 D2 使用正式 V2、四资源及真实父页面租约，并将本次 native/browser 分配不同 CPU，仍在初始化时触发 `BRIDGE_QUEUE_FULL`：8 条在途、256 条等待，保留约 731 KiB，未达到 8 MiB。同 scope、请求 ID 及方向序号的有界时间线显示多个链路均有延迟；截断与诊断开销不允许据此确定唯一根因。证据 `.dev-runtime/chatgpt-desktop-core-d2-xybfhB/timing-summary.json`，SHA `cf5feed8b0d7cc0fd4b57d6882ee0e7aab836ae288a983bc5ff899d2959de5b5`。正在并行减少网关及宿主的重复校验开销，保留实际写出前身份/授权校验与原队列、字节、超时预算。

早期 account-core 的 `viewClosedConfirmed` 将 bootstrap 错当关闭证据，该字段撤回为未知；profile revoked、网关关闭与 native 存活分别记录。新夹具只接受精确 scope 在 destroy 之后的关闭回执，独立 HTTPS 验收不由旧字段推断。

固定官方 Linux/Mac 工件已在仓外创建独立 inode 副本并重验三项摘要，不启动 native，后续正式项目挂载不再需要包含私有工件。当前默认 LAN profile 仍未部署，核心真实任务未标绿。

固定项目挂载已有真实技术绿灯：同一 Wave C 正式容器 API 的 network-none 宿主，原 runner 持有的根 FD、宿主目录和精确 init 视角的容器 inode 一致；冻结 helper 的完整 inspect 和 mounted 校验均通过。此前为空的新测试根明确新建 synthetic marker，固定非 Agent Python 读其精确字节并 O_EXCL 写全新 probe，宿主读回后仅删 probe，marker 保留。证据 `/tmp/cgp-6_06ylki/evidence/mount-proof.json`，SHA `e0d4c8b288d79fa9a4c0975d24e915a412f28f939f4760de4d2d3e6e7341b887`。这证明实际 RW 挂载，不能替代原 GUI 添加项目或模型操作。该 C UI 样本确用 V2 与真实父 iframe，最终仍为 `ENTRY_BRIDGE_FAILED`，底层首错未抓到；账号 B2/diag2 则另外存在 legacy V1 fixture 配置错配，其结果不能当 V2 产品链路已验。

Wave E 已冻结为 D 加四项窄修：网关去掉默认固定客户端已有的提前重复 profile 读取；broker 回站最多八帧固定成员批核验；容器独立文件身份 I/O 并行；独立宿主退役竞态修复。81 个产品文件 manifest SHA `8cadbd55d60738016d8527dd982195ce8a6dae77532083fcb992761879761aea`，native chunk 和四项 renderer 资源与 D 相同。宿主相关 103 项中 102 通过、1 项显式 Docker 跳过；root 独立服务端资源/网关/profile 50/50。私有 Unix socket 的合成 80 帧基准在同一 10ms guard、原预算下，核验次数 80→10、约 827–873ms→108–113ms；这不是实际账号吞吐结论。E 正在分别复验原首页首轮和真实账号初始化，未部署默认 LAN profile。

E 真实首页已确认原 Send 会先同步跳到同 client 的 pendingChatStart，再创建线程。旧编辑 pane 因此释放；私有许可已按点击时捕获的一次意图保留 mode/document/native 实例和精确原 client/prompt，并在创建后取原回调返回 ID，未将编辑租约当作持久发送许可。E 本次 before 检查通过，30 秒内仍没有 thread/start，原创建前等待点及错误栈采集缺口正在补齐，首轮尚未通过。E 账号约 29 秒仍报 `ENTRY_BRIDGE_FAILED`，完整首因没有记录；不能把合成吞吐提速认定为解决真实启动。Wave F 仅增加固定首因枚举诊断，81 文件 manifest SHA `6a993695a6c3cd04864480b5f9ac35ba373c3707292034ea69f3483d3eac0b44`；入口/bridge/controller 55/55，root 另独立核对吞吐边界 52/52。

另有环境红灯：原 native 日志实际记录 `inotify_init1` 的 `EMFILE`。只读 KCMP_FILE 去重时可见 119 个独立 inotify 实例，上限 128；自有 21 容器内可核 28 个独立实例，其他进程存在权限缺口，因此全 UID 119 仅为下限，不能还原出错瞬间。普通 FD、watch 数和主机文件表未接近上限。只回收已完整证明无任务的自有夹具，未知账号实例保留；没有改 sysctl/ulimit，临时串行新 native 验收，其余开发仍并行。

## 2026-11-04：第四模式与正式桥接基础

第四模式已有 `mode=chatgpt`、四模式切换、lazy/visited 挂载、独立焦点及正确的未配置/不可用状态。切回已连接模式保留 iframe，避免短暂状态查询卸载原生输入。320px 会话顶栏改为两行，375px 及以上保持单行；手机按钮仍有 44px 触摸区域。未配置时不会自动启动宿主或连接默认 CLI。

`packages/chatgpt-desktop-host` 已包括原包资源读取、有界结构化值编码、浏览器 preload 门面、固定私有 Unix 控制协议、独立 native view、版本固定宿主准备和显式服务管理。服务端资源和 WebSocket 路由已经接入，研究 CDP 不是正式入口。详细消息和生命周期见[宿主与桥接协议](host-and-bridge.md)。

- 原始资源：固定 Mac 整包和每个 packed webview 成员哈希；header/单资源各最多 16 MiB，原始响应租约合计 32 MiB、等待最多 64 项，没有正文缓存。
- 适配资源：入口 HTML 明确改写，另仅对清单内的固定版本 JS 应用补丁。原/新哈希分别记录，响应 ETag 使用新字节。输入/输出各最多 512 KiB，入口输出最多 256 KiB；适配响应预留总计 4 MiB，和原始资源预算分别计量，保留到响应完成或关闭。
- 正式浏览器链路：固定 scope、逐向序号、方法白名单及一次原生 view；每条结构化 wire 最多 8 MiB，64 个待 RPC、16 个 port、8 个并发 portPost、256 个有界等待项，port 快照及发送队列各有 8 MiB 字节预算。断连或未知回执不重发任务。
- 宿主控制：每次实际写出前重新核对固定 profile/进程/代次；销毁 view 等待精确 `viewClosed`。关闭浏览器不停止 native 任务。broker 通过自有短 helper 交接监听 FD，退出不按旧路径删除可能已被替换的 socket。
- 显式服务管理：先核原包，再启动新私有宿主并分别核对管理进程和 native 子进程；仅健康后以 0600 文件发布新 profile。关闭撤销持有 FD 对应的记录、关闭自身 broker/view，保留已发布 native。撤销失败明确返回错误，status 的身份 ready 不能证明 broker 可用。

## 原资源运行证据与限制

无登录、无网络的正式链路已经运行：原始 Mac JS/CSS → 自有浏览器入口/桥 → 正式 WS 网关 → 私有 broker → 新 native view → 原 AppHost。登录页、其他登录方式、API key 表单和取消交互通过，374 个 HTTP 200；294 个 portPost 全部收到回执，结束时 pending 为零、viewClosed 和所属资源正常退出。该次记录有 26 条 Sentry/Statsig/CSP 控制台错误，不能写成完全零错误。证据：`.dev-runtime/chatgpt-browser-chain-20261104-3FEqSH/results9/`。

后续修复大 typed array 的图节点误计，并改用分块 Base64，双向 8 MiB 字节上限保持。相同 1,818,342 字节合成数据在旧 codec 的独立链路先失败、新 codec 在真实 Chromium → AppHost 的只读 services 查询通过；仅覆盖浏览器到 native 的大二进制，不能推广为大二进制双向或账号全功能通过。证据：同目录 `results3/`、`results10/`。

先前账号副本曾显示 Codex、项目和可编辑输入，但 native view 随后关闭；首错和消息类型未被采集，不能把 typed-array 缺陷认定为该次确切首因。原版全局 effect 还会自动启用 Work executor，已有实例任务状态缺少权威清单，因此没有停止、禁用或修改它。

本期只做 Codex，新生成的宿主增加两层阶段限制：浏览器标志在原模块加载前建立，固定 renderer effect 跳过 Work 自动授权；native 独立拒绝 Work 启用、启动、已启用重启、注册清理和重命名。只读状态、账号能力及 Codex 的 SSH/云能力未伪造。旧已生成 wrapper 不会因新源码自动受保护。无网、无登录的新容器到达 native ready，采样时 exec-server 为零；显式 Work env=1 在原程序加载前退出。真实账号、capability 翻转和长期零 worker 尚待新一轮验证。

后续轻量诊断确定了账号链路的另一个实际反例：`sendMessageFromView` 的普通对象带 Symbol 自有键，codec 在仅 18 个节点、374 字节时拒绝；原生 structured clone 会忽略此键。修复只跳过普通对象/数组的 Symbol 键且不读取 descriptor/getter；Symbol 值和危险字符串键仍拒绝，容量不变。Node 26/26 和实际无网 Chromium 对照通过，codec 新 SHA 为 `2e225a24ad2c056e23b9a031afa88886662a109bc16d6fc5e7fac574a9d0e0d3`。

新正式账号链路已通过只读范围：Mac Codex、新聊天、项目导航、一个可编辑框、10 项模型菜单及当前选择，configured/effective 均为 STEPS_COMMANDS（夹具启动前在新私有 HOME 明确配置此值，不能据此称原版默认值）；同一 services 在界面前后读取 Work 为 disabled/false/null，526 次进程采样未见 exec-server。21 项正式源前后 hash 一致，未替换 browser bridge/codec；销毁 view、broker 与 native 退出有回执。证据 `.dev-runtime/chatgpt-codex-symbol-acceptance-20261104-hj6qj7q4/results/evidence.json`。

时间和网络边界：native ready 3.693 秒，Codex 可编辑首次可见 114.312 秒，只读验证结束 118.780 秒，已登录可见稳定观察仅 4.47 秒。另两条 ChatGPT 域 WS 以 1006 关闭；关闭时客户端最后一个请求未记录对应 return，不写成所有异步操作都已确认。本轮无真实 turn/历史/项目/SSH/云，不构成长时间稳定或性能验收；下一步需独立长测和定位初始化耗时/外部连接。

后续正式源码五分钟复验已完成：可见 Codex 初始化后观察 300,007ms，61 次 DOM 采样始终可见，桥未断，设置和模型菜单复核通过；1786 次进程采样未见 exec-server。采样时 WS bufferedAmount 峰值 0、native pending 峰值 8；产品桥未插桩，内部 retained/waiting/in-flight 队列未知。JS heap 累计峰值 173,706,779 字节、renderer RSS 累计峰值 460,580 KiB，仅留峰值，不能推断稳态。本轮两个 ChatGPT 域 WS 未记录 1006，不覆盖上轮异常，更不是云工作流通过。

该轮 native ready 3.432 秒、首导航 110.409 秒、editable 114.418 秒，仍未达到可交付启动体验。Playwright 可见的 1261 个 HTTP 均 200，已完成同源脚本最长 1.127 秒、外部图片最长 5.967 秒；不覆盖 Electron 主进程内请求，因此未确定 110 秒等待根因。21 项正式源前后不变，销毁/退出有回执。证据 `.dev-runtime/chatgpt-codex-five-minute-20261104-zc7yz9w2/results/evidence.json`，SHA `1dadcbb2fe314d6ab651217722f0ee4bbc9a27a265b0417c0f2c91563b9d8b88`。无真实历史/项目/模型 turn。

## 本轮已通过的检查

| 检查 | 实际结果及范围 |
| --- | --- |
| 工作区 `pnpm check` | 一次完整类型检查与构建通过；在本次 Work 策略及资源适配最终接入前完成，后续增量另验 |
| 资源/profile/WS 网关 | 当前 38/38，通过固定来源、身份变化、8 MiB 反例、适配哈希/304/字节租约等测试 |
| 第四模式及相关输入/切换 | 当前 5 文件 25 项通过；包含正确状态、iframe 保留、模式焦点及代码高亮可见性夹具修正 |
| 前端定向浏览器回归 | 隔离 fixture 的四模式切换、键盘、草稿及 320/375/393/768/932/1440px 回归通过；不是真实账号 |
| 宿主包整体 | 最新一次 150 项中 146 通过、4 项因未提供 Mac/native member 参数跳过，不能计为全包验收 |
| Work 固定原包专项 | 显式原包输入的 36/36、固定补丁哈希 7/7 通过，另有无网真实 Electron 启动 smoke |
| 私有宿主管理器 | 15/15，通过独立真实 Node IPC+/proc 夹具、发布竞态、未知发布结果及撤销失败重试 |
| 服务端增量类型检查 | 本次资源适配与新 export 接入后通过 |

开发机为 Node 24.22.1；Node 20 尚未实测。早期冷加载 7–14 秒，不是交互 p95≤2 秒通过。无登录浏览器 renderer RSS 为单次绝对/采样峰值记录，不是长期内存验收。

## 尚未完成的交付关卡

1. 登录后长时间稳定、初始化耗时和外部 WS 故障归因；模型菜单和设置只读已短时通过，真实项目/历史和任务仍待验收。
2. 生产可启动的宿主隔离/依赖部署。容器基础已有两项无账号、断网实测，但真实 LAN HTTPS、账号/网络配置和常驻部署未齐；宿主 user namespace 仍返回 EPERM，不静默在宿主使用 `--no-sandbox`。
3. 共享现有官方 daemon 的安全连接。只读真实 daemon 身份检查已做；两个客户端的私有测试通过，但 `codex app-server proxy` 会丢弃桌面两项 `-c` 覆盖，不能当等价集成。受控适配、桌面工具 pipe、新线程配置和已有线程安全继续仍在实现。
4. 真实原版布局下的自由多主会话分屏、公共输入、正确上下文/迟到回执和刷新恢复。已找到 `renderLayout({content,footer})`；合成作用域测试不等于真实 GI/XI 和发送通过。
5. 原生文件选择、菜单、保存、剪贴板和拖放的浏览器适配；原生 Xvfb 对话框不可见，不算浏览器可用。
6. SSH、云、Diff/Git、终端/浏览器、插件/技能/MCP、自动化、设置及真实模型全工作流。
7. 实际 LAN 第四模式、长期资源/恢复和固定 Mac 实机视觉与行为对照。

以上均保留在本期范围。当前默认环境未发布第四模式正式宿主 profile，不能把新入口或隔离登录页表述为已经交付可用的 ChatGPT 桌面模式。

## 后续独立模块（尚未接入默认工作区）

- 浏览器右键菜单已能返回原版 `{id}` 契约，普通输入的剪贴板、取消、层级和键鼠/触屏有离线真实 Chromium 证据；原 Mac ProseMirror 编辑器的事务/线程切换仍未验证，不能把普通 input 结果扩大为原 composer 可用。
- `browser-input-scope` 提供文档身份内的本地编辑 token；必须由已提交的真实 composer 上下文注册。多 owner、切换、同值新确认、无效更新和销毁使旧 token 失效，迟到旧 cleanup 不影响新 owner。5 项先红后绿；这不授予 native RPC/turn，也不证明真实作用域已接入。
- `desktop-layout` 固定版本适配器找到原 GI 的 `renderLayout({content,footer})`，默认透明透传、初始布局选择固定；目前仍以合成 GI 和原版作用域模块验证为主。后台 XI 明确拒绝，真实分屏没有标绿。
- `daemon-cli-adapter` 的私有双客户端传输已通过，但当前仍是未启用原型，原版默认 `-c` 被明确拒绝，尚无正式共享 daemon 的 RPC 意图/账号授权门控。新私有线程的原版工具 pipe 有独立实验；已有任务的有效配置与导航只读仍是关卡。

root 独立复验：右键菜单无网 Chromium 22/22；publisher + host-service + input-scope 33/33。profile 发布/持有 FD 撤销已抽为共用 `profile-publisher`，直接宿主与后续容器协调器复用，不复制两套关闭语义。

## 容器组合、发布窗口与 LAN 安全上下文

新增 `container-service`、`container-host-service` 和写前控制模块，已纳入包导出、类型声明和语法检查。固定镜像/原包与可执行文件摘要、公开 SO_PEERCRED 及容器/进程身份联合核验后才授予 native 启动。默认空 HOME、network none、只读 root、无 capabilities、NNP、独立 namespaces 和资源限制；关闭服务保留 native，而非隐式停止任务。详见协议中的容器配置与 grant 未知结果语义。

先前真实容器因可见 256 CPU 而碰到 pids=256 上限，尚未 ready；显式固定允许 CPU affinity 后到达 ready，未放宽 pids/内存预算。容器相关单测 22/22，root 独立复验同为 22/22；两项真实无账号、断网 Electron 验收通过（`/tmp/cg-offline-final-hzkgWH/results.log`）。覆盖同一实例 viewClosed 后断开/重连、发布 profile 后撤销并保持 native 存活，随后仅清理自有无任务夹具并等待真实退出；源码摘要前后一致。这不证明登录或模型任务。

profile hard link 可见到发布器最终 verify 之间的首连竞态已通过 red/green 修复：消息等待 active，沿用调用者绝对 deadline/取消信号，真正写出前再次校验，取消后的迟到发布不写也不消耗 view ID。broker、直接宿主和发布器组合 68/68，日志 `/tmp/chatgpt-publication-barrier-final-green-20261104.log`；容器相应路径纳入上述 22 项测试。

新增独立 LAN 浏览器容器验收脚本，不自动随 dev/test 启动 Docker。第一轮真实 HTTP LAN 证据 `.dev-runtime/chatgpt-desktop-container-e2e-e2nmnki2/acceptance.json` 是红灯：原版缺少安全上下文，调用 crypto.randomUUID 抛错。负向 cookie/Origin 与资源 hash/ETag 检查通过，不把它们当登录页通过。产品已在第四模式及直接资源入口增加 HTTPS/crypto 预检，创建 WS/view 前失败并提示 HTTPS；入口 17/17、第四模式相关 4 文件 18/18 先红后绿。真实受信任 HTTPS 复验正在进行，不开启忽略证书或不安全 origin 选项。

该 LAN 夹具另发现父级认证/Origin hook 拒绝 WebSocket upgrade 后保留原 socket，导致自有网关关闭超时；单独真实 TCP 反例已定位，修复及最终组合验证尚未结算。不能把夹具强制清理连接写成自然释放通过。

后续修复确认父级 onRequest 早于 websocket 插件的 request.ws 标记，插件未取得拒绝连接的清理归属。仅对固定第四模式 upgrade 记录原 socket，在完整响应 finish 后关闭，不能排空时最多两秒销毁；网关关闭也释放自身拒绝连接。真实 TCP 13/13，root 资源/profile/WS 组合独立复验 45/45，日志 `/tmp/chatgpt-server-root-review-final-20261104.log`。首个 HTTPS 复验已观察零残留及自然关闭，完整 UI 仍在复验。

初始化耗时仍有独立红灯。后续几次诊断可编辑时间约 24.6/28.4 秒，但原 115.5 秒等待可复现，不能归因于一次显式代理配置。固定 owl-shell 的 Electron net/webRequest `onSendHeaders/onCompleted/onErrorOccurred` 虽存在，却对 session.fetch/net.request/renderer HTTP 均无事件；只读观察路线已停止，没有覆盖原网络策略 hook。报告 `.dev-runtime/chatgpt-startup-electron-net-20261104-yKe3BTaw/report.md`，不将不完整网络观察解释成上游没有请求或已确定原因。

真实 GI 已显示原版 ProseMirror 和固定测试线程，但首页草稿可能隐藏保留或被原生命周期销毁，跨导航完整状态尚未证明；真实 composer 单次发送、自由分屏和本地编辑 scope 均未结算。旧账号研究实例收到无法归因的聚合活动信号，保持断网并保留；后续改为新无账号 loopback provider 精确线程验证，不据聚合布尔猜测任务归属。

独立 `desktop-pane-layout` 状态模块已完成 9 项先红后绿：四边移动、中心合并排序、拆唯一标签保留空新聊天组、嵌套比例/关闭折叠、冻结快照、独立恢复、拒绝重复/异常存储，以及预算失败不改变原选择。空集合重复 reconcile 和原位 drop 不再产生无效快照。尚未接原 GI/XI，未标为真实分屏或公共输入通过。右键菜单最终冻结版另经 root 无网受限容器内真实 Chromium 独立复验 35/35（`/tmp/chatgpt-context-menu-root-review-final-20261104.log`）；富文本原组件与真实上下文仍分别验证。

包级常规测试最近一次共 255 项，212 通过、43 跳过：其中浏览器菜单、指定原包、原组件、私有 native/daemon 关卡依赖显式环境，不能计为通过。该次在新增分屏状态模块及后续 stdin EPIPE 修复前执行，不能替代当前最终组合；前端增量类型检查通过。

## HTTPS 原版核心链已通过，继续账号与原生连接

`.dev-runtime/chatgpt-desktop-https-e2e-qketkiei/` 已完成真实 LAN HTTPS 组合：未导入测试 CA 时浏览器拒绝，独立 NSS 导入本次 CA 后正常验证，无 ignoreHTTPSErrors/不安全源开关；Node 另核对 CA/IP SAN/leaf SHA。原版登录方式、API key 表单和取消均通过，322 个发送/537 个接收帧、桥错误 0。四项认证/Origin 负例、Secure/HttpOnly cookie、原/适配 hash/ETag 均通过。profile 撤销及 viewClosed 后 native 尚活，再清理精确自有无账号 fixture 并等待真实退出；网关残留和强制关闭连接均为 0。root 独立核对结果和四个证据摘要一致。专项 5/5，复现见 `/tmp/chatgpt-desktop-https-acceptance-handoff-20261104.md`。

该运行固定 container-service `0f4d14ef…`、browser-entry `047ba91c…`、bridge `4b5fb92b…`，后续账号选项改动不能继续沿用此结果称新版本已验收。worker 总历时 55.8 秒，JS heap 仅两次采样峰约 105 MB，renderer RSS 无样本；不证明两秒、长稳、账号或完整四模式。Chromium 内置公共根仍在，Playwright 外域拦截也不是 OS 出站防火墙。

容器 helper stdin EPIPE 的真实子进程红灯已修复：观察 stdin error 并标记自身传输 unavailable，保留 unknown、初始 grant 不重发，stream close 后移除监听，不让 manager 因未捕获错误退出。相关单测 23/23，加分屏模块 root 组合 32/32；新的两项真实无账号离线组合也通过（`/tmp/chatgpt-container-epipe-offline-20261104.log`）。首次 grant 后尚未得到 native 身份时，nativeExited 仍可能未决，不能把 pending 解释为活着或退出。

共享线程私有 alpha/stable 双客户端证明原审批可在第二客户端连接后继续由原 owner 回复，队列保持，两端收到同一完成；官方 stable 源同时揭示最小 resume 的客户端/MCP 策略与持久化副作用。用户据此明确选择点击后按原版连接，方案和门控已更新；自动模式恢复仍不连接，真实 sidebar 因果绑定和正式 daemon 接入仍未完成。

正式账号路线正在增加显式授权的只读源快照与真正 tmpfs HOME：只复制 ChatGPT id/access 及必要元数据，refresh 置空，不改原登录、不复制历史/工作项目。独立 helper 6/6 覆盖私有权限、只读原源、有界 fatal UTF-8、仅限字段、tmpfs/空目录及不重放；不能据此声称新容器已登录或长期可刷新。

该账号选项已接入显式 container service（bridge 网络、inspect mount/网络及写前 tmpfs 身份复核），相关 35 项与分屏状态 9 项组合通过。新 HTTPS 账号样本 v1–v4 均保留，尚未通过 Codex 切换：v1 外域限制和进程采样有缺陷；v2 未执行模式菜单；v3 指针激活后未见切换；v4 键盘激活后诊断读取超时使脚本提前结束，缺少后续 DOM，因此切换结果未知。Work 进程计数只接受 v2–v4 的有效采样，不能将 v1 失败计为零。单独无账号无网 CLI 初始化通过，仅排除该最小布局的初始化失败，不能解释账号状态。下一样本明确区分正式资源与仅记录固定 status/source 的私有诊断资源。

项目信任确认曾进入不可见启动窗口，已通过按私有 view 绑定 projects service 修复；固定原包与作用域单测 21/21，两私有 view 离线确认均各收到一次并拒绝。真实原版 `Trust this folder?` 在新无网夹具中一次出现，真实 Cancel 后 denied/settled、未创建项目、未添加根、零 thread/turn 并关闭自身 views；证据 `.dev-runtime/chatgpt-consent-ww-20261104-dz0040jn/results/desktop-proof-config.json`。这不是 trust 接受或 startup/deeplink 全路径验收。

原 GI/ProseMirror 已在新无账号、loopback provider 夹具显示，原模型介绍弹窗真实关闭后能输入固定草稿。首页控制器随后销毁，完整草稿恢复尚不确定；原宿主记录还出现浏览器计数以外的第二次 thread/start。下一步以全新 stdio 诊断代理记录精确原生请求/响应身份，不以聚合 busy 或浏览器消息数量推断真实线程和任务，也不在未知目标上试发。

本地模式激活已接入父 iframe 与浏览器入口，隐藏/重显、同值确认、文档替换及断线撤销；新聊天明确 null conversation 也有旧 token 失效测试。入口/input/core 合计 31/31、server 资源/profile/WS 45/45 和 server 类型检查通过。前端父容器/状态 12/12、前端类型检查通过；实际 GI 的 footer scope 与富文本事务仍独立验收。新 entry `0117f36b…`、server bridge `9ae1349c…`，不能沿用旧 HTTPS UI 结果声称此版全功能通过。

共享线程策略原型 25/25，alpha/stable 两项真实私有双客户端通过：仅明确意图最小 resume、分页能力/cursor 及账号/执行域校验。尚未接原 sidebar 手势或正式 daemon；原 GUI 的工具/config 覆盖、完整分页渲染仍阻挡正式接入。SSH 原版启动代码另发现会杀同 UID 匹配的旧 app-server；已建固定版本阻断原型及命令记录夹具，尚未接入 wrapper，也未运行真实 SSH。详见[SSH 证据](ssh-bootstrap-evidence-20261104.md)。全部仍是本期待交付关卡。

`desktop-surface-assets` 将 Work effect、page layout、thread scope 与 composer registrar 四个固定原资源组合为独立服务端 recipe；原 ASAR 全部逐项 3/3，输入/输出各 512 KiB 和现有租约预算不变，已改写字节不得再次作为原件。尚未接默认 app 路由。`browser-surface-controller` 的初始拒绝、失联中迟到初始化、模式撤销/重建及部分初始化失败 4/4 先红后绿；原 Gac+同源 iframe 的离线合成 GI 已通过真实 paste 与迟到 clipboard 隐藏撤销，不是实际 native GI/账号通过。

传输另修复一个确定但未与账号首错关联的关闭端口错误：portClosed 后移除该端口 ready 与未发送快照/字节，迟到 open ACK 不复活、迟到 open/post throw 不关闭其他端口。8 在途/256 等待/8 MiB/原超时不变；专项 17/17，真实 Unix broker+原 view shim 的离线模拟 2/2，root 入口/bridge/controller 39/39 独立通过。最终 bridge `2fdf68c5…`，日志 `/tmp/chatgpt-bridge-local-controller-root-final-20261104.log`。root 对固定原包 consent 另独立 8/8；已登录样本最大 ACK 12.896 秒与 10 秒超时吻合，但首错码仍待采集，不能把这个时序当因果证明。
