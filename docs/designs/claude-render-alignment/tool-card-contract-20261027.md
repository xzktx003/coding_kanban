# 工具卡渲染契约（阶段 0，2026-10-27）

来源：`/tmp/claude-webview-recovered-keep/entry/chunk_z4.js` 等，官方 2.1.311 反编译。
以下为**字面量**，非推测。

## 1. 基类 `z4` 的契约

每个工具卡是一个类，继承 `z4`，可覆写：

| 成员 | 签名 | 默认行为 |
| --- | --- | --- |
| `name` | 字段 | 工具名，注册表按它匹配 |
| `hidden` | 字段 | `false`；为 `true` 则整卡不渲染 |
| `header(ctx, input)` | 方法 | `<Fragment><span class={toolNameText}>{name}</span></Fragment>` |
| `body(ctx, input, result, …)` | 方法 | 见下方默认 body |
| `renderInput(ctx, input)` | 方法 | IN 行 |
| `renderOutput(ctx, result, input)` | 方法 | OUT 行 |
| `permissionRequest(ctx, input, onInputChange)` | 方法 | `null`（无自定义审批卡） |
| `toolDescription(input)` | 方法 | `undefined` |
| `toOutputContent(block)` | 方法 | 把内容块转纯文本，见下 |

### 默认 `body`

```
<Fragment>
  {toolDescription(input) && <O6>{description}</O6>}
  {(IN || OUT) && (
    <div class={toolBody}>
      <div class={toolBodyGrid}>{IN}{OUT}</div>
    </div>
  )}
</Fragment>
```

### 默认 IN / OUT 行

```
<div class={toolBodyRow}>
  <div class={toolBodyRowLabel}>IN</div>     ← 字面量 "IN" / "OUT"
  <div class={toolBodyRowContent} {...GW(openInEditor, zW)}>
    <pre>{JSON.stringify(input, null, 2)}</pre>
  </div>
</div>
```

IN 行仅在 `input` 有键时渲染；OUT 行仅在 `result` 有键时渲染。

### `toOutputContent` 的类型处理（完整）

- `text` → `.text`
- `tool_result` → `content` 为字符串则直接用；为数组则递归并以 `\n` 连接
- 其余一律返回 `""`：`image`、`tool_use`、`server_tool_use`、
  `web_search_tool_result`、`web_fetch_tool_result`、`code_execution_tool_result`、
  `bash_code_execution_tool_result`、`text_editor_code_execution_tool_result`、
  `tool_search_tool_result`、`container_upload`、`tool_reference`、`document`、
  `thinking`、`redacted_thinking`、`search_result`

## 2. 共享基元（必须先实现）

### `Qk(text)` —— 「内容过大」判定

`entry.js:3315`：

```js
text.length > 250 || text.split("\n").length > 3
```

超过即把内容变成可点击，点击后调用
`ctx.fileOpener.openContent(text, "<name> tool input|output", false)`
在编辑器标签页打开全文。

### `zW` —— 无障碍提示文案

`entry.js:3314`，字面量：

```
Press Enter to open the full text in an editor tab
```

### `GW(onActivate, hint)` —— 可点击区域的交互语义

`entry/chunk_L_0.js`。返回 `tabIndex: 0`、`cursor: pointer`，以及：

- **click**：若点击目标 `closest('button, [role="button"], a[href]')` 命中了
  一个**不是自己**的内部可交互元素，则**不触发**。防止点内部按钮时误触发外层。
- **keydown**：仅当 `e.target === e.currentTarget`；`Enter` 或 `Space`
  触发并 `preventDefault()`；**`e.repeat` 为真时不触发**（长按不连发）。

这三条是容易漏掉的真实行为，必须逐条断言。

### `Yk(onClick, …)` —— 更轻的可点击包装

`onClick` 为空时返回 `{}`；否则加 `role: "button"` 等。

### `O6({ children, onClick, expanded })` —— 次要信息行

```
<div class={secondaryLine} aria-expanded={expanded} {...Yk(onClick)}>
  <span class={content}>{children}</span>
</div>
```

用于描述行、错误/拒绝原因行。`aria-expanded` 由调用方决定。

### `uP(result)` —— 拒绝原因提取

