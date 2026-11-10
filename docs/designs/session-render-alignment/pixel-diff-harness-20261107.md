# 隔离官方 webview 像素 diff 对照管线（t3 pixel-harness）

日期：2026-11-07。基准：`openai.chatgpt 26.51021.22027`（解压/版本/资产钉定见
[codex-26.51021.22027-reference-baseline-20261107.md](codex-26.51021.22027-reference-baseline-20261107.md)）。

> 证据层级：**O-C**（真实官方 webview 在纯浏览器里渲染，`acquireVsCodeApi` 为 mock）；
> **不是 O-F**（完整 VS Code / code-server / extensionHost / MessagePort / native 链路）。
> 任何 O-C 绿都不能升级为完整官方宿主 parity 声明。

## 1. 目标与边界

- 复用 `scripts/codex-goal-reference-server.mjs`（**免登录、只读、不连 IPC、不启动 Codex**）作为官方资产 oracle。
- 用 Playwright 把官方 webview 与本地会话模式驱动到同一组状态，逐状态截图，配套**像素 diff 断言（先红后绿）**。
- 产出可在 CI/本地重复运行的**像素回归入口**与**基线截图**。
- 不改官方 VSIX / 官方资产；不读登录态；不连接默认 CLI IPC。

## 2. 交付物

| 文件 | 作用 |
|---|---|
| `tests/e2e/codex-pixel-harness.ts` | 参考服务生命周期封装、官方 webview 启动、`assertPixelParity`（Playwright `toHaveScreenshot` 像素 diff）、证据落盘 |
| `tests/e2e/session-codex-pixel-diff.spec.ts` | 像素回归 spec：身份断言、官方 boot shell 基线、本地 shell 基线（需 `PLAYWRIGHT_BASE_URL`） |
| `playwright.pixel-diff.config.ts` | 隔离配置：不启动应用服务/构建；`snapshotPathTemplate` 把基线 PID 到 `tests/test-results/pixel-diff/baseline/` |
| `tests/test-results/pixel-diff/baseline/official-26-51021-22027-native-app-boot.png` | 官方 26.51021.22027 webview boot shell 基线截图（1440×900） |

## 3. 运行方式

```sh
# 官方基线 capture + 像素 diff（只依赖参考服务；首轮写基线并红，次轮相同则绿）
npx playwright test --config playwright.pixel-diff.config.ts

# 加入本地会话 shell 对照（需要正在运行的隔离前端）
PLAYWRIGHT_BASE_URL=http://127.0.0.1:5173 npx playwright test --config playwright.pixel-diff.config.ts
```

- 参考服务在 spec 的 `beforeAll` 由 `startReferenceServer()` 自行启动并在 `afterAll` 停止；
  它要求 `--host 0.0.0.0`，打印 LAN URL；本地用 loopback `base` 驱动。
- 若把 `--extension` 指到其它官方构建（旧版本/篡改资产），服务启动即抛错拒绝，杜绝“静默用过期组件当 oracle”。

## 4. 像素 diff 断言语义（先红后绿）

`assertPixelParity(page, selector, name, {maxDiffPixels})` 使用 Playwright 内置 `toHaveScreenshot`：

- **首轮**：基线不存在 → 写入 `tests/test-results/pixel-diff/baseline/<name>.png` 并判红（missing snapshot）。
- **后续轮**：当前渲染与基线逐像素比较，超过 `maxDiffPixels` 判红，否则判绿。
- 这满足“先红后绿”：官方构建发生变化 → 基线仍为旧 26.51021.22027 → 当前与基线 diff 超过阈值 → 红；
  未变化 → 绿。`animations:"disabled"` 冻结 boot loader 的 shimmer 动画。

已实测：`npx playwright test --config playwright.pixel-diff.config.ts` 首轮红（写基线），
次轮 2 passed / 1 skipped（本地未设 baseURL）。身份断言验证 `reference.json` 版本为 `26.51021.22027`。

## 5. 当前能跑的状态与为何还有缺口

**已可跑**：官方 webview 的确定性 boot shell（`native-app.html`，`nativeAppBooted===true`，
root 只有 boot loader，无 host 驱动）。已捕获 1440×900 基线截图（暗色 + OpenAI blossom logo）。

2026-11-08 另增加未登录 home composer 基线：不修改官方资源，由隔离页回答 RPC `services` 和最小宿主消息，
1440×1000 渲染官方空态。首轮缺失基线判红，次轮 `official logged-out home composer` 1 passed。
该状态没有真实登录、线程、app-server 或 extension host，不能代表跨状态 parity。

同日复核发现 `thread/list`、`model/list`、`collaborationMode/list` 等请求原先收到笼统 `{}`，
模型按钮渲染成重叠文字。现按已知空分页返回 `data: []/nextCursor: null`，requirements 返回 null，
插件返回空 marketplaces；页面须出现可访问名称为 `Custom Medium` 的模型按钮和 `Do anything` 输入框。
更新基线后连续两次像素比对均通过。这仍只是未登录空目录状态。

