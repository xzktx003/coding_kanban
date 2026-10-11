# Codex 特殊链接分支对照（2026-10-11）

继续 [完整目标](plan.md)，不把普通链接对齐等同于全部链接能力完成。当前前端为局域网 **HTTP :8484** `http://10.30.0.24:8484`，绑定 `0.0.0.0`；临时原包参考为 **HTTP :43831**。

## 已补齐：hotline 标记与 SMS

原包 `app-initial-e98b9eaef8e3.js` 的 `Cni/wni`（偏移 4396497／4396506）只在 http、https、tel、sms 中移除独立 query token `oai_link_source=model_response_hotline`。保留其他参数、编码与 hash，移除重复的同名独立 token；字符串中含有相同文字、编码后的值、值后多一个后缀或 mailto 并不触发清理。`Sri` 的点击统计未复制；原始回复正文不因此改写。

产品先保留既有 URL hardening 的授权结果，再执行该清理。Streamdown 缺省 sanitizer 不支持 SMS，原行为会丢掉短信链接；在复制既有 schema／citation 属性规则后只增加 sms，并在 urlTransform 中允许该协议。javascript 拒绝、原项目文件打开及引用范围继续保留。没有用放行全部协议替代这项变更。

第一次截图确认电话／短信的原生标签也有 16px 地球图标，产品此前没有。非网站链接现在显示同一原生 SVG，仍不会请求网站 favicon；增加实际 path 对比，不能仅以 href 一致判定通过。

测试与证据：

- 目标／SMS 红灯 `/tmp/codex-hotline-red.log`，图标红灯 `/tmp/codex-hotline-icon-red.log`。
- Markdown／引用相关 36 文件、152 用例通过 `/tmp/codex-hotline-units-confirmed.log`；最后图标修复的 2 文件、7 用例通过 `/tmp/codex-hotline-icon-green.log`，两组不相加为唯一数量。
- 手机 390／桌面 700，深浅主题四组合通过 `/tmp/codex-hotline-browser-confirmed.log`；截图与原包 href／图标断言位于 `.dev-runtime/codex-hotline-browser-confirmed/`。验证实际可用链接、原 URL 提示和 SVG 图标，不据此称已在物理手机拨号或发送短信。
- 既有引用四组合与表格四组合通过 `/tmp/codex-hotline-markdown-regression.log`。该整组最初另有四个 SVG 失败，仅因脚本仍直接读取 HTTP 下不存在的 Clipboard API；原始失败保留。
- SVG 脚本改为 HTTPS 读取系统剪贴板、HTTP 观察真实 copy event，未替换 Clipboard API／execCommand，所有源字符串、无脚本执行、尺寸、384px 上限及相同 canvas raster 断言保留；四组合通过 `/tmp/codex-hotline-svg-confirmed.log`，截图 `.dev-runtime/codex-hotline-svg-confirmed/`。此前页面像素残差仍未关闭。
- 当前前端类型检查与生产构建通过 `/tmp/codex-hotline-build.log`；保留已有 bundle 大小提示。第一次类型检查还撞到并行修改中的 NativeModelSelector 缺 import，稍后当前文件已有正确 import，本任务未改该文件；自己的 sanitizer tuple 类型错误已修正。

## 特殊富预览：实际基线与未完成项

来源仍为未修改的原 JS／CSS，使用真实 Markdown／M1t provider。在当前 extension 宿主、未注入预览能力或实验开关的条件下，实际结果保存在 `.dev-runtime/codex-special-link-baseline/`：

| 链接 | 原组件实际结果 | 来源与后续要求 |
| --- | --- | --- |
| `team.slack.com/archives/C123/p1700000000000000` | 700ms 交互卡片，Slack 图标、域名与「打开」，无可用连接时没有正文 | `Tti/Dti/Eti`、`ini/Kti/D3`；200ms 悬停预取，离开／点击／拖动／Escape 取消，384px 剩余空间选择上下方 |
| GitHub PR | 普通 URL 提示 | `bri/xri` 用实验开关 `1892621033` 决定 `_ni`；本基线的普通提示不代表 PR 富预览分支已实现或已验收 |
| 直接图片 URL | 普通 URL 提示 | 普通网站富预览依赖 `mh.websitePreviews`；不能因为路径像图片就绕过真实宿主门禁 |

Slack 不是任意 URL 的网页抓取。`state-5eb30f7a10ad.js` 从当前账号／host 的 Codex Apps MCP 目录选择唯一匹配 Slack 连接与 action：`slack_read_user_profile` 或 `slack_read_thread`。读取前后必须重新核对账号、server、tool 与 target；消息 structuredContent 的 channel、thread 和具体 message 均需匹配，描述最多 300 字；账号变化、数据不匹配或失败回退 unavailable。原缓存 stale 1 分钟、gc 5 分钟，不因 focus／reconnect 自动读取。后续实现要保留这些归属与取消规则，不用任意网页请求或伪造消息元数据替代。

**此前的 Slack 卡片红灯**：`tests/e2e/session-codex-slack-preview.spec.ts` 真实红灯 `/tmp/codex-slack-preview-red.log`；`.dev-runtime/codex-slack-preview-red/` 包含原组件交互卡片与产品仍为普通 URL 提示的截图。后续实现与验收见下节；原始失败证据保留。

