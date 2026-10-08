# 桌面标签行常驻工具

用户已确认实施。最终约束：现有标签 UI 原样保留，包括 Agent 图标、会话名、项目副标题、状态与操作；草图中的标签造型不作为实现依据。

## 已确认范围

- 桌面：文件浏览器、VS Code、终端、放大/还原、右侧面板展开/收起全部常驻，与会话标签同一行。
- 手机：保留现有菜单入口。
- 保留当前深色主题、会话名称和状态指示；图中的对话、全局导航及输入区只是背景示意，不作为本次改造目标。

## 草图

草图文件：`.dev-runtime/session-mode/uploads/session-toolbar-persistent-review.png`。

局域网查看（当前配置 HTTPS / 8484）：
[查看草图](https://10.30.0.24:8484/api/session/api/filesystem/asset?path=%2Fdata01%2Fhome%2Fhuxing%2Fvibe_codings%2Fcoding_kanban%2F.dev-runtime%2Fsession-mode%2Fuploads%2Fsession-toolbar-persistent-review.png)

图 A 展示面板收起，图 B 展示终端展开；下方为工具图标放大说明。使用内置 imagegen 生成，产品主题依据现有代码核对；无外部模型或 CLI 调用。

## 拟定交互

1. 排列：项目入口 → 可横向滚动的会话标签及现有标签操作 → 固定工具组。工具顺序为文件、VS Code、终端、分隔线、放大、侧栏。
2. 工具组不参与标签区域的滚动，不随 hover 才出现；桌面宽度不足时压缩标签可用空间并省略长标题，常用工具不退回菜单。
3. 点击前三个入口激活对应右侧工具；再次点击已选工具保持展开，不隐式关闭。面板收起时点击任一工具直接展开；最右按钮独立负责收起与恢复上次工具。
4. 当前工具采用浅暖色背景与 aria-pressed；默认图标低饱和、悬停提升对比度，名称由 tooltip 与无障碍标签说明。VS Code 沿用现有品牌图标。
5. 放大按钮始终占位：面板收起时置灰并提示先打开工具；展开时可放大，放大后同一位置变成还原。该入口操作右侧工具区，不是浏览器全屏。
6. 关闭面板仍只是隐藏；保留终端/VS Code 的既有实例保留行为。
7. 多窗口模式只提供一组全局右侧工具入口；工具上下文沿用当前激活会话/项目及已有 VS Code 固定项目规则，不能因点击工具改选会话。
8. 手机仍使用现有菜单，不把五个按钮挤进窄标签行。

## Review 通过后的实施计划

- 先补充常驻可见、标签溢出、开启/切换/收起/放大还原的失败测试。
- 建立固定工具组并对齐标签行，复用现有面板状态与入口动作；移除桌面同功能的重复隐藏入口。
- 验证 768/1024/1440px 桌面宽度与 375px 手机；覆盖长标题、多标签、面板开关、工具切换、多窗口和键盘访问。
- 确认终端任务、VS Code 缓冲、选中会话与布局均保持原有语义；同步文档与验收记录。

## 生成提示词摘要

Chinese dark developer workspace design review board, two stacked desktop states: right pane closed and terminal pane open. One continuous project/session-tab/tool row with five fixed far-right icons in this exact order: folder, blue VS Code ribbon, square terminal, separator, maximize, right panel toggle. Tabs scroll independently, no Agent prefixes. Stable icon positions; maximize disabled when closed and enabled when open. Existing charcoal palette and warm sand accent, readable Chinese captions. Footer states desktop tools persistent, mobile retains its menu. Diagram is a proposal, not an implemented UI screenshot.

## 实现结构

`DesktopToolDock` 独立挂载在 `AppLayout` 的工作区右上角，读取现有右侧工具状态。只在与工具区重叠的最上方标签容器预留宽度，不修改 `SessionTabs` 和 `SessionIdentity`，不重建标签子树。面板打开时预留顶部空间，放大时保持工具组同一 DOM 和坐标。网格、列表没有标签行时，预留一行工具高度。手机继续使用既有菜单。

工具上下文复用当前选中会话项目与 VS Code 固定项目规则；无项目时文件和终端禁用。收起不关闭实例。观察器只响应布局结构和尺寸变化，忽略流式文本追加。验收见 [acceptance.md](acceptance.md)。
