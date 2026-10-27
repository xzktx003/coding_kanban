# 文件、引用与绘图草稿的事务持久化

2026-10-27。实现位于 `apps/web/src/session-mode/components/codex/composer/v2/{drafts,draftStorage}.ts`。真实双页的旧实现红灯、交互步骤和执行批次见 [双页回归](contexts-multitab-20261027.md)。本次修复不改变文字草稿的同步保存约定，也不提供跨设备草稿同步。

## 原因与存储边界

原实现把本页全部 owner 的上下文快照写入一个 localStorage key。不同页面分别修改不同 owner 时，最后一次保存也会覆盖另一页的 owner；同 owner 的迟到清理只比较 ID 和 text，无法保护路径、行号等元数据变更。

新存储使用 IndexedDB `kanban.session.composer-contexts` 的 `drafts` store，每个 owner 一行。保存读取该行的最新值，在同一个 readwrite 事务内按 context ID 合并本页相对成功基线的变更，再写入。内部修订与公开 context ID 分离：替换、Undo 是新修订，但不会改变已有附件/上下文的公开提交身份。删除仅命中捕获修订；同 ID 已被另一页替换时保留新值。新建、替换冲突失败并保留本页草稿，不伪称 localStorage CAS，也不依赖跨页读后写随机锁。

绘图按 mark ID 合并本页变更，可保留另一页的独立笔画。同一笔画发生不兼容编辑或画布尺寸冲突时拒绝覆盖；界面保留本页内容与错误，提供重试，以及明确的“舍弃本页未保存笔画”恢复已保存版本。异步导出先捕获完整绘图与内部修订，导出成功只条件清除该版本，期间新增笔画保留。

事务使用现有 10 秒可取消读取截止机制，取消会 abort 自有事务并关闭连接；迟到的 open 成功回调关闭连接，不继续数据操作。移入目标行失败会回滚整个双 owner 事务，不会先清空源草稿。每行只保存当前草稿与版本，不保留正文墓碑或无界操作日志。空 owner 行是旧存储迁移已完成的标记；不能删除后重新导入旧备份。

## 旧数据与恢复

`kanban.session.composer-v2` 仅作为只读备份。owner 首次访问时在 IDB 事务内导入；已存在的行（包括空行）优先。旧页面随后重写全量备份不会复活已迁移后删除的内容。解析失败明确显示错误，保留原数据，不静默用空快照覆盖。旧备份的全量读取仅发生在初始恢复或未迁移 owner 的事务读取，不作后台正文轮询。

同步操作先更新内存，状态明确区分 hydrating、saving、ready、error。`ensure(owner)` 等待首次恢复；`flush(owner)` 等待本页保存并重新合并当前 IDB 行，供发送和显式重试使用。保存失败保留内存，并通过 beforeunload 保护离开页面；页面切换不清除该 owner 的内存草稿。刷新后的持久恢复只保证已成功完成的事务，不能把乐观显示当作落盘。

`capture(owner)` 返回上下文及可序列化内部版本表。消费者发送前捕获文字身份和上下文，等待 flush 后检查二者仍匹配，才继续原目标的操作。回执清理按 ID、内部修订及完整数据指纹在实际事务内执行，跨 JSON 克隆不依赖对象引用。清理写入失败保留待清理元数据供显式重试，不重新发送已接受消息。

新聊天创建后先将已创建 thread 加入关注并切换输入目标，再移动上下文。移动失败时已创建目标仍可见，状态面板可重试同一移动，不创建第二个 thread。相同源/目标的并发移动在准备前合并成同一个 Promise。事务已提交但回执交付尚未结束时的新源编辑，作为新的源草稿保存；目标的新编辑也保留，不能把已经提交的移动误当作完整回滚重试。

CloudTasksPanel 在确认前捕获 prompt 并等待上下文 flush，重新核对目标和草稿身份，确认及实际 API 使用同一 prompt。此次接入保护原有草稿流程，不代表 Cloud 功能整体通过原生验收。

### 新聊天创建配置不能跨过异步保存重新取值

独立真实 Composer 回归另复现了新增 await flush 带来的时间窗口：保存事务已提交但 ACK 被延迟时切换项目或模型，旧 owner 的文本/context 仍匹配，原 threadStart 却读取了新的 cwd/model。实际 HTTP 请求的错误目标保存在 `.dev-runtime/session-contexts-multitab-20261027/capture-red-actual/browser/*/capture-boundary.json`。最初探针采用“变化就取消”的断言；最终修复保持原体验，允许导航，继续使用点击时的原目标与配置，而非要求用户重新发送。

`codexService.captureThreadStart()` 在点击时同步捕获 cwd、所有创建用模型/权限/推理/服务档位/协作/搜索/worktree 设置、多 Agent 限制，以及运行连接 epoch。config 和 agents fragment 使用 structuredClone 按值捕获，对象型审批策略不会被原设置对象后续 mutation 改写。Composer 在等待保存或 Goal 文件准备前捕获，传给 threadStart；其他调用者未传时在服务入口同步捕获。worktree 创建与后续 thread/start 都使用同一份值。shouldActivate 仍按原 owner 检查，后台创建不会抢走后来选中的输入目标。运行连接 epoch 改变时，在任何 worktree/创建出站前明确拒绝并保留草稿，不能将旧点击提交到新连接。

