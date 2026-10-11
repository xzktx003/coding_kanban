# Codex 代码块自动换行原生对齐（2026-10-10）

本记录仅覆盖代码块换行行为，不代表编辑器／对话区域全部功能已达到 1:1。完整目标继续按 [实施方案](plan.md) 和 [差异验收](ui-parity-audit-20261010.md) 推进。

## 原包证据与修复

来源是未修改的 `third_party/openai.chatgpt-26.51002.51308-linux-x64/extension/webview/assets/app-initial-e98b9eaef8e3.js`：Unicode 字符偏移 4536541 的 `Isi=e_(markdownCodeBlockWordWrap,false)`，4543190 起的 `dci/mci`。`mci` 读写同一 AppScope 持久偏好，所有普通代码块同步；不是按消息或线程保存。原包 `e_` 的读取／发布可见现有只读 readable 文件 11697 行。原组件开启图标由真实浏览器提取，不从形状猜测。

旧实现只改变一个代码块，跨消息／线程不共享，刷新丢失；开启后也没有切换图标。现使用 `useMarkdownSettingsStore` 保存设备级单一布尔偏好，普通代码块共同订阅；移除逐消息 Map，流式到完成的重挂载自然继承。只持久化布尔值，不持有正文、历史、项目身份或额外工具输出。深浅主题、手机固定输入高度和触控适配保留。

## 验证与截图

- 单测红灯：`/tmp/codex-wrap-red-unit.log`，两个代码块中仅一个切换。
- 原组件浏览器红灯：`/tmp/codex-wrap-red-browser.log`，实际开启状态 SVG 与产品不相等；路径收据在 `.dev-runtime/codex-wrap-red/**/wrapped-icons.json`。
- 正文／偏好单测：`/tmp/codex-wrap-presentation-unit.log`，24 文件、73 项通过；包含所有代码块共享、后挂载继承、设备存储恢复／无效数据、流式完成和高亮迟到保护。
- 跨会话／刷新浏览器：`/tmp/codex-wrap-restoration-final-v2.log`，390／1440 × 深浅主题 4 项通过，真实点击两个代码块、会话标题与刷新；未向 Agent 发出变更请求，页面异常为空。4 张恢复截图已人工查看。
- 原组件对照：`tests/e2e/session-codex-markdown-reference.spec.ts` 用同一 VSIX 真实组件同时显示两个普通代码块，验证原包与产品共享切换、开启 SVG 路径、字体／代码高亮／几何，保留下载和表格验收。最终 700／390 × 深浅主题 4 项通过；截图输出 `.dev-runtime/codex-wrap-reference-final/`，最终日志 `/tmp/codex-wrap-reference-final.log`。4 张产品完整代码块及桌面／手机原包对照均已人工查看。手机两块代码后的内容比原包多 16px，分别来自既有每块 8px 的批准触控适配；第一块自身仍单独断言 8px，未以修改产品尺寸掩盖差异。
- 初版恢复夹具直接点击整个手机标签中心，被底部项目入口截获；失败留在 `/tmp/codex-wrap-restoration.log`。最终改为实际点击标题 `.session-identity-title`，不 force、不改产品标签行为。初版代码块元素截图被底部跟随截掉顶部；最后先用真实鼠标滚轮进入阅读态，再检查整块进入视口后截图，保留此前裁切证据，不把裁切图当作完整对照。

前端访问 **HTTPS https://10.30.0.24:8484**（0.0.0.0）；原包只读对照临时服务 **HTTP http://10.30.0.24:43831/native-markdown.html**（0.0.0.0），本轮验证后关闭自有临时进程。产品 API 使用隔离 fixture，没有发送、审批、停止或恢复真实 Agent。正式会话运行服务未重启。

## 当前整仓门禁与未完成边界

本轮 `pnpm check` 实际运行；shared、TS 运行层和后端构建通过，前端因现有 `features/subagents/SubagentSummary.tsx:27` 比较已移除的 `subagents` 工具标签而报 TS2367，日志 `/tmp/codex-wrap-check.log`。该组件／导航正在发生其他工作区修改，本轮未覆盖该改动，也不声称整仓构建通过。

本轮没有把全编辑器／全聊天区域验收缩减为换行测试。账户／云端真实联调、宿主条件能力、错误重试卡片和各类动态 UI 仍需按原完整清单逐项证明；代码控件 tooltip、SVG 代码预览等也不能由本轮换行／下载门禁推导已完全一致。

后续进展：普通代码 tooltip、SVG 预览及复制状态已进一步实施，[后续验收](code-preview-controls-progress.md)记录成功图标／箭头红绿灯、完整构建恢复及仍未闭合的 SVG 像素残差。上述 TS2367 是本记录当时的检查结果，不再代表后续构建状态。
