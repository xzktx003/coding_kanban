# Goal 控件圆角与交互样式对照

首次样式修复只修改 `apps/web/src/session-mode/features/goals/goals.css`；后续关闭按钮修复另涉及同目录 `ThreadGoalCard.tsx`，验收见下文。原包为仓库 `26.51007.21434`，已与已安装 `26.1007.21434` 的对应资产核对；实际加载的三个 JS、四个 CSS 均校验完整 SHA。对照运行原始 `Cu/oFi`、`qu/gPi`，不改官方文件、焦点 API、CSS 能力检测或原控件 disabled 属性。

## 已观察到的差异和修复

桌面首轮保存 214 条差异记录，按控件／属性／值聚合为 29 组，并非 214 个独立缺陷。原包的弹窗、输入框、图标底板、底栏按钮和替换目标使用 `superellipse(1.5)`；本地此前均为普通圆角。主按钮还缺少默认边框、两类按钮缺少悬停色，底栏焦点使用了偏移 2px 的 outline，保存中的输入框缺少禁用背景、文字透明度和鼠标样式。

现按原选择器范围修复。卡片顶部与关闭按钮仍保留普通圆角，不给整个 Goal 子树套统一形状；可用 `corner-shape` 时只将相应基础半径乘 1.25。没有支持时使用未放大的基础值：卡片顶部 16px、弹窗 20px、输入框 8px、图标底板 12px、底栏按钮／替换目标／卡片按钮 10px，关闭按钮始终 4px。此处 px 换算以本次实际 16px root rem 为准，实现使用 rem。

按钮悬停仅在 hover-capable 且未 disabled／aria-disabled 时启用；焦点使用原 2px、零 offset 的 ring stack，并保留底栏按钮的 forced-colors outline 回退。保存中由真实请求状态禁用的 textarea 使用原背景、65% 文字和 `not-allowed` cursor。既有状态流、回执、草稿和 coarse-pointer 44px 门槛不变。

## 测试方法与证据边界

`session-goal-control-styles-reference.spec.ts` 覆盖 1440／390 × dark／light。每例采集实际键盘 Tab、鼠标 hover、编辑与替换弹窗，以及点击保存后真实 pending 的样式；先落盘全部 JSON／截图、执行清理，再统一断言。相同宿主颜色变量显式提供给两边。双方都不绘制 outline 时仅记录其不可见的 outline-color；outline 样式、宽度、偏移和 box-shadow 一直比较。

原包 Save 走其真实 AppScope／RPC getter，但唯一可调用方法是精确 fixture thread 的 `setThreadGoal`，Promise 持续 pending，没有伪造成功回执；原生 host bridge 与外部网络写入均拒绝。本地也只持有一条精确 fixture GoalSet，清理时返回明确未接收的 fixture 409。这是组件样式验收，不是完整 IDE、认证账号或真实后端 GoalSet 成功验收。每例前后核对相同产品／测试路径与原包资产，拒绝 HMR 漂移。

候选测试的 Chromium 四例和 Firefox 四例均通过，前端类型／生产构建通过。Firefox 146.0.1 实测 `CSS.supports('corner-shape','superellipse(1.5)') === false`，因此覆盖真实回退分支；Chromium 145 实测为 true。此前尝试的 `CSSCornerShape` 禁用 flag 被忽略，不能计为回退覆盖；WebKit 缺少宿主库的启动失败也不计为产品红灯。Firefox 使用 ignored 私有库目录，未修改系统包。

正式用例补入卡片按钮与关闭按钮的 shape／每角半径比较。首批额外发现两处测试接线问题：本地关闭按钮实际名称为“关闭对话框”，以及初始化的 `filesystem/unwatch` 需要作为清订阅记录；这些失败原样保留，不能称正式批次已全绿。最终结果另追加于本节。