`tests/e2e/session-composer-capture-boundary.spec.ts` 的两项真实浏览器回归通过（`capture-green/run.log`）：延迟真实 IDB 保存回执期间分别改 cwd/model，最终 HTTP 参数仍是原值。该探针对 thread/start 返回独立 409 以截住创建，验证实际请求参数与未接受时草稿保留，不宣称创建成功或模型任务完成。首轮 `capture-red` 的错误 route 前缀属于夹具失败，不计产品红灯。服务回归 `codexService.creation-capture.test.ts` 覆盖 local/worktree 两种过期 epoch 在首次出站前拒绝，以及完整配置、Agent 限制和不激活新目标；连同既有 preflight/model/service 用例共 55 项通过（`capture-clone-green.log`）；新增对象型审批策略测试先在 `capture-clone-red.log` 复现旧引用被修改后污染实际请求。

## HMR 与迟到回调

热更新通过 Vite hot.data 移交所有当前已加载 owner 的草稿与成功基线，以及有限的清理元数据和正在执行的事务 Promise。clean owner 同样交接，保留旧界面所观察的版本与 Undo 原值；这是已加载当前 store 的同引用接管，旧 map 随后清空，不额外复制正文或导入历史。新模块按真实事务结果重新合并后续编辑，旧模块释放正文引用，不接受迟到 ACK 回填。保存失败、移动失败和 beforeunload 保护随代次交接。

旧模块捕获的公开 API 通过代次路由转发，已提交上下文的 clear 回调携带捕获版本；新模块尚未 hydrate 时也将精确条件应用到 IDB 行，不能通过查找当前同 ID 项猜测原版本。旧 clearDrawing 如果没有显式捕获版本则不执行清理；新 DrawingEditor 一律传入导出前捕获的版本。旧上传 add 回调仍使用原 owner。独立测试覆盖这些具体回调，不把它泛化为所有旧闭包语义均已穷举。

在 dispose 已执行、successor JavaScript 尚未执行的真实间隙，旧 remove 回调仍须同步返回撤销函数。`remove-gap` 用实际 Vite replacement 响应延迟复现了旧 Proxy 返回 Promise、消费者调用 undo() 抛 TypeError 的故障（`remove-gap-red.log`）。修复只排队一次实际移除，立即返回 async undo thunk；该 thunk 等待 successor 返回的原撤销函数后执行，后续点击复用同一函数与保存重试语义，不重复删除。它不将“删除请求已排队”伪报为“撤销已持久保存”。随后 `remove-gap-clean` 进一步复现 clean owner 未交接导致 remove 根本未删除的故障（`remove-clean-red.log`）；仅验证立即 Undo 后内容存在不足以证明删除生效。交接所有当前已加载 clean baseline 后，必须先核对实际 IDB 删除，再调用 Undo 核对恢复，并保护另一页同 ID 的新版本。早期 `final.log`/`all-six.log` 六项通过仅对应这项完善前的源码；最终 `final-seven.log` 为 7/7（6.4 秒），`final-seven-source-verification.json` 中七例 sourceDrift 与 pageerror 均为空。clean 场景在 gap 内由真实另一页将 protected context 改为同正文的新修订；旧 remove 实际删除原 A，同时保留远端 protected 的精确新修订，随后 Undo 恢复 A 原顺序并刷新核对。每例使用独立 HTTP LAN `http://10.30.0.24:5173/` Vite 副本并已清理。

## 验证与适用范围

- `draftStorage.test.ts`：5 项，真实 fake-indexeddb 事务，覆盖同 owner 合并、迟到替换不复活删除、独立 mark 合并及同 mark 冲突、目标 put 配额异常整事务回滚、旧备份只读与防复活。
- `DrawingEditor.storage.test.tsx`：3 项真实 React 组件，覆盖异步图片导出期间新增笔画、hydrate 期间真实 pointer 编辑、冲突保留与显式恢复。只有图片文件导出和外层 sheet 使用边界替身。
- 上述 8 项通过日志：`.dev-runtime/session-contexts-multitab-20261027/drawing-unit.log`；前端 TypeScript 通过日志：同目录 `context-types.log`。
- `tests/e2e/session-contexts-multitab.spec.ts`：真实同源双页、真实 IDB、真实文件/引用预览和绘图 DOM；9 项开发批次及最终批次状态见 [双页回归](contexts-multitab-20261027.md)。包含撤销保存失败再次点击、Undo 新修订防旧 ACK、移动提交后迟到编辑、真实 Composer 新 thread 失败后的可见重试。
- `tests/e2e/session-context-drafts-hmr.spec.mts`：独立复制源码启动真实 Vite HMR，真实 IDB；保存失败、在途保存/移动、连续代次，以及已 hydrate/尚未 hydrate 的旧 clear/add 回调共 5 项通过。旧代码红灯与通过日志位于 `.dev-runtime/session-context-hmr-20261027/{quota-red-actual.log,closure-version-red.log,all-five.log}`，精确旧源码 `pre-forward-drafts.ts` 和每次 `context-hmr.json` 留存；后续增强及冻结复验以主线程记录为准。

浏览器入口使用现有局域网 **HTTPS `https://10.30.0.24:8484`，端口 8484**。业务 API 全部夹具隔离，不发送正式 Agent 任务、不审批、不重启运行层；配额是对真实事务写入的异常注入，不是耗尽物理磁盘。390×844 手机视口不等于实体 iPhone、Safari 或系统键盘验证。独立浏览器 profile/不同设备各自持有本地草稿，这些测试不声称跨设备同步。
