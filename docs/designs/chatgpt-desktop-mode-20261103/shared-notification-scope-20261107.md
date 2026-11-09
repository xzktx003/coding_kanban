# 共享 SDK 的全局通知范围（2026-11-07）

原 SDK、execution host、manager 已在真实账号实例达到 registered ready；随后同 daemon 的其他线程 goal 通知被较短的 desktop gate 表拒绝，使整个 source 退休。因此一次 ready 不代表稳定共享收发完成。

独立 shared-server-notification-policy.mjs 以固定 CLI 0.166.0 ServerNotification schema 核对已有 bounded follower 的 32 个方法，并保留原 thread/started 与 account 通知分类。测试要求它与现有 follower 表一致，防止另一张列表漂移。分类结果只含冻结的 kind/threadId，不保存 params 或正文，也不赋予 binding、发送或审批权限。

通知必须是精确外层 envelope、规范 thread UUID、原 timestamp/jsonrpc 形状及已知 params 外层字段。Goal 只检查 goal 为对象及 threadId/可选 turnId，不读取、枚举或保存 goal 正文；settings、turn、item 嵌套正文同样不在此分类器递归证明。绑定、实际 native 回执和现有有界 follower 的检查仍必须保留。

状态接线由 source/session 负责：先重核同一 daemon/账号/实例，已知且无真实 follower 或 pending binding 的线程通知按既有零目标规则丢弃，不自动绑定，不向浏览器或正文缓存转发；真实绑定消息继续原有界通道。未知方法、异常 envelope、账号变化和未授权 server request 仍拒绝或撤销，不能将 account 通知当普通背景消息丢弃。

最小回归为 shared-server-notification-policy.test.mjs，包括原表一致性、额外参数/错误身份/异常外层拒绝、流式 primitive 形状，以及用无法读取或枚举正文的 goal 证明分类结果不持有正文。该独立 helper 尚不等于 session/gate 接线或真实模型收发通过；必须由主线程在全新实例实际验证 ready 后跨线程通知不再退休，并继续真实会话验收。
