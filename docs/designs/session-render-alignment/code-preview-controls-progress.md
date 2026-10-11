# Codex SVG 代码预览与复制控件对齐（2026-10-10）

## 来源与实现

本项继续完整 [1:1 实施目标](plan.md)，不是全编辑器／全会话功能完成声明。上一项 [共享换行偏好](code-wrap-progress.md) 保留。

原始来源：`third_party/openai.chatgpt-26.51002.51308-linux-x64/extension/webview/assets/app-initial-3192ac99b6cd.js`，Unicode 字符偏移 4070914 的 `tBi` 判定，以及 `hBi` 的 `qXn` 图片分支；1517435 附近 `UXn/qXn` 在 template 中修复尾部不完整标签、将 xlink 转为 href，最后交给 data URI 的 img。不是从截图猜测一种新的预览交互。

- `svg` 围栏显示图片；`xml`／`html` 仅按原正则在 SVG 开头时显示。其他 XML／HTML 和源内容变化后仍使用代码呈现。
- 原始代码仍用于复制和既有下载，不把规范化的图片 markup 回写消息或剪贴板。预览移除不适用的换行控件。
- 使用惰性的 template 解析和 img 图片上下文，不把模型 SVG 内联进应用文档；xlink 兼容、384px 限高和原包四语言 alt 保留。数据 URI 仅随挂载组件保留，没有额外消息 store、跨会话图片缓存或工具正文恢复。
- 代码复制／换行使用原生普通 `sE` tooltip（默认 200ms、2px 偏移），不是 composer 的紧凑提示；12px／18px、5×12px 内距、20px 圆角、-0.15px 字距、5% oklab 边框与原阴影，浅深主题分别匹配。Portal 限定在 session-mode，去掉浏览器 title 和公共 tooltip 箭头，保留其他组件原样。
- 成功反馈图标按原生 toolbar 的实际 PT 路径修正，反馈 2 秒内不重复复制；异步 Clipboard API 等待中使用原生通用 `rBi` 的 aria-busy／aria-disabled 分支和独立请求锁。

## 红绿灯及真实浏览器

SVG 缺失红灯为 `/tmp/codex-svg-unit-red.log`、`/tmp/codex-svg-browser-red.log`：原包 3 张图已解码，产品为 0 张。复制等待红灯 `/tmp/codex-copy-red.log` 复现无 pending 状态。提示浮层初轮 `/tmp/codex-code-controls-first.log` 的四场景不相等，进一步定位字距、浅色、边框；随后 side 的真实差异也保留，未改阈值掩盖。

原生浅色宿主的 `--vscode-dropdown-background` 也须与产品匹配：新参考 helper 按同一主题设置该变量。此前旧 harness 只改 sidebar、保留暗色 dropdown，不能用它推导正常浅色 tooltip 文本应该一直暗色。所有原包 JS／CSS 保持未修改。

最后增加真实原组件复制后的图标比较，在 `/tmp/codex-code-controls-confirmed.log` 四组均得到红灯，证明旧 check 路径不是当前启用 glyph。人工查看提示截图还发现 Arrow 包裹在 span；不仅原 `> svg` 规则漏掉箭头，Radix 的 SVG 行内 display 也覆盖普通隐藏 CSS，实际绘制箭头数门禁继续红灯。最后给共享 TooltipContent 增加默认关闭的 hideArrow 参数，只在本控件开启，其他提示仍绘制原箭头。实际偏移门禁又确认普通 tooltip 为 2px，不能套 composer 的 4px。

验证入口：

```sh
PLAYWRIGHT_SKIP_WEBSERVER=1 \
PLAYWRIGHT_BASE_URL=https://10.30.0.24:8484 \
CODEX_NATIVE_REFERENCE_URL=http://10.30.0.24:43831/native-markdown.html \
pnpm exec playwright test \
  tests/e2e/session-codex-svg-reference.spec.ts \
  tests/e2e/session-codex-code-controls.spec.ts
```

前端 **HTTPS :8484** 和原包只读参考 **HTTP :43831** 均绑定 0.0.0.0；API 使用隔离 fixture，没有向真实 Agent 发送、审批、停止或恢复任务。原包 helper 使用真实 provider 和空的 persisted-atom-sync 响应，不改原组件逻辑。参考临时进程只在本轮验收期间使用。

## 验证边界

