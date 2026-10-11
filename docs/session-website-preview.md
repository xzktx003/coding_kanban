# Codex 普通网站预览与品牌图标

本批继续 [完整复刻目标](designs/session-render-alignment/plan.md)。正式前端是局域网 **HTTP :8484** `http://10.30.0.24:8484`，Vite 绑定 `0.0.0.0`。普通网站读取在 Node 网关完成，不依赖旧会话运行服务升级，也不启动、恢复、停止或取得 Agent 的执行权。Slack、GitHub MCP 和 GitHub 实验开关仍有各自的验收边界。

## 原包能力与入口

只读来源为 `third_party/openai.chatgpt-26.51002.51308-linux-x64/extension/out/extension.js` 的 `aM`、`registerAppHostSessionForWebview`，以及 `extension/webview/assets/app-initial-e98b9eaef8e3.js` 的 `kti`、`Cri`、`D3`。VS Code 宿主实际注册 `websitePreviews:new aM(fetch)`；此前普通 URL 提示的参考夹具没有安装该宿主，不能据此推断原插件没有网站卡片。

`NativeWebsitePreview` 在当前宿主支持能力时为无账号密码、默认端口的 HTTPS 链接提供富提示。HTTP、特殊协议和未知／旧网关保持 URL 提示；Slack 和实验开启的 GitHub PR 先走专用分支。原 xri 关闭 PR 实验时仅移除 pullRequest 参数，仍交由 Cri 的普通网站能力处理；因此关闭／未知 PR 开关在可用宿主也可读取公开网站元数据，文件引用和 hotline 规则沿用。能力接口失败不伪造支持；同地址的配对 Token 变化也立即退回未知，旧异步结果不能覆盖新宿主。

网关提供固定 GET `/api/session/api/codex/website-preview/capabilities` 和 POST `/api/session/api/codex/website-preview`。POST 仅接受 `{url:string}`，不能传入请求头、DNS、任意 fetch 参数或自定义协议。浏览器只收到原生形状的 ready／unavailable、标题、描述和受限图片；HTML 不进入浏览器。能力查询有界合并，不轮询正文，也不建立 SSE。

## 读取与资源边界

`apps/server/src/services/codex-website-preview.ts` 保留原 `aM` 的主要预算：

| 范围 | 规则 |
| --- | --- |
| 地址 | URL 不超过 8192 字符；HTTPS、默认端口、无凭证；去 hash；拒绝私有／回环／特殊 IP 与 localhost/local/internal/test 域名 |
| DNS 与跳转 | 每次页面、跳转和图片读取均核对全部 DNS 地址；最多 4 次响应／3 次跳转；实际 TLS 连接固定使用已检查地址，保持 SNI 与证书验证 |
| 网络 | 只读 GET，不携带来访 Cookie、Authorization 或 Referrer；不执行 shell；总超时 8 秒，从活跃工作开始计时 |
| 并发 | 4 个活跃任务、最多 8 个排队任务，相同 hash-free URL 合并 |
| HTML | 仅 text/html 或 application/xhtml+xml；最多 1 MiB，读到 head 结束取消余下流；按声明 charset 解码，非执行的 HTML parser 抽取 meta/title |
| 字段 | 第一条非空元数据；og/title、twitter/title、title 优先；标题 300 字符、描述 1000 字符，压平空白，React 按文本显示 |
| 图片 | og secure/image/url、twitter image/src 顺序；相对最终网页 URL 解析；JPEG/PNG/WebP/GIF，不接受 SVG；最多 2 MiB，尺寸 1..8192，面积最多 1600 万，MIME 与实际类型一致 |
| 失败 | 图片失败保留有效文字；没有文字和图片才 unavailable；直接图片 URL 不被假扮成 HTML 预览 |
| 网关缓存 | LRU 32 条／24 MiB（JSON 字符长度 ×2）；含图片 10 分钟，文字／失败 30 秒；关闭只取消自己的任务、清除自己的缓存 |
| 网页缓存 | 所有网站控制器共用 32 条／24 MiB 留存预算；大图片按字节权重淘汰并清除原控制器数据；图片 stale/gc 最多 5 分钟，文字 30 秒；打开时暂停关闭回收计时，关闭后才开始 5 分钟宽限，LRU 优先淘汰不可见卡片；卸载释放自己的订阅和计时器 |

请求取消不清除另一位消费者的共享网关工作，且不能操作 Agent。生产连接使用 `node:https` 的固定 DNS lookup，并流式解压常见响应编码，不能在检查 DNS 后再让网络库重新解析到其他地址。

## UI 与浏览器内存

