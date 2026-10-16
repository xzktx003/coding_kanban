# 会话模式后续原生对照与验收（2026-10-16）

本轮继续 [Goal 对齐验收](goal-parity-acceptance-20261016.md) 后的会话模式润色。参考为当前仓库官方 VSIX `26.51007.21434`，相关实现与实际安装 `26.1007.21434` 逐函数或资源归一化核对；不使用旧版功能清单推断当前行为。官方包不修改，不向正式 Agent 发送测试指令。

产品前端为 **HTTP `http://10.30.0.24:48865/`**，绑定 `0.0.0.0`，浏览器测试拦截全部普通 API 写入。原组件只读对照为 **HTTP `http://10.30.0.24:37575/native-goal.html`**。同网段物理设备尚未验证。日志、截图与具体函数副本保存在忽略目录 `.dev-runtime/session-polish-round2-20261016/`，不能把组件夹具解释为完整认证扩展宿主。

## 命令与聊天 Diff 复制

本地 `ShellCommand.CommandCopy` 原先直接使用 Clipboard API，HTTP LAN 不可用；等待时重复点击会重复写入，成功只持续 1500ms，错误为自定义浮动文本。当前原包 `user-message-attachments` 的 `cn` 分别将命令和未改写输出传给 `pe`，`pe` 是 `app-initial-fee819fe4f22.js` 的 `Sh/NKi`，其 `onCopy` 使用 `yk`。仓库与实装 `user-message-attachments` 在资源文件名归一化后全文一致，`NKi` 已有逐字核对。

本次实际在原页面 providers 中运行未修改的 `NKi`：20×20 按钮、14×14 图标、21/17 viewBox、在途 `aria-busy/aria-disabled`、不替换为 spinner、不增加 HTML disabled、双击只调用一次、1550ms 仍成功、2100ms 已恢复，页面错误为空。证据 `tool-copy/native-copy-result.json`，不是仅靠类名推断。

产品命令复制复用现有 HTTP/HTTPS 剪贴板适配，保留原始 ANSI／换行，原生成功图标与 2000ms 反馈、Tooltip 和失败通知；等待期间只保留一次请求。内容 A→B→A、关闭详情、卸载后的旧回执不产生成功／错误提示，也不遗留新计时器。复制范围限定可卸载详情组件，不向聊天事件、全局 store 或历史缓存增加完整输出。

聊天单文件 Diff 同样存在 HTTP 不可复制、在途重复写、关闭后计时器存活和迟到反馈问题，现采用相同的剪贴板传输与原文／生命周期保护。**本轮只将其记录为复制故障修复**，保留既有 Diff 控件外观和 1500ms 成功时间，未将它称为当前原版整个 Diff header 的精确 UI 验收。

| 门禁 | 单批结果与边界 |
| --- | --- |
| 命令新增失败用例 | `tool-copy-red.log`：9 项中 7 项失败，覆盖 HTTP、在途、回执、图标／时间和关闭资源 |
| Diff 新增失败用例 | `diff-copy-red.log`：5 项中 4 项失败 |
| 修复后相关单测 | `tool-copy-final-units.log`：6 文件／67 项通过，包含原有只读详情和释放回归 |
| 实际浏览器 | `tool-copy-browser.log`：3/3 通过，390px 触控和 1440px 使用浏览器原始 `copy` 事件与原始 `execCommand`，没有安装剪贴板替身；完整 ANSI 输出、patch 无换行标记与草稿保留。另一个在途／拒绝场景显式注入 Clipboard Promise，不能冒充系统剪贴板验收 |

该批截图为 `tool-copy-browser/**/command-*.png`。HTTP 证据证明页面向浏览器剪贴板事件传入的完整内容，未把它描述为外部应用实际粘贴。

后续按实际截图继续检查，补齐 `DiffViewer` 正文复制按钮、预览／review 菜单及复制路径：新增 5 项全部先失败，其中 HTTP 复制路径产生未处理异常；同文件补丁或 review 所属 turn 变化后收到旧回执也另有两个真实失败用例。修复后复制状态以内容／路径／模式／review 来源换代隔离，保留现有 Diff 错误表面和反馈时间，不改变 patch 或 old/new 片段语义。`diff-all-copy-green.log` 单批 5 文件／26 项通过；加强后的 `tool-copy-all-browser.log` 为 3/3、17.4 秒，每种尺寸实际收到输出、卡片 patch、正文 patch、review 路径四个完整原始 copy event。

