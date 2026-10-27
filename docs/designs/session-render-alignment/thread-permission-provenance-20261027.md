# 已有会话权限来源与发送边界修复（2026-10-27）

本轮只修复已有线程的权限默认值误投递，不授予写入权、不接管 native、不改变审批 capability。浏览器验收入口为 LAN `https://10.30.0.24:8484`（HTTPS）；所有任务写请求由隔离 fixture 捕获，未向正式 Agent 发送任务。

## 根因与实际链路

未知线程的展示设置包含 `danger-full-access` / `never` / `user` 默认值。旧 `followupParameters` 不区分来源，始终把这些值转换为 `turn/start` 权限；只知道 model 的 native 快照和来源不明的 legacy 缓存也会触发。旧 direct `turnStart` 只按 model 是否存在决定是否发送权限，既不能保护 model-only 快照，也会遗漏用户明确选择但尚无 model 的权限。

实际隔离链路使用前端真实 store/capture/flush/`followupParameters` → Fastify `registerSessionFollowupRoutes` →真实 queue →运行层真实 `Ownership` →自有 raw endpoint。raw endpoint 的只读 metadata 明确返回严格权限，但这些层均不剔除默认权限覆盖。修复前 unknown、native-model-only、legacy 三组实际 raw `turn/start` 都收到 `never` / `dangerFullAccess`。生成的 `TurnStartParams` 契约表明这些字段会覆盖本轮及后续轮次，省略才继承 native。

该证据不等于在正式账号执行了权限修改；未启动 native 任务、未连接正式 IPC，也不推断组织约束会允许这些覆盖。

## 来源与事务规则

- `permissionSources` 按 approvalPolicy、approvalsReviewer、sandbox、sandboxPolicy、webSearchRequest 保存 `native` / `local`，与具体配置一并进入原 IDB thread 事务。它仅描述设置来源，不是实时授权证据；原 volatile `nativePermissionMetadata`、writer/owner/reviewer 能力门控保持。
- 新编辑在事务重放时重新计算实际字段和来源差异。未知默认值上的首次同值选择也是语义编辑，写入 pendingFields；已经明确的同值选择保持 no-op。network-only 编辑在事务内改精确已有 policy 的网络字段，保留原 roots、临时目录限制、externalSandbox 类型，不从旧页面复制整 policy。
- 迁移时，modern `nativeSettings` 的明确且当前值匹配字段可恢复 native 来源；modern 的明确 pendingFields 可恢复 local 来源。仅 model pending 不赋予权限来源。`nativeSettings === undefined` 的 opaque legacy 不从默认值推导。
- **旧同值选择的不可恢复边界**：旧实现可能保存 `pending=true, pendingFields=[], sandboxPolicy=null, nativeSettings={}`。来源已丢失，不能证明是明确 Full Access。保留原值与草稿、显示待确认，用户再次显式同值选择可恢复来源；不声称所有历史选择都自动恢复。
- 原生快照/ACK 只确认实际出现且应用的字段。稀疏 model ACK 不消除待确认权限；旧 readToken 不确认后来选择；后来 native mode-only 变化不能借用旧 local 来源编造完整 policy。
- capture 冻结数值与来源，沿用原 prefix completion/HMR handoff。无 prefix 时必须读取一次当前 IDB row，不能仅凭缓存的 empty/default 行认定没有另页选择；比较的是该事务 row，不是含捕获后新编辑的可见 projection。未保存 capture、旧 scope、无来源 schema 的旧 HMR capture 不得发送。

## 发送及 UI

`threadPermissionParameters` 由 followup 和默认 direct turnStart 共用：未知、model-only、opaque legacy 均省略未确认权限；完整 native policy 保留；显式无 model 权限照常发送。只有 mode 的 native 快照不能证明 workspace roots/network，不构造 `writableRoots=[]` 覆盖。新聊天默认仍由其明确的本地配置提供。

仅修改 network、基础沙箱不足以表达时抛 `MutationNotStartedError`，正文、附件和选择保留，不开始提交或写入 echo。Composer 在开始发送前显示该错误；已有 Goal-only 不投影普通 turn 权限，只执行 GoalSet。权限菜单显示“权限待确认”且不把 Full Access 标为已选。原 Full Access 确认和 auto-review capability 门控不变。

已完成 rollback 的编辑重试直接复用其 `saved.config`，不会先读取新偏好，不重复 rollback。首次 rollback 若权限不可表达，则在读取/变更历史前拒绝并保留编辑稿。显式子 Agent/rollback 冻结参数依旧是完整域，缺字段继承 native，不补当前偏好。

