# 会话模式 × Codex VS Code 插件 对齐：交接计划（2026-10-28）

这份文档是给**接手的 agent** 用的，不依赖任何对话上下文。目标需求原文：

> 全面优化会话模式，UI 和 UI 交互严格和 Codex VS Code 插件保持一致（除了我们特有的功能），包括会话栏、输入栏（含输入栏上面的小凸起等），也优化多终端同时访问体验。请全面优化并做严格验收。

读完第 1～3 节再动手。第 2 节的决策已经由用户拍过，**不要重新征求**；第 6 节的子决策还没拍，**不要自行替用户决定**。

---

## 1. 逆向基线与关键坑（先读，能省几小时）

### 官方产物

基线 VSIX `26.51007.21434`，解包在：

```
third_party/openai.chatgpt-26.51007.21434-linux-x64/extension/webview/assets
```

相关 chunk 与偏移（本轮已核对过的，直接用）：

| 文件                                   | 用途                                 |
| -------------------------------------- | ------------------------------------ |
| `app-initial-fee819fe4f22.js`          | 撤销栈、ChatGPT 会话归档、模型设置   |
| `app-initial-41ab338a184f.js`          | Codex 本地 thread 动作、行菜单       |
| `app-initial-c4ebaa710049.js`          | React 运行时等（注意同名函数假阳性） |
| `zh-CN-b05cfd55c534.js`                | zh 文案，parity 文案的唯一事实来源   |
| `composer-utility-bar-f7a08ac0c453.js` | 184KB，**未审计**                    |
| `composer-controls-7a6be63cddcf.js`    | 239KB，**未审计**                    |

**压缩别名在不同 chunk 里会撞名也会分叉**，不要顺着别名链找（本轮在 `MP`→`x3r`/`d1n` 上浪费过时间；`c4ebaa710049.js` 里的 `bu` 是 React 自己的事件注册器，不是应用的撤销包装）。**按函数体定位行为**，别按别名。

### 测试命令

从 `apps/web` 跑：

```bash
npx vitest run --config vitest.session.config.ts <路径> --reporter=verbose
```

漏掉 `--config` 会报 `document is not defined`。

### 已知坑

- **`@testing-library/user-event` 没装**，house 写法是 `fireEvent.keyDown`。
- **`jest-dom` 没装**，`toHaveAttribute` / `toHaveClass` / `toBeDisabled` 全部不可用，改用 `el.getAttribute(...)`。
- **zustand store 是模块单例**，同文件内测试之间会串状态，`beforeEach` 必须显式铺基线。
- **不要手搓 `ConversationOwnerForm` 的 target**。`run()` 里 `assertCurrent()` 会校验 operation scope，`scope: null` 会直接 `TypeError`。用生产的 `captureConversationForm(kind, {...})` 造。
- vitest 日志里有控制字节，`grep` 要带 `-a`。
- 全量 sweep 和对 assets 目录的宽 grep 会超 120s 前台超时，用 `run_in_background` + `until grep -aq ...`。
- zsh 下 `--include=*.ts` 会被 glob 掉，必须引号：`--include='*.ts'`。
- prettier 不在 PATH，用 `apps/web/node_modules/.bin/prettier`。
- 本工作树**有其他进程在共用**：曾被外部 `pnpm install --frozen-lockfile` 清掉 `node_modules`，`docs/debug_list.md` 曾被外部回滚。dev server 占用 8282（后端）/ 8484（前端 https）。

### house 测试约定

参照 `ConversationMenu.owner-forms.test.tsx`：`vi.hoisted` 的 api 对象 → `vi.mock("@session/services/apiAdapt/codex", () => ({...api, threadAccess: vi.fn()}))` → `vi.mock("@session/services/apiAdapt/git", () => api)` → `vi.mock("sonner", ...)` → `vi.mock("@session/services/codexService", ...)`；`beforeEach` 里 `resetConversationFormDraftsForTests()` + `vi.clearAllMocks()` + 显式铺 `useLayoutStore` / `useCodexStore` / `useSessionDraftStore`；被测组件包在 `<div className="session-mode">` 里。

### 验收纪律（CLAUDE.md 强制）

- 先红后绿，**红灯必须红在缺功能上**，不是红在测试自身写错（本轮踩过两次：一次 scope `TypeError`，一次菜单标签找不着）。
- 绿灯后做**双向探针**：把实现改坏，确认对应断言失败且否定对照仍通过。探针必须回滚并 `diff` 验证。
- 新功能同步 `docs/func_list.md`；改产品概览/架构边界同步 `docs/project-overview.md`。
- 每修一个 bug 追加 `docs/debug_list.md`，必要时同步 `memories/repo/debug_list.md`。
- 收尾：全量 sweep（基线 **632 文件 / 4006 项通过**）、`tsc --noEmit -p tsconfig.json`、prettier。