原包 `hBi` 的复制回调向原生剪贴板 helper 同步分派，不返回浏览器权限 Promise；通用 `rBi` 则明确支持异步 pending。本项目须等实际 Clipboard API 回执才能显示成功，保留 pending 和错误提示，不把本机宿主的同步分派当作浏览器权限已确认。该差异属于真实剪贴板宿主边界。

本轮不修改网关裁剪、流式预算、休眠恢复或消息身份。初次前端类型检查 `/tmp/codex-svg-controls-types.log` 仅报告兼容 `SubagentSummary` 对已移除标签的 TS2367。进一步按当前行内子 Agent 设计删除该无用旧分支，不恢复工具标签；旧运行态不关闭工作区、只刷新子任务，`/tmp/codex-stale-summary-red.log` 1 项红灯到 `...-green.log` 两项通过，未知计数不造零的旧用例保留。随后完整 `pnpm check` 已通过。

本项不代替其他编辑器工作流、账户／云能力、错误重试等完整功能验收。

## 最终本轮证据与剩余差异

- `/tmp/codex-preview-controls-final-unit.log`：29 文件、87 项通过，覆盖正文、预览、复制、既有 composer tooltip、偏好与旧子任务摘要；专项统计有重叠，不合并冒充更多独立用例。
- `/tmp/codex-code-controls-final-pass.log`：390／700 × 深浅主题 4 项通过，严格比较提示实际绘制文本、主题、边框、字号／字距、圆角、尺寸、阴影、动画、2px 偏移及零箭头；原包实际点击复制后的 glyph 与产品一致，pending／重复／完成反馈／恢复都执行。
- `/tmp/codex-svg-final-verified.log`：390／700 × 深浅主题 4 项通过，5 个样本包含 SVG／XML／HTML、900px 高图和带 script 的 SVG；实际解码后图片来源、尺寸、384px 限高、字体、平滑、过滤／色彩方案逐项一致。SVG script 未执行，也未内联进应用 DOM，原始字符串复制准确。
- `/tmp/codex-preview-controls-check-final.log`：完整 `pnpm check` 退出 0，shared、TS 运行层、网关、前端类型与生产构建通过；只保留原有大 chunk 警告。
- 截图位于 `.dev-runtime/codex-code-controls-final-pass/` 与 `.dev-runtime/codex-svg-final-verified/`；四主题／宽度的提示、SVG 卡片以及手机暗色／桌面浅色的复制反馈、高图已人工查看。未把截图中的自有导航、更多操作和“回到最新”浮层当作原生缺失能力。

**SVG 像素残差尚未闭合**：纯图片 PNG 的初次比较为手机每主题 1608 像素、最大通道差 84，桌面每主题 43 像素、最大 17。第二组仅在 fixture 中把两图起点对齐整数 CSS 像素，手机仍有 1609 个残差，桌面降到少量像素；圈形无手机残差，主要集中在文字，但目前不能据此断言只是字体抗锯齿。原始与对齐 PNG 均保留，来源、渲染尺寸、font/image-rendering/filter/color-scheme 一致的对照也保留；完整数字见 `.dev-runtime/codex-svg-final-verified/pixel-comparison.json`。没有改 SVG 原文、强改图片字体或降低门槛以制造零差，不将功能／样式通过宣称为全部像素完全一致。完整目标仍保持进行中。

## 后续 SVG 栅格对照与表格验收

后续在 `.dev-runtime/codex-table-svg-final/` 将原组件／产品第一张 SVG 同时绘制到 400×100 Canvas，390／700px 深浅四组合的 PNG 字节完全相同，逐像素比较均为零。该结果证明此固定尺寸下的图片内容一致，不证明 CSS 缩放后的页面合成完全一致。保留原页面截图比较：整数起点手机深浅各 1609 个不同像素／最大通道差 84；桌面深浅分别 23／21 个不同像素／最大差 22。数据在同目录 `pixel-comparison.json`；尚未确认页面残差的具体原因。SVG 四场景验证见 `/tmp/codex-table-svg-final.log` 中的四项通过记录；同次初轮表格失败已经单独继续修正，不能把该混合运行标作八项全绿。表格进度见 [表格复制与滚动](table-controls-progress.md)。

代码按钮焦点、悬停色和提示失焦／隐藏生命周期已在 [后续对齐](link-focus-progress.md) 继续修正；SVG 页面残差仍保留。