卡片复用 `NativeRichLinkPreview`：700ms 提示、200ms 预取，360px 宽，46px 顶栏，原生颜色、两行截断和打开网站入口。图片宽高比小于 1.2 时，带文字为 80×80 缩略图，没有文字为 160×160 单独图；其他图片为完整宽度的 hero。缩略图圆角是原生实测的 10px。正文 Motion 高度动画为 300ms、ease `[0.19,1,0.22,1]`，减少动态时即时结束。Tab 可进入打开入口；Escape 关闭并恢复触发焦点，失焦／隐藏释放交互状态。

大正文与长期存在的 Radix 开关回调分开。堆快照曾定位到 `Context.previewImage → onOpenChange → Radix` 的旧图片保留链；现在独立 `NativeRichPreviewBody` 只在实际表面内持有图片，淘汰清空 ref 后额外提交释放旧 React props。不能仅清空 Map 就认定图片释放。

网页把已经校验过的图片字节转为卡片拥有的 Blob URL，关闭／卸载移除 src 并 revoke；解码缓冲创建在独立函数中，不进入长期清理闭包。图片数据不作为 React key。原生 HTTP 投影仍是 data URI，视觉、图片像素和失败处理不变；**浏览器内置“复制图片地址”得到临时 blob URL，原插件使用 data URI，这个内置上下文操作尚不是 1:1**。没有为了抹平差异恢复持续增长的 data URI 图片资源缓存。当前产品没有新增图片菜单。

正式入口已有的 React 开发性能记录保护保持不变。隔离 CDP 用例也安装相同保护，只清除明确的 React measure，普通应用性能记录和生产 API 不动。测试从未停止 Agent、刷新页面或在生产强制 GC。

## 品牌与语言

普通 Markdown 与富卡片按原包匹配 Google Calendar、Google Drive（Docs/Sheets/Slides）、Figma、GitHub、Linear、Gmail、Notion、OpenAI 招聘、Salesforce、Slack 共十类内置品牌。SVG 的 path、mask、gradient、viewBox、尺寸及颜色从未修改原组件的实际 DOM 核对；仅匹配 HTTP/HTTPS 和正确域名边界，类似 `github.com.evil.example` 不匹配。Box、Dropbox、SharePoint 在原包没有该内置 SVG，沿用远程 favicon 和失败时的原生地球图标；内置品牌不重复请求 favicon，也不改原始 URL 标签文本。远程图标按原 xNi 仅发送 HTTP origin，不包含路径、query、hash 或凭证；成功解码时移除地球 fallback，更换 origin 时使用对应新 src 的加载状态。

共用卡片打开／加载文字及 GitHub 状态补齐本项目现有中文、英文、日文，原包日文来源 `ja-JP-cccb9b32b90a.js`；切换语言只格式化已裁剪字段，不重读或关闭当前卡片。这不代表整个应用所有文案已完成多语言复刻。

## 验收与剩余边界

红绿灯、截图与最新结果记录在 [特殊链接进度](designs/session-render-alignment/special-links-progress.md)。网站 D3 内部图片六种形态与 GitHub PR 实验关闭的普通网站回退、20 个品牌／子域／原始 URL 标签在 390／700px × 深浅主题，与原包严格内部几何和 SVG 对照；共用提示外壳与交互由 Slack/GitHub 的实际原生 Tooltip 回归核对，网站现额外经未修改原包的 Cap’n RPC services 初始化和应用 Provider 完整渲染验证；HTTP 走真实生产 handler/service，外部网页在可复现组中由隔离 HTTPS 响应夹具代替。另有显式开启的真实公开网站浏览器读取验收。二者不能当作远程 Slack/GitHub 账号读取证据。

内存测试额外使用没有开启 Network 检查域的独立 CDP 浏览器，以 120 张各 2 MiB 的不同图片连续三轮检测 JS 堆、backing storage、renderer RSS、Blob 创建／注销数。保留原 42 MiB 堆／外部留存断言，增加暖机后后两轮 RSS 增量限制；测试专用 GC 与短时 workload 不能代替自然 GC、长期稳定性或现有 `session-idle-memory` 验收。本批不修改历史/SSE、正文休眠、完成提示音或原内存保护阈值。

普通公开网站现在可在正式网关读取。原生 GitHub Statsig 宿主传播、真实 Slack／GitHub 连接和正式旧运行层安全启用仍未完成；完整编辑器／对话框复刻目标保持进行中。上述图片地址上下文差异需单独报告，不能宣称全部 UI、操作和动画已经完全相同。


## 原生网站 RPC 弹层验收追加

