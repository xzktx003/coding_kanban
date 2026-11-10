# 官方 webview host 驱动协议 — 逆向发现记录（t7，26.51021.22027）

日期：2026-11-07。基线：`openai.chatgpt 26.51021.22027`。约束：不登录、不连 IPC、不修改官方 VSIX；
只读官方 webview + mock `acquireVsCodeApi`（O-C 层级）。此文档记录 t7 对官方 webview host→webview 驱动协议的
逆向发现，作为后续“打通官方 webview host 驱动协议”专用 RE 会话的输入。**当前 host 驱动尚未打通**（见 §4）。

## 1. message-bus 路由（`message-bus-4113ba7287d7.js`）

- 启动（`T()`）：`acquireVsCodeApi()` 缓存为 `c`；`window.addEventListener("message", windowMessageListener)`；
  注册顶层回调 `n((e,t)=>w.dispatchMessage(e,t))`（`n`=app-initial 的 `Qx`，webview→host 发送层）。
- 收消息 `handleMessage(e)` → `u(e)`：
  - 若 `e.data` 带 `marker === "codex-host-chunked-message-v1"`：走分块组装 `f(t).receive(i)`（按 transferId/sequence），
    收到后 `postMessage({type:"chunked-message-ack", transferId, sequence})`；若 `type==="pending"` 则返回 null。
  - 否则要求 `e.data` 为带字符串 `type` 的对象。
- **origin/source 校验**（`u`/`d`）：`event.origin` 必须等于 `location.origin`；用合成 `MessageEvent` 直接驱动时若不设置
  `origin: location.origin, source: window` 会被丢弃（实测：不带 origin 的合成消息全部无效）。直接消息不设 marker 才会走“直接 type”路由。
- 分发 `deliverOrBufferMessage(e)`：按 `e.type` 投递；`mcp-request-delivery`/`mcp-response`/`personal-workspace-access-blocked`
  在无 handler 时先缓冲。
- `subscribe(type, cb)`；`deliverMessage(type, msg)` 调用该 type 的 handlers；webview→host 用
  `dispatchMessage(type, data)` → `c.postMessage({...data, type})`。

## 2. app 订阅的 host→webview 消息类型

`initialize-app-host-services.extension-30f51ce33cdd.js`（`app-main` 动态 import）订阅：

| 消息 | 触发 |
|---|---|
| `type:"identity"`（`subscribe(e=>e.type==="identity" && o())`） | `o()` 触发身份/初始化 |
| `{type:"notification", key:{hostId}, methods:["turn/started","item/started","item/completed","turn/completed"], listener:({method,params})}` | 轮次/条目通知 |
| `{type:"notification", key:{hostId}, methods:["thread/status/changed"], ...}` | 线程状态 |
| `{type:"event", key:{hostId}, event:"stream-role-changed", listener:({conversationId,role})}` | 流角色 |
| `{type:"event", key:{hostId}, event:"turn-completed", listener:({conversationId})}` | 轮次完成 |
| `mcp-request-delivery` / `mcp-response` | MCP 投递/响应 |
| `persisted-atom-sync` / `persisted-atom-updated` | 持久化原子 |
| `git-performance-operation` / `git-performance-watcher-snapshot` | git 性能 |

事件/通知消息以对象 `{type:'notification'|'event', key:{hostId}, methods|event, params|...}` 形式投递；
`hostId` 在参考夹具中取 `"local"`。

## 3. app 启动链

`index-e622cadf605d.js`（入口）→ 动态 `app-main-f01e5d0717a9.js`：
- 在 `getElementById("root")` 上 `createRoot`。
- `n(async()=>{let{initializeApp:e}=await import("./app-runtime-e4cd1bf57df0.js"); ...; render(...)})`。

即：`initializeApp` 完成后才 `render`，loader 在 `initializeApp` 渲染主界面之前一直存在。

## 4. 实测：loader 未移除（host 驱动未打通）

headless Chromium 加载 `native-app.html`（mock `acquireVsCodeApi`），`nativeAppBooted=true`、root 仅 boot loader、无 pageerror。
发送（origin/source 已设、无 marker 的直接消息）`identity` 后 root 仍为 loader；发 `initialize`/`thread/list`/`thread/started`/
`model/settings` 亦停在 loader。