同一轮清单还发现会话 Markdown／普通链接／深链，以及保留编辑缓冲的复制直接依赖 Clipboard API；新增 4 项均先失败（含未处理异常），现统一复用既有 HTTP 适配，操作来源、文案、缓冲和发送行为不变。`workflow-copy-green.log` 单批 4 文件／13 项通过，含隐藏同线程消费者只消费一次、原 owner 和编辑缓冲不丢失回归。这不是为 Todo、自动化等其它工作流声明整个剪贴板清单已经审完。

## 复制等待期间的正文释放

独立审查用真实组件及 V8 HeapProfiler 发现另一个缺陷：剪贴板替身仅返回强引用、永不 settle 的 Promise，明确不保存传入正文；三个已关闭视图仍分别保留约 262KB 的命令输出、卡片 patch 与 Diff 正文，未点击的同组件对照均回收，Promise settle 后才释放。`menus/copy-retention-results.json` 同时记录真实私有 source 对象的 WeakRef，不能用静态闭包猜测代替该反例。

修复新增 `presentation/useNativeCopyFeedback.ts`：来源版本只用空 token；等待与计时回调位于模块函数中，组件入口同步发起复制，卸载清空 controller 中的 React setters，现代 Clipboard API 直接返回其 Promise。不会取消或重发浏览器已有剪贴板请求，也不会保存另一份正文。原有 owner／ABA、在途锁、错误和反馈时间保持。`copy-lifetime-green.log` 单批 6 文件／37 项通过。

同一真实堆反例复测时，三个 pending Promise 仍未完成，初始六种正文 marker 均确实存在；卸载后扫描全部大字符串，pending 与 control 的六种 marker 均为零，见 `menus/copy-retention-green-results.json`。该结果不依赖已删除的 source 对象形状，也不把显式 GC 的短时释放证明解释为自然 GC／长期 RSS 已通过。

同类审查又实际确认 Plan 和用户／助手整条消息复制仍持有正文：各 262144 字符，在途原文卸载后存活、未点击对照回收，settle 后才释放；plain `writeText` 与 rich `write`／`ClipboardItem` 替身均不保存参数。已将这三条路径接入同一释放机制，保留原 plain/rich 载荷、用户 1500ms／助手和 Plan 2000ms 反馈及 pending aria 规则。`messages/copy-retention-red-results.json` 与 `copy-retention-green-results.json` 并列保留，初始六条真实长度与 marker 核对后，卸载的 pending/control marker 全为零，external string 没有因节点 self_size 较小而被排除。Plan StrictMode 候选的新增单测原本就通过，只记覆盖，不列为已修缺陷。

## 用户消息与模型菜单

用户消息原版链 `Ft→gt→v/JTr/XTr` 与 SVG 链 `GKi/JKi` 共 40 个提取函数与当前安装版本逐字一致。消息超过实际 20 行加 1px 才折叠，以 19 行加省略号呈现，跨代码块时延伸到完整块边界；附件位于折叠区外。键盘展开、整条完整复制、搜索命中同步展开均保留正文，scope 换代与隐藏／卸载释放观察器及自身焦点属性。SVG 预览整条复制通过原始 source 输出转义代码，普通 fence 不额外复制正文到 DOM attribute。

字号／行高最初只核对了原 `v` 的 `text-size-chat leading-relaxed` 和 CSS。后续已实际运行未修改的 `v`、`gt` 和完整 `Ft`，加载原 CSS、配套 `user-message` CSS、原 ResizeObserver provider 及以空只读内存状态完成握手的 PersistedStateProvider。三组件各测 1280px／13px、390px／13px、1280px／15px，共九组均无页面或 boundary 错误，完整 `gt/Ft` 实际显示 34 个 Markdown 段落和两个代码块，展开／收起均可操作。没有替换 `getComputedStyle` 或行高 API；结果与截图为 `messages/font-reference-complete-results.json` 和同名前缀 PNG。