`tests/e2e/session-native-website-rpc.ts` 使用原包自己的 RPC Session／RpcTarget 类作为两端，只在隔离宿主提供 `services.websitePreviews.get`。原 `vscode-capn-rpc-connect/message` 传输、`j6e` 服务初始化、原查询和 `ini/Kti/D3` 全部实际执行；服务实现转到真实 Node HTTP handler/service，公开 DNS／HTML／图片是受控网络 fixture。没有替换原包函数、直接传 data 绕过查询，或给它伪造 Agent 执行权。

参考页面保留原应用／认证／会话 Provider。初始化 RPC 在最后正文渲染前执行；过去直接调用裸 `renderNativeMarkdown` 的诊断虽能悬停，却绕过原生键盘导航 Provider，不能拿它认定产品 Escape 有差异。另一个 HTML route 重写诊断触发 Chromium 本地网络地址空间检查，最终用初始化时接管既有日志数组的消息推送，不重写参考 HTML 或关闭浏览器保护。

完整弹层比较保留尺寸、侧向、锚点间距、背景、边框、圆角、可见阴影、标题／描述／图片位置与字体；原 Tailwind 列出的三个透明零尺寸阴影只作语义归一，两侧所有非零阴影仍严格相等。文字、已解码 hero 图片及 hover→弹层、Tab→打开、Escape→关闭分别保留双侧截图。读取次数证明悬停与键盘重进不重复读取相同短字段。这一隔离集成证明网站客户端完整弹层路径，仍不代替远程 Slack/GitHub 或完整应用窗口的验收。

2026-10-11 最终相关浏览器组 **9 项通过**（网站 390／700 × 深浅主题 4 项，既有 Slack 原生对照 4 项及运行中 Agent 的 Escape 隔离 1 项），日志 `/tmp/codex-website-rpc-delivery.log`。每个网站场景仅调用两个目标各一次，重复 hover／键盘进入不重读；Agent 控制调用为空。双侧完整弹层／键盘 PNG、几何与 RPC 次数 JSON 在 `.dev-runtime/codex-website-rpc-delivery/`，截图索引 `.dev-runtime/codex-website-rpc-evidence.md`。测试使用局域网 HTTP `http://10.30.0.24:8484`，参考包仅由隔离 HTTP :43831 提供；不重启正式运行服务。

## 空间不足时的原生定位与迟到正文（2026-10-11）

原包 `app-initial-3192ac99b6cd.js` 的 `J1t` 使用 offset、flip、shift、size；rich 分支明确设置 `fallbackAxisSideDirection: end`，上下空间不足时会先尝试横向候选。新的红灯 `/tmp/codex-website-collision-red.log` 记录原包右侧 306.75px 完整卡片，而产品只在下方保留 201.875px、让正文滚动。共用 rich 控件现使用锁定的 `@floating-ui/dom@1.8.0` 执行同类候选计算，保留 Radix 的键盘／关闭层，适配其额外定位 wrapper 与原卡片的 1px 外边距，最终可见坐标独立按设备像素舍入。短暂解除本卡片 max-height 只用于同步测量真实动画高度，绘制前恢复；没有扩大媒体缓存或恢复完整工具正文。

定位观察仅在卡片打开且模式可见时存在，监听布局／滚动和本卡片正文／图片变化；关闭后注销 autoUpdate、MutationObserver 并使在途位置结果失效。原包正文的 300ms、`[0.19, 1, 0.22, 1]` easing 与 reduced-motion 的零时长保持。迟到 RPC 的逐帧数据同时记录正文挂载时间、样式写入和绘制帧；按实际挂载时间比较，避免将繁忙主机的首个非零帧误当成动画起点，不据此宣称逐帧像素完全相等。

另一轮红灯定位到全局 reduced-motion 的 `transition-duration: 0.01ms` 使没有显式过渡的 Radix wrapper 也从离屏测量位置插值。inline transform 已更新时 computed transform 仍是旧值，结束没有属性事件，旧坐标修正因此保留。现在仅对这类 rich 定位 wrapper／外壳明确关闭 transition 和 wrapper animation；正文 Motion 动画仍按原包运行。两种宽度的深色完整 x／y／height／side 与内容可见高度已严格转绿，原失败与诊断产物保留。

`session-codex-website-dynamic.spec.ts` 通过原 RPC 与生产 HTTP handler 验证迟到 hero、短窗口横向回退／窄屏滚动，以及尺寸可解析但实际 PNG 解码失败后保留标题／描述。短窗口采用相同的 140×20 参考锚点并匹配实际矩形，卡片截图不代表独有导航和输入区的整体布局。原整页 360px 高度探针捕获链接被移动到鼠标之外、导航后方的现象，网站读取尚未开始；失败截图和 pointerover/out 在 `.dev-runtime/codex-website-dynamic-probe/` 保留。**该整页锚点移动未修复，仍是独立待查项**。

