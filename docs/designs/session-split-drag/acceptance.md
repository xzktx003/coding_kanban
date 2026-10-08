# 自由分屏修复与标签跟随验收

- 日期：2026-10-08。
- 联调地址：`https://10.30.0.24:8484/?mode=session`，现场请求 HTTP 200。
- 状态：实现完成，相关单测 39 项、浏览器联合回归 17 项、前端类型检查与生产构建全部通过。

## 红绿灯与自查

| 场景 | 修复前 | 当前结果 |
| --- | --- | --- |
| 从标签项目名起拖 | 打开菜单，无分屏 | 可分屏；点击仍打开详情 |
| 单标签分屏 | 提示分屏但无布局变化 | 保留可新建/关闭的空组，会话唯一，刷新可恢复 |
| 临时保留的未关注标签 | 放下时找不到 source | 可移动；不重新加入关注集合 |
| 正文边框外 5px 松手 | 落点被清除 | 小范围容差内可分屏 |
| Esc 跨窗口取消 | 松手误点击别组，输入目标切换 | 保持原目标，清理预览 |
| 失焦跨窗口取消 | 松手误切换目标 | 保持原目标，清理预览 |
| 空组放入现有标签后再关闭 | 空组标记遗留，无法正常收拢 | 标记清理，正常合并 |
| 拖动时跟随反馈 | 标签固定在原位，无副本 | 浮动副本按抓取偏移跟随鼠标，原标签变淡 |
| 浮动标签命中与标识 | 新功能的约束 | 副本不参与 elementFromPoint 命中、不复制真实标签 ID；松手仍正确分屏 |

四方向快速松手、嵌套三窗口、跨组移动、标签排序、输入目标、安全关闭、刷新恢复、标签溢出与 390px/320px 手机导航均通过。浏览器用真实鼠标事件操作实际前端，API 由隔离 fixture 接管；未向真实 Agent 提交测试任务。手机为浏览器宽度模拟，未使用实体手机。

## 本地截图

截图按仓库规则被 Git 忽略，不随代码提交；文件位于本目录：

- `tab-following-center.png`：标签跟随鼠标。
- `tab-following-mouse.png`：跟随期间正文右边分屏高亮。
- `split-{left,right,top,bottom}.png`：四个方向的分屏结果。

## 检查命令

```sh
pnpm --filter web exec vitest run --config vitest.session.config.ts \
  src/session-mode/stores/useSessionSplitStore.test.ts \
  src/session-mode/components/agent/sessionTabDrag.test.ts \
  src/session-mode/components/agent/SessionTabs.test.tsx \
  src/session-mode/components/agent/SessionProjectIdentity.test.tsx \
  src/session-mode/hooks/useSessionTabs.test.tsx

PLAYWRIGHT_SKIP_WEBSERVER=1 PLAYWRIGHT_BASE_URL=https://10.30.0.24:8484 \
  pnpm exec playwright test tests/e2e/session-split.spec.ts \
  tests/e2e/session-tabs.spec.ts tests/e2e/session-project-context.spec.ts \
  tests/e2e/session-split-drag.spec.ts

pnpm --filter web build
```

生产构建保留既有的大文件分块提示，无类型或构建错误。功能、持久化和交互边界见 [实现说明](../../session-split-drag.md)。

## 整合提交复核（2026-10-08）

- `pnpm check` 通过（shared、server、web 类型检查及生产构建）。
- `pnpm test` 全部通过：后端 631、终端前端 526、会话前端 577、脚本 95，共 1,829 项通过；另有 1 项仅 macOS 适用的后端测试跳过。
- 局域网 HTTPS / 8484 的隔离浏览器联合回归 34/34 通过，覆盖关注菜单、分屏拖拽、项目身份、标签恢复、功能页返回、模式隔离与常驻工具。
- 暂存 diff 检查、敏感内容扫描和 `.env` 忽略检查通过；未重启正式服务。源码在验证期间保持一致。
- 日志位于 Git 忽略的 `.dev-runtime/publish-{check,test,e2e}.log`。