| 明确宿主字号输入 | 原版正文／省略行高 | 原版 19 行 clip 高 | 原版展开按钮行高／高度 |
| --- | --- | --- | --- |
| 13px | 21.125px（1.625） | 402px | 19.5px（1.5） |
| 15px | 24.375px（1.625） | 464px | 22.5px（1.5） |

原版按钮同时为 gap 4px／margin-top 6px。本地新增两宽度实际几何用例均先失败，确切差异是 13px 按钮行高 21.125px 而非 19.5px，见 `messages/font-local-red.log`。修正只将 disclosure 按钮行高改为 1.5，正文 1.625 和原折叠算法保持。随后 1280／390px 各测 13／15px，共四组实际几何转绿；JSON 保存于 `round3-browser/**/native-user-message-font-geometry.json`，包括正文、省略号、19 行 clip、按钮高度、gap 与 margin。原全局 CSS 和配套消息 CSS 与实装版全文 SHA256 相同，见 `messages/font-reference-css-equality.json`。

先前审计用例中的 19.5px 仍只是 `getComputedStyle` mock 输入，不能倒写成当时已经测过原版；初次 provider／配套 CSS 缺失的失败另档保留。原组件明确传入非 Aeon 显示 prop；这不证明正式 feature flag、IDE 字体配置选择或认证扩展宿主，其余嵌套布局也没有全像素一致声明。原 `gt/Ft` 另六条真实 DOM 反例确认 19／20 行不折叠、21 行折叠，见 `messages/font-reference-threshold-results.json`。

SVG／折叠／普通代码释放均有先红后绿记录；`messages/message-green-suite.log` 为 11 文件／56 项通过，`native-parity-green.log` 运行未改提取函数的 5 项对照通过。正式 `session-message-actions-parity.spec.ts` 最近一批 5/5，通过实际 Ctrl+F、尾部 Range 高亮、模式隐藏和真实 hover/focus/click；该批早于最后普通代码 attribute 缩减，合并验收另记。390px 仅为窄桌面视口，消息剪贴板使用载荷夹具，不计物理手机或外部粘贴验收。独立 `message-independent-audit/` 的 3 项反例覆盖迟到 observer、DOM 复用／移出、原属性恢复、全文与缩放边界。

模型菜单原版 `hCa` 的 `onEscapeKeyDown:Dn` 与 `onCloseAutoFocus:En` 显式返回 composer，本地此前回到模型按钮。现捕获打开时主／展开输入、草稿 owner 与 thread，关闭核对当前页面及可见性，仅 Escape 返回原输入；普通点击关闭保持原规则，释放捕获 DOM。`menus/model-escape-red.log` 7 项失败后，最新 16 项单测通过；320/390/1440 三尺寸 12 条实际焦点断言通过。证据及原包实际组件执行在 `menus/findings.md`；原 wrapper 键盘打开后的 reasoning slider／radio 焦点、权限弹窗完整矩阵尚未验收，不扩展为整个菜单对齐声明。

## 浏览器到真实原生 Goal 闭环

`integration/http-native-hyt3lnep/result.json` 覆盖真实 HTTP 网关→当前 TS `createRuntime/CodexService/Ownership`→匹配 CLI 的无登录闭环。首轮 `/goal` 接受后立即设置目标，暂停确认／排空、1.25 秒安静、显式继续、实际 `update_goal complete`、精确轮次完成后一次 clear、GET null 与 clear SSE 全部通过。首轮 ACK 与 GoalSet 之间没有用人工等待绕过落盘预检。

`integration/http-native-2hdmux6n/result.json` 进一步实际挂载当前产品 Composer 和 ThreadGoalCard，通过浏览器点击暂停和继续：两次真实 GoalSet、一次真实完成清理，HTTP 200 `{cleared:true}` 后原生 clear SSE／GET null／卡片消失。精确原生 turn completed 顺序 189 早于唯一 clear stdin 顺序 204，页面错误为空，相关源文件运行前后哈希不变。Goal 回应未 mock；普通页面 API 使用隔离 fixture，只有精确私有 thread 的 Goal／access／只读调用和真实 SSE 放行。存在 5 次有界历史分页查询，以及一次显式继续触发的原生 resume ACK（含 1 轮）；不声称零历史传输。