提示文字栅格化与 SVG 页面像素残差继续见 [前轮记录](link-focus-progress.md)。本页不代表编辑器／对话框的全量目标完成；未提交、推送、重启正式前端或 Agent。

验证结束时核对并退出本任务的参考进程 PID 2802852，临时 native-only probe 已移除，基线 JSON 与截图保留；正式 HTTP 前端 PID 2626814 保持。Slack 失败用例保留在正式 E2E 目录，待实现后转绿，不能计入本轮通过数量。

## Slack 卡片与正文控制器（后续进度）

`NativeSlackPreview` 已接入真实 Markdown 链接分支。原生 Slack 与打开图标来自原组件的 SVG path，不请求 Slack 的远程 favicon。无连接时呈现真实的域名／打开入口，不伪造消息、用户或连接状态。700ms 悬停显示、200ms 预取、100ms 离开宽限、上下方选择、8px 视口边界及 360×46px 卡片与原组件对照；键盘焦点可显示、Tab 进入打开链接、Escape 关闭。窗口失焦、卸载、目标／身份变化及隐藏会话模式会释放自己的读取与提示状态，不触及 Agent 轮次。

最初使用的 HoverCard 会把打开链接设置为 `tabindex=-1`；改为交互 Tooltip，并使实际表面承载 `role=tooltip` 与触发元素的描述 ID，避免 Radix 在隐藏 span 中再复制一整份正文／链接。此能力由可选 `interactive` 开启，普通工具提示保持原行为。悬停预取的 Escape 捕获仅在自己的延迟计时器存活时注册，计时器结束、离开、点击、隐藏或卸载立即移除，不留下后台快捷键。

控制器要求 host 提供账号／host／server／tool／target 身份，在读取前后复核；身份订阅清空旧数据，卸载取消自己的请求。只缓存匹配后的标题（最多 200 字）和描述（最多 300 字），不缓存完整工具正文。有效和不可用结果均 stale 1 分钟，未打开时 gc 5 分钟，不因 focus／reconnect 轮询。解析支持原 Codex Apps 的封装结果（`e98 Fg`），再按 `state-5eb30f7a10ad k` 核对用户、channel、thread 与具体 message；不匹配、重复／未知资料字段或错误回落 unavailable。

正文最初用 CSS 高度动画，真实逐帧采样发现其启动比原 Motion 组件提前。现改为 `motion.div` 的 `initial=false`、`height: auto/0`、300ms、`ease=[0.19,1,0.22,1]`，减少动态时 duration=0。动画曲线的最终实测结果另记录，不仅凭参数相同宣布动画一致。

动画红灯 `/tmp/codex-slack-animation.log` 保留：60ms 附近高度相差约 23.84px。改为 Motion 后，和 38 文件单测并行的一次测量仍有 13.63px 差异，见 `/tmp/codex-slack-motion-green.log`（文件名不代表通过）；该次逐帧数据出现明显调度空档。单测结束后串行运行，同一 12px 比较界限、不改断言，动画项通过 `/tmp/codex-slack-motion-final.log`，曲线在 `.dev-runtime/codex-slack-motion-final/`。这是当前 Chromium、700px 深色的局部实测，帧调度并不等于可保证的全浏览器逐像素同步。

已完成的证据：

- 无连接卡片的深浅主题 × 390／700px 四组合及模型菜单六项对照通过 `/tmp/codex-slack-delivery-green.log`，截图、完整 SVG 与几何 JSON 位于 `.dev-runtime/codex-slack-delivery-green/`。键盘进入／关闭也实际执行，不只校验 href。
- 有效资料／消息的八项浏览器正文对照与项目搜索入口共九项通过 `/tmp/codex-slack-content-confirmed.log`。逐字段核对字体、位置、尺寸和两行截断，截图在 `.dev-runtime/codex-slack-content-confirmed/`。初始手机参考把原组件放进正文 padding，得到错误的 356px 约束；现独立内容采用已由真实弹层验证的 360px 约束，未改产品宽度或放宽断言。
- 封装解析红灯 `/tmp/codex-slack-envelope-red.log`、预取 Escape 红灯 `/tmp/codex-slack-prefetch-red.log`、失败结果缓存红灯 `/tmp/codex-slack-failure-cache-red.log` 均有保留；最终四文件 25 单测通过 `/tmp/codex-slack-cache-green.log`。正文与引用回归 38 文件、169 项通过 `/tmp/codex-slack-regression-final.log`，两组不能相加为唯一总数。
- 高级模型菜单曾因项目的搜索按钮独占一行而多出 24px，红灯 `/tmp/codex-slack-delivery.log` 保留。保留项目搜索功能并将入口放进标题行，深浅高级菜单的原几何断言恢复通过；搜索、过滤、显式自定义模型 ID 与输入恢复仍由 `session-ux` 验证。
- 改用 Motion 后，无连接四组合、正文八组合及实际动画共 13 项通过 `/tmp/codex-slack-motion-final.log`。打开网站的四组合随后通过 `/tmp/codex-slack-open-final.log`：实际点击并产生新窗口、目标 URL 一致，远程网页由测试隔离，只验证导航，不声称登录或读取 Slack。开始追加点击时，参考窗口仍停在 Escape 后的同一焦点或后台，导致四项失败 `/tmp/codex-slack-open-confirmed.log`；现先恢复前台并重新进入焦点，未改产品导航、断言或原包。最终前端类型检查及生产构建通过 `/tmp/codex-slack-final-build.log`，保留已有 bundle 提示。
- 运行中 Agent 的隔离浏览器项通过 `/tmp/codex-slack-agent-isolation.log`：真实界面先显示可用停止按钮，再进入卡片打开链接并按 Escape；提示关闭、停止按钮仍可用、没有 turn/interrupt 或队列中断请求。隔离数据目录、截图 `.dev-runtime/codex-slack-agent-isolation/`；该用例没有操作正式 Agent。

