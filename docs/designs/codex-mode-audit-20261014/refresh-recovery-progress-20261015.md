# 刷新恢复开发进度（2026-10-15，持续实施）

用户已要求完成原计划所有阶段并修复途中 bug。此前阶段 0 失败后等待 review 的流程不再阻止开发，原有两秒、本地官方 DOM、未修改 VSIX、活跃任务保护和物理设备验收标准保留。正式常驻路径尚未启用，本文件不代表最终验收。

## 已修复的恢复故障

- 原生首次发送可能替换整个空白 composer portal。观察器此前只观察已被移除的 portal，漏掉真实 thread。现在取得真实身份前继续观察结构，取得身份后收窄观察范围。
- 动态新窗口没有启动窗格的 `onThreadState` 回调；两个回调跨渲染交付也可能漏记关注。两个观察入口现在共用 thread 发现记录，按窗口与 UUID 去重，避免重复观察反复关注。
- 伴随扩展的实例先发布，启动窗口随后固定打开列 1。历史恢复若先创建组，启动窗口会改变实际 editor 分布，返回的列不再对应目标。新增启动完成屏障，独立历史之间仍可并行，实例发布不等待原生 editor 完成。
- 历史目标中的官方 Back/Next 引导会被加载占位层挡住。现在显示并允许点击没有 thread/composer 的原生引导；空白或错误 thread 的 composer 仍不能当成目标就绪。没有移动原生 iframe 或替换 MessagePort。

以上均保留失败用例后再实现。正式前端源代码可热更新；伴随扩展的已安装正式副本没有因此替换，也未重启正式宿主或 Agent。

## 分阶段状态与证据

| 阶段 | 当前结果 | 尚缺部分 |
| --- | --- | --- |
| 0 | 匹配 CLI 的多连接初始化与退出测试通过；真实首次发送自动进入关注集合；真实历史目标普通刷新可恢复，连续诊断样本目标 UUID 正确。 | 真正可提交/审批的两秒计时、完整多端/草稿/运行中/审批兼容性仍未通过。 |
| 1 | 隔离常驻进程、独立原生客户端、真实订阅适配器、事件驱动管理器及 10 项 LRU 已实现。真实测试覆盖创建进程退出后复用、所有客户端断开时继续任务/恢复审批、后台命令保护、11→10 实际卸载与冷恢复、旧 Resume 设置保护；管理器能重新接入同一代运行进程。 | 新隔离宿主已有显式 launcher 接入，但默认启动及自动桥接控制通道尚未接入；可见消费者自动断连/租约、全生命周期协调、真实子 Agent 家族与长历史/长期 RSS 预算仍需验收。 |
| 2 | 修复真实目标、观察与引导问题；外壳布局/启动 thread 映射/项目/侧栏宽度改为按标签保存，设备存储只提供新标签初始模板。隔离诊断只恢复所选历史。 | 启动关键路径仍慢；官方草稿三页试验出现刷新串读，后续复测还遇到原生页面加载失败；已补齐服务端注册的 client 路由与前端选择器；同源原生持久状态仍共用，独立原生 profile/源、多端真实操作与回执语义未验收。 |
| 3 | 当前源码检查和定向回归通过，失败性能样本保留。 | 原计划完整批次、容量/长历史、至少 30 分钟自然内存、物理手机/第二设备及安全启用未完成。 |

前一轮检查：`pnpm check` 通过（共享包、运行层、后端/前端类型和生产构建）；宿主/适配器 **163/163**，含显式匹配 native、无跳过；Codex 前端 **98/98**；原生网关 **31/31**。没有用这些通过覆盖真实性能红灯。

## 性能诊断仍为红灯

隔离入口为 HTTPS `https://10.30.0.24:5173/?mode=codex`，端口 5173，前端绑定 `0.0.0.0`。这是本轮自建夹具地址；该夹具已清理，5173 不再作为可用入口。正式入口仍为 HTTPS `https://10.30.0.24:8484/?mode=codex`。物理设备可达性未取得独立证据。

使用原版官方界面、真实磁盘历史和共享已加载 native thread。桌面诊断中，保留启动空白窗口时两次热刷新看到正确 composer 为 **10.754 / 11.856 秒**；隔离配置去掉额外空白启动窗口后为 **9.156 / 9.191 秒**。这些终点只证明 composer/UUID 可见，尚未包含即时提交的接受回执，不能当作原计划的通过样本。不同批次、冷缓存和宿主负载没有合成因果结论。

另外仅在忽略目录的隔离网关试验 11 个已知官方静态文件的哈希校验缓存，共 21,470,456 bytes；原版 VSIX 和公用 code-server 文件均未修改。只截取精确原生 worker 路径，版本/内容不符拒绝试验，HTML、认证、历史和 RPC 不缓存。四次诊断中的三个热样本约 **9.424 / 8.871 / 8.358 秒**，仍失败。该试验未写入正式路由或声明已支持，尚缺完整资源、CSP、安全、失效和内存验收。

桥接只记录有界 method/id/error/bytes 与时间，没有 params/result 正文。另一轮诊断的 native RPC 最大观测时长为 63 ms；它不是浏览器恢复总时长，也不证明所有 RPC/场景恒定如此。浏览器 long-task 可能同时归因于多个祖先 frame，不把各 frame 数值相加。

## 原生生命周期实测

`refresh-lifecycle-native.test.mjs` 使用精确匹配的原生 CLI、全新私有 HOME 和 loopback Responses fixture，实际执行模型轮次与工具；该组不复制登录数据，16 次本地请求、0 次远端模型请求。原生测试显式设置 `thread_unload_delay_secs=1`，不能当作默认原生卸载时长。

- 一轮实际进行中的请求在发起端、最后订阅端和所有旧管理连接退出后继续运行；新连接仍可恢复同一 UUID。
- 两个新连接收到同一待审批身份并同时接受，私有文件只写入一次，历史只有一个完成轮次。此项证明原生协议行为，不替代官方按钮和物理手机验收。
- 空闲状态下的实际后台命令尚未结束时，适配器不释放；文件证明命令结束后，才允许实际卸载。
- 11 个不同 native thread 完成实际轮次，保温/回收后 `thread/loaded/list` 从 11 降到 10；真实 LRU 被卸载，重新保温恢复原 UUID 和一个原历史轮次，未触发额外模型请求。
- 冷恢复后再用旧端提供不同模型、reasoning、cwd、审批与 sandbox 设置，已加载上下文保持原实际设置。

这一短组 native RSS（bytes）为：起点 192,266,240；一个新增线程 194,273,280；10 个 213,123,072；11 个 214,237,184；冷恢复后 217,133,056。起点已执行前面的生命周期用例，不是新进程空载；2 GiB 仅为 fixture 显式预算，尚未据此决定生产预算或证明长测稳定。

`refresh-service.test.mjs` 另在创建进程自然退出后重新连接真实 native 服务，保留活动轮次；管理器接入后通过元数据观察活动→空闲，管理器关闭只断开自己的连接。旧 PID/代次记录失效时拒绝接入及重复启动，不删除锁、默认 IPC 或他人进程。

适配器的家族保护和写入前事件修订屏障已有单测：活动后代、未知祖先、后台资源及在实际 stdin 写入边界到达的新生命周期都阻止释放；仅向父上下文取消自己的订阅。真实 native 子 Agent 家族的新增整组验收尚未完成。首次 retain 的旧回复覆盖刚创建的审批状态这一竞态也已修复并保留红灯。管理器 64 项操作队列满载时立即重试会形成微任务循环、阻止原生 I/O 返回；外部超时红灯（exit 124）和恢复后 4 项管理器回归已记录，现等待已排队操作腾出空间。

## 初始化与多标签的后续红灯

只读网络观察位于 `.dev-runtime/codex-refresh-20261015-network/`，只记录固定主机的路径（不含 query）、时间、HTTP 状态与 PID，没有 headers、Token 或正文。新的普通热刷新正确 composer/UUID 为 **9.204 秒**；首次样本 17.959 秒仍单列。该热样本官方在线配置请求耗时约 1.569 秒，请求结束到后续初始化请求还有约 1.59 秒。仍未测即时提交回执，不能以 RPC 很快或缓存命中声称两秒可操作。

首次三页草稿诊断中三份内容可同时独立编辑，但 A 刷新读到第三页内容；后续页面恢复失败，且开发过程有 HMR，因此保留为必须隔离复验的失败证据，不把它包装成已完成的根因或严格三端回归。390 px 仅为浏览器视口，未使用物理手机。官方 profile URL 诊断发生 `ENOPRO` 文件系统 provider 错误；CLI 的 profile 安装命令虽返回成功，却未观察到独立 profile 目录，尚不能用于产品隔离。

## 原始记录与边界

本地证据位于被忽略的 `.dev-runtime/codex-refresh-20261015/`：`discovery-red.log`、`portal-red.log`、`startup-race-red.log`、`onboarding-red.log`、`pool-red.log`、`pool-admission-red.log`、对应 green 日志、`host-all-final-batch.log`（163 项）、`native-family-resources.log`（短测 RSS）、`manager-native.log`、`manager-queue-red.log`、`manager-queue-green.log`、`codex-tab-isolation.log`（98 项）、`gateway-tests.log`、`check-tab-isolation.log`、真实首次发送/恢复 JSON、原生界面截图、资源/long-task 和有界协议记录。最早的测试启动目录/config 错误不算行为红灯，保留的是修正夹具后实际断言失败的日志。

一次浏览器 init script 在 sandbox frame 读取 localStorage 的诊断错误已修正为只在顶层预置夹具布局；后续没有此错误。预置的是自有测试窗口布局，原生历史和 RPC 由真实服务返回，没有伪造 thread 结果。缓存试验的部分批次与构建负载重叠，因此只作红灯诊断，不作为可比较的性能收益或最终验收。

本轮网络/草稿夹具已按原 PID starttime 与子进程归属清理：13 个自有进程全部退出，无强制 kill，私有 HOME/登录副本和 native socket 已移除；三个正式运行进程仍在。清理回执为 `.dev-runtime/codex-refresh-20261015-network/cleanup.json`。

不向正式历史发送性能任务，不接管默认 CLI socket，不停止正式 Agent，不提交或推送；原计划剩余工作继续实施。

## 显式宿主接入与 client 路由

新增 `host-connection.mjs` 与 launcher 显式选项：新私有宿主先核对原始 CLI/VSIX、服务域、代次、PID/start ticks 及只读 initialize，再创建固定配置的自有 CLI 包装器；验证失败发生在登录副本导入和扩展安装前。新宿主的断连宽限期可配置，范围 1–300 秒，显式模式默认 60 秒；隔离夹具使用 10 秒。它不改变普通宿主的默认宽限期，也不是 thread TTL。

