# Codex 模式启动与窗口切换提速：实施前审计与计划

状态：用户已 review 通过，实施中。日期：2026-10-27。以下基线仍为实施前只读审计。

## 当前入口与基线

- 正式 LAN 入口为 **HTTPS `https://10.30.0.24:8484/?mode=codex`，端口 8484**；前端监听 `0.0.0.0:8484`。`pnpm codex:status` 为 `broker-ready`，入口与 `/api/native-codex/status` 返回 HTTP 200。本机一次 HTTP 采样分别约 9 ms、73 ms，不能代表浏览器可输入。
- 隔离 Chromium 新上下文，桌面 1440×900 与 iPhone 16 尺寸模拟 393×852、DPR 3、触控模式各一轮：DOM ready 约 0.25 秒，Codex 外壳约 0.28–0.31 秒，外层 iframe 约 0.81–0.89 秒，原生宿主标记约 3.34–3.68 秒，可见原生窗口约 6.34–6.41 秒。另两轮测到窗口 `data-kanban-native-interactive=true` 约 16.83–16.99 秒。这些是不同轮次的小样本，不能拼成同一条关键路径或宣称 p95。
- 已预加载的第二标签精确选中约 222–256 ms；模式按钮到外壳状态变更约 99–266 ms。首次会话→Codex 的 Playwright 点击完成曾约 2.3–3.9 秒，但包含动作可点击等待和懒加载，尚未拆出真实可输入时刻。`/api/native-codex/focus` 的三次回执约 37–95 ms，不足以解释全部等待。
- 当前探针不能把内层跨源 Webview 的 DOM 查询失败当成“没有 composer”；真正可操作终点须用原生正确目标、可命中输入区及精确回执验证。手机第二标签的一次 Playwright `click` 超时也是测试选择器／可见区域问题，已用精确标签身份复测，不能计为产品失败。
- 正式宿主在多轮新浏览器上下文测试期间，从约 2.6 GiB／866 tasks 增至约 4.7 GiB／1838 tasks；14 份扩展日志含 `EMFILE`，近期仍有文件监听失败。资源增长与本轮测试同现，尚未建立每个进程的归属及根因；不能靠停止现有 Agent、宿主或其他进程清场。
- 工作区已有 2026-10-26 窗口 409、启动错误识别和历史通道的未提交改动，正式宿主已加载其 companion。后续只做任务范围内的追加改动，先记录暂存内容与运行身份，不覆盖或提交这批现有工作。

## 拟实施顺序

1. **建立正确的性能量尺。** 在自有前端、伴随扩展和只读验收脚本中记录进入/回切事件、外壳、SW 检查、iframe、VS Code workbench、实例标记、精确编辑器打开、原生 Webview、composer 命中、焦点回执的分段时间。仅保存数值、固定阶段和受限计数，不记录聊天正文、完整 URL、账号或原始协议。区分冷进入、缓存进入、普通刷新、已挂载模式往返、未打开与已打开标签切换。
2. **先解资源压力。** 对本服务自有的浏览器连接、extensionHost、app-server、文件监听与订阅建可核对的创建／断开账本；复现关闭测试浏览器后任务/RSS 是否回落。仅对可证明由测试创建且无运行任务／审批的连接制定回收策略，保留已有活跃实例。`EMFILE` 先分辨内核实例、文件描述符与重复 watcher，确认后才改自有连接生命周期或启动配置；不修改官方 VSIX、全机限制或其他工作树进程。
3. **缩短进入关键路径。** 根据分段结果减少自有串行等待；保持官方 Webview、原始 iframe 父节点和 MessagePort。检查 SW 探针、原生资源缓存及 code-server/Webview 初始化；静态资源缓存只覆盖版本化文件，不缓存认证、HTML、状态或 RPC。继续只打开当前可见窗口，项目历史和非关键导航请求不得阻塞正确窗口的输入就绪。
4. **缩短窗口与模式往返。** 已挂载 iframe 不重新创建；用精确 host generation、thread UUID、列和当前原生焦点证明可复用时才跳过重复工作。对快速 A→B→A 切换合并尚未提交的过时焦点请求，保留已提交操作的顺序与迟到回执防护；当前目标在原生确认前仍不能接收输入。测量手机单窗／窗口组、桌面标签／分屏与会话、终端模式往返。
5. **红绿灯与真实验收。** 每项行为改动先加可复现失败测试，再实现转绿；新增功能同步 `docs/func_list.md`，每个修复记入 `docs/debug_list.md`。运行 Codex 前端、网关、native host 定向测试及 `pnpm check`。隔离宿主做桌面 Chromium、iPhone 16 尺寸 Chromium/WebKit 的冷／热进入、多个标签、快速切换、刷新、草稿保留、正确 UUID 与焦点、运行和待审批保护；正式 LAN 入口做只读回归。至少按已有刷新方案的 30 次每类样本报告 p50/p95/最大值，并单列冷启动与资源/30 分钟长测。原有 2 秒热恢复关卡按“正确目标官方 UI 可实际操作且精确回执”判断，不以外壳、iframe、HTTP 202 或平均值替代。

