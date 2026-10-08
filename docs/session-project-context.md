# 会话项目归属

2026-10-08 按已确认的推荐 A 实施。开发访问：**HTTPS，端口 8484，https://10.30.0.24:8484/?mode=session**；前端监听 `0.0.0.0`，地址来自本机运行配置，未写入产品源码。

## 行为

- 标签、自由分屏的每组标签、网格卡片和列表收起项共用 48px 身份块：会话名 13px，项目名 11px。项目始终显示；两行独立截断。状态、关闭与 Agent 标识保留。
- 删除独立项目栏；网格/列表同时删除重复的全局标签条。布局选择、工具入口、主题按钮和侧栏展开入口位于全局顶栏，窄屏布局/工具在“更多功能”中。
- 网格/列表的“排列会话”菜单前后移动关注项，更新共享顺序与原窗口组内的次序，不改变选中项或组归属。关闭仍只移出关注集合，不停止 Agent、不删除历史或工作树。
- 项目详情来自该会话的 `cwd` / `worktreePath`。同名目录按最短唯一尾路径显示；工作树追加短名，详情给出完整执行目录和所属项目。未知目录显示“项目未知”，不借用全局 `cwd`。
- 查看/复制项目详情不选择会话、不切换输入目标。定位侧栏在菜单关闭后再转移焦点，避免弹出菜单的自动焦点恢复抢回焦点。
- 工具入口显示选中会话的项目；打开时使用其执行目录。未知目录禁用依赖项目的入口；已固定的 VS Code 仍可打开固定项目。ACP 当前只有一个工作区，沿用其 session/new/load 显式设置的目录。
- 公共输入框内部低强调显示“发送至 会话名 · 项目”；不改变会话草稿键、附件、发送、问题回答或模型选择。

## 代码边界

`SessionIdentity` / `sessionProject` 共用身份和项目详情；`SessionTabs`、`AgentCardHeader` 复用；`SessionTopNavigation` 承担全局控件。`SessionGroups` 保持窗口组与拖放语义，`AgentViewHeader` 仅为 ACP 单会话展示身份。样式限定在 `.session-mode`，项目菜单继续使用既有主题 Portal。

## 验收

记录目录：`.dev-runtime/project-context-v2/`。修改前目标文件快照保存在 `before/`，未覆盖仓库已有的其他会话改动。

- 红灯：`red-ui.log` 记录原卡片没有项目详情、未知项目与排列入口的 3 个失败用例；`red.log` 记录新增目录解析接口尚未实现。
- 最终 `pnpm check` 通过共享包、后端和前端类型检查及生产构建（`check-final.log`）；最后一次前端生产构建亦通过（`build-last.log`）。仅保留既有大资源包提示。`git diff --check` 通过。
- 全量会话 Vitest：165 个文件、522 项通过（`unit-acceptance.log`）；随后共用全局项目入口补充红绿灯，定向 2 文件、11 项通过（`red-global-entry.log`、`shared-entry-green.log`）。最后保留原生手机外壳独立提供 ACP 标题的规则，相关 5 项通过（`native-header.log`），最终前端类型检查通过（`types-last.log`）。
- 浏览器主回归 8 项全部通过（`browser-green.log`）：跨项目分屏、所有布局、排序/关闭/刷新、发送目标、草稿、主题、抽屉与焦点、20 标签滚动、375/1440px VS Code 固定/跟随及未保存内容保留。
- 额外 3 项浏览器测试通过（`browser-composer.log`）：展开编辑器与模式切换、图片标注与撤销、320/390px 网格/列表控件和新聊天入口，共 11 项。
- 实测标签/卡片头均为 48px；无独立项目栏，网格/列表无重复标签条。1440/1024/900/768/390/320px 没有页面横向溢出；320px 顶栏侧栏、主题、更多按钮全部位于视口内。手机分屏正文高度实测 595/900px。
- 首轮浏览器发现定位侧栏后的焦点被菜单抢回，以及 320px 顶栏右端被裁切，均已修复并通过最终回归。旧回归中的“项目按钮在标签左侧”“点击卡片头中央选择”等断言已按新布局更新为顶栏入口与点击会话标题；项目详情点击仍严格验收不切换。分屏新增断言曾因 innerText 换行与 textContent 不同失败，已统一文本读取，最终用例通过。
- 真实局域网服务：`0.0.0.0:8484` 监听，前端与 `/api/session/health` 均 HTTP 200；无 fixture 的浏览器加载无 pageerror（`live-check.json`）。未重启运行层、未停止真实 Agent。
- 浏览器操作使用独立页面上下文和 API fixture；发送、关闭、排序、恢复均不操作用户真实 Agent。实际服务仅做只读加载/健康检查。
- 截图：`tabs.png`、`grid.png`、`list.png`、`light.png`、`width-768.png`、`width-390.png`、`width-320.png`。
- 手机尺寸由 Chromium 模拟；未将模拟视口测试描述为独立实体手机验收。

## 截图

标签（本地产物：`../.dev-runtime/project-context-v2/tabs.png`，不随仓库发布） · 跨项目分屏（本地产物：`../.dev-runtime/project-context-v2/split.png`，不随仓库发布） · 网格（本地产物：`../.dev-runtime/project-context-v2/grid.png`，不随仓库发布） · 列表（本地产物：`../.dev-runtime/project-context-v2/list.png`，不随仓库发布） · 浅色（本地产物：`../.dev-runtime/project-context-v2/light.png`，不随仓库发布） · 320px（本地产物：`../.dev-runtime/project-context-v2/width-320.png`，不随仓库发布）
