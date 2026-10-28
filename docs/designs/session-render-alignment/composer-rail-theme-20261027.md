# Rail 的同主题真实组件对照（2026-10-27）

本轮接续 [attached rail 几何验收](composer-attached-rail-20261027.md)，把固定高度占位行换为实际运行变更、实际队列和实际 Goal 组件。上轮白底本地夹具与深色官方夹具只证明几何，不作为本轮主题、字体或整块 composer 像素一致的证据。

## 取证方式

基准仍为未经修改的 `26.51007.21434` VSIX。官方只读 reference 服务导入原包组件：

| 组件 | 原始资产及调用 |
| --- | --- |
| Rail | `app-initial-fee819fe4f22.js`，`vf()` 初始化、`_f` 为 G6 |
| 运行变更 | `sites-end-resource-733bd1c6da06.js`，`M()` 初始化、`j` 为 KE，传入真实 unified diff 和 `isInProgress: true`，执行原始 qE 分支 |
| 队列 | `queued-message-list-172645190dd2.js` 的 `QueuedMessageList`，两条真实文本、context、queued submission 和只读动作记录回调 |
| Goal | 原夹具 `Native.Cu`，active / 1200 of 5000 tokens 的原组件 |

SHA-256：

- `sites-end-resource-733bd1c6da06.js`：`5b45f53d1d05d8a47058cbb7b0f0d4e131805d6036c4a878e5ce951401018a14`
- `queued-message-list-172645190dd2.js`：`b624ccec075695445cd1d86d6fc534388591948187f1800428fecb9aa3a10fbb`
- `app-initial-41ab338a184f.js`：`c755dbca916c0f830a554fe2e3057f8642b32394bea7701338e5d506f692ad56`
- `app-initial-aad627bd9dff.css`：`1ca9c6374ba5102c63a45ba2a7a6a9656d1e016c59364133a6e21e5e21ead3e4`

本地对照挂载的是实际完整 `Composer`，使用实际 stores、所有 composer 样式、默认 accent 主题和实际 i18n / TooltipProvider。没有用空白输入区或固定高度假行替换产品组件。fixture 的全部 API / WebSocket 被截断到本地响应；官方 VS Code bridge 仅记录消息，不连接 Agent 或 IPC。独立工作台路由用例另行验证产品挂载。

双方注入相同 VS Code 宿主 tokens、Arial 字体、13 px 行文字、16 px 根字号、相同 light/dark 背景及 DPR=1；桌面视口为 1440×1100，分别核对 640 / 360 px composer 宿主。记录包含原始 DOM、各按钮字体/颜色/宽高/内边距、背景、行高、图标和截图。

## 发现及修复

1. **运行变更操作与布局。** 原本地行高 37 px，仅一个整行按钮；原包行高 33 px，主区域 28 px、独立“查看变更”按钮 24 px。本轮接入两个可聚焦操作，均打开同一 thread/turn 的保存 diff；复用原包标题、统计、动作布局及统计数字基线。
2. **队列桌面展示。** 原本地默认只显示第一条、文字居中、32 px 操作和独立卡片；官方显示全部队列，左对齐、24 px 操作、两行加间距和边框的 item 为 70 px。本轮桌面显示所有条目，在 30dvh 内滚动，保留编辑/删除/重排/引导/发送配置与上下文功能；不通过隐藏动作制造外观一致。新增原包 queue/steer/delete/more 图标，SVG 路径分别核对到 queue 原资产及 `app-initial-41ab338a184f.js`。
3. **共享底色、边框与滚动渐隐。** Rail item 改为宿主 secondary 底色及官方边框混色。真实截图揭示队列文字边缘还有差异，原包队列使用 `vertical-scroll-fade-mask`；本轮补上对应的滚动边缘 mask，注册的属性和动画名限定为本项目专属名称。
4. **Goal 与其他行共存。** 原本地 Goal 在 rail 外占满 640 px，官方在 614 px rail 内。本轮把实际 `ThreadGoalCard` 移至同一 rail 末尾，去掉旧独立卡片边框与输入框方形顶部规则；Goal 行为、请求和文字不改。共存时队列 item 为 66 px、末尾 Goal item 为 37 px，和原组件相同。
5. **手机保留。** 仍采用获批的紧凑悬浮 shelf 和固定输入高度。手机仅在 shelf 展示第一条队列，通过“还有 1 条待发送”进入详情访问全部条目；Goal 保持在可滚动 rail 内，避免断点变化切换 React 父节点导致编辑状态重挂。浏览器实际打开 Goal 编辑和队列详情后关闭，未发送草稿保持，写请求为零。
6. **Goal Portal 退出。** 主线程 review 发现，Goal 进入 rail 后也需处理 Portal 不继承祖先 `inert` 的边界。真实 `ThreadGoalCard` 回归先复现“外部清 Goal 后编辑器仍在”与“慢 objective read 未取消”两个失败；修复后退出 commit 立即隐藏编辑器，取消自有只读加载并阻止迟到结果重开。已提交的保存不取消、不重发，原保存中关闭约束保持；standalone Goal 的 presence 默认仍为 true。

