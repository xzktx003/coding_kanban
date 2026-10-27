# 线程设置消费者：目标捕获与迟到响应保护

2026-10-27。配合线程设置 IDB 改造的消费者审查；本记录不代替核心持久事务、多页合并或最终全量验收。

## 确认的问题与修复

独立 `services/threadSettingsConsumers.review.test.ts` 证实：

- `threadFork` 发出后切换运行实例，旧返回仍 hydrate 子线程并激活；`threadStart`、`turnStart` 只检查运行 epoch，账号切换后的旧回执仍能更新设置/当前线程/轮次。
- 旧账号历史读取的返回能写线程元数据和正文；同 thread 的新账号读取还会复用旧 pending promise，随后得不到本次所需的历史。
- 普通 followup 的已发 POST 旧账号回执仍能被 accept 到当前队列；这部分由主线程修复，独立用例验收。

新增 `codexOperationScope.ts` 提供本页生命周期标记，绑定账号命名空间、账号类别及账号状态；运行切换、账号字段变化、同值账号通知和模块替换都撤销旧标记。`goalCompletionAutoClear.ts` 为已有账号撤销入口增加独立订阅，因此没有安装 Goal coordinator 的侧边会话消费者也能收到同值撤销。HMR disposal 解除订阅并保留递增标记；不依赖可重置的模块数字来重建 settings scope。

- 新聊天捕获同时包含 cwd、配置和 operation scope；本地准备等待后、原生创建返回后均重查。
- 分叉/发送/侧边会话在回执落入任何状态前重查。已发请求结果不明确时只报原连接待核对，不改成“未发送”，不自动重试。
- 侧边会话仅合并同 scope 的并发创建；旧 promise 的 finally 不删除新 scope 的 pending 项。父配置回退按值克隆；没有声称这一改动为 fork 增加了 IDB flush 门禁。
- 历史正文与补充元数据均先检查原 scope。请求合并键包含 scope revision；版本和 controller 身份继续保护旧 finally，旧错误不能改写新请求状态。保留原 recent/history 读取通道、并发/超时/正文预算、事件驱动恢复及只读协议。
- 这是本设备旧回执防护，不是服务端授权，也不宣称跨客户端 CAS。正常切换输入目标仍可让原线程收到自己的有效回执，不把普通标签切换当账号撤销。

## 验证证据

目录 `.dev-runtime/thread-settings-consumers-review-20261027/`：

- `red-02.log`：三项真实迟到 mutation 红灯；另一个 followup 用例当时被新设置校验挡在 POST 前，属于测试边界适配，不计该项真实红灯。
- `green-01.log`：三条 mutation 修复后通过；调整 mock 边界后，followup 旧账号 POST 回执得到真实失败，后由主线程修复转绿。
- `standalone-scope-red.log`：无 Goal coordinator 的同值账号通知 1 红、账号 ABA/运行事件 2 个控制通过。
- `history-red-02.log`：旧账号正文污染、新账号错误合并旧 promise 两个真实红灯。
- `regression-03.log`：7 文件 **105/105** 通过，含上述边界、创建捕获、Goal 状态、侧边会话和已有历史回归。该批未作为后续新增边界用例的最终统计。
- `regression-02.log` 的 104 绿/1 hook timeout 来自新全局 IDB reset 与 creation-capture fixture 清理顺序：测试在事务完成前清掉 fake timers。现 fixture 先推进并等待本例设置持久化，再清 fake timers；未放宽 hook 超时，重新全批通过。

真实 UI：`tests/e2e/session-goal-settings-storage.spec.ts` 复用原 Goal fixture 与完整 Composer，局域网 **HTTPS `https://10.30.0.24:8484`，端口 8484**。只对真实线程设置 IDB 的 readwrite 事务注入配额失败，1440/390 两个尺寸均验证普通消息 disabled；输入 `/goal` 并确认后只发生一次精确 GoalSet，模型设置仍 error、乐观选择保留，0 新建/普通 turn/followup 调用，0 页面错误。`goal-browser-01/` **2/2** 通过，10.5 秒。这是修复后的行为验证，未以此宣称取得旧 Composer 原版本浏览器红灯。

