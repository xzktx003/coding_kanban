# 会话模式对齐与多页草稿：第二批联合验收

本批继续执行 [已批准方案](plan.md)，完整目标保持不变。上一批的 540 文件结果不代替本批最终代码的检查；长时 renderer RSS 红灯仍按 [内存约定](../../session-memory-contract.md) 保留。

## 本批实现与直接证据

| 问题 | 最终行为与专项入口 |
| --- | --- |
| 不同页面的文件/引用/绘图快照互相覆盖 | 每 owner IDB 事务按版本合并；旧回执不清新修订，Undo、配额失败、移动交错及异步导出保留新编辑。见 [事务协议](context-draft-storage-20261027.md)、[真实双页回归](contexts-multitab-20261027.md) |
| 保存中热更新丢掉唯一内存草稿，旧回执/上传及撤销闭包失效 | 当前已加载草稿和原基线同引用交接，保留未完成事务；旧清理携带精确版本，HMR 间隙仍同步提供 Undo。真实 HMR 七例既核对实际删除，也核对恢复及另一页新修订 |
| 新会话等待保存时误用后来切换的项目/模型 | 点击时按值捕获 cwd、完整创建配置、Agent 限制和连接代次；保持原目标，不抢新选择的焦点。已换运行实例则在任何创建请求前拒绝 |
| 队列正文无法正确预览、复制和键盘访问 | 官方单行富文本、700ms hover 与只读原文，保留配置入口；链接键盘、Tab 退出、图标拖动及向下重排修复。实际 Session 宿主中两主题完整 PNG 字节一致，见 [队列对照](queue-preview-parity-20261027.md) |
| 模型切换警告常驻在输入栏附着条 | 改回官方临时通知，历史恢复与隐藏模式不回放；深浅 × 900/390 四组 PNG 字节一致。与聊天模型分隔行分开，见 [模型通知](model-change-notice-20261027.md) |
| 长历史占满名额时送达核对未派发就超时 | 原六个名额分为 recent/history/status 3/2/1；取消后同目标不再复用旧 Promise，旧 finally 不删新任务。未知回执不重发，见 [读取准入](receipt-read-admission-20261027.md) |
| 多网页同时审批及断线恢复缺少真实原生证据 | 原包 CLI + 私有 loopback provider + 实际 ApprovalItem/HTTP/SSE，两独立浏览器仅一次回复、旧身份拒绝、重连恢复。见 [原生双客户端审批](native-dual-client-approval-20261027.md) |

## 合并检查记录

第一轮 `pnpm check` 通过。Composer 目录诊断为 84 文件、788 项，其中两个旧 fixture 的六项断言需要随异步存储适配：侧聊权限用例先等待上下文恢复再测试权限，文件拖放用例改为读取真实 IDB、隔离各 case 数据库。原权限、原 owner、迟到文件、顺序和持久化断言保留；文件读取超时只模拟 timeout，避免连 IDB 任务派发也被假时钟冻结。修正后两文件 11 项通过。

损坏旧 JSON 的用例明确先经历实际失败，再修复备份、重试并核对旧/新上下文都保留；没有将失败覆盖成空草稿。独立最后审查还补出活跃读取取消后立即重开的去重竞态、HMR gap Undo 返回类型、clean owner 实际没有删除，以及保存等待期间创建目标变化。对应反例和修复均保留，没有把早期部分绿色当作最终结果。

最终 `pnpm check` 通过，日志 `check-final.log`。首轮全量会话单测为 548 文件／3303 项，其中两个旧 fixture 未隔离 IndexedDB，导致 2 项失败；仅修正 `FileViewer.editor-context.test.tsx` 和 `bridge.test.ts` 的每例数据库及保存收尾，原 owner、路径和 nonce 校验断言保留。两文件 7 项通过后，最终全量重跑 **548 文件／3303 项全部通过**，用时 404.13 秒，见 `session-all-final.log`；首轮失败日志 `session-all.log` 保留。

原始日志与输入清单位于 `.dev-runtime/session-parity-batch-20261027-r2/`。`source-before.json` 是后续发现前的第一轮输入，`source-final-before.json` 是最终产品源码构建起点，`fixture-update-verification.json` 确认其后只有上述两个测试 fixture 改动。`source-confirmed-before.json` 是最终全量重跑的 3253 个输入起点，不能混用。

最终浏览器复验中，上下文多页、创建目标捕获、提交身份及读取取消四组 **22 项通过**（`contexts-submission.log`）；原组件队列/附着条/模型通知对照及真实 HMR 六组 **22 项通过**（`visual-hmr.log`）。本次自有原组件参考服务为 HTTP `http://10.30.0.24:42623/native-goal.html`，验收后已关闭；正式前端保持运行。

内存与恢复八组 **27 项通过、1 项默认长测跳过**（`memory-browser.log`，5.4 分钟），覆盖后台标签同步、慢历史准入、正文自动休眠/重显、分页、流式正文预算、原生 EventSource 裁剪、缺失完成回复与显式只读重试。上述最终浏览器批次合计 **71 项通过、1 项跳过**；未运行三十分钟长测，不据此关闭已有 renderer RSS 红灯。

正式只读复验 `.dev-runtime/history-load-final-20261027/` 中，`REF_xh3_accu` 在 1600×1000 和 393×852 均显示最终回复及待回答问题，5 条历史请求全部 200，加载提示、pageerror、任务写入和横向溢出均为零。初始化日志的一条资源 404 及取消请求原样保留，不声称全部网络请求无异常。Session 运行层 PID 2712539 保持；`pnpm codex:status` 此次只读核对为 broker-ready，但不代表模型对话已验收。

最终原生双浏览器审批复跑通过，见本批目录 `native-approval/approval-i7xz39kl/summary.json`：当前 187 个输入前后未变，真实并发一次回复、陈旧身份拒绝及离线重连断言通过；4 次请求仅访问自有 loopback provider、均无 Authorization，自有 native 后代残留为零。此夹具与正式 Agent 隔离，能力边界仍见专项文档。

最终 `source-final-verification.json` 对比 `source-confirmed-before.json`：**3253 个输入无修改、无新增、无删除**。包括前后端源码、运行层、共享包源码/产物、原生审批夹具及 Session E2E；文档不在源码冻结清单内。构建后只有已记录的两个测试隔离修正，全量重跑及最终浏览器验证均使用修正后的输入。`git diff --check` 和暂存区 whitespace 检查通过，未提交或推送。

## 仍须按完整目标继续的范围

本批零像素差只覆盖明确的模型通知和富文本队列预览状态。原生完整模型菜单启用/真实 flag、全部附件摘要与图片缩略图、六点 hover 手柄和原生键盘排序、完整主/展开 composer，以及原方案其他正文/工具/请求状态仍需对应的最终矩阵。真实审批夹具不是完整工作台/正式网关或两个 native writer 的原子审批证明。手机采用尺寸模拟，未声称实体 iPhone 验收。

正式前端为 **HTTPS https://10.30.0.24:8484，端口 8484**。除单独列出的正式只读检查外，浏览器业务 API 均为隔离夹具；本批没有向正式 Agent 发送、审批、停止或接管任务，也没有重启独立会话运行层。源码与真实运行层的版本差异继续明确保留。
