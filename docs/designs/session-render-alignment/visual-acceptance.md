# 独立整页视觉验收

2026-10-10，Markdown 对照已完成，整页后续修正由对应 owner 验收。产品联调为 HTTPS `https://10.30.0.24:8484/?mode=session`；原包只读组件为 HTTP `http://10.30.0.24:43831/native-markdown.html`。本记录不代表完整 P0–P4 或逐像素闭合。没有重启正式 Rust、Agent 或 VS Code 服务，没有提交或推送。

## 当前整页检查

`session-codex-visual-acceptance.spec.ts` 使用完整 LAN 页面和独立 API / WebSocket fixture，不向正式 Agent 发送消息、审批或回滚。覆盖 1440×1000、768×900、480×900、390×844、844×390 横屏和 390×420 缩小视口，两种主题。缩小视口不是实体手机软键盘证明。

`e2e-visual-independent-first.log`：12/12 通过，但截图早于代码高亮完成，不能作为最终代码排版截图。增加真实代码渲染等待后的 `e2e-visual-independent-resolved.log`：12/12 通过。所有主要输入按钮实际 `elementFromPoint` 命中，没有整页横向溢出；模型 / 权限菜单在视口内，独立输入区没有进入正文。完整图包含 Markdown、代码、表格和保存的文件变更，已实际查看。

最终本轮整页 `e2e-visual-native-full-final.log`：**12/12**，等待实际 `hljs-keyword` 渲染后截图，不使用加载中占位。`e2e-visual-native-full-final/**/workbench-*.png` 的 12 张图全部通过图片工具实际查看；对应模型和权限浮层也存档。没有整体横向溢出，输入区按钮物理命中，菜单上下边界在可见视口内。390×420 仍仅代表缩小视口。

进一步修正壳层两处审美问题后，root 的 `e2e-layout-gutter-green.log` 再次 **12/12**。独立审查其中 768px 浅深和 844px 横屏浅深四张 PNG：上下文自然省略在输入区上方左侧，toolbar 不再拥挤或重叠；16px sidebar handle 留在首字 x17 之前，表格内容完整。root 补充的实际 overlap / first-glyph 断言先分别 4 / 2 个失败，再转为这组 12 绿。

最后字体 flags 与媒体修正后，`e2e-visual-native-font-final.log` **12/12**，12 张 `workbench-*.png` 全部再次实际查看。仍满足内容 / toolbar不重叠、物理 hit target、菜单可见边界、无横向溢出，code/table/footer在两主题和各宽度协调。该组截图工具汇总标题是“编辑了文件读取文件运行了命令”（desktop y324 / 768px y232）。随后用未修改原包真实组件核实：原包同样这样显示；数量只用于 plural 选择、不显示数字，中文 unit 列表不添加分隔符。该文案不是产品缺陷，不应为主观美观擅自改成另一套语法。

独立只读补查 root 的 `e2e-final-completed-summary-v2`（10/10）：实际查看 1440 / 390 两主题的汇总与目标导航 PNG，未发现标题和按钮重叠、浮层越界或主题错配。该历史截图发现来源信息丢失（后续已按原包30分类/24 Intl组合修复，最后全量及稳定截图见implementation）：相同 `fixture.lookup` 调用，原包汇总为“已使用 Fixture 集成编辑了多个文件读取文件运行了命令”，当前产品图为“调用了工具编辑了多个文件读取文件运行了命令”。数量及分隔规则本身符合原包，差异来自 MCP source 聚合。只读原包实测证据为 `review/native-completed-summary-final-audit.json`（11 个实际原组件用例，含重复 server、多个 server、connector 去重、失败和 Codex 专用标签），可复用脚本 `review/native-completed-summary-audit.cjs`；没有修改运行源码或原包资源。

## 发现与定位

