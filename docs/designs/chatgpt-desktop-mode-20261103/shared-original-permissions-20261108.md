# 共享 CLI 的原版线程权限选择（2026-11-08）

实际原版 Send 已到达共享创建 intent/ACK，原生预检随后以 `SHARED_CREATE_EXPLICIT_OPTIONS_UNSUPPORTED` 拒绝 `permissionsConfig`、`approvalsReviewer`、`multiAgentMode`。这三项由原版 composer 的真实参数构造器生成，不能删除后宣称继承 CLI 默认权限。此前 private local 的模型回复不作为共享通过证据。

## 参数与执行边界

- 保留原版调用参数与对象：明确的 `permissionsConfig` 和同值 reviewer 原样交给原 manager；`useAppServerPermissionDefault: true` 仍表示原版明确继承，不改成显式权限。
- 只支持原版固定 `multiAgentMode: 'explicitRequestOnly'`；它属于 turn 参数，不能混进 thread/start 权限。其他模式及未知非空选项明确拒绝。
- thread/start 按固定原 SDK 将 active profile 投影为 `permissions`，没有 profile 时使用原 sandbox 映射；保留真实审批策略、reviewer、工作目录及运行根。原生成器的 `mockExperimentalField: null` 是已知空字段，只能投影掉空值，不能转发或放行非空实验参数。
- 同一 source 的实际写前 proof、requirements 校验及真实 ThreadStartResponse 的权限回执必须绑定本次创建。支持线程选择不修改全局 CLI 配置；已有账号、daemon、view、手势、最终写入 guard 仍是必要条件。服务端证明闭包正在集成，未以离线测试替代它。

## 最小验证与当前状态

`native-shared-thread-creation-routing.test.mjs` 覆盖实际选项保留、投影不符拒绝和已知 null/false 字段。`native-shared-original-create-defaults.test.mjs` 直接执行固定原 JJ/tD，重现修复前的三字段拒绝，并验证 auto/read-only/full-access 与明确继承的区别；显式提供 `CHATGPT_DESKTOP_SIDEBAR_ASSET_DIR`，缺少原件时的 skip 不计通过。

`native-shared-original-sl-defaults.test.mjs` 在显式 `CHATGPT_DESKTOP_NATIVE_OPTIONS_MODULE_DIR` 下执行有 SHA 固定的原 module11249/61082，检查完整 Sl 产物进入实际 adapter 后的 profile、审批、运行根及权限回执核验。该检查没有网络、daemon、SDK RPC 或模型请求。

本轮原件与领域检查已通过；真实共享创建、首轮回复、继续对话和原版 composer 清稿/Stop/Queue 结束仍须在新隔离宿主验收。尚未据此宣布主 8484 可交付。

v14 冻结权限闭包已从真实 GUI 提交一次，越过原三字段拦截，scope 成功后在创建 authorize 被拒；未写出 `thread/start` 或 `turn/start`，没有重发或第二轮。实际界面选择 `gpt-6.1-sol`，推理标签为 `Light`（固定原件映射为协议值 `low`，不是 `light`）；共享连接却没有读取 `model/list`，其独立真实模型目录为空。正在补同一已登记 daemon 的只读目录读取，保留实际模型与权限选择，不用本地 SDK 的目录代替共享证明。私有失败与目录证据：`/data01/home/xing.hu/.cg-ui-8535-av3NXthY/shared-click-v14-options-38pdwe6j/`；主 8484 仍为已验证的免密码版本。
