# Codex 表格复制、滚动与正文语义对齐（2026-10-10）

本项继续 [完整复刻目标](plan.md)，记录常规 Markdown 表格的验收，不代表全编辑器／全对话功能完成。

## 原始来源和修正

来源为仓库内 `openai.chatgpt-26.51002.51308-linux-x64` 的未修改 JS／CSS：`app-initial-e98b9eaef8e3.js` 的 `Eui`、`Cii/Eii/Dii`、`HU` 和表格列长分类；`app-initial-3192ac99b6cd.js` 的 `rBi`；`app-initial-961644ef2fa7.css` 的 Table、InlineCode、Mention 和 `edge-fade-horizontal`。复制清理以原 `lon/yL` 的结构和属性白名单为准。

- 普通复制按钮使用原生 200ms tooltip、16px 图标、等待状态和两秒成功反馈；等待期间使用独立锁，原生复制请求阻止向消息容器冒泡。失败保留错误提示，流式表格替换后不对新内容显示旧成功。
- 方向键在复制按钮获得焦点时也滚动表格：每步 40px；Mac 的 Alt 组合滚动一个可视宽度；其他平台的 Alt、Ctrl、Meta、Shift 和已处理事件保持原生边界；滚动区自身保留浏览器默认键盘处理。浏览器在末端的自然夹紧纳入断言。
- 表格保留原生 `fit-content` 包裹、单元格 `break-word`、顶部对齐及 `dir=auto`。每列按 HU 递归读取的 React 子节点文字（不把不透明控件内部生成的标签当作 children），使用最长标题／单元格的 40／100／160 字符边界分为 sm／md／lg／xl，纯数字单元格不换行。普通非 wide 表格按原级联规则不设置数字最小列宽。
- 渐隐使用原包的滚动时间线、0／16px 两端距离和 `min(2px,50%)`／`max(100%-2px,50%)` 范围；自定义属性与动画名字在本项目使用独立命名。没有新增滚动轮询。
- 默认复制同时写入原始表格 Markdown 和干净的结构 HTML。移除界面 class、私有 data 属性及隐藏动作；保留原包允许的链接／表格等语义属性；行内代码保留 `dir=ltr`。不能直接复制 `outerHTML`。
- 显式保留 `strong` 语义；安全链接保留原 Markdown 拼写，仅在它与已经通过 URL hardening 的地址完全等价时采用。原项目文件打开行为保留。网站标签按 Mention 的 500 字重、80% 链接色混合、16px 图标与 `1lh` 居中规则呈现；favicon 使用原包同一来源，失败显示原始 globe glyph，加载后显示图片，图标从复制内容排除。
- 既有 CSV／TSV 复制与三种下载继续放在更多菜单。手机保留既定 44px 触控热区，原扩展的表格预留 44px 顶部空间保留。

原 `Eui` 当前的展开按钮分支实际为 `null`；不能把源码中存在预览组件当作已启用的入口。网站链接完整悬浮预览、外部打开控制及 wide-block 的其余行为继续按完整清单独立审计，当前页面不将它们标为完成。

## 红绿灯和真实浏览器

初始单测红灯：`/tmp/codex-table-unit-red.log`、`/tmp/codex-table-rich-red.log`。列宽边界、strong／链接语义、冒泡分别有 `/tmp/codex-table-columns-red.log`、`/tmp/codex-table-semantics-red.log`、`/tmp/codex-table-bubble-red.log`。浏览器继续得到长词不溢出、富文本不等、网站图标偏移与颜色／焦点差异红灯，未删除比较项或放宽阈值。

人工截图检查发现原参考浅色页仍保留暗色宿主 `textLink` 变量；参考 helper 现按产品相同深浅主题设置 foreground／activeForeground，原包 JS／CSS 保持不动。普通图片控件此前的 dropdown 修正继续保留。

验收使用前端 **HTTPS :8484**：`https://10.30.0.24:8484`，参考 **HTTP :43831**：`http://10.30.0.24:43831/native-markdown.html`，均绑定 `0.0.0.0`。API 使用隔离 fixture，原组件使用真实 provider；Clipboard API 与 favicon 成功响应使用可控浏览器替身，避免权限弹窗和网站网络状况使结果不确定。favicon 加载前后均有真实浏览器截图。