`entry/chunk_uP.js`。仅当 `result.is_error` 且 `content` 为字符串、
且**不**含 `<tool_use_error>`、**不**等于 `lK`、且以 `pP` 开头时，
去掉 `pP` 前缀后返回。否则 `undefined`。

即：工具内部错误与「用户拒绝」是两类，渲染要分开。

## 3. 注册表与 dispatch

`entry/chunk_a_0.js` 的 `Oz(toolName, ctx)`：

1. 23 个实例按**固定顺序**构造；部分需注入 `ctx.fileOpener`
   （`zT1`/`zu`/`Qu`/`Yu`/`XT1`/`P71`/`DT1`）
2. `toolName === "Task"` → 改写为 `"Agent"`
3. 按 `name` 精确匹配
4. 未命中且 `y_0(name)`（前缀 `mcp__claude-in-chrome__`）→ `ZT1`
5. 未命中且 `Gu(name)`（`entry.js:3612`：`name.startsWith("mcp__")`）→ `WT1`
6. 仍未命中 → `j71`（未知工具兜底）

`Gu` 的实现是单行前缀判断，已逐字确认。

## 4. 已逐字取证的具体卡

### `Bash`（`entry/chunk_e_1.js:38`，类 `Zu`）

- `commandLabel = "bash"`
- header：`toolNameText` 为 `Bash `（含尾随空格），后接
  `toolNameTextSecondaryPlaintext` 显示 `input.description`（有才显示）
- body 覆写：先 `uP(result)` 取拒绝原因，有则渲染 `O6` 且**不渲染 OUT**
- IN 行覆写：加 `Ju.inputRow`，`<pre>{input.command}</pre>`，
  并在行尾挂一个复制按钮 `Xk`（`className: Ju.copyButton`），
  `getText: () => input.command ?? ""`
- OUT 走基类，但 result 先过 `Bd(...)`
- **审批卡**：header 文案 `Allow this {commandLabel} command?`，
  命令体 `contentEditable: true`、`role="textbox"`、`aria-multiline="true"`、
  `spellCheck: false`，**用户可就地编辑命令**，`onInput` 回写
  `onInputChange({...input, command})`；`input.description` 存在时
  渲染为 `permissionRequestDescription` 并通过 `aria-describedby` 关联

PowerShell 卡应是同一基类换 `commandLabel`（待确认，见下）。

### `Read` / `Edit` / `Write`（`entry/chunk_u_0.js`，经 `xL`）

`xL.fileToolHeader(name, filePath, openOptions?)` 是共享 header：
文件名取 basename，包在 `toolNameTextSecondary` 里做成可点链接（`v8` 组件，
`<a href="#">` + `preventDefault`/`stopPropagation`），点击调
`opener.open(filePath, openOptions)`。无 `file_path` 时渲染字面量 `` file``。

- **`Read`（`zT1`）**：header 自己写而非用 `fileToolHeader`，因为要带行区间。
  `startLine = offset ? offset+1 : 1`，`endLine = limit ? startLine+limit-1 : undefined`
  仅用于打开文件；显示后缀为 `` (lines {a}-{b})``（offset+limit 都有）或
  `` (from line {a})``（仅 offset），该后缀是**无 class 的裸 `<span>`**。
  **`body` 返回 `null`——Read 卡只有 header 一行，没有任何 body。**
  审批卡文案：`Allow reading from {basename}?`
- **`Edit`（`Qu`）**：header 用 `fileToolHeader` 并传
  `{ searchText: input.new_string }`，点击时定位到新内容。
  body 全覆写：先一行 `O6` 摘要，文案由行数差生成——
  `Added N lines, removed M lines` / `Added N line(s)` / `Removed M line(s)` /
  `Modified`，错误时 `Edit failed`；其后若 `uP(result)` 有拒绝原因再加一行 `O6`；
  最后渲染 diff（`p_0`，即 §Diff 文档所述 Monaco 组件）。
  审批卡文案：`Make this edit to {basename}?`
- **`Write`（`zu`）**：header 继承 `xL` 不覆写。body 全覆写：
  `O6` 摘要为 `{N} line(s)`（内容为字符串时）/ `Write succeeded` / `Write failed`；
  正文为 `<pre>` 原文，挂 `GW` 可点开全文（受 `Qk` 门控）。
  审批卡文案：`Allow write to {basename}?`

