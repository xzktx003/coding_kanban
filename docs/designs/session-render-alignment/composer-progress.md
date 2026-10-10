# Codex 主输入区实施与证据

本文记录 `native_composer` 的实施范围。运行入口为 **HTTPS / 8484：`https://10.30.0.24:8484/?mode=session`**；原包只读对照为 **HTTP / 43831：`http://10.30.0.24:43831/native-markdown.html`**。Composer 浏览器验收没有重启正式服务，没有执行真实 Agent 的发送、目标、审批或云任务写入。另行授权的临时原生生命周期验证见文末。

## 已实施

| 项目 | 实现与验收 |
| --- | --- |
| 主 composer | 使用原包启用的 `ComposerLayout` / `_ComposerLayout*` 数据属性、22px 圆角、桌面最小 98px、13px/20px 正文、28px 原生控制。新样式只限定 Codex 与 `.session-mode`；保留独立共享输入和原有直接工具。 |
| 图标与主题 | plus、send、stop、microphone、chevron、model check、Fast bolt、权限 hand / shield-code / shield-warning 来自原包实际 SVG。菜单 Portal 单独获得 Codex 主题变量，修复透明滑轨、无背景及通用 SVG 颜色覆盖。 |
| 模型菜单 | Codex 专用简单推理滑轨与高级模型 radio 列表；实际 catalog 决定选项。224px 菜单、20px 圆角，简单视图 95px；高级两模型内容 83.42px，原包使用 `offsetHeight` 舍入为 83px。选择模型保留可用强度，返回简单视图并保持菜单打开。原生 pointer 切换视图焦点留在 menu 容器；键盘可再进入 radio 列表。保留自定义提供商与 typed model 配置。 |
| 服务等级 | 仅实际 `Model.serviceTiers` 开启 Fast / 等级入口；同 owner 保存，队列、引导及编辑提交捕获 `serviceTier`。没有 catalog 能力时不创建假 Fast 按钮。 |
| 权限与计划 | 默认 `workspace-write / on-request / user` 对应原生“请求批准”，不再冒充“帮我批准”。审批 reviewer、权限、网络、计划模式按 thread 保存，原生 external policy / granular approval 保留；迟到设置不能覆盖 pending 选择。完全访问通过可见确认框设置。 |
| 自动审批能力 | 仅同 owner 已观察到的原生 `auto_review` / `guardian_subagent` reviewer 构成当前可见授权证据；其他 owner 的“帮我批准”禁用并解释原因。接口 enum 本身不作为能力授权。 |
| Enter 与 IME | 三种原生 Enter 设置持久保存；保留已有 Ctrl/⌘ Shift Enter 队列/引导切换。`keyCode=229` 的 IME commit Enter 不发送。原包没有内建 Tab 队列绑定，因此没有新增该绑定。 |
| 附件与长文 | 左侧真实图片缩略图与直接删除；pending upload 跨会话返回仍写原 owner，上传与完成前后 frame / composer 高度相同。长粘贴进入原 owner 上下文，不覆盖正文。 |
| Agent 与手机 | Codex 当前值和切换入口常驻；打开后可直接切换 Codex / Claude，额外 Agent 与高级提供商配置保留。手机主体固定 124px，44px 触控目标，推理旋钮保留 28px 外观而触控区域为 44px；切会话不自动聚焦。项目/目录/分支在一个 48px 横向行内保留全部入口。 |
| 宿主、云与工作流 | `+` 菜单打开真实 `CodexHostPanel` / `CloudTasksPanel`，捕获 `cwd / threadId / draftOwner`。会话菜单调用捕获的 thread 搜索、用户消息导航、Markdown 导出和链接操作，没有新增常驻 transcript 工具条。实际宿主/云结果由对应模块另行验收。 |

## 目标草稿的 owner 与版本

修复旧 `goalEnabled` 全局标志造成的串会话：新的 `goalDrafts` 以同一 `sessionDraftKey` 持久保存 `{enabled, revision}`。提交前捕获目标选项；异步 `threadGoalSet` 成功只清理同 owner、同 revision 的选项。切换到 B，或在 A 再次取消/启用，都不会被 A 的旧返回清理。

新建会话身份与正文草稿同时迁移目标选项；保留最新 revision，已有目标 owner 的选择不会被覆盖。一个仍在内存中的旧全局标志只会归属到首次捕获且实际激活的 draft，之后不再作为其他会话的默认值。存储版本 1 的迁移保留已有 owner opt-in 与 revision。Claude 输入不使用这个 Codex store。