冻结实现后的 `pnpm check` 通过 `/tmp/codex-rich-placement-frozen-check.log`，现有大 bundle 提示保留；相关 6 文件 31 项单测通过 `/tmp/codex-rich-placement-frozen-unit.log`。图片释放两项通过 `/tmp/codex-rich-placement-memory.log`，原 JS／backing／暖机后 RSS 阈值未放宽。独立无 Network 检查域的 120 张强制解码工作负载：JS 17,972,708 → 19,724,660 → 19,973,728 → 20,143,908，backing 8,738,387 → 20,406,362 → 20,406,362 → 20,406,362，renderer RSS 158,142,464 → 177,790,976 → 180,916,224 → 183,062,528 bytes；120 次创建／120 次注销。常规受控浏览器 40 张的 JS 增量 527,788、backing 增量 13,981,934 bytes，但 renderer RSS 288,751,616 → 510,140,416 bytes（增量 221,388,800），其 RSS 没有通过门槛；不能将这项的 JS／backing 通过解释为该浏览器上下文 RSS 已稳定。上下文差异的原因尚未在本轮隔离证明，测试专用 GC 与短时 workload 均不代表自然 GC／长期稳定性。数据在 `.dev-runtime/codex-rich-placement-memory/`。

最终控件组首次 24 项中 23 项通过 `/tmp/codex-rich-placement-delivery.log`；深色动画最近帧比较捕获 0.13465 的比例差（阈值仍为 0.12）。原始记录证明所选两帧约为挂载后 67ms 与 58ms，插值到同一 60ms 后差为 0.06840；120／180／240ms 差依次为 0.01187／0.00629／0.00052。最终采样改为相邻实测帧插值到同一时间点，保留原 0.12 阈值、零高度／中间帧／结束时间与最终高度断言，以及原始写入／绘制记录；没有调整产品的动画时间或 easing。插值属于采样估计，不声明期间每个未采样像素已被验证。

后续插值单组又捕获浅色 0.14426 超限，证明插值本身不能保证帧一致。定位器随后只在卡片真的受 max-height 约束时临时解除约束；正文 Mutation 读取合并到单个 rAF，避免每次 Motion 写入都重复同步读布局，关闭时取消该帧。原阈值与失败产物均保留。最终网站动态组 8 项通过 `/tmp/codex-rich-placement-batched.log`（`.dev-runtime/codex-rich-placement-batched/`），但产品实际 rAF 最大间隔仍为深色约 79.9ms、浅色约 83.1ms，参考页面约 22.9ms／16.8ms。**该负载的帧平滑度差异仍未闭合**；现有形状估计与最终高度通过不能替代它。完整原窗口的负载不同，该差异原因需进一步隔离。

批处理优化后再次冻结：`pnpm check` 通过 `/tmp/codex-rich-placement-final-check.log`，31 项相关单测通过 `/tmp/codex-rich-placement-final-unit.log`，图片释放两项通过 `/tmp/codex-rich-placement-final-memory.log`。最终独立 CDP 的 120 张：JS 17,980,600 → 19,874,460 → 19,966,756 → 20,140,572，backing 8,739,919 → 23,320,546 → 26,014,676 → 31,607,128，RSS 157,851,648 → 179,798,016 → 186,478,592 → 194,678,784 bytes；120／120 注销。常规 40 张 JS 增量 -854,032、backing 增量 13,980,123，而 RSS 290,369,536 → 508,002,304 bytes，仍不认定其 RSS 稳定；与前一轮一样保留测量边界，未放宽原断言。

双侧裁剪 PNG 的 RGB 残差另外保存在 `.dev-runtime/codex-rich-placement-batched/pixel-residuals.json`：十对同尺寸卡片仍有 1,150–4,019 个不同像素、最大通道差 174。两侧标题均能采到相同 `rgb(59,59,59)` 前景色，不能凭此把文字边缘残差全部归因于抗锯齿，**完整像素一致仍未闭合**。当前通过的坐标／样式字段与交互不代替这一像素门禁。

共用控件最后复验 `/tmp/codex-rich-placement-final-controls.log` 为 15 项通过／1 个旧 Slack 动画采样失败（15.859375px，门槛仍为 12px）。该夹具一侧同步重渲染、另一侧 Promise 回执，旧 release 起点混合了不同更新路径；现记录正文挂载时间与相邻帧插值，仍保留原 340ms 结束、最终高度、真实中间帧、12px 门槛及 Agent 隔离断言。复验一项通过 `/tmp/codex-rich-placement-slack-phase.log`，两侧 release→正文挂载分别约 7.4ms／5.7ms，原始帧保留。不把这项夹具测量修复解释为真实 MCP 读取或所有帧平滑度闭合。

