# 聚焦返回与显示页面 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 从宫格回到上次聚焦，并在聚焦视图用可命名的显示页面保存、切换多套分屏。

**Architecture:** 新增 `terminal-monitor-pages-v1`，把现有单份 `TerminalWorkspaceState` 包进页面列表。`AgentFocusView` 只渲染当前页，并把它的改动写回该页。宫格的「返回上次」只恢复离开时的 session id，页面状态负责布局。

**Tech Stack:** React、TypeScript、node:test 静态渲染、Playwright、localStorage。

**Spec:** `docs/superpowers/specs/2026-09-23-focus-pages-design.md`

## Global Constraints

- 默认页名称固定为「默认」，不可改名、不可删除。
- 有两页及以上时渲染页面标签；「屏幕布局」菜单末尾始终列出同一份页面，并可新建、关闭。两处切换效果相同。
- 同一 session 可以出现在多个页面。
- 非当前页不挂真实终端。
- 页面状态只存本机浏览器，不进后端。
- 不改 `Alt+Q` 的返回宫格语义。

---

### Task 1: 页面状态模型

**Files:**
- Create: `apps/web/src/lib/terminal-monitor-pages.ts`
- Create: `apps/web/src/lib/terminal-monitor-pages.test.ts`
- Modify: `apps/web/src/lib/terminal-workspace-state.ts`

**Interfaces:**
- Produces:
  - `TerminalMonitorPage { id: string; name: string; state: TerminalWorkspaceState }`
  - `TerminalMonitorPagesState { activePageId: string; pages: TerminalMonitorPage[] }`
  - `loadTerminalMonitorPages(storage?): TerminalMonitorPagesState`
  - `saveTerminalMonitorPages(state, storage?): void`
  - `createTerminalMonitorPage(state): TerminalMonitorPagesState`
  - `renameTerminalMonitorPage(state, pageId, name): TerminalMonitorPagesState`
  - `deleteTerminalMonitorPage(state, pageId): TerminalMonitorPagesState`
  - `updateActiveTerminalMonitorPage(state, workspace): TerminalMonitorPagesState`

- [ ] **Step 1: 写失败测试**

覆盖：空存储得到唯一「默认」页；旧 `terminal-monitor-workspace-v1` 迁入默认页；新建页名为「页面 2」并成为当前页；默认页改名、删除都无变化；重名或空白名称被拒绝并保持原状态；删除当前非默认页后当前页变为前一页；已保存状态可原样读回。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter web exec tsx --test src/lib/terminal-monitor-pages.test.ts`
Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现纯函数**

`load` 优先读新键；没有新键时用 `loadTerminalWorkspaceState()` 的结果做默认页。页 id 使用 `terminal-monitor-page-<递增数字>`。名称比较前 trim。

- [ ] **Step 4: 跑测试确认通过**

- [ ] **Step 5: Commit**

`feat: add named terminal monitor pages`

### Task 2: 聚焦视图接入页面

**Files:**
- Modify: `apps/web/src/components/AgentFocusView.tsx`
- Modify: `apps/web/src/components/AgentFocusView.test.ts`
- Modify: `apps/web/src/app.css`

**Interfaces:**
- Consumes: Task 1 的页面状态 API。
- Produces: `data-testid="focus-page-add"`、`focus-page-tab-<id>`、`focus-page-rename-<id>`、`focus-page-delete-<id>`。

- [ ] **Step 1: 写失败测试**

静态渲染断言：没有已存页面时不出现页面标签，出现「＋」；存了第二页时当前页高亮、另一页存在；默认页没有删除按钮。用源码断言非当前页的 pane 走现有 `suspended` 路径，不新增终端挂载。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter web exec tsx --test src/components/AgentFocusView.test.ts`

- [ ] **Step 3: 接入**

`AgentFocusView` 用页面状态替换直接读写 `terminal-monitor-workspace-v1`。现有布局 effect 改为写当前页。标签放在 `.focus-layout-menu` 后，紧凑成一行：当前页、其它页、加号。双击非默认标签进入输入框，Enter 保存，Escape 取消。

- [ ] **Step 4: 跑测试确认通过**

- [ ] **Step 5: Commit**

`feat: switch focus layouts from named pages`

### Task 3: 宫格返回上次

**Files:**
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/components/TopBar.tsx`
- Test: `apps/web/src/components/TopBar` 现有测试或新增同目录测试

**Interfaces:**
- Consumes: `viewMode`、`focusedId`。
- Produces: TopBar 可选 `onReturnToLastFocus?: () => void`，按钮 `data-testid="return-last-focus"`。

- [ ] **Step 1: 写失败测试**

无回调时不渲染按钮；有回调时渲染「返回上次」。

- [ ] **Step 2: 跑测试确认失败**

- [ ] **Step 3: 实现**

`App` 在 `handleExitFocus` 前记住当前 `focusedId`。宫格且该 session 仍在 `sessions` 中时把回调传给 TopBar。点击调用现有 `handleFocusSession`。

- [ ] **Step 4: 跑测试确认通过**

- [ ] **Step 5: Commit**

`feat: return from the grid to the last focus`

### Task 4: 文档与端到端验证

**Files:**
- Modify: `docs/func_list.md`
- Modify: `docs/project-overview.md`
- Modify: `memories/repo/func_list.md`
- Modify: `tests/e2e/discovery-new-session-ui.spec.ts` 同目录新增 `tests/e2e/focus-pages.spec.ts`

- [ ] **Step 1: 写 Playwright 用例**

用路由 mock 两个 session。进入聚焦后断言只有加号；点击加号出现「页面 2」；切回「默认」后再切到「页面 2」，页面标签的 `aria-pressed` 与当前页一致。宫格路径：进入聚焦、返回宫格、断言「返回上次」、点击后回到聚焦。

- [ ] **Step 2: 跑该用例**

Run: `PLAYWRIGHT_SKIP_WEBSERVER=1 PLAYWRIGHT_BASE_URL=https://127.0.0.1:8484 pnpm exec playwright test tests/e2e/focus-pages.spec.ts --reporter=line`

- [ ] **Step 3: 更新功能清单**

写明默认页、加号新建、改名删除、宫格「返回上次」。

- [ ] **Step 4: 跑相关单测**

Run: `pnpm --filter web exec tsx --test src/lib/terminal-monitor-pages.test.ts src/components/AgentFocusView.test.ts`

- [ ] **Step 5: Commit**

`docs: record focus pages and return-to-focus`