### `Glob` / `Grep`（`entry/chunk_u_0.js`，直接继承 `z4`）

两者 header 外层是 `<div>` 而非 Fragment。

- **`Glob`（`GT1`）**：header `toolNameText` 为 `Glob`，紧跟
  `toolNameTextSecondary` 显示 `pattern: "{input.pattern}"`（两 span 间无空格）。
  body：无 result 时 `null`；否则只渲染**一行 `O6`**，文案
  `No files found` / `Found 1 file` / `Found {N} files`。
  行数统计会把输出等于 `No files found` 的情况计为 0。
  点击打开全文，标题 `Glob output`，**不受 `Qk` 门控**（只要非空就可点）。
  审批卡：`Allow glob search in {path}?`，无 path 时 `Allow this glob command`（无问号）。
- **`Grep`（`qT1`）**：header `Grep` + 空格 + `toolNameTextSecondary` 显示
  `"{pattern}"`，若有 `path`/`glob`/`type` 则追加 `` ({qualifiers})``，
  各段形如 `in {path}`、`glob: {glob}`、`type: {type}`，以 `, ` 连接。
  body 同 Glob 形状，文案 `No matches found` / `1 line of output` /
  `{N} lines of output`，打开标题 `Grep output`。
  审批卡：`Allow grep in {path}?` / `Allow this grep command`。

### `Agent`（`entry/chunk_hw5_2.js:140`，类 `PT1`）

注册表把 `Task` 映射到这里，所以**所有子 Agent 调用由它渲染**。

- header：`<div>` + `toolNameText` 字面量 `Agent:` + `toolNameTextSecondary`
  显示 `input.description`
- `renderInput`：`input.prompt` 为空则 `null`；否则标准 IN 行，
  `<pre>{prompt}</pre>`，挂 `GW` 打开标题 `Agent tool input`
- **`renderOutput` 返回 `null`——卡本身不渲染子 Agent 的输出**
- 子 Agent 的实时进度**不在这个卡里**，而是折叠块外的独立行
  （`entry/chunk_Xb1.js`、`chunk_kh0.js`）：每行显示
  `{description}: {summary 或最近工具}`，右侧为
  `{tokens} tokens · {N} tools · {耗时}`；最多显示 3 行
  （常量 `DE1 = 3`），溢出合并为一行 `+{N} more agent(s)`，
  其统计为溢出项合计。`data-testid` 分别是
  `focus-subagent-row` / `focus-subagent-overflow-row`

### `Skill`（`entry/chunk_hw5_2.js:80`，类 `AT1`）

- header：`toolNameText` 显示去掉前导 `/` 的技能名，紧跟
  `toolNameTextSecondary` 字面量 `` skill``（带前导空格）
- **`body` 返回 `null`**——只有 header 一行
- 审批卡：header `Use skill /{name}?`（`/name` 包在 `permissionPath` 里），
  固定附注字面量 `Claude may use instructions, code, or files from this skill.`
  （class `skillNote`），另可显示该命令的描述，以及
  `Arguments: {input.args}`（有 args 时）

### `SendUserFile`（`entry/chunk_hw5_2.js:23`，类 `DT1`）

- header：`toolNameText` 为 `Sent `，随后逐个文件；Windows/UNC/WSL 路径
  （`j61` 判定）显示原文不可点，其余显示 basename 可点
  （`opener.open(path)`）；多文件以 `, ` 分隔
- `renderInput` 恒为 `null`
- `renderOutput`：**正常情况返回 `null`**；仅当 `is_error` 或输出匹配
  `/\bNOT\b.*\bdelivered\b|reached only one of its viewers/` 时才落到基类 OUT
- `toolDescription`：`input.caption`（非空字符串时）

### `TaskOutput`（`entry/chunk_e_1.js:10`，类 `e_1`）

- header：`toolNameText` + 空格 + `toolNameTextSecondary` 显示
  `task: "{input.task_id}"`（有 `task_id` 才显示）
- `renderInput` 返回 `null`（不显示 IN）
- OUT 走基类，result 先过 `Bd(...)`

### 文件类中间基类 `xL`（`entry/chunk_u_0.js:13`）