### 既有的、不要去"修"的失败

- `CodexMarkdown.tsx` 的 12 个 `TS2322`（双份 `@types/react` 19.1.17 / 19.2.14 导致），改动前后一致。
- `session-thread-workflows.spec.ts:554` 的 4 个 plan 窗口弹窗 E2E 失败。
- `native-full-access-confirmation.css` 的 prettier 失败在 HEAD 就存在（`git show HEAD:…` 验证过）。

---

## 2. 已决策（用户已拍，照做）

| #   | 议题                                       | 决策                                                              |
| --- | ------------------------------------------ | ----------------------------------------------------------------- |
| 1   | 行右键菜单中文化会连带改两处既有测试断言   | **批准**，按官方 zh 一并中文化，同步改断言                        |
| 2   | 归档确认框四变体 vs 我们"不中断 Agent"约束 | **补变体，保留不停 Agent 语义**（结构对齐官方，语义守住项目约束） |
| 3   | 执行顺序                                   | **A → B → F → C → D → E**                                         |

决策 2 的含义：标题和按钮按官方分变体，**描述文案改成说明我们的实际行为**。注意这里还有一个未闭合的子决策，见第 6 节 —— 不要直接把按钮写成「停止并归档」然后实际不停 Agent。

---

## 3. 已完成（不要重做）

**归档撤销（composer 归档确认框那条路）** —— 已绿、已双向验证、探针已回滚。

逆向结论推翻了一条早期误判，记下来免得再犯：官方有**两条**归档路径，之前被混成一条。

- `sSi`（fee819 @3563895）那个带 **撤销 + 查看** 的「已归档的聊天」toast，**只属于 ChatGPT 会话**，只经 `chatgpt:${id}` 到达，"查看"打开 `lSi = https://chatgpt.com/#settings/DataControls/ArchivedChats`。和我们无关，照搬等于凭空发明行为。佐证：`gvi`/`bvi`（toast 标题与动作构造器）除 `sSi` 外无其他调用点；`codex.archiveInfo` 在 `41ab` chunk 里出现 **0** 次。
- 我们对应的是 Codex 本地 thread 路径：`GG`（41ab @2428310）→ `s2n`（@2425337）→ `Tx`（@329264）→ `ZMt`（@323732）。这条路**成功时不弹 toast**，而是注册 `wjt = 6e4`（60 秒）的撤销事务，`undo` 调 `unarchiveConversation(id, {restorePin: true})`，`appUndo.threadArchived`（zh `聊天已恢复`）只在撤销**之后**才弹，由全局 `kj("undoAppAction", …)` 键盘命令触发。

落地：

| 文件                                                    | 状态                                                                                                             |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `composer/archiveThreadUndo.ts`                         | 新增。60s 窗口、`撤销` 动作、`聊天已恢复` / `取消归档对话失败`、按原索引还原 thread 与关注卡片、`spent` 单次保护 |
| `composer/ConversationOwnerForms.tsx`                   | 归档成功挂撤销条目；删除不挂（官方同样永久）                                                                     |
| `composer/ConversationOwnerForms.archive-undo.test.tsx` | 新增，**9 项全绿**                                                                                               |

两处有意偏离，已写在 `archiveThreadUndo.ts` 注释里：

1. 官方撤销挂在全局 `undoAppAction` 键盘命令 + 应用级撤销栈上；我们整个 session-mode 没有撤销栈（`grep -e undoStack -e appUndo -e useUndo` 零命中），所以撤销条目挂在通知本身。对用户可观测的 60s 窗口和撤销后文案是一致的。
2. 官方 `restorePin` 恢复的置顶位我们没建模；改为按原索引还原，让撤销是真逆操作，而不是重新插入打乱侧栏顺序。

探针记录：

| 探针                                | 预期                          | 实测              |
| ----------------------------------- | ----------------------------- | ----------------- |
| 去掉 `action`                       | 门用例全失败，否定对照通过    | 7 失败 / 2 通过 ✓ |
| 撤销改读 store 的 `currentThreadId` | 只「绑定到被归档 thread」失败 | 1 失败 / 8 通过 ✓ |
| 去掉 `spent` 保护                   | 只「二次点击」失败            | 1 失败 / 8 通过 ✓ |