**上述阶段尚未接通生产 MCP 通路（后续进度见文末）**。该阶段生产 Markdown 的 host 默认空，资料／消息与延迟结果均由隔离、受控的有效工具字段交付，不能据此声称读取了真实 Slack 账号或远程消息。后续仍须区分源码通路、隔离协议、真实账号连接与正式运行产物。GitHub 实验开启形态和 websitePreviews 宿主分支也未在本节关闭。

## 已核实的原生 MCP 通路

只读运行原包 `codex app-server generate-ts --experimental`，类型产物保存在 `.dev-runtime/codex-slack-schema/`，日志 `/tmp/codex-slack-schema.log`；不启动 Agent、不改原包。原包确实提供 `mcpServer/tool/call`（threadId／server／tool／arguments／_meta），并非现有非实验 bindings 未列出就不存在。账号响应的 `workspaceRouting.chatgptAccountId` 为账号归属证据，不能仅凭显示 email 判断账号相同。

原 `GD/WD` 为 host 创建专用 `thread/start`，`ephemeral=true`、`permissions=":read-only"`、`threadSource="mcp_extension_host"`；只重用和注销自己的临时线程，退役须等待自己的在途调用结束，不借用真实 Agent 的线程。工具仅来自 `codex_apps` 中唯一匹配 `connector_name=Slack`、非 synthetic 的 `_codex_apps.resource_uri`，URI 的 connector 与 metadata 的 connectorId／connector_id 必须一致，action 必须是 `slack_read_user_profile`／`slack_read_thread`。资料参数为 user_id+detailed；消息用 threadTs、concise+structured，选中根消息 limit=1、回复 limit=100。调用前后复核账号与目录 target，并带已核对的工具 metadata；不能开放任意 server／tool／参数或网页抓取接口。

当前正式 HTTP 前端保持 PID 2626814，未重启正式会话运行服务、停止 Agent、提交或推送。该阶段不关闭完整编辑器／对话框复刻目标。

本次验证结束后核对 cwd／参数并退出本任务参考进程 PID 2878684；原包、类型证据、JSON 和截图保留。后续重开参考服务只用于隔离对照，不把临时 :43831 当作正式应用入口。

## 生产读取接口与隔离验收（下一批）

生产 Markdown 默认 host 现已接 `features/native-slack/service.ts`，不再默认空。TS 运行层新增限定的 context/read 两个接口；`codex/slack-preview.ts` 只接受 Slack href 与服务端 contextToken，选择唯一白名单 action，核对账号／目录后，经 `CodexService.raw` 复用自己的只读临时线程，调用 `mcpServer/tool/call`。与 [数据架构](../../session-slack-preview.md)一致，原始工具结果仅在运行层解析，网页接收不超过 200／300 字符的独立短字符串。

context/read 首次 HTTP 红灯为 404，见 `/tmp/codex-slack-rpc-red.log`；白名单、并发合并、负结果缓存、目标伪造、thread 根／回复和账号切换延后注销等测试转绿。运行层全套 178 项通过 `/tmp/codex-slack-runtime-regression.log`；最后前端呈现／引用／预览／事件流共 40 文件、183 项通过 `/tmp/codex-slack-final-client-regression.log`。目录中原来没有连接时，新增工具事件曾被负缓存忽略，红灯 `/tmp/codex-slack-new-connector-red.log` 保留，6 项传输单测在 `/tmp/codex-slack-new-connector-green.log` 转绿。身份变化与恢复缺口区分处理：新身份可更新打开的卡片，断连／重连不能自动重读工具。

浏览器使用自身 fetch 与 EventSource，通过真实 HTTP 服务执行生产路由／控制器；390／700 × 深浅色四项通过 `/tmp/codex-slack-http-isolation.log`，截图和传输证据位于 `.dev-runtime/codex-slack-http-isolation/`。同时交付临时线程 start/closed 元数据，确认不新增关注标签、不改变输入目标；700 深色还验证了真实 SSE 账号事件、在途旧结果丢弃、旧线程调用未结束时不注销、新资料不被旧回复覆盖。所有读取 HTTP 响应小于 1000 字节。账号、目录与工具输出仍是隔离协议夹具，不能当作远程 Slack 的证据。最终冻结后的结果另见 `/tmp/codex-slack-http-delivery.log` 与 `/tmp/codex-slack-final-web-build.log`。

