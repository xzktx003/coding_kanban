# 2026-10-27 会话模式本批验收汇总

完整目标保持进行中，范围与尚未关闭的项目见 [当前要求核对](current-goal-audit-20261027.md)。本记录汇总本批新增代码与最终门禁，不把历史批次或分项通过称为整个会话模式完成。

## 本批变化

- [同主题附着条](composer-rail-theme-20261027.md)：真实官方diff/queue/Goal对照、桌面完整队列和动作布局、手机详情入口、Goal Portal退出与自有读取取消。固定4项SVG markup缓存避免同名重渲染替换path，换图标仍正常更新。
- [队列可见性](queue-visibility-20261027.md)：同thread控件共用观察器，隐藏/模式切换/次级页/离线暂停前台快速读取；保留后台元数据、共享送达核对和缓存。
- [多客户端提交身份](submission-multiclient-safety-20261027.md)：独立同文编辑与同一捕获编辑区分、确定性新ID、规范化对象键和实际POST；旧UUID/v2精确绑定保留，未知旧记录不猜新ID。旧自动草稿导入不标记为新编辑。
- [联合恢复](multi-client-recovery-20261027.md)：同源双页、双项目分屏、1200历史项、未读、阅读位置和未知回执联合验证。

## 最终检查

证据根目录 `.dev-runtime/session-goal-batch-20261027/`：

| 检查 | 最终结果 | 原始记录 |
| --- | --- | --- |
| shared / runtime / server / web 类型与生产构建 | `pnpm check`通过；现有大chunk提示保留 | `check-complete.log` |
| 全量会话目录单测 | **540文件、3269项全部通过**，397.59秒 | `session-all-complete.log` |
| 源码冻结核对 | **2617文件前后不变**；无增删或哈希变化 | `source-before.json` / `source-verification.json` |
| 补丁空白检查 | `git diff --check`通过 | 当前工作区命令 |
| 正式浏览器只读 | 1600×1000、393×852均显示目标历史回复和待回答问题，无错误提示/横向溢出，pageerror 0、任务写入0；3条历史读取200 | `formal-readonly.log` / `browser-result.json` / `desktop.png` / `mobile.png` |
| 正式服务只读 | 前端HTTPS 200，监听0.0.0.0:8484、原PID1415274；Session服务PID2712539保持 | `pnpm session:status`及监听检查 |

最终源码冻结范围为 `apps/web/src`、`packages/shared/src`、`packages/shared/dist`。全量单测指 `src/session-mode` 目录，不扩称终端、独立Codex模式、所有后端/原生脚本或完整端到端全套测试。

第一轮全量是538文件通过、1文件失败，3262项通过、2项失败和1个未处理拒绝；失败来自 `CodexDeliveryEchoes.test.tsx` 两项旧准备数据只传数字revision，新的未知旧身份保护在POST前拒绝，未到达其回显断言。只将这两处改为实际创建的版本编辑身份，保留原“HTTP前回显/迟到回执不能重插入”断言；该文件15项转绿，随后539文件3264项完整通过。收尾又修复已实证SVG节点重建并增加5项，因此最后再次执行上述540/3269全量门禁。所有前轮失败与绿色日志均保留，未将异常吞掉或放宽断言。

图标独立真实浏览器探测记录 `.dev-runtime/session-rail-icon-audit-20261027/result-{red,green}.json`：原同名重渲染每次替换3个path，修复后同名/改class的childList为0；换name仍更新。两版父按钮焦点都保持，因此不把它归因为已观察失焦，也不据此宣布长期RSS修复。

联合恢复最终批次独立冻结2618输入，1/1通过18.1秒：A隐藏4922ms队列读0，A/B目标ux-0/ux-1、窗格2/1与各自草稿保持；锚点14.125→14.125px，漂移0；仅B一次隔离fixture提交，cwd为project-b，页面异常0。此项的浏览器/后端请求边界详见独立记录。

正式入口为 **HTTPS `https://10.30.0.24:8484/?mode=session`，端口8484**。正式只读检查没有API mock，没有发送、停止、审批、resume/acquire或Goal写入；网络日志中的离开/卸载取消保留，没有把它们写成成功。截图已经主线程查看。构建不替换活跃Session运行层，新运行产物与当前进程不同的状态仍由status明确提示；本批没有停止Agent、重启正式服务、提交或推送。

## 仍未闭合

模型切换notice的官方启用位置、完整composer与富文本队列全状态像素对照、双客户端原生审批、文件/引用上下文的跨页持久化以及长期RSS红灯，继续按完整要求核对。真实参考组件与模拟手机不等于完整认证宿主或实机验收；这些未完成项目不因本批全量单测通过而自动关闭。
