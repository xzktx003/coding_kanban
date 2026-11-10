# 会话模式 Codex 复刻 · 真实登录 Playwright 验收（O-F）— 2026-11-07

> 任务：t8 real-login Playwright（O-F）。用户已决定：隔离官方 webview 像素 diff 仅到 boot shell（t7 研判
> 跨状态交叉 diff 需专项多轮 RE），转向**真实登录 Playwright** 作为上推 O-F 的验收路径。
> 本文件记录 t8 在**真实登录、真实 Codex 会话**下对 `apps/web/src/session-mode/components/codex`
> 复刻的逐状态验收证据，并把「已确认真实通过」与「仍宿主门控/未在当前采样会话中出现」明确分开。
> 不把宿主门控项标为已通过，不伪造空工具/空内容。

---

## 1. 环境与授权边界（客观）

| 项 | 值 |
|---|---|
| 前端 | `https://10.30.0.26:8484`（绑定 `0.0.0.0`，局域网可达，`curl` 200） |
| 后端 | `http://10.30.0.26:4000`（`/api/health` 200；前端经其连接 Codex 宿主） |
| 账号 | 主人机 `codex login status = Logged in using ChatGPT`（`codex` CLI 可达） |
| 宿主 | `packages/native-codex-host` 隔离 code-server 原型，官方 VSIX 不补丁，`--shared-codex-home` 显式授权 |
| 授权边界 | **只读**（t8/t13 基础验收），不读取令牌或会话正文。2026-11-08 14:52:18Z 的显式只读真实轮次已送达：页内观察器锁存三个流式标记 3165 ms，`streamdown 0→19`、`toolItems=1`；plan 与 file-change 本轮 not-present。旧 `sendAvailable:false` 结论已作废。 |

复现命令（部署已在跑，跳过 webserver）：

```bash
cd /data01/home/xing.hu/vibe_codings/coding_kanban
PLAYWRIGHT_SKIP_WEBSERVER=1 \
PLAYWRIGHT_BASE_URL=https://10.30.0.26:8484 \
PLAYWRIGHT_FRONTEND_PROTOCOL=https \
npx playwright test --config playwright.config.ts tests/e2e/session-mode-codex-live-acceptance.spec.ts
```

- 验收入口：`tests/e2e/session-mode-codex-live-acceptance.spec.ts`
- 截图 + 结果 JSON：`tests/test-results/session-mode-codex-live-oauth/`
  （`00-navigation-layer.png` … `12-presentation-markdown-*.png`、`session-mode-live-oauth-results.json`）

---

## 2. 逐状态结果

> 状态语义：
> - **pass**：在该次真实运行中**真实观察到**对应 UI。
> - **not-present**：未在本次**采样到的真实线程**中出现（内容依赖），不等于不可实现，也不等于"空"。
> - **host-gated**：需要宿主/活动能力（真实轮次进行中、审批/队列动作、真实写操作）或授权，只读验收无法驱动，记录为阻塞，**不冒充已通过**。

| # | 状态 | 结果 | 证据（截图 / 数据库） |
|---|---|---|---|
| 1 | 悬浮 / 导航层（顶部导航、模式切换、会话标签；`sessionTabs` 走既有会话标签） | **pass** | `00-navigation-layer.png`；`topNav=1 modeSwitch=5 leftSidebar=0 sessionTabs=3` |
| 2 | composer 空态（输入框存在、无草稿） | **pass** | `02-composer-empty.png`；`session-composer-form=1 input(contenteditable)=1` |
| 3 | composer 输入态（填入草稿渲染） | **pass** | `03-composer-input.png`；contenteditable 填入「实时验收输入态（未发送）」，未发送 |
| 4 | composer 审批/权限门（`执行权限` 选择器） | **pass** | `04-composer-queue-approval.png`；`accessModeButton=1`（`+ 完全访问` / `执行权限：…`） |
| 5 | composer 队列（follow-up 队列列表） | **host-gated** | 本次会话无排队 follow-up（`queue=0`）；需要活动中的排队 follow-up，属活动/宿主门控 |
| 6 | 转写区空态（未选线程） | **pass** | `05-transcript-empty.png`；`.session-welcome`（「开始一个会话」「已有会话可从左侧搜索打开」） |
| 7 | 扫描范围（项目分组展开 + 加载更多历史） | **pass** | 展开全部项目分组（Radix collapsible trigger）、每组点 `.session-load-more`（3 轮）→ rows=82 exposed；`scanned=40` 上限（t13 扩展，非原 12） |
| 8 | 转写区消息（打开真实线程） | **pass** | `06-transcript-messages-{0,1,2}.png`（前 3 个含消息线程截图）；`opened=true`，t13 扩展后 scanned=40 范围内观察到 `[data-message-author]`（含 assistant），消息截图按上限 3 张留证 |
| 9 | 转写区加载（历史准备/提示指示） | **not-present** | 打开线程后未捕获到 `codex-transcript-preparing`/history 提示（快速加载或已在缓存）。加载态为瞬时，是否可观察取决于网络/缓存；对应加载组件有单测 |
| 10 | 转写区工具（命令/工具项） | **pass** | 2026-11-08 14:52:18Z 真登录只读新轮次结算后 `toolItems=1`；旧历史扫描的 0 不再代表当前 O-F |
| 11 | 转写区 plan | **not-present** | 同一已送达真实轮次 `planItems=0`；不能再用 `sendAvailable:false` 解释，本轮原生未发出可渲染 plan |
| 12 | 转写区文件变更 | **not-present** | 同一已送达真实轮次 `fileChanges=0`；只读 prompt 未产生文件变更，不能外推为已渲染 |
| 13 | presentation 渐进 Markdown | **pass** | `12-presentation-markdown-*.png`；`streamdown=47` |
| 14 | presentation 代码围栏 | **pass** | `11-presentation-code-fence-*.png`；`pre+fence=3` |
| 15 | presentation 引用 pill | **not-present** | rows=82/scanned=40 下 `citations=0`（`.native-file-citation`）；流式引用 pill 的**组件级**行为已被 `AgentMessageItem.streaming-regression.test.tsx`（t6 已修复，4/4）锁定，本实时会话采样的线程未出现文件引用指令 |
| 16 | presentation 流式 live-tail（进行中 turn） | **pass** | 2026-11-08 14:52:18Z 页内观察器锁存 `liveMessage=1 liveTail=1 streamingText=1`，可见 3165 ms、采样 138 次；`streamdown 0→19`。旧 700 ms 轮询与热路径截图错过的是瞬时 DOM，不是发送失败 |