`pnpm check` 已通过共享、运行层、网关与网页检查／构建，日志 `/tmp/codex-slack-cross-check.log`；后续最后的前端改动独立再构建。原 208 个迁移契约仍 208/208 注册，日志 `/tmp/codex-slack-audit-confirmed.log`；命令应显式使用 `pnpm ... run audit`，否则 pnpm 的内置依赖 audit 抢占命令并报 Unknown option recursive，旧失败 `/tmp/codex-slack-audit.log` 保留。该注册数量不代替新接口行为验收。

未修改的原包 CLI 实际返回 ChatGPT 账号与有效 workspaceRouting，8 个 MCP server 中没有唯一 Slack 资料工具；因此远程真实资料／消息目前不能验证。原生只读临时线程已实际创建／注销，不取得任何 Agent 执行权；实验 `mcpServer/tool/call` 对不存在的工具给出已识别方法的错误，没有执行真实工具或 turn。证据 `/tmp/codex-slack-native-host-probe.log`。注意原生 `thread.source` 返回 `vscode`，不能用它代替我们自己记录的 ID 判断临时线程归属。

正式 HTTP :8484 的运行服务 context 仍为 404，未为新编译产物重启服务或停止 Agent。因此本批证明源码与隔离数据通路，**不是已启用正式 Slack 连接**；实际连接、权限失败、旧版本兼容及安全启用仍有独立验收边界。完整编辑器／对话框目标继续进行。

最终新增原始诊断的投影保护：context 的原生账号／目录异常回落 null，read 重核失败只返回固定的身份变化说明，原始诊断不能进入网页。红灯 `/tmp/codex-slack-diagnostic-red.log` 保留；最终运行层全套 179 项通过 `/tmp/codex-slack-final-runtime-regression.log`，类型检查 `/tmp/codex-slack-final-runtime-typecheck.log`；最终前端 183 项和构建见上述日志。HTTP 四组合最终通过 `/tmp/codex-slack-http-delivery.log`，最后诊断保护后的账号切换单项复验 `/tmp/codex-slack-http-final-guard.log`。

## GitHub PR 开启分支与只读接口（2026-10-11）

继续完整目标。本批新增 `NativeGithubPreview` 与 TS 运行层限定 `github-preview/context/read`；普通 Markdown 的 PR 入口接入这个开关边界，当前没有原生 Statsig 来源时仍关闭。实现、原包 schema、fetch 优先／info 回退、元数据和留存预算见 [架构](../../session-github-preview.md)。不把手工测试 gate 值当作真实实验能力。

先红的地址／schema 用例见 `/tmp/codex-github-schema-red.log`，Codex Apps 封装红灯 `/tmp/codex-github-envelope-red.log`，运行层缺失红灯 `/tmp/codex-github-runtime-red.log`。首次浏览器失败 `/tmp/codex-github-browser-red.log` 揭示短描述宽度与原包不符；原包 GitHub 图标的精确 path 已从实际 DOM 核对。原生 `_ni` 实测 Escape 返回 Review PR，证据 `.dev-runtime/codex-github-native-keyboard/`；恢复焦点不发新的工具请求。

真实网络测试先捕获双次 normalize 把合法 HTTP 状态投影当成不可用：`/tmp/codex-github-http.log`。现投影校验可重复执行，不接受工具原始正文；单桌面实际 HTTP/EventSource 的账号变更与有界数据验收已通过 `/tmp/codex-github-http-delivery.log`。其账号、目录、PR 数据来自隔离 fixture，API handler、fetch 与 EventSource 为真实实现。

未完成：原生 Statsig `1892621033` 的宿主传播、真实 GitHub 连接／权限／远程工具，以及正式旧服务在安全窗口启用。未停止 Agent，未提交或发布。最终整组验收和剩余截图差异另追加结果，不以这一批标记总体目标完成。

进一步的严格颜色红灯 `/tmp/codex-github-icon-color-red.log` 捕获 GitHub 图标错误继承完整前景色，已改为原包 65% secondary，正文／SVG／图标几何与颜色四组合通过 `/tmp/codex-github-preview-confirmed.log`。普通 Markdown 的 GitHub／子域图标也按原包内置品牌图标，不请求 favicon，红灯 `/tmp/codex-github-link-icon-red.log`，实际原包 DOM／截图通过 `/tmp/codex-github-markdown-icon.log`。

语言切换的独立红灯 `/tmp/codex-github-locale-red.log` 揭示格式化器被当成新传输身份，导致关闭卡片；格式化现在与原始短字段缓存分离，中文／英文切换不重新读取，16 项控制器单测转绿 `/tmp/codex-github-locale-green.log`。

最终结果：当前共享／运行层／前后端 `pnpm check` 通过 `/tmp/codex-github-final-check.log`；最后展示格式化修复后的前端类型检查和生产构建通过 `/tmp/codex-github-final-web-build.log`（既有大 bundle 提示保留）。运行层 184/184 `/tmp/codex-github-final-runtime-regression.log`，相关前端 37 文件 151/151 `/tmp/codex-github-final-client-confirmed.log`；原迁移契约仍 208/208 `/tmp/codex-github-audit.log`，新增预览接口有独立行为验收。

