# Codex 插件 UI/UX 差异修复验收（2026-10-10）

## 参考与范围

本轮以仓库的 `third_party/openai.chatgpt-26.51002.51308-linux-x64.vsix` 为来源，核对真实主包、SVG、样式和交互逻辑；命令、选择题、普通错误卡片还在浏览器中加载原组件作对照。保留本项目的项目导航、关注标签、独立输入、队列与分屏；手机保留固定 124px 输入区、44px 触控和安全区等已确认的适配。

VSIX SHA-256：`c5f534abf7dd1f08330483b5db6754001f2ad452096fc8e63925e597d3761373`。来源清单与偏移保存在 `.dev-runtime/codex-ui-parity/requests/source-receipt.json`；正文、输入区的来源定位分别见 `.dev-runtime/ui-parity-body-audit.md`、`.dev-runtime/ui-parity-composer-audit.md`。

## 已修复

| 区域 | 确认的问题与修复 |
| --- | --- |
| 文件改动卡片 | 仅有元数据时旧分支绕过正常标题、图标、列表限高和滚动提示，长绝对路径撑满卡片。统一使用紧凑卡片，桌面最多显示 6 行、手机 4 行，其余内部滚动；显示文件名，完整路径保留在提示中。 |
| 文件详情与身份 | 元数据没有真实总数和增删行数，不能把最多投影的 16 项当总文件数，也不显示虚构的 +0/-0 或空 diff。保留“详情未加载”，可按捕获的原 thread/cwd 查看现存源文件；重命名使用新路径，删除项或未知归属不能打开。不会修改输入目标或执行权。 |
| 流式正文 | 原先完成时从 14px 跳到 13px；改为继承相同聊天字号，保持有界分段渲染。 |
| Markdown | 中文检测递归检查 React 子节点和 Unicode Han，修复嵌套强调、链接、代码及扩展汉字的段落间距；行内代码、代码块和高亮代码明确 LTR。 |
| 输入键盘 | Alt+Enter 按原生 keymap 换行，不能触发发送；原有 Enter 策略、IME 与队列规则保持。 |
| 输入提示 | 按目标、计划和本地 thread 身份选择原生文案，已选但尚空的本地会话也属于后续请求；不新增 timing 或正文订阅。 |
| 提交状态与图标 | 发送、停止加载时显示原生环形 SVG 与 aria-busy，保留按钮尺寸；动画 2s steps(60,end)，减少动效时保持静态状态。展开图标使用原包 SVG。 |
| Tooltip | 添加上下文使用原生 200ms、4px 偏移和 @ 键帽；弹出菜单打开时抑制重复提示，去掉模型、上下文按钮重复 title。 |
| 答题导航 | 题卡上方下一题可浏览尚未回答的问题，不隐式提交、不丢草稿；Other 和自由输入按原包分别显示提示，密码输入仍不持久化。 |
| 网络审批 | 原生允许的第一条 host amendment 显示为独立“始终允许此主机”操作，不能隐藏在范围菜单；回复仍使用原 request/thread/turn/item/token 和准确 decision，不额外授权。 |
| 错误与重连 | 普通错误使用原生纵向图标卡片，保留原文，只解包真实 error.message；有效裸 HTTP URL 可点击，Markdown 包裹内容保持字面文本。重连详情默认折叠，429/overload 分类使用真实 errorInfo。 |

原生普通错误 notice 的字体、行高、padding、gap、颜色、边框、阴影、圆角及 18px SVG 与实际原组件逐项相等；命令卡片的字体、行高、输出高度、背景和尺寸也逐项比较。文件卡片的元数据退化形态依据本项目传输边界验收，不宣称它等同于插件已持有完整 diff 的状态。

## 验证

