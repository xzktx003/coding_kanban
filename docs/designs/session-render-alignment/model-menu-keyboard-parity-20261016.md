# 模型菜单原生键盘行为与验收（2026-10-16）

本轮接续 [消息／复制对照](session-polish-acceptance-20261016.md)，处理已实际复现的三个模型菜单差异。该前一批 `pnpm check`、497 文件／2508 单测、92 项浏览器通过属于其冻结源码；本轮修改与验收另行记录，不能沿用旧批次充当新源码结果。

## 原版与反例

当前官方 VSIX `26.51007.21434` 的 `hCa/mCa/Doa/esa/ssa` 与实际安装 `26.1007.21434` 所记录函数边界逐字一致。原组件夹具为 **HTTP `http://10.30.0.24:37575/native-goal.html`**，产品夹具为 **HTTP `http://10.30.0.24:48865/`**，前端均绑定 `0.0.0.0`。所有产品 API／WebSocket 使用隔离 fixture，无真实账号、CLI IPC 或任务写入；物理设备未验。

原版实际运行未修改的 `lCa/uca/ssa/Doa`、原 ResizeObserver provider 和精确提取的 wrapper 回调；refs、目录、setter 与 composer focus API 由私有夹具提供。完整原 `Zt` close 回调使用无 upsell 的 lookup 和非空已选 model mode，不触发 IDE 配置保存。这不是完整 `hCa`／IDE／认证宿主。

该原组件夹具显式传入 `shouldReduceMotion:true`。键盘导航、已选项焦点和 350ms 状态重置结论来自实际操作；关闭耗时不能用来声明普通动画设置下的原生退出时序或全动画一致。

三宽度 320/390/1440 的原版 105 个状态与主／展开输入的产品 177 个状态，页面错误均为空；双方使用相同 Fast 配置排除行数差异。原始数据和函数位于忽略目录 `.dev-runtime/session-polish-round2-20261016/menus/keyboard-focus-*`，结论为 `keyboard-focus-findings.md`。

| 场景 | 原版实测 | 修改前产品实测 |
| --- | --- | --- |
| caption 上方向下／Tab 两次 | 经 Fast 进入强度菜单项；左右改强度，上下／Home／End 导航，Enter 确认关闭回输入 | 主／展开均跳过 thumb；显式 focus 后上下／Home／End 改强度，Enter 不关菜单 |
| 键盘激活 caption 切高级视图 | 聚焦可用的已选模型，中间项也能正确定位 | 聚焦首个未选模型；pointer 切换双方均为容器 |
| 350ms 内关闭再打开 | 保留高级视图并取消旧 reset timer；关闭等 450ms 后才回简易 | 六条实际路径在 198.8–236.4ms 内重开即回简易 |

原 `Doa` 对 `code="ComposerNavigation"` 有独立处理，不能据该字段推断 IDE 全局按键入口。初次打开的定向 focus **仍未决**：精确 effect 在最小组件树中调用时 `contentRef=null`，稳定后直接执行同一个 `mCa` 才正确定位；不能仅凭静态 selector 宣判产品初焦点错误。当前 VS Code 也没有由 electron 命令配置推导出的全局快捷键声明。

## 实施与验收边界

实施限定在本地模型菜单：强度接入菜单键盘集合；键盘切换高级视图选择当前 enabled radio，pointer 保持容器；close 安排 350ms reset，reopen、owner／thread 变化及卸载释放旧 timer。确认与 Escape 复用原输入作用域守卫，来源失效不得抢焦点；拖动强度不意外关菜单，Enter 不传播成普通草稿提交。没有新增全局键盘消费者或修改线程／权限协议。

三项修复已经完成，产品仅修改 `NativeModelSelector.tsx`；此前 Escape 使用的两处 Composer owner 参数保持。强度复用原 thumb DOM 接入实际菜单项，指针选择取消默认关闭，普通方向键与 Tab 仅在本菜单内导航。键盘与 pointer 的视图焦点由同一 RAF 分支处理；350ms reset 及迟到 Portal 焦点按 thread／draftOwner 代次清理，包含 null-thread 和 A→B→A。

