# 主题 token 映射：官方 `--vscode-*` → 本项目 `--claude-*`（阶段 0，2026-10-27）

官方 Claude webview 的 `index.css`（471,104 bytes）引用 **258 个不同的 `--vscode-*` 变量**。
在 VS Code 里这些由宿主注入；本项目在浏览器中运行，必须自己提供。

## 沿用 Codex 对齐已验证的做法

Codex 对齐期间建立的模式可直接复用（`apps/web/src/session-mode/codex-presentation.css`）：

```css
/* 浅色块 */
--codex-surface: var(--vscode-editor-background, #fff);
--codex-text:    var(--vscode-foreground, #3b3b3b);
/* 深色块（同名重定义） */
--codex-surface: var(--vscode-editor-background, #20211d);
--codex-text:    var(--vscode-foreground, #ccc);
```

即 **`var(--vscode-X, <本项目回退值>)`**：真有宿主变量时跟随宿主，没有时用回退值。
Claude 侧建立**平行的 `--claude-*` 命名空间**，与 `--codex-*` 并存不混用——
这正是「两个 Agent 各自对齐各自插件」决策的落地方式。

作用域限定在 `.session-mode` 下的 Claude 容器，不污染全局，也不影响 Codex 的 token。

## 按用量排序的高频变量（前 20）

| 官方变量 | 用量 | 用途 | 拟定 `--claude-*` |
| --- | ---: | --- | --- |
| `chat-font-size` | 63 | 聊天正文字号 | `--claude-chat-size` |
| `editorHoverWidget-border` | 18 | 悬浮卡边框 | `--claude-hover-border` |
| `focusBorder` | 17 | 焦点环 | `--claude-focus` |
| `sash-size` | 13 | 分隔条宽度 | `--claude-sash-size` |
| `editorHoverWidget-background` | 11 | 悬浮卡背景 | `--claude-hover-bg` |
| `textLink-foreground` | 10 | 链接 | `--claude-link` |
| `textLink-activeForeground` | 10 | 链接按下 | `--claude-link-active` |
| `editor-background` | 10 | 主背景 | `--claude-surface` |
| `scrollbar-shadow` | 9 | 滚动阴影 | `--claude-scroll-shadow` |
| `editorHoverWidget-foreground` | 9 | 悬浮卡文字 | `--claude-hover-text` |
| `chat-font-family` | 9 | 聊天正文字体 | `--claude-chat-font` |
| `widget-border` | 8 | 控件边框 | `--claude-widget-border` |
| `toolbar-hoverBackground` | 8 | 工具条悬停 | `--claude-toolbar-hover` |
| `widget-shadow` | 7 | 控件阴影 | `--claude-widget-shadow` |
| `editorLink-activeForeground` | 6 | 代码内链接 | `--claude-code-link` |
| `disabledForeground` | 6 | 禁用态 | `--claude-disabled` |
| `textCodeBlock-background` | 5 | 行内代码底 | `--claude-code-bg` |
| `foreground` | 5 | 主文字 | `--claude-text` |
| `editorGhostText-foreground` | 5 | 幽灵文字 | `--claude-ghost` |
| `editorCodeLens-foreground` | 5 | CodeLens | `--claude-codelens` |

`chat-font-size` 用到 63 次，说明官方正文排版**整体挂在宿主聊天字号上**。
本项目必须给 `--claude-chat-size` 一个明确回退值并在两主题下核对，
否则所有间距会漂移。

## Diff 变量组（19 个，完整）

Diff 是官方渲染里变量最密集的区域，必须整组映射：

```
diffEditor-border                      diffEditor-diagonalFill
diffEditor-insertedLineBackground      diffEditor-insertedTextBackground
diffEditor-insertedTextBorder          diffEditor-removedLineBackground
diffEditor-removedTextBackground       diffEditor-removedTextBorder
diffEditorGutter-insertedLineBackground
diffEditorGutter-removedLineBackground
diffEditor-move-border                 diffEditor-moveActive-border
diffEditor-unchangedCodeBackground     diffEditor-unchangedRegionBackground
diffEditor-unchangedRegionForeground    diffEditor-unchangedRegionShadow
multiDiffEditor-background             multiDiffEditor-border
multiDiffEditor-headerBackground
```

注意区分三组语义，不能合并：

- **Line** background：整行底色
- **Text** background/border：行内字符级高亮
- **Gutter**：行号槽

另有 `unchangedRegion*` 四个变量对应 Diff 折叠区（配合 `.diff-hidden-lines`
与 `.diff-hidden-lines-compact` 两个类），以及 `move-border` / `moveActive-border`
对应代码块移动检测（配合 `.diff-moved-code-block`）。本项目现有
`styles/git-diff.css` 的 token 不覆盖这些语义，需要补齐。

## ANSI 调色板（10 个）

```
terminal-ansiBlack   terminal-ansiBrightBlack  terminal-ansiRed
terminal-ansiGreen   terminal-ansiYellow       terminal-ansiBlue
terminal-ansiMagenta terminal-ansiCyan         terminal-ansiWhite
```

用于 Bash 工具输出的 ANSI 着色。本项目终端模式已有 xterm 调色板，
但 Claude 工具卡的输出是**静态 HTML 而非 xterm 实例**，需要独立的 ANSI→CSS 映射。

## 其余分类（共 258 个）

完整清单已导出，按前缀归类如下，实现时逐组映射：

- `button-*`（4）：主/次按钮，审批卡用
- `editorWidget-*` / `editorHoverWidget-*`：悬浮与弹层
- `inputValidation-*`：输入校验提示
- `scrollbarSlider-*`（3）：滚动条滑块三态
- `sash-*`（2）：分隔条，含 `hover-size`
- `editorLineNumber-*`、`editorWhitespace-*`、`editorCodeLens-*`：代码区辅助
- `sideBar-*`、`badge-*`、`banner-*`、`actionBar-*`：外围控件
- `errorForeground`、`descriptionForeground`、`disabledForeground`：状态文字

## 验收要求

- 两主题（浅/深）下逐 token 核对，不混合平均
- `chat-font-size` / `chat-font-family` 的回退值须显式断言，防止排版漂移
- Diff 三组语义（line/text/gutter）各自有独立断言
- `--claude-*` 与 `--codex-*` 不得相互引用或覆盖
- 作用域断言：Claude token 不泄漏到 `.session-mode` 之外，也不影响 Codex 容器

## 边界

本映射表来自官方 `index.css` 的**静态提取**，覆盖变量清单与用量。
各变量在具体组件上的**实际视觉效果**需阶段 2 的官方宿主截图校准确认；
回退值的选取在此之前是设计决策，不是对官方的测量结果。