所有临时 HOME、CLI HOME、SESSION_DATA_HOME 与浏览器私有配置均独立；没有复制认证，实际 account 为 null，三个 loopback fake-provider 请求没有认证头。seccomp 对整个自有 Node／CLI／浏览器后代限制 connect 目的地，8282 正式服务未放行。浏览器使用隔离单进程 Chromium 以满足过滤环境的启动约束，因此该批不证明普通多进程浏览器的性能／RSS。原生协议和 TS 运行层是真实实现，fake-provider 不等于真实模型效果、ChatGPT/OAuth 或完整官方 GUI。

此前两次浏览器未完成记录仍保留：第一次错误种子漏掉 activeFlags 导致 JS 异常，不计产品失败；修正为真实 metadata 后的 `http-native-l79fp4ai` 捕获 clear-completed 已进入运行层，但 idle sweep 的 unsubscribe 先完成、无 native clear、卡片保留且没有重发。该次**没有捕获 HTTP 响应体**，失去 owner 后返回 false 是由当前锁／权限实现和原生顺序支持的解释，不能写成已经观察到 `{cleared:false}`。没有为挑绿改 idle TTL、重新 acquire 或放宽清理门槛。最后只补一轮无 CDP 调试的正常运行并通过；两个分支与原始失败日志并列保存。

该批自有 TID／进程组余留为空，隔离审计错误为空。原生跨客户端 CAS 的既有真实红灯仍未解决，不能由本实例 guard 与上述成功闭环替代。

## 继续核对的范围

未把静态发现的 ConversationMenu 多挂载候选算作缺陷：普通聊天打开加号时实际只有一个实例，Popover 加 Sheet 的两个 dialog 也不是两个 Sheet。其它菜单 wrapper／权限弹窗和认证宿主仍需逐项审查；不因本轮几项通过就宣称整个会话模式完成。

后续只读实测又确认强度键盘可达性、键盘视图切换后的已选模型焦点、350ms 内快速重开三项差异；已按原组件修复，37 项单测与三尺寸主／展开六路径通过，见 [模型菜单后续对照](model-menu-keyboard-parity-20261016.md)。初次键盘打开的定向焦点仍未决，保持原实现。