## 不可越过的边界

不停止活跃 Agent／原生任务，不隐式迁移 writer，不复用未经授权的登录或历史，不修改官方 VSIX，不放宽现有 WebSocket/RPC 大小和背压预算，不用隐藏错误或假就绪换取更快数字。正式启用须先在独立宿主通过资源与桌面／手机验收，再按当前项目安全窗口发布；旧运行层和无关暂存改动保持原状。

## 第一批实施记录：资源上限与观察器扫描

- `/proc` 核对正式宿主一度有 6 个 app-server，合计 1009 条线程；抽样进程各有约 152–153 条 `tokio-rt-worker`。独立无登录 CLI 的三轮初始化：默认总线程 168、141–153 ms、RSS 约 110–111 MiB；设 `TOKIO_WORKER_THREADS=8` 后总线程 24、155–161 ms、RSS 约 93–94 MiB；设 4 后总线程 20–21、134–166 ms。该小样本只证明线程与启动 RSS 下降，没有证明官方页面更快。
- 自有宿主现在默认将官方子进程 Tokio 工作线程限制为 `min(available CPUs, 8)`，可经严格验证的私有参数选 1–32，记录实际值。两个跨 service/launcher 的测试先红后绿，完整 `host.test.mjs` 与 `service.test.mjs` 共 40/40 通过。正式在运行的原生宿主未重启，仍使用旧环境。
- 隔离刷新候选的 `startPrivateService` 也采用同一线程上限；无效参数在创建记录或进程前拒绝。匹配原版 CLI 的真实无登录本地模型夹具在显式 `NATIVE_CODEX_REFRESH_CLI` 下通过私有服务生命周期与页面租约／空闲回收两项行为测试，并核对 native 进程实际 Tokio 线程数不超过 16。默认跳过不能替代这次实跑；正式刷新候选仍未启用。
- 原生内容观察器此前每次检查 writer lock 都读取聊天根节点全部 `textContent`。新增“整根读取会抛错”的失败用例后，改为仅从 Retry 控件检查有界局部通知；`native-surface.test.ts` 44/44 通过。真实长历史 CPU 与页面输入耗时仍未验收。

## 隔离官方页面分段结果

使用全新私有、无登录、loopback HTTP 宿主，匹配 `26.51007.21434` 原版 VSIX／CLI，显式 8 条 Tokio 工作线程，没有接入正式账号、网关或默认 IPC。真实原生 app-server 约 28 条总线程，说明 launcher 的环境约束到达实际插件子进程。桌面 Chromium 首次 navigation→官方控件约 **12.25 秒**，同浏览器普通 reload 约 **7.16 秒**；iPhone 16 参数（393×852、DPR 3、触控）的 Chromium 首次约 **12.26 秒**，无外层水平溢出。均未发送任务，也未用 onboarding 按钮当 composer 回执。