| 问题 | 明确证据 | 当前处置 |
| --- | --- | --- |
| 围栏使用 Monokai / Solarized 外壳 | `e2e-visual-metrics/**/workbench-metrics.json` 暗色 pre 为 `#272822 / #F8F8F2`；`e2e-visual-light-diagnostic/**/theme-diagnostics.json` 浅色 pre 为 `#FDF6E3` | 首先修复 Shiki 多主题 bg/fg 的 invalid CSS 字符串与全局 Prism `!important`；这是中间步骤。随后核实原生主围栏实际使用 hljs，最终替换为原生 CodeSurface / hljs，透明 body、host surface，颜色不再采用 Shiki editor background |
| 轻色 Diff 行号右移 1px | corrected primary-host full removed ROI `(40,88,60,103)`、added ROI `(40,108,60,123)`；原图 `(x,y)` 对产品 `(x+1,y)` RGB L1 均为 0 | 独立定位并交给 review owner；owner 已报告 6/6 原包复验和原位 glyph ROI 0 差异，外层几何不变 |
| 原生围栏结构与当前 Streamdown 不同 | `visual-native-markdown-dark.png`、`visual-native-markdown-metrics.log`：无行号，语言图标 / 标题，wrap 与 copy；代码 12px / 20px，三行外框 122px。产品当时有行号、50px 蓝色 header 和 16px 上下 padding | 已实现 NativeCodeFence；48px header / 20px radius / 12px 底 padding，复制和真实下载保留。hljs 11.11.1 精确锁定；既有下载在轻量更多菜单，Mermaid 的现有 pan/zoom/复制/下载继续保留 |
| 原生表格与当前 Streamdown 不同 | `visual-native-table-code-details.log`：12px 内容，无外框、条纹底色或顶部 toolbar；header 横分隔、hover copy。产品当时 td 为 14px / 20px、蓝色条纹和上方两个按钮 | 已实现 NativeMarkdownTable；12px、27px 标题行、38.375px 普通行、48.75px 尾行。CSV/TSV 复制及 CSV/TSV/Markdown 下载保持可访问；手机采用原生粗指针预留行及批准的 44px 热区 |
| 原生 headings / quote / inline 间距不同 | 原包 h1=19.5/26，h2=16.25/22.75，h3=14.625/22.75；原产品 Streamdown 默认 30/24/20。Inline code 继承 unitless 行高导致 19.435px，原生为 21.125px | 原生 headings、blockquote、hr、inline 背景宿主来源和固定文本行高已逐项修正；`e2e-native-markdown-final-v2` 四种组合全部原始 metrics 相等 |
| Streaming 结束重置读者 wrap 选择 | `visual-native-markdown-integration-red.log`，streaming→static 后按钮由禁用换行回到启用换行 | 将 wrap 选择保留在当前消息 / thread 内，防止 parsed block remount 丢失；`visual-native-markdown-integration-green-v2.log` 2/2 |
| 单文件变更总览重复且配色不一致 | `visual-native-footer-dark.png`、`visual-native-footer-metrics.log`：实际 VT / UT 一文件只显示 64px header，标题“已编辑 source.ts”，Git token 统计在 subtitle。产品当时有汇总与文件两层，约 118px | review owner 已修复；补测 390px 两主题 header64 / chip40 / title13 / Review28，outer radius12.5。保留批准的手机明确预览和实际 Undo 权限，最终 ROI 状态由 review-progress 记录 |
| 768px / 手机横屏输入上下文拥挤 | `e2e-visual-native-full-final/**/workbench-narrow-pane-*.png` 上下文位于 footer 下行约 y884；横屏同样长标题挤在 footer 下方 | root 在 <=840px container 将 context 复用到上方浮层左侧并单行省略，维持固定输入区高度；`e2e-layout-gutter-green.log` 12/12，修后四张关联 PNG 已独立查看接受 |
| 浮动侧栏 handle 遮住表格首字 | 相同 768px 图，handle 宽20px到x20，表格标题开始x17，覆盖“场景”首字 | root 改16px入口 / 12px图标，保留功能，首字x17可见；真实 glyph-hit 断言红→12绿，修后四张关联 PNG 已独立查看接受 |
| Mermaid 动态 chunk 失效使整页落入 ErrorBoundary | `e2e-native-markdown-media-diagnostic.log`：live Streamdown 请求 `mermaid-NOHMQCX5-AHTENGO2.js?v=4899b6a9` 返回504，磁盘 metadata 已为 browserHash0061ffb1，只存在新的 `mermaid-NOHMQCX5-3ERJFNWH.js` | host owner 已修复 Vite 每实例缓存隔离；原样真实 LAN 两例 `e2e-native-markdown-media-cache-fixed.log` 2/2，动态 chunks HTTP200，无 ErrorBoundary；没有替换 renderer URL、清理其他实例共享目录或重启正式 Agent |