## 红绿灯与产物

所有输出固定保存在 `.dev-runtime/session-rail-theme-20261027/`，不使用共享 `test-results`：

- `red-isolated-ready.log` 与 `red/light-base.json`：有效红灯。运行变更存在时，1 个按钮不等于官方 2 个按钮；同时记录原本地 37 px diff / 单条 queue 与官方差异。
- `goal-red.log`：加强逐按钮断言后，Goal 主按钮颜色及操作字体/行高不等于原包；修复作用域内样式后转绿。
- `goal-portal-red.log`：Goal Portal 两项真实组件失败及 11 项既有通过；本轮修复后均通过，另覆盖退出后已提交 save 不取消或重发。
- `green.log`、`green/{light,dark}-{base,coexist}.json`：**4/4 通过**，每例覆盖两个桌面宽度；比较共同组件的真实按钮与行，而不是只比较容器。统计数字纵向基线严格相同，横向字形进位存在最多 1/32 CSS px 的原始差异，单独采用 1/16 CSS px 上限并保留全部原始浮点；其他已列按钮尺寸/字体/颜色断言不放宽。
- `green/{light,dark}-{base,coexist}-{640,360}-{local,native}.png`：完整本地 composer 与官方 rail 截图。
- `green/*-{diff,queue}-{local,native}.png`：真实行的独立截图；`pixel-comparison.json` 保留逐像素差异统计，不用相近几何冒充像素完全相同。
- `green/{light,dark}-coexist-mobile.png`：390×844 手机尺寸下实际 Goal/详情入口和草稿保持检查之后的截图。
- `unit.log`：6 文件 **42/42**，包括两个 diff 入口、所有桌面队列条目、手机详情访问第二条消息，以及退出 inert / 队列与 Goal Portal 清理、迟到 objective read 和已提交 save 的边界。
- `integration.log`：既有实际工作台路由和原包基础几何用例 **2/2**。
- `types.log`：前端 `tsc -p tsconfig.json --noEmit` 通过。

早期 `fixture-initial.log` / `red-fixture-stable.log` 中完整工作台的历史恢复曾清除直接注入的运行 diff，不能把队列误认作 diff；这些不算产品红灯。隔离完整 Composer 的夹具排除了该干扰。`red-isolated.log` 是 Vite React refresh preamble 缺失的夹具失败，也不计验收。

复现时先运行 `node scripts/codex-goal-reference-server.mjs --host 0.0.0.0 --port 0`。本轮只读输出为 `http://10.30.0.24:33515/native-goal.html`（HTTP :33515），正式产品使用 `https://10.30.0.24:8484`（HTTPS :8484），两者均为 LAN 地址；自有 reference 在验收完成后已关闭，后续复现应重新启动并使用实际输出端口。

```sh
PLAYWRIGHT_SKIP_WEBSERVER=1 \
PLAYWRIGHT_BASE_URL=https://10.30.0.24:8484 \
PLAYWRIGHT_FRONTEND_PROTOCOL=https \
CODEX_GOAL_REFERENCE_URL=http://10.30.0.24:33515/native-goal.html \
RAIL_EVIDENCE_PHASE=green \
pnpm exec playwright test tests/e2e/session-rail-theme.spec.ts \
  --output=.dev-runtime/session-rail-theme-20261027/green-results \
  --reporter=line > .dev-runtime/session-rail-theme-20261027/green.log 2>&1
```

