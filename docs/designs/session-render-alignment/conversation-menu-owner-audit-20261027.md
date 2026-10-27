# ConversationMenu 子表单 owner 边界审计与修复（2026-10-27）

初始阶段为只读审计，不修改产品或永久测试；随后主线程明确授权实现，当前修复与最终验收见文末。采用 reverse-engineer-anything 的独立证据审查方法；对象是本仓库完整源码，未重做官方 VSIX 反编译，也不将下述行为说成原生 Codex 的行为。对照 `docs/session-drafts.md`、`docs/session-memory-contract.md`、`docs/session-page-navigation.md` 及真实导航/表单实现。

## 初始审计结论（修复前）

1. **主 Composer 未复现 A 打开确认后误作用于 B**。`AgentComposer.tsx:130–136` 的 `QuestionComposer key={currentThreadId}` 在 A→B 卸载整个 Composer；归档/删除 sheet 消失，没有 mutation 写出。父附加菜单的常驻 ConversationMenu 不跨越这层 key。
2. **已有二级功能页菜单存在 owner 漂移**。`SessionSecondaryHeader.tsx:16` 不随 threadId 重建；表单打开状态和缓冲区存活，确认却取当前 threadId/cwd。隔离真实浏览器验证 archive、delete、notes、branch、commit、PR 六条路径。
3. **笔记跨 owner 内容串用有完整操作路径**。在设置页 A 打开笔记并输入，取消；菜单“切换聊天…”正常选择 B；重开笔记仍出现 A 文本，记入后污染 B 草稿。此路径没有程序设置 owner；后半段使用正常键盘 Enter 打开焦点已回到的菜单触发器（下述 pointer 问题阻挡鼠标，不算鼠标通过）。
4. **主输入区表单缓冲丢失得到状态导航边界证据**：A 输入 notes/branch/PR 后调用生产导航入口切 B，再切回 A 重开，笔记/分支为空，PR 描述为空、标题重置。主聊天草稿 A/B 完整保留。由于打开的 modal 阻止后台普通标签点击，本项不声称“用户直接点击被覆盖的标签即可复现”；没有绕过模态执行 force click。
5. **完整鼠标路径发现附加问题**：设置页笔记取消→切换聊天 sheet→选择 B 后，dialog/menu 均为 0，但 `body.style.pointerEvents === 'none'`，正常菜单点击连续 10 秒被 html 拦截。重复两次，保留失败；尚未定位锁归属或判定是否本批新增。

## 隔离方式与真实结果

访问当前前端 `https://10.30.0.24:8484`（HTTPS，LAN），Chromium 1280×900；复用 `installSessionUxFixture` 拦截全部 API、关闭全部 WebSocket。mock thread A=`ux-0` / cwd=`/fixture/project-a`，B=`ux-1` / cwd=`/fixture/project-b`。写请求只被自有 route 记录并模拟响应；没有到正式后端、Agent、Git 或 GitHub 的写入。未跟随任何 GitHub 链接。浏览器每项独立 context；所有完成项 pageerror 为 0。

状态导航矩阵使用**生产注册的 `sessionTabSelect(B)`**，没有裸改 `currentThreadId`。初始化使用 store 种子；切换动作本身复用 `useSessionTabActions`。该矩阵验证实际组件生命周期及真实 API payload，不能自动等同于模态打开时物理点击后台标签。

