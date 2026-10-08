# 常驻桌面工具区验收（2026-10-08）

## 范围

- 桌面：文件、VS Code、终端、放大/还原、右侧面板开关与原有标签行同高，固定在工作区右侧。
- 手机：继续使用原菜单。多窗口仅一组工具；网格和列表预留工具行。
- 保留现有标签标题、Agent 图标、项目副标题、状态、关闭、拖动和横向滚动交互。`SessionTabs.tsx`、`SessionIdentity.tsx` 的 SHA-256 与任务开始基线一致。
- 面板隐藏、工具切换、放大还原均复用现有 VS Code 和终端；放大还原恢复之前的分屏宽度。

## 红灯证据

- 新组件单测在实现前失败：`.dev-runtime/tool-dock-red.log`。
- 首次挂载测量早于父容器 ref，新增标签按钮被遮挡，初版 E2E 768/1024/1440 均失败（过程中捕获，日志随后被绿灯复跑覆盖）。现由父 ref 就绪后的 effect 完成测量。
- 放大还原后宽度偏差约 288px：`.dev-runtime/tool-dock-size-red.log`。模式变化时临时约束尺寸不再写入持久宽度。
- StrictMode 首次打开终端创建 2 个标签：`.dev-runtime/tool-dock-terminal-red.log`。初始化改为读取实时 store，使重复 effect 幂等。

## 浏览器验收

局域网入口：**HTTPS / 8484**，`https://10.30.0.24:8484`。Playwright 使用独立浏览器上下文，拦截全部业务 HTTP/WebSocket，编辑器为隔离 iframe，不发送真实 Agent 请求，不创建真实终端或 VS Code 服务。

```sh
PLAYWRIGHT_SKIP_WEBSERVER=1 PLAYWRIGHT_BASE_URL=https://10.30.0.24:8484 \
  pnpm exec playwright test tests/e2e/session-tool-dock.spec.ts \
  --reporter=line --output=.dev-runtime/tool-dock-e2e
```

4/4 通过（768、1024、1440px 桌面，375px 手机）：

- 5 个工具常驻，标签横向滚动后仍可见，新增标签按钮不被遮挡。
- 点击当前工具保持展开；收起、恢复、切换与键盘 Enter 放大正常。
- 还原后宽度与原宽度差小于 3px；工具坐标偏差小于 2px。
- 原标签节点、内容、字号、高度、选中会话不变；VS Code iframe 节点及未保存输入不变。
- 仅一个终端标签；首次 StrictMode 初始化完成后，切换/收起/放大不增加 start/stop 请求。
- 分屏共用一个工具组，只给重叠的标签行让位；网格/列表有独立预留高度。
- 桌面切换手机时移除工具组与桌面预留样式，恢复菜单；切回桌面工具重新常驻。
- 无浏览器未捕获错误，无 `turn/start`、`thread/start` 或 interrupt 请求。

浏览器日志 `.dev-runtime/tool-dock-e2e.log`；截图 `.dev-runtime/tool-dock-{768,1024,1440}-{open,closed}.png`。

## 单测与构建

- 直接相关布局、导航、工具和终端测试：7 个文件、28 项通过，见 `.dev-runtime/tool-dock-related.log`。
- 最终全量会话单测：171 个文件、559 项全部通过，见 `.dev-runtime/tool-dock-all-tests.log`。
- 最终 `pnpm check` 通过：shared、server、web 类型检查与生产构建；只有既有的大分块体积提示，见 `.dev-runtime/tool-dock-check.log`。
- `git diff --check` 与标签源文件哈希检查通过。

当前 Rust 运行服务及 Agent 保持运行，未重启。浏览器结果证明前端交互与实例保留；不把隔离 iframe/终端回执模拟宣称为真实编辑器或真实 PTY 新建验收。手机为 Chromium 视口模拟，未作物理手机验收。