同日确认官方子代理提示的“Try now”和关闭按钮都只移除当前提示，不导航、不改输入；刷新后因隔离宿主未持久化而重现。
本地新线程 composer 现按官方文案显示“Codex 子代理”，试用追加固定探索提示，两种操作都持久记住已看过；已有线程不显示。
本地没有受控 `experimentalFeature/enablement/set` 端点，不声称已开启官方实验功能或完成跨状态像素 parity。

同日官方空目录的“Recent chats. 0 in progress”打开页内搜索菜单，显示 `Search recent chats` 与 `No chats yet`；
Escape 关闭菜单、丢弃查询且不改 composer。隔离 `thread/list` 仍为空，因此这只证明空菜单，不证明真实会话搜索或打开。
本地 composer 现有同位置菜单，但数据源仅是当前 store 已加载线程；选择走既有会话切换，不补发列表或历史请求。

同日官方空态 `New chat` 点击后仍停留在同一空 composer，RPC 方法中没有 `thread/start`。
因此空态新聊天不能解释为预先创建线程；本地既有 `setCurrentThread(null)` 与该边界一致。

同日官方权限菜单显示审批标题、了解更多、请求批准和完全访问，点击后不离开页面。
本地菜单已有对应中文项，此回归不改变权限写入。

官方模型按钮打开后显示 `Select effort`、`Select model` 和 `IDE context`，页面不变。
`IDE context` 与用量限制仍依赖宿主连接，本地没有来源时不渲染假控件。
未登录菜单实际显示当前 `Medium`、`3 of 6`、`Locked, opens access options` 和 `Usage limit reached`；
隐藏档位不能当作可见选项，本地也不伪造账号解锁。

官方模型菜单中的 `Turn off IDE context` 点击后仍停留在空 composer。
隔离宿主没有上下文状态回执，因此不能把菜单关闭解释为 IDE 上下文已关闭。

官方无名顶部按钮打开 `Codex settings` 与 `Keyboard shortcuts`，页面 URL 不变。
本地对应菜单只调用现有设置视图和快捷键面板，不复制其状态。
官方 `Codex settings` 点击后显示 `Settings`，URL 不变；本地快捷键复用既有事件名。
隔离页面的设置容器只有标题，没有可访问分区或控件，因此不据此伪造设置项。

未登录页面可见的 `Notifications alt+T` 没有对应可访问按钮。
它不是可点击的通知中心入口；本地既有快捷键面板不据此改成通知权限控制。

官方 Clear goal 后回到空的 `Do anything`，清除按钮消失且 URL 不变。
本地对应动作只修改当前会话目标草稿，不提交目标或创建线程。

**还无法做“官方 vs 本地同一逻辑状态”的交叉像素 diff**，瓶颈两个（都已精确定位）：

1. **官方 webview 的 host 驱动协议**：`native-app.html` 启动真实 app，但要渲染 thread/composer/goal card
   需通过 host→webview 消息。实测只发 `initialize`/`thread/list`/`model/settings` 等消息停在 boot loader；
   `message-bus-4113ba7287d7.js` 只在带 `codex-host-chunked-message-v1` marker 或直接 `type`
   且订阅方存在时路由，需按原包梳理 `initialize` 握手与 thread 事件 payload 形状（RE 待办）。
2. **goal/transcript 夹具仍绑定旧基线**（t1 记录）：`native-goal-reference.js` / `native-transcript-reference.js`
   等硬编码符号导入 `26.51007.21434` 的 `app-initial-c4ebaa710049.js` 等，在 26.51021.22027 中不存在，
   因此 goal/transcript 状态无法通过这些夹具驱动到 26.51021.22027 的官方组件。

**建议**：goal/transcript 状态优先改为由 `native-app.html` app harness + host 驱动；或在 t1 之后另派
“官方 webview host 驱动协议重绑定”子任务，打通后把 `session-codex-pixel-diff.spec.ts` 的状态注册表
从 boot shell 扩到 goal card / composer / thread item / queue rail。

## 6. 本地 shell 对照

`local session-mode shell pixel baseline` 用例在设置 `PLAYWRIGHT_BASE_URL` 时运行，为本地 `.session-mode`
外壳单独记录 own-brand 基线（本地 UI 变像素即红）。它与官方 boot shell **不是同一逻辑状态**，因此不构成
官方↔本地 parity；官方↔本地同状态 parity 依赖 §5 的驱动协议打通后再启用。

## 7. 安全/操作边界

- 参考服务免登录、只读、不连 IPC，不改官方资产。
- 基线/产物写入 `tests/test-results/pixel-diff/`（本地运行，不入库基线；CI 可另存）。
- 不启动正式 Agent/宿主/应用构建；本地前端由调用方提供并在 `PLAYWRIGHT_BASE_URL` 指定。