真实浏览器整组 27/27 `/tmp/codex-github-browser-regression.log` 覆盖 GitHub／Slack 的网络、卡片、原包键盘、Slack 原动画曲线及活跃轮次 Escape；最后 GitHub 10/10 `/tmp/codex-github-complete-branch.log` 包含普通 Markdown 门禁关闭的品牌图标、原生键盘和四组合全生命周期颜色／几何对照。截图 `.dev-runtime/codex-github-complete-branch/`。语言切换、真实网络缓存和 SSE 账号变化补验 1/1 `/tmp/codex-github-locale-http.log`，截图 `.dev-runtime/codex-github-locale-http/`。这些批次有重叠，不相加为唯一用例数。

临时原包参考服务器在验收后仅停止本任务自己启动的进程；正式 HTTP :8484 前端及活跃 Agent 保持运行。总体目标仍继续，Statsig／远程 GitHub／正式服务启用仍是明确待完成项。

## 普通网站宿主、品牌与图片生命周期（2026-10-11）

继续完整目标，不将本批标记为编辑器／对话框全部完成。新的源码核对纠正早期夹具边界：`extension/out/extension.js` 的 `registerAppHostSessionForWebview` 实际安装 `websitePreviews:new aM(fetch)`；旧普通 URL 参考缺少这个宿主，不能当成 VS Code 没有网站能力的证据。实现与资源约束见 [网站预览架构](../../session-website-preview.md)。

Node 网关直接提供固定 capabilities/get HTTP 通路，保留原地址、公开 DNS、最多三次跳转、HTML／图片 MIME、尺寸／字节、4 活跃＋8 排队、32 条／24 MiB 和 TTL；TLS 连接固定使用已检查地址。生产浏览器通过实际 HTTP handler/service 读取元数据，并对照原 D3 的 hero、thumbnail、standalone、文字、无元数据、直接图片六种内部布局。原缩略图圆角红灯 `/tmp/codex-website-browser-red.log` 捕获 7px／10px 差异，未修改原包或放宽几何断言。

原 `xri` 关闭 GitHub PR 实验只移除 `pullRequest` 参数，仍交给 `Cri`；网站宿主存在时应走普通网页卡片，网站能力也不存在才显示 URL 提示。新红灯 `/tmp/codex-github-website-fallback-red.log` 后补齐这个回退，不触发 GitHub MCP；第七种布局为关闭 PR 实验的公开网页元数据，不将它冒充 PR 状态或真实工具输出。新品牌头部严格 computed-style 红灯 `/tmp/codex-website-pr-website-red.log` 捕获继承完整前景色及 2px 圆角，修正为原生 65% secondary 与 2.5px。

品牌按原组件实际 DOM 提取十类 SVG（Google Calendar／Drive、Figma、GitHub、Linear、Gmail、Notion、OpenAI 招聘、Salesforce、Slack），没有原图标的 Box／Dropbox／SharePoint 保留 favicon。20 个品牌、子域和 raw URL 标签在 390／700 × 深浅主题核对完整 SVG 树、尺寸、颜色与截图。两份 favicon 红灯 `/tmp/codex-website-header-icon-red.log`、`/tmp/codex-website-inline-icon-red.log` 捕获成功解码后仍叠加地球、换 origin 继承加载状态；原 `xNi` 又确认图标服务只接收 origin，新增 `/tmp/codex-favicon-origin-red.log` 后移除路径／query／hash／凭证，成功时移除 fallback，保留原 object-contain。最后网站组实际核对 header 的 src、opacity、object-fit 和圆角。

网站／共用卡片及 GitHub 文案补本项目已有中、英、日三种语言。日文实际来源 `ja-JP-cccb9b32b90a.js`；语言切换保持已裁剪数据及身份，不重新执行 MCP。公开 HTTPS 实测 `https://example.com` 在正式局域网 **HTTP :8484** 的网关返回 ready／Example Domain；浏览器与原 D3 展示同一真实投影，保留中／日截图。两侧实际点击打开并创建新窗口，URL 相同，导航目标页面在测试中隔离；这证明公开元数据读取和导航行为，不能冒充远程 Slack/GitHub 连接。

图片内存先出现真实红灯：旧实现清空 cache 后，backing storage 仍新增约 109 MiB，不能只凭 JS heap 下降解释为回收。未开启 Network 检查域的独立 CDP 上也复现，排除网络检查器缓存；堆快照定位到 `Context.previewImage → onOpenChange → Radix`。正文移到独立组件、数据用 ref＋小修订号、淘汰后释放旧 React props，图片字节解码与长期清理闭包分开，图片 data URI 不作为 React key。图片使用卡片自己的 Blob URL，关闭后移除 src／revoke；原生协议仍返回 data URI，**浏览器内置复制图片地址仍有 blob／data URI 差异**，不宣称全部内置图片上下文动作已经一致。

另有独立红灯 `/tmp/codex-website-capability-red.log` 捕获同端点 Token 切换的一帧旧能力，capability 状态现核对端点＋宿主，旧结果不能覆盖新身份。`/tmp/codex-website-visible-gc-red.log` 捕获可见卡片也在五分钟退休；现与共用可见生命周期同步，打开暂停，关闭后才计时，LRU 优先淘汰不可见条目，原预算不变。可见十分钟与关闭后五分钟的边界由 fake-clock 单测确认，不声称做了十分钟自然 GC 测量。