网关可为服务端固定注册的 profile UUID 挂载独立 HTTP/WS/API 前缀，重定向、Cookie Path、forwarded prefix 与状态中的 iframe 地址一起限定。前端 `nativeClient=<UUID>` 经对应原生 API 操作，关注集合沿用公共 journal；布局模板/启动映射、iframe 缓存和旧实例身份分别保存。错误、重复选择器或另一 profile 的 iframe 地址拒绝回退。浏览器参数不接受端口、运行目录或上游。完整契约见 [原型 README](../../../packages/native-codex-host/refresh-prototype/README.md#explicit-private-host-and-client-routing)。

新增路由/选择器、发送和存储行为保留实际失败断言，再实现转绿。检查结果：宿主整组 **165/165**（匹配 native，无跳过）；最后一次 helper 取消检查与格式调整后，直接相关的宿主/launcher/服务 **34/34**；网关 **33/33**；Codex 前端 **111/111**；`pnpm check` 再次通过，共享包、运行层、两端类型与生产构建通过。既有构建大 chunk 提示仍保留。`.env` 被忽略，`.env.example` 未被忽略。

这些仅是显式隔离接入。自动 profile 分配/回收、桥接控制通道、可见消费者租约和完整资源准入仍未完成；默认启动不启用，阶段 0–3 不因此转为完成。

## 三个私有宿主的真实浏览器红灯

本轮夹具位于 `.dev-runtime/codex-refresh-20261015-profiles/`，前端绑定 `0.0.0.0`，使用 HTTPS LAN `https://10.30.0.24:5173/?mode=codex&nativeClient=<UUID>`。三个独立 code-server/用户数据/CLI HOME 连接同一个私有 native app-server 与实际单轮历史。后续浏览器脚本未拦截或改写 API；由产品源代码直接选中对应客户端。第三页仅 390 px 视口，没有物理手机证据。该夹具现已清理，5173 不是可交付入口。

最初的诊断把 `#root.textContent === ""` 当成根节点为空，随后已纠正：官方 React 实际挂载了加载组件。只读 DOM/Fiber 观察将等待点定位到 `CodexStatsigProvider.sync`，稍后进入 async fallback。真实模块均已返回，观测到的 WS 最大帧为 1,301,268 bytes，未见大小/背压关闭，现有限制保持。原始 VSIX 内的四份关键 extension/入口/初始化文件与压缩包字节一致。

自有伴随扩展中的有界、只读网络诊断只记录路径（不含 query）、时间、状态、编码/长度及 byte count，不存正文、授权头或 Token。在线配置 POST 返回 HTTP 200 后，代理路径在约 10 秒期限内仅收到 179–258 KiB，随后被官方请求中止并重试。只在私有夹具设置 `http.noProxy` 后，一次同路径请求接收 924,798 压缩 bytes 并完整结束，耗时约 8.652 秒，页面才继续初始化。这是该环境的诊断，不是通用直连配置建议或两秒性能收益证明；部分其他原生在线接口仍有 403/挑战错误。正式网络配置没有因此改变，账号/在线配置响应没有加入缓存。

仅等 UUID/composer 出现的早期草稿脚本会在历史仍加载时过早输入，故该失败不能独立证明持久化根因。收紧为等待真实历史回复可见并使用键盘输入后，仍稳定复现同源串扰：A 首次为 `电脑 A 独立草稿 alpha`，第三页实际内容为 ` gamma`，A 普通刷新后读到同一 ` gamma`；另外两页的输入也发生替换。该组 9 步的最终 `passed=false`，保留全部失败与请求中止记录。

本地 code-server 原始实现进一步确认：默认 profile 复用应用全局存储，`createApplicationStorage` 使用 IndexedDB ID `global`，数据库名前缀为 `vscode-web-state-db-`；只有工作区库才加入 pathname hash，非默认原生 profile 才使用 `global-<profile.id>`。因此服务端目录及 URL 前缀隔离不能隔离同一浏览器源下默认 profile 的原生草稿。下一步需要验证真正的原生 profile 或独立浏览器源，保持每页官方本地 DOM 与原有通道；不能宣称当前 client 选择器已经解决草稿隔离。

严格批次仍未开始。上述首次历史可见诊断约 23.921 / 23.250 / 18.476 秒，普通刷新约 29.173 / 14.600 / 13.559 秒，均不包含即时发送接受回执，且草稿验证失败。它们只作冷/热分开的失败诊断，不能当作合格的 30 次性能样本。严格矩阵、原生实际发送/审批/中断/附件、原生新聊天草稿、物理手机及至少 30 分钟长测继续待验。

## 资源边界与本轮清理

浏览器断开并经过 10 秒客户端宽限后，原生 thread 仍为 idle、保留一个原历史轮次，`thread/loaded/list` 仍为 1，没有额外模型轮次。该时点 native RSS 为 219,668,480 bytes；多个 code-server/宿主基础进程仍占用资源。单独约束 native 池的数量/RSS不等于限制所有客户端宿主，整体宿主资源准入仍是未完成项。此检查不是 30 分钟自然内存证明。

原生插件也报告文件监听 `EMFILE`。只读主机快照为该用户 124/128 个 inotify 实例；清理后另一快照为 125/128，期间存在其他任务，不能把总量变化归因于本夹具或停止他人进程。下一轮须先检查资源余量并限制新建宿主；不通过上调主机限制或停正式任务制造验收条件。

清理按真实 PID starttime、私有运行目录和父子归属进行，先通知夹具 owner，再停止其剩余子进程。**18 个自有进程全部退出，无强制 kill；私有 HOME/登录副本、运行目录及 native 自身拥有的物理 socket 已移除，三个正式运行进程保持存活。**回执为 `cleanup.json`，后续不可复用旧 PID 清理记录。

新证据：`profile-client-red.log`、`profile-storage-send-red.log`、`profile-client-final.log`、`profile-routes-green.log`、`host-all-profiles.log`、`host-integration-final.log`、`check-profile-client.log`；浏览器 `browser-scoped-proxy-failed.json`、`browser-scoped-direct-result.json`、`browser-hydrated-result.json` 与截图；`state-detail.json`、`http-metadata.jsonl`、`client-disconnect-resources.json`、`cleanup.json`。较早被覆盖的工作中间文件不作为唯一依据；稳定失败及最终回执已单列保存。

## 独立浏览器源与焦点确认的实际复验

继续使用未修改的官方 VSIX/匹配 CLI。`origin-listener.mjs` 从调用者已有的 HTTPS 前端创建独立源，复用实际请求/upgrade handler，保留 Vite 的 HTTP/2，不增加代理跳转、服务器浏览器、HTML/RPC 缓存或替换 Webview 通道。源地址与连接/关闭上限显式传入。父前端关闭竞态先出现取消/超时红灯，真实 Vite 的 HTTP2Server 类型拒绝也保留失败，再实现转绿。七项测试覆盖请求/Host/CSP/Cookie、原 WS 2 MiB 超限仍返回 1009、单源关闭不影响其他源、无效/占用地址、启动期间父关闭与不配合 TLS 客户端。

首次独立源批次不再跨页读到第三页内容，但 A 的最初输入仅剩 ` alpha`；三页刷新均保留各自实际已输入值，整体仍失败。随后四个组件测试复现焦点回执前已开放输入、后台就绪重聚焦、迟到窗口回执误开放与拒绝回执仍开放。现以精确宿主实例/窗口/目标/重试核对回执，并仅观察当前窗口的就绪变化；宿主更换另补回归。整组旧测试保留无 composer 引导和 Retry 的可点击边界。没有移动 iframe/父节点或修改 MessagePort。

真实夹具使用一个 code-server、一个 private app-server、三页独立浏览器源，实际 HTTPS LAN 入口为 `https://10.30.0.24:5173`、`:39095`、`:44209`，均绑定 `0.0.0.0`。通过 `nativeClient` 选择同一个预注册宿主，无浏览器 API 拦截或伪造历史。第三页仅 390 px，不是物理手机。后续两轮均完整输入三份不同草稿，并在三页各自普通刷新后分别恢复。键盘 Unicode 自动输入不等于实际 IME 验收。宿主初始目录与线程 cwd 在该夹具不同，未声称完整 IDE 项目上下文通过。

最终一轮通过每页官方 Send 按钮提交受控的无工具消息，由另一个私有原生订阅记录实际 `turn/started`，而非 HTTP 202 或输入框出现。三次刷新到原生接受回执分别为 **15,521.300 / 14,626.500 / 16,146.600 ms**，均超过两秒；包含实际 UI 输入和截图步骤，属于失败诊断，不能当作最快可操作下界或最终 30 次批次。三页草稿断言通过，整轮 `passed=false`，16 条请求失败/中止全部保留。随后只读原生历史确认 4 个轮次（原始种子 1 + UI 提交 3），每个回执 turn ID 各出现一次，目标 cwd 正确、idle，加载上下文仍为 1。此时 native RSS 258,232,320 bytes，只是短测快照。

独立源仅解决已测的默认 profile 浏览器存储边界；持久客户端到源的分配、端口复用防串扰、全部宿主/监听器/连接的资源准入仍未完成。临时端口分配不是产品分配器。新聊天草稿、并发发送/审批、附件、中断、触控、物理手机、长历史、180 次性能批次及 30 分钟自然内存验收继续待做，默认启动未启用候选路径。

## 无 thread ID 的授权变化与迟到返回

账号变化被原管理器按 thread ID 过滤，两个实际失败用例分别复现启动后继续报告 ready、初始化时仍收纳 loaded 元数据。现在识别匹配版本的三种原生账号边界通知，不保存账号内容，保守失效管理器并仅关闭其连接；正常 rate-limit 更新不失效。所有管理器 RPC 在实际 JSONL 写入前再次核对有效性。追加回归还复现最后一次 RSS await 期间失效后仍返回 warm 成功，现返回前再次校验；排队写入和晚回执不得重新开放保温。失效不 unsubscribe/interrupt/shutdown，不停止服务或任务。

这没有完成初始账号身份与授权域的真实绑定，也没有拦住另一个官方客户端更改登录；完整桥接控制仍属未完成项，不能从单独管理器的失效测试推断整个服务已隔离所有授权变化。

## 本批检查与私有资源清理

Codex 前端 **116/116**，宿主整组首轮 **177/177**（匹配原生，无跳过）；随后增加最后 RSS 边界后，客户端/管理器 **14/14**。`pnpm check` 发现新测试缺少必填 `userInteracted`，已补正并重跑；最终结果以下方后续核对为准，不将该失败写成通过。

主要证据：`.dev-runtime/codex-refresh-20261015/` 的 `focus-ack-red.log`、`focus-codex-final.log`、`origin-listener-race-red.log`、`origin-http2-red.log`、`origin-final.log`、`auth-boundary-red.log`、`auth-late-rss-red.log`、`auth-boundary-final.log`、`host-origin-auth-focus.log`；`.dev-runtime/codex-refresh-20261015-origins2/` 的 `browser-origin-result.json`、`browser-focus-result.json`、`browser-accepted-result.json`、原生界面截图、`native-receipts.json` 与 `cleanup.json`。早期误用半关闭客户端状态的测试已修正为核对自有监听端点退出，并关闭测试自己的客户端，不将测试假设错误算作产品修复。

夹具已按 PID start ticks/父子归属清理：10 个自有进程全部退出，无强制 kill；登录副本、私有 HOME、TLS 私钥及原生自身的物理 socket 已移除。三个正式运行进程仍存活，正式 Agent 未停止。以上临时 LAN 入口已关闭，不能提供为产品访问入口。保留正式 HTTPS `https://10.30.0.24:8484/?mode=codex` 原路径，不将主机自测称为物理设备可达。

## 静态缓存边界复验

缓存审计发现旧逻辑仅匹配 `stable-<hash>/static/`，会把 404/401/502、HTML、JSON MIME 和上游 private/no-store/no-cache 都改成一年 immutable。修正夹具的编码路径归一化后，保留了真正的缓存断言红灯；最初夹具未匹配编码路径导致的异步异常不计行为红灯。现仅对 HTTP 200、受限版本静态路径、白名单后缀和匹配 MIME 补缓存；Cookie、认证相关 Vary、非预期 query 和穿越均不加入。合法原始 JS/CSS/字体/WASM/图片字节及 CSP 保持，HTML/在线配置/认证/历史/RPC 不加静态缓存。

网关 **35/35**（`static-cache-red.log` → `static-cache-green.log`），同时包含原 HTTP/WS、分片/压缩大小与背压回归。宿主最终整组 **178/178，无跳过**（`host-origin-auth-final.log`），前端 **116/116**；补正夹具必填字段后的 `pnpm check` 已通过（`check-origin-auth-focus-final.log`）。缓存修复后再次检查的最终结果后续追加。缓存白名单收紧没有提供新的真实启动性能收益证据，前述 14.627–16.147 秒红灯保持。

最后核对：静态缓存修复后 `pnpm check` 以 exit 0 通过（`check-static-cache-final.log`），共享包、TS 运行层和两端类型/构建均完成，既有大 chunk 提示仍保留；`.env` 被忽略，`.env.example` 可提交，限定文件 `git diff --check` 通过。`pnpm session:status` 为只读核查，未用新产物替换正在运行的会话服务。继续保持目标 active；本批不构成阶段 0 两秒关卡或阶段 1–3 最终验收通过。

## 固定服务身份与原生账号初始通知

真实匹配版本复现了旧包装器的代次缺口：宿主创建后仅改变夹具 `service.json` 的 generation，旧包装器仍接受 `--version`。现在包装器固定域、代次、PID 和 start ticks，每次执行及连接打开后、转发 initialize 前重查；域/代次/PID/start ticks 任一变化，包装器和已持有 descriptor 的连接/RSS 都拒绝。准入检查有界、可取消，迟到成功不能放行输入。新增测试还发现已打开连接在取消准入时 `ready` 未结束，保留实际失败后修复；其他客户端及 native 任务不受关闭影响。

真实登录夹具进一步暴露 `account/updated` 初始通知被当作账号切换。只记录字段名的实际协议观察确认通知含 `authMode/planType`，`account/read` 则提供账号及 workspace routing。管理器在线程 RPC 前核对两次 `refreshToken:false` 原生身份，等待初始通知并校验期间修订；身份包含用户、工作区、后端和路由，只留下域/代次内摘要。账号缺失/变化、初始通知超时、登录/OAuth 或绑定后账号更新仍失败关闭自己的连接，不停止任务。真实 ChatGPT 登录复验已通过初始绑定；这没有实现所有官方桥接的授权控制或跨管理器持久绑定。

宿主整组 **190/190，无跳过**（`host-initial-binding-final.log`）；`pnpm check` exit 0（`check-initial-binding-mobile.log`），既有 chunk 提示保留。新增红灯为 `bridge-generation-red.log`、`bridge-admission-red.log`、`bridge-admission-abort-red.log`、`initial-account-binding-red.log`，对应 green/final 日志保留。`.env` 忽略、限定 diff 检查通过。真实夹具曾将项目目录放在宿主 runtimeRoot 外，被现有保护拒绝；修正夹具布局后 IDE 与 thread cwd 完全一致，没有放宽产品路径检查。三个启动失败夹具的私有 HOME/登录副本及 native socket 均已清理。

## iPhone 16 尺寸模拟：用户确认与真实页面诊断

用户明确没有实际手机，要求按 iPhone 16 尺寸模拟。本轮手机关卡据此变更，物理手机不再是必需条件。参数为 393×852 CSS screen、DPR 3、触控/移动模式；完整、工具栏 659 px、键盘遮挡 430 px 三种视口分别创建上下文以保留固定 screen。WebKit 26.0 和 Chromium 145.0.7632.6 的尺寸/DPR、粗指针、无 hover 和真实 touchstart 探测通过。Linux WebKit 仍报告 `maxTouchPoints=0`，如实保留，没有覆盖 navigator；UA 是测试配置，不能当作实际 iOS 版本或硬件证明。

WebKit 缺失运行库在自有受限容器内安装，不修改主机或全局浏览器缓存；自动化连接仅监听 loopback。WebKit 官方页面在 90 秒内未恢复目标 composer，失败记录保留，没有把参数探测当成产品通过；容器 `memory.events` 未记录 OOM。Chromium 手机尺寸模拟与两个桌面标签使用三个独立 HTTPS 源，共享一个 code-server 和 private native 服务，前端均绑定 `0.0.0.0`，IDE 与 thread 使用同一真实项目目录。

本轮局域网诊断地址为 `https://10.30.0.24:5173`、`:44171`、`:44537`，仅为临时夹具地址。原生 frame、父节点与 MessagePort 保持，浏览器没有拦截原生 API。三页已有 thread 各自输入、同时核对和普通刷新共 9 项草稿断言通过；手机页以原生 touchstart 确认实际输入命中。659→430→852 px 实时重排时草稿、iframe 身份及父节点保持，无横向溢出，输入框始终在可视范围内。Playwright 实时 resize 同时改变 screen，该限制单列，键盘遮挡是视口模拟。

三页通过官方 Send（手机使用 tap）取得同一精确 thread 的真实 `turn/started`；刷新到接受回执为 **15,128.400 / 15,018.800 / 19,215.100 ms**，均超过 2 秒。原生历史确认种子 1 + UI 3 共 4 个 completed turn，各接受回执出现一次、cwd 正确、状态 idle，加载上下文仍为 1；native RSS 258,969,600 bytes，仅短测快照。请求中止等 17 项记录全部保留，整轮 `passed=false`，不是 180 次性能批次或长测。

原始 VSIX 哈希不变。19584 个安装文件与原包比较，19583 个运行文件字节一致；`package.json` 仅有安装器新增的 `__metadata`，移除该安装记录后原清单内容一致。最初把安装清单也要求逐字节相等的失败保留为检查假设错误，没有修改原包或删去差异。

证据在 `.dev-runtime/codex-refresh-20261015-webkit/parameters.json`、`parameters-*.png` 和 `.dev-runtime/codex-refresh-20261015-iphone16d/`：`browser-diagnostic/result.json`、`chromium-diagnostic/result.json`、手机各高度截图、`native-receipts-final.json`、`official-bytes.json`、`official-install-verification.json`。可审阅的浏览器脚本为 `tests/e2e/codex-refresh-mobile.mjs`、`codex-refresh-browser-acceptance.mjs`、`codex-refresh-newchat-acceptance.mjs`。空白新聊天、浏览器组合输入与其他严格矩阵继续测试；首次新聊天的官方引导截图已保留，不能把待点击的 Next 视为加载错误。

## 空白新聊天与新增恢复红灯

新聊天测试先前遗漏了官方 Next，且过快重复点击导致引导未完成；保留这些脚本失败，补为仅操作当前可见原生界面、等待场景稳定后继续。没有改写引导状态或官方 bundle。三端各创建一个不同新聊天，3 项输入和 3 项同时保留断言通过，手机仍为 393×852/DPR 3。浏览器输入协议产生可信 compositionstart/update，原生编辑器实际提交“你好”；结束事件为非可信，如实记录 `trustedEndObserved=false`，不能当作系统 IME/候选词验收。最初要求该结束事件也必须 trusted 的失败是模拟检查假设不符，未伪造事件。

**空白新聊天刷新仍失败：**第一个页面刷新后，没有恢复可交互的原生 frame，6 项输入/同时保留之后的恢复断言未通过。仅保留完整样本，不把未执行的另外两页刷新计绿。Native API 对精确新窗口 UUID 和新宿主实例返回 opened、column=3，浏览器只观察到两个正尺寸组，唯一新 frame 被隐藏。现有只读原生 `model/list` 另确认有 7 个模型、含默认项、耗时 3 ms，不能把这一现象直接归为模型列表缺失。

调查期间另实际复现并修复：折叠组被过滤导致列号提前；宿主实例改变却保留旧恢复标记；旧实例返回的打开回执可以绑定新页面列号；同一宿主 UUID 下 iframe 重载没有重新触发恢复。前端现在按实例及数字页面代次核对两个打开路径的返回、错误与超时，不在等待中持有旧 iframe 文档；新实例/页面清理旧标记和元数据，仅恢复可见目标，后台打开回执不触发当前焦点。先红后绿的记录为 `collapsed-native-group-red.log`、`native-open-host-fence-red.log`、`native-open-same-host-reload-red.log`，最终 Codex 前端 **120/120**（`native-open-surface-fence-final.log`）。最后的源码再次通过 `pnpm check`（`check-native-open-surface-final.log`），既有 chunk 提示保留。

这些修复仍未解决上述真实第 3 列/两个 DOM 组的不一致；`newchat-settled-onboarding`、`newchat-collapsed-column` 和 `newchat-host-fence` 都是 6 步后失败，截图、逐项结果、原生操作的 UUID/实例/列号和 DOM 组几何完整保留。下一步须取得当前官方编辑器与渲染组的可靠对应关系，不能猜另一个新聊天 frame、放松目标校验或移动 iframe。正式入口仍未启用候选路径，两秒、完整多端/容量/资源准入及长测没有最终通过。

## 最新源码回归与本批清理

最后的页面代次修复后，重新跑已有会话三页真实回归，9 项独立草稿断言、手机触控和三种实时高度重排、3 次官方发送再次通过。刷新到接受回执分别 **19,740.100 / 14,043.400 / 29,390.600 ms**，整轮仍 `passed=false`，17 项请求中止等记录保留；这组不是性能改善证据或最终批次。原生只读历史确认种子 1 + 两轮 UI 各 3，共 7 个 completed turn，6 个接受回执各出现一次，没有组合输入测试的额外发送；cwd 正确、idle、loaded=1。native RSS 266,502,144 bytes，只是短测快照。证据为 `final-history-regression/result.json`、截图与 `native-history-latest.json`。

最终检查：Codex 前端 120/120，宿主 190/190（匹配原生，无跳过），最新 `pnpm check` exit 0；限定 diff 无空白错误，`.env` 被忽略、`.env.example` 可提交。只读 `pnpm session:status` 再次确认正式运行层 PID 2712539 就绪，磁盘产物与运行实例不同，未激活新实例或停止 Agent。正式 native launcher/host PID 2718477/2729812 同样保持存活。

本轮私有夹具按 PID start ticks、运行目录与父子归属清理，**10 个自有进程全部退出，无强制 kill**，私有 HOME/登录副本/TLS 私钥和 native 自有 socket 已移除。WebKit 自有容器正常退出（exit 0）并移除，没有修改主机运行库；三个早期失败夹具也已清理。回执见 `codex-refresh-20261015-iphone16d/cleanup.json` 与 `codex-refresh-20261015-webkit/cleanup.json`。上述临时 LAN 端口现已关闭，不能用作产品入口；正式 HTTPS `https://10.30.0.24:8484/?mode=codex` 保持原路径。

手机物理设备不再是阻塞项，按用户确认继续尺寸模拟。当前真实新聊天恢复、两秒性能、自动控制/租约及完整资源和长测关卡仍未闭合，目标继续 active，不能将本批定向通过视为所有阶段完成。


## 原生新聊天刷新：预留列、迟到布局恢复与真实修复

新隔离夹具 `codex-refresh-20261015-iphone16e` 使用相同已授权连接方式、私有 HOME 与三个独立 HTTPS 源；正式实例保持。浏览器在关闭前读取自有伴随扩展现有的原生 tabGroups 状态，只留下实例/目标 UUID、列号、活动标记和计数，不保存标签文本、正文或凭证。VS Code 对新聊天 query 的 `=` 会做 `%3D` 编码，诊断解析按该实际 URI 表示核对 UUID，不把这种编码误判为没有原生身份。

`newchat-metadata` 再现三页 6 项输入/并存通过、第一页刷新失败。打开回执第 3 列，最终原生 tab 和 DOM 都在第 2 列；原生还保留一个空的第 1 组，不能归因于 DOM 漏掉该空组。控制器原来使用创建临时空组时的列，即使 VS Code 随后合并/移除该组；已有未选中的新聊天也会重新建组。补 `newchat-existing-red.log`、`registered-column-red.log` 后改为复用精确原组、拒绝重复身份、读取当前注册 URI 的列，首次整组 193/193。真实 `newchat-registered-column` 仍失败，因此保留该失败，不把单测当作闭合。

进一步 `registered-column-settlement-red.log` 证明 50 ms 提前回执仍会读取正在变化的列。现在等待本次打开命令完成再读取精确原生 tab；同目标锁保持到完成，其他目标仍可提交自己的打开命令。宿主与适配器最终 **194/194，无跳过**（`host-settled-column-final.log`）。`newchat-settled-single-v2` 仍失败；新增只读时间点给出关键先后关系：普通刷新后新聊天请求发生在 **3327.1 ms**，而原生 `code/didRestoreEditors` / `code/didStartWorkbench` 在 **3825.6 / 3825.7 ms**，命令之后的原布局恢复再次改变其位置。不是缺失模型、纯 DOM 尺寸或单次命令完成能解决的问题。

surface 改为观察官方 `code/didStartWorkbench` mark，完成后才发布宿主实例、开放原有打开路径；PerformanceObserver 处理完成事件，隐藏/卸载断开，没有轮询、修改原生页面或清空性能时间线。未知/缺失完成标记不推断已恢复。`workbench-restoration-red.log` 两个实际失败用例转绿；原来两个模拟“已就绪”宿主的测试补上对应原生完成证据后，前端整组 **122/122**（`workbench-restoration-green-final.log`）。`pnpm check` exit 0（`check-workbench-restoration.log`），既有 chunk 提示保留。

单页真实 `newchat-workbench-barrier` 已恢复同一新窗口 UUID 与原草稿，3 项输入/并存/刷新通过、无错误；新请求在 **3949.3 ms**，晚于官方布局恢复完成 **3801.6 ms**。该脚本明确 `diagnosticOnly=true`、`scenarioPassed=true`、三端 `passed=false`，exit 1 是不能把单端诊断算成三端验收的保护。新增单端模式首次漏改固定 3 个身份的脚本断言，该失败作为测试脚本错误保留在 `newchat-settled-single`，修正后继续真实复验，没有计为产品通过。两桌面标签加 iPhone 16 尺寸的默认完整复验随后通过，见下文。

这些启动等待全部计入普通刷新耗时。一次启动约 2.7 秒、此次刷新官方 workbench 自身约 3.8 秒，已经超过两秒，不能通过推迟计时起点掩盖。阶段 0 的两秒、自动控制/租约、持久来源与总资源准入、完整矩阵和长测仍未通过，默认入口继续不启用候选路径。


三端真实复验 `newchat-workbench-three-client/result.json` **passed=true、scenarioPassed=true、9/9、页面错误 0**；各端只有一个空白新聊天，三个新窗口 UUID 不同，刷新后各自 UUID、草稿完全匹配。同浏览器未发送新聊天限制没有放开。手机实际 screen/viewport/visualViewport 均 393×852、DPR 3、触点 1、粗指针且无 hover；截图 `new-chat-2.png` 已人工检查，原生输入和标签正常。组合输入仍是可信 start/update、实际“你好”，end 非可信和没有系统键盘如实保留。三个刷新打开请求分别在 4013.2 / 3907.2 / 3898.4 ms，均晚于原生完成时间 3927.7 / 3856.7 / 3844.7 ms，当前准确的原生注册列为 2。这一功能验收不替代真实发送回执或两秒性能。


本次屏障源码的已有会话回归 `history-workbench-barrier/result.json`：9/9 独立草稿、手机触控和 659→430→852 px 重排、3 次官方 Send/tap 的真实 thread 接受回执通过；刷新至接受分别 **14,920.800 / 18,263.500 / 19,151.200 ms**，全部超过两秒，`draftsPassed=true`、`performancePassed=false`、整体 `passed=false`。15 项请求中止等完整保留，未把本诊断当作三状态 180 次批次。`native-history-final.json` 确认种子 1 + UI 3 共 4 个 completed turn、三个对应 turn 在原生历史各出现一次、cwd 正确、idle、loaded=1；native RSS 290,103,296 bytes 为短测快照，不是 30 分钟内存结论。没有组合输入测试的意外提交。

最终源码检查为前端 122/122、宿主/适配器 194/194（匹配 native、无跳过）、`pnpm check` exit 0、限定 diff 无空白错误，`.env` 忽略与 `.env.example` 可提交保持。`artifact-latest.json` 确认官方 VSIX SHA-256 不变，修改的仅为自有伴随扩展并与隔离安装副本一致；正式安装副本未替换。`formal-preserved-status.log` 再次确认正式运行层 PID 2712539 就绪且磁盘产物尚未激活，正式 launcher/host PID 2718477/2729812 存活，正式 `https://10.30.0.24:8484/?mode=codex` HTTP 200。

本批自有夹具按进程归属和 start ticks 清理，10 个自有进程全部退出，无强制 kill；私有 native socket 由其进程移除，`/tmp/ck-ip-1H5dMd`、授权登录副本和 TLS 私钥已删除，三个正式 PID 保持存活。证据 `codex-refresh-20261015-iphone16e/cleanup.json`。临时源端口已关闭；新聊天恢复这一具体红灯已闭合，但完整计划和最终验收仍未完成，目标继续 active。


## 分段性能诊断与 portal 事件恢复

新增可审阅的 `tests/e2e/codex-refresh-timings.mjs`、`codex-refresh-cpu.mjs`、`codex-refresh-startup-profile.mjs` 和相应宿主 Node 测试。测量仅留脚本 basename、源位置、受限计数与数值时间，不保存完整 URL、参数、请求头、函数名、原始 CPU profile 或正文。每快照最多 16 frame、512 条资源和 128 条长任务；浏览器资源缓冲已满时如实标记，不清空或扩大它，也不清空原有 mark/measure。多个同源 frame 的长任务时间有重复，不能相加为独占 CPU；transferSize=0 本身也不能证明网络缓存命中。

隔离 `codex-refresh-20261015-profile-fixture/timings-browser/result.json` 首轮 9 项草稿及三次真实接受回执保持，分别 **15,176.800 / 14,830.400 / 14,734.700 ms**，全部失败，15 项中止保留。共 6 份冷/热快照约 1.46 MB。热刷新 workbench.js 传输大小 0、获取约 393–405 ms；主要官方 app-initial 获取约 236–395 ms、传输大小 0，但主线程出现约 2066–2100 ms 长任务。官方页面的资源记录达到浏览器原生 250 条上限，记录明确 `resourceTimingBufferFull=true`；不能据此宣称全量传输统计已闭合。

CPU 独立诊断只测桌面到正确交互 composer，不发送模型消息，不能作为接受回执或两秒样本。首次 `cpu-browser` 因原生时间差拒绝；`cpu-browser-v2` 证实 13206 个样本、6 个负微秒间隔，节点齐全、没有非有限值，首个负差 -2 µs。严格时长模式保持拒绝；`cpu-browser-counts` 改为显式计数模式，全部 selfMs/inclusiveMs/sampleDurationMs 为未知，保留负差数量，绝不钳制负值后假称测得时长。有效直方图中官方 app-initial-c4ebaa 脚本 2757 个叶样本、workbench.js 2376 个，自有 native-content.ts 12 个；主要官方位置对应 React 提交遍历。这些是脚本采样计数，采样开销未校准，不能换算成独占毫秒。

试验过在 UUID 确认前给隐藏 frame 预置目标尺寸；单次 CPU 诊断从 11673 ms 到 16108 ms，没有改善证据，已撤销这一产品修改，保留 `cpu-early-geometry` 和失败用例记录。两次不同轮次的样本不构成因果或正式性能分布证明。

试验的恢复回归另揭示两处真实缺口。精确历史 portal 到达后，临时新聊天身份可能仍阻止窗口恢复，必须等待外层 workbench 再次变化；现在仅当实际 portal UUID 等于当前精确请求时立即更新身份，未知/另一 UUID 仍隐藏。已就绪 portal 或其父结构整体替换后，原观察器仍挂在断开的节点；原有 30 秒占用观察会掩盖这一问题。初版用例在该保护期内未覆盖缺口，补为保护到期之后，用只移除新增结构观察的测试别名模块实际复现旧行为红灯（`portal-structure-expiry-red-final.log`）；最初配置导入错误单列为脚本失败，没有计成产品红灯。现在最多观察 64 层直接父链 childList，不观察兄弟正文深层变化；暂停、换文档和异常均断开并释放。`portal-events-final-after-expiry.log` 前端 **126/126**，包含到期后替换、深层正文不扫描和 64 层上限；`pnpm check` exit 0（`check-portal-events.log`）。

`portal-events-browser` 的手机页随后出现“种子回复未恢复”超时，截图却显示正确 thread、可输入的原生 composer 和原草稿。原生历史已有 6 个 completed turn，最新实际文本为受控的 REFRESH_IPHONE_ACCEPTED_1；旧种子已不在当前 DOM，不能要求官方尾部加载保留完整旧历史。新增 `codex-refresh-history.mjs`，只校验精确 thread/cwd、最新 completed turn 和受控回复 token；每轮完成后按接受 turn ID 推进预期尾部。私有诊断限定 32 个受控 turn、64 个 item，不用于长历史矩阵，原生只读检查不把正文复制进浏览器。两个 oracle 反例先红后绿，UUID、草稿及真实接受回执检查没有放宽。

下一组新聊天诊断曾在上一组结束前短暂启动，已只停止该不发送模型消息的新浏览器及 9 个自有进程，保留 `newchat-overlap-cleanup.json` 和中断记录；没有停止 private native 或正式 Agent。后续均以实际工具句柄终态确认后串行运行。`portal-events-browser` 原始失败样本保留，不能把其并行干扰或错误 oracle 误当稳定性能通过。

修正 oracle 后串行 `portal-history-tail` 的三页草稿与三次真实发送均通过，接受回执 **15,949.400 / 20,263.700 / 19,573.500 ms**，17 项中止保留，性能依旧失败。原生受控历史证据从 turnCount=6 逐轮到 9，三个精确 turn ID 均对应 completed 的最新回复。后续三页新聊天恢复正继续验收。宿主/适配器 **203/203，无跳过**（`host-with-history-final.log`），前端 126/126；这些不是全部计划、两秒或长测验收完成。


### 三端恢复收尾与资源准入补齐

`portal-newchat-tail` 完整三页检查最终 **9/9 通过、无错误**（两个桌面标签及 iPhone 16 尺寸页）。手机截图核对为官方本地输入区，保留独立中文草稿。`cpu-final-tail` 单页不发送诊断完成，正确可交互输入框 **12,174.600 ms**；CPU 采样 13,078 项含 3 项负间隔，继续仅报告计数、不换算样本时长，也不是接受回执性能通过。原生最终只读复核为精确 thread/cwd、idle、9 个唯一 completed turn、1 个 loaded thread；种子加前述三组共 8 次 UI 发送，没有向正式历史发送。最后依 PID/start ticks 和进程树清理测试：10 个自有进程全部退出，无强制信号，原生物理 socket 由所有者移除，私有 HOME/TLS/目录均删除；正式 PID 2712539、2718477、2729812 仍存活。`native-final-evidence.json`、`cleanup.json` 保留，测试入口临时端口已关闭。

资源准入此前仅使用 app-server RSS，无法发现 code-server/extensionHost 的增长。新增 `refresh-prototype/resources.mjs`，显式绑定自有 native 及调用方提供的 host/manager/gateway 根，验证 PID/start ticks/UID，遍历每个 Linux task 的直接子进程，去重覆盖重叠树；已观察、随后重托管的后代继续计入，直到该身份退出，不继承复用 PID。两遍身份/祖先关系核对，最多 32 个额外根、256 个进程、4096 个 task；未知 RSS、退出/替换的根、变化/循环祖先、超限或代次变更都使测量不可用。没有全 `/proc` 扫描、后台定时器、命令/环境留存或发送进程信号。RSS 采用两次读数较大值后求和，可能重复统计共享物理页；这是保守的进程 RSS 总和，不能称作 PSS 或操作系统硬内存上限。

`createRefreshManager` 现在要求显式 `resourceMonitor`，没有 native-only 回退；在原生状态探测后重新测量再准入。读取必须属于精确授权域/运行代次，计数完整且不超过五秒；缺失、失效和超预算均暂停新增空闲保温。状态本身也按五秒有效期撤销“可准入”，不用历史轮询维持状态。活跃/审批保护和取消订阅的原生写入边界不变；资源监测器不关闭或停止任何任务。调用方仍须明确列齐自有根，自动全宿主注册、宿主/监听器创建准入、预算定标及 30 分钟验收待完成，不能以此宣称阶段 1 已全部交付。

先红后绿证据位于 `.dev-runtime/codex-refresh-20261015-profile/`：`resources-red.log`（新模块反例）、`resources-admission-red.log`（宿主超预算仍返回 idle 的实际失败）、`resources-cycle-red.log`（循环祖先未拒绝）、`resources-stale-status-red.log`（代次变化/样本过期后旧状态仍可用）。`resources-linux.log` 还验证了真实 worker thread 启动的子进程不在主 task 的 children 中，而完整监测正确统计 2 个进程且不停止它们。固定版本原生服务回归纳入真实 native + manager 进程树，资源总和大于单 native RSS；管理连接退出不妨碍原任务完成，模型调用仍只有一次。整组及最终构建结果继续记录在后文。


最终资源整组 `resources-host-final-214.log`：**214/214、无跳过**，包括后补的代次变更撤销旧快照与五秒采样有效期红绿灯。`pnpm check` exit 0（`check-resources-final.log`），既有大 chunk 提示保留；此前前端 126/126 对应的源码在本次资源改动中未再变动。`git diff --check` 通过，`.env` 仍忽略、`.env.example` 可提交。此前在仓库根调用的 `prettier` 命令不可用；后续核实 web 工作区已安装 Prettier 3.8.1，并从该工作区限定格式化任务文件，没有安装额外依赖或运行全树格式化。资源新文件与接入点由实际 Node 测试解析并执行。

正式局域网入口重新只读核对 **https://10.30.0.24:8484/?mode=codex**（HTTPS，端口 8484）HTTP 200，三个受保护正式进程 PID/start ticks 保持。正式 Session 运行产物与磁盘仍可能不同，资源原型和构建通过都不代表正式运行层已切换。阶段 0 两秒性能仍红；阶段 1 的自动控制/可见租约、授权全桥接绑定、自动完整根清单与宿主准入，阶段 2 的完整多端操作/旧设置/长历史，以及阶段 3 的 180 次矩阵和 30 分钟长测均未完成，不宣布最终验收通过。


## RPC 关键路径、超限清理与输入安全反例

本批独立夹具为 `.dev-runtime/codex-refresh-20261015-rpc-path/`，使用新的私有 HOME、固定官方 VSIX/CLI、单个 code-server 和三个独立 HTTPS 源。诊断入口 `https://10.30.0.24:5173`、`:44593`、`:41527` 绑定局域网，仅为临时测试，不是产品配置。包装器的有界方法/ID/字节/错误码观察只在私有副本使用，真实 UI 复验前已恢复原包装器；官方 VSIX 没有修改。

`timeline/result.json` 的桌面三次普通刷新到正确可交互 composer 为 **17,203.4 / 10,163.2 / 10,980.8 ms**，没有点击 Send、没有 CPU profiler，不是接受回执关卡。原生大多数 RPC 本身只需 1–10 ms；原生 workbench 恢复在导航后约 4.1–4.46 秒，Webview 创建在 4.16–4.55 秒，portal 在 8.2–15.2 秒，composer 在 8.5–15.56 秒，thread/resume 在 9.75–16.81 秒。桥接入口约 3.25–3.51 秒，首次 initialize 仍晚约 0.73–0.79 秒。主线程长任务约 1.5–1.8 秒；相互重叠的父子 frame 数据不能累加成总 CPU 时间。分段说明启动等待与 UI 初始化仍是关键路径，不能把“原生 RPC 很快”当作两秒可操作。

`visibility/result.json` 的 A/B/A/B 自有样式诊断：原隐藏方式 **16,142.8 / 15,690.6 ms**，透明但可布局方式 **10,791.9 / 11,003.4 ms**。这是小样本诊断，尚未满足两秒。另一次 `outer-opacity` 脚本在 documentElement 尚不存在时访问 classList，产生 10 项页面错误，样本无效，不纳入改善结论，没有落入产品代码。

随后尝试只为显式 profile 的请求中 frame 提前布局，并锁定原生输入。严格浏览器检查发现 **iframe[inert] 不能阻止子文档程序化聚焦**。事件捕获取消虽可阻止按键，但超出“自有样式与观察”边界，因此撤回。CSS `interactivity: inert` 在 Chromium 145 上可阻止首次聚焦及后续编辑，却无法阻止已有焦点继续收到原生 keydown；实际源测试重新锁定后，文本不变但原生 keydown 从 8 增至 21。此反例使候选整体撤回，包括 profile opt-in、透明预布局及内层输入锁，产品仍采用原隐藏规则；没有修改官方事件流或放宽安全要求。候选源码、红灯和 `css-input-lock-failure.json` 留在被忽略的诊断目录，不作为可启用功能。

候选撤回前的 `pending-ui-v2/result.json`：两桌面加 iPhone 16 尺寸的 9 项草稿、触控和三高度重排保持，3 次真实官方 Send/tap 接受回执为 **14,441.5 / 14,906.7 / 15,086.7 ms**，均失败；`pending-newchat/result.json` 的三页新聊天 9/9、无错误。候选仍未交付，这些不是最终源码复验。组合输入继续只确认 trusted start/update 及实际中文提交，end 非可信；不宣称 iOS 系统键盘或硬件剪贴板通过。

第一次 `pending-ui` 真正触发原生消息大于 2 MiB，连接按原预算失败；错误发生在方法诊断补齐前，**尚不知道该消息的实际方法**。私有 app directory 缓存有 5006 项、8,504,651 bytes，这只能作为线索，不是帧来源证明。只读 `app/installed` 与 13 项 `app/read(includeTools:true)` 复验分别为 1395/102516 bytes，未重现该大帧；等待 30 秒的全局目录探测也没有复现。没有过滤官方 app/list/updated、改 feature flag、扩大消息限额或放宽网关背压。大消息兼容性仍是实际未解决项。

超限还暴露验收 finally 的 close 再抛出同一失败，最后的清理状态因此未保存。`native-client.close()` 现在只做幂等清理，closed 与待决 RPC 仍拒绝，未知 turn 不重发，另一独立客户端继续工作。验收脚本记录 monitor 失败并保证清理后保存。后补 `NATIVE_OUTPUT_LIMIT` 元数据最多读取已缓冲的 256-byte 前缀，仅接受严格根 method 头；params 优先或未知格式返回 unknown，不截取正文。库内部字段不可用时也只影响诊断，不改变协议决策。实际红灯为 `close-failure-red.log`、`limit-metadata-red.log`，超限与背压上限均保持。

另补 `snapshot-failure-red.log`、`snapshot-document-red.log`：原观察器读取失败或 iframe 导航后仍可返回旧 ready/thread。现在所有失败同步撤销快照和就绪，snapshot 重新验证当前 outer/active-frame 文档；恢复后的同 UUID 仍重新发布。没有轮询原生历史或把旧页面状态当作当前就绪。诊断资源时间只保留固定 endpoint operation 名，非法路径不记录；对应 `operation-timing-red/green.log` 保留。

原生 `native-final-evidence.json` 在本批第一次三次 Send 后只读确认精确 thread/cwd、4 个 completed turn、无工具项，3 次 UI 回执各出现一次。四轮 turn_context 的模型 gpt-6.1-sol、effort max、approval never、sandbox read-only 相同，说明该基线未漂移；**没有执行另一端先改设置的反例，不能据此宣布旧端恢复覆盖设置关卡通过**。最终源码的原路径 UI 复验、清理与检查见后续记录。


### 候选撤回后的原路径复验与失效事件修复

`original-ui-final/result.json` 的三页独立草稿 9/9、原生触控、659→430→852 px 重排和三次官方 Send/tap 均完成。刷新到精确 native 接受回执为 **14,588.3 / 14,713.1 / 15,238.1 ms**，`draftsPassed=true`、`performancePassed=false`、`passed=false`、`teardown=true`；17 项请求中止完整保留。该小批结果不能替代 180 次三状态矩阵。`original-newchat-final/result.json` 的三页新聊天 **9/9、无错误、passed=true**；手机 `new-chat-2.png` 已查看，官方 IDE context tooltip 覆盖部分输入的现象如实保留，没有修改 VSIX 隐藏它。

`native-original-final-evidence.json` 只读复核：种子 1 + 两批 UI 各 3 共 **7 个唯一 completed turn**，6 个 Send 回执各出现一次，无工具项，cwd 正确。7 轮实际模型/effort/审批/sandbox 与本批基线相同；仍不是旧端恢复覆盖设置的反例验收。最终状态 **notLoaded**，管理器此前因大消息失联，不能将本批发送或恢复称作持久保温命中证明。

UI 复验后补 `snapshot-inaccessible-red.log`：外层文档 getter 持续抛错时，旧 portal 的迟到 mutation 会把 ready 再变 true。失败关闭路径现在断开全部旧观察、监听、计时器及文档引用；load/snapshot 恢复时重新核对。该单一异常路径改动后前端完整 **129/129，19 个文件通过**（`frontend-original-final.log`）；三端上述 UI 成功样本对应改动前的正常路径，未伪称实际触发了这个文档异常。宿主与适配器 **217/217，无跳过**（`host-original-final.log`）。后续构建、清理与正式状态继续记录。


最终源码 `pnpm check` exit 0（`check-original-final.log`），保留既有大 chunk 警告；限定格式化通过 web 工作区现有 Prettier 3.8.1 执行，`git diff --check` 通过，`.env` 忽略且 `.env.example` 可提交。没有提交、推送或激活新的正式运行层。`protocol-metadata-copy.json` 核对并保留 14 个有界方法诊断文件，共 211593 bytes，逐项验证只有方法/ID/长度等许可键，没有正文、登录数据或 native 缓存副本。

正常复验的 browser.close 已完成；第一次异常退出由 Playwright 父进程退出清理处理。`browser-cleanup-evidence.json` 另按本夹具唯一 TLS SPKI 参数只读检查，没有对应 Chrome 进程；该参数检查仅作补充，不伪称完整浏览器后代身份清单，不触碰其他浏览器。`cleanup.json` 按最新 PID/start ticks 和运行根归属清理 **10 个自有进程，全部退出、无强制 kill**；native 物理 socket 由所有者移除，私有 HOME/登录副本/TLS 与整个临时目录删除，三条临时 LAN 端口不再可用。`formal-safety-final.json` 确认正式 Session/native launcher/native host 的 PID/start ticks 保持为 2712539/55361120、2718477/83117363、2729812/83119682。只读 `pnpm session:status` 返回 ready、仍为原运行实例，磁盘构建与运行产物不同；正式 HTTPS **https://10.30.0.24:8484/?mode=codex** HTTP 200。健康与源码构建不作为正式二进制切换或两秒通过证明。

本批未降低任何门槛，仍处于持续实施：两秒与真实大消息兼容失败；自动控制/可见租约、跨桥接持久授权绑定、持久客户端源分配与全部宿主资源准入、并发审批/旧设置反例及其他官方操作、长历史/180 次矩阵/30 分钟长测未闭合。后续应推进这些缺口，不再重复同类小批发送当作最终验收，也不能因物理手机缺失而暂停。候选默认仍未启用。

## 可见页面保护通道、原生回收竞争与 Vite 实际代理

本批证据目录 `.dev-runtime/codex-refresh-20261015-visibility-control/`。新增元数据专用 `visibility-leases.mjs`、同源 WS 路由和前端客户端，按显式 profile 接入；架构、协议和限制见 [可见页面保护连接](refresh-visibility-control.md)。默认入口没有注册该控制器，不创建保护连接。登记只包含当前真实宿主实例、递增序号和可见 thread UUID，真实 cwd 由服务端只读核对。连接固定到 manager 与宿主记录的 domain/generation/PID/start ticks，前后两次验证及 companion 实例检查不允许回退另一服务；旧宿主缺少新字段时保留原路径，不因补字段重启。

浏览器仅在 sessionStorage 保留本标签一个令牌；实际 reload 才能恢复它，新标签复制 opener 存储仍新建独立租约。连接/更新有界等待、三次连接尝试、服务端 8 KiB 消息与队列、每 profile 最多 64 个连接/租约/待处理操作；不能将这些局部限制当作最终全服务资源预算。pagehide 保留最后可见集合进入断连宽限，模式切换和后台隐藏释放自己的可见消费者，保持连接时没有租约 TTL，断连到期只释放可见保护。账号失效关闭自己的保护连接，不停止 native 或其他客户端。

先红后绿还修复三处实际行为缺口：已验证的可见目标在排队前同步固定，并在真正 unsubscribe 写入前再核对消费者/池与 native 版本，避免异步回收抢先卸载；已知成功取消订阅产生的真实 `thread/closed` 事件曾让池停在 12 项，现在仅在成功回执后取得新原生卸载证明、且两次版本/消费者仍一致才移除，未知回执继续保留且不重发；清理失败后不得继续累积消费者组，失效观察也先清空再调用，避免关闭回调递归触发 2684 次。对应 `visibility-fence-red.log`、`adapter-consumer-write-red.log`、`closed-event-red.log`、`absence-revision-red.log`、`cleanup-bounds-red.log`、`invalidation-reentry-red.log`、`host-scope-ack-red.log` 等失败记录均保留。

固定版本真实 native 的服务测试新增独立连接关闭超过一秒 native 卸载宽限后的重连保护、11→10 容量、可见项排除、释放后 LRU 以及精确 UUID/cwd/历史的 cold resume。本地受控 provider 共 13 次调用，原运行轮次只调用一次，未写正式历史。最初空 thread 尚无 rollout 的测试夹具假设错误，以及后续已持久化场景真实复现的 `12 != 10` 均保留，未将前者伪称产品 bug。最终宿主/适配器 **237/237、无跳过**（`host-closed-final.log`）；服务端当前两文件 **42/42**（`server-route-final.log`）。这些真实 native 测试与下述平台浏览器测试分别记录，不能拼接成未执行的官方 UI 整端证明。

新浏览器脚本 `tests/e2e/codex-refresh-visibility-browser.mjs` 使用原客户端源码、实际 Vite 和现有代理配置、真实 HTTPS/WS；前端绑定 0.0.0.0，本批临时局域网地址 `https://10.30.0.24:5173`。原 `/api` 代理没有启用 WS，因此专用路由使用现有原生 WS 前缀 `/native-codex/clients/<UUID>/kanban-visibility`，不修改通用代理。平台夹具只编译一次诊断客户端，显式 `watch:null`，不验证 HMR 或性能。第一次默认 watcher 实际遇到主机 inotify/EMFILE 限制，失败日志与仅删除自有临时 TLS 目录的清理记录保留；未修改主机限制、关闭别人的 watcher 或把它称为应用整组通过。

刷新测试的最初脚本在 Vite 代理只发头、不发正文时尚未提交新 document，旧连接自然仍在；等待中的 reload Promise 提前拒绝还导致清理记录遗漏。改为先提交新 document 的非脚本前缀，再保持脚本未发送，真实观察旧页面卸载；Promise 即刻处理拒绝、各清理阶段独立记录并始终落盘结果。旧失败 `browser-vite-frozen.log`、`browser-vite-reload/result.json` 及自有目录清理证明保留，没有把测试脚本问题算作产品修复或通过。

最终 `browser-vite-final/result.json` **passed=true、4 项通过、三页页面错误 0**：新标签存储复制仍保持两条独立连接，两个桌面加一手机同时保护，硬刷新空档保留三个消费者并复用原租约，手机 tap 隐藏/恢复只增减自身消费者。Chromium **145.0.7632.6**；iPhone 16 模拟实际 screen/viewport/visualViewport 均 **393×852**、DPR **3**、maxTouchPoints **1**、粗指针、无 hover，iOS/Safari UA 只是配置。该夹具明确 `platformOnly=true, officialNativeUi=false, nativeService=false, measuresRecoveryPerformance=false`，不包含官方聊天 renderer、模型发送、系统键盘、iOS WebKit 或两秒测量。正常清理的未释放消费者为 **0**，浏览器/两个监听器关闭，临时 TLS 删除，地址不作为长期入口。

本批实现了显式注册的页面保护通道，但独立持久管理/桥接控制进程、自动 profile/持久源分配、全桥接授权绑定及全部宿主资源准入仍待完成。官方两秒失败与未知大消息兼容问题保持红灯；完整官方多端审批/设置反例/操作、长历史、180 次矩阵与 30 分钟长测仍未验收。最终源码检查及负向浏览器结果另接后文，目标继续实施，不能据本批功能定向通过启用候选路径。

本批最终源码前端 **136/136，21 文件**（`web-route-final.log`），最新服务端 **42/42**、原生 **237/237 无跳过**；`pnpm check` **exit 0**（`check-final.log`），既有大 chunk 提示保留。`git diff --check` 通过，`.env` 仍被忽略、`.env.example` 可提交，未提交或推送。格式化仅使用 web 工作区已有工具并限定任务文件，保留其他并行修改。

实际 Vite 负向 `browser-vite-negative/result.json` 在编译副本去掉 reload 判别，按预期以 `cloned new tab must keep both protection connections` 失败、exit 1；它是验证反例能抓住缺陷，不能算作功能通过。正负两组各自清理均为 `unreleasedConsumers=0, privateTlsRemoved=true`，正向四项及零页面错误保持。无模型输入或正式 native 连接。

`formal-safety-final.json` 与只读 `session-status-final.log` 再确认正式 HTTPS **https://10.30.0.24:8484/?mode=codex** 和后端健康均 HTTP 200，正式 Session/native launcher/native host 的 PID/start ticks 保持 **2712539/55361120、2718477/83117363、2729812/83119682**。正式 Session 仍 ready、磁盘产物与运行产物不同，没有因编译或本批隔离验收激活新运行层或停止 Agent。正式候选仍未启用，两秒及完整验收仍未通过；下一批推进独立持久控制进程和剩余官方关键路径。

## 独立持久管理进程与真实退出保护

本批证据目录 `.dev-runtime/codex-refresh-20261015-control-process/`，架构与显式 owner API 见 [独立管理进程](refresh-control-process.md)。新增 `control-service/worker/channel/peer.mjs`，让既有 manager、资源监测器、10 项池与页面租约由独立 detached Node 进程持有。网关经单独的私有 Unix JSONL 通道登记页面；控制进程从每次内部 `assertCurrent` 反向调用网关的真实宿主核对，不把一次握手当作后续操作授权。通道只接受保护元数据，不转发 native RPC、用户提交、审批或中断；CLI 包装器仍走既有路径，完整官方桥接授权绑定没有冒充完成。

启动只接入已验证 native，使用新 `0700` 目录、`0600` 配置/能力记录、固定 PID/start ticks/native scope、socket inode/dev 和随机控制代次；就绪记录完整写入并同步后原子发布，不覆盖旧文件。重用显式 attach，现有/过期状态或启动超时均保留记录，不隐式新建 native、替换进程或接管默认 CLI socket。控制进程只继承环境允许名单、使用私有 HOME；测试完全没有复制登录数据或正式历史。消息/待写/部分帧上限 8192 bytes，严格 UTF-8；每 peer 待决/处理请求最多 64，全进程同时登记最多 64，固定 profile/网关连接各最多 32，保留最近 256 个来电 ID。未知回执不重发。公共 socket 是私有 bind socket 的硬链接，关闭只按 inode/dev 删除仍属自己的公共 endpoint；替换文件实际保留的用例通过。

真实 `refresh-control-service.test.mjs` 使用固定未修改 CLI、私有 HOME 和 loopback 受控 provider。创建管理进程的父进程退出后，独立控制仍由新网关连接附着；原运行 turn 和已完成空闲上下文跨超过 native 一秒宽限的断连保留。清空全部页面可见消费者后，空闲上下文仍出现在真实 `thread/loaded/list`，证明由池持有；随后仅显式关闭自己的控制进程，空闲上下文按原生宽限卸载，运行 turn 仍 active，并由原接受 turn ID 完成一次。该夹具共 **两次本地模型调用，running 一次、idle 一次**；正式服务未写入测试任务。最终记录 `idle-native-final.log`、`service-cleanup-final.log` 均 **2/2，无跳过**。旧的初始单运行场景只有一次调用，保留但不替代最终空闲场景。

开发期间捕获并修复三项红灯：`observer-rollback-red.log` 在多 profile 初始化达到观察器预算后遗留 **2** 个观察器，现在失败回滚已创建控制器；`replaced-callback-red.log` 证明一个页面回调抛错导致其他页面 `available=false`，现在异常局限于该页面。第一次 `control-green-final.log` 实际为 **9/10**，失败来自活跃 PID 的短命工作线程 children 在读取期间退出（ENOENT），该失败完整保留。`identity-task-red.log` 对自有模块测试副本只替换文件系统导入，确定性注入 task 消失；PID 捕获改为双读 stat 与 UID/proc inode/start ticks/非 zombie 核对，完整 RSS 测量仍枚举全部 task 并因同一注入缺测而失败，未减小统计范围或放宽阈值。修复后 `identity-control-green.log` **19/19**，后续还有回调反例及最终整组。

最终宿主与适配器 **249/249、无跳过**（`native-full.log`，`--test-concurrency=4`，明确提供固定 `NATIVE_CODEX_REFRESH_CLI`）；后补夹具清理只改测试，重新跑真实服务 **2/2**（`service-cleanup-final.log`）。服务端 **43/43**（`server-control.log`），新增实际 profile 路由经真实私有通道执行 verify，native generation 改变后返回 unavailable 且不清空旧保护。控制器的检查超时会关闭自己的通道，不重试或迟到创建消费者。生产前端源码本批未变；上批 136 项没有冒称重新运行，当前 `pnpm check` **exit 0**（`check-final.log`）重新完成 shared、运行层、前后端类型与生产构建，保留既有 chunk 提示。

浏览器 `browser-control/result.json` 经实际 Vite/HTTPS/WSS → 网关 → 私有通道，**4/4、页面错误 0、passed=true**：新标签复制存储仍独立、两桌面加手机共同保护、真实刷新脚本空档复用租约、手机 tap 只改变自身消费者。手机实际 screen/viewport/visualViewport 均 **393×852**、DPR **3**、maxTouchPoints **1**、粗指针、无 hover；Chromium **145.0.7632.6**，iOS/Safari UA 只是模拟。临时 LAN 地址 **https://10.30.0.24:5173**（HTTPS，端口 5173，前端绑定 0.0.0.0），测试结束已关闭。`browser-control-negative/result.json` 仅对编译副本去掉 reload 判别，预期在第一项失败、exit 1；正负两组清理均 `unreleasedConsumers=0, privateTlsRemoved=true`。

平台结果显式 `throughPrivateControl=true, managerInSeparateProcess=false, nativeService=false, officialNativeUi=false, measuresRecoveryPerformance=false`：平台 manager 仍是同进程夹具，不能与另一项真实 detached/native 测试拼接为尚未执行的官方整端证明。没有以该功能检查替代两秒、真实 iOS/系统键盘或 180 次性能批次。

`git diff --check` 通过，`.env` 忽略、`.env.example` 可提交，没有提交/推送。`formal-safety-final.json` 和 `session-status-final.log` 重新只读核对：正式 HTTPS **https://10.30.0.24:8484/?mode=codex** 与后端健康均 HTTP 200，受保护 Session/native launcher/native host 的 **2712539/55361120、2718477/83117363、2729812/83119682** 保持；Session ready，磁盘与运行产物仍不同，没有激活新运行层或停止正式 Agent。本批四种新测试目录前缀的残留数均为零；这是测试目录检查及各用例关闭断言，不伪称全主机进程扫描。

独立持久管理组件已实现，目标继续 active。剩余完整官方 CLI 授权、自动 profile/持久来源/全部宿主根与监听器准入、实际大消息兼容、官方多端审批/旧设置/其他操作、长历史、两秒/180 次矩阵/30 分钟验收仍未完成；正式入口不启用候选。下一批优先推进完整桥接授权与剩余官方关键路径，不用物理手机缺失或本批组件通过缩小最终目标。

## 显式桥接账号绑定、逐条写入保护与真实撤销

本批证据目录 `.dev-runtime/codex-refresh-20261015-bridge-authority/`，实现与限制见 [桥接授权](refresh-bridge-authorization.md)。新增可选 `--refresh-control-root`，仅由 launcher 命令行显式提供，并依赖已有 refresh service 参数；不创建或替换 native/control 服务。新生成 wrapper 固定 native 与 control 双重 generation/PID/start ticks，私有能力令牌不嵌入 wrapper。控制代次变化即使 native 仍存活，也拒绝旧身份，包括 `--version` 不输出成功文本。普通旧宿主不因此重启或隐式升级，自动纳入所有 profile 仍未完成。

每个受控 wrapper 经私有控制通道读取 manager 摘要，并用独立初始化的原生只读账号观察连接核对两次 `account/read(refreshToken:false)`，须与前后 manager 摘要一致才开放官方连接。原官方 initialize、opaque ID 和数据保持，观察连接只读账号，不读取 thread/正文或发送用户操作。账号边界、控制连接/原生观察连接丢失撤销 grant；每条真正 `ws.send` 前同步核对，包括同输入块的后续 JSONL。Promise guard 不授权，失效后不再恢复 stdin，未知提交不重发。显式 owner SIGTERM 是正常客户端收尾，不被误报成授权失败，不发送 native shutdown/turn interrupt。

`manager-initial-red.log` 两个实际反例转绿：初始绑定期间第二次同值账号通知原来被继续当作初始通知；无关 turn 完成却改变统一 revision 导致误撤销。共享账号 tracker 现在只接受一次初始通知，账号边界与任务版本分开；任务版本仍保护回收写入。`control-send-red.log`、`async-guard-red.log`、`bridge-auth-red.log`、`control-flag-red.log` 分别记录实际写入缺少检查、异步 guard 被忽略、绑定组件/flag 缺失，后续定向通过。

最初 `owner-stop-red.log` 在保护登记阶段出现泛化 unavailable，未到目标停止分支；`owner-stop-diagnostic.log` 在 worker readiness 前失败，两者缺少足够根因信息，保留且不计为 owner 停止反例或已修复根因。增加私有固定诊断后，`owner-stop-classified.log` 真正到达目标并复现 **owner 退出码 1 != 0**，修复后通过。`startup-diagnostic-red.log`、`resource-code-red.log` 先红后绿：启动只保留 state/stage/code/category，私有 RPC 只保留许可资源错误码及操作名，不复制异常文本；恶意配置标记未出现在记录。此前未分类样本不能由后来通过推定已经归因。

在补充运行中撤销时，`native-active-logout-final.log` 另捕获 fixture 在首轮完成/落盘前读取历史的 **-32601 / list_turns is not supported yet**。改为先等待精确 turn ID 的原生完成通知，再核对该持久历史；没有重发模型调用或放松完成断言。`native-completion-notice-final.log` **3/3 无跳过**，随后最新源码整组见下。

真实测试使用固定 CLI、全新无登录 HOME、loopback 受控 provider，直接运行生成的 CLI wrapper。两个原生客户端都用请求 ID **7**，分别返回 running/idle 的正确 thread；关闭第一个后另一个仍可只读请求。控制退出关闭原受控 CLI，原 turn 保持 active；新控制进程通过显式新目录接入，新 wrapper 仍拒绝旧控制身份。正常 owner SIGTERM 客户端 exit 0，不影响另一个连接。真实 `account/logout` 在无认证 provider 下仍产生账号边界，受控旧 CLI 失败退出；原 turn 在此后仍 active，释放夹具后以原接受 ID 完成一次。该批模型总调用 **2 次（running/idle 各 1）**，没有正式登录副本或正式历史写入。这不是实际 ChatGPT token 注销/刷新或组织切换验收。

新增活动操作内的资源完整复测：仅对明确 `REFRESH_RESOURCES_UNAVAILABLE` 最多完整读三次、间隔 25 ms；持续缺测仍 `resources.available=false, warmAdmission=false`，保留活动观察，账号在间隙撤销会阻止下一次测量。原进程/task 全量范围、代次、五秒新鲜度及 RSS/数量上限保持，没有背景轮询或 native RPC 重试。`resource-resample-red.log` 记录瞬时缺测后不再取得完整样本的反例。第一次 `resource-resample-green.log` 的新增测试误把“停止保温”写成“整个 manager 必须失败”；按原 pool 的既有失败保护修正新用例，明确断言 ready 观察保持但不可保温，没有删除旧保护或放宽阈值。

最终宿主/适配器 **263/263、无跳过**（`native-resample-final.log`，明确固定 `NATIVE_CODEX_REFRESH_CLI`，并发 4），包括真实运行中账号撤销、owner 停止、旧控制代次、绑定中取消及资源复测。本批较早的 `native-full.log` **261/261** 也保留，不能替代后补用例。服务端 **43/43**（`server-final.log`）。浏览器 `browser-platform/result.json` 经实际 Vite/HTTPS/WSS/私有通道 **4/4、零页面错误、passed=true**，iPhone 16 模拟为实际 393×852、DPR 3、触点 1、粗指针且无 hover，Chromium **145.0.7632.6**；测试临时 LAN HTTPS **https://10.30.0.24:5173**，绑定 0.0.0.0，结束后关闭，清理 `unreleasedConsumers=0, privateTlsRemoved=true`。明确 `officialNativeUi=false, nativeService=false, managerInSeparateProcess=false, measuresRecoveryPerformance=false`，不与另一项真实 native CLI 测试拼接成官方 UI/两秒证明。

**下一项必补：**新 manager 重新附着同一个 native 时，仍缺少该 native 代次的持久初始账号锚和撤销记录；目前连接期 tracker 的不可恢复失效，不足以证明跨 manager 重建不会把新账号带入旧 loaded contexts。此项继续列为正式启用前的缺口，下一批优先在 native 所有者记录上绑定初始授权并验证撤销后不能重新接入旧代次。自动 profile/持久来源/完整宿主资源准入、真实 ChatGPT/OAuth、原生大消息、官方多端审批/设置/其他操作、长历史、两秒/180 次矩阵/30 分钟长测仍在原目标中。正式候选仍未启用，最终构建及正式状态另接后文。

最后增加诊断额外字段反例 `diagnostic-extra-red.log`：父进程与 worker 均按严格固定字段/枚举复制，未知字段或错误类别被拒绝，避免把未来附加错误负载复制进 owner 报错。最新全组 **264/264、无跳过**（`native-diagnostic-final.log`）；`pnpm check` **exit 0**（`check-final.log`），前后端生产构建与类型检查通过，保留既有大 chunk 提示。前端产品源码本批未改，上批 136 项没有冒称本批重新运行；平台 4 项与服务端 43 项仍按各自证据范围记录。`git diff --check` 通过，`.env` 忽略、`.env.example` 可提交，没有提交或推送。

`formal-safety-final.json` 与只读 `session-status-final.log` 核对正式入口 **https://10.30.0.24:8484/?mode=codex**（HTTPS，端口 8484）及后端健康均 HTTP 200。正式 Session/native launcher/native host 的 **PID/start ticks 为 2712539/55361120、2718477/83117363、2729812/83119682**，保持不变；Session ready，磁盘与运行产物不同，未激活新运行层或停止 Agent。本批五种独立控制测试目录前缀残留均为零，正常浏览器清理未释放消费者为零、临时 TLS 删除；目录检查不伪称全主机进程审计。native 初始授权持久锚及前述完整关卡仍未完成，目标继续 active，不宣布最终验收通过。

## Native 初始授权锚、持续观察与跨管理器撤销

本批证据目录 `.dev-runtime/codex-refresh-20261015-authority-anchor/`，协议与启动边界见 [持久授权锚](refresh-native-authority.md)。新 `startPrivateService` 在 ready 前启动独立 detached 授权观察进程，实际 initialize 后读取两次原生账号并确认初始通知，原子发布私有初始账号摘要/native scope/观察进程身份。观察器跨创建者和 manager 退出保留，不读取 thread/正文或发用户操作。`service.json` 固定观察器代次/PID/start ticks；缺少锚的旧候选记录不静默补写，不通过重建观察器采用旧上下文。

每个新服务客户端保持独立授权连接，实际账号须匹配原始锚；新 manager 和桥接在 thread 操作前再次确认原始摘要。账号边界即使摘要相同也持久撤销，观察连接/进程失联则拒绝接入。原始记录不改绑。服务资源监测器自动加入 detached authority 根，完整计入 RSS/进程/task 预算；其他宿主的自动注册仍待完成。

`anchor-red.log` 保留模块缺失的四个失败用例；`adoption-red.log` 保留新 manager/bridge 未确认原始锚与漏计观察器 RSS 的三项实际失败。`native-wire-red.log` 确认 NativeClient 没有将生命周期 guard 传给 transport 时，撤销后仍发送；传到真正 ws.send 后转绿。`consumer-revoke-red.log` 又实际复现客户端撤销文件写入失败后其他授权连接存活，现由已握手 revoke 通知独立观察器关闭全部自有通道，写盘失败仍拒绝后续接入。`bridge-anchor-write-red.log` 复现官方 guard 未同步核对锚，现增加原客户端 `assertAuthorizationCurrent`，不再只等异步连接关闭。所有未知回执仍不重放，既有 8 KiB 控制通道及 native 消息/背压预算保持。

真实固定 CLI 和未修改 VSIX 使用全新无登录 HOME、loopback provider。创建者退出后授权观察进程与 native 保留；显式替换 control/manager 不重建初始锚。实际同值 provider 的 account/logout 后，旧受控 CLI、新服务客户端与新 manager 均拒绝授权；独立自有诊断 oracle 发起这次无登录夹具的 logout，此后只读核对原任务状态和历史，原 accepted turn 此后仍 active，释放模型后以原 ID 完成一次，模型共两次调用（running/idle 各一次）。另在服务用例结束时按自有 PID/start ticks 精确 SIGKILL 授权观察器，确认没有撤销文件仍无法新接入，native 保持存活且原轮次历史可读。这不等于真实 ChatGPT token/OAuth/组织切换或官方 GUI 已验收。

本批未改前端产品源码，未将上一批 Vite/HTTPS/WSS/iPhone 16 的四项平台通过冒称为本批新增官方 UI 证明；用户确认的 393×852/DPR 3/触控模拟继续有效。原两秒失败样本、原生超限大消息、自动 profile/持久来源/全部宿主资源准入、完整官方多端审批/设置/其他操作、长历史、180 次矩阵和 30 分钟长测仍保留为待完成项。正式候选默认未启用。最终整组/构建与正式运行安全证据接后文。

后续复核又发现单请求回收 guard 仍在输入队列入口执行。`request-write-red.log` 复现 lifetime guard 阶段出现新可见消费者后，旧单请求检查已经通过、unsubscribe 仍被发送。现在按原请求 ID 将请求 guard 保留到真正 ws.send 前，已超时/不再 pending 的请求不迟到发送。明确未发送的 veto 以 NATIVE_NOT_SENT 拒绝该请求并保持连接及其他订阅；`request-veto-connection-red.log` 先复现直接关闭连接会让后续 account/read 失败，修复后 `request-veto-green.log` 通过。首次 `request-write-green.log` 是实现迭代中把无 ID 的 initialized 通知误查为 pending 请求，导致两项通知等待超时；已修复，失败保留，不把它写成旧产品根因或成功结果。所有大小/背压阈值、未知回执不重放和原生任务保护保持。

`native-request-final.log` 整组 **274/275**，旧 client 授权测试要求保留原 veto 原因，而新增代码统一文本丢掉该原因；现保留至多 256 字符的原自有 guard 原因并增加明确未发送错误码，没有删除或放宽旧断言。`lifetime-veto-code-red.log` 又验证生命周期 guard 不能误用同名 veto 码保留连接，账号生命周期检查失败统一关闭 transport，只有单请求检查可取消当前未发送请求。兼容性定向日志 `guard-compatibility-green.log` 与最终整组另接后文，之前 274 项绿灯不替代这些后补检查。

最终 `native-compatible-final.log` **275/275、无跳过**，显式固定匹配 CLI、并发 4；包含真实原生创建者退出、同值账号撤销、新 manager 拒绝、原 turn 完成一次、观察进程 SIGKILL 后拒绝新接入、实际请求写入 veto 与连接保留。`guard-compatibility-green.log` **26/26**；`pnpm check` **exit 0**（`check-final.log`），保留既有大 chunk 提示。后补改动仅为该 MJS 协议层，最新整组已覆盖；前端/服务端产品源码本批未改，未冒称重跑此前 136/43 项。任务文件使用现有 web Prettier，`git diff --check` 通过，`.env` 忽略、`.env.example` 可提交，未提交或推送。

`formal-safety-final.json` 在最终原生整组结束后再次核对：正式 LAN **https://10.30.0.24:8484/?mode=codex**（HTTPS，端口 8484）与后端健康均 HTTP 200；正式 Session/native launcher/native host 的 PID/start ticks 保持 **2712539/55361120、2718477/83117363、2729812/83119682**。`session-status-final.log` 仍 ready、运行产物与磁盘不同，未切换运行层或停止正式 Agent。四种本批测试目录前缀残留为零；测试自身按精确所有者身份清理 native/observer/control，此目录检查不代表全主机进程审计。持久授权锚的隔离实现和本批验收完成，前述完整官方 UI、性能与长测关卡仍未通过，目标继续 active，候选未启用。