当前冻结代码的浏览器覆盖为网站动态 8 项、其余网站完整 RPC／Slack／GitHub 15 项及 Slack 动画复验 1 项，分组日志如上；不是“单一整组 24 项一次全部通过”。双侧截图入口 `.dev-runtime/codex-rich-placement-evidence.md`，完整控件附件 `.dev-runtime/codex-rich-placement-final-controls/`。整体目标继续进行；真实 extension／远程账号、Statsig、图片地址、超低高度整页锚点、帧平滑度、RGB 残差及常规上下文 RSS 仍是明确未闭合项。

## 分隔线与可比合成场景的像素追加（2026-10-11）

本轮先保留未匹配场景的严格像素红灯：不透明正文区域深／浅主题分别有 2,797／2,761 个不同像素，最大通道差 80／81，文件 `.dev-runtime/codex-rich-rgb-red/`。Chrome 实际字体查询确认两侧同为 DejaVuSans-Bold、18 个 glyph；font-synthesis、字号、字重、颜色、文字矩形也相同。切换额外 transform、font smoothing、wrapper absolute 均未减少文字残差，试改已撤回，不把猜测作为产品改动依据。

有一项真实样式 bug：原 `border-subtle` 在 extension 主题使用 `color-mix(in oklab, foreground 5%, transparent)`，正文顶线／hero 底线误复用了 8% 的环边框透明度。现两条分隔线对齐原 token；浅色图片底线整行残差消失，仍剩 2,417 个文字像素，样式／字体／祖先数据在 `.dev-runtime/codex-rich-rgb-ancestor/`。

LayerTree 进一步确认原精简参考页的卡片在主绘制层，产品卡片因与其他已合成滚动／编辑器层重叠而单独合成（Overlap）。仅令两侧输入失焦不能消除差异；这说明原两张图的背景合成场景不相同，不能直接把不同文字栅格认定为组件字号或字体错误。像素用例现在在参考卡片背后建立同色、不可交互的独立合成背景，让原卡片也以 Overlap 合成；原 UI 组件、CSS、字体、RPC 与 query 均不替换，不修改 third_party。LayerTree 保存真实合成原因，并保留未匹配场景的原失败证据。

匹配该合成场景后两主题正文均为 **零不同 RGBA 像素**，日志 `/tmp/codex-rich-rgb-scene.log`；最终测试另纳入不透明工具栏，零像素门槛不放宽。该受控场景验证原组件的内部文字／图片，仍不等于实际完整 VS Code 窗口的所有合成状态或整页像素一致；圆角外的独有背景和此前帧平滑度／低高度整页问题继续单独记录。

最终不透明工具栏／正文同时纳入零 RGBA 检查，深浅主题均 changedPixels=0、maximumChannelDifference=0。网站动态／解码／定位与完整原 RPC 键盘组 **14 项一次通过**，日志 `/tmp/codex-rich-rgb-delivery.log`；相关 4 文件／22 项单测通过 `/tmp/codex-rich-rgb-unit.log`。截图入口 `.dev-runtime/codex-rich-rgb-evidence.md`，每场景保存真实字体、祖先样式、LayerTree 合成原因和原始 PNG。CDP 诊断仅在 Chromium 收集，比较逻辑不依赖 CDP；本轮实际验证范围仍为 Chromium，没有据此宣称 WebKit 或完整 VS Code 窗口已验证。原不匹配场景的失败与此前动画／低视口／RSS 边界仍保留。

前端生产构建／类型检查通过 `/tmp/codex-rich-rgb-web-build.log`，跨浏览器 CDP 诊断 guard 后两项像素复验通过 `/tmp/codex-rich-rgb-final-guard.log`。只有 Chromium 的诊断被收集，本轮仍未验证其他引擎；生产定位／字体无新增改动，只有两条分隔线修正。

2026-10-11 整页低高度诊断更正：真实滚轮解除阅读跟随后，390／700×360 的链接与预览保持稳定，Escape 和未发送草稿通过回归；旧自动 scrollIntoView 触发 pinned 回底，是测试输入差异。生产滚动语义未修改，原包 RPC 卡片几何和低高度全窗口布局仍是独立验收边界。证据及剩余项见 [进度记录](designs/session-render-alignment/special-links-progress.md)。