桌面首次 VS Code `didStartWorkbench` 约 2.51 秒，原生 Webview ready 约 4.95 秒；Webview 的四个 `app-initial` JS 等合计约 19.4 MiB 解码大小，直到约 12.25 秒才出现官方控件。reload 时 `didStartWorkbench` 约 2.92 秒、Webview ready 约 2.95 秒，控件仍到约 7.16 秒才出现。`workbench.js` 约 19.2 MiB 解码大小并已用 Brotli 及一年缓存；原版 Webview 的 app-initial 响应显示 `no-cache`，但 VS Code Service Worker 自有 ETag/304 缓存路径可返回合成 200，不能由此认定每次都完整重传 19.4 MiB。浏览器长任务跨 frame 有重复，不能相加为独占 CPU。

本机 Playwright WebKit 因缺少运行库在浏览器启动阶段失败，未取得 WebKit 手机结果。隔离宿主和浏览器已全部关闭，逐 PID 核对无残留，再删除专属临时运行目录；正式服务主 PID 保持 4129030 且仍 active。后续优先处理 Webview/可见目标的真实等待，不对已缓存的静态资源盲目重复压缩。资源上限对现有宿主尚未生效，须在安全窗口由新宿主加载并单独验收。

## 正式入口只读切换与环境限制

正式 LAN 桌面独立浏览器未发送消息或审批：初始新聊天 45 秒内仍没有可输入 composer，虽有可交互原生 frame，故不判为就绪。点击另一条尚未打开的历史会话后，正确 UUID 的原生 composer 约 **20.5 秒**可操作；再点回新聊天 30 秒内仍无 composer。该样本只说明一次冷历史打开确实很慢；新聊天可能处于引导／失败／占用，未确认具体类型，不能把它当成热切换性能样本。请求记录含精确 `/focus` 与 `/resume-beside` 的 202，但接受打开命令不等于页面可输入。

正式服务在测试浏览器关闭后仍保持主 PID 4129030；资源数随连接回落。与此同时当前 UID 的 inotify 实例为 **125/128**，其中 `codex` 进程约 71 个，正式原生服务当时未持有成功创建的实例；多个扩展日志仍含 `EMFILE`，部分含 `renderer_ready_timeout`。这是系统范围的同 UID 资源压力，不能由当前测试断言某个特定 PID 是故障根因。按已批准的边界，不停止用户的 Codex／其他服务，也不改全机内核限制。正式资源环境下的完整两秒矩阵目前不具备绿色证据。

窗口交互修复：原已选中且健康标签的重复点击会撤销有效焦点回执并多发 `/focus`，现直接保持可输入状态；真正焦点失败仍可显式重试。等待中重复点击也不积累焦点请求。Codex focus 测试先红后绿，8/8 通过。

最新定向验收：native host/adapter 339 项中 334 通过、5 项按原条件跳过；Codex 前端 22 文件／148 项通过；受控原生 DOM 浏览器窗口不重叠 1 项通过。一次全量 `pnpm check` 曾读到并行 Session 草稿测试的 `writeId` 类型错误，待该并行改动修复后重跑已退出 0，包括 shared、运行层、后端类型和前端类型／生产构建。正式原生宿主仍使用旧进程与旧线程环境，构建通过不等于部署。

## 桌面和手机的固定构建切换回归

`tests/e2e/codex-workbench-shell.spec.ts` 的旧模拟宿主缺少 `code/didStartWorkbench` 标记，现补齐真实启动契约；终端模式切换夹具还补空会话快照并隔离 WebSocket，不连接正式会话流。原桌面用例先因历史按钮不可用失败，修复后转绿。测试使用已构建的静态前端，由自有 `vite preview --host 0.0.0.0 --port 18517` 提供，局域网 HTTP 地址为 `http://10.30.0.24:18517/`；Playwright 在同一监听端口的 loopback 安全上下文执行，所有 `/api/**` 与 `/native-codex/**` 响应均由夹具拦截。

桌面 1440×900 与 iPhone 16 尺寸模拟 393×852、DPR 3、触控各执行 30 次两个已打开标签交替，以及 6 次 Codex→终端→Codex。每次等待选中标签及正确原生 iframe `data-kanban-native-interactive=true`，并检查 iframe DOM 身份及未发送原生草稿保留。固定构建上该测试文件 11/11 通过，计时输出写入 Playwright 的 `controlled-warm-switch-timing.json`；样本如下：