## Mermaid 主题及真实媒体闭合

Vite cache 修复后的实际 SVG 首次检查又定位了独立视觉缺陷：产品仍用 Mermaid 默认 lavender 节点 `rgb(236,236,255)` 与 `#333` 箭头，暗色宿主 `#20211d` 下箭头难读。这没有被“有 SVG”功能通过掩盖。使用未修改原包公开的 `visualization-theme...i()`、`image...c()`（实际 V 主题解析）、`image...u()`（原生 Mermaid render）测量两主题，并保存 `visual-native-mermaid-theme-vars.json`、两原生 SVG 与 1440 / 390 两主题 PNG。

原生 dark line / arrow 是 `rgb(133,133,133)`，node 为 `rgb(13,39,63)`，node label 为 `rgb(131,195,255)`；light 对应 `rgb(113,113,113)`、`rgb(229,242,255)`、`rgb(51,156,255)`。实际原包 be CSS 为节点 14px / 600 / radius16、边1px、透明背景。局部 `NativeMermaidFence` 传入原生 base/config/themeVariables/themeCSS 与 `htmlLabels:false`，没有改 Claude 的默认 plugin 或 renderer。

`e2e-native-mermaid-theme-red.log` **4/4 真实失败**，随后 `e2e-native-mermaid-theme-green.log` **4/4 通过**：1440 / 390 × 浅 / 深，SVG computed node、line、label、字体、字重、radius 均匹配原生测值。四张实际产品 PNG 已全部查看，暗色箭头可读、节点与正文颜色协调、手机无横向溢出。最新单位 `visual-native-markdown-mermaid-final-unit.log` **13/13**，前端 `visual-native-markdown-mermaid-final-types.log` 为 0。

`e2e-native-mermaid-theme-controls-final.log` 再次 **4/4**，实际复制接收到 diagram 原文（保留末尾换行）、点击 zoom 后 transform 改变、reset 恢复原 transform，浏览器实际下载 `diagram.svg` 且没有失败。不是仅计算按钮数量。

后续在 root 批准的有限范围内，已复制原包 `image...ye()/B()/je()` 的纯 renderer 分支：lazy ELK layered、节点 padding16 / labelPaddingX36 / minHeight60、decision 矩形虚线、edgeLabel 26px / 横 padding12、开放 marker 与端点缩短、隔离测量 shadowRoot。`@mermaid-js/layout-elk` **0.2.2** 是通过源码 / package 声明和原包实测选择的兼容候选；不能把 App notices 的版本标记说成 VSIX 版本确证。底层 Mermaid **11.17.2** 从既有 transitive 版本直接精确声明，不升级、不另起 engine；Streamdown render facade 与控件继续复用。原生 `be(themeCSS)` 仅 applied improved-flowchart，普通 diagram 的 ELK private alias 不误套 flowchart 选择器，`visual-native-mermaid-theme-branch-red.log` 真实 1 红后已转为单位绿。

