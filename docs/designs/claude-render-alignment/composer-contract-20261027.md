# Composer 渲染契约（阶段 0，2026-10-27）

来源：官方 2.1.311 反编译（`entry/chunk_Zq.js` 主体 `ey0`、
`entry/chunk_by0.js` 页脚、`entry/chunk_i7.js` 模式选择器）+ `webview/index.css`。

## 1. DOM 结构

```
<Fragment>
  {菜单开启时} <div class={scrim}>                    // position:fixed;inset:0
  <div class={inputWrapper}>                          // width:100%;max-width:680px;margin:0 auto
    [错误 / 设置警告 / 限流 / 通知 / MCP 状态 横幅]
    <form onSubmit>
      <fieldset class={inputContainer}
                data-permission-mode={mode}
                data-spark={fastMode}        (可选)
                data-recording="true">       (听写中)
        <legend class={sparkLegend}>…</legend>
        <div class={inputContainerBackground} />
        [斜杠命令popup / 输出风格popup / @提及popup / 其他popup]
        [附件区（上方，当 AW 开启）]
        <div class={messageInputContainer}>
          <div contentEditable="plaintext-only" class={messageInput}
               role="textbox" aria-label="Message input"
               aria-multiline="true" data-placeholder={…} />
          <div class={mentionMirror} aria-hidden="true"> … </div>
          [麦克风按钮]
        </div>
        [附件区（下方，默认）]
        <by0 />                                       // 页脚工具条
      </fieldset>
    </form>
  </div>
</Fragment>
```

关键几何（`index.css` 字面量）：

```css
.inputWrapper{width:100%;max-width:680px;margin:0 auto}
.inputContainer{background:var(--app-input-secondary-background);
  border:1px solid var(--app-input-border);
  border-radius:var(--corner-radius-large);
  color:var(--app-input-foreground);
  display:flex;flex-direction:column;
  box-shadow:0 1px 2px #0000001a}
.messageInputContainer{position:relative;display:flex}
.inputFooter{display:flex;color:var(--app-secondary-foreground);
  border-top:.5px solid var(--app-input-border);
  z-index:6;align-items:center;gap:6px;padding:5px}
```

`data-permission-mode` 驱动焦点环颜色：`acceptEdits` → `--app-primary-foreground`；
`plan` → `var(--vscode-focusBorder, …)`；`bypassPermissions`/`auto` → `--app-error-foreground`。

## 2. 可编辑区：双层结构（重要）

**不是 `<textarea>`，不是富文本编辑器**，而是
`contentEditable="plaintext-only"`（`chunk_Zq.js:1554`）。

无障碍：`role="textbox"`、`aria-label="Message input"`、`aria-multiline="true"`，
外加 combobox 连线 `aria-autocomplete="list"` 与
`aria-controls`/`aria-activedescendant` 指向当前打开的 popup listbox
（`command-menu-list` / `output-style-list` / `at-mention-list`）。

占位符不是原生 `placeholder`（contenteditable 没有），而是
`data-placeholder` + CSS：

```css
.messageInput:empty:before{content:attr(data-placeholder);
  color:var(--app-input-placeholder-foreground)}
```

**双层技巧**：真实可编辑层文字透明、只留光标
（`color:#0000; caret-color:var(--app-input-foreground)`），
上方叠一个 `mentionMirror` 层（`inset:0`，相同 `padding:10px 36px 10px 14px`，
`aria-hidden`）渲染高亮版本——提及 chip、拼写错误下划线、
听写临时文字、参数提示——并与真实层滚动同步（`j5`，`chunk_Zq.js:332`）。

对齐时这一层必须照做，否则 chip 效果无法实现。

## 3. 发送与停止

单个 `<button type="submit" class={sendButton} data-permission-mode={mode}>`：

- `session.busy && !canSendMessage` → 停止图标，`aria-label="Stop"`，
  `onClick` 为 `preventDefault(); session.interrupt()`