回滚后复跑 9/9 绿，`diff` 与备份一致，无 `PROBE` 残留。

**尚未做**：`docs/func_list.md`、`docs/debug_list.md` 同步，以及全量 sweep —— 和后续几项一起收尾。

---

## 4. 待办 A：侧栏行归档反馈（红灯已在，优先做）

**现状缺陷**（`thread/ThreadList.tsx:320-332`）：

```tsx
const handleArchive = useCallback(
  async (threadId: string) => {
    try {
      await archiveThread(threadId);
      removeFromNavigation(threadId);
    } catch (err) {
      toast.error("Failed to archive thread", { description: String(err) });
      return;
    }
    refresh();
  },
  [refresh, removeFromNavigation],
);
```

两个问题：成功时**完全无提示**（侧栏归档是静默的）；失败时报未翻译的英文。

**官方对应**：`GG`（41ab @2428310）的 catch 走 `KG.archiveThreadError`，zh = `聊天归档未成功`。

已核对的 zh 文案（别再去 grep 一遍）：

| key                                              | zh                 |
| ------------------------------------------------ | ------------------ |
| `threadActions.archiveThread.archiveThreadError` | `聊天归档未成功`   |
| `localTaskRow.archiveError`                      | `无法归档对话`     |
| `localTaskRow.unarchiveError`                    | `取消归档对话失败` |
| `threadArchiveHistory.redoError`                 | `未能归档对话`     |

本路径用 `聊天归档未成功`（`GG` 的 catch 就是这一条）。

**改法**：

1. 成功时复用第 3 节已完成的 `archiveUndoNotice(threadId, snapshot)` + `captureArchivedThread(threadId)`，让侧栏和 composer 两个入口行为一致。
2. 失败文案换成 `聊天归档未成功`。

注意 `ThreadList.tsx:60` 的 `toast` 来自 `@session/components/ui/use-toast`（不是直接的 sonner），它既可当函数调用也有 `.error`/`.success`，但**没有 `.message`**。复用 `archiveUndoNotice` 时要确认透传路径：`use-toast` 的 `error`/`success` 只转发 `description` 和 `position`，**会丢掉 `action` 和 `duration`**。所以这里要么直接从 `sonner` 导入 `toast.message`，要么给 `use-toast` 补透传 —— 前者改动面更小，推荐前者，并在注释里说明为什么这一处绕开 `use-toast`。

**测试**：`thread/ThreadList.archive-feedback.test.tsx` 已写好 4 项（已在磁盘上），当前红灯。但注意它现在红在**错误原因**上：它按 `归档` 找菜单项，而实际标签是英文 `"Archive"`。因为决策 1 批准了中文化，**先做待办 B 再回来跑这个测试**，或者先把测试里的查找改成 `"Archive"` 看到正确的红、实现完再随 B 一起改回 `归档`。推荐后者，这样能真正观察到"红在缺功能上"。

4 项断言：成功有 `已归档聊天` 通知 / 通知带 `撤销` 且能调 `unarchiveThread` / 失败报 `聊天归档未成功` 且不报英文 / 失败时不报成功。

**风险**：低，不碰既有断言。

---

## 5. 待办 B：行右键菜单中文化（决策 1 已批准）

**现状**（`thread/ThreadList.tsx:487-535`，`threadActions` 回调）：整个菜单是英文，而 session 模式其余部分全中文。

```
Rename / Pin / Unpin / Fork / Archive / Delete Worktree / Delete / Copy Id
```

**已核对的官方 zh**：

| 项               | 官方 key                          | zh         |
| ---------------- | --------------------------------- | ---------- |
| Archive          | `threadHeader.simplified.archive` | `归档`     |
| Fork             | `threadHeader.forkActions`        | `分叉`     |
| （归档确认标题） | `localTaskRow.archiveTask`        | `归档聊天` |

**`Rename` / `Pin` / `Unpin` / `Delete` / `Copy Id` / `Delete Worktree` 在 zh locale 里没有以 `localTaskRow.*` 命名的直接对应 key**（已验证：`localTaskRow.rename`/`.pin`/`.unpin`/`.fork`/`.delete`/`.copy` 全部零命中）。接手时需要继续在 zh locale 里按**中文词面**反查（例如直接 grep `` `重命名` ``、`` `置顶` ``、`` `复制 ID` ``），或从行菜单组件的渲染结构反查其 key。**不要凭感觉译**，parity 要求文案来自官方 locale。`copyId` 在 locale 里是 `页面 ID`，那是别的语境，**不要**直接用在这里。

