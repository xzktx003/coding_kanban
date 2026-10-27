# 队列富文本与只读预览对照（2026-10-27）

本轮沿用已批准的会话模式方案，修复桌面附着队列的阅读、复制与键盘行为；手机仍保留已有的紧凑 shelf 与队列详情入口。官方 VSIX 未修改，所有参考回调与产品写接口均使用隔离夹具，没有向正式 Agent 发送、停止或接管任务。

## 原包与运行证据

基准为 `openai.chatgpt-26.51007.21434-linux-x64`：

- `queued-message-list-172645190dd2.js`，23,684 bytes，SHA-256 `b624ccec075695445cd1d86d6fc534388591948187f1800428fecb9aa3a10fbb`。`We` 使用单行 Markdown，h1–h6 经 `Ke` 变为 span；`Ge` 返回 700ms；完整提示在可选择的非模态 dialog 内以原始文本展示。`Je` 区分正文、粘贴、选区及图片摘要；前置代码围栏先生成文字摘要。
- `tooltip-4ef322d3a7a3.js` 的实际 `u` 包装器默认 `sideOffset=14`，432px 最大宽度、20px padding、原生 rounded-3xl 及一像素 margin。不能套用普通 Markdown tooltip 的外观和 4px 偏移。
- `qe` 在拖动结束前捕获源、目标原索引；`app-initial-c4ebaa710049.js` 导出的 `_k`（`hcr`）先按源索引取出，再插入原目标索引。真实原组件鼠标拖动的回调也核对到此顺序。

主线程 REA 记录 `ev_5e7b044873c133ac128b682e6c7eff3b9b958a23dfaa9824996ad658c3f8fb66` 解析了上述队列单文件副本，零解析失败；这不是完整导入图，静态关系未证明运行。实际浏览器通过只读参考服务导入未修改的真实 `QueuedMessageList`、Rail 与 Markdown/tooltip 依赖，记录 DOM、回调、键盘默认行为和颜色/几何。文件指纹、原包摘读和运行记录在 `.dev-runtime/session-queue-preview-20261027/`。

## 产品变更

- 桌面队列显示原生单行富文本与准确摘要。`CodexMarkdown` 仅新增 `headingAsText` 选项，正文默认行为不变；继续使用原有安全链接/文件引用路径。无正文时区分本项目文件、引用、粘贴和图片，不再统称“图片消息”。文件/引用属于本项目的捕获结构，不冒充原生 PR 操作模型。
- 点击、键盘焦点和 700ms hover 可打开只读原始提示；短且未溢出的文本不打开。前置代码摘要与全文不同则仍可预览。配置、上下文完整快照和编辑功能保留在既有更多菜单；预览不触发任何发送动作。
- 预览使用可聚焦的 group，避免在按钮内部嵌套 Markdown 链接。Tab 进入正文，Shift+Tab 返回触发区，再次 Tab 从正文退出至下一实际焦点目标；Escape 关闭并按原生规则返回触发区。后代链接的 Enter/Tab 不被父预览吞掉。两方向均验证真实浏览器键盘默认行为，不只使用合成 keyDown。
- 鼠标选择折叠行的文字原先被整条 `li[draggable]` 变成拖队列。拖动入口现在限定图标，文字可选择和复制，既有更多菜单上下移仍可用。另修复向下拖一行时因移除源后重算目标索引而保持原序的问题；请求仍带原 thread、revision 和精确 id 列表。
- Rail 退出、Session 隐藏、浏览器失焦/隐藏及内容变化清理预览和定时器。Portal 不依赖祖先 inert。定位复用已有 Floating UI 依赖，使用自有 `absolute` surface 与真实 Session portal 容器，不覆盖 Radix fixed wrapper 的 CSS 坐标。`autoUpdate` 只在打开时注册祖先滚动、resize、布局/视口观察，关闭时释放；迟到定位回执不能重显旧节点。没有增加网络轮询或修改队列派发协议。

## 红绿灯与几何