`e2e-native-mermaid-layout-red.log` 四组真实失败，`e2e-native-mermaid-layout-cache-green.log` 四组真实通过：原包 Start 节点宽112.126953125 / Done112.703125、高60、中心 `(68.3515625,42)/(68.3515625,142)`、间距40、viewBox `4 4 128.703125 176` 与开放 marker 完整 path，全部与产品实际匹配。新增依赖后当前实例 Vite 正常再优化又出现旧 transform hash，host owner 仅 touch 冻结配置触发 Vite 的正常自重载后已恢复；formal PID 保持，所有原 URL/新动态 chunks HTTP200，见 `host-vite-dependency-checkpoint-proof.json`。没有改测试 URL或 renderer路径。

font flags 深入检查还定位了英文不能覆盖的中文测量差距：实际原包 B privatehost / shadow 同为 synthesis-weight:none；产品 hidden tree 在 body 下，继承 auto/auto，最终可见 SVG 虽已 none，长中文节点却被提前测成 **227px**，源为 **226px**，中心和 viewBox 相应多0.5 / 1px。`visual-native-mermaid-cjk-source.json` 保存公开 image.u 原生实测；`e2e-native-mermaid-shadow-fonts-red` 保存实际 auto/auto 与多1px的 node。仅该 private measurement host 追加源相同 none / antialiased，不写 body 或 Claude。

最终 `e2e-native-mermaid-font-layout-final.log` **6/6**：1440 / 390 × 两主题四组；额外中文源节点226 / 100、labelBBox154 / 28、viewBox242的实际对照；另一个完整真实CC+两Codex图同页隔离场景。各媒体用例实测 host / shadow `none/none`、可见 SVG 同样 none/style:auto/antialiased，执行实际复制、zoom / reset、SVG download，并保留 ordinary fence 和 Math。六张最终产品 PNG 全部实际查看，既有 44px 手机输入按钮及左附件位置保留。

同页隔离没有向 Claude 注入 plugin：实际 CCMessageBlock 原来就把 mermaid fence 当普通代码显示。其 source、14px / 20px mono、360×74.125尺寸与 synthesis:auto 基线在交错刷新与主题切换后保持不变；两 Codex 图同时保持原生60px节点 / 当前主题，六次8ms间隔的不同原生 turn/item更新后最终同时显示“Latest 5”和正确浅色 fill。第一次测试 burst 误用同一个已完成 item ID；修正为原生唯一 turn/item后才把它作为有效门禁，没有把无效夹具当成产品 bug。独立可读截图采用现有 `setCardSize(440)`，不是重设计或修改产品布局。

当前最终单位 `visual-native-markdown-mermaid-final-14-unit.log` **14/14**（7文件），`visual-native-markdown-renderer-freeze-types.log` 类型检查为0；没有依赖其后的未检验源码变化。以上闭合的是所测原生 flowchart、中文测量与实际共享渲染边界，不以此声称每一种 Mermaid diagram-family 都已逐像素验收。

## 原生字体渲染 flags

只读源与实际 DOM 证据为 `review/native-font-flags-proof.json/.md/.mjs`。原包 `app-initial-961644ef2fa7.css` base layer `html,:host` 为 `font-synthesis-weight:none`、Webkit antialiased、Moz grayscale；style synthesis仍auto，shorthand是 `style small-caps`。dark/light各39个 Markdown节点、62个 Mermaid节点、21个实际Yct节点、81个实际Diff shadow节点均继承相同设置，无局部 auto覆盖；auto utility两个调用均是 sidebar heading，不属于这些surface。

只在现有 Codex presentation / composer / preview / approval scope block 增加这三个flags；没有使用会同时禁止斜体合成的 `font-synthesis:none`，没有修改 `.session-mode` 全局或Claude。`e2e-native-font-flags-red.log` **4/4 红**后，`e2e-native-font-flags-green.log` **4/4 绿**；原包四profile逐元素的 weight/style/smoothing，及已有布局/语法颜色/原生图标/实际导出门禁保持全部匹配。

## 原包 Markdown 完成的逐项门禁