**连带必须同步的两处既有断言**（决策 1 已批准修改）：

| 位置                                           | 当前断言                                                       |
| ---------------------------------------------- | -------------------------------------------------------------- |
| `thread/ThreadList.usability.test.tsx:165`     | `findByRole("menuitem", { name: "Archive" })`                  |
| `tests/e2e/session-list-usability.spec.ts:167` | `getByRole("button", { name: "Archive thread", exact: true })` |

**第二处有个未解之谜，接手时要先查清**：`"Archive thread"` 这个字符串在 `apps/web/src` 里 **grep 零命中**，全仓库只有这条 spec 自己提到它。也就是说这条 e2e 断言当前指向的元素来源不明 —— 可能它本来就是失效断言（Playwright 的 `toHaveCSS` 在元素不存在时会超时失败，所以要确认这条 spec 现在是否真在跑、是否真在过）。**先确认这条断言的真实状态，再决定是改它还是删它**，不要盲目替换字符串。

**风险**：中。要动测试资产（已获批准），且有一条来源不明的 e2e 断言需要先查清。

---

## 6. 待办 F：重命名 bug + 归档确认框四变体

### F1. 「重命名聊天」永久 disabled（既有 bug，非 parity 问题）

`composer/ConversationMenu.tsx:422-427` 的菜单项永远是 disabled，因为两个调用点都没传 `onRename`：

- `composer/Composer.tsx:877`
- `SessionSecondaryHeader.tsx:16`

真实功能失效，改动面小。修完追加 `docs/debug_list.md`。

### F2. 归档确认框四变体（决策 2：补变体，保留不停 Agent 语义）

**现状**（`composer/ConversationOwnerForms.tsx`）只有一个固定变体：

- 标题 `归档聊天`
- 描述 `将归档此聊天，并从关注列表移出。Agent 不会被停止。`
- 按钮 `返回` / `确认归档`

**官方四变体**，已核对的 zh 文案全集：

| key                                                          | zh                                                                              |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| `threadHeader.archiveConfirmTitle`                           | `归档对话？`                                                                    |
| `threadHeader.archiveConfirmSubtitle`                        | `稍后可在已归档对话中找到。`                                                    |
| `threadHeader.archiveConfirmCancel`                          | `取消`                                                                          |
| `threadHeader.archiveConfirmConfirm`                         | `归档`                                                                          |
| `threadHeader.archiveConfirmRunningTitle`                    | `停止并归档此聊天？`                                                            |
| `threadHeader.archiveConfirmRunningSubtitle`                 | `归档会停止所有正在进行的工作。你可以稍后在设置中恢复该聊天。`                  |
| `threadHeader.archiveConfirmRunningConfirm`                  | `停止并归档`                                                                    |
| `threadHeader.archiveConfirmHeartbeatTitle`                  | `归档聊天并移除已安排的任务？`                                                  |
| `threadHeader.archiveConfirmHeartbeatConfirm`                | `归档并移除`                                                                    |
| `threadHeader.archiveConfirmHeartbeatSubtitleNamed`          | `此聊天有一项已开启的定时任务 {name}。将该聊天归档也会将其移除并停止后续运行。` |
| `threadHeader.archiveConfirmHeartbeatSubtitleUnnamed`        | `此聊天有一项已开启的定时任务。归档此聊天也会将其移除并停止后续运行。`          |
| `threadHeader.archiveConfirmRunningHeartbeatSubtitleNamed`   | （运行中 + 具名定时任务，见 locale）                                            |
| `threadHeader.archiveConfirmRunningHeartbeatSubtitleUnnamed` | （运行中 + 匿名定时任务，见 locale）                                            |

**决策 2 的执行边界**：标题和按钮按官方分变体，**描述文案改成说明我们的实际行为**（不中断 Agent），因为 CLAUDE.md 明确规定「关闭标签只移出关注集合，不得中断 Agent 或清理 worktree」。

**⚠ 未闭合的子决策，必须回去问用户，不要自行决定**：用户选的方案预览里按钮写「停止并归档」，但我们实际不停 Agent，**按钮文案与行为不符**。这一点在选项预览里已标注为 `⚠`，用户是在知情下选的，但具体怎么落地还有几种可能：

1. 按钮改成不含"停止"的措辞（如 `归档`），只保留分变体的标题与描述；
2. 保留 `停止并归档` 但让它真的停 Agent —— 这会违反 CLAUDE.md 约束，需要用户先改规则；
3. 保留 `停止并归档` 字面但描述里讲清不中断 —— 用户当前选择最接近这个，但按钮仍有误导。

