# 消息流渲染契约（阶段 0，2026-10-27）

来源：官方 2.1.311 反编译 + `webview/index.css`。以下数值与文案均为字面量。

## 1. 消息分组（两层）

**第一层 —— 折叠组**（`entry/chunk_Zk0.js`）：生成「Explored N」可折叠行。

`Jk0()`（`entry/chunk_Kb5.js:16`）判定单个内容块是否「可折叠」：

- `thinking` / `text` / `redacted_thinking` → 可折叠
- `tool_use` → 仅当工具名属于
  `{Read, Grep, Search, TodoWrite, Glob, ReadCoalesced}`，
  或经 `Fb5` 的读类启发式（名字含 `read`/`get`/`list`/`search`/`fetch`）
- `tool_result` → 除 `is_error` 外可折叠

连续 ≥2 条可折叠消息、且工具调用总数 >1 时合并为一个折叠组，
由 `L81`（`entry/chunk_$k0.js:6`）渲染为 `Explored {N}`，
class 为 `collapsibleToolCallsHeader` + 复用 `timelineMessage dotSuccess`。

**第二层 —— 轮次**（`$4.js:5448` 的 `xX1`）：以每条「真实用户消息」为起点，
到下一条之前为一轮，包在 `<div class={x0.turn}>` 里。

`ll()`（`$4.js:5476`）判定「真实用户轮起点」，排除：非 user、空/合成消息、
子 Agent（有 `parentToolUseId`）、已折叠进轮次的、仅含 IDE 诊断的。

消息 key 由 `cl()`（`$4.js:5381`）生成：取 tool-use id / betaMessageId+blockIndex / uuid，
重复时加 `#2`、`#3` 后缀。

## 2. 用户 vs 助手消息

**助手**（`eI1`，`entry/chunk_kh0.js:2124`）：

```
<div data-testid="assistant-message" role="article"
     data-transcript-message data-bookmark-uuid={uuid}
     class="{message} {timelineMessage} {dot状态}">
```

