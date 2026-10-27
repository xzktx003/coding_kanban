# 模型切换通知与聊天分隔行（2026-10-27）

本轮使用 `reverse-engineer-anything` 工作流，沿用已校验的官方 `26.51007.21434` 原包。调查的是输入区上方旧 `ModelChangeNotice` 卡片，不改模型选择、草稿存储、原生任务或官方 VSIX。主线程另有 REA 会话中的父证据；本记录以本轮原包哈希、精确源范围和独立浏览器产物为证，不声称获得了跨会话 REA 图。

> 后续实际完整菜单取证已撤回“任意模型变化都应提示”的入口推断：普通 radio 成功选择不进入 `tn`。详见 [真实入口矩阵与修复边界](model-change-notice-behavior-20261027.md)。本页回调重放只证明组件与分支表面，不证明实际操作触发。

## 两种原生组件不能混用

原始资产均在 `third_party/openai.chatgpt-26.51007.21434-linux-x64/extension/webview/assets/`。以下偏移都是 **UTF-8 字节**，不是 JavaScript 字符索引。

| 入口 | 源位置与条件 | 渲染结果 |
| --- | --- | --- |
| 模型菜单 `hCa` | `app-initial-fee819fe4f22.js` 起点 5280453；其 `tn` 回调 `[5287928,5288877)` | 经 `s.get(hx).info(...)` 发 toast；不是 attached rail |
| 最近模型快捷入口 `YDa` | 同资产起点 5443870；warning id 约 5447764 | 选择成功后同样发 toast；不能把 hCa 的 ref 去重条件直接等同于此入口 |
| 聊天分隔行 `rw` | `sites-end-resource-733bd1c6da06.js` `[200583,202531)`；`RD` 的 `case "model-changed"` 约 331094 调用 | “模型已从 … 更改为 …。”以及信息按钮的两行 tooltip；无关闭按钮 |
| 聊天投影 | `app-initial-41ab338a184f.js` 约 516082 | `modelChanged` 映射至 `model-changed` renderer item |
| synthetic item 创建 | `app-initial-c4ebaa710049.js` 约 4913997 | 下一 turn 入队时，由前后协作模型及 `shouldShowModelChange` 决定是否插入；不是单纯 picker 本地选择状态 |

`hCa` 的静态条件：最新 turn ID 非空、与该组件 ref 上次已提示 turn 不同、turn count > 0、目标与原模型不同，然后按 flag `3727129412` 分流。v2 使用 `$9t(previous,next) !== 0`；legacy 使用 `!een(previous,next)`，升级与降级结果可能不同。v2 文案带此前模型名，legacy 只保留性能提醒。toast 逻辑 ID 是 `composer.modelChangeDuringConversationWarning.${threadId}`。**本轮没有读取正式 SDK flag 值，也没有执行完整 hCa 菜单的真实点击与已有会话 transport。**

`rw` 通过原模型 catalog 解析 displayName，未知名称显示“自定义”。本轮独立 runtime fixture 没有配置真实模型目录，截图里的两个“自定义”就是这个边界；未将其当作已验证真实模型名映射。

原包 SHA-256：

- main `app-initial-fee819fe4f22.js`：`460201045b5f5a4255fda737c9baa4768367a973d735cb37f3467bfe6af95316`
- sites `sites-end-resource-733bd1c6da06.js`：`5b45f53d1d05d8a47058cbb7b0f0d4e131805d6036c4a878e5ce951401018a14`
- projection `app-initial-41ab338a184f.js`：`c755dbca916c0f830a554fe2e3057f8642b32394bea7701338e5d506f692ad56`
- synthetic `app-initial-c4ebaa710049.js`：`50e2af3d8c3d0e3c52612beb2d95940cc818dfe979d6d85a9fa61af5526640bc`
- 精确 `hCa.tn` 回调源码：`f681f52323b010b16a9e18d0199ca5b739a3f6db2a7af40d13ddb8e5af5f99dc`