**接手时先就这三个确认一次**，再写代码。另外要确认我们这边是否真有「定时任务 / heartbeat」概念 —— 如果没有，heartbeat 两个变体不可达，应当像第 3 节那样显式记为"组件支持但运行时不可达"，而不是假装验过。

---

## 7. 待办 C：输入栏（你原始需求点名的部分）

已证据化的缺口：

| 项                                                                             | 官方证据                                                                                    | 现状                                                                                                                            |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| footer 缺 `data-dictation-view` / `data-dictation-enabled` 及对应 padding 过渡 | `rEn` @1043072；CSS @19608 / @20739 / @21066，gated on `[data-composer-layout]`（**可达**） | 完全缺失                                                                                                                        |
| 无 `/dictate` 斜杠命令                                                         | `Tua` @4881482，别名 `speech` / `voice typing`                                              | 完全缺失                                                                                                                        |
| fork 菜单缺「新工作树」选项                                                    | `sDa` @5420665                                                                              | `forkSlashWorktree` 已存在于 `composer/slashCommands.ts:201-213` 但**从未被 import**，且 `slashDialog === "fork"` 没有 renderer |
| composer 根只有官方 10 个 `data-composer-*` 中的 4 个                          | —                                                                                           | 待补                                                                                                                            |
| 导轨 `variant` 体系及 14 个子组件                                              | `t5i`                                                                                       | 未实现                                                                                                                          |

fork 那条值得注意：代码已经写好了但没接线，属于"差最后一公里"，性价比最高。

相关 fork zh 文案（已核对）：`threadHeader.forkIntoLocal` = `创建聊天分支`、`.forkIntoSameWorktree` = `在同一工作树中创建聊天分支`、`.forkIntoWorktree` = `在新工作树中创建聊天分支`、`.forkThreadError` = `创建聊天分支失败`、`.forkThreadPending` = `正在创建聊天分支…`、`.forkThreadRequiresGitRepo` = `需要 Git 代码仓库才能在新工作树中创建分支`。

---

## 8. 待办 D：未审计面（先逆向，出清单再排期）

这三块还没对过官方，**只能先给"逆向 + 出审计清单"的工作量，给不出修复清单**：

- `composer/FollowupQueue`
- `composer/QueueReorder`
- footer / utility bar

对应官方 `composer-utility-bar-f7a08ac0c453.js`（184KB）和 `composer-controls-7a6be63cddcf.js`（239KB）。

建议先产出一份和本文件同格式的审计清单（每项带 chunk + offset + zh key + 我们这边的现状），再并入执行队列。否则会边做边发现新缺口，排期失真。

---

## 9. 待办 E：多终端同时访问 残余

| 项                                     | 状态                                           |
| -------------------------------------- | ---------------------------------------------- |
| 10,000 事件长测                        | 未做                                           |
| 30 分钟渲染进程 RSS 闸                 | 未做                                           |
| 真实双页浏览器验证设备偏好             | 未做                                           |
| 原生像素态复验                         | 未做                                           |
| 跨设备网络联调、HMR 验收               | 未做                                           |
| **跨进程原子审批（两个独立原生写者）** | **做不了** —— 需要 Rust 源码，当前工作树里没有 |

最后一项不要硬凑，直接记为"本轮不可验证"并说明原因。

联调地址纪律（CLAUDE.md 强制）：前端必须绑 `0.0.0.0`，对外说明用局域网地址（如 `https://10.30.0.22:3100`），不能只写 `localhost`。

---

## 10. 收尾清单（每一项待办完成后都要过）

- [ ] 对应红绿灯测试先红后绿，红灯红在缺功能上
- [ ] 双向探针（改坏实现 → 对应断言失败 + 否定对照仍通过），探针已回滚并 `diff` 验证
- [ ] 全量 sweep 对比基线 632 文件 / 4006 项通过
- [ ] `tsc --noEmit -p tsconfig.json`（预期仍有 `CodexMarkdown.tsx` 的 12 个既有 `TS2322`）
- [ ] `apps/web/node_modules/.bin/prettier` 过新增文件
- [ ] 同步 `docs/func_list.md`；如改产品概览/架构边界则同步 `docs/project-overview.md`
- [ ] 修 bug 的追加 `docs/debug_list.md`（必要时同步 `memories/repo/debug_list.md`）
- [ ] 在设计文档里写明"有意偏离"和"未闭合/不可达"项，不把没验过的说成验过