| 当前源码门禁 | 结果与证据 |
| --- | --- |
| 初始单测红灯 | 新增首批 18 项中 14 红／4 绿，`menus/keyboard-focus-unit-red.log` |
| 实际浏览器红灯 | 1440px 主输入按 caption→Down→Fast→Down 无法进入强度项，`keyboard-focus-e2e-red.log` |
| 修复后单测 | 2 文件／37 项通过：原 16 项加新 21 项，`keyboard-focus-unit-green.log` |
| 实际浏览器矩阵 | 1440／390／320px × 主／展开共 6 项通过，1.0 分钟，`keyboard-focus-e2e-green.log` |
| 类型与格式 | web `tsc --noEmit`、四文件 Prettier 和 tracked diff 检查通过 |

浏览器包含真实 thumb 拖动、桌面 track 点击／窄屏触控 tap、Enter 不发送普通草稿、原输入焦点、旧 reset 取消、另一草稿及返回恢复。六例快速重开为 182.1–230.6ms；调用原 workspace `setState` 前同步采到的 owner 变更发起时间为 242.5–276.1ms，两者均低于 350ms。后者**不代表 DOM 已完成重绘**；重开后另等 400ms 确认旧 timer 未改变新视图。所有执行型 API 调用与页面错误数组为空。窄屏为 Chromium touch-capable 模拟，未计物理手机。

`keyboard-focus-implementation.md`、`keyboard-focus-implementation-results.json`、`keyboard-focus-review.patch` 和四文件 SHA256 保存完整实现及验证。菜单源码完成后，由根线程另跑消息／Goal 组合回归与构建；不拿前一批 2508 项结果覆盖本批新源码。未将未决初焦点、完整认证宿主、权限弹窗或整个菜单的像素一致计作已验收。

## 退出动画中的指针锁与快速重开焦点

另一最小反例在 expanded Sheet 内关闭模型菜单、退出动画尚未完成时，直接调用原 workspace store 切换草稿：menu／dialog／sheet 数量均为零，但 body inline／computed `pointer-events:none`，命中 HTML，真实 plus trial 点击失败，800ms 后仍未恢复。先等待 menu DOM 真正 detached 再变更的对照恢复 body auto 并可点击。原始 JSON／PNG 为 `menus/keyboard-focus-portal-exit-owner-results.json`，原失败日志保留；它不能被称为单纯的夹具错误。

独立浏览器随后用正常用户入口确证：展开编辑→模型高级菜单→Escape→立即浏览器 Back，popstate 时菜单仍为 closed／0.15s exit；之后 menu／dialog／sheet 均零，但 body 仍为 none，HTML 截获普通按钮，1 秒 trial 点击失败。全过程 owner 相同，无触发阶段 store 变更。直接 Back、等待菜单 detached 再 Back 两个对照正常；全部执行型请求与页面错误为空，源文件前后相同，自有浏览器进程已退出。证据为 `menus/pointer-owner-audit/findings.md`、`browser-history-results.json` 与原始截图。

本地精确 Radix `dismissable-layer 1.1.11` 中，指针禁用 flag 变 false 时并不删除注册集合，实际删除等到节点卸载；Menu 关闭后 flag 已 false 但 Presence 保留退出节点，外层 Dialog 先卸载时会遗漏最后一次恢复。现仅在这个模型菜单关闭时直接卸载 Content，Root 的正常模态保护和 350ms 视图状态保持；代价是移除该菜单目前的 150ms 关闭动画。没有全局清 body 样式、修改依赖或推断原生 IDE 会如何切页。

直接卸载后的附加反例又发现旧 FocusScope 的 0ms cleanup 会消耗快速重开菜单的新焦点。每次真实打开现分配空身份 token，关闭回调先核对层、thread／owner 及当前 open，旧回调仅阻止默认回焦，不能读取或清空新层 DOM 引用。新层已再次关闭、两份 cleanup 都尚未交付的交错也单独先红后绿；scope 变化或卸载释放 token 和 DOM。