| 受控场景 | 30 次标签往返 p50/p95/最大 | 6 次模式回切 p50/p95/最大 |
| --- | --- | --- |
| 桌面 Chromium | 64/80/154 ms | 108/470/470 ms |
| iPhone 16 尺寸 Chromium | 63/149/161 ms | 84/438/438 ms |

以上是模拟官方页面的**自有外壳**计时，不包含真实官方 Webview 新建、账号、模型回执或真实手机 Safari，不能替代已观察到的 12–20 秒真实冷路径，也不能作为两秒刷新关卡通过证据。开发服务上的前两轮长测曾被不完整终端夹具及页面重载打断，未计入上述样本；固定构建复测才计入。独立预览仅为验证而启动，不替换正式 8484 服务。

最后一轮构建核对：native host 启动／service 定向 52 项中 51 通过、1 项按未提供真实 CLI 条件跳过；全量 `pnpm check` 已通过 shared、TS 运行层、后端构建，但前端类型检查被同工作区并行修改的 `RunningTurnChanges.test.tsx:47` 中 `getByRole(..., { exact: true })` 阻断。未改动该无关文件；仅排除这一项的临时前端 TypeScript 检查退出 0。计时修订后的桌面／手机两项浏览器复跑 2/2 通过，全部 11 项曾在本轮固定构建上通过。当前 UID 的 inotify 实例在自有预览／测试浏览器关闭后仍为 125/128（进程名 `codex` 合计 71），宿主主 PID 4129030 保持 active；`pnpm codex:status` 此时为 `host-ready-awaiting-browser`，属于只读状态，不能据此宣称正式对话已验证或优化代码已部署。

## 进入前置检查并行化

前端原先在 `/api/native-codex/status` 成功后才执行 Service Worker 注册／注销预检，两条独立等待串联。现在首次进入 Codex 时立即发起预检，宿主状态同时读取；只有状态可用且预检成功才挂载原生 iframe。宿主不可用时不把预检结果抢先显示为连接故障；显式重试仍重跑预检且不销毁已经挂载的原生 iframe。失败用例先确认状态仍悬挂时预检调用数为 0，修复后确认两者并行、预检未完成前没有 iframe；焦点测试 9/9、受控浏览器证书失败不挂载 1/1 通过。

这项改动消除自有前置检查的串行关系，但尚无真实浏览器前后 A/B 样本证明具体节省毫秒数，更不改变隔离官方 Webview 的 7–12 秒冷初始化。其间完整前端类型检查曾被并行 Session 文件 `sessionSubmissionIdentity.test.ts` 的声明错误阻断，未修改该无关工作；随后同工作区改动完成，重跑 `pnpm check` 退出 0，包含 shared、TS 运行层、后端和前端类型及生产构建。Codex 模式 22 文件／149 项、Prettier 和受控证书浏览器 1 项通过。

在正式 LAN HTTPS 来源的全新隔离 Chromium 页上，仅运行同一 Service Worker 注册／注销预检（没有挂载应用或连接原生宿主），证书 SPKI 校验后 5 次耗时为 **14/7/6/6/6 ms**。未信任证书的普通 `ignoreHTTPSErrors` 浏览器仍报 `SecurityError`；这也是证书门控需保留的实证。此采样表明并行化节省的通常只是毫秒级，不可把它作为十几秒冷启动的主要改善。网关目前已仅对固定 `stable-<hash>/static` 且上游允许缓存的资源设置 immutable；官方 Webview hashed JS 已由原 Service Worker 在刷新时返回 304，因此没有进一步改写缓存或官方包。并行化后的生产构建上，受控浏览器整组 11/11 通过，桌面／手机 30 次标签及 6 次模式往返仍保持原生 iframe 与草稿；没有取得真实官方 Webview 的前后速度 A/B。

