# 原版前端资源：无宿主桥的隔离启动探针

用户已选择优先复用原版前端资源。本次只验证其在隔离浏览器中的一个起点，不能把结果当成可复用性结论或开发完成。

## 方法

- 输入为 SHA-256 `bb88615052255e79b5977885f9a0cc212c268589587c79d4d3b7c4b46e881a95` 的 `app.asar`，使用其未修改的 `webview/index.html` 和按需读取的包内静态资源。
- 使用新的隔离 Chromium 浏览器上下文，入口为虚拟域名 `https://audit.invalid/webview/index.html`；通过 Playwright 拦截读取 ASAR 内资源，每个响应先核对成员 SHA-256。所有非虚拟源及非 GET 请求被阻断，WebSocket 关闭，Service Worker 禁用；不读取或提供账号、凭证、用户数据或真实 Agent，未运行 macOS 主程序。
- **没有注入 Electron preload 或 `electronBridge`**。窗口为 1440×900，等待 DOM 就绪后观察 8 秒；此环境与完整原版桌面宿主不同。

## 结果

- 入口 HTTP 200；经哈希校验并在虚拟源响应了 308 个包内资源，没有缺失资源；探针记录到的页面异常及控制台错误均为 0。
- 8 秒观察末尾截图显示白底和中央加载图标，正文无可见文字；`window.electronBridge` 为 `undefined`。没有观察到项目侧栏或聊天工作区。
- 第二次探针在相同隔离条件下额外被动记录 `codex-message-from-view` 的事件类型，8 秒内没有观察到该事件；它不能证明其他启动状态或原版 Electron 内不会发送事件。
- 第三次探针同时被动观察同页面 `message` 事件，观察到一次 `connect-app-host` 类型消息；没有安装宿主来接收该连接。原包 `connect-app-host-2c1800fa8f03.js`（SHA-256 `a3a327f26f9f068ed933e18b58db297ee424b7dae29901a384308a2e44bb239b`）静态创建 `MessageChannel` 并发送端口；preload 静态监听该消息并向 Electron IPC 转交端口。这为后续分析宿主握手提供了具体入口，但不能单凭它断言加载等待的唯一原因。
- 此结果只说明**在上述无桥、无账号、无网络的人工环境及观察时间内，未到达聊天界面**。它不能证明导致等待的唯一原因是缺少 Electron 桥，也不能证明补一个桥即可完整运行或复用全部功能。
- 静态核验的 `.vite/build/preload.js` 暴露 `electronBridge`，并通过 Electron IPC 提供消息、共享状态、Git worker、上下文菜单等入口。下一步需要在用户评审后或用户批准的独立研究范围内分析实际握手、权限和版本门控；生产适配必须以白名单及真实能力为准，不能将任意宿主 IPC 直接暴露给网页。

## 可复查材料

保存在本地忽略目录 `.dev-runtime/chatgpt-desktop-audit-20261103-kmy767aq/`：

| 文件 | SHA-256 |
| --- | --- |
| `probe-official-renderer.cjs` | `507666be61559ab0c2b9e4ba712e3fcc6c879241dfcf23295a3b90e1053123ac` |
| `official-no-bridge-probe.json` | `a3a2f0c14bf339ff5971d34eae9f4ed8b7d0038e6437c0840fd65ea5cbcfbd02` |
| `official-no-bridge-probe.png` | `1b9e98aac8feefc152c1ad6ccbcad715aeebd3bad3da08e6f6959c509092cc31` |
| `probe-official-events.cjs` | `642f9b85c0fdf48311a1d1ba3a4b9442cc74908e6ee1a3ac531c761c4b126c63` |
| `official-passive-events-probe.json` | `0c365c3197b7ab6e4fb6d4d83de053a085c0af2ae67fd4d0f39c11f4821d3678` |
| `official-passive-events-probe.png` | `848b409c0fe3ef653f4307dc975b5b0861af8877f7dc8d3e86158e95746ac1b5` |
| `probe-official-window-events.cjs` | `d306cae69a431df1dcf59bc3af4e3a0fc6ffaa3e0fe4590646c921a45859b94b` |
| `official-window-events-probe.json` | `9d699212933ce8027e43b6300677f777e864e27abe8d5215ae1e600b4f1e747d` |
| `official-window-events-probe.png` | `56f6521f05f528d553d25dc30ef235b973cecfe35d7c23ac51ee4974d75cf717` |

这是普通浏览器下的受控探针，不是 Mac 原版运行证据，也不是第四模式的功能、视觉或账号验收。