修正上述两处测试接线后，正式 Chromium **4 项通过、1.5 分钟**，正式 Firefox **4 项通过、1.8 分钟**，均无跳过；所有已比较样式属性差异为零、每例 24 个输入前后相同、七个实际 HTTP 资产哈希匹配。另批既有 **14 项 Goal 回归通过**，覆盖完成清理、替换、草稿、状态与 320／390px coarse-pointer；该批同时保留新增四例接线失败，不能称原 18 项单批全绿。`round10-goal-style-final-verification.json` 核对 2834 产品源码与 72 shared 产物、文件集合均未漂移；两处预期测试修正单独列明。该批尚未解决原 close 在保存中可聚焦而本地 disabled 的状态差异，不能由 shape 相等替代。

## 保存中关闭按钮的焦点与受控关闭

继续沿原 `Cu` 的 `onOpenChange`、`Main.UR` 和 `Main.L3n` 核对：保存时 close 本身没有 disabled，仍可通过 Tab 聚焦和点击；真正的关闭由 `Cu` 在 `f === 'edit'` 时拒绝。原 textarea、取消、保存与卡片动作仍 disabled。本地先前额外禁用 close，使键盘跳过此按钮。真实浏览器红灯记录六条差异／失败，新补的两项组件测试也先失败；首次漏传会话 Vitest 配置导致的 document 未定义是测试启动错误，另档保留，不记产品红灯。

修复移除本地 close 的 disabled，点击时同步检查当前 busy，沿用已有受控关闭、Escape 与弹窗外点击保护；没有开放保存期间关闭或新增请求。关闭按钮补原焦点 ring，forced-colors 的底栏专有回退不扩大到 close。组件测试覆盖 busy 按钮可聚焦但回调不执行，以及 idle→busy→idle 后使用当前回调，**1 文件／10 项通过**，前端类型检查与生产构建通过。

新冻结版本的单批 Chromium 为 **18 项通过、2.8 分钟**，包括原 14 条 Goal 回归和四条加强的样式／交互用例；随后 Firefox **4 项通过、1.9 分钟**，两批均无跳过。1440／390 × 深浅主题中，双方实际 Tab 聚焦 close、点击 close、按 Escape、点击弹窗外，均保留同一 dialog ID、原草稿及唯一保存请求；其它保存控件保持 disabled，所比较样式差异为零。`round11-pending-close-final-verification.json` 核对 2834 源文件、18 份 E2E、3 份基础设施文件与 72 shared 产物在两批前后相同；八例各 24 个输入、七个实际 HTTP 资产匹配，两页面均关闭，bridge／页面错误为空。

红灯、单测和浏览器日志分别为 `round11-pending-close-red.log`、`round11-pending-close-unit-configured-red.log`、`round11-pending-close-unit-green.log`、`round11-pending-close-browser.log`、`round11-pending-close-firefox.log`，位于下述 ignored 证据根目录。此结果仍受组件夹具边界约束，也晚于此前 30 分钟长测，不能将旧长测哈希替换为本次组件／CSS 版本。

测试前端为 **HTTP `http://10.30.0.24:48865/`**，原组件为 **HTTP `http://10.30.0.24:37575/native-goal.html`**，均绑定 `0.0.0.0`；未验另一台物理设备。证据位于 ignored `.dev-runtime/session-polish-round2-20261016/goals/control-style-fix/` 及 `round10-goal-style-browser*`。本轮晚于标准 30 分钟内存绿灯，不能把此前源码哈希的长测改写为新样式后的再次长测。

复现使用既有隔离前端和 [原组件服务](../../../tests/fixtures/codex-goal-reference/README.md)，不启停正式会话服务：

```sh
PLAYWRIGHT_BASE_URL="$TEST_WEB_LAN" \
CODEX_GOAL_REFERENCE_URL="$TEST_GOAL_REFERENCE_LAN" \
GOAL_CONTROL_STYLE_EXPECT_CAPABILITY=supported \
pnpm exec playwright test --config playwright.goal-controls.config.ts --workers=1
```

真实不支持的浏览器使用 `GOAL_CONTROL_STYLE_BROWSER=firefox`、`GOAL_CONTROL_STYLE_EXPECT_CAPABILITY=unsupported` 及其正常 Playwright 安装／库路径；实际能力不符即失败。未提供原组件 URL 时明确 skip，不计作通过。forced-colors 分支与物理触屏不由上述普通桌面矩阵代替。