再次核对自有宿主启动：`buildHostStartup` 只生成 **1 个**初始新聊天 UUID，`openNewChatPanels` 仅对传入的该窗口执行 `vscode.openWith`；第二个窗口由用户显式操作时才创建。现有冷启动不是两个默认 Webview 同时加载造成，不能再通过减少初始窗口数量获取收益。若需进一步缩短 7–12 秒官方页面初始化，须用真实隔离宿主验证底层资源与原生可操作终点；当前正式宿主保持运行，账号／历史复用和全机 inotify 调整均等待各自明确授权。

## 已授权的共享历史隔离宿主首次尝试

用户随后明确授权复用登录／历史及临时提高 inotify 上限。正式宿主保持 PID 4129030，隔离宿主使用全新 `/tmp/ck-speed-real-*` 私有目录、独立 loopback 端口／IPC、原版 26.51007.21434 VSIX 与共享 Codex HOME 链接视图；运行记录确认 Tokio 线程上限 8。桌面 Chromium 1440×900 的一次只读进入，DOM ready 2463 ms、`didStartWorkbench` 3093 ms、外层 Webview 6172 ms、原生 app root 6354 ms；页面出现原生 onboarding，未在此轮观察到 composer。浏览器页面错误 0、请求失败 2，宿主日志有 `EMFILE` 9 次，无 `renderer_ready_timeout`。**onboarding 与 `EMFILE` 同现，尚未证明因果关系，也不能把 onboarding 当加载失败或验收通过。**仅保留受限数值和日志哈希于忽略目录 `.dev-runtime/codex-startup-speed-20261027/shared-home-first-attempt.json`，不保存聊天正文或账号；浏览器与本轮私有宿主已关闭，逐 PID 和端口核对无残留，私有链接视图已删除。

当前 UID 的 inotify 使用量仍为 125/128。用户虽授权临时调整，但当前用户执行 `sudo -n true` 返回“需要密码”，`/proc/sys/fs/inotify/max_user_instances` 不可写；sudo 规则仅允许无密码运行 CUDA `ncu`，不能无交互执行 `sysctl`。因此**尚未更改全机上限**。需要有管理员权限的人在主机执行 `sudo sysctl -w fs.inotify.max_user_instances=512`（仅当前启动周期），再确认实际值后建立新隔离宿主重测；不得用普通用户权限绕过或停止其他进程凑配额。正式宿主与 Agent 未停止，优化代码也未据此宣布部署或真实提速。

## 授权后的真实产品入口与监听上限复查

管理员已调整实例上限，现场读数为 `fs.inotify.max_user_instances=1024`；此值高于请求的 512，未再更改。新隔离宿主复用用户明确授权的登录与历史，但仍使用私有 HOME、IPC、broker 和 loopback 原生端口，正式宿主 PID 4129030 未重启。桌面直接进入原生宿主的单次采样：DOM 2066 ms、workbench 2635 ms、Webview 5266 ms、官方引导 19614 ms、composer 可见 22141 ms。iPhone 16 尺寸 Chromium 的直接入口：DOM 1812 ms、workbench 2379 ms、Webview 4825 ms、引导 13918 ms；按钮被宿主通知遮挡，未取得真实触控完成结果。两种直接入口都不是产品 Codex 模式的完整验收。

为检查实际产品入口，在临时私有目录建立独立 HTTPS 网关，前端监听 `0.0.0.0:18518`，局域网测试地址为 `https://10.30.0.24:18518/?mode=codex`。随机私有 cookie 同时保护静态页面、原生 HTTP 与 WebSocket；无 cookie 的页面／状态请求返回 401，宿主上游仍只监听 loopback。网关使用当前构建的真实 Codex 路由和独立关注状态文件，不连接正式网关或 Session 运行层。此网关是短时验收夹具，不作为正式部署入口。

