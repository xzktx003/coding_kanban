# Codex 通知呈现

Codex 反馈后台上传，以及报告 ID／回复／代码／表格复制错误使用 `features/native-notifications`，其他工作台通知继续使用原有通知入口。视口留在 `.session-mode` 内，隐藏模式不会拥有通知操作，也不会因暂时隐藏而中断上传。

## 原包依据与实现

原包 `app-initial-3192ac99b6cd.js` 的 `GAt`／`KAt` 定义排队、秒级 duration、同 ID 替换、移除回调和成功通知计时；`rxr`／`Ybr` 定义卡片及动作；`lxr`／`cxr` 定义视口。测试通过公开初始化 `QK` 和 Provider `XK` 运行未修改的原包，而不是重写原 JSX 或使用服务接口模拟卡片。

- 默认五秒，`duration: 0` 持久；未注册视口先排队。同逻辑 ID 替换旧通知，`onRemove` 对程序关闭、用户关闭、自动关闭及卸载都至多执行一次。
- 无动作的成功通知保留原独立墙钟清理；其余通知由 Sonner 管理自动关闭、悬停暂停、堆叠和向右滑出。默认顶部中央，8px 外边距、三条可见、0.3 秒过渡。
- 卡片 14px／21px，按钮 11px／16px，图标和关闭按钮采用原 16px SVG 路径；深浅色成功／警告／错误使用原 extension 实色表面和 VS Code 前景／边框 token。
- 主动作执行回调，不自动关闭通知。反馈的「查看上传内容」由报告控制器重开；关闭通知不取消 HTTP 请求，只移除报告记录并防止迟到完成重建 UI。
- 替换、重开、切换模式前先撤销旧实例的移除权限，避免原生 `onRemove` 将仍在上传的任务误删。

## 浏览器验收

LAN 前端：HTTP `http://10.30.0.24:8484/?mode=session`。参考服务是只读原包夹具，需先确认隔离端口空闲再启动，完成后仅停止自己的参考服务，不重启运行服务或 Agent。

```sh
python -m http.server 43831 --bind 0.0.0.0 \
  --directory .dev-runtime/session-render-alignment/review
PLAYWRIGHT_SKIP_WEBSERVER=1 \
PLAYWRIGHT_BASE_URL=http://10.30.0.24:8484 \
CODEX_NATIVE_REFERENCE_URL=http://10.30.0.24:43831/native-markdown.html \
pnpm exec playwright test tests/e2e/session-codex-notifications.spec.ts \
  tests/e2e/session-codex-feedback-upload.spec.ts --workers=1
```

测试比较四种级别、正文／内联动作、无关闭按钮、动作悬停、原 SVG、几何、字体、表面和边框；执行动作后保持通知、明确关闭、同 ID 替换、默认过期和向右滑出。每种外观在 390／700 两种宽度、深／浅两种主题保留原包与产品截图。浏览器测试先出现原普通 Sonner 卡片差异，修复后保留同一严格对照；服务单测覆盖排队、替换、一次移除和定时器释放。

## 尚未覆盖

普通卡片与 `custom(content)`／`onUserDismiss` 通知服务接口已经移植。真实 MCP 重新认证的配置预检、启动与运行身份、OAuth 请求及作用域观察尚未接入；自定义卡片测试不代表这套宿主流程已完成。`chatgptSuccess`／`successNeutral`／`dangerSolid` 共享变体目前发现主要供 ChatGPT 分享／资料库使用，仍需核对 Codex 可达范围；其他 Codex 通知调用点、viewport 动态 boundary 与侧边 inset 注册尚未完整移植。加载动作和右侧位置虽有基础呈现，未纳入原包截图矩阵；减少动画、长时间自然 GC、真实 VS Code 多窗口宿主仍需专项验收。不得把本次反馈通知完成扩大成全部原插件通知或全部 Codex 功能完成。

本轮有 19 个不同浏览器用例的通过记录：通知外观 5 项、替换／滑动／默认过期 1 项、上传报告 13 项；反馈首次整组的两处夹具失败修正后单独转绿，原失败日志保留，不称首次整组全绿。33 项单测和 shared／web 类型检查、web 生产构建通过。源码指纹、截图与逐步修复记录在 `.dev-runtime/codex-notifications-evidence.md`；构建仍有原有大 chunk 提示。


## 自定义通知与正文复制错误追加（2026-10-11）

`custom` 的 content 在创建时收到捕获的 `{close, level}`；容器保留 max-width/min-width 与 testId。content 调用 close、外部 close、ID 替换和自动过期仅移除；用户滑出额外调用 `onUserDismiss`，且仍恰好移除一次。成功级别的 custom 不启用普通成功卡片的第二个墙钟定时器。此行为依据原 `GAt`，截图运行原 Provider 和原 `rxr` 卡片；用 MCP 重连文案作为自定义内容样例，不调用真实 OAuth，也不把样例当成完整 `_Ha` 重连组件验收。