全部协议/API 写入仅走独立 fixture，没有连接真实 IPC、读取账号或发正式任务；未启动/停止正式服务。实体手机、账号真实切换、长时内存及整批 HMR 需由最终联合验收另计。

## 冻结参数的额外反例与最终局部批次

独立审查进一步确认 `turnStart(configOverride)` 原先仍从当前线程设置补默认值，再覆盖已捕获对象。当 rollback 捕获时 personality=null、`followupParameters` 因此省略 personality，等待期间本机选为 friendly，最终原请求会额外带入 friendly。`frozen-personality-red.log` 为真实失败请求断言。

现有六参调用来自 rollback/retry 与新 Goal 首轮，传入完整冻结参数域；显式 override 现只用 capturedConfig，遗漏字段（含可选 cwd）留给原生继承，不补当前 UI 偏好。普通无 override 路径仍捕获并等待正确线程的设置。子 Agent 显式 followup 参数门禁边界由主线程的独立测试保留，不用主线程权限填入遗漏项。

最终本地回归：

- `regression-04.log`：8 文件 **113/113**，包含现有 rollback 编辑、创建配置、历史、Goal 状态、侧边会话和独立 scope 测试。
- `tsc-03.log`：前端 `tsc --noEmit -p tsconfig.json` exit 0。
- `goal-final/` / `goal-final.log`：**3/3** 真实浏览器，14.0 秒，包括 1440/390 settings storage 失败时 existing GoalSet，以及原有新 Goal 首轮接受、后续 GoalSet 拒绝不重发/不删已引用文件的用例。
- `source-final.json` 保存本 agent 最终独占源码与测试指纹。该指纹不是整仓生产构建冻结清单，其他 agent 的核心存储/消费者批次由主线程统一验收。

## 全量回归补充：被撤销的初始历史不能伪装成功

主线程 r4 memory/browser 回归中，四个 20-tab 场景持续只恢复 17 个。独立检查确认，本节之前的 scope guard 在抛弃旧响应后返回 fulfilled；`followedSessionHistorySync` 因此把该 revision 标为 done。空闲 watchdog 只处理真实未确认发送，不能重新触发这几个未载入的历史。

新增实际 `codexService` 与实际关注历史调度器的集成测试 `followedSessionHistoryScope.test.ts`，分别控制初次账号状态 null→known、同值账号通知发生在 history response 之前。两例先红：历史未载入、旧请求却被标完成；现通过 `HistoryReadScopeChangedError` 明确“本次没有可用快照”。关注调度器保留 wanted revision，并在原请求 finally 释放位置后重新进入同一读取队列；不走成功 done，不增加错误退避，不增加轮询、并发、超时或正文预算。普通网络失败原退避策略不变。

每例修复后只发两次只读请求：一次旧 scope 响应丢弃，一次当前 scope 恢复；没有旧正文、成功后没有额外读取。直接读取的旧 scope 调用者收到明确错误，不能再把它当作已经读到内容；对应旧测试改为断言该错误，同时保留“不写旧元数据/正文”和新请求 loading 的断言。

证据 `.dev-runtime/session-history-scope-recovery-20261027/`：

- `red.log`：两项实际调度器＋服务集成红灯。
- `units.log`：4 文件 **67/67** 通过，包含原历史与关注恢复回归。
- `browser-01/`：因收到主线程并行全量单测尚未结束的消息而中断，只保留部分证据，不计最终通过。
- `browser-02/` / `browser-02.log`：原先失败的 **8/8** 全部通过，3.4 分钟。包含 20 tabs 的四个尺寸/主题、阅读锚点与离线刷新、原生 SSE 缺帧/断连、50 tabs 冻结恢复及慢读隔离、自然 60 秒休眠回收后完成/未读/只读重显。未改原测试或放宽任何断言；50-tab 计时段开始前另一模型控件浏览器已结束。