`Edit` / `Read` / `Write` 继承它，常量已解析：
`GR = "Edit"`、`lj = "Read"`、`qR = "Write"`（`o$1.js`）。
各自覆写 header / body / permissionRequest，细节由并行取证补全。

### `WebFetch`（`entry/chunk_MT1.js:82`，类 `OT1`）

- header：`<div>` + `toolNameText` 字面量 `Web Fetch` + `toolNameTextSecondary`；
  URL 经 `IQ()` 校验（仅允许 `http:`/`https:`）通过则渲染
  `<a target="_blank" rel="noopener noreferrer">`，否则纯文本
- `renderInput` 恒为 `null`
- `renderOutput`：有 `result.url` 且非错误时，只渲染一行
  `<div class={toolBodyPlainText}>Fetched from {result.url}</div>`——
  **不 dump 抓取到的页面内容**；否则落回基类 OUT
- 审批卡：`Allow fetching this url?` + `permissionRequestInput` 显示 URL

### `WebSearch`（`entry/chunk_MT1.js:134`，类 `LT1`）

- header：`Web Search` + `toolNameTextSecondary` 显示 `input.query`（不做链接）
- `renderInput` 恒为 `null`；`renderOutput` 走基类
- `toolDescription`：把 `Allowed: {…}` 与 `Blocked: {…}` 以 `` · `` 连接，
  两个列表都空则 `undefined`
- 审批卡：`Allow searching for this query?` + query，
  若有域名允许/屏蔽摘要再加一行

### `TodoWrite`（`entry/chunk_MT1.js:10`，类 `MT1`）

- header：`<div>` + `toolNameText` 字面量 `Update Todos`，无次要文本
- body：`input.todos` 是数组时渲染清单组件 `l_0`
  （`todoListContainer` > `todoList` > 每项 `todoItem`，完成项加 `completed`），
  每项是**禁用的原生 checkbox**：`completed` → checked，
  `in_progress` → **indeterminate**，其余不勾；后接 `content`
- 否则回落基类 body

### `ToolSearch`（`entry/chunk_MT1.js:29`，类 `NT1`）

- header：`Search tools` + `toolNameTextSecondary` 显示 `"{query ?? "…"}"`
- body：无 result → `null`；文案 `No tools found` /
  `Found 1 tool` / `Found {N} tools`
- **`hidden = true`——整卡在转录里不显示**

### `j71`（`entry/chunk_MT1.js:75`）—— 未知工具兜底

**这是对齐时最需要照做的一项**：它是一个纯空壳子类，
`constructor(name) { super(); this.name = name }`，其余全部继承 `z4`。

即未识别的工具名**原样作为标题**，body 为默认 IN/OUT 原始 JSON dump，
`permissionRequest` 为 `null`。没有「unknown tool」标签，不截断名字，
不做任何特殊化。

### MCP 工具

- **`WT1`（`entry/chunk_WT1.js:7`）** —— 通用 MCP 兜底。
  从 `mcp__server__tool` 解析：`serverName` 取 `mcp__` 后第一段，
  `toolName` 取其后全部（保留内部 `__`）。显示名经
  `HT1`：按 `_` 分词、首字母大写，再过字典
  `{Github: "GitHub", Pubmed: "PubMed", Ai: "AI"}`。
  header 为 `{humanizedServerName} [{toolName}]`，
  后接次要文本——从输入里按优先级
  `query → message → channel → repo → url → path → title → search → text`
  取第一个存在的字符串字段；`channel` 加 `#` 前缀，
  `url` 只显示 hostname（解析失败则截断 30 字符加 `…`），
  其余截断 40 字符加 `…`。
  `renderInput` 恒为 `null`（不显示原始 JSON 输入）；OUT 走基类。
- **`ZT1`（`entry/chunk_$T1.js:15`）** —— Claude in Chrome 专用，
  前缀 `mcp__claude-in-chrome__`（`y_0` 判定）。
  header 为 `Claude in Chrome [{displayName}]`，有 `tabId` 时
  附 `[Show Tab]` 链接指向 `https://clau.de/chrome/tab/{tabId}`。
  `computer` 工具走截图渲染；`find`/`gif_creator`/`read_console_messages`/
  `read_network_requests`/`read_page`/`get_page_text`/`update_plan`
  走单行状态；`javascript_tool` 回落默认 IN/OUT。