原 `app-initial-e98b9eaef8e3.js` 的 `yj`／`a$t` 区分普通文本的 extension clipboard RPC 与富文本的浏览器 Clipboard API；拒绝统一显示 `clipboard.copyError`。回复、代码和表格现在复用相同原包语言文案和逻辑通知 ID。代码／表格复制失败保持未复制，正文不再额外插入原包没有的原始异常行。LAN HTTP 没有 Clipboard API 时仍使用真实 copy event 传递文本／HTML，未把不安全上下文一概判成错误。

浏览器：`session-codex-custom-notifications.spec.ts` 两种宽度比较原文本 RPC 拒绝和富文本 API 拒绝后的卡片、SVG、尺寸、字体与颜色，严格确认两侧都没有正文 alert；另验证自定义卡片动作、内容关闭、滑动与回调。`session-codex-http-clipboard.spec.ts` 保留两种宽度的真实事件成功回归，原上传报告复制拒绝再验一次。证据目录 `.dev-runtime/codex-custom-copy-green/`、`codex-custom-copy-regression/` 及索引 `.dev-runtime/codex-custom-copy-evidence.md`。尚未对普通回复的成功按钮状态／计时做新原包对照，不能由本次错误提示验收扩大结论。

## MCP 认证与加载卡片追加（2026-10-11）

[MCP 认证](session-codex-mcp-auth.md)已接入；上文“尚未接入”是此前阶段记录。7 项最终浏览器验收覆盖正常/加载/错误、390/700 与深浅色及实际网关 EventSource。原包 spinner 使用 12px SVG、背景 path opacity .3、2 秒 steps(60,end)，按原减少动画分支显示；disabled 不产生 hover 变色。颜色以实际原 CSS 为准，warning/success/danger 描述继承卡片前景；原包没有相应 /80 工具类，不能凭类名字面添加 .8。支持 corner-shape 时卡片采用 15px、按钮 12.5px 的 superellipse(1.5)，否则分别 12px/10px。

像素验收只声明相同背景、冻结同相位后的卡片内部一致；工作台背景、viewport 动态 boundary/inset、其他通知调用点、共享特殊变体的 Codex 可达范围与完整 VS Code 宿主仍未全部闭合。30 分钟自然 GC 本轮一次红灯、最新一次绿灯，保留失败和测量边界，不宣称长期内存问题已根治。

## 动态通知边界追加（2026-10-11）

移植原 `sxr/ZK` 的矩形范围与 ResizeObserver，更新既有 ID 保持登记顺序，移除最近范围恢复前一范围；相同几何不通知订阅者，卸载断开元素/文档根观察。默认观察会话根，Portal 和操作继续限制在会话模式。两宽度直接运行原 `ZK` / `XK`，比较 top/left/right/bottom 与内层完整几何，调整边界后同步更新，移除后恢复；与 MCP 七项组合最终 9 项通过，另有 2 项登记/释放单测。

该版本 `QAt` 侧边 inset 为私有原子，编译模块只有初始化和读取，没有公开登记调用；因此保持原可达默认零值，没有把对不存在的 Auth.mBe 操作当作金标准。相关夹具失败保留，不能宣称非零 inset 已通过原包行为验收。普通成功复制的 gwt SVG 和浮层另有 4 个原用户消息 profile 加 2 个真实 HTTP 复制事件通过；原富文本默认支路和普通回复的精确成功计时不扩大为已验证。

2026-10-11 复制最终专项：`/tmp/codex-message-rich-closed.log` 单批 11 项通过；四个原用户 glyph／tooltip／plain-source profile、四个默认 rich payload（prose、代码／表格、单行／多行公式／任务）与一个原助手 CopyButton，以及两个真实 HTTP copy-event 场景。用户默认纯文本取渲染内容，助手纯文本保留规范化源码；HTML 完整与原包实际输出比较。公式先等待原组件真正 typeset，加载占位保留原始文本与已排版规范化输出分开，之前提前复制占位和参考宿主缺 selector 的失败日志保留，不伪称产品原样输入必须不变。助手两秒 timer 同时释放两个 pending write 后比较，避免先点的参考页在另一页准备期间已过期；用户保持 1500ms。更晚的同邮箱反馈工作区隔离另有 1 项浏览器通过，不与该 11 项相加成一次组合通过。

2026-10-11 复制分支补验：用户文本中的 Markdown 图片改为原生 `!` 加链接，独立标记参与富文本复制。新增真实原包 text/plain＋text/html 对照先红后绿（`/tmp/codex-user-image-link-final.log`），真实附件、助手 Markdown 图片与后续文本的 19 项回归通过；不把独立新增用例与之前 11 项批次冒充同一源码整组。