另外，主输入的计划占位/取消和 `+` 菜单网络搜索也改为同一 per-thread hook。网络切换保留原生 sandbox 类型、workspace roots 与其他策略字段，仅修改相应网络字段；界面选择与实际发送参数一致。

## 原包证据

- 版本：`third_party/openai.chatgpt-26.51002.51308-linux-x64.vsix`，展开到 `.dev-runtime/session-render-alignment/plugin/extension/webview/assets`。`composer-600f` 是评论输入，不作为主 composer 证据。
- 主布局：`app-initial-3192ac99b6cd.js` 的 `Yct/Xct`（ComposerLayout）、`qct/Jct`（编辑表面）和 `$Nt/tPt`（原生 Button）；模型菜单 `ps/ms`、`xma/s9i/e9i`；中文强度文字取 `zh-CN-b05cfd55c534.js` 的原始 N8 消息。
- 独立 scratch：`review/native-composer-reference.js`、`review/native-model-menu-reference.js`、`review/native-permission-reference.js`。未改共享 harness 或 `native-exec-reference.js`，未改原包资产。
- 主布局四状态：`composer-native-{1440,390}-{dark,light}.png` 与 `composer-native-reference-metrics.json`。
- 模型八状态：`native-model-{1440,390}-{dark,light}-{simple,advanced}.png`、对应 `native-model-workbench-*` 和 `native-model-reference-final-metrics.json`。`native-model-state-audit-final.log` 记录原始 pointer 简单→高级后 activeElement 为 menu 容器；对照与产品保持相同状态。
- 权限四状态：`native-permission-{1440,390}-{dark,light}.png` 与 `native-permission-reference-final-metrics.json`。原始外层 `PermissionsModeDropdown` 单独渲染会要求 IDE persisted-atom host；对照使用其 unchanged native Menu/Title/Item、原始 yn 层级和同样 props。此对照不冒充完整 IDE 宿主启动。
- 模型叠图/diff：`composer-model-overlay-{dark,light}-{simple,advanced}.png`、`composer-model-diff-*`、`composer-native-model-pixel-comparison.json` 属于历史 `e2e-composer-source-final` 快照，其四个桌面状态超过 8 通道差值的像素为 1.3%–3.5%。后续同宿主逐字段检查定位了副标题、行高、Chevron、滑轨/旋钮边缘、13px 端点和外层双 ring 的真实差异；不能把旧差异全部归于背景或抗锯齿。09:31 冻结后 `model-menu-same-host-final-green.log` 四状态 4/4 通过、24.4s，相关 18 单测和 Web 类型检查通过。原包自然 simple panel 为 94.65625px，advanced 为 83.421875px，产品相等；原包 motion wrapper 使用 offsetHeight 取整，不为此裁切产品高度。旧浅色 #242424 与 #3b3b3b 来自不同宿主参数，同宿主对照没有改全局前景色。动态 effort 色与 Portal 字体 flags 的额外判别单列，不将四状态结果泛化为全部分支。

以上 artifact 均位于 `.dev-runtime/session-render-alignment/`，是本地可复核证据，没有作为源码提交。

## 红绿灯与浏览器记录

| 红灯 | 对应修复/绿灯 |
| --- | --- |
| `composer-ime-red.log` | IME 229 Enter；`composer-final-bounded-unit.log`。 |
| `composer-plan-red.log` | 紧凑权限按钮不再隐藏已选计划模式。 |
| `composer-model-menu-red.log`、`composer-native-label-red.log` | 原生简单/高级模型菜单与 N8 中文强度；`composer-native-tier-green.log`。 |
| `composer-tier-control-red.log` | catalog 服务等级与捕获 owner。 |
| `composer-owner-settings-red.log` | thread 隔离、持久恢复、准确 outgoing queue/steer 参数；`composer-owner-payload-green.log`。 |
| `composer-permission-native-red.log` | 正常审批真实语义与未知自动审查能力禁用；`composer-permission-native-green.log`。 |
| `composer-agent-direct-red.log` | 常驻当前 Agent 入口与直接切换；`composer-agent-direct-green.log`。 |
| `composer-model-focus-red.log` | 原生 pointer view 切换保持 menu 容器焦点，修复人为 focus 产生的额外背景；`composer-model-focus-green.log`。 |
| `composer-goal-owner-red.log` | 延迟 A→B、更新后的 A 选项、同 owner 成功、身份迁移与持久恢复；`composer-goal-owner-green.log`。 |
| `e2e-composer-icon-red.log` | 主发送圆形与前景/背景对比被通用按钮样式覆盖。 |
| `e2e-composer-status-red.log` | 上传 status 错误内联导致输入区高度跳变。 |
| `e2e-composer-portal-red.log` | Portal 缺主题变量导致模型滑轨透明。 |