- 否则 → 发送图标，`aria-label="Send message"`，正常提交
- CSS：`.sendButton{border-radius:5px;margin-left:2px;
  color:var(--app-claude-ivory);
  background-color:var(--app-claude-clay-button-orange)}`

**Enter 语义**（`chunk_Zq.js:885`，逐字）：

```js
let k1 = e.metaKey || e.ctrlKey;
if (context.useCtrlEnterToSend ? k1 : true) {
  e.preventDefault(); submit();
} else if (!SP) {
  e.preventDefault(); insert("\n");
}
```

即：开关**开**时仅 Ctrl/Cmd+Enter 发送、裸 Enter 换行；
开关**关**（默认）时裸 Enter 发送、Shift+Enter 换行。
`Shift+Tab` 循环权限模式；裸 `Tab` 接受内联建议。

这正好对应 §功能缺口 的 `useCtrlEnterToSend` 一项。

## 4. 附件

**添加路径**：

- **粘贴**（`chunk_Zq.js:917`）：读 `clipboardData.items` 提文件；
  无文件则走纯文本路径并剥离不可见字符
- **选择器**（`chunk_Zq.js:1693`）：临时创建隐藏
  `<input type="file" multiple>` 并 `.click()`
- **拖放**（`chunk_kh0.js:636`）：读 `dataTransfer.files`，过 MIME 白名单；
  不支持类型的完整提示文案为
  `` Unsupported file type{s}: {names}. Supported types: images (PNG, JPG, GIF, WebP), text files, and PDFs. To reference unsupported files, please include its absolute file path in your prompt (using @ for paths inside your working directory, and entering the path for files outside). ``
  另外会遍历 `dataTransfer.items` 的文件系统条目，对那类**插入 @ 提及
  而非附加二进制**

**预览**：`A41` 药丸（`Od.js:29367`）显示图标或缩略图 + 文件名，
图片额外显示原始像素尺寸。几何：
`.pill{border-radius:4px;max-width:180px;height:24px}`。
点击图片药丸开灯箱（Portal），Esc 或点外关闭。

**移除**：每个药丸的 `×` 按钮，默认 `opacity:0`，hover/focus 时为 1。

## 5. `@` 提及文件

**触发**：`SC0()`（`entry/chunk_SC0.js:4`）对光标前文本跑
`/(?:^|\s)@[^\s]*/gm`，返回 `{query, start}`。

**菜单**：`jv0`（`entry/chunk_Jm.js:11`），listbox id `at-mention-list`。
200ms 防抖调 `onListFiles(query)`；行为 `role="option"`；
上下键循环导航；Tab 或 Enter 选中；Esc 关闭。
空态文案 `No files found`，`browser:` 前缀查询时为 `No browser tabs found`。
行区分 文件/终端/浏览器标签/目录 四种图标并带目录路径提示。

**插入形式（关键）**：`onFileSelect`（`chunk_Zq.js:972`）经
`q71(path, type)` 生成 `@path` 或 `@"带空格的路径"`，
**以纯文本写入 contenteditable**（`textContent = newText`），
**不是持久化的 DOM chip**。

chip 外观纯靠 mirror 层：mirror 重扫文本，用正则 `A_0` 匹配
已插入的提及串（记在 Set `n5` 中），在**镜像层**包
`<span class={inputMentionChip}>`：

```css
.inputMentionChip{display:inline;
  background-color:var(--app-mention-chip-background);
  border-radius:3px}
```

## 6. 斜杠命令

**触发**：同一 `SC0()` hook，正则 `/(?:^|\s)\/[^\s/]*/gm`。

**菜单**：`av0`（`entry/chunk_eL.js:65`），listbox id `command-menu-list`。
由共享 `commandRegistry` 驱动——斜杠命令与通用动作面板
（如 `Account & usage…`、`Switch model…`）**是同一个列表**，按 section 分组。
通过工具条 `/` 按钮打开时无过滤输入框；由正文 `/query` 驱动时按文本过滤。
页脚有 `Report a problem` 按钮与版本号 `v2.1.311`。