新增六例只读 `Dca+lCa/OR` 参考探针仍保留 null-ref 反例，Dca 与当前实装相同；effect 体未改但注册位置为手工接线，因此完整 hCa／IDE 初焦点仍未决。普通 motion 实际 enter 0.32s；可见后 180ms 即关闭，未证明进入动画已结束。关闭首个后续样本已无菜单，但清理瞬时可能存在 closed DOM，不将局部样本外推为完全稳定后的关闭或完整宿主动画一致。该探针无产品改动、无业务调用，自有监听／进程已关闭，见 [补查边界](model-menu-keyboard-parity-20261016.md#初次挂载与普通动效的补查)。

另一退出动画反例已由独立浏览器核对为正常用户入口可达：展开编辑→打开模型高级菜单→Escape→立即浏览器 Back，所有弹层消失后 body 仍保留 `pointer-events:none`，普通按钮被 HTML 截获；直接 Back 和等菜单退出再 Back 两个对照正常。无触发阶段 store 写入、无执行请求、源码前后不变，证据 `menus/pointer-owner-audit/`。修复只在关闭时卸载本菜单 Content，保留真实 Sheet／另一 Dialog 的模态锁，并以每次打开的身份阻止旧 focus cleanup 消耗新输入。新增 5 单测／6 浏览器与旧键盘矩阵合并，最终 **3 文件／42 单测、2 文件／12 浏览器** 通过；不是用旧 32 项覆盖新源码。代价是取消本菜单局部 150ms 关闭动画，原组件夹具的 `shouldReduceMotion:true` 不作为普通动画同一性证据，详见 [菜单验收](model-menu-keyboard-parity-20261016.md#退出动画中的指针锁与快速重开焦点)。

原始 30 分钟内存测试在独立冻结副本运行，**HTTP `http://10.30.0.24:5173/`**、绑定 `0.0.0.0`，后端代理固定为未使用的 loopback 地址，全部业务请求由隔离 fixture 接收。沿用原负载和预算，不强制 GC、不热更新、不刷新；初次准备失败单独保留，预热后才正式计时。结果仍为红：1802.806 秒／862 样本，RSS 低点 336.9102→515.6406 MiB，增长 178.7305 MiB 超过原 128 MiB；heap 低点增长 6.4837 MiB，峰值 heap/RSS 236.6881/691.6445 MiB，React measure 零、errors[]。RSS 先失败，最终音频空闲检查没有执行，不能计绿。

`soak-manifest-verification.json` 核对冻结副本 2820 个文件前后不变。副本早于后续 UI 和复制资源修复，不能声称全部最终源码的同批长测；旧长测红灯同样保留。完整结果为 `soak-browser/**/natural-gc-soak.json`、`soak-result-summary.json`；结束后按自有 PID/start ticks／cwd/argv 精确关闭该临时 Vite，未影响 48865 对照服务或正式服务。

一次后续隔离归因诊断已按资源保护中止：自有四浏览器进程树 VmRSS 总和 2585.1602 MiB 超过事先固定的 2560 MiB 安全预算，活动只有 18.032 秒／10 cycles，未完成预热、native dump 或安静尾段。该短窗四个 renderer 身份恒定，不说明标准长测的进程数，也不能区分渲染、浏览器分配或观察器根因；产品页 fixture 的 Vite WebSocket-close 错误和末条历史镜像未完成也明确保留。`rss-audit/once-result-summary.json` 为 `completed:false`，没有重跑或提高预算；最终自有 PID 为零、监听已关，详情见 [内存约定追加](../../session-memory-contract.md#goal-对齐后的冻结长测2026-10-16)。标准 RSS 红灯保持。

## 合并检查

前一批 `pnpm check` 通过，覆盖 shared、TS 运行层、网关和前端类型检查／生产构建。`web-final.log` 全量会话／Codex 前端单测为 **497 文件／2508 项通过**（337.16 秒）；`final-source-manifest.json` 对四个 src 目录的 2822 个文件记录哈希，构建与该批回归期间无代码变化。新增永久 V8 回归分别位于 `session-command-clipboard.spec.ts` 和 `session-message-actions-parity.spec.ts`，使用相对路径 helper，先保存 JSON 再断言。后续批次分别记录，不累加历史结果。

`browser-final.log` 单批 19 个文件的浏览器组合回归为 **92 项通过、1 项默认跳过，12.3 分钟**。默认跳过的是独立 30 分钟 soak，该用例另跑的实际红灯仍保留。组合包括 Goal 原组件四主题／尺寸、流程／完成、Plan、选择器失败、命令详情、plain/rich 复制与两组 V8 释放、实际搜索、审批／提问、投递、子 Agent、SSE、正文回收和历史恢复；`round2-source-acceptance-verification.json` 确认上述 2822 个源码文件仍无变化。

真实 HTTP/EventSource 压力输入 100,669,814 bytes，浏览器收到 6178 个正文字符、最大事件 317 字符，强制 GC 后保留增量 35,964 bytes。24 次自动恢复自然 GC 堆样本为约 34.9–81.0 MB，未放宽预算。另正文自动回收／只读重显 96.922 秒，heap 为 166,974,188→59,582,616→198,341,932 bytes、renderer RSS 为 485,515,264→293,466,112→610,041,856 bytes；草稿、审批、完成与未读保留，errors[]。这些短测不覆盖长期 RSS 红灯。

随后菜单键盘／350ms 生命周期和按钮字体修正的独立组合为 **7 文件／32 项通过，3.5 分钟**，`round3-browser.log`。包含菜单六路径、消息八项（含新增字体几何和 pending V8）、Goal 三文件及输入菜单／阅读跟随；`round3-source-verification.json` 核对四个 src 目录 2823 个文件及两个正式 E2E 源码无变化。该结果只覆盖该次冻结源码，真实 Back 指针锁在该源码上仍为红灯；随后 42／12 修复批次如上，再晚的纯样式与剩余复制修复另行合并检查。

本次最终冻结组增加模型菜单局部排版与 13 处当前可达网页复制修复，详见 [HTTP 复制验收](clipboard-http-actions-20261016.md)。`pnpm check` 通过，组合单测 **18 文件／236 项通过**；`round5-browser.log` 单批 **8 文件／38 项通过、无跳过，3.9 分钟**，包含 Goal 三文件、消息八项、两份菜单十二路径与输入菜单／阅读跟随。HTTP 复制另分两次执行：390／1440px 两组件通过真实同页 Ctrl+V 控制，正常产品菜单五项另跑通过，errors／执行 calls 均为空；不称单命令 41 项。`round5-source-acceptance-verification.json` 重新枚举 2834 源文件、9 份 E2E 与 72 个 shared 构建产物，浏览器前后哈希无变化。

高级模型菜单的标题／搜索改为同一行，最近模型入口采用列表相同 12px／17.1429px 字号行高；桌面搜索为 24px，coarse 搜索与入口均至少 44px。三宽度主／展开六组实际几何无横向溢出，标题／搜索中心差小于 1px，390／1440px 人工截图复核；只修局部样式，不新增搜索／最近模型能力，也不将这些自有扩展入口称为原版同一控件。

随后只改增强模型菜单 CSS，按当前原 `lCa→uca` 的 254px 宽度、320ms／30ms／原曲线和 .98→1 scale 对齐，真实系统 reduce 时不创建入场动画；原 fallback 仍为 224px，旧参考适配器不能用于当前增强分支。原组件另四例等待实际动画结束再关闭，补齐上述 180ms 观察不足；原 probe 缺失背景变量，不作配色 oracle。前端类型／生产构建通过，单批 **3 文件／42 单测、3 文件／16 浏览器、无跳过**；首轮几何 4 红完整保留，仅将双 RAF 取样改为等待真实动画结束，44px 与 350ms 门槛未放宽，产品源码未再次改动。2834 源码、10 份 E2E、72 份 shared 产物前后哈希相同，详见 [宽度与动效验收](model-menu-motion-parity-20261016.md)。后续静态核对未发现官方当前可达的减动开关，未为 dormant 文案新增 UI；底层三态持久化未移植，完整 hCa／IDE 初焦点仍未验，不将 system 对齐称为设置全量复刻。

`pnpm session:status` 确认正式会话服务仍为 PID 2712539，**HTTP `http://10.30.0.24:8282/api/session/health`** 就绪，磁盘产物与实际运行进程不同；新运行层尚未激活。正式服务和 Agent 未重启。认证宿主、原生跨客户端 CAS 反例、长期 RSS 与正式运行产物激活仍按各自证据判断，本记录不是全会话模式已经“完美”的声明。

再后的 [搜索高亮生命周期](search-highlight-lifecycle-20261016.md) 只修改 `CodexThread` 的一个 effect：无选中 query／搜索关闭／聊天不可见时不观察全文，正常搜索、返回恢复及原 cleanup 保持。1280／390px 两反例均先红后绿，前端类型／生产构建、7 文件／26 单测通过；最终单批 **8 文件／41 浏览器通过、1 项默认长测跳过、零失败，6.6 分钟**，包含 Goal 三文件、消息八项、提问、真实 SSE 恢复与自然正文回收。2834 源码、14 份 E2E、72 份 shared 产物前后不变。96.809 秒回收／恢复同时记录 heap 与全部 renderer RSS，不能解释为长期稳定或已修复 +178.73 MiB 红灯；正式服务仍健康、未替换运行产物。

之后仅修 [RSS 测量身份与缺测](renderer-rss-metering-20261016.md)，产品源码未改。Linux 采样不再补零或吞错，逐 renderer 保存 PID/start ticks／RSS；原 128/768 MiB 门槛与负载保持。10 项单测通过，浏览器自然回收／恢复 1 项通过、1 项默认长测跳过；97.055 秒三个时点为同一进程身份、采样及页面错误为空。round8 前后 2834 源码、14 份 E2E、2 份脚本与 72 份 shared 产物相同；此批不重算旧数据或覆盖长期 RSS 红灯。


随后当前源码标准长测 **1 项通过、零跳过，30.6 分钟**，862 cycles／样本、持续负载 1802.920 秒；RSS 低点增长 26.2578 MiB，heap 增长 4.4072 MiB，原峰值门槛与最终自然音频空闲均通过，页面／采样错误为空。全部样本为同一 renderer PID/start ticks，2834 源码、14 E2E、2 脚本与 72 shared 产物前后相同。前窗口 RSS 低点比旧批次高，不能将差值减少归因到某个修复；保留原红灯和归因边界，详见 [本轮长测](../../session-memory-contract.md#当前源码的一次标准长测通过2026-10-16)。这不关闭原生跨客户端 CAS、完整认证宿主、正式运行产物激活或整个 UI 的剩余对照。

之后只改 Goal CSS，修正原生 superellipse／回退半径、按钮边框／hover／焦点与保存中 textarea 样式。原 14 项 Goal 回归通过；新增正式 Chromium 四例与 Firefox 四例分别通过、无跳过，后者实际不支持 corner-shape。首批关闭按钮名称与 unwatch 测试接线失败保留，未算作 18 项单批全绿。前端类型／生产构建通过，2834 产品源文件及 72 shared 产物在本批前后相同，详情见 [Goal 控件样式](goal-controls-style-parity-20261016.md)。这批晚于标准长测，未重跑或改写此前源码的 30 分钟结果；该批保存中 close 的可聚焦状态尚未解决。

再沿原 Cu 的受控关闭链修正 close：保存时保留按钮可聚焦／点击，同步 busy guard 继续阻止关闭，并补原焦点 ring。两项新增单测及真实浏览器差异均先红后绿；最新单测 **1 文件／10 项**、前端类型／构建通过，冻结版本 **Chromium 18 项／2.8 分钟**、另批 **Firefox 4 项／1.9 分钟** 全部通过，无跳过。两尺寸两主题实际 Tab、close 点击、Escape、弹窗外点击均保持同一弹窗／草稿与单一保存请求；24 输入／七 HTTP 资产逐例核对，2834 源码、18 E2E、3 基础设施与 72 shared 产物前后不变。详见 [关闭按钮验收](goal-controls-style-parity-20261016.md#保存中关闭按钮的焦点与受控关闭)；不扩展为完整官方 IDE，也不复用此前长测宣称本次源码又测过 30 分钟。

侧边聊天权限菜单原先读取全局主会话，已改由主／展开／侧边输入区显式传入目标，并移除会抢主输入焦点的全局请求。真实组件先红后绿后，4 文件 13 单测、web 类型／构建、1440／390 浏览器 2 例和同源码 Goal／输入区回归 16 例全部通过，零跳过；2835 源码、19 E2E、3 基础设施、72 shared 产物哈希与集合相同。普通菜单关闭／Escape 聚焦自身按钮，主会话／默认值／两边草稿保留；没有真实原生权限写入，完全访问弹窗也未额外承诺编辑器焦点。首批测试入口／HMR 接线失败另档保留。证据与边界见 [侧边权限验收](side-chat-permission-owner-20261016.md)。截图发现的侧边底栏文字重叠另行处理；此前长测不改写为本次源码结果。

侧边底栏仅用限定 CSS 恢复正常流，旧布局侵入控件区 12px 的双宽几何红灯已转绿；帮助／长状态／身份告警与核对按钮均有独立空间，44px 触控和 62px 输入区保留，主 frame 的布局指标不变。侧边 2 例、修正旧入口后的主／展开回归 6 例、web 类型／构建通过，零跳过。初批遗漏 view=chat 的元数据路由，以及主／展开回归 4 过 2 个旧入口失败均单独保留。2835 源／21 E2E／3 基础设施／72 shared 最终冻结核对无漂移，详见 [侧边底栏](side-chat-footer-layout-20261016.md)。

继续核对发现侧边 fork 只消费三个模型字段，丢弃响应已有的策略、审批和服务等级；下一次拟提交参数因而采用默认值。现复用既有 normalizer，并用按字段累计的本地设置缓存保守处理迟到初始 ACK，保护 pending、显式清空、不完整策略组与未知来源 legacy entry；不增加读写调用，不证明跨客户端 CAS 或所有 HTTP／SSE 到达顺序。稳定初始 16 项为 9 红 7 绿，另保留首次夹具失败；最终 11 文件／81 单测、web 类型／构建，以及同一冻结源码 18 浏览器均通过，零跳过。两尺寸实际侧边保留完整策略／fast，主会话、默认值、两边草稿和焦点不变，底栏三阶段也无回归。2836 源码、22 测试／夹具、3 基础设施、72 shared 产物和逐例 20 输入哈希无漂移，详见 [fork 设置与回执](side-chat-fork-settings-20261016.md)。未写真实 native 权限、未激活正式运行产物；原版完整 hCa 初焦点仍未验，此前长测也不改写为本批结果。