有效红灯包括：原本地组件没有富文本只读预览的 3 项单测；真实选文 native 有文本/dragstart 0 而本地文本空/dragstart 1；嵌套链接真实 Enter 的 native click 1、本地 0；Shift+Tab 和正向 Tab 被本地 Radix FocusScope 困住；拖动单测的向下重排发出旧顺序。分别保留于 `unit-red.log`、`selection-red.log`、`link-red.log`、`keyboard-red2.log`、`tab-exit-red.log`、`final-unit.log`。

完整主题对照使用与既有 rail 验收相同的全部 VS Code 宿主 tokens、Arial、13px 行文字、16px 根字号和 DPR 1。500px 宿主中，两主题均逐项核对：

- 整行 left 113 / top 360 / width 474 / height 37；浅色背景 `rgb(245,245,243)`，深色 `rgb(40,42,35)`。
- 触发区 left 146 / top 367 / width 306 / height 20；实际 Markdown 字形为 13px / 20px、完整宿主 foreground，strong 字重 600。原包外层 `text-secondary` 的 65% 颜色被内部 MarkdownRoot 自己的 `color:var(--color-text)` 覆盖；不能只测外层就推断字形颜色。
- Popup left 84 / top 261 / width 432 / height 93.421875；圆角 25px，文字 12px / 17.1429px，背景/文字匹配宿主，正文保持 `pre-wrap` 和可滚动。

`placement-red.log` 保留旧触发区 28px 和错误 popup 偏移的失败。最终采用原生 20px 文本锚、14px 偏移，以及带一像素 margin 的直接绝对定位 surface；坐标经真实 offsetParent 计算，不假设 Session 位于视口 0,0。非零容器、80px 祖先滚动、祖先宽度变化、视口收窄与恢复均重新核对位置和可见边界。没有放宽几何断言。

最初的“light”夹具遗漏 dropdown/menu tokens，导致官方行仍为深色；这些旧图只支持当时 popup 的局部观察，不作为整行同主题证据。另一早期夹具把绝对定位的零高度 body 当作点击目标；已改为实际坐标点击。官方 AnimatePresence 在替换消息时短暂保留旧行，最终测试先等精确新消息出现，再核对唯一目标，旧诊断失败保留。并行上下文草稿开发曾使 `import.meta.hot.data` 缺失的 Vitest fixture 在 import 阶段失败；该兼容问题由对应实现修复，不计作队列测试通过。

## 像素差异的闭合

初轮仅比较了外层文字样式和几何，固定 530×160 区域还留有浅色 2389 / 深色 1434 个非零差异像素。这个局部绿灯不足以关闭像素要求，原计数保存在 `pixel-comparison-before.json` / `pixel-regions-before.json`。进一步按区域核对发现 popup 两行正文已经逐像素相同，差异集中在队列字形及 popup 外框/阴影。

实际后代样式、平台字体和 LayerTree 定位出三个明确差异：原包 MarkdownRoot 使用不透明前景，strong 设 600，而本地错误沿用外层 65% 和默认 700；原包 popup 实际采用 `corner-shape:superellipse(1.5)`，本地仍为普通圆角。两侧平台字体均为 Liberation Sans / LiberationSans-Bold，不是字体文件不同。仅在同页修这三项，原夹具 PNG 即归零。

随后加载真实 `workbench.css` 的相对定位、不透明 Session 根进行复验，旧 Radix fixed wrapper 产生额外合成层，出现 2564 个差异像素。诊断中仅改变 wrapper 为 absolute 后归零，但这种 CSS 覆盖无法保证非零容器坐标，因此没有作为产品修复。最终改用上述 Floating UI 的自有 absolute surface；真实宿主下仍归零，并通过 offset/scroll/resize/视口及所有键盘与退出回归。

`pixel-style-diagnosis.log`、`browser/light-local-{style,workbench,position}-probe.png` 与对应 compositor/字体 JSON 保留同页单变量观察。最终永久用例加载真实 workbench 样式，使用**完整 PNG 字节相同**强断言，不裁剪有差异区域、不提高容差、不依靠强制抗锯齿开关。

## 最终验证与范围