## 明确未闭合的边界

- **coexist 不是完整同状态截图。** 本地模型切换 notice 保留，官方截图没有对应 notice。本轮核对的是“共同 diff/queue/Goal 组件在本地 notice 共存时”的布局与动作；未证明官方对应 notice 的启用位置，不将其隐藏，也不声称整个组合像素一致。
- 原包侧运行的是实际 rail / diff / queue / Goal，未运行带真实账号与主输入状态机的整个官方 composer。完整本地输入框的阴影、底部控件等不能由该原包 rail 截图宣称闭合。
- 保留本项目队列发送配置与上下文入口；没有把它改成官方的 Markdown 全文预览。富文本/附件 preview、悬停拖动握柄、全部队列菜单和异常状态的逐像素对照不在本轮证明范围。
- PNG 并非完全相同：仍保留原始像素统计，包括输入框阴影影响、亚像素位置与真实正文绘制差异。本轮通过的是被明确列出的共同组件尺寸、字体、颜色、布局与功能断言。
- 手机为 Chromium 390×844 尺寸模拟，未做 iPhone 实机验收；没有重启正式服务、发送真实任务或接管任何 Agent。

## 后续复核：SVG 后代身份

主线程审计指出新 `ComposerRailIcon` 每次 render 创建新的 `dangerouslySetInnerHTML` 对象。独立 Chromium probe 直接导入当前产品组件，并以既有 `NativeComposerIcon` 为控制，使用 MutationObserver 和节点引用实测：同 name / 同 props 重渲染、只改 class、再次父级重渲染，旧实现每次都替换 3 个 path（1 条 childList，removed 3 / added 3）；控制组件只有需要的 class attribute 变化，path 保持。

按主线程允许的最小范围，新增 `ComposerRailIcon.native.test.tsx`，旧实现 **4 项红灯、1 项控制通过**；随后只在 `ComposerRailIcon.tsx` 为 4 个静态 SVG body 缓存 `{ __html }`，改为传递稳定引用。单测 **5/5 通过**；相同真实浏览器 probe 的三种同名更新均为 **0 childList、全部 path 引用保持**，更换 name 仍发生一次预期 childList 更新。父按钮焦点在修复前后都正常保持，本项证据不支持“此前按钮失焦”的额外结论。

缓存仅包含 4 个静态图标，不保存用户内容。产物固定在 `.dev-runtime/session-rail-icon-audit-20261027/`：`unit-red.log`、`unit-green.log`、`probe.mts`、`probe-red.log`、`probe-green.log`、`result-red.json`、`result-green.json`；JSON 同时记录实际源码 SHA-256 和逐次节点/MutationObserver 结果。该轮未扩大其他产品实现或重启服务。

## 短队列滚动遮罩复核

后续阅读原始 `QueuedMessageList` DOM 后，确认官方 `vertical-scroll-fade-mask` 是外层 `div`：它统一承担 `max-height:30dvh`、`overflow-y:auto`、暂停提示和消息列表；本地此前把滚动/mask 放在 `<ol>` 上。浏览器红灯实测原包 scroll owner 为 `DIV`、本地为 `OL`，且不溢出的两行本地队列仍有 scroll-driven mask。

现在 `QueueReorderList` 由外层 `div.session-queue-list` 管理滚动与暂停状态，内部 `<ol class="session-queue-items">` 保持列表语义和可拖排序。遮罩只在列表内容超过自己的 max-height 时启用；这样忽略 composer rail 进入时暂时较小的父级高度，避免短队列首帧被误判为溢出。内容尺寸通过 `ResizeObserver` 和 viewport resize 重新核对。

扩展真实原包 rail 回归后，light/dark、短队列/12 行溢出、640/360 容器共 4 项通过；短队列不启用遮罩，长队列滚动顶部/底部的渐隐值与原组件一致。`QueueReorder` / `FollowupQueue` 52 项单测通过，`pnpm check` 通过。附件/预览全 PNG 对照仍有 4 个已记录像素红灯；本次没有放宽阈值，也没有声称整块 composer 像素相同。浏览器产物在 `.dev-runtime/session-rail-theme-20261027/final-queue-pairs/`。