```sh
PLAYWRIGHT_SKIP_WEBSERVER=1 \
PLAYWRIGHT_BASE_URL=https://10.30.0.24:8484 \
PLAYWRIGHT_FRONTEND_PROTOCOL=https \
CODEX_NATIVE_REFERENCE_URL=http://10.30.0.24:43831/native-markdown.html \
pnpm exec playwright test tests/e2e/session-codex-table-controls.spec.ts
```

每组验证表格和单元格宽高／列档位／断行／方向、三位置渐隐、键盘滚动、tooltip、图标位置／颜色、剪贴板两种格式、等待／成功期间重复操作保护、焦点和既有导出入口。输出包含原组件和产品的 tooltip、三位置滚动、pending、copied、favicon 成功和产品导出菜单截图，覆盖 390／700px 深浅四组合。

## 内存与交付边界

列宽只随挂载表格更新；没有正文副本 store、全局图片缓存、后台历史轮询或额外音频实例。网关裁剪、流式预算、休眠恢复和不可见正文 60 秒回收契约保留。正式前端与 Agent 服务不因本项验证重启；未提交或推送。

SVG 的后续证据见 [代码预览进度](code-preview-controls-progress.md)：400×100 Canvas 内容四组零像素差异，页面截图仍有残差，不能用 Canvas 成功替代整页像素验收。

## 最终记录与未通过的仓库门禁

- 表格最终四组合全部通过：`/tmp/codex-table-browser-final.log`；截图及颜色、图标坐标、表格几何、剪贴板、渐隐和焦点数据在 `.dev-runtime/codex-table-controls-final/`。人工复核最终手机深色／桌面浅色复制反馈、网站图标成功及前轮导出菜单和 tooltip 截图。
- 本项相关单测 29 文件／95 用例通过：`/tmp/codex-table-unit-final.log`。另有 `/tmp/codex-table-region-red.log` 和 `/tmp/codex-table-child-text-red.log` 证明滚动区不能套用按钮自定义处理、列长不能直接读取 opaque 控件的 DOM 标签。最终复制焦点比较保留实际绘制的 2px 阴影，只规范化零宽 outline／零扩散阴影等不绘制项；手机保持无 hover 媒体规则的灰色，桌面按实际 hover 颜色。没有放宽像素或几何阈值。
- 全仓库 `pnpm check` **最后未通过**：`/tmp/codex-table-check-final.log`。本轮后段工作区新增 `CodexMarkdown.citation-open.test.tsx`，传入当前接口没有的 `cwd`，触发 TS2322；完整目录单测 `/tmp/codex-table-unit-delivery.log` 同一新用例还在 `NativeFileCitationPill.tsx:81` 因 `i18n.language` 未初始化而失败。该新文件保持原样，本项最小门禁明确使用 `--exclude '**/CodexMarkdown.citation-open.test.tsx'`，不把 95 项通过称作全目录／全仓库通过。此前新用例进入目录前的 `pnpm check` 成功日志 `/tmp/codex-table-final-check-pass.log` 仅为较早快照。
- 临时只读参考服务在验证后退出，正式前端 PID 2723967 及 Agent 服务保持运行。测试失败没有通过刷新正式页面、恢复或停止 Agent 来规避。

后续仍需独立核对普通代码按钮焦点、网站完整悬浮预览／打开行为和上述引用文件用例；SVG 页面截图残差也继续保留。完整复刻目标保持进行中。

## 后续门禁恢复（2026-10-11）

新增引用打开测试已按实际公开接口移除多余 cwd，并保留目录／行号／编辑器打开断言；语言初始化缺口有独立保护。`pnpm check` 当前已恢复通过，详见 [后续链接与焦点记录](link-focus-progress.md)。表格等待权限时现在比较清理后的语义 HTML，排除 favicon／提示属性变化，真实换行仍不会套用旧回执。此前本页记录的失败和临时排除仅为历史状态，不作为当前门禁结论。