| 指针／层生命周期门禁 | 最终结果 |
| --- | --- |
| 指针单测与浏览器红灯 | 初始 3 条单测中 1 红；桌面真实 Back 三路径中 1 红，390px immediate Back 另 1 红 |
| 快速重开旧焦点清理 | 两种交错顺序均先红后绿 |
| 最终同批单测 | 3 文件／42 项通过，包含此前 37 项与新增 5 项 |
| 最终同批浏览器 | 2 文件／12 项通过，1.4 分钟；此前 6 条键盘矩阵加新增 6 条指针路径 |
| 类型与来源 | web `tsc --noEmit` 通过；3 个实施／测试文件 SHA 核对一致，6 个原包／依赖入口资产 SHA 不变 |

新增浏览器包括真实 Back 的 open／Escape immediate／等待 detached 对照、390px touch-capable immediate、主输入 Escape，以及同一共享 Dialog 组件在独立 fixture root 持有另一锁的保护。最后一项是锁归属反例，不宣称正常用户必能打开该特定组合。12 份结果的页面错误与执行请求均为空，页面／浏览器已关闭。独立 Dialog 首次 CJS fixture 解包错误另档保留，不计产品失败。最终 token 源码的日志为 `menus/pointer-owner-audit/e2e-green.log`；早于 token 修复的 12 项通过保存在 `e2e-before-layer-fence-green.log`，不混作最终结果。完整审查包为 `implementation-results.json`、`radix-lifecycle-findings.md` 与 `product-review.patch`；6 个入口资产核对不等于整包递归哈希审计。

随后人工看图发现高级菜单搜索按钮另起一行、最近模型入口继承默认大字号。另批纯样式将标题与搜索排成一行，附加入口／搜索框使用菜单字号、间距与焦点样式，并补搜索及附加入口的 44px coarse-pointer 区域；这些现有附加功能保持，不称其与原 `ssa` 组件功能相同。该样式晚于上述 42／12 批次，合并后的截图、构建与回归另记。

