# 会话占用时未发送消息仍出现在聊天正文：待审修复方案

日期：2026-10-14。状态：用户于本日明确授权审查并修复；发送链路方案已实施，修复与最终验证记录另见本轮审查报告。

## 已确认的问题

发送链路提前创建本地正文/图片回显；异常处理不区分「明确未发送」与「发送结果未知」，一律转为 `uncertain`。聊天组件又允许 `failed` / `uncertain` 回显进入正文。因此发送被明确拒绝后，正文仍有一份消息，输入框又保留原稿，形成截图中的重复与误导。

| 位置 | 当前行为与问题 |
| --- | --- |
| `apps/web/src/session-mode/services/followupService.ts`，`submit` | POST 前调用 `beginDeliveryEcho` 并通知滚到最新；catch 一律调用 `failDeliveryEcho`。已入队后返回 failed 也走异常路径。 |
| `apps/web/src/session-mode/stores/useCodexDeliveryStore.ts` | `failDeliveryEcho` 将 submitting 转 uncertain；队列同步允许已有回显转 failed，并保留正文。 |
| `apps/web/src/session-mode/components/codex/thread/CodexDeliveryEchoes.tsx` | 只排除 queued/cancelled，failed 仍作为用户气泡展示。 |
| `components/codex/thread/CodexAccessNotice.tsx` | 占用状态仅保存在提示组件内；主输入、侧边聊天和公共提交服务不能复用它。 |
| `components/codex/composer/Composer.tsx` | 已知 external 未阻止提交；`onAfterSend` 在提交结果确定前触发。草稿/附件按提交版本保留的行为本身正确。 |
| `apps/server/src/routes/session-followups.ts`，`acquire` / `enqueue` | 队列 journal 被另一网关持锁时，在 `queue.submit` 前抛普通 Error，实际返回 500，未表达「明确未入队」。 |

截图中的「消息队列已由另一服务管理」特指**整个消息队列文件的网关排他锁**；会话被原生客户端占用则是 thread writer 冲突。两者应分别呈现，不能用相同的「送达待确认」掩盖明确拒绝。历史截图没有保留当时的锁持有进程，本次不声称已确定那个进程。

## 官方插件对照

用户此前指定的 `26.51002.51308` 目录在当前工作区已不存在。本次核对现有 `third_party/openai.chatgpt-26.51007.21434-linux-x64/extension/webview/assets/app-initial-c4ebaa710049.js`，保持 VSIX 与安装目录不修改。

其中 `iAn` 的发送逻辑具有以下边界：

1. 写入角色不满足且无法转交时，在创建本地 turn 之前退出。
2. 允许创建临时 turn；请求明确失败、没有原生 turn 接纳证据时，通过 `eAn` 定位本次提交，再由 `xg` 删除临时 turn，并恢复临时运行状态。
3. `Ft.delivery.stage === "outcome-unknown"` 时记录未确认提交；已有接纳证据时也不删除真实消息。

因此对齐目标是**明确未接纳的消息不留在聊天正文；真正未知的结果保留核对能力**。不能把所有异常当成拒绝，也不能删掉已送达但模型执行失败的消息。

提取并格式化的原始函数及其环境 stub 执行结果在 `.dev-runtime/occupied-send-diagnosis/`。该对照执行了原始发送函数，不等同于完整 VS Code 插件 UI 端到端验收。

## 修复前复现证据

浏览器通过 `https://10.30.0.24:8484/?mode=session` 加载当前前端，1440px 桌面视口；所有 API/WebSocket 使用隔离 fixture，不向真实会话发送数据。

| 场景 | 当前错误表现 |
| --- | --- |
| 队列锁拒绝，HTTP 500 | 正文保留 1 个 uncertain 气泡；文字和附件也在草稿中。 |
| 会话占用明确拒绝，HTTP 409 | 同样保留 uncertain 气泡，尽管服务明确表示尚未发送。 |
| 入队回执明确 failed | failed 仍保留为正文气泡。 |
| 网络响应丢失，对照组 | 保留 uncertain 气泡与草稿；这类情况需要保留送达核对能力。 |

四个浏览器场景均无页面 JS 错误，正式历史行数为 0；没有额外 turn/start、interrupt 或 resume 请求。

另用临时独立 journal 与真实 `flock` 启动两个 Fastify 路由实例：持锁实例读取成功 200，竞争实例 POST 返回 500 /「消息队列已由另一服务管理」；两个实例的队列记录均为空，原生发送次数为 0。已确认该分支确实没有入队/投递。

执行插件原始函数的环境 stub 对照：无可用 owner 时本地 turn 0；明确拒绝时本地 turn 从 1 撤销为 0；outcome-unknown 时保留 1 个本地 turn 和 1 个未确认提交。

证据文件：`browser-results.json`、`queue-lock-results.json`、`native-results.json`，以及四张浏览器截图；均在上述 Git 忽略目录内。

## 拟修改方案

### 1. 明确提交结果，不靠错误文案猜测

- 给队列锁冲突增加稳定错误代码，例如 `FOLLOWUP_QUEUE_OWNED_ELSEWHERE`，返回 HTTP 409，并明确 `deliveryStage: "not-admitted"`。只在确定发生于入队前的分支输出该阶段。
- `SessionApiError` 保留服务端错误代码/送达阶段；公共分类方法区分明确拒绝与 outcome unknown。覆盖现有明确校验/权限/占用拒绝，网络断开、超时和无明确阶段的 5xx 继续按未知处理。
- 不把所有 500 改为 409，不通过中文文案匹配判断送达，不在全局错误处理器声称所有失败都「未发送」。网关入队成功也不等于原生已接纳。
- 保留队列自己的 failed/uncertain 分类与暂停机制。若需要透传阶段，采用向后兼容的可选字段，不修改既有持久 journal 的身份或正文。

