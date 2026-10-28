# 功能缺口核实结果（阶段 0，2026-10-27）

方案 §5 中标「待核」的四项已实查。**两项结论与初版假设不同**，均以实际代码为准。

## 1. `useCtrlEnterToSend` —— 缺口确认存在

现状：`components/cc/composer/Composer.tsx:186` 只有一条规则

```ts
if (e.key === "Enter" && !e.shiftKey) {   // 发送
```

官方插件有 `claudeCode.useCtrlEnterToSend` 配置项，可切换为 `Ctrl/Cmd+Enter` 发送、
裸 Enter 换行。本项目**没有该开关**，也没有读取任何等价设置。

结论：真实缺口，纯前端可补。需同时覆盖 IME 组合输入（`isComposing`）边界。

## 2. Compact —— 缺口确认存在，但原因与假设不同

初版方案写「会话模式有相关实现，需确认 Claude 侧可用性」。实查后要更正两点：

- 会话模式里命中的 `compact`，绝大多数是**无关同名**：
  - `session-compact-composer` / `session-compact-frame` / `session-compact-body`
    （`codex/composer/Composer.tsx:707,829,836`）是**紧凑布局**的 CSS 类，与上下文压缩无关
  - `bindings/AutoCompactTokenLimitScope.ts`、`ClientRequest.ts` 等是 **Codex 协议**
    的 TS 绑定，不适用于 Claude
- Claude 侧唯一命中是 `claude/config.ts:185` 的斜杠命令白名单里有 `"compact"`，
  即用户**可以手动输入 `/compact`**，但没有任何 UI、没有自动压缩、
  没有 `compact_boundary` 事件渲染

结论：真实缺口。SDK 侧有 `autoCompactEnabled` / `autoCompactThreshold` /
`PreCompact`·`PostCompact` hooks / `compact_boundary` 可用（见方案 §4.1）。
需要渲染压缩边界标记并暴露设置。

## 3. Worktree —— **不是缺口**，Claude 侧已有

初版方案写「看板有 worktree，Claude 侧入口待核」。实查结论：**Claude 侧已经有**。

命中位置：

```
components/cc/session/SessionListItem.tsx
components/cc/session/useSessionActions.ts
components/cc/session/useSessionActions.copy.test.tsx   （已有回归）
stores/cc/ccStore.ts
```

另外 `claude/history.ts:192,197` 会把 `.codexia/worktrees/` 下的会话从全局列表过滤掉，
说明后端也已按 worktree 语义处理，并有 `history.test.ts` 覆盖。

结论：**从缺口清单移除**。对齐时保留现有能力，只核对入口在官方视觉语言下的呈现位置。

## 4. `archiveInactiveSessions` —— 缺口确认存在

`components/cc/` 下 `archive` / `Archive` 命中 **0 处**。

官方插件有 `claudeCode.archiveInactiveSessions` 配置项。SDK 侧有 `tagSession`
与 `listSessions` 可用于实现（见方案 §4.1）。

结论：真实缺口。需定义「inactive」判定与归档后在会话列表的呈现，
且不得与看板既有的「关闭仅移出关注集合」语义冲突——归档是更强的状态，
必须显式区分，不能让关闭标签被误解为归档。

## 汇总

| 项 | 初版假设 | 实查结论 |
| --- | --- | --- |
| `useCtrlEnterToSend` | 待核 | **缺口**，纯前端 |
| Compact | 可能已有 | **缺口**；此前命中均为同名 CSS 类与 Codex 绑定 |
| Worktree | 待核 | **非缺口**，Claude 侧已有且有回归 |
| `archiveInactiveSessions` | 待核 | **缺口**，SDK `tagSession` 可支撑 |

方案 §5 的缺口表据此修订：移除 Worktree 一行，其余三项标注为已确认缺口。