**合计：pass 11 / not-present 4 / host-gated 1**（2026-11-08 14:52:18Z 追加真实轮次后，工具与 live-tail 改记 pass；plan、文件变更、引用 pill、加载仍 not-present；队列仍 host-gated）。

> 项目会话侧栏（已关注项目/会话列表）：本次可复现证据运行中 `leftSidebar=0`（`.session-sidebar-projects`/`.session-project-sessions` 等选择器未命中；
> 该计数随侧栏懒挂载时序而变，不同运行会得到 0 或非 0），证据目录亦无该侧栏独立截图（无 `01*` 图），故**不**列入通过。
> 导航层通过仅基于 `topNav=1 modeSwitch=5 sessionTabs=3`；项目会话侧栏为真实应用中存在，但本证据运行未观察到其独立 marker，
> 因此记为未观察到（not-present），留待后续运行稳定捕获。

> 说明：转写区工具 / plan / 文件变更 / 引用 pill 四者属「本次扫描到的真实线程中没有对应内容」，不是「功能缺失」。
> 其对应组件（`ShellCommand`/`CommandActionItem`/`TurnPlan`/`IndividualFileChanges`/`NativeFileCitationPill`）
> 均有独立单测；要在真实会话中观察它们，需要一个确实包含工具调用/plan/文件变更/文件引用指令的线程
> —— 该账号 followed-session 历史以 assistant/user markdown 为主。t13 已扩展扫描：展开全部项目分组 + 每组加载更多历史，
> 暴露 rows=82、上限 scanned=40，仍未观察到工具/plan/文件变更/引用指令，故记录 not-present，留待有此类动作的真实线程或真实运行创建。
> **2026-11-08 14:52:18Z 真实轮次复核**：页内观察器在提交前安装，真登录只读新轮次已送达。
> `streamdown 0→19`，live message、live tail、streaming text 同时出现并持续 3165 ms，结算后 `toolItems=1`。
> plan 与 file-change 仍为 0，只记录本轮未出现；旧 `sendAvailable:false` 不能再解释这两个状态。

---

## 3. 结论与门控分界

### 3.1 本次真实确认通过（O-F 可上推的组成部分）
- 会话模式在**真实登录**下正常挂载：悬浮/导航层（顶部导航、模式切换、会话标签）。
  - 注：项目会话侧栏在该可复现证据运行中 `leftSidebar=0`，未单独捕获，不作为已通过（见 §2 说明）。
- composer 空态 / 输入态 / 权限门（`执行权限`）在真实会话下渲染正确；未发送任何 prompt（t8 基础验收）。
- 转写区空态与**真实线程**的消息渲染正确（assistant 消息、markdown 渐进渲染、代码围栏）。
- 已修复的**流式引用 pill**（t6）组件行为由单测锁定（4/4），实时会话采样线程暂未出现引用指令。

### 3.2 仍宿主门控（不冒充已通过）
- **composer 队列**：需要活动排队 follow-up。
- **presentation 流式 live-tail**：2026-11-08 14:52:18Z 已由页内观察器在真实轮次中直接确认，不再列入宿主门控。
- 其余宿主门控项见 [host-capability-assessment-20261107.md](host-capability-assessment-20261107.md)：
  G01（IDE 自动上下文）、G20/CMP-36..39（local/worktree 切换、branch/local-env）、CMP-51（realtime voice，
  CLI 版本门 + 账号/feature/remote 三重门）—— 本验收不覆盖，也不标记为已通过。

### 3.3 授权合规
- 未读取或输出任何登录/令牌值；未把会话正文输出到日志/断言；仅以 class/data-*/role 结构标记作断言与截图。
- 未发送模型 prompt / 未产生真实 turn（未触发 `turn/start|interrupt|steer` 之类写路径）—— 适用于 t8/t13 基础验收；t17/t18 例外见 §1（显式真实轮次尝试，已授权 token 成本）。

---

## 4. 复现 / 可信度
- 单文件可复现：`session-mode-codex-live-acceptance.spec.ts` 在给定 env 下可独立运行并输出截图 + 结果 JSON。
- 组件级（P-C）引用/流式行为由 `AgentMessageItem.streaming-regression.test.tsx`（4/4）与 presentation 套件
  （53 文件 / 271 用例）锁定；本文件只记录**真实登录（O-F）**层面的可见证据，不替代组件单测。
- 已知采样局限：t13 已扩展为展开全部项目分组 + 每组加载更多历史，暴露 rows=82、上限 scanned=40（覆盖更广真实线程），仍未定向检索到包含工具/plan/文件变更/文件引用的线程；该部分如实记为 not-present，需要用户提供/运行含此类动作的真实线程才能上推为 pass。