## 本轮修复

旧本地卡片把 transcript divider 的“模型已从…”和 v2 toast 的性能文案合并，并持久放进 Composer rail / 状态区。现在 `ModelChangeNotice` 仅观察新本地选择，通过既有 `nativeNotifications.info` / `NativeNotificationViewport` 显示原样式通知；主 Composer 移除该 rail item 和重复状态文字，SideChat 同样移除重复状态文字。没有伪造 transcript 历史分隔行。

实际 toast 标题比对还发现该 viewport 位于 `codex-presentation` 之外，缺少原包全局 `font-synthesis-weight:none` 和字体平滑属性；本轮仅在 `.codex-native-toast-area` 补齐。原 `app-initial-aad627bd9dff.css` 的 `html,:host{font-synthesis-weight:none}` 是禁用字重合成的源依据。

订阅捕获 threadId 和 notice.id，显示前同步核对并消费同一 notice；同线程双输入区、重新挂载、A→B→A 不重复显示。只读 hydrate、挂载前旧 notice 均不触发。隐藏模式、次级页面、祖先 inert 通过既有 `useAgentInteractionVisible` 和事件瞬间 `isAgentInteractionVisible` 检查；隐藏时不消费，也不排队延迟播报，恢复可见后从当前快照开始观察下一次选择。观察器跨可见性切换保留 live guard，避免根 DOM 已恢复但 React 可见性通知尚未 commit 时丢掉下一次真实选择。这是操作即时通知的适配，模型选择值仍保存，关闭 toast 不改任何线程模型。

**未闭合：** 本地仍沿用先前 v2 文案及本地模型选择事件入口，没有猜测原生 flag，也没有把 thread-turn 数量、hCa 按 turn ref 去重、legacy 模型家族比较、其他快捷入口的行为移植成本地新规则。本轮只修复已证明的错误 surface / 持久回放 / 只读恢复弹出问题。不能据本记录宣称模型切换的完整协议门控或整块 composer 像素一致。

## 运行证据与红绿灯

独立目录 `.dev-runtime/session-model-notice-20261027/`，保留：

- `probe.mts`、`probe.log`、`callback-source.js`、`native-notices.json`：HTTP 响应只追加导出/闭包重放函数，磁盘原包不修改。原 `OCa/oen` 初始化、原模型比较函数、Intl、原 FBr/PBr/kBr toast 和原 rw 分隔行实际执行。**回调重放使用明确合成的只读 turn 元数据和 flag 参数，不是完整 hCa UI 或真实线上 flag。**
- 六种重放：空会话、缺 latestTurn、同模型均无 toast；v2 变化有 toast；legacy 升级无 toast、降级有 toast。所有原组件 runtime page errors / native errors / 越界请求均为零。
- `v2-change.png`、`legacy-downgrade.png`、`transcript-divider.png`、`transcript-tooltip.png`：原 toast 与原 divider 分开的实际截图。
- `unit-red.log`：旧实现 **5/5 红**；`unit-green.log`：改动后 **5/5 绿**。`visibility-red.log`：加强共享可见性边界后 **1 红 / 5 绿**；`visibility-green.log`：**6/6 绿**。
- `tests/e2e/session-model-notice-native.spec.ts`：同一 Arial 宿主字体、宿主主题 tokens、DPR=1，dark/light × 900/390 宽度的原组件与实际本地通知卡对照，记录外框、标题字重/字号/颜色、阴影、关闭按钮和实际关闭交互；固定 `visual/` 输出。`browser-font.log` / `browser-synthesis.log` 分别保留两个主题在字体平滑 / 字重合成上的 **2 红**；修复后 `browser-final.log` 连同完整工作台用例 **3/3 通过**。
- `unit-final.log`：包括已有 native notification 生命周期、SideChat 关闭/权限/身份回归，**7 文件 27/27 通过**。
- `tests/e2e/session-model-switch-notice.spec.ts`：完整工作台 route fixture 中真实 store 选择→toast，确认 rail 不再多出提示条。阻断正式任务写入，未连接正式 IPC。