- 最终整体单测：123 文件、573 项通过，覆盖全部 Codex 聊天组件、新错误处理及主题边界；答题文案另验 2 文件、13 项，文件/主题/错误边界另验 4 文件、24 项。统计有重叠，不相加冒充独立用例。
- 最终请求专项：9 文件、69 项通过，覆盖审批身份、实例替换、只读题目导航、提交不确定、错误文本和重连。
- 桌面/手机输入区最终浏览器：1440/390 × 深浅主题，4/4 通过，包含真实 Alt+Enter 换行、零误提交、忙状态尺寸和 A 提交中切 B 的草稿隔离。
- 整合浏览器：12/12 通过，包含命令原组件对照 2、选择题原组件对照 2、文件卡片 375/1440 × 两主题 4、普通错误/审批/提问 390/1440 × 两主题 4。
- 正文排版及旧表格浏览器：6/6 通过；流式/完成 computed style 一致，保留全部单元格和窄屏滚动断言。旧表格 fixture 的错误 phase=final 改为真实 final_answer。
- 运行层构建与平台 contracts：构建通过，11 项通过。整合检查发现并行语音测试把构造器误标为 WebSocket 实例，仅更正测试类型为 CodexSocket；未改其产品实现。
- 有界工具浏览器：10 个非文件导航场景通过；新增文件导航场景修正 fixture 的 workspace-files/read 接口和 StrictMode 两次同目标只读请求断言后，4 个目标场景独立通过，不声称一次全 14 项通过。10000 事件实测 267ms < 原 500ms 门槛，原 DOM/行数门槛保持。最终 `pnpm check` 通过（shared、TS 运行层、Node 网关、前端类型检查及生产构建）；保留现有大 chunk 警告，未放宽阈值。日志 `/tmp/ui-parity-final-check-green-v2.log`。错误解析观察器的两个类型签名补 boolean 返回，原库后处理循环不使用返回值，另验 6 项通过。

主要日志：`/tmp/ui-parity-all-final-unit.log`、`/tmp/ui-parity-placeholder-green-final.log`、`/tmp/ui-parity-final-edges.log`、`/tmp/ui-parity-final-confirmed.log`、`/tmp/kanban-native-composer-ui-parity-mounted-store-e2e.log`、`.dev-runtime/codex-ui-parity/requests/native-scope-final-green.log`。

## 访问和证据

产品组件 fixture 前端：**HTTPS https://10.30.0.24:18517**，绑定 0.0.0.0。实际插件原组件参考：**HTTP http://10.30.0.24:43831/native-markdown.html**，绑定 0.0.0.0。前者的 API/WS 使用隔离数据，后者只读加载原包；没有向真实 Agent 投递、审批、停止或恢复测试任务。临时 fixture 前端在验收后已关闭，正式服务未重启。

请求卡片独立 fixture 使用手机 390×1200，以完整拍摄自然高度卡片；输入区仍以真实工作台 390×900 验证固定高度。Chromium/Playwright 对超视口 fullPage 截图会清空触控模拟，曾导致仅截图后变成 fine pointer；保留其红灯，最后截图前后均断言 maxTouchPoints=1、pointer:coarse=true 和按钮 44px，未改产品 CSS 掩盖模拟问题。

截图及 trace：`.dev-runtime/ui-parity-final-confirmed/`、`.dev-runtime/ui-parity-composer/final-mounted-store/`、`.dev-runtime/ui-parity-body/`、`.dev-runtime/ui-parity-body-table/`、`.dev-runtime/codex-ui-parity/requests/e2e-request-final/`。包含桌面与手机、深浅主题；人工检查文件卡片、输入区和错误/审批页面的排版。

## 保留的能力边界

- 不恢复工具原始正文、完整历史轮询或额外字符串缓存。已有 view=chat 投影、序号/审批/完成/未读/子 Agent 保留和休眠释放规则保持。bounded stream 单测及 10000 事件浏览器门槛继续保留；本轮不将短时组件测试当作长期 renderer RSS 证明。
- 浏览器文件元数据不能自动提供历史 turn 的完整 diff。现存 saved-patch 只有 apply/status，不能借变更接口读取预览，工作区当前 diff 也不能冒充旧轮次 diff；详情缺失时如实提示。
- 原生配额卡片、某些服务器过载的可重试卡片和宿主提交阻塞提示依赖账户及可靠 retryTurn/host 身份。本轮普通错误与真实重连状态已对齐；条件缺失时保留真实错误，不编造原生重试、倒计时或权限能力。
- 原包加载图标另有宿主功能开关控制的 morph 分支，本轮复刻常规环形分支，未宣称外部 gate 或所有宿主状态完全相同。没有“全页面所有像素零差”的验收结论。