| 入口 | 操作 | A→B 后实际结果 |
| --- | --- | --- |
| 主 Composer | 归档/删除 | sheet 卸载，0 写出 |
| 主 Composer | 笔记/分支/PR | sheet 卸载；返回 A 重开丢失未提交表单输入；A/B 主草稿未改 |
| 二级功能页 | 归档 | POST `/api/session/api/codex/thread/archive` `{threadId:"ux-1"}` |
| 二级功能页 | 删除 | POST `/api/session/api/codex/thread/delete` `{threadId:"ux-1"}` |
| 二级功能页 | 笔记 | A 草稿仍 `DRAFT-A`；B 变 `DRAFT-B\nNOTES-FOR-A` |
| 二级功能页 | 创建分支 | POST `/api/session/api/git/create-branch` `{cwd:"/fixture/project-b",branch:"branch-for-a"}` |
| 二级功能页 | Git 提交 | POST `/api/session/api/git/commit` `{cwd:"/fixture/project-b",message:"COMMIT-FOR-A"}` |
| 二级功能页 | 创建 PR | href 从 fixture-a/project-a 变 fixture-b/project-b；标题从 `TITLE-FOR-A` 变 `branch-b`，描述仍 `BODY-FOR-A` |

完整笔记操作路径：设置页当前 A → 点击更多操作 → 笔记输入 `NOTES-FOR-A` → 点击取消 → 点击更多操作 → 切换聊天 → 正常点击 B 选项 → 焦点自动回更多操作按钮 → 正常 Enter → 点击笔记 → 看到 A 文本 → 点击记入当前输入。没有 force、Escape、DOM 点击、额外 focus 或直接写 store 切目标。其鼠标菜单重开版本因 pointer lock 失败，键盘版本不掩盖这项失败。

## 精确源码位置与根因

- `components/agent/AgentComposer.tsx:130–136`：当前 thread key；HEAD 也有相同 key，主输入卸载不是本批新加。
- `components/layout/SessionSecondaryHeader.tsx:16`：既有常驻 `ConversationMenu threadId={threadId}`，没有 owner key。
- `components/codex/composer/ConversationMenu.tsx:194–205`：表单 open booleans 与单个 notes buffer，没有 owner 身份。
- 同文件 `:312–315`：cwd 取当前 thread 的 store 元数据，未在打开项目表单时捕获。
- 同文件 `:1724–1726`、`:1794–1796`：归档/删除在确认点击时才 `const id = threadId`。异步发送后回执正确使用此局部 id；**问题在确认前目标已经漂移**，不是发送后回调重查。
- 同文件 `:1752–1770`：notes buffer 对所有 owner 共用，记入时由当前 threadId 生成 draft key；取消仅改 open 不清 buffer。
- 同文件 `:1681–1690`：PR/branch 每次 render 传当前 cwd；`:1704–1706`：GitCommitDialog 的当前 onConfirm 同样使用当前 cwd。
- `CreateBranchSheet.tsx:13–26`：name 保持，确认时使用当前 cwd。
- `PullRequestSheet.tsx:147–170`：cwd effect 重新读分支，成功后无 dirty 检查直接 `setTitle(next.branch)`；body 不清，造成新项目 + 旧描述混合。
- `features/git/GitCommitDialog.tsx:24–36`：本地 message 保持至成功；没有 owner 身份；取消不清 message。其控件禁用不等于已接入页面离开保护。
- `hooks/useSessionTabs.ts:24–45`：切换入口未调用 `requestSessionNavigation`。已有 `useSessionLeaveGuard` 主要协调功能页 `setView`，不能只在子表单挂一个 hook 就声称所有会话切换已受保护。
- `composer/v2/useComposerSheetHistory.ts`：管理 browser Back 与可见性，不是 dirty/saving guard。`ComposerSheet`、CreateBranch、PR、GitCommitDialog 当前均未登记 `useSessionLeaveGuard`。

## 与本批常驻父菜单改动的关系

对照 HEAD `32788bf08c9bcbf7c7dd013e6fb337c46a12b1b3`：二级 Header 的常驻结构、archive/delete 确认时读取当前 thread、单 notes buffer、动态 cwd/PR effect、主 Composer 外层 thread key 均已存在。此次仅进行了静态 HEAD 对照，**没有运行 HEAD 整站，不能把该对照写成旧版浏览器复现**。

