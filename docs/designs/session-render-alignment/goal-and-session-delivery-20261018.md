# Goal 与本轮会话模式交付收口

本次交付范围是固定官方插件版本的 Goal 实现与 UI，以及围绕会话阅读、输入、模型菜单和恢复的本轮润色。Goal 创建、替换、编辑、暂停／恢复、清除、完成呈现、用量／预算及附件接线均有源码、行为或协议证据；当前最终 Goal 11 项和官方原组件四组对照通过。状态与操作仍按原生 thread、owner 及回执处理，不把 UI 可见性当作写入授权。

采用 `reverse-engineer-anything` 从官方资产核对实现并分开复核。固定 vendored bundle 为 `openai.chatgpt-26.51007.21434-linux-x64`，6,116,260 bytes、SHA256 `460201045b5f5a4255fda737c9baa4768367a973d735cb37f3467bfe6af95316`；本机参考 bundle 为 `26.1007.21434`，6,116,253 bytes、SHA256 `59b909377a370e09cb8523ab99a1f4ff282a0126527bd339db31e6d9ac7c9c26`，收口时重新核对一致。它们是本次固定参考，不代表未来插件版本。

| 分项 | 实现及证据 |
| --- | --- |
| Goal 状态、操作、预算与原组件 UI | [Goal 原始验收](goal-parity-acceptance-20261016.md)，保留原生隔离协议与 GUI／CAS 边界 |
| Goal 附件 | [R29 真实网关注册](goal-attachment-registration-20261017.md)，实际同 app 红绿灯和运行中物化／读取／清理 |
| 模型菜单与输入交互 | [E12 非模态菜单](model-picker-nonmodal-20261017.md)及其关联前序记录；本轮又补跑原主／展开首击两例通过 |
| 长历史、阅读位置与实际编辑焦点 | [R30 最终验收](history-switch-performance-20261018.md)，含原 500ms 门槛、两引擎控制及短时内存恢复 |

当前 R30 相关单测 44 文件／246 项、性能保护 Node 3 项、指定 E2E strict 13 份和最后一次跨 shared／runtime／server／web 的 `pnpm check` 通过。历史批次有不同源码、范围和重叠用例，各自结果保留，不将旧 695 项或多轮红绿执行重复加进本轮计数。Root 查看当前 Goal 配对截图，没有发现需要再改的布局问题。

运行层保留正式 PID 2712539/start ticks 55361120；状态检查明确报告新磁盘代码未激活。前端 HTTP `http://10.30.0.24:48865/`、参考 HTTP `http://10.30.0.24:37575/native-goal.html` 均绑定 `0.0.0.0`。没有为实验复制登录信息、接管默认 CLI IPC、停止活跃 Agent 或执行提交／推送。

交付不扩称正式 runtime 已启用、认证官方 GUI 已验证、跨客户端 native CAS 已保证、实体手机已测、ct/fullDca 全量移植或本轮长期 RSS 稳定。当前 CLI 对 clear 的比较参数存在既有边界，前端守卫不是跨客户端原子比较。早期 WebKit 刷新 access-control 诊断仍未归因；扩大 20 份旧 E2E strict 的失败也未改写为通过，具体见 R30。历史 30 分钟通过与更早红灯继续保留各自边界。

本页记录本轮代码与约定验收的收口范围，最终放行依据为冻结证据的独立复核及外置 release receipt。后续启用正式运行产物仍遵守活跃 Agent 的安全窗口。