冻结逻辑后的相关前端 49 文件、233 项通过 `/tmp/codex-website-closed-client-regression.log`，网关／公开预览／历史与 SSE 裁剪回归 22 项通过 `/tmp/codex-website-final-server-check.log`。途中工作区新反馈对话漏类型、草稿 Personality 少原生 none，分别触发 TS2345／TS2367；仅补已存在的反馈成员、复用原生 Personality 类型，保留其实现。全量 `pnpm check` 转绿 `/tmp/codex-website-frozen-check.log`；最后图片／图标样式后的前端检查与生产构建通过 `/tmp/codex-website-closed-web-build.log`，既有 bundle 大块提示保留。这些类型修复不代表反馈／性格 UI 已完成原生全功能或真实提交验收。

共用控件、品牌、网站、GH／Slack HTTP 及动画的一次整组 27 项通过 `/tmp/codex-website-final-browser.log`；随后可见生命周期、两种图片内存和动画／网站四组合 7 项通过 `/tmp/codex-website-gc-final-browser.log`。关闭 PR 实验的回退及当前品牌样式后网站四组合、公开网页／日文／打开行为 5 项通过 `/tmp/codex-website-pr-fallback-final.log`。这些组有重叠，不能相加为唯一验收数量；最后样式冻结复验另追加下方记录。

独立三轮压力为 120 张各 2 MiB 的不同图片，启用正式入口相同的 React 开发 measure 留存保护，不清普通应用记录。最终可见生命周期组 JS used 为 17,825,800 → 18,923,080 → 19,216,244 → 19,443,080 bytes，backing storage 为 8,711,244 → 31,081,477 → 39,470,155 → 47,858,833 bytes；renderer RSS 为 156,717,056 → 185,348,096 → 197,685,248 → 206,123,008 bytes。原 42 MiB JS／backing 增量断言保留，暖机后两轮 RSS 增量也小于 42 MiB，120 个 Blob 全部注销。附件 `.dev-runtime/codex-website-gc-final/` 中有测量和错误／截图记录；测试专用 GC 与短时压力不能代替自然 GC 或长期 tab RSS 稳定性，也没有停止 Agent／刷新页面掩盖增长。

当前剩余：内置图片地址上下文差异、网站原生 RPC 宿主的完整弹层集成对照、原生 GitHub Statsig 同步、真实 Slack/GitHub 连接与正式旧运行服务安全启用，以及完整目标的其他编辑器／对话框分支。D3 内部布局与共用提示外壳分开验收，不能用静态裸 D3 画面声称 VS Code 全窗口像素一致。正式前端仍 PID 2626814，未提交、推送或停止 Agent；参考 :43831 是本任务隔离进程，验收结束后只退出自己的参考服务。


最后样式冻结复验 13 项通过 `/tmp/codex-website-last-style.log`：品牌四组合、原生 PR 生命周期四组合、网站七种内部布局四组合以及正式公开网站／日文／实际打开行为。双侧 PNG 和 JSON 位于 `.dev-runtime/codex-website-last-style/`。这些是本批指定组件与状态的证据，不是整个 VS Code／本项目窗口的像素相等证明。

内存验证随后强化为**每张图片 complete 且 naturalWidth=1 后才关闭**，排除只加载标题或未解码就销毁的工作负载；40 张正常应用上下文和 120 张独立 CDP 三轮两项通过 `/tmp/codex-website-decoded-memory.log`，没有放宽原阈值。最终 JS used 为 17,838,708 → 18,929,492 → 19,209,304 → 19,433,628，backing 为 8,711,215 → 19,896,573 → 31,081,477 → 39,470,155，RSS 为 157,036,544 → 174,895,104 → 187,613,184 → 197,296,128 bytes；120 次创建／120 次注销，JS 与 backing 增量小于 42 MiB，暖机后 RSS 增量也小于 42 MiB。附件 `.dev-runtime/codex-website-decoded-memory/` 是最终解码工作负载口径，前面的失败与中间样本保留，不把短时测试专用 GC 解释成长测自然 GC 关闭。

收尾核对：工作分支 main、HEAD 8e7fb60；以上验收针对未提交工作区，不把 HEAD 当成包含本批改动的发布 SHA。参考进程 PID 3606495 的 cwd／完整参数核对后已退出，正式 Vite PID 2626814 仍绑定 0.0.0.0:8484，最后 LAN capabilities 返回 supported:true。原包无工作区改动，.env 仍被忽略，未提交／推送。截图入口 `.dev-runtime/codex-website-evidence.md`；最后强制解码的测量口径和未完成边界保留在本节，不关闭总体目标。

### 网站完整 RPC 弹层集成追加（2026-10-11）

上文“网站原生 RPC 宿主的完整弹层集成对照”现补齐隔离客户端路径：参考原包自己的 RPC Session／RpcTarget、`vscode-capn-rpc-connect/message`、`j6e` 初始化及 website 查询实际运行，宿主方法转到生产 HTTP handler/service。保留原应用／认证／会话 Provider，不再用裸 Markdown 诊断认定 Escape 差异；没有修改 third_party，也没有绕过浏览器本地网络保护。公开 DNS／HTML／图片是受控网络 fixture，这仍不是实际 VS Code extension 进程或远程账号验收。