## 红绿灯与证据

统一目录：`.dev-runtime/session-unknown-policy-audit-20261027/`。

- `permanent-red.log`：初始永久来源回归 8 红、2 绿；覆盖未知、model-only、legacy、同值选择、稀疏 ACK、跨页捕获和不完整网络选择。
- `send-red.log`：queue/direct 入口的未开始提交错误类型 2 红，其他 9 项已通过；现均为明确 `MutationNotStartedError`。
- `native-mode-red.log`：ACK 后 native mode-only 被误当 local 的新增反例 1 红，17 绿；修复后省略未观察到的完整 sandboxPolicy。
- `edit-red.log`：completed rollback 被新权限偏好阻塞的 1 红；`edit-green.log` 4 文件 44 项通过，包含原编辑/未知回执边界。
- `final-unit.log`：14 文件 194 项通过，包含来源 18 项、两条实际发送服务入口 11 项、真实权限菜单 3 项及原 store/IDB/native metadata/Full Access/发送消费者回归。与上述 44 项有重叠，不相加作独立总数。
- `browser-red.log`：1440/390 两尺寸均未显示错误提示；`browser-green-01.log` 两项通过，实际 DOM 验证保草稿、按钮可再次操作、无普通任务写、Goal-only 仅一次 set、无 pageerror/横向溢出。
- `browser-final.log`：最后冻结源码上重验权限两尺寸与原 Goal storage 两尺寸，结果见日志；`manifest-before.json` / `manifest-after.json` 记录本轮九个产品文件 SHA-256。
- `evidence-final.json` / `run-final-02.log` 保留修复前六来源实际 queue/Ownership 捕获；`evidence-after-fix.json` / `queue-ownership-green.log` 为首次修复后对照；`evidence-final-green.json` / `queue-ownership-final.log` 为冻结后复验。旧 artifact 不覆盖。
- `tsc-03.log`：前端 TypeScript 检查通过；全仓 `pnpm check`、最终 Session 全量与其它并行功能联合验收由主线程统一记录，不能由局部通过替代。

永久测试：`stores/threadPermissionSources.test.ts`、`services/threadPermissionSendBoundary.test.ts`、`AccessModePopover.unknown.test.tsx`、`features/thread-workflows/edit.test.ts`、`tests/e2e/session-permission-provenance.spec.ts`。既有 followup 参数保持测试补齐明确原生权限 fixture，mode-only native 创建测试改为严格要求省略未确认 policy；没有放宽未知不投递权限的断言。

## 最终复核：审批人未知不能呈现为 user 模式

根线程独立审查补出来源 UI 反例：完整 workspace sandboxPolicy + on-request，但 approvalsReviewer 未出现时，该快照同时兼容原生 user 和 auto_review。旧 known 判断只要求 approval/sandbox，便用默认 user 把“请求批准”选中。新增实际 AccessModePopover DOM 回归先红，known 现在也要求 reviewer 来源；之后补到 native auto_review 会显示“帮我批准”，完整 user 与显式同值 Full Access 保持可选。自动审批能力仍走既有原生确认门控。

`reviewer-ui-red.log` 为这一项真实行为红灯；`reviewer-ui-green.log` 的剩余失败是打开 modal 菜单后用可访问树查找被 aria-hidden 的旧 trigger，DOM 已有正确标签，改为核对原 trigger 的 aria-label 后，`reviewer-ui-green-02.log` 六文件 57 项通过。测试仍严格检查每行 aria-checked 与后续 native auto reviewer，不放宽行为断言。

其它来源显示消费者只发现 FollowupSnapshot 直接展示已捕获的实际 sandboxPolicy，并未把缺失 reviewer 当 user；其它设置 hook 消费者不显示 reviewer 模式，未扩大修改范围。

该补充改变前一轮最终 manifest 的单个 helper 哈希。新的产品/测试冻结由 `reviewer-manifest-before.json` / `reviewer-manifest-after.json` 和 `reviewer-browser-final.log` 记录；前文 194 单测、4 浏览器及 tsc 为该补充前证据，不能冒充最后全量。根线程已取消补充前的自有全量单测，最终全量/编译由根线程在新的冻结状态重新执行。

最后 reviewer 条件冻结后的权限浏览器复验已完成：1440/390 两项均通过（11.2 秒），零 pageerror、无普通任务写入、Goal-only 精确一次 set，前后九文件 manifest 完全一致。该批为普通功能验证，与根线程编译/全量调度无性能计时结论。