`e2e-native-markdown-final-v2.log` **4/4**：700px、390px × 浅色 / 深色，实际原包组件与正式启用产品组件对照。保存 `reference-metrics.json`、native / product PNG：列表位置与 padding；三行 code frame/header/body；table 全部单元格；h1–h6；blockquote / hr；inline code；所有实际 hljs span 的 class/text/RGB；wrap 与 copy 原包 SVG。手机唯一 code height +8px 来自批准的 44px 热区。表格预留 44px 行沿用原包 coarse-pointer 策略。手机 harness 添加宿主正常 viewport meta，并匹配保留的蓝色 pane 1px 边框后的实际 356px 内容宽度。

同一套 LAN 用例实际切换 wrap，触发浏览器 download，并验证 code.typescript / table.md；CSV、TSV、Markdown 菜单可访问。复制失败和过期异步结果不会伪报成功或覆盖新内容，见 `visual-native-markdown-final-format-unit.log` **13/13**。其中实际 nativeFenceHighlight 保留 11.11.1 语法、原包 TSRX grammar、别名和 HTML escape，代码字符串不会成为可执行标签。前端 `tsc -b` 为 0。没有以单个低全图像素分数宣称整个界面完全一致。

中文字体没有凭截图改动。原包和产品的 CDP `CSS.getPlatformFontsForNode` 均为 **WenQuanYi Zen Hei**，正文 computed 为 system-ui、13px / 21.125px。证据 `visual-native-platform-fonts.log`、`e2e-visual-palette-scoped/**/platform-fonts.json`。小字号截图的视觉感觉不等于实际宋体。

## 只读原包参考边界

围栏和表格使用当前 VSIX 未修改组件 `zg`，保留真实 AppScope / QueryClient / Intl，以及原始 `PersistedStateProvider`、ResizeObserver 和 thread / route scopes。同一 React root 先直接渲染 `S._` 的纯内容，再仅替换其 children，避免旧 provider cleanup 清掉新初始化的全局 store。没有改写原始组件行为、原始 JS / CSS 或 VSIX 文件。`review/native/assets` 是指向提取 assets 的目录 symlink，检测后拒绝 append 该目标，未修改任何资产；现有 provider 初始化已足够。

暗色 Diff 批准截图颜色与当前原包 CODEX code-theme 基线的残差仍由 review progress 明确保留。此独立验收不将两者混为同一 baseline，不以低全图差异百分比替代具体组件、字号、几何和状态检查。

## 边界与其他 owner 的最终门禁

完整自由分屏矩阵、原生窗口交互、请求 / hook / account / host 的最终整页对照，以及整仓类型和全量回归由 root 和对应 progress 汇总；此独立记录不代替那些门禁。物理 iOS / Android 软键盘、录音权限和平台原生文件选择器尚未实机验收，浏览器模拟不能代替这些边界。模型浮层的副标题、箭头、端点和滑轨边缘已按同宿主原包四状态定位并修正，动态强度与 Portal 字体另行判别；批准暗色 Diff 配色与原包 CODEX code-theme 的基线区别仍单独保留。以上均不被本 Markdown 组件门禁掩盖。


## 两引擎最终主界面与局部外观复核

`e2e-final-keyboard-mcp-annotation-chromium.log` 33/33 与 `e2e-final-keyboard-mcp-annotation-webkit.log` 32/32 是新的完整主界面/输入/阅读批次；不同引擎和专项计数不拼成一次全绿。各自12张 `workbench-*.png` 全部通过图片工具查看：六个尺寸、两主题，正文、围栏、表格、文件摘要与分离输入区的字号/行距/内距、边框/选中线和悬浮工具均纳入检查。390×420是缩小视口，844×390是横屏，均不宣称真实OS软键盘。

实际360px桌面split与390px触摸输入专门打开模型、权限、加号、技能候选和容量说明；主动作按elementFromPoint中心命中，运行中停止与队列并存，124px框体不增加高度。WebKit真实旧Observer异常已分别定位到视口与caret锚点；保留行同步测量后，两可见项目各10000条历史的中间锚点在延迟代码/图像增加高度时偏移不超过2px，草稿和未读保留，无页面异常。