网站文字与已解码 hero 的完整 Tooltip 以 390／700、深浅主题逐一比较尺寸、锚点间距、侧向、可见阴影、边框、图文位置和字体，并验证悬停进入弹层、键盘聚焦、Tab 到打开按钮、Escape 关闭。仅归一原 Tailwind 的透明零尺寸阴影层，所有可见层严格相等。每场景两个 URL 各读一次，键盘重进命中缓存，未发 Agent 控制调用。保留原 Provider 后网站 4 项、Slack 4 项与运行中 Agent 隔离 1 项，共 **9 项通过**，日志 `/tmp/codex-website-rpc-delivery.log`；双侧截图与 JSON 位于 `.dev-runtime/codex-website-rpc-delivery/`，索引 `.dev-runtime/codex-website-rpc-evidence.md`。

尚未闭合：浏览器内置图片地址的 blob／data URI 差异、真实 VS Code extension 宿主与远程 Slack/GitHub、GitHub Statsig 传播、旧正式运行服务安全启用，以及全目标其他分支。此次 reduced-motion 验收不代表网站动画或全窗口像素一致，总体目标继续进行。

本轮收尾：main／HEAD 8e7fb60，验证对象仍为未提交工作区；third_party 无新增改动。三份测试文件格式检查和 git diff --check 通过，.env 仍忽略。参考 PID 11833 的 cwd／完整参数核对后仅退出该自建服务；正式前端 PID 2626814 仍监听 0.0.0.0:8484，LAN capabilities 实测 supported:true。未提交、推送或重启正式 Agent 运行服务。

### rich 弹层横向回退与位置追加（2026-10-11）

本轮从网站完整 RPC 路径继续检查原 `J1t` 空间规则。真实红灯 `/tmp/codex-website-collision-red.log`：700×360 下原包 side=right、height=306.75，产品 side=bottom、height=201.875。共用 rich 控件接入原同类 Floating UI 候选规则，处理 Radix 额外 wrapper、1px margin、实际动画高度与设备像素舍入，关闭时释放局部观察器并失效在途结果。先只有侧向对齐，后将完整坐标纳入严格断言；中间挂载／旧坐标诊断保留，不算绿色最终证据。

位置诊断另捕获 reduced-motion 全局 0.01ms 过渡：wrapper inline transform 已更新但 computed transform 尚留在离屏测量位置，结束无属性事件，坐标修正无法重核。仅 rich wrapper 与外壳禁用过渡，保留原正文 Motion。390／700 深色 x／y、width／height、side、正文 scroll/client 高度、toolbar 高度全部相同，两项通过 `/tmp/codex-website-collision-no-transition.log`。窄屏使用真实 wheel 到底，并截图工具栏固定和可见标题；宽屏完整卡片在右侧不要求虚构滚动。

迟到内容沿真实原包 RPC／网站 query 进入 D3，逐帧观测记录 DOM 挂载、每次高度写入、实际 rAF；首个非零帧作为起点的浅色旧断言因长帧失败，按实际挂载时间比较后两主题通过。另用生产图片尺寸解析接受的截断 PNG 验证浏览器真实解码失败，错误事件按原 width 属性记录，不使用 CSS 缩放后的 width 属性值；标题／描述和无图片布局原包一致。

短视口的卡片测试使用相同参考矩形，不把独有导航／输入区放进原包。整页 360px 高度的链接位置曾从鼠标下移动到导航后方，约 13ms pointerout、读请求为零；`.dev-runtime/codex-website-dynamic-probe/` 保存该现象。该整页问题未修复，不用固定锚点验收冒充它已经解决。完整目标、真实远程账号、Statsig、图片地址和其他分支仍未闭合。

最终整组首次 24 项为 23 通过／1 深色动画采样失败（`/tmp/codex-rich-placement-delivery.log`），最近帧选择导致比较了 67ms／58ms；改为相邻实测帧插值仍捕获一次浅色 0.14426 超限（`/tmp/codex-rich-placement-animation-final.log`）。不调整 0.12 阈值或原动画配置。随后减少定位器强制布局：只有受约束时临时解除 max-height，正文变化的读布局合并为单个 rAF、退出时取消。冻结后动态 8 项通过 `/tmp/codex-rich-placement-batched.log`。原帧记录中产品仍有约 79.9／83.1ms 最大间隔，原参考约 22.9／16.8ms，平滑度差异仍未关闭；本组估计的形状／时长通过不等于所有真实帧动画 1:1。

本轮最终证据：批处理后的 `pnpm check`、31 项单测、两项强制解码图片释放均通过（日志 `/tmp/codex-rich-placement-final-check.log`、`final-unit.log`、`final-memory.log`）。网站动态 8 项通过；其余控件组 15 通过／旧 Slack 动画采样 1 失败，保留 15.859375px 红灯。旧夹具同步重渲染／Promise 回执混合 release 起点，记录正文挂载并相邻帧插值后单项复验通过 `/tmp/codex-rich-placement-slack-phase.log`；340ms 结束、12px、最终高度、中间帧与 Agent 隔离均保留。24 个指定场景由 8＋15＋1 分组验证，不伪称一次整组全绿。

