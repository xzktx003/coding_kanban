# 导航 A 实施验收（2026-10-08）

用户已确认推荐 A，并要求一键深浅色切换。入口：[局域网 HTTPS / 8484](https://10.30.0.24:8484/?mode=session)。现有 Vite 监听 `0.0.0.0:8484`，以热更新生效，未重启运行层或 Agent。

## 交付

- 单行项目会话列表，明确项目边界，常显小型 Agent 标识，状态和时间同行，固定操作槽；双下箭头分页有加载/错误反馈。
- 单窗口组将项目菜单、标签、工具合成 44px 栏；删除“/ 会话”。多窗口组继续各自管理标签。
- 右上角太阳/月亮按钮切换深浅色，复用本机主题存储；顶栏、离线页、列表、输入区及会话 portal 一起切换，终端模式根不受影响。
- 完整标题支持键盘 tooltip；浮层不遮挡操作按钮。同名跨项目标签显示项目后缀。Claude 分页补充防重复、项目代次隔离和失败重试。
- 功能清单、概览、bug 清单与 [行为文档](../../session-navigation-a.md) 已同步。

## 红绿灯证据

- 初始导航测试：5 失败 / 6 通过，明确暴露无主题按钮、无图标及未合并栏。记录 `.dev-runtime/nav-red.log`。
- Claude 分页新增测试：3 失败；修复后通过，覆盖受控列表、失败重试、重复点击和过期响应。记录 `.dev-runtime/nav-pagination-red.log` 与后续单测日志。
- 实际浏览器发现完整标题浮层拦截菜单点击，修复 pointer-events 后同一用例转绿。

## 最终检查结果

| 检查 | 结果 | 记录 |
| --- | --- | --- |
| `pnpm check` | 共享包、后端、前端类型检查与生产构建通过 | `.dev-runtime/nav-check-final.log` |
| `pnpm --filter web test:session` | 158 文件、491 用例全部通过 | `.dev-runtime/nav-full-session-final.log` |
| 导航 A 与主题、长标题、菜单、跨项目切换 | 2 个浏览器用例通过 | `.dev-runtime/nav-verified-e2e.log` |
| VS Code 跟随/固定、别名去重、未保存缓冲、刷新/缩窄 | 375px 与 1440px 两用例通过，含 900px 工具溢出 | 同上 |
| 分屏、标签排序/关闭/刷新、网格/列表/大量标签 | 3 个浏览器用例通过 | `.dev-runtime/nav-final-e2e.log` 中对应通过用例 |
| 现行输入框：展开编辑草稿、图片标注/附件撤销 | 2 个浏览器用例通过 | `.dev-runtime/nav-composer-e2e.log` |
| 真实运行页面 | health HTTP 200，主题切换与刷新成功，1 个主题按钮，无页面异常或横向溢出 | `.dev-runtime/navigation-a/live-check.json` |
| 工作区 | `git diff --check` 通过；`.env` 被忽略、`.env.example` 未被忽略 | 本轮 shell 检查 |

上述 9 个浏览器场景来自分批检查，不是全仓 E2E 总数。导航覆盖 1440/1024/900/768/390/320px；浏览器测试使用隔离 API 数据，真实页面只做访问和本机主题切换，不发送任务。

## 截图

实际运行页面：

- 深色（本地产物：`../../../.dev-runtime/navigation-a/live-dark.png`，不随仓库发布）
- 浅色（本地产物：`../../../.dev-runtime/navigation-a/live-light.png`，不随仓库发布）

隔离数据验收：`.dev-runtime/navigation-a/desktop.png`、`light.png`、`collapsed.png`、`drawer-390.png`、`drawer-320.png`、`mobile-390.png`、`mobile-320.png`。

## 验收边界

- 曾扩大运行旧 `session-drafts.spec.ts`：部分用例仍查找旧 `.session-attachment` 节点、拦截旧发送路径，与当前输入框版本不匹配；中途停止该批，保留 `.dev-runtime/nav-regression.log`。本次未把旧草稿整套 E2E 声称为通过，改用现行输入框的编辑/图片回归，加上导航测试的主题切换、刷新与草稿保留检查。
- 分屏/标签组合运行中的旧导航和 VS Code 定位断言曾失败，后续修复 tooltip 与更新工具溢出测试后，相关 4 个用例在独立运行中全绿；早期失败日志保留。
- 完整会话单测的首轮有一个并行工作区中的旧问题表单步骤断言失败，当前工作区同步后最终 491 用例全绿。
- 生产构建仍有已有的大 chunk 提示；本轮未改打包拆分策略。
- 局域网地址由本机 Chromium 实测，未从另一台物理设备测试；移动验收是浏览器视口模拟。
- 工作区存在其他并行功能修改，本次未清理、重置或提交这些修改。