直接相关 Vitest 最终 14 文件、53 项通过：`composer-owned-complete-unit.log`。目标隔离、captured network/plan 与原生焦点分别保留 `composer-goal-owner-green.log`、`composer-model-focus-green.log`。完整 web `tsc --noEmit` 通过，记录 `composer-owned-complete-tsc.log`。

桌面 1440 与手机 390×844 的深浅主题共 6 个实际 LAN Playwright 用例通过，最终记录 `e2e-composer-source-final.log`。该 spec 通过路由 fixture 和 WebSocket 隔离阻止真实 Agent mutation；验证真实浏览器上传/缩略图解码/菜单/owner 切换，不把 fixture 当成真实远端任务成功。

最终全页与组件截图位于 `e2e-composer-source-final/**/`：`composer-workbench-*`、`composer-model-{simple,advanced}-*`、`composer-permissions-*`、`composer-workbench-agent-*`、`composer-workbench-*-uploading.png`、`composer-workbench-*-image.png`。主桌面/手机、两主题、Agent sheet、权限和模型菜单均有整页证据。

## 明确的适配与依赖

1. 项目自身的 Agent/provider 切换、只读模式、计划、mentions、直接工具、独立共享输入和左侧图片属于已批准适配；手机 124px、44px 触控和单行项目/分支 footer 与原生桌面几何不同，并保留功能。
2. 实际只读 `config/read` / `config/requirements/read` 在建议的现有网关路径返回 POST 405 / GET 404，记录 `composer-real-permission-capability-read.log`。没有据此启用自动审批，未读取或打印配置中的凭证。review agent 新增的只读适配器仅用于 global/default 配置、正式 runtime 尚未替换；这些值不能授权某个 project owner 自动审批。没有新的实际能力证据时，“帮我批准”保持禁用；实际 native reviewer 仍按 owner 保存和发送。
3. 听写保留真实浏览器/服务链与原始 recording/loading 状态；本轮没有实际录音转写、物理手机软键盘或 iOS/Android 权限弹窗验收。浏览器触控模拟、44px 几何和不自动聚焦已验收。
4. 完整 VS Code host 持久状态、真实账户/云端上传与任务、宿主桥选区闭环由其他并行模块负责；这些 composer 入口接入真实模块，但不能以本 spec 的 fixture 宣称其远端成功。
5. frontend 完整类型检查 `composer-owned-complete-tsc.log` 已通过；主线程另行执行最终跨模块检查。无 commit/push，无服务或运行服务重启。

## 隔离的真实原生生命周期补验

主线程追加的 P0 验证使用刚编译的 `packages/session-runtime/target/debug/codexia-web`（SHA256 `c13aa1fd5583230596ed14441c2e6c4fd5237f480409df8acaf04fbb89fe669c`）与原 VSIX CLI `0.162.0-alpha.2`。独立临时 `SESSION_DATA_HOME / CODEX_HOME / CLAUDE_CONFIG_DIR`，私有认证文件仅临时复制，不打印或保留；只执行一个不使用工具的算术测试轮次。

`native-public-summary-real-receipt.json` 与 `native-public-summary-real.log` 记录实际 catalog 默认模型 `gpt-6.1-sol`，明确请求 `detailed` 摘要。`thread/start / turn/start / thread/read / thread/archive` 均返回 200，实际 turn 完成为 `completed`，8 个 assistant delta，无工具调用、无测试 workspace 文件。原生 stdout 的私有观察器只记录方法与计数，原始 payload / reasoning 不保存。

**此模型原生源公开摘要为 0，SSE 公开摘要也为 0，因此没有证明实际 summary 送达。** 原生源 raw reasoning 和 SSE raw reasoning 均为 0，也不宣称这次模型实际触发了 raw 过滤分支。公开摘要与 raw reasoning 的区分已有 3 项运行层单测；实际非空公开摘要链路仍待产生该事件的原生轮次验证。

运行层按现有安全约定在隔离 loopback 随机端口运行；另一个只暴露脱敏 `GET /receipt` 的短期证据端点绑定 `0.0.0.0:0`，实际验证 HTTP LAN `10.30.0.24:37107` 可读后关闭。只归档测试自建 thread，只停止本测试进程组；原正式 runtime PID 集合前后相同，临时应用、CLI、工作目录已删除。正式运行层激活仍待主线程安排安全窗口。