MCP管理页详情/状态对比度与按钮布局另有实际红灯，不能用主聊天截图通过代替。最新 `mcp-visible-circle-final-{chromium,webkit}` 各4/4，两引擎共4张手机授权后图均实际查看：身份/状态与动作分行、16px内距、8px间隔；正常32×18px开关轨道置于44px透明热区。通知最终距底16px，关闭20px可见小圆保留44px触控；rich-colors覆盖曾导致整个44px圆被画出，真实computed背景红→透明绿。测试等待通知入场动画实际结束后取图，动画中间帧被截断不当作最终外观。

同宿主模型simple/advanced浅深四状态图也已实际查看，逐字段检查自然panel尺寸、行内距、11px副标题/透明度、Chevron、13px端点、滑轨/旋钮边缘与外层双ring。历史1.3%–3.5%全图残差不替代这次具体证据，也不保留为“当前仍未定位”；advanced自然83.421875px和原包wrapper offsetHeight83px的区别已明确，不硬裁尺寸。

本次仍保留批准的手机触控/固定高度/安全区适配和自有分屏/悬浮工具。未宣称整个产品所有动态状态零RGB差异；实体手机、正式Rust激活与远端不可用能力仍见实施记录。

## 模型、图库和插件细节收尾复核

`model-menu-state-fonts-green.log` 单批6/6补齐独立 Portal 字体和 high/xhigh/ultra 状态；三种强度×两主题的6张产品 PNG 已用图片工具查看。原包与产品分别测量状态属性与 RGBA，高/极高为 charts-blue，只有真实 maximum/ultra 为 charts-purple；font weight synthesis 为 none、style/small-caps 仍 auto。可选档位由真实模型元数据决定，此渲染门禁不宣称正式 CLI 已提供 ultra。

`request-gallery-green.log` 单批4/4的手机与桌面两主题整页 PNG 已全部查看。手机箭头呈正常32px圆，透明44px热区保留原中心，点击 Next/Previous 不选择模板或发送请求；桌面几何不变。模板测试图片为最小有效PNG，实际图片解码/放大和原图标注由媒体/附件门禁另行证明。

插件详情手机原动作贴在x=0且正文间隔为0，最终专用16px内距和16px header/body间隔使动作与分隔线对齐。`plugin-spacing-notice-final-green.log` 单批4/4、40.4s：安装通知仍可见时，返回中心真实命中并 tap，正常离开保护取消、关闭和后续 typed 提交全部执行；手机通知距底16px、随当前浅深 Session 主题，关闭44px透明区域内保留20px可见圆。普通 Sonner 通知不带 data-type，原20px关闭与2px伪圈的实际中间红灯保留，最终按实际 data-styled 限定规则。桌面仍右上通知与20px关闭，详情0内距/0新增间隔及10个共同动作几何/字体/颜色保持原样。

本最终插件批次的6张手机 detail-installed/installed-toast/manage 和4张桌面详情/通知共10张整页图均已由主线程查看；子线程另保留24张产品图及全部测量。安装 fixture 只证明界面和原生 typed 身份/原目标保护，不等于真实账号插件安装或实际模型已使用它。

完整请求流程最终两引擎各24/24，对应各12张 requests-page 整页图共24张也全部查看，包含横屏和390×420短视口。长卡片局部可能在当前阅读滚动位置裁切，按钮通过正常阅读滚动逐项到达并测真实中心；没有把局部截图或整张卡片必须同时可见当作功能验收。WebKit 本批滚动为明确的 DOM事件/实际布局模拟，Chromium 为可信触摸事件，均不冒充实体手机。


## 滚动与间距最新截图快照