## 像素复核：蓝边来自夹具固定祖先

初轮 computed styles 对照通过，但实际截图存在 4705–4785 个像素差，中文边缘本地呈蓝色、原组件为灰色。字体平滑/字重合成属性修正未消除此差异，因此没有用“Linux 栅格差”作为结论。

进一步实际采样标题与全部祖先的 `text-shadow`、`-webkit-text-fill-color`、stroke、filter/backdrop、opacity、font-feature/variation/optical-sizing、transform/translate/will-change 及动画状态：标题属性全等，无活动动画；CDP `CSS.getPlatformFontsForNode` 都是相同的 Liberation Sans + WenQuanYi Zen Hei。`LayerTree.compositingReasons` 则指出 local 内容进入夹具 **position:fixed、不透明 MAIN 的 Overlap 层**，原组件进入 **透明 codex-toast-area 自身的 Overlap 层**。

同一次运行只将自有夹具 MAIN 改为 `position:relative; height:100vh`，不改产品/原包字体或 toast 样式，四组截图立即从数千差异像素变成 **0 差异像素，PNG 文件字节完全一致**。真实产品 `apps/web/src/workbench.css` 的 `.session-mode` 本来就是 `position:relative`，原夹具额外引入 fixed 祖先不符合真实宿主。

永久用例改为加载实际 `workbench.css`，MAIN 只设置视口高度；新增 `Buffer.equals()` 精确截图断言，旧夹具 `pixel-red.log` **2 红**，修正夹具后 `pixel-green.log` 加完整工作台用例 **3/3 通过**。dark/light × 900/390 四组完整截图及 PNG 字节全部相等，见 `visual/pixel-differences.json`。这证明的是此通知组件在列明宿主条件下的截图，不是完整 composer 或原生 flag 门控全等。

保留取证：

- `pixel-baseline/*-diagnostics.json`：标题至 HTML 的样式、矩形和动画状态。
- `pixel-baseline/*-compositor.json`：平台字体、图层、后台 DOM 节点和合成原因。
- `pixel-baseline/*-position-probe.png` / `*-position-compositor.json`：同次运行仅修正 MAIN 定位的干预截图与图层。
- `pixel-baseline/pixel-differences.json`：修正前差异数，不覆盖红灯。
- `position-experiment.spec.ts.txt`：定位阶段的完整只读实验源码。
- `visual/*-local.png` / `*-native.png` 与 `pixel-green.log`：最终零差异证据。


`uninitialized-selector-*` 是未调用原 OCa 导致 selector 未初始化的无效初次夹具；`browser-selector-failure.log` 是选中了原 toast 包装层的无效对照；`browser-theme-token-failure.log` 是 light 夹具漏设 `--vscode-dropdown-background`，均保留但不计产品红灯。

本轮产品 LAN 为 `https://10.30.0.24:8484`（HTTPS :8484）；自有只读 reference 初次为 `http://10.30.0.24:45827/native-goal.html`（HTTP :45827），像素复核使用 `http://10.30.0.24:45843/native-goal.html`（HTTP :45843）。验收后已关闭仅本轮持有的 reference 进程，未触碰正式服务。重跑时使用 `scripts/codex-goal-reference-server.mjs --host 0.0.0.0 --port 0` 输出的新地址。

```sh
PLAYWRIGHT_SKIP_WEBSERVER=1 \
PLAYWRIGHT_BASE_URL=https://10.30.0.24:8484 \
PLAYWRIGHT_FRONTEND_PROTOCOL=https \
CODEX_GOAL_REFERENCE_URL=http://10.30.0.24:45827/native-goal.html \
pnpm exec playwright test \
  tests/e2e/session-model-notice-native.spec.ts \
  tests/e2e/session-model-switch-notice.spec.ts \
  --output=.dev-runtime/session-model-notice-20261027/playwright
```