- `absolute-complete-unit.log`：13 文件 **65/65**，包括位置观察只在打开时建立、Rail 移除释放、迟到定位结果不能重显。
- `absolute-complete-types.log`：前端 `tsc -p tsconfig.json --noEmit` 通过。
- `absolute-complete-browser.log`：**12/12**，本次6项、既有真实 rail 主题4项及工作台/原组件集成2项，包含手机布局保留。
- `absolute-source-before.json` / `absolute-source-after.json`：本次10份实现与测试输入前后不变，不扩展为整个仓库冻结。
- `absolute-final-visual/`：最终原始 PNG、几何、DOM、平台字体和 LayerTree；`pixel-comparison.json` 中两主题的 **1280×720 全图各921600像素，差异均为0，PNG bytes equal=true**。这是当前丰富文本队列行及其打开预览的同状态证据，不扩展成所有附件/异常状态逐像素一致。
- `absolute-final-visual/full-workbench.json`：实际完整 Session 工作台（隔离 API fixture）中，真实相对定位 Session 根、原生通知 viewport 与 absolute 预览共存，预览位于 Session Portal，无横向溢出；Tab/Escape 和无任务写入核对通过。

主要回归入口为 `tests/e2e/session-queue-preview.spec.ts`、`session-rail-theme.spec.ts`、`session-composer-attached-rail.spec.ts`。只读参考服务通过 `node scripts/codex-goal-reference-server.mjs --host 0.0.0.0 --port 0` 启动，最终实际地址为 HTTP `http://10.30.0.24:41205/native-goal.html`，产品为 HTTPS `https://10.30.0.24:8484`。验收后自有参考服务已关闭，正式前端与运行层保留。

这不是整个官方 composer、全部附件/队列异常状态或完整拖动系统的完成声明。当时图片缩略图、原包全部摘要类型和拖动系统尚待单独对照；图片与摘要的追加结果见下节，拖动见 [队列排序对照](queue-sorting-20261027.md)。本项目配置/上下文详情和手机布局按已批准例外保留。当前两张同状态全图的零差异不能替代这些未覆盖状态。

## 追加：图片与捕获附件摘要

当前隔离 `QueuedMessageList` + 原生 Rail fixture 中，原包 `We` 在文字前显示第一张图片：24×24 border-box、4px 普通圆角、1px 前景12%边框、`object-fit:cover`，不可拖动且不是操作按钮。图片和文字间距6px；有图时正文包装器上下各4px。`Ye` 只取 `imageAttachments[0].previewSrc ?? src`，并非展示全部图片。本项目只有已上传路径，使用已有 filesystem asset 读取第一张；不伪造原包 MCP/appshot 数据类型。桌面折叠状态不挂载隐藏的整组图片，打开详情后仍能查看所有原图，移动端保留既有紧凑入口。

原生 `Je` 与真实组件复验确认：图片摘要为“3 张图像”，多个粘贴附件为“首条预览 (+其余 1 个粘贴文本附件)”，选中文本为“2 个已选文本片段”。原生粘贴 producer `Y5t` 先 trim/合并空白，再按80个 UTF-16 单位限长，超长取前79个加省略号；只限制预览，不修改 captured context。原包 `Zyr` 的 selectedTextAttachments 支持文件范围，responseTextAnnotations 则表示另一类注释。本项目 quote 与 file+range 对应捕获选区；整文件快照继续保留本项目“文件名”摘要，不伪装成原生注释或原生空正文文件摘要。

独立证据位于 `.dev-runtime/session-queue-attachments-20261027/`：`source-manifest.json` 为未修改原包指纹，`paste-preview-producer.txt` 为限长函数及常量摘读，`native-probe.json` 保存9种真实原组件 DOM/摘要/图片几何（无错误、无操作回调）。参考服务为主线程所有的 HTTP `http://10.30.0.24:45439/native-goal.html`，产品验证使用 HTTPS `https://10.30.0.24:8484`；没有修改原包或访问正式任务。

