# Diff 渲染取证（阶段 0，2026-10-27）

**这是阶段 0 影响最大的架构发现，需要你在 review 时特别判断。**

## 结论：官方 Diff 用的是 Monaco，不是手写组件

证据：

- `fZ0_2.js:267` 容器 class 字面量：`"monaco-component diff-review monaco-editor-background"`
- `entry/chunk_S_0.js:70` 与 `entry/chunk_vT0_2.js:82` 两处直接调用
  `r3.createDiffEditor(container, {...})`
- bundle 中 `monaco-editor` 命中 22 个模块、`monaco-component` 4 个、
  `DiffEditorWidget` 1 个

因此方案 §3.3 里列出的 `.diff-review*` 类名（`diff-review-row`、`diff-review-cell`、
`diff-review-line-number`、`diff-review-summary`、`diff-review-spacer`、
`line-insert` / `line-delete`）**不是官方自己写的 CSS，而是 Monaco 的
accessible diff viewer 自带结构**。`fZ0_2.js` 本身就是 Monaco 的
accessible-diff-viewer 模块（含 `diffreview.close`、`label.close` 等
Monaco 本地化 key 和 codicon 图标注册）。

官方自己的包装层只有两个类（`entry/chunk_S_0.js:20-29`）：

```
diffEditorWrapper / diffEditorContainer / truncationGradient
clickOverlay / expandButton
codicon-light-bulb / codicon-diff-insert / codicon-diff-remove
```

## 官方的 Monaco 配置（逐字）

`entry/chunk_S_0.js:70-91`，组件入口 `p_0({ original, modified, language = "plaintext", filePath })`：

```js
readOnly: true,
renderSideBySide: <见下方断点>,
useInlineViewWhenSpaceIsLimited: false,
renderOverviewRuler: false,
scrollBeyondLastLine: false,
minimap: { enabled: false },
automaticLayout: true,
fontSize: JC(),
lineNumbers: "off",
lightbulb: { enabled: ShowLightbulbIconMode.Off },
wordWrap: "on",
wrappingIndent: "same",
scrollbar: {
  vertical: "hidden", horizontal: "hidden",
  verticalScrollbarSize: 0, handleMouseWheel: false,
}
```

要点：行号关闭、minimap 关闭、overview ruler 关闭、滚动条完全隐藏且
**不接收滚轮**（滚动交给外层消息列表），自动换行且延续缩进。

## 响应式断点（带回差，易漏）

`entry.js:3595-3606`：

```js
YT1(width, isCurrentlySideBySide = false) {
  if (isCurrentlySideBySide) return width > 876;   // 已并排：低于 876 才收起
  return width > 900;                               // 未并排：高于 900 才展开
}
```

即 **并排阈值 900px，收起阈值 876px，24px 回差**，用于防止拖动改变宽度时
在临界点反复抖动。通过 `ResizeObserver` 监听，模式变化才调用 `updateOptions`。

这种回差是纯靠猜测绝不会复刻出来的细节。

## 高度与截断（逐字）

`entry/chunk_S_0.js:9-19`：

```js
S_0(a, b) => Math.max(a, b)                  // 取 original/modified 较高者
g_0(h) {
  const J = Math.max(0, Math.ceil(h));
  const height = Math.min(200, J + 20);      // 上限 200px，内容 +20px 留白
  return { height, truncated: J > height };
}
```

超出 200px 时：

- 渲染 `truncationGradient` 渐隐
- 叠加 `clickOverlay`，内含 `expandButton`，文案 **`Click to expand`**
- overlay 有 `onFocus` / `onBlur` 配合 `:focus-visible`，键盘可达

高度变化由 `onDidChangeModel`、`onDidUpdateDiff` 和两个子编辑器的
`onDidContentSizeChange`（仅 `contentHeightChanged` 时）驱动。

## 需要你决策：Diff 怎么实现

官方用 Monaco，本项目**不能照搬**——Monaco 完整引入会显著增加体积，
而会话模式刚把冷进入 composer p95 压到 1.3 秒（见
`session-mode-parity-and-startup-speed-audit-20261027.md`），
引入 Monaco 有实质回归风险。

**用户已决策：选 A（2026-10-27）。** 复用现有 diff 渲染，按官方配置语义对齐行为；
不引入 Monaco。下列数值作为实现契约与断言依据。

### A. 复用本项目现有 diff 渲染（已采纳）

现有 `styles/git-diff.css` 与 `features/git` 已有 diff 能力。
按官方的**配置语义**对齐行为：200px 上限、+20px 留白、`Click to expand`、
900/876 回差断点、滚轮不拦截、行号关闭、自动换行延续缩进。
视觉按 §Diff 变量组映射 19 个 `--vscode-diffEditor-*`。

- ✔ 不增体积，不碰启动性能
- ✔ 行为可逐项断言
- ✘ 不是 Monaco，极端 case（超长行、复杂移动检测）渲染可能有差异

### B. 引入 Monaco diff editor

和官方同构,`createDiffEditor` 配置可逐字照抄。

- ✔ 保真度最高
- ✘ 体积与启动性能风险，需重测冷进入 p95 门槛
- ✘ 与现有 git diff 能力重复

### C. VS Code Web 已在项目里，复用其 Monaco

`features/vscode` 已经跑 VS Code Web。理论上可借用,
但跨 iframe 渲染聊天内嵌 diff 不现实。

- ✘ 我判断不可行，仅列出供排除

**我的建议是 A**：本次深度是「行为 + 视觉近似」，而上面这些配置值
（200/20/900/876、滚轮不拦截、`Click to expand`）都是可直接断言的行为契约，
不需要同一个渲染引擎也能对齐。

## 边界

以上数值与配置来自静态反编译，**可信**（是字面量，非推测）。
但 Monaco 在这些配置下的**实际视觉输出**（如移动检测如何着色、
折叠区如何呈现）需阶段 2 官方宿主截图确认。