进一步核对两轮原始 `idle-memory-observations.json` 后，idle 红灯的归因已缩小：

| 原始观测 | r4 失败批次 | 修复后 browser-02 |
| --- | --- | --- |
| visible-and-background | 0.009 秒，仅 ux-0=16；ux-1/2 无正文 | 0.008 秒，ux-0/1/2 各 16 |
| dormant-body-expired | 0.041 秒，仍仅 ux-0=16 | 63.238 秒，仅 ux-0=16 |
| read-only-reactivated | 未到达 | 95.167 秒，ux-1=18 |

旧轮缺少 ux-1/2 已成功载入的有效前置观测，`counts === undefined` 在不足 0.05 秒就误通过“已回收”检查，不能将稍后 counts=4 解释为已休眠正文重新填充，更不是永久内存增长证据。修后完整加载、自然约 60 秒回收、后台完成保持无正文、重显只读恢复的阶段均有原始记录。主线程将为原 idle 用例增加 ux-1/2 初始正文均大于零的前置断言，保持 TTL、预算和最终无正文断言，再跑完整八项；此文不提前宣称该新增前置断言的最终批次已通过。

独立 activity retain/forget/dormant 诊断脚本已准备但未执行，不冒充诊断结果。全部 API 写请求仍由隔离 fixture 拦截，正式 Agent、历史和草稿未操作。

## 正式深链接补充：内部恢复信号与公共取消契约分离

主线程正式 LAN 只读复验发现：正文已恢复、9 次历史 HTTP 200，但出现一个未处理 `HistoryReadScopeChangedError`。实际深链接经 `useUrlParamThread → navigateToAgentSession → void codexService.setCurrentThread → loadThreadHistory`；导航的 void 调用没有接收新增的内部恢复异常。ThreadList、ThreadManager、PinnedList 的 async 点击也会传播该异常。其他直接读取入口的 catch 已逐一核对，没有通过全局过滤 pageerror 掩盖问题。

现 `loadThreadHistory` 增加仅供关注调度器使用的 `reportScopeChanges` 选项：

- pending map 始终保存原始、能拒绝 typed scope 撤销的 promise，不保存 UI 吞过撤销后的 promise。
- 普通 UI 以及每个复用调用者分别包装原始 promise，仅把 scope 撤销恢复为原有静默取消；同 scope 的真正读取错误仍 reject，仍记录可操作的 `historyErrorMap`。
- 只有关注调度器设置 `reportScopeChanges:true`，继续保留 wanted revision 并重新进入原队列。UI 先发、调度器先发两种合并顺序都不会把撤销当作恢复完成。

`.dev-runtime/session-history-scope-contract-20261027/red.log` 保存三个真实红灯（两种共享顺序、实际 `setCurrentThread` 导航）及真正读错控制通过；`green.log` 为修复后 **6 文件 88/88**，包含主线程全量中唯一失败的原 `sessionState.transitions.test.ts`，没有修改其旧取消契约断言。前节的 typed 撤销错误现是内部调度器协议，不再要求普通 UI 消费者处理它。

正式只读复验采用主线程原脚本的独立副本，另明确阻止所有 task mutation 请求，证据完整保存在 `.dev-runtime/session-real-read-scope-contract-20261027/`，没有覆盖旧失败记录：

- `browser-result.json`：桌面 1600 和手机 393 宽度均有正文和提问区，历史错误提示为空，无横向溢出；`errors=[]`、`writes=[]`。
- 9 次历史读取均返回 HTTP 200；`browser.log` 结尾 `PASS`。
- `desktop.png`、`mobile.png` 保存真实页面；自有浏览器已关闭，没有重启服务或发送任务。

此正式复验只证明目标页面的只读恢复与无未处理取消异常；最终生产构建、全配置单测和带初始已加载前置断言的完整 memory 批次由主线程汇总。