产品入口的首次桌面 Chromium 采样：外壳约 91 ms、原生 iframe 约 465 ms、官方引导约 18.5 秒、composer 可见约 23.2 秒，4 次引导点击成功；这轮焦点断言过早且测试代码在 iframe 身份检查处抛错，因此**不能记为可输入／保留 iframe 通过**。手机 393×852、DPR 3、触控模拟的首次采样：外壳约 101 ms、原生 iframe 约 569 ms、引导约 25.6 秒、composer 可见约 34.1 秒；4 次 Next 都只能由程序触发，真实触控被通知遮挡，不计可操作验收。随后修正测试为等待自有原生 iframe 的 `data-kanban-native-interactive=true`，手动触控关闭宿主通知后重新测手机：外壳 93 ms、原生 iframe 524 ms、引导 28.4 秒、4 次 Next 真实触控成功、正确原生输入区 33.1 秒可点击且键盘输入／清除通过；Codex→终端→Codex 回切 418 ms，原 iframe 身份保留，页面无水平溢出。该手机结果仅为 Chromium 的 iPhone 16 参数模拟，不是实体 iPhone 或 Safari。

遮挡通知来自宿主真实文件监听失败：新宿主日志是 `ENOSPC`，并非先前的 `EMFILE`；`fs.inotify.max_user_watches=1048576` 时，当前 UID 共约 1,048,248 条监听标记，另一个现存 VS Code Node 进程独自约 956,826 条。实例仅约 139/1024，故提高实例上限仍不足以恢复文件监听。未停止或更改其他进程。已请求管理员临时提高 `fs.inotify.max_user_watches` 到 2,097,152，待现场核对后需重新创建自有隔离宿主，验证通知消失及手机真实触控／输入回归。所有数值都是小样本，不能外推 p95 或宣称已达到两秒目标；官方原版 Webview 初始化仍是当前冷进入主要耗时段。

进一步按用户要求定位占用者：PID 846778 的命令行为 VS Code Remote Server `bootstrap-fork --type=fileWatcher`，父 PID 2301769 是其 `server-main.js`，不是 Coding Kanban 原生宿主。该 inotify FD 的 956,826 条记录包含 `/data01/home/huxing` 本身的 inode；对应 Remote Server 的 `20261024T224528/remoteagent.log` 在此进程启动后明确报告 file watcher 的 `path: /data01/home/huxing`，并记录 `.codex` 与 `xh3` 子目录。这证明监控根目录是整个用户主目录，**不能仅凭它断言某个 VS Code 窗口打开了家目录**；工作区根、多个根之一和扩展主动请求均需另证，远端日志没有请求者窗口 ID。另一次真实产品桌面采样在约 30.4 秒达到可点击、可键盘输入并清除的正确原生输入区，Codex 模式回切 557 ms 且原 iframe 身份保留。第二原生新聊天的初次测试在约 90 秒后仍无第二可交互 frame；复测中 `new-beside` 请求未发出、标签仍只有 1 个，表明须继续核对前端新聊天门控，不能将此例算作真实窗口切换通过，也不能仅归咎于文件监听上限。

再次清空第一个原生新聊天的未发送输入后，第二窗口请求得到 HTTP 202 和 `opened:true`，页面也出现 2 个原始 Webview／2 个标签，但 45 秒内仍只有 1 个 `data-kanban-native-interactive=true`，故第二窗口仍是红灯。前一次未发送请求符合前端草稿保护，不能记录为网关故障。诊断入口的无令牌 HTTP 返回 401、无令牌 WebSocket 被拒绝，带令牌 WebSocket 可建立。所有本轮自建进程已退出，18518、42149、45497 端口均关闭，私有链接目录与短期证书／令牌已删除；受限数字记录位于忽略目录 `.dev-runtime/codex-startup-speed-20261027/authorized-product-evidence.json`，正式 systemd 宿主仍 active。

当前定向红绿灯复核：正确 Vitest 配置下 Codex 前端 22 文件／149 项全通过，native host/adapter 339 项中 334 通过、5 项按条件跳过，相关差异 `git diff --check` 通过。`pnpm check` 已完成 shared、TS 运行层、后端构建；前端类型检查被并行修改的 Session 测试 `ConversationMenu.owner-forms.test.tsx` 中三处不受类型支持的 `{ exact: true }` 阻断，未覆盖该无关文件。未取得提额后无 `ENOSPC` 的隔离宿主、30 次真实官方窗口切换、实体 iPhone/Safari、30 分钟长测或正式宿主切换证据，故未宣布达到目标。