### 其余已确认卡

- **`NotebookEdit`（`P71`）**：header `Edit Notebook Cell ` +
  可点 basename（`:{cell_id}` 若有）。body 全覆写：
  一行 `O6` 状态（`Failed`/`Success`/`Pending`），
  再渲染 `<pre>{input.new_source ?? "[No content]"}</pre>`，
  且该内容框加 `toolBodyRowContent_disableClipping` 取消截断
- **`Search`（`FT1`）**：header `Search` + `pattern: "{pattern}"`；
  审批卡 `Allow searching in {path}?` / `Allow this search`
- **`SandboxNetworkAccess`（`KT1`）**：header `Network Access` + host；
  `renderInput` 为 `null`；审批卡 `Allow network connection to this host?`
- **`ReadCoalesced`（`XT1`）**：合并多文件读取，header 为 `Read ` +
  逐个可点 basename（`, ` 分隔）+ 各自行区间后缀；
  **`body` 返回 `null`**
- **`ExitPlanMode`（`Yu`）**：header `Claude’s Plan `（注意是 U+2019
  弯引号）+ 可点计划文件名；无文件时为 `Claude’s Plan` 或 `Plan Mode`。
  body：有结果且非错误 → `User approved the plan`；
  错误 → `Stayed in plan mode`；无结果 → 不渲染。
  审批卡支持**行内评论**：有评论时标题 `Continue planning`、
  描述 `{N} comment(s) will be included as feedback`；
  无评论时标题 `Accept this plan?`、描述
  `Select text in the preview to add comments`；
  每条评论可按 `×` 移除（`title="Remove comment"`）
- **`AskUserQuestion`（`t_1`）**：header `Question` / `Questions`。
  已答时渲染可折叠的只读回顾（状态文案取自
  `{noAnswer: "No answer", declined: "Declined",
  sessionEnded: "Session ended before an answer", answered: "Answered"}`）；
  `pending`/`other` 状态回落默认 IN/OUT。
  `renderInput` 恒为 `null`。
  **审批态委托给独立交互组件**：多问题导航标签、单选/多选、
  方向键循环、`Other` 自由输入（placeholder `Type your answer…`）、
  单选选中后约 300ms 自动跳下一题、带 `preview` 的选项显示预览面板
  （空预览文案 `No preview for this option`）
- **`AgentOutputTool`（`d_1`）**：**`body` 返回 `null`**，整卡无内容
- **`Artifact`（`a_1`）**：header `Artifact` + `file_path`；
  `renderInput` 为 `null`；OUT 渲染
  `{Opened|Created|Published} — <a>Open artifact ↗</a>`

## 5. 审批卡外壳（`entry/chunk_i81_2.js`）

所有工具共用的审批外壳，`permissionRequest()` 的返回值嵌在其
`permissionRequestContent` 里；返回 `null` 时外壳提供通用兜底。

按钮区（`buttonContainer`）结构与文案：

- 主按钮：默认 `Yes`；计划模式下为 `Yes, and use auto mode`
  或 `Yes, and auto-accept`（取决于模式）；问题卡为 `Submit answers`
- 次按钮（有建议且非某些态时）：计划模式下
  `Yes, and manually approve edits`，否则渲染建议/目标选择器
- 拒绝按钮：默认 `No`；计划模式下 `No, keep planning`
  或 `Send feedback and keep planning`
- 每个按钮前有数字快捷键角标（`shortcutNum`），序号随可见按钮动态计算
- 拒绝按钮旁有输入框，placeholder 字面量
  `Tell Claude what to do instead`
- 底部固定提示 `Esc to cancel`（class `keyboardHints`）
- 可折叠：`foldButton` + `folded` / `foldsToTitle`；
  折叠后焦点移到折叠按钮
- 容器带 `tabIndex: 0`、`data-focused-index`，监听 `focusin`
  同步当前焦点序号

## 6. 仍待取证

消息流分组 / thinking 折叠 / 流式光标与 spinner 动词 / 消息操作条 /
时间戳 / 评分 / 结果与错误卡、composer 结构、engine surface 机制
由并行取证产出，完成后并入。