因此，六项 header 反例是现有逻辑问题，并没有证据证明本次附加父层关闭修复首次引入它们。新常驻主菜单只保证同一 Composer 内子表单不会因父附加 Popover 关闭被卸载；没有让它跨主输入的 thread key。pointer lock 的版本归因仍未知。

## 全局表单与 owner 表单

- owner 表单：archive/delete/notes/commit/push/branch/PR（包括查看/合并 PR 的项目链接）、文件搜索。它们应绑定打开时的线程/项目；不能因后台目标改变静默改写。
- 全局功能：KeyboardShortcutsSheet、SearchChatsSheet 的会话检索/切换。全局搜索本来就允许选择另一会话，不应套用“始终操作打开时 A”的限制。隐藏 Session 的全局快捷键由主线程另行修复，不在这里重改。
- Rename：当前 Composer 与 SessionSecondaryHeader 都不传 `onRename`；`ConversationMenu.tsx:381` 禁用。未构造脱离正式产品的 onRename callback 反例；其他标题重命名入口由其他审计负责。
- Fork：当前“分叉聊天”直接执行并捕获当次参数，不是待确认子表单；本轮未测试其异步完成归属，不从上述表单反例推断 fork 也有相同问题。
- 单独切换工作区 cwd、但 threadId 及 thread.cwd 均未改变时，上述 cwd selector 仍来自原 thread；没有证据说单独全局项目选择就会改目标。

## 最小修复建议与待明确语义

1. 用带 identity 的 owner 表单状态替代单 boolean：打开时捕获 `{threadId,cwd,draftOwner}`，每次确认核对准确 scope；只读 UI 必须显示真实原目标。归档/删除在 owner 变化后取消或禁用旧确认并要求重新打开，比继续显示“当前聊天”且写旧/新目标更明确。不要自动重试已经发出的 mutation。
2. Notes/commit/branch/PR 输入按原 owner（Git 表单至少按规范 cwd + 原thread身份）保存；取消关闭不等于跨 owner 复用同一个 buffer。原已保存/发送版本回执不能清掉新输入。PR 默认标题只能初始化该 owner 的未编辑草稿，不因其他 cwd 回执覆盖用户标题。
3. 若选择“脏表单阻止切换”，需要覆盖真实会话/项目导航入口和被动 owner 改变；仅 `useSessionLeaveGuard` 现有 setView 链路不足。若选择“允许切换、保留 A 草稿并在返回时恢复”，需放到 key 之外的有界 owner 存储。不要新增 owner key 直接丢弃来规避串目标。
4. 待确认产品语义：A 表单在 B 成为当前目标后，是继续显示清楚标注 A 的表单、暂停并允许恢复 A，还是阻止切换；对于脏表单不能默认为丢弃。模态打开时后台正常点击已被阻挡，不能声称加 modal 就修复所有异步/程序导航边界。
5. pointer lock 需单独红灯：正常“切换聊天”选项关闭后 dialog/menu=0、body 恢复 pointer events、下一次真实点击可达。不要通过手动清 body style、force click 或多余 Escape 把失败测绿。

## 证据与复验

独立目录：`.dev-runtime/session-conversation-owner-audit-20261027/`。

- `probe.mts`：完整夹具；仅自有浏览器与模拟 API。
- `combined-results.json`：主输入 5 项、二级页 6 项、完整笔记键盘路径；各项 JSON 保存全部 mock/API 记录。
- `archive.json`、`delete.json`、`notes.json`、`branch.json`、`pr.json`：主输入生命周期及 A 返回恢复结果。
- `secondary/{archive,delete,notes,branch,pr,commit}.json` 与 `*-after-switch.png`：六项真实组件/API 反例。
- `physical/after-physical-switch.json`、`.png`、`run2.log`、`run3.log`：重复鼠标阻挡失败；`run.log` 是旧 fixture 标题选择器失败，不计产品红灯。
- `physical-keyboard/notes.json`、`notes-after-switch.png`：完整操作的 owner 内容串用；`evidence.json` 有源码前后 SHA，drift=[]。
- 主目录及 secondary 的 `evidence.json` 为最后一批运行摘要；完整矩阵见 combined-results，避免把最后批次替代前面单项结果。
- 最早 `run.log` 等待已卸载 archive 确认超时，说明初始“主输入会保留sheet”假设不成立；后续正确采样保留该反证。