红绿灯：`unit-red.log` 包含4条摘要失败，`thumbnail-unit-red.log` 为缺失缩略图失败；实现后 `unit-combined.log` 的3文件8项通过，`types.log` 前端类型检查通过。新增 `tests/e2e/session-queue-attachments.spec.ts` 对照两主题的单图、多图、文字+图片、多个粘贴、多个选区、粘贴+图片，并验证折叠仅请求首图、展开保留全部原图/完整捕获正文及无写接口调用。最终浏览器状态见后续结果，初次边缘像素红灯保留在 `browser-r1/` 和 `browser-r1.log`，不能据几何一致宣称附件全图通过。


### 追加验证结果与未闭合项

- 产品实现及对应5文件 **18/18 单测通过**（`unit-final.log`），前端类型检查通过（`types.log`）。桌面详情的真实浏览器回归通过：折叠只请求首图，展开全部原图及每个完整捕获文本，无队列/turn写接口。
- `browser-real-theme.log` 的两个全矩阵视觉测试仍为红灯，**不能宣称附件像素验收通过**。它们采用真实 `ThemeContext` 对应的 `.session-mode.light/dark.accent-default` 和 `color-scheme`，相同props/theme/几何/scrollTop，并保留 `img.decode()` + 正常双rAF。旧夹具漏加light、MAIN退回oklch白的结果独立存于 `missing-light-lifecycle-evidence/`；修正后仍有未闭合点。
- `real-theme-evidence/` 保存最终主题下两组各7种状态的完整PNG、computed、LayerTree、逐像素观测集合。每个状态固定取原生主参考及4个原生控制：正常挂载、替换旧提示、两条减为一条、同ID补图片；等待退出旧行清空及布局稳定。浅色顶角可出现18点、深色24点原生自身方差；每个点只能接受该同态原生样本实际出现的RGBA，**没有整图容差**。确定性状态继续要求完整PNG字节相同。个别首次状态的5个样本仍未覆盖所有原生角点值，保留失败而非追加随机重试选择绿图。
- 尚未闭合的是浅色新挂载图片圆角：SVG三个点 `(147,368)`、`(168,368)`、`(168,389)`，PNG两个点，产品每个RGB通道比当前原生样本低1。实际几何、border、radius、corner-shape、object-fit一致；所有相关full computed与原图可复查。单次decode等待或改变宿主样式重绘能暂时消差，但完整固定控制中再次出现，故没有将它们当产品修复。去mask会破坏滚动渐隐，也未采用。首次渲染前去额外body clip并未消差，因此没有修改共享Rail CSS。
- 首次浏览器fixture错误（原生退出动画保留旧图、空正文且无附件的seed没有preview group）已据实际DOM修正，原始失败日志保留；不能计为产品回归通过。永久 `session-queue-attachments.spec.ts` 保留视觉失败断言供后续闭合。

当前4px普通圆角是上述隔离组件宿主的实际测量，**不是完整官方composer所有祖先配置的证明**。官方 `.composer-attachment-surface` 可继承 `--composer-corner-shape` 与 `--composer-attachment-border-radius`，完整composer调用链/宿主祖先仍需独立核对。PR动作、MCP/appshot、评论注释等原包类型不在本项目捕获schema内；本次没有伪造这些类型的“全摘要覆盖”。


## 2026-10-27：完整布局祖先假设复验

原包静态链与真实Jea/qf/TA布局挂载均表明：Queue Rail与ewa/k3i/TA.Attachments为兄弟子树。thread/home/embedded的队列首图均24×24、4px普通圆角，最近`data-composer-spacing`祖先为空；同场draft附件为10px（embedded为4px）。只有刻意错误嵌套到Attachments才变10px。因此“本地缺失输入附件半径祖先导致图角差”的猜测被排除，不能据此改产品CSS。`.dev-runtime/session-queue-ancestor-20261027/`保留实际运行、原包SHA/AST和5张原图；REA静态结果的partial限制及参考服务身份清理见该目录README。既有SVG/PNG边缘像素红灯仍未关闭。

后续[图片绘制与输入条件核对](queue-image-paint-20261027.md)已排除输入附件祖先半径假设，并修正data URL与Session网络URL不等价的测试输入；相同来源和独立冷context下仍有浅色2–3点反例，不能将特定12对网络截图相同扩成全部视觉验收通过。