最终 raw CDP 120 张全部创建／注销：heap 17,980,600 → 20,140,572、backing 8,739,919 → 31,607,128、RSS 157,851,648 → 194,678,784 bytes；三个中间点与原阈值在最终 JSON 保留。常规 40 张 heap 增量为 -854,032、backing +13,980,123，但 RSS 290,369,536 → 508,002,304，不将其解释为 RSS 稳定。没有关闭／放宽内存保护。

十对最终动态 PNG 仍有 1,150–4,019 个 RGB 残差像素（最大通道差 174），不能凭相同前景色归因为全部抗锯齿。像素、帧平滑度、低高度整页锚点与常规 RSS 继续列为未闭合；原远程连接、Statsig、图片地址与全目标其他分支亦未关闭。索引 `.dev-runtime/codex-rich-placement-evidence.md`，残差 `.dev-runtime/codex-rich-placement-batched/pixel-residuals.json`。

收尾核对：main／HEAD 8e7fb60，验证对象为未提交工作区，不把 HEAD 当成本批发布 SHA。third_party 无工作区改动；.env 忽略、.env.example 未忽略，git diff --check 与测试文件格式检查通过。参考 PID 65059 的 cwd／完整参数核对后仅退出该自建服务；正式 Vite PID 2626814 仍绑定 0.0.0.0:8484，LAN HTTP capabilities supported:true。未提交、推送或重启正式 Agent 服务；完整目标不关闭。

### 内部分隔线与像素场景追加（2026-10-11）

本轮在当前代码补严格不透明区域 RGBA 门禁，两主题红灯分别 2,797／2,761 个像素。actual platform font 均为 DejaVuSans-Bold，字体／矩形／颜色相同；改 transform、字体平滑或 absolute wrapper 未改善，全部试改撤回。实际 bug 是 rich 顶线／hero 底线混用 8% 外环 token，原 border-subtle 使用 foreground 的 5% oklab；修正后底线整行差异消失。LayerTree 证明仍剩的文字来自对照场景合成差异：产品卡片 Overlap 独立层，原精简参考无此层；仅去掉焦点无改善。

参考仅增加同色不可交互的独立合成背景，原组件／字体／CSS／RPC 不替换，匹配 Overlap 后不透明工具栏／正文均零 RGBA。门槛仍为 0，未把外露的独有背景当作原组件内部颜色。最终 14 项浏览器一次通过 `/tmp/codex-rich-rgb-delivery.log`、22 单测通过 `/tmp/codex-rich-rgb-unit.log`；图、字体／祖先与真实合成原因在 `.dev-runtime/codex-rich-rgb-delivery/`，索引 `.dev-runtime/codex-rich-rgb-evidence.md`。该比较不代表完整窗口的全部合成场景；帧平滑度、低高度整页、RSS、真实远程、Statsig、图片地址和其他原目标分支继续未闭合。

本轮收尾：前端类型检查／生产构建通过 `/tmp/codex-rich-rgb-web-build.log`，既有大块 bundle 提示保留。新增 Chromium 诊断的跨浏览器 guard 后，两项零像素用例复验通过 `/tmp/codex-rich-rgb-final-guard.log`；本轮未声称跨引擎验证。生产只改两处细分隔线颜色，原定位器和字体设置的试改全部撤回。main／HEAD 8e7fb60，验证为未提交工作区；.env 忽略且 .env.example 未忽略，原包无工作区改动，未提交／推送。仅退出自己的参考 PID 176450，正式 Vite PID 2626814 仍绑定 0.0.0.0:8484，LAN HTTP capabilities supported:true；整体目标继续进行。

### 超低高度整页锚点诊断更正（2026-10-11）

上文记录的「链接从鼠标下移到导航后方」现通过整页因果对照解释：Playwright 自动 scrollIntoView 没有真实 wheel／键盘阅读输入，不解除 CodexThread 的 pinned 跟随；onScroll 在下一 rAF 恢复最新位置。390×360 控制样本 scrollTop 26→0→26，700×360 为 44→0→44，链接 y 同时 86→112→86／68→112→68。这是自动测试动作与已有跟随规则的冲突，不是 hover 样式导致布局改高，也不需要修改生产跟随语义。

新增 `tests/e2e/session-codex-short-viewport.spec.ts` 分别覆盖两种宽度的真实 wheel／mouse 路径和自动滚动控制。真实 wheel 先解除 pinned，之后悬停 800ms 每帧命中链接且 y 波动小于 1px，预览可见、Escape 收起，未发送草稿保留；未发起 start／steer／interrupt／resume／stop。该整页复现使用受控短网站字段，不是原生 RPC／远程 MCP 验收；滚动截图展示本项目独有导航与固定输入区，不能据此宣称所有低高度 UI 都已与 VS Code 等同。

四项浏览器回归日志 `/tmp/codex-short-viewport-delivery.log`，截图与逐帧／自动滚动证据在 `.dev-runtime/codex-short-viewport-delivery/`，索引 `.dev-runtime/codex-short-viewport-evidence.md`。本次只补回归与更正失败归因，没有改生产滚动逻辑、放宽原 rich 定位／动画／内存断言。此前低高度 hover 移位疑点撤销；帧平滑度、常规上下文 RSS、真实远程连接、Statsig、图片地址和原目标其余分支仍待闭合。
