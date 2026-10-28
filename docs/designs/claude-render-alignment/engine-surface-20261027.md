# Engine Surface / "Claude Code Mods" 取证（阶段 0，2026-10-27）

**需要你决策的第二项。**

## 结论：这是 CLI 驱动的声明式 UI 协议

官方内部名称是 **Claude Code Mods**（证据：`Od/chunk_mY1.js:469` 的
`console.warn("Claude Code Mods: no hook is offered ${$}")`，以及
`mods_surface_shown` / `mods_surface_press` / `mods_toast_shown` /
`mods_pane_opened` 等遥测事件名）。

它不是 webview 本地的插件注册表，而是**真·协议**：CLI 侧返回一棵 UI 树，
webview 通用渲染。完整链路已逐跳验证：

```
webview  store.ask() → host.request({type:"engine_ui_render", …})
         Od/chunk_mY1.js:230
   ↓     postMessage（真实 webview↔扩展宿主边界）
         entry/chunk_Bk1.js:89  this.api.postMessage($)
扩展宿主  case "engine_ui_render" → send({subtype:"ui_render",
         surface:"vscode", component, instance_id, props, …})
         extension.js ~2911326；surface 字面量 X61="vscode" @2837183
   ↓     Query.request(...)
         "This session's Claude Code SDK cannot send drawing requests"
         ← 该错误文案直接点名 Agent SDK
CLI      {request_id, type:"control_request", request:{subtype:"ui_render"…}}
         与 mcp_message / initialize 同一个 stdio 控制协议信封
```

## 组件槽位：10 个，9 个在用

两侧字面量完全一致（webview `Yr1` @`Od.js:994`，扩展宿主 `yi1` @2837183）：

```
AbovePrompt  Pane  AskUserQuestion  UserMessage  AssistantMessage
ToolUse  ToolResult  ToolGroup  CommandOutput  Spinner
```

`CommandOutput` 在本版本**无渲染调用点**（已穷举 grep），疑为保留。
其余九个都有实际调用点，**包括每一条用户/助手消息、每个工具卡、
工具分组和 spinner**——也就是说官方把整条转录都挂在了这套协议上。

## 树的节点词汇（12 种）

`entry/chunk_yI0.js:9-190` 的 `xI0`。节点是字符串，或带 `type` 判别式的对象：

```
fragment  engine  cut
Box  Text  Link  Code  Button  Input  Select  Markdown  Svg
```

- `Box` 用类终端的 flex 模型（`ch`/`lh` 单位的 margin/padding，
  `entry/chunk_W81.js:17-62`）
- `engine` 是「洞」：回落到手写 UI，包在 `<div data-engine-own>` 里
- `cut` 是截断标记，文案 `Drawing cut at this panel's limit of {limit}`
- 交互节点带不透明 handle（`{plugin, handle, key}`），
  按下/输入/选择经 `engine_ui_press` / `_input` / `_select` 回传，
  **webview 自己不解释语义**

客户端也有自己的上限（`entry.js:5282-5364`）：节点 2000（Pane 10000）、
深度 32、文本 262144 字符、图片 250、列表项 500，超出合成 `cut` 节点。

## 关键：我们的 SDK 能不能接

实查结果（0.3.296 与 0.3.311 一致）：

| 项 | 结果 |
| --- | --- |
| `Query.request()` 运行时存在 | **是**（两版都在 `processPendingUserDialogRequests` 之后，构造 `control_request` 信封） |
| `request()` 在 `Query` 接口中有类型声明 | **否**（接口里 28 个方法不含它） |
| `ui_render` 在 SDK 已声明的 71 个 subtype 中 | **否** |

即：通道物理存在，但 `ui_render` 不在 SDK 的公开类型契约内。
调用它属于**未声明的私有协议用法**——正是你此前确认可接受、
但后来因 §4 更正而消失的那类风险，在这里重新出现。

顺带确认了 §4 的修正无误：`rewind_files` 和 `rename_session
` **都在**这 71 个已声明 subtype 里。

## 为什么这件事可以不做：回落是优雅的

`entry/chunk_bE1.js:9` 的默认值：

```js
const bE1 = { tree: null, props: undefined, drawnBy: undefined, … };
```

`GY()` 在 store 不可用时直接返回它，各调用点见到 `tree` 为空
就**回落到手写渲染**。`mY1` 自身也只在 `host === "vscode"` 时实例化
（`Od.js:2173`）。

**所以：没有任何 mod 在跑时，官方 webview 走的就是手写渲染路径。**
这正是我们要对齐的那条路径。

## 需要你决策

**用户已决策：选 A（2026-10-27）。** 本次不做 mods，只对齐手写渲染路径；
不引入未声明的 `ui_render` 协议。`AbovePrompt` / `Pane` / toast / status line
四个 mod 专属表面不在本次范围（手写路径下官方亦无）。

### A. 本次不做 mods，只对齐手写渲染路径（已采纳）

- ✔ 零私有协议依赖，和 §4 的结论保持一致
- ✔ 对齐目标不受影响：无 mod 时官方本身就走手写路径
- ✔ 工作量不变
- ✘ 用户若装了 mod，本项目不显示其内容
- ✘ `AbovePrompt`、`Pane`、toast、status line 这四个
  **纯 mod 专属**表面不会有（手写路径下官方也没有）

### B. 本次接入 mods

- ✔ mod 生态可用，四个专属表面可呈现
- ✘ 依赖未声明的 `ui_render` 私有协议（SDK 升级可能变）
- ✘ 要实现 12 种节点的通用渲染器 + press/input/select 回传 + 客户端上限
- ✘ 还要实现 `surface` 标识与能力协商
  （见到 `answers:["ui_copy","ui_prompt_read","ui_prompt_fill",
  "ui_prompt_suggest"]`，`Od/chunk_mY1.js:860-900`）

### C. 本次不做，但预留接口形状

按 A 实现，同时在渲染层留出 `own` 槽位语义，使将来接 mods
不必重构消息流。

**我的建议是 A**，必要时留 C 的形状。理由：mods 不影响「像不像官方插件」
这个目标——它影响的是「能不能跑第三方 mod」，那是另一个产品问题。

## 附带发现

- **Plan 模式不走 mods**，是手写类 `Yu extends z4`
  （`entry/chunk_XT1.js:70`），与 §工具卡契约所述一致
- **MCP elicitation 在官方 webview 里没有 UI**：整个 bundle
  搜不到 `elicit`/`Elicitation`。但 SDK **有** `elicitation` 与
  `elicitation_complete` 两个已声明 subtype——即协议支持而官方未渲染。
  本项目若要做，属于超出官方的能力，需单独决定

## 边界

CLI 侧**生产**这棵树的代码不在反编译范围内（不在 webview bundle，
也不在 `extension.js`），因此各 component 的 `props` 精确 schema、
是否存在公开规范、以及除 `"vscode"` 外是否真有其他 `surface` 实现，
**无法从本次取证确认**。只能确认线路架构允许。