这次合并组已通过 `pnpm check`、18 文件／236 项单测，以及 `round5-browser.log` 的 8 文件／38 项浏览器（含本页十二路径），无跳过。六组 `model-menu-advanced-geometry.json` 确认：入口与 radio 均为 12px／17.1429px；标题／搜索中心差约 0.0078px；桌面搜索 24×24px，320／390px coarse 搜索与最近入口为 44px；无横向溢出。根线程复核 390／1440px 截图，纯样式未改变已有搜索或最近模型行为。`round5-source-acceptance-verification.json` 核对 2834 源文件、9 份 E2E 与 72 个 shared 产物前后相同，详情见 [合并检查](session-polish-acceptance-20261016.md#合并检查)。初次键盘打开定向焦点仍保持未决，不由这些已选项导航测试替代。

## 初次挂载与普通动效的补查

随后只读探针运行完整原 `Dca` hook、原 React／compiler runtime、`lCa/uca/OR` 与既有 providers；Dca 的 798 字节函数体与当前实装字节相同。**焦点 effect 函数体原样，但注册位置由私有 App 手工接线，未挂完整 hCa／IDE。** simple／advanced × keyboard／pointer 四例采用 `shouldReduceMotion:false`，另两例 simple 为 true 对照，浏览器 reduced-motion 均为 no-preference。键盘两种视图仍观察到 `mCa` 实参为 null、随后 ref 才赋值，RAF 不重读该 ref；simple 最终为首个“选择模型”，advanced 为首个未 checked radio；pointer 为 menu 容器。未据此修改产品，也未升级为完整插件宿主初焦点结论。

普通 motion 四例测得专用 enter 为 0.32s，源 CSS 另有 30ms delay；true 对照无动画。本探针只在可见后等待 180ms 再关闭，进入动画可能尚未结束，因此不是完全稳定后的关闭验收。此时 ref 于 26.4–34.6ms 清空，35.9–45.8ms 的首个后续样本已无菜单，未观察到持续 150ms 退出节点；两例 pointer 在清理瞬时仍有 connected、closed 的 menu，因此不能声称“从未存在 closed DOM”或精确退出时长。该结果只补局部组件事实，产品普通开启动效尚未作同批精确比较。

六例无 native／page errors、无业务调用，仅 GET 自有静态资产；12 个实际服务的官方资产前后 SHA 相同。结果先落盘，完整性断言不要求预设初焦点通过。证据为 `menus/keyboard-initial-audit/{results,summary,executed-functions,dca-installed-comparison,wiring-source}.json` 及 `findings.md`；Dca offset 明确区分 UTF-16 code unit 与 UTF-8 byte。仅一次、单个自有浏览器，当次 **HTTP `http://10.30.0.24:38945/`** 绑定 `0.0.0.0`；结束后自有 PID/start ticks 与监听均已核对退出，原服务未动。六个参考样本与产品 236／38 结果分别记录。

随后增加一轮四例，明确等待普通入场 animation.finished／currentTime350ms 后再关闭，补齐稳定关闭的局部参考；当前增强分支宽度 254px、320ms／30ms 专用动效与产品原 224px／150ms 确有差异，已限定 CSS 修正。真实媒体查询先核对再验证减动，初次测试配置未生效与无效 longhand 断言分别保留；完整证据、与旧 w-56 分支的区别及新源码验收见 [增强菜单动效](model-menu-motion-parity-20261016.md)。这不升级为完整 hCa／IDE 验收。

## 完整 hCa 的隔离启动边界

为避免手工注册 Dca effect 的位置差异，后续尝试导出完整原 hCa，并准备原 controller／RichTextInput 与原 providers。canonical Main 响应仅在原始 6,116,260 字节后追加 62 字节 export；原前缀与磁盘一致，浏览器 `hCa.toString()` 和原函数 span 完全相等。它不是原响应全字节不变，也不是完整 IDE 宿主。

首个 **HTTP `http://10.30.0.24:38417/`**、绑定 `0.0.0.0` 的单次探针在原 `_Ur.rendererInstanceId=crypto.randomUUID()` 抛错，尚未挂载 controller／hCa。没有补 API 或重试；不计任何焦点用例。另一独立 **HTTPS `https://10.30.0.24:42791/`** 单次探针使用私有临时自签测试证书，context 内忽略该证书错误；实测 `isSecureContext:true`、`crypto.randomUUID` 可用，没有 polyfill 或额外安全 flags。

HTTPS 接着在原 atom 的 `shared-object-subscribe {key:"statsig_evaluations"}` 首次未覆盖消息处停止。原 effect／错误清理期间另拒绝 `fetch POST vscode://codex/get-settings` 和两次 `get-global-state` 的 `queued-follow-ups` 请求；它们是虚拟宿主 envelope，没有实际网络 POST。未扩 allowlist 或臆造响应，controller 仍 null、焦点零例。这是参考宿主尚缺只读协议的证据，不是产品焦点缺陷或完整 hCa 已挂载的证据。

两次原始失败分别保存于 ignored `menus/full-hca-probe/` 与 `menus/full-hca-secure-probe/`，每次均一页／一个 browser、90 秒上限和 1536 MiB 自有 browser-tree RSS 预算，实测峰值分别 513.42／573.88 MiB。原函数等值与十份原盘资产哈希通过，自有 PID/start ticks、runner 和监听均已核对退出；37575／48865 与正式 Agent 未动。完整初焦点仍未决，后续只读 schema 审查也不能替代浏览器挂载验收。

第三次在静态核对三项只读握手后，使用独立 **HTTPS `https://10.30.0.24:37533`** 单次 bootstrap-only 探针。首个新反例是原日志 `log-message / mcp_request_enqueued`，其 `tags.safe.method` 为 `remoteControl/status/read`；日志被拒绝，已排队的 statsig 更新没有交付，后续 settings／queued-follow-ups 请求也未获准。不能把日志或订阅登记解释成三读响应已经验收。

错误展开后的快照只剩 HostRoot；controller 曾创建但 `connected=false`，不能用卸载后的零计数推断它从未短暂挂载。shared subscription 仍记为 1，未观察到 unsubscribe，因而原生生命周期清理与初始焦点均未验收。39 条 page／Node 账本完全相等，峰值 589.52 MiB；原包和准备文件哈希不变，自有 runner、五个 browser 进程身份及监听全部退出。证据为 ignored `menus/full-hca-read-bridge-probe/{findings.md,summary.json,post-run-check.json}`；没有自动扩展宿主 allowlist 或重试。

第四次先静态核对原 logger 的三种 debug 消息、remote status wire schema、空项目／连接快照和官方默认 locale，再使用独立 **HTTPS `https://10.30.0.24:35833/`** 做一页 bootstrap。当前匹配 CLI 仅在私有目录执行离线 JSON schema 导出，没有启动 native 服务或调用真实 status；fixture 也不挂 Statsig producer。缺失连接值保留 undefined／loading，不能以空数组冒充 ready；Intl 使用原 en-US defaultMessage，严格错误处理保留。

该次首错是未登记的 `fetch POST vscode://codex/is-copilot-api-available`，按原约束停止，没有临时放行。两个 MCP envelope（remote status 与 config）虽登记并记录 dispatched，响应均在首错时 dropped、交付次数为零；三类 project fetch 与 settings 也没有成功交付。不能把读取登记或诊断日志写成真实 native 执行／成功握手。最终有五个 shared subscribe、三个 unsubscribe，仍余 statsig 订阅 1；HostRoot-only 错误快照不证明全生命周期未挂 producer，也不算清理验收。

71 条 page／Node 账本相等，九份实际提供的原资产哈希与 hCa 函数体不变，峰值 578.3047 MiB；网络拒绝、pageerror、console-error 为空不抵消已记录的 firstFatal。全部自有 PID/start ticks 及监听已退出，2834 产品源文件不变；正式会话服务仍为原 PID/start ticks，健康 HTTP 200。证据为 ignored `menus/full-hca-startup-deps-probe/{results.json,root-review.json,post-run-check.json}`。完整 hCa 初始焦点仍未决，后续先审查 Copilot 查询与相邻启动依赖，不在同一探针里反复扩大 allowlist。


## Copilot 空白设置的第五次隔离启动

在侧边权限 Round12 封存后，仅增加已静态核对的 Copilot 可用性／偏好与空 Daybreak 输入，单页 HTTPS `https://10.30.0.24:40057` 尝试仍失败：首次未登记请求为 get-global-state 的 `copilot-default-model`。桥接立即拒绝，未临场放行；87 条 page／Node／NDJSON 记录完全一致，14 项待投递中仅初始 persisted-atom-sync 投递，13 项停止后丢弃。Copilot 读取被取消，两个已准入 MCP 读取均未完成回执，不能宣称启动握手通过。五次 shared 订阅、四次取消后仍有 statsig 订阅；最终单一 HostRoot 快照不代表生命周期中从未挂载。

本次 focus cases 为零，完整 hCa 初始焦点仍未验收。九个官方资产和六个探针输入不变，2835 产品源／19 E2E／3 基础设施／72 shared 与 Round12 冻结清单相同；浏览器树 RSS 峰值 572.0391 MiB，低于原 1536 MiB 保护线。自有 runner／浏览器 PID 身份已退出、40057 监听关闭；未重启正式服务。完整失败、投递和独立清理核对位于忽略目录 `menus/full-hca-copilot-empty-probe/`（共同前缀 `.dev-runtime/session-polish-round2-20261016/`）。后续先核对新增 key 的消费者与缺省响应，不把此次失败计为产品回归或焦点绿灯。


## 补齐缺省模型后的第六次隔离启动

静态核对 missing `copilot-default-model` → `{}` 与缺省 features shared → undefined 后，在全新 HTTPS `https://10.30.0.24:45987` 单页尝试，首次未登记读取改为无 body 的 `POST vscode://codex/os-info`，立即拒绝并停止。没有临场补响应，仍为零焦点用例，完整 hCa readiness／初始焦点未通过；不能从最终 committed snapshot 推断全生命周期未挂载。九项审阅输入、九个原资产、Round13 的 2835 源／21 E2E／3 基础设施／72 shared 均未变。峰值 RSS 577.1641 MiB，原 1536 MiB 保护线不变；独立核对自有 PID/start ticks 全退出，45987 监听关闭，正式服务未改变。结果及完整投递／订阅口径为忽略目录 `menus/full-hca-copilot-model-empty-probe/`（共同前缀同上）。后续 os-info 先静态核对，不读取真实主机信息来冒充空 fixture。