复验示例（在仓库根执行，LAN 地址写在自有 probe 中）：

```sh
OWNER_CASES=archive,delete,notes,branch,pr pnpm --filter web exec tsx ../../.dev-runtime/session-conversation-owner-audit-20261027/probe.mts
OWNER_SECONDARY=1 OWNER_CASES=archive,delete,notes,branch,pr,commit pnpm --filter web exec tsx ../../.dev-runtime/session-conversation-owner-audit-20261027/probe.mts
OWNER_SECONDARY=1 OWNER_PHYSICAL=1 OWNER_KEYBOARD=1 OWNER_CASES=notes pnpm --filter web exec tsx ../../.dev-runtime/session-conversation-owner-audit-20261027/probe.mts
```

未验证：真实账号或服务器 mutation、真实 Git/GitHub、手机本轮路径、官方 GUI 对应行为、owner 被动变化的所有来源、pointer lock 具体版本根因。没有修改共享 debug/audit 文档，由主线程统一归并。

## 后续授权实现与当前验收（同日）

上述只读反例向主线程报告后，主线程明确授权修复 owner 表单；pointer lock 由主线程独占 UI primitives 另行处理。本节描述之后的实现，不回写原红灯结论。

- `ConversationMenu` 仍保留父附加菜单的稳定本体/触发器 Portal 及主线程新增的隐藏模式同步 guard。owner 子表单改由 `ConversationOwnerForms.tsx` 渲染；KeyboardShortcutsSheet、SearchChatsSheet 仍为全局面板。
- 打开时捕获原 threadId、cwd、title、draftOwner 与 `captureCodexOperationScope()`。目标栏明确显示原会话/项目；允许切换到 B，但当前表单仍绑定并标注 A，写入前同步核对原 scope。独立的 file search、查看/合并 PR 也固定捕获 cwd，PR 外部链接点击同样拒绝失效 scope。
- `conversationFormDrafts.ts` 仅保存每个 owner/form 的少量文本字段、修订及本地保存状态，不保存消息正文、账号对象、授权凭证或完整原生元数据。按已知账号 namespace/type/登录状态、thread、cwd、表单类型分区；账号 namespace 未核实时额外带 scope revision，不猜两个未知账号相同。
- 这是**本页暂存**：主 Composer thread key 卸载不会丢输入，返回原目标重新打开可以恢复；取消只关闭不丢弃。界面明确提示刷新不会自动恢复，有脏表单或保存请求时设置 browser beforeunload 提醒。没有新增 localStorage/IDB 协议，也不声称硬刷新/关浏览器/跨页同步持久化。真实隔离Vite热更新3/3、真实reload不恢复及dispose时监听移除已验证；关卡边界见[HMR验收](conversation-form-hmr-acceptance-20261027.md)，不把生产bundle/正式8484热更新说成已测。
- 最多 64 个未完成表单条目、合计 2 MiB UTF-16 文本；满额明确拒绝新表单或超额编辑并提示，保留已接受文本，不以 LRU 淘汰脏内容。显式“清空未提交内容”释放缓冲，空且无人引用的条目移除；已卸载但仍在保存的条目等回执再释放。
- dirty/saving 复用 `useSessionLeaveGuard`，保护其已有功能页离开链路；会话切换仍允许，靠 owner 缓冲恢复而不是篡改全局导航。保存中各实例共享 pending 标记，关闭不取消已写出操作；原请求完成只清理其捕获修订，较新的 A 版本和 B 新输入保留。
- 账号/runtime 变更后，旧请求即便成功也不据此改当前账号的卡片/线程列表，不清旧输入、不自动重试。收到明确成功后记录本次表单 receipt，避免 UI 回调失败造成同一确认重复写出。主输入 key 卸载的旧组件回执不会关闭后来新挂载的 B 表单。