结论：`identity` 的 payload 形状未匹配，且很可能还需要 `hostId` 相关身份字段 + 后续线程生命周期/流事件；
app 为完整 ChatGPT webview（路由/账号/线程生命周期），需要模拟“真实宿主 MessagePort/`vscode.getState()/setState()`”
级别的完整驱动，不是单条消息能闭环。

## 4.1 2026-11-08 隔离复测

使用仓库只读 reference server 和 mock `acquireVsCodeApi`，不登录、不连 IPC、不改官方产物：

- 官方 `index.html` 会加载 `app-main` 和 `app-runtime`，React root 已创建，但 DOM 仍是原始 `.startup-loader`。
- `app-runtime` 的动态 import Promise 在 3 秒观察窗口内不 settle，也没有请求失败、页面异常或 Vite preload error。
- `app-main` 对 runtime 的动态导入带有 3203 项预加载清单；浏览器只完成约 250 个资源请求，因此不能把“未出现在资源列表中”直接当成运行时缺失依赖。
- 显式调用导出的 `initializeApp()` 后，页面才发出 `vscode-capn-rpc-connect` 和两条 `vscode-capn-rpc-message`。初始化停在等待宿主对 Cap'n RPC `pull` 的合法回复。
- 因此当前阻塞分两层：自然启动尚未进入 `initializeApp()`；即使进入，也还需要完整宿主 RPC 回复，不能靠一条 `identity` 消息打通。
- 性能采样显示自然启动的主线程热点在 Vite 预加载函数：它为约 3203 个模块逐项扫描现有 `link`。这是测试页观测，不修改官方产物。
- 仅在隔离测试页把该预加载函数替换为直接执行 importer 后，`app-runtime` 于 40717ms 完成求值，并自然发出 1 条 `vscode-capn-rpc-connect` 与 2 条 `vscode-capn-rpc-message`。页面仍停留在 `.startup-loader`，因为宿主还没有合法回复 RPC `pull`。
- 该替换只证明“预加载开销挡住了观测窗口”，不能当作官方宿主通过，也不能据此把跨状态像素 diff 标为通过。
- 同一隔离页使用官方 `dist` 的 RPC 会话类回答 `services`，并补齐最小宿主消息后，`.startup-loader` 被官方延迟加载动画替换。继续提供 `appInfo.get/getSystemInfo`、`ideOnboarding.getState={completed:true}`、持久化空同步，以及未登录的 `account/read`、`getAuthStatus`、空配置和空实验功能响应后，页面渲染出官方 home composer：可见 logo、顶部工具、composer、权限/模型控件及一条官方提示。1440×1000 下 root 子节点增至 141，存在 1 个输入框。
- 这仍只是隔离诊断页的未登录空态。测试页绕过了 Vite 预加载，宿主数据是最小替身，不是真实 VS Code extension host、真实 app-server 或已登录线程。跨状态像素 diff 仍未接通，不能记为通过。

## 5. 下一轮 RE 建议（专用会话）

1. 断点/插桩 `initialize-app-host-services.extension-30f51ce33cdd.js` 的 `o()`（identity handler）与
   `app-runtime-e4cd1bf57df0.js` 的 `initializeApp`，确定 identity 消息的精确字段与类型。
2. 按 §1 的消息路由与 §2 的类型，构造 `{type:"notification", key:{hostId:"local"}, methods:["thread/started",...], params:{...}}`
   与 `thread/turns/list`（含 items/tool/approval/queue）驱动真实线程渲染。
3. 从存活渲染树读取 goal card / dialogs / status pill / transcript item / composer 的实际导出（跨构建 opacity 问题，
   见 t5 记录），据此重绑 `native-goal-reference.js` 等夹具，再启用同状态交叉像素 diff。
4. 在此之前，`session-goals-reference` / `session-goals-completion` / `session-goal-control-styles-reference` /
   `session-current-transcript-reference` 保持“未设 `CODEX_GOAL_REFERENCE_URL` 即跳过”，不计为通过。

## 6. 相关

- 基线/资产钉定：`codex-26.51021.22027-reference-baseline-20261107.md`。
- 像素 diff 管线：`pixel-diff-harness-20261107.md`（当前仅官方 boot shell 基线）。
- 符号转不透明/不可静态重绑：t5 记录（blocked）。
