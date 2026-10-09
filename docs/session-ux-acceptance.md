# 会话工作台体验验收记录

> 2026-10-09 更新：下文为 2026-10-07 历史状态。用户已明确授权本次自主实现，不再等待普通方案确认；当前实现、复验及原生限制见 [会话模式优化记录](session-mode-optimization.md)。历史红灯已重新核实，不以旧结果代替当前验收。

当前 Goal 为 blocked，目标未完成，仅阻塞在生命周期方案确认；已实现的界面与验证成果保留。主要范围为 `apps/web/src/session-mode`；终端模式仅补扫描选择身份、键盘与必要视觉协调。统一标准见 [DESIGN.md](../DESIGN.md)。

## 隔离验证环境

局域网预览地址：https://10.30.0.24:36651/?mode=session（HTTPS，端口 36651），前端绑定 0.0.0.0。运行参数来自 git 忽略的 `.dev-runtime/session-ux-preview/.env`，使用独立端口与 SESSION_DATA_HOME；不会停止或接管真实 Agent。常用工作台地址 https://10.30.0.24:8484/?mode=session 保持运行。

浏览器使用真实前端及真实组件，以受控 API/事件驱动危险流程；文件测试使用真实 Ace、工具测试使用真实 xterm，磁盘/PTY 请求模拟。此证据验证前端体验与归属，不代替真实 Agent 协议和真实文件系统的端到端运行验收。

| 场景 | 检查方式 | 当前证据 |
| --- | --- | --- |
| 新建、发送、回复、命令结果 | session-ux.spec.ts | 模拟 Codex 请求、流式事件、展开输出 |
| 导航/历史/重命名/失败重试 | session-list-usability、session-identity | 三类 Agent 身份和错误流程 |
| 长对话/代码/阅读位置 | session-codex-performance、session-chat-layout | 1500 条消息、后台更新与四种窗口 |
| 输入与附件/停止 | session-ux、session-stop | 草稿/图片保留，空运行输入停止重试 |
| 文件全文与草稿 | session-files-draft-safety | 503 行尾部完整，多文件、跨工具切换 |
| 工具连接稳定 | session-tools-usability | 三视口与页面切换，真实 xterm |
| 两模式隔离 | session-mode-isolation | Portal 释放全局锁，上层草稿保留 |
| 次级页面 | session-secondary-pages、session-plugins-loading | 定时任务、用量、设置、插件失败与重试 |

## 审查与待完成项

初次独立源代码/浏览器审查发现模型搜索上下文、文件截断保存、工具挂载、模态焦点和失败空态等问题，已通过对应红绿灯与浏览器复验持续修复。不能把这次发现问题的审查计为无高优先级问题的一轮。

仍待确认的行为边界：ACP 切换 Agent 前中断确认；ACP 新会话中断确认与快速历史选择的请求归属；已关闭工具晚返回 PTY 的归属清理；关闭终端工具面板仅隐藏还是明确结束进程。未获得确认前不改变生命周期规则，保留明确提示和已复现证据。

ACP 草稿跨页面保持、审批迟失败归属和快捷键/模态隔离已红绿灯与浏览器验证。最近全量会话单测 223 项通过，仅资源归属问题保留 1 项真实红灯；终端 524 项通过。`pnpm check` 通过。23 项浏览器回归及最后 8 项定向验证通过，使用独立运行配置。后续新增可访问性用例单独通过。当前稳定版本连续两轮独立审查已通过：源码 clean1 与 fresh 浏览器 clean2 均无新 P1/P2。浏览器 fresh 轮补关键操作、可访问性与三视口复验，复用未变化的 18 项和菜单 2 项稳定证据。页面无异常 JS 错误；日志中的 WebSocket 阻断、取消探测和 503 都由隔离测试主动产生。资源归属测试目前有意保持失败，不能宣称全部检查通过。已有健康路由检查假失败已按网关实际前缀规则修正。

本轮没有提交、推送或发布。构建、截图和测试记录存放在 git 忽略的 `.dev-runtime/session-ux*` 中；最终验证结果随实际运行更新。


最后复验：预览前端 HTTPS、预览会话运行层、现有工作台前端均返回 200，四个前后端监听均绑定 0.0.0.0；现有工作台进程 ID 保持不变。最终新增控件的 TypeScript 检查通过。关键截图：`.dev-runtime/session-ux/session-375.png`、`.dev-runtime/session-uiux/files-draft-safety.png`、`.dev-runtime/session-ux-bots-review/welcome-fixed-390.png`；独立 fresh 审查证据见 `.dev-runtime/session-ux-fresh-clean-2/findings.md`。

后续必须先取得前述生命周期方案确认，再完成相关实现、资源归属红灯转绿和新的针对性独立审查。当前两轮 UI clean 不代替这部分验收，Goal 未完成，等待生命周期确认。


2026-10-07 自动续跑补充：没有收到生命周期确认。新增三个 ACP 复现用例，并补终端面板关闭实例用例，连同原晚启动用例共 5 个已复现红灯；不改变产品行为。具体方案、调用归属与失败边界见 [生命周期方案](session-ux-lifecycle-plan.md)。最近完整套件的 223/1 是补充这些用例前的快照，不能用它表示当前所有测试均为绿灯。


2026-10-07 阻塞审计：确认依赖连续三个目标轮仍未解除。当前代码与失败用例再次核对一致，所有独立审查任务均已结束，没有可继续等待的运行任务。可独立推进的工作已完成，Goal 已记录为 blocked；用户确认 [具体生命周期方案](session-ux-lifecycle-plan.md) 后继续实现并验证。该状态不缩小目标，也不代表功能全部完成。