`timelineMessage` 提供左侧时间轴：`:before` 是 7×7px 圆点（`left:9px`），
颜色取 `dotSuccess`(#74c991) / `dotFailure`(#c74e39) / `dotWarning`(#e1c08d) /
`dotProgress`（闪烁）；`:after` 是 1px 竖线（`left:12px`）连接相邻
`.timelineMessage`。正文 `padding-left:30px`。

**用户**（`Ch0`，`entry/chunk_kh0.js:2233`）：

```
<div data-transcript-message role="article" class="{message} {userMessageContainer}">
  <div class={userMessage}> … </div>
```

CSS：`white-space:pre-wrap; border:1px solid var(--app-input-border);
border-radius:var(--corner-radius-medium);
background-color:var(--app-input-background);
display:inline-block; max-width:100%; padding:4px 6px`

即**左对齐的输入框同色气泡**，不是右对齐聊天气泡。
在正常滚动态（容器带 `stickyMode`）下改为 `display:block; width:100%`、
气泡 `max-width:none`——视觉上满宽但保留边框底色。

斜杠命令消息走 `slashCommandMessage`（等宽、0.9em），不用气泡。

## 3. Thinking 块

由 `hP()`（`entry/chunk_V_0.js:32`）解码 `signature` 判定是否为
「narration」签名，分两条路径：

**narration**（`K_0`，`entry.js:3249`）：单个 `narrationSummary` div，
内容直出；`narrationHint` 为 `summary`/`summarized` 时追加
`` · summary`` / `` · summarized``（`hidden` 则不加）。无折叠、无 toggle。

**普通**（`O_0`，`entry/chunk_O_0.js`，CSS 前缀 `thinking_aHyQPQ`）：

- 文本为空 → 静态不可折叠行，`thinkingSummary thinkingStatic`，
  CSS `cursor:default`，hover 时降到 0.8 透明度（而非提亮）
- 否则 → 原生 `<details open={expanded}>`：
  `<summary class={thinkingSummary}>{标签}{token数}{chevron}</summary>`
  `<div class={thinkingContent}>{markdown}</div>`
  chevron 展开时加 `thinkingToggleOpen`（旋转 90°，0.15s）
- 标签：流式中 `Thinking...`；有时长 `Thought for {N}s`；否则 `Thinking`
- 流式中若有 token 估算，追加 `<span class={thinkingTokenCount}> · {N}</span>`
- 内容经 `w3({ content, streaming: 流式中 ? "allText" : undefined })`
- 展开态由调用方持有：**一次 toggle 展开/收起该消息的所有 thinking 块**

### `redacted_thinking` 的官方异常（我已独立复核）

`SL`（`entry/chunk_SL.js`）的内容分派只有
`text` / `image` / `document` / `tool_use` / `tool_result` / `fallback` / `thinking`
七个分支，**没有 `redacted_thinking`**，因此落到末尾兜底：

```
<div class={unknownContent}>Unsupported content type: <code>redacted_thinking</code></div>
```

我逐一核了全部 6 处 `redacted_thinking` 引用（`$4.js:5766` 分组判定、
`$4.js:7625` 流式 delta 丢弃、`$4.js:8699` 的 `ir0` 空消息回溯判定、
`chunk_Kb5.js:17` 可折叠判定、`chunk_iE1.js:36` 聚合、
`chunk_VT0.js:30` 状态标签），**没有任何一处在渲染前剥离或转换它**。

判断：这是官方的遗留/死路径，不是设计意图。
**本项目不复刻此行为**，应正常渲染为「已折叠的安全省略思考」。
此处明确偏离官方，记入偏离清单。

## 4. 流式

**正文**（`SL` 的 text 分支）：
`w3({ content, streaming: isPartial ? "settledBlocks" : undefined })`

`settledBlocks`（`Z_0`，`chunk_Z_0.js`）经 `g_1` 把文本截到**最后一个
完整块**（在最后空行处切，回退尾部换行），只解析已「落定」的前缀——
未完成段落/代码围栏增长时不反复重解析，避免闪烁。完成后传 `undefined`，整体解析一次。

**无光标、无 shimmer**：我方已复核 `w3`/`chunk_G_0.js` 及其 CSS，
未发现正文光标或微光动画。`index.css` 里唯一的 `blink` 动画
（`blink_fL49mQ`）用于时间轴的 `dotProgress` 圆点，不是文本光标。

**Spinner**（`N81`/`uE1`，`entry.js:5661`，位于 `x0.spinnerRow`）：

等宽字形在 `["·","✢","*","✶","✻","✽"]` 及其逆序间循环（12 帧），
每 120ms 一帧；`prefers-reduced-motion` 或设置开启时固定为 `✻`。

旁边的动词带「解码」式随机字符渐显效果（`Gb5`，用 `.`/`_` 占位，
每字约 40ms 帧动画），结尾 `...`。

默认动词表 `SE1`（`entry.js:5760`，约 80 个）：

```
Accomplishing, Actioning, Actualizing, Baking, Booping, Brewing,
Calculating, Cerebrating, Channeling, Churning, Clauding, Coalescing,
Cogitating, Computing, Combobulating, Concocting, Considering,
Contemplating, Cooking, Crafting, Creating, Crunching, Deciphering,
Deliberating, Determining, Discombobulating, Doing, Effecting,
Elucidating, Enchanting, Envisioning, Finagling, Flibbertigibbeting,
Forging, Forming, Frolicking, Generating, Germinating, Hatching,
Herding, Honking, Ideating, Imagining, Incubating, Inferring,
Manifesting, Marinating, Meandering, Moseying, Mulling, Mustering,
Noodling, Percolating, Perusing, Philosophizing, Pontificating,
Pondering, Processing, Puttering, Puzzling, Reticulating, Ruminating,
Schlepping, Shimmying, Simmering, Smooshing, Spelunking, Spinning,
Stewing, Sussing, Synthesizing, Thinking, Tinkering, Transmuting,
Unfurling, Unraveling, Vibing, Wandering, Whirring, Wibbling,
Working, Wrangling
```

随机取一个（`M81`），在 2s/3s/5s 后重roll，之后每 5s（`pE1`，`entry.js:5669`）。
`claudeCode.spinnerVerbs` 设置形如 `{mode:"append"|"replace", verbs:[]}`。

特例覆盖：`Compacting`（compacting 态）、`Running start-up hooks`、
`Running UserPromptSubmit hooks`。

字形颜色按 `data-permission-mode`：常规 `--app-spinner-foreground`，
`acceptEdits` 用主前景色，`plan` 用 `--app-plan-mode-color`，
`bypassPermissions`/`auto` 用 `--app-error-foreground`。

## 5. 消息操作条

仅**助手**消息有（`entry/chunk_kh0.js:2182`），门控条件：

```js
hasTextBlock && !readOnly && status !== "progress" && VE1(message)
```

`VE1`（`entry.js:4776`）要求：assistant、非 loop 合成、非 synthetic、
无 `parentToolUseId`/`sdkParentToolUseId`、且无 `isPartial` 块。

**注意：没有「仅最新一轮」的条件**——每条已完成的真实助手消息都有操作条。

`<div class={assistantActions} data-message-actions>` 内含：

1. 复制（`Xk`，label `Copy response`）
2. 书签（`Lh0`，需有 uuid 且宿主支持，title 在
   `Bookmark response` / `Remove bookmark` 间切换）
3. 评分（`WC0`，见 §7）

CSS：`assistantActions{display:flex;gap:2px;height:16px}`，
**悬停才显形**：`[data-testid=assistant-message]:hover .copyResponseButton{opacity:1}`。
书签按钮我方仅查到 `opacity:0` 默认与 `.bookmarked{opacity:1}`，
未匹配到其 hover 规则——此点标为未确认。

## 6. 时间戳

`jb1`（`entry/chunk_Pb1.js:62`），受 `claudeCode.showMessageTimestamps`
（默认 **true**）与 `mT1()` 门控。

```
<div class={line} data-message-stamp><time dateTime={ISO}>{短标签}</time></div>
```

- 短标签：`en-US`，`{hour:"numeric", minute:"2-digit", hourCycle:"h12"}`
  → 形如 `3:45 PM`
- hover 弹出完整时间：`YYYY-MM-DD HH:mm:ss[ AM/PM][ TZ]`，
  UTC 预设时带尾随 `Z`
- **日期分隔线**：`AX()`/`mT0`（`chunk_kh0.js:1416`）按本地日历日变化插入
  `tI1`（`chunk_XF.js`），居中标签两侧为波浪线（SVG mask），
  文案形如 `Mon, Jan 5`，跨年则带年份
- 位置：助手消息 `placement="response"`（`position:absolute; top:6px; right:0`）；
  用户消息 `placement="prompt"`（上方 flex 行，右对齐）
- 带时间戳的 timeline 消息额外加顶部内边距：
  `timelineMessage:has(>[data-message-stamp]){--message-padding-top:24px}`

## 7. 评分

`WC0`（`entry/chunk_UY.js:19`），`<div data-message-rating>`。

**实验门控**：仅当 `experimentGates.tengu_vellum_siding === true`
且未禁用 analytics / product feedback 时渲染，否则整体 `null`。

两个 `<button class={thumb}>`，`aria-label`/`title` 为
`Good response` / `Bad response`，带 `aria-pressed`。
点击调 `session.rateMessage(uuid, "positive"|"negative", {...})`，
再点同一个则清除。负评时若未禁用反馈则展开内联表单。

提示语在 `Learn how we use your feedback` 与
`Thanks for your feedback · Learn how we use it` 间切换。
同样悬停才显形（`container{opacity:0}` → `:focus-within`/`.rated`/父级 hover 时 1）。

## 8. 结果 / 错误 / 中断 / 限流

**不是统一的卡**，四种机制各自独立：

- **中断**：内容块文本恰为 `[Request interrupted by user]` 或
  `[Request interrupted by user for tool use]` 时，由 `X3()`（`$4.js:4367`）
  经 `rj` 映射为 `Interrupted` / `Tool interrupted`，渲染为
  `<div class={interruptedMessage}>`，CSS 为次要前景色 + 全宽 + **斜体**，
  无卡片外框、无图标
- **会话加载错误**：`af0`（`entry/chunk_Ub1.js`）是**整条转录上方的横幅**
  （`errorBanner`），含 `Retry` / `Start a new conversation` /
  `View output logs` 链接与 `×` 关闭，不是每消息卡
- **压缩提示**：`wb0`（`entry/chunk_dL.js:48`）内联可折叠 `<details>`，
  摘要 `Compacted chat · {manual|auto} · {N}k tokens freed`，
  展开为摘要正文或兜底文案
  `Conversation was compacted to free up context.`
- **限流**：**不在转录内**，是 composer 底部的可关闭横幅
  （`entry/chunk_Zq.js:1282`），文案由 `mr1()`/`de0()` 生成，形如
  `Usage limit reached · wrapping up`、
  `Usage limit reached · {type} resets {date}`、
  `You've hit your {limit}`、`Approaching {limit} · resets {date}`、
  `You've used {N}% of your {limit}`

**未发现转录内的「轮次最终结果卡」**（token/耗时/成本汇总）。
已完成的信号只有时间轴圆点颜色 + 操作条出现。

## 9. `messageGradient`

```css
.messageGradient{position:absolute;
  background:linear-gradient(to bottom, transparent 0%, var(--app-primary-background) 100%);
  pointer-events:none;z-index:2;height:150px;bottom:0;left:0;right:0}
.messageGradient.fullEditor{background:linear-gradient(to bottom, transparent 0%, var(--app-secondary-background) 100%)}
```

即滚动区**底部** 150px 的渐隐遮罩，使正文不在 composer 上方被硬切。
仅在全编辑器布局下渲染（`chunk_kh0.js:1703`）。**无顶部渐变。**

## 偏离官方的决定（需记录在案）

| 项 | 官方行为 | 本项目 | 理由 |
| --- | --- | --- | --- |
| `redacted_thinking` | 渲染为 `Unsupported content type: redacted_thinking` | 渲染为已折叠的安全省略思考 | 官方此路径为遗留缺陷，复刻无意义 |