**应用**：`onCommandSelect`（`chunk_Zq.js:1001`）对标记 `keepMenuOpen`
的命令执行但不关菜单；对真实斜杠文本命令则替换匹配文本为命令标签、
重定位光标；否则清掉斜杠 token 再执行。

## 7. 模式与模型选择器

页脚行顺序（`chunk_by0.js:219`）：
附件/提及/浏览器图标组 → 命令菜单 `/` → 上下文用量计 → 未读指示 →
远控指示（条件）→ agent map（条件）→ **模型药丸**（`data-fit-stage===2`
时移到独立行）→ 模型选择 popup → 选区 chip（有选区时）→ 占位 →
**权限模式选择器**（右对齐）→ 发送/停止。

**权限模式**（`entry/chunk_i7.js:91`）逐字文案：

| 值 | 标签 | 描述 |
| --- | --- | --- |
| `dontAsk` | `Don't ask` | `Claude will deny actions that need approval instead of asking` |
| `default` | `Manual` | `Claude will ask for approval before making each edit` |
| `acceptEdits` | `Edit automatically` | `Claude will edit your selected text or the whole file` |
| `plan` | `Plan` | `Claude will explore the code and present a plan before editing` |
| `auto` | `Auto` | `Claude will approve actions that pass a safety check and pause for anything risky` |
| `bypassPermissions` | `Bypass permissions` | `Claude will not ask for approval before running potentially dangerous commands` |

**需更正方案 §5 的假设**：插件 manifest 的 `initialPermissionMode` 枚举是
`default|manual|acceptEdits|plan|bypassPermissions`，但 webview 实际模式值里
**没有 `manual`**——`Manual` 只是 `default` 的**显示标签**；
且多出 `dontAsk` 与 `auto` 两个模式。

运行时可用子集由 `g0()`（`chunk_Zq.js:775`）计算：
基础 `["default","acceptEdits","plan"]`；当前已在 `dontAsk` 则前插；
`autoModeAvailability` 允许则追加 `auto`；配置允许则追加 `bypassPermissions`。
`Shift+Tab` 严格按此计算列表循环。

选择器右对齐于发送键旁，含 effort 子行，模型支持时还有 ultracode 开关。

## 8. composer 上方

两个**不同**区域：

- **A. 组件内横幅**（`chunk_Zq.js:1347`，在同一 `inputWrapper` 内、
  fieldset 之上）：错误、设置错误、排队消息指示、限流/用量、通用通知、
  MCP 集成状态（Chrome / debugger / Jupyter / 远控错误）、反馈调查、
  回退终端提示、提交钩子运行中指示。**全部手写。**
- **B. engine surface 的 `AbovePrompt` 带**：`data-engine-surface="above-prompt"`
  （`entry/chunk_sb5.js:223`），在整个 composer form 之上，
  含 toast、内联 pane 宿主、mod 绘制区、status line。
  **按已决策不做**（见 engine surface 文档）。

本项目的队列/发送目标条属于 A 类语义，用官方设计语言包装即可。

## 9. 占位符文案（逐字）

`U6`（`chunk_Zq.js:483`）按优先级：

1. 有内联建议 → 建议文本本身
2. `session.busy` → `Queue another message…`
3. 有编辑器选区且非移动端 → `{快捷键} to attach selected text`，
   快捷键为 `⌘ Esc`（Mac）或 `ctrl esc`
4. `!l5`（焦点态标志）→ `Ask Claude to edit…`
5. 兜底 → `{快捷键} to focus or unfocus Claude`

即最常见基线是 `Ask Claude to edit…` 或
`⌘ Esc to focus or unfocus Claude`，忙时切 `Queue another message…`。

## 需同步更正方案的两处

1. **权限模式集合**：实际 6 个值（含 `dontAsk`、`auto`），
   `manual` 非模式值而是 `default` 的标签。方案 §5 引用 manifest 枚举，
   应以 webview 实际值为准。
2. **`useCtrlEnterToSend`** 的确切语义已取得（见 §3），
   可直接实现与断言。