### 2. 在已知占用时阻止本次提交

- 将现有只读 access 结果做成按 threadId 隔离的轻量共享快照，复用提示组件原有查询；相同快照不通知订阅者，不增加后台轮询。
- 主输入和侧边输入在 external/releasing 状态保留可编辑草稿，发送不可用，并在输入区解释「会话被其他客户端占用，未发送，草稿已保留」。公共服务也检查同一状态，覆盖快捷键和其他调用入口。
- 初次/失效快照在用户主动发送时按需只读核对，带取消、并发合并及旧响应保护；查询本身不 resume/acquire。后端仍负责检查占用变化的竞态。
- `readonly` 继续允许用户主动发送时恢复**原会话**。未加载状态、旧运行层不支持查询（404），与真实的送达未知分别处理，避免将其都当 external 导致永久禁用。送达未知仍禁止盲目重复投递。
- 子 Agent 保留 `canAcceptDirectInput === true` 的原生前置验证及目标隔离；公共拒绝处理不能放宽这些权限。

### 3. 撤销明确未接纳的回显，并防止再次出现

- 增加按 threadId + submissionId 精确撤销的方法；明确入队前拒绝时删除对应临时回显，不影响其他线程/提交。
- 队列返回 failed 且缺少本次原生接纳证据时撤销正文占位；后续队列同步/刷新/重显也不把这类失败条目重新插入正文。
- failed 队列条目仍留在队列内，保留错误、正文、附件、稳定 ID 和显式处理入口。未入队的拒绝保留原草稿。异步失败如果发生在草稿已清空后，通过队列恢复编辑，不能用旧稿覆盖用户的新稿。
- 结果未知继续保留过渡状态与只读核对；正式 userMessage/clientId、已接受回执/turnId 优先于迟到的失败响应。已送达但模型报错/停止时保留原生用户消息及执行终态。
- 本地显示撤销不改运行状态，不回滚原生历史，不自动重试、抢占、停止 Agent 或创建替代会话。

### 4. 纠正提交前的界面副作用

- `onAfterSend` 等成功通知移到有效接收回执后；已知占用前置拒绝不触发滚到底部或会话预览更新。
- 有资格提交的请求保留现有临时回显与主动定位行为；竞态拒绝后撤销占位，不声称请求中的临时占位从未出现。
- 继续使用捕获的 owner + draft revision 清理成功提交；拒绝不会清空正文、图片、引用或另一会话的新草稿。
- 消息队列锁问题显示服务级原因，会话 writer 冲突显示会话级原因；提示放在输入/队列状态区。

## 修改范围

主要涉及 `followupService.ts`、`useCodexDeliveryStore.ts`、`CodexDeliveryEchoes.tsx`、`services/apiAdapt/shared.ts`、access 共享快照与现有提示、主 Composer/SideChatPanel，以及网关 `session-followups.ts`。补核子 Agent 输入和 queue/steer/replace 的公共路径；不改变其权限和中断确认。共享协议只有必要的可选阶段字段才调整。

实现时同步 `docs/session-message-delivery.md`、`docs/session-ownership.md`、`docs/session-followups.md`、`docs/debug_list.md` 与 `memories/repo/debug_list.md`；发送行为清单同步 `docs/func_list.md`。以上记录本轮尚不写成「已修复」。

## 红绿灯测试与验收

先增加能复现当前错误的失败用例，再实现转绿。最终以用户看到的正文、草稿及实际调用次数共同验收。

| 场景 | 通过条件 |
| --- | --- |
| 已知 external/releasing，点击/快捷键发送 | 提交次数 0，正文无新气泡，草稿与附件保留，有输入区说明。 |
| 核对后占用发生竞态，409 拒绝 | 本次占位撤销，未产生原生消息；其他会话/提交不受影响。 |
| 两个网关争用真实 journal 锁 | 返回带稳定代码/阶段的 409；未入队、原生调用 0；前端不显示 uncertain 气泡。 |
| queued → sending → failed | 失败消息仅在队列中；反复同步、切换、刷新不恢复到正文。 |
| 断网/超时/缺失回执/无阶段 5xx | 不误判明确拒绝，稳定提交 ID 保留；不盲目重发，核对后按 clientId 合并。 |
| 原生事件先到、失败响应后到 | 已接纳消息仍保留，只有一个正式用户消息。 |
| 送达成功后模型失败/停止 | 用户消息与真实终态保留，不能被「拒绝撤销」误删。 |
| readonly 原会话、队列暂停、旧服务查询 404 | 正常显式发送路径不被误封；不自动接管或转发到其他会话。 |
| 异步发送期间改稿/切换会话 | 保留新版本文字与附件；失败只作用于原提交。 |
| 主输入、侧边聊天、可输入子 Agent | 共享拒绝规则均生效；子 Agent 仍通过原生权限验证。 |

最小执行范围：相关服务/store/组件 Vitest、共享协议检查、网关真实锁集成测试；补充 375px/1440px 浏览器占用发送回归，并运行已有 ownership、message-delivery、failed-delivery、drafts、subagent 与恢复/审批回归，以及 `pnpm check`。实现 access 快照/正文生命周期联动后，按 `docs/session-memory-contract.md` 执行 idle-memory 和恢复验收，保持传输前裁剪及事件驱动历史恢复，记录 JS 堆与 renderer RSS，不放宽原门槛。

当前浏览器证据是本机通过局域网地址的隔离数据验证，未验证另一台物理设备，也未重启/中断真实 Agent。部署与实际会话接受消息的验收边界在实施后单独记录。