永久测试先落 `ConversationMenu.owner-forms.test.tsx`：旧实现 **10/10 红**（`unit-red.log`），核心实现转绿。后续边界补测覆盖原 scope 撤销、迟到 A 回执不清 B、新修订保护、pending 跨 key 重挂、PR/notes 失效入口、StrictMode effect replay；小 store 独立覆盖容量拒绝、beforeunload、引用计数与相同快照不通知。

当前结果（冻结清单见 `frozen-source.json`）：

- `unit-final.log`：5 文件 **114/114 通过**，包括原 native menu、父层生命周期与 PR helpers。
- `tsc-final.log`：web `tsc -b --pretty false` 退出 0。
- 永久 `tests/e2e/session-conversation-owner-forms.spec.ts`：1440 click 与 390 `hasTouch/isMobile`（首轮菜单 item 为 tap，部分 trigger/确认仍为 click），先执行 archive/delete/branch/commit/PR 十项，`browser-matrix.log` **10/10 通过**（41.6 秒）。所有 writes 被 fixture 记录；PR 只检查 href。永久 spec 随后统一 390 全部激活为 tap、1440 为 click，最终联合运行单独记录，首轮不冒充全部触控。
- 另两项完整菜单 notes/主 key 恢复需待主线程 pointer 修复后正常点击联合执行；没有用 Enter/force/Escape 替代这两项正式验收。单独诊断的键盘路径仍保留在旧证据中，不冒充 pointer 已通过。

运行联合 12 项的命令：

```sh
PLAYWRIGHT_SKIP_WEBSERVER=1 PLAYWRIGHT_BASE_URL=https://10.30.0.24:8484 PLAYWRIGHT_FRONTEND_PROTOCOL=https pnpm exec playwright test tests/e2e/session-conversation-owner-forms.spec.ts --output .dev-runtime/session-conversation-owner-audit-20261027/acceptance/results
```

全局 debug/功能清单仍由主线程更新。真实 Git/归档/删除/Agent/PR 操作均未执行。


## 最终冻结联合验收

主线程完成 pointer CSS 修复后，用同一冻结源码运行：

- `browser-final.log`：**12/12 通过**（1.1 分钟），退出 0。390px 每一次激活均为真实 `locator.tap`，1440px 为正常 click；两项 notes 流程保留 `body.pointerEvents != none` 与下一次正常点击/触摸可达断言，没有 Escape/force/手写清 body。同时覆盖返回 A 的 notes、独立 B buffer、记入原 A 主草稿、主 Composer thread-key 卸载后恢复。
- `unit-exact-final.log`：**5 文件 114/114 通过**，退出 0。
- `tsc-exact-final.log`：web 类型检查退出 0。
- `final-source-verification.json`：13 个产品/永久测试文件含 `apps/web/src/session-mode/session-interactions.css`，前后 SHA 相同，`drift=[]`。
- `acceptance/` 的 10 份 matrix JSON 全部 `pageerror=[]`，合计 8 次 mutation 全由自有 route 模拟；2 个 PR case 仅核对原 A href，0 外部跳转。notes 只操作隔离浏览器草稿。

已实际查看 `acceptance/notes-390.png`、`notes-1440.png`、`pr-390.png`：原 A 目标栏、本页暂存提示、清空入口在两尺寸可见。PR 原有 input/textarea/link inline 排版在手机仍粗糙，已向主线程单列视觉后续项；本轮不声称整张表单与官方像素一致。主线程 pointer 修复的红灯与 CSS 根因记录由其独立文档承担，本文件不把该修复归为 owner 实现。

最终摘要：`final-summary.json`；产品与永久测试已冻结，只有本独立记录随后补充。真实 HMR、刷新恢复及正式 mutation 边界仍如前述，不扩大验收结论。
