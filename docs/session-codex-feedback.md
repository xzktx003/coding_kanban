# Codex 反馈表单与上传报告复刻进度

2026-10-11，浏览器验证入口为局域网 **HTTP `http://10.30.0.24:8484/?mode=session`**，前端绑定 `0.0.0.0`。只读原包参考使用隔离 **HTTP `http://10.30.0.24:43831/native-markdown.html`**，验收结束退出本任务参考服务；不重启正式 Agent 或运行服务。

## 实现与原包边界

原包为 `third_party/openai.chatgpt-26.51002.51308-linux-x64/extension/webview/assets/`。表单来源是 `feedback-submission-dialog-12f6f595aa07.js`、`feedback-form-dialog-2b9af5a9d324.js`、`feedback-legal-notice-6e7f82f9efe6.js`；宿主准备在 `app-initial-f7c00c1ab06e.js`，上传编排与报告在 `feedback-upload-cb5de3dd6947.js`，共用 Button、CopyButton 和 Spinner 位于原 `app-initial-*` 模块。

表单保留原六类 bug、bad-result、good-result、safety_check、research-failure、other。分类与非空详情必填，诊断日志默认勾选且可关闭，提供原中英日法字典与帮助链接。提交时捕获 thread、owner、分类、trim 后详情、日志选择、固定 API 地址及认证头，仍使用 `/api/codex/feedback/upload`。公开报告 store 只持有状态、关联 ID、owner 和可见性，不持有详情或认证信息。

默认表单现在把请求交给独立上传任务后立即关闭，HTTP 尚未返回也能看到上传报告；原 thread ID 是初始关联 ID，成功后替换为实际反馈 ID，不生成伪反馈 ID。通用表单的可选异步 callback 仍保留等待、重复锁、失败留存及重试行为，测试通过显式注入 callback 验证该边界，不能把它当作默认宿主流程。

| 状态 | 原条件与报告行为 | 关闭后 |
| --- | --- | --- |
| uploading | 显示上传进度、已有 ID；无 ID 时说明完成后显示 | 上传继续，持久通知可重开 |
| uploaded | 成功回执；复制 ID，打开 GitHub 新问题或已有问题 | 清理工作流 |
| incomplete | 原错误包含 accepted but some attachments failed | 清理工作流，不重复发送 |
| disabled | 原错误包含 disabled by configuration | 清理工作流 |
| failed | 原错误包含 feedback uploads are already in progress；唯一开放重试的失败 | 持久通知可重开并显式重试 |
| unconfirmed | 其他错误或缺少有效成功回执，说明可能已送达 | 持久通知可重开，不提供重试 |

重试复用原提交快照，不向新 thread 或新主机发送。关闭界面不取消已提交的请求；显式移除通知、账号更新／登录通知、Codex 运行连接断开、运行实例重启、配对主机／端口／认证变化后移除旧工作流，迟到回执不复活它。仅在报告存在期间订阅既有 `view=chat` 事件流，最后一个报告移除即释放订阅；没有历史轮询或工具正文缓存。

持久通知核对实例后才响应移除回调，程序隐藏通知不会删除重开的报告或隐藏模式中的任务。报告关闭只在当前输入 owner 一致时恢复焦点；嵌套复制提示不吞掉第一次 Escape。浏览器 Back 共用 `useComposerSheetHistory`。复制使用独立等待锁、原 SVG 与两秒成功状态，组件销毁释放计时器；更换回执时保留原复制按钮实例，仍复制点击瞬间的 ID。复制失败显示原本地化错误文案，通知独立于按钮存活状态；局域网 HTTP 没有 Clipboard API 时复用实际 copy-event 回退。GitHub URL 使用原英文 `Feedback ID: ` 参数编码，外部标签带 `noreferrer`。

## 浏览器对照与证据

参考直接调用未修改原包的公开 `startFeedbackUpload`、真实私有报告组件、原 Provider 与字典。scope、通知服务和反馈 HTTP 响应在独立浏览器隔离；模态移除遵循原 `CIa` 渲染器的 onClose 后移除规则。复制测试通过原包 `Pat`／`Iat` RPC 与原扩展 transport 连接隔离 host peer，实际执行原报告的 clipboard 调用，未替换原模块或导出私有组件。参考通知的按钮是显式标记的服务适配器，**不是原生通知外观的金标准**。

对照涵盖 390／700 宽度、深浅主题、六状态、无初始 ID、原重试边界、关闭后完成与重开、复制等待／成功／两秒恢复、减少动画，以及额外英文／日文／法文。报告逐项比较几何、字体、颜色、padding、边框、圆角、SVG 路径和焦点环。旋转测量将两端动画暂停在同一零相位；仅忽略透明零尺寸阴影层与没有描边时的不可见 outline 颜色，保留可见阴影与环圈。没有声明完整窗口 RGBA 全相等。

最终日志与截图索引见 `.dev-runtime/codex-feedback-upload-evidence.md`，源冻结 SHA256 见 `.dev-runtime/codex-feedback-upload-source-manifest.json`。工作区没有提交，HEAD 不是这批未提交变更的发布 SHA。

复现：核对隔离端口空闲并启动只读参考后，执行：

