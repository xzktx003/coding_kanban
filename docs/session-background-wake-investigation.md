# 会话后台闲置与切回调查（2026-11-11）

现场反馈：会话模式打开一段时间、离开窗口，切回时经常崩溃，刷新后恢复。

用户后续截图确认现场错误为 `Maximum update depth exceeded`。继续调查已在真实工作台用Playwright复现同样的外层崩溃，组件栈指向 `LayoutContent`；定向测试将循环定位到 `useSubagentFamilySync → observeSubagentStatus → nodes 更新 → useSubagentFamilySync`。先前的错误边界重试修复并未解决这条触发链。

## 已复现的触发链与修复

原生状态 `{activeFlags: [], type: "active"}` 被缓存投影重建成 `{type: "active", activeFlags: []}`。旧逻辑用 `JSON.stringify` 比较投影前后的对象，属性顺序不同便一直判为变化。每次写入nodes又使historyIds重建、状态同步effect再次执行，最终达到React嵌套更新上限。只要状态在后台恢复或重连时到达即可触发，不要求闲置达到固定时长；此前没有子节点/活跃状态组合的测试未覆盖它。

修复仅调整 `observeSubagentStatus`：先生成既有有界投影，再比较实际保留的type和activeFlags。同值状态不写store、不推进revision；真实状态改变仍通知。扩展字段和被裁剪的超长flags也不再导致同类循环，20项上限与身份/审批权限不变。

红绿灯证据：3个hook用例在旧代码全部触发 `Maximum update depth exceeded`；真实LAN页面注入仅内存的测试子节点后出现同样工作台错误，捕获LayoutContent栈。独立fixture浏览器回归在旧比较代码失败（会话界面卸载），恢复修复后通过；覆盖属性换序、额外字段、flags裁剪、审批状态与完成状态。不连接/停止测试Agent。

## 已执行证据

在现有 LAN HTTPS `https://10.30.0.28:8484` 使用独立 Playwright 浏览器，不发送模型任务，不重启运行层/Agent：

- 可见/隐藏各三轮，每轮隐藏70秒后恢复8秒，无 pageerror、renderer crash 或工作台错误诊断。
- 私有浏览器设置关闭正文保温，真实等待72秒；确认 `[data-transcript-sleeping]` 出现，切回后消失、正文恢复，无错误。
- CDP 真正冻结页面三轮，每轮65秒，唤醒时短暂断网后恢复；无脚本错误/renderer crash。JS used heap 55–65 MiB，renderer RSS约366→501 MiB；这一段不能证明泄漏或排除泄漏。
- 后续十轮冻结/断网唤醒（每轮冻结8秒）：无错误，RSS在约299–382 MiB波动，有自然回落，JS used heap约44–72 MiB；不强制GC。
- 既有 `session-idle-memory.spec.ts` 的 device-local opt-out 和 bounded recent pages 两项通过，分别覆盖60秒回收、保温120秒后压力回收及只读恢复/审批/完成保护。
- 前景/隐藏 hook、事件流恢复、工作台健康恢复、正文留存4份Vitest共43项通过。

采样区分真实 CDP `Runtime.getHeapUsage` 与 renderer RSS。`performance.memory` 在本机曾连续返回同一18200000字节，不能作为稳定内存结论。

## 本轮修改

消息正文内层 `TranscriptRendererBoundary` 会先截获错误，外层 `WorkbenchBoundary` 可能完全收不到。统一记录函数现同时覆盖外层和正文边界，单标签仅保存最后一条有界 message/componentStack及前台状态，键为 `kanban:workbench:last-error`。不保存聊天正文/props/Error对象，存储被禁用时不影响恢复。内层记录新增先红后绿回归。

独立组合浏览器回归位于 `tests/e2e/session-background-wake.spec.ts`：后台正文真实回收→CDP冻结→离线唤醒→恢复正文，断言无整页刷新和草稿标记保留。该测试等待真实时间，不能缩减为快速模式切换。

## 剩余范围

独立浏览器不包含用户原标签页的全部累积状态，用户原浏览器也未连接Magpie Browser；不能逐条核对过往每次崩溃。这次已用确定输入复现并修复一条与截图错误及外层边界一致的循环，不代表已证明所有未来渲染错误都不会发生。此修复不改变内存预算，也不替代长期RSS验收。

截图确认后，额外执行右侧面板开关、聚焦、窄/宽窗口与浮点尺寸恢复共60轮，没有出现页面错误。此结果不能排除现场布局相关循环。错误详情现直接显示有界组件调用栈（3000字符），即使sessionStorage禁用也可取到；该诊断回归已观察先红后绿，5项工作台恢复测试通过。

## 最终补充结果

- 新增后台回收→冻结→离线唤醒组合回归通过（约1.2分钟）；正文恢复，无pageerror，无文档重载，草稿标记保留。初版使用 `framenavigated` 把SPA URL变更误计为文档重载，现以main-frame navigation request判断实际刷新。
- 网格、列表、自由分屏三种布局各15次可见性切换，无pageerror或工作台错误；这项是快速竞态检查，不代替前述真实闲置测试。
- 六份定向Vitest共53项通过，前端TypeScript通过。内层记录单测已观察修复前失败与修复后成功。

## 根因修复最终验收

- 子Agent全组、输入身份、外层恢复与正文重试18文件139项单测通过；新增3项均在旧代码触发React更新深度错误。100次等价同步不通知，idle转换正常。
- Playwright正式状态循环用例先红后绿；同文件真实60秒回收→冻结→离线唤醒通过，共2项约1.3分钟。
- 既有session-idle-memory的device-local opt-out回归通过（约1.7分钟），覆盖完成回执与只读恢复。
- 前端TypeScript和git diff --check通过。运行层PID3580847保持存活，未重启或停止Agent；未提交/推送本轮修改。