`final-scroll-spacing-{chromium,webkit}` 下各12张workbench整页图全部由主线程用图片工具查看：1440、768、480、390、844×390和390×420，两主题分别对照字号、段距、围栏/表格、边框与悬浮输入工具。间距专项另有adjacent/multi-paragraph的四设备主题测量及实际原包footer对照：正常段间13px保持，末段额外13px取消；桌面assistant操作栏22px，手机44px不缩小，完成消息正文间距52→44px。滚动红灯帧曾出现39.75px缝隙、1228.75px重叠和部分可见代码块长高后的720px拉动；修复后对应帧级缝隙及阅读漂移为0，虚拟化仍有界。主界面截图通过不代替WebKit当前desktop hover和长历史切换的三项失败，最终结果以实施记录追加的定向门禁为准。

助手hover补齐后的两个引擎各4张footer-entry整页PNG也已由主线程全部查看，含浅深主题、手机44px和桌面22px；图片是在完成全部入口后侧边追问已打开的状态，按钮的初始隐藏、真实hover、keyboard focus-within与中心命中由同批DOM/实际操作收据验证，不把最终空侧边草稿截图当作所有hover状态截图。新规则仅展开原有助手可见性选择器，未改变正文色值、间距或Claude。

最终`scroll-actual-ro-{chromium,webkit}-final-results`中各9张PNG共18张也已由主线程逐张用图片工具查看：1440/390长历史阅读、触控板实时更新、底部回复增高、混合长短正文、原生滚动条拖动、半露出代码增高、行内编辑键盘和轮次折叠/阅读恢复。正文、代码块、悬浮工具和阅读提示的排版在这些快照中保持一致；截图中按阅读位置裁切的旧消息不视为缺失。对应两引擎各9/9真实浏览器专项通过，实际growth RO后离底、接缝与部分可见行漂移均为0px。此证据不能替代实体手机、屏幕录制或持续60fps；WebKit1500条缓存历史切换946ms仍超过500ms门槛。收据及原始帧数据见`scroll-pinned-ro-final-receipt.json`。

### 当前稳定回调与混合Agent输入的补充复核

上述7192快照之后，CodexThread仅稳定getItemKey回调，当前97c源码的两引擎滚动/阅读各9项通过。主线程额外查看当前Chromium混合长短行与WebKit半露出代码增长截图，几何和旧已查看18图一致；不把本次两张查看说成重新逐张查看最新18图。当前长历史WebKit缓存切换实测989ms仍未达500ms，先前946ms为历史值。

`mixed-agent-passive-focus-{chromium,webkit}-green`的18张混合输入PNG已由主线程全部实际查看，包含手机两主题和桌面Codex→Claude→Codex草稿/真实缩略图恢复。输入目标在对应会话下保留，手机触控入口未缩小；Claude原renderer保留，不以改造Claude正文获得本次焦点收益。原版真实touch获得textarea焦点的红灯与修复后按钮焦点/被动请求0次分别保存，不能将浏览器焦点见证说成实体OS软键盘实测。

命令组件原包对照的四张product/reference PNG也已实际查看。测试执行原生Vx→FEi→CEi包装链，末态截图统一等动画结束，再比较实际RGBA、SVG路径与几何：当前摘要文字、箭头、原命令和整个shell body区域的RGB像素差为0；每主题仅terminal SVG边缘2像素有最大1通道差异。先前481/486字符/中间动画残差已经过时，不再列为当前未定位项；没有宣称整个组件或全产品零RGB差异，也不凭猜测解释历史差异原因。

核心保留功能复测的手机深色展开过程及桌面浅色完成轮次折叠截图已实际查看：工作摘要折叠时过程隐藏，文件变更摘要仍在；正常展开后工具正文/代码与hover Diff可用。此为空历史夹具快照，剩余视口留白不是消息间新增padding，不用强制撑满内容改变聊天布局。

主线程另实际查看文件草稿保存失败末态和后台未读标签截图：文件A/B各自有未保存标记，失败提示与B草稿仍在；后台完成仅一个未读圆点。503行全文、保存途中继续输入和跨文件回执归属由同批实际步骤/断言证明，末态单张图不冒充全部步骤证据。最后WebKit刷新用例恢复正文、状态、输入目标与逐会话阅读位置通过；旧页网络诊断仍保留在JSON，新页及两个document的真实JS异常严格为零。