```sh
PLAYWRIGHT_SKIP_WEBSERVER=1 \
PLAYWRIGHT_BASE_URL=http://10.30.0.24:8484 \
CODEX_NATIVE_REFERENCE_URL=http://10.30.0.24:43831/native-markdown.html \
pnpm exec playwright test tests/e2e/session-codex-feedback.spec.ts \
  tests/e2e/session-codex-feedback-upload.spec.ts
```

## 尚未闭合

- 原宿主账号／工作空间策略预检、诊断档案与临时文件释放、浏览器标签／文档／进程内存附件、远程上传尚未移植并通过实际 extension 验收；当前日志选择只传给已有运行层接口。
- 普通反馈／复制错误通知和动态 viewport boundary 已完成原包 Provider 对照，详见 [Codex 通知呈现](session-codex-notifications.md)。其他宿主专用通知入口仍逐一核对，不扩大为所有变体完成。
- performance-trace 类型、本地 trace 展示及 internal Slack 内容的报告分支尚未完成。真实账号／RPC 生命周期由事件单测验证，不能当作正式账号切换或真实反馈服务的验收。
- 宽泛 `session-codex-dialog-controls` 的既有 MCP「暂时跳过」被智能体菜单挡住，失败发生在反馈之前；旧日志 `/tmp/codex-feedback-owner-regression.log` 保留，未把本批组件测试说成所有对话框全绿。
- 内存测试只覆盖本次短时恢复、传输保护与观测；未重跑 30 分钟自然 GC soak，不声称长期 RSS 增长已闭合。前一批表单的 8 项、减少动画 4 项及源冻结记录保留在 `.dev-runtime/codex-feedback-evidence.md`。

本批验证：上传报告整组 13 项 `/tmp/codex-feedback-upload-closed-freeze.log`、表单 8 项 `/tmp/codex-feedback-upload-form-final.log`；复制截图在相同页活跃和页内焦点下补验，日志 `/tmp/codex-feedback-upload-focused-captures.log`，与主组重叠，不额外累计。单测 29 项 `/tmp/codex-feedback-upload-unit-final29.log`；当前源 shared／web 类型检查与生产构建 `/tmp/codex-feedback-upload-build-verified.log` 通过。

内存短测 3 项通过、30 分钟 soak 明确跳过。上游 100,669,814 bytes 工具帧到浏览器仅 6,178 数据字符，最大事件 317 字符，强制 GC 后 heap 增量 35,964 bytes；原序号、审批和最终回复断言保留。约 97 秒自然观测中，初始／休眠回收／只读恢复的 heap 为 156.54／53.98／123.20 MiB，renderer RSS 总和为 462.36／282.34／588.65 MiB。恢复后 RSS 上升不作为长期稳定证据；测量边界与 JSON 在截图索引中。

完整 Codex 编辑器与对话区域复刻目标继续进行。

2026-10-11 补充：反馈报告已按权威 `accountNamespace` 观察工作区切换，只有报告存在时安装 store 身份订阅，普通正文更新不分配身份摘要；同邮箱工作区变化清除旧报告，套餐变化保持报告，迟到旧回执不复活。`/tmp/codex-feedback-workspace-browser.log` 的独立 HTTP 浏览器 1 项通过，源码单测与 controller／UI／复制组合 `/tmp/codex-message-feedback-unit-final.log` 6 文件／33 项通过。此修复仅闭合身份生命周期，不冒充组织策略预检或真实远程上传验收。当前联调隔离入口为 HTTP `http://10.30.0.24:18571/?mode=session`，正式 HTTPS 前端与 Agent 保留。

2026-10-11 当前验收补充：用户图片链接／停止确认 ABA 修复后的 Chromium 非云合并批次 50/50 通过，包含反馈上传 14 项（`/tmp/codex-noncloud-image-scope-ui.log`）；这不是此前旧对话框文件的重新通过记录。类型／生产构建及全量单测通过，标准 30 分钟 RSS 长测仍红（177.75MiB＞128MiB），不能把表单／复制通过说成长期稳定已验收。

策略预检的实际差距已核对原包 `app-initial-f7c00c1ab06e.js` 的 `sN`／`fP`：提交入口并行刷新 configRequirements、当前项目配置和工作区数据；身份改变或权威工作区数据不足时返回 unavailable，requirements.feedback.enabled 或 workspace.beta_settings.enable_message_feedback 明确 false 时返回 policy，config.feedback.enabled 明确 false 时返回 configuration。当前公共 CLI 的 account/read 只提供 account 和 workspaceRouting.chatgptAccountId，不提供 accountStructure／工作区 beta_settings；公共 config 投影也尚未包含反馈开关。本批没有通过套餐／邮箱猜测工作区类型，未以这些缺失字段推导工作区授权，完整原宿主策略预检仍未闭合。固定 VS Code 宿主的 archive 分支实际返回空档案，performance-trace／internal Slack 桌面共享代码的可达性与该宿主实现继续分别记录。

2026-10-11 WebKit圆角补验：原包只在支持corner-shape:superellipse(1.5)时以1.25倍率扩大半径。反馈弹窗／提交按钮／状态图标／报告按钮已使用同一@supports边界；不支持时分别20／10／12／10px，支持时25／12.5／15／12.5px并使用原corner-shape。原包交接和390／700两主题六状态五项对照先红后绿，日志 `/tmp/codex-feedback-corner-webkit-green.log`。这是新增样式冻结后的专项，不覆盖之前启动的混合源码整组；新的Chromium整组和类型／全量单测另行记录。
