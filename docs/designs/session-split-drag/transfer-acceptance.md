# 标签栏跨组插入验收

- 日期：2026-10-08。
- 局域网地址：<https://10.30.0.24:8484/?mode=session>，HTTPS / 8484。
- 结果：相关单测 **58 项通过**、浏览器联合回归 **31 项通过**，`pnpm check` 通过共享包、后端及前端类型检查和生产构建。

## 完成的交互与验收

| 场景 | 验收结果 |
| --- | --- |
| 拖到另一组标签左半 / 右半 | 分别插到该标签之前 / 之后，组内顺序和共享关注顺序一致 |
| 标签间隙、末尾空白 | 插到邻居之间 / 追加到末尾 |
| 空窗口组的标签栏 | 接收标签，清除空组保留标记，后续可正常收拢 |
| 拖动反馈 | 浮动标签跟随鼠标；标签栏显示竖直插入线，正文分屏预览不同时出现 |
| 溢出标签栏 | 鼠标停留在左右边缘持续滚动；重新计算实际落点，能插到最初隐藏的末尾标签之后 |
| 滚动后取消 | Esc 停止滚动并清理插入线、副本；布局及输入目标保持原值 |
| 跨组松手 | 激活目标组内的移动会话，输入栏同步；源组普通空窗口自动收拢 |
| 身份与草稿 | 会话标识、元数据、工作目录、关注成员和两边未发送草稿保留 |
| 刷新 | 分组、标签顺序及草稿恢复 |
| 同组前后排序 | 精确插入与共享集合顺序一致，保留已有键盘排序语义 |
| 菜单、新建及工具按钮 | 排除为拖放落点，不误开菜单、不创建会话 |
| 目标组消失或插入锚点无效 | 取消放置，不误改共享顺序 |
| 既有能力 | 四方向正文分屏、嵌套三窗口、跟随预览、失焦取消、安全关闭、网格/列表顺序及菜单回归通过 |
| 手机布局 | 390px / 320px 浏览器视口下既有会话导航及相关菜单回归通过 |

首轮红灯为 8 项单测失败、7 项浏览器用例失败。实现后转绿；自查补充了菜单按钮排除、同组前后插入、左右边缘停留滚动和隐藏末尾落点用例。溢出测试准备曾将会话 1 匹配到会话 10，已改成数字边界正则并逐项验证标签存在；最终 14 个标签完整保留。

浏览器通过局域网访问实际前端，使用真实 Chromium 鼠标事件；API 和 WebSocket 由隔离 fixture 接管，未向真实 Agent 提交或中断任务。手机验收为浏览器视口模拟，未做实体手机测试。生产构建保留既有大文件分块提示，没有类型或构建错误。

## 截图与记录

- [前插预览](transfer-before.png)
- [后插预览](transfer-after.png)
- [空白追加预览](transfer-blank.png)
- [滚动至隐藏末尾后的插入预览](transfer-after-scroll.png)
- [校验结果及源码 SHA-256](transfer-verification.json)

截图和 JSON 按仓库规则被 Git 忽略，保留在本地验收目录。日志位于 `/tmp/session-transfer-final-{unit,browser,check}.log`。源码摘要记录的是包含工作区改动的验收版本，不能仅用基线提交号代表本次实现。

## 复现命令

```sh
pnpm --filter web exec vitest run --config vitest.session.config.ts \
  src/session-mode/components/agent/sessionTabDrag.test.ts \
  src/session-mode/stores/useSessionSplitStore.test.ts \
  src/session-mode/stores/useAgentCenterStore.tabs.test.ts \
  src/session-mode/components/agent/SessionTabs.test.tsx \
  src/session-mode/components/agent/SessionProjectIdentity.test.tsx \
  src/session-mode/hooks/useSessionTabs.test.tsx \
  src/session-mode/components/agent/FollowedSessionsMenu.test.tsx

PLAYWRIGHT_SKIP_WEBSERVER=1 PLAYWRIGHT_BASE_URL=https://10.30.0.24:8484 \
  pnpm exec playwright test tests/e2e/session-tab-transfer.spec.ts \
  tests/e2e/session-split.spec.ts tests/e2e/session-split-drag.spec.ts \
  tests/e2e/session-tabs.spec.ts tests/e2e/session-project-context.spec.ts \
  tests/e2e/session-followed-menu.spec.ts --reporter=line

pnpm check
```

功能说明见 [自由分屏与标签拖放](../../session-split-drag.md)，此前跟随预览的历史验收保留在 [原验收记录](acceptance.md)。
