# Codex 普通链接提示与正文控件焦点对齐（2026-10-10 至 2026-10-11）

继续 [完整复刻目标](plan.md)。本页验证普通 HTTP 链接的实际 VS Code 呈现、代码／表格按钮焦点及提示生命周期；完整目标保持进行中。

## 来源与实现

- 原主包 `app-initial-3192ac99b6cd.js` 的 `y5n/AB` 在普通链接上使用 `sE` URL 提示；`sE/q1t` 默认 200ms、优先朝上、2px 偏移，空间不足时翻转。原 `M1t` provider 用窗口捕获键盘事件关闭 Escape 提示，并在窗口失焦时清理。
- 原 `app-initial-e98b9eaef8e3.js` 的链接渲染通过 `kti`／宿主 `websitePreviews` 能力选择普通提示或富预览；在当前 extension 宿主普通 example.com URL 实际显示 URL 提示。GitHub PR、直接图片 URL 等特殊分支以及其他能力条件仍需后续独立验证，本页不把它们归为完成。
- 普通链接复用专用 Markdown tooltip；保留安全 URL hardening、原始等价地址、原项目文件打开行为和既有图标。提示采用默认朝上规则，避免从参考页顶端自动翻到下方的单个截图推导永久底部定位。
- 长 URL 使用原 `break-words` 的断行和普通 `text-wrap`，在 320px 宽度内换行；原失败截图为原组件 120px 高、产品仅 30px 高且文本溢出。
- 原 InlineMentionFocusRing 将 2px 环圈画在标签 span 上，10px 圆角，保留 host `--vscode-focusBorder`；浏览器默认 anchor outline 不替代该行为。代码／表格按钮也使用 host focusBorder，缺省为 currentColor，修正未定义 `--codex-focus` 导致的无焦点圈。
- 代码按钮采用实际原控件的圆角和 `--vscode-list-hoverBackground` 悬停色；缺失 host token 时使用透明结果，手机不应用桌面 hover 色。自身的更多／下载入口保留。
- 提示采用组件级 open 布尔状态：窗口失焦关闭，隐藏会话模式后不恢复旧提示；仅在可见且打开时注册 blur listener，关闭／卸载立即移除。没有新增全局快捷键处理、正文缓存或历史轮询。
- 表格复制待权限回执期间，favicon 解码或提示 aria/data 属性变化不能伪装成正文变化。改用与原复制清理相同的结构 HTML 判断内容替换；真实新行和卸载仍阻止旧回执对新内容显示成功。

## 原组件参考条件

参考 helper 新增实际 `M1t`（导出 `ZCt`，由 `QCt` 初始化）provider。此前只挂载内容 provider，导致原组件没有 Escape／窗口失焦管理器；不能用该不完整环境的结果推断原插件不能关闭提示。原包 JS／CSS 保持未修改。

普通链接比较时，仅调整参考宿主根容器的位置，使两个触发器处在相同 viewport 坐标；组件自身不改。否则 native 独立页的顶部链接因空间不足翻到下方，而工作台中部链接向上，比较的布局前提不同。

参考 host 增加与网页缺省一致的 `focusBorder=currentColor`，让原 CSS 的环圈规则具有有效 host token；另用 `#ab1a5f` 验证显式 host focusBorder，原组件和产品均产生相同 2px 指定颜色。主题 foreground／dropdown／textLink 等此前校正继续保留。

## 红绿灯与验收入口

焦点红灯 `/tmp/codex-code-focus-red.log`、按钮悬停红灯 `/tmp/codex-code-hover-red.log`、普通链接缺提示 `/tmp/codex-link-controls-red.log`、链接环圈 `/tmp/codex-link-ring-red.log`、长地址 `/tmp/codex-long-link-red.log`、窗口失焦 `/tmp/codex-tooltip-blur-red.log`、隐藏恢复 `/tmp/codex-tooltip-life-red.log`、表格 UI 属性误判 `/tmp/codex-table-ui-snapshot-red.log` 均保留。未删除实际样式／几何比较或放宽门禁阈值。

前端为局域网 **HTTPS :8484** `https://10.30.0.24:8484`；临时原包参考为 **HTTP :43831**，均绑定 `0.0.0.0`。API／剪贴板／favicon 使用隔离 fixture；没有发送、审批或停止真实 Agent。

```sh
PLAYWRIGHT_SKIP_WEBSERVER=1 \
PLAYWRIGHT_BASE_URL=https://10.30.0.24:8484 \
PLAYWRIGHT_FRONTEND_PROTOCOL=https \
CODEX_NATIVE_REFERENCE_URL=http://10.30.0.24:43831/native-markdown.html \
pnpm exec playwright test \
  tests/e2e/session-codex-code-controls.spec.ts \
  tests/e2e/session-codex-table-controls.spec.ts \
  tests/e2e/session-codex-link-controls.spec.ts
```

## 引用文件门禁修复

上轮新增引用打开用例中的 `cwd` 不是 CodexMarkdown 公开参数；原会话目录已由 thread／CapturedCodexContentOwner 提供。移除该多余测试参数，保留测试对项目、编辑器打开和行号命令的全部断言，不增加可覆盖原归属的 production 参数。语言尚未初始化时采用本项目默认中文，新增独立用例；原文件打开和 host bridge 分支继续验证。上轮失败记录作为历史保留，当前结果在下方追加。

## 当前验证结果

- `pnpm check` 全部通过：`/tmp/codex-link-check-confirmed.log`，含共享包、运行层、后端、前端类型检查及生产构建；保留已有大 bundle 提示。
- 未排除新增引用用例的相关单测：35 文件／145 用例全部通过，`/tmp/codex-link-unit-delivery.log`。
- 代码、普通链接、表格四组合，共 12 个真实浏览器场景通过：`/tmp/codex-link-controls-final.log`；长 URL 加入后另有四组合通过 `/tmp/codex-long-link-green.log`。截图包含原包／产品焦点、悬停、短／长 URL、复制等待／成功、图标加载与导出。表格用例专门在剪贴板等待中解码 favicon，仍得到正确复制成功。
- 引用文件首次整组为 3 通过／1 失败：`/tmp/codex-citation-gate-browser.log`，唯一差异是输入 thread 临时为 null，card／cwd／草稿／原文件范围均正确。没有确认该首次瞬态的根因，失败保留。原失败桌面深色在未改产品的两次复验均通过 `/tmp/codex-citation-state-recheck.log`。
- 引用 fixture 的状态准备顺序随后对齐真实导航（先项目／卡片，后输入 thread），增加有界 thread 变化追踪，原所有最终断言保留。最终完整四组合通过 `/tmp/codex-citation-gate-confirmed.log`，截图 `.dev-runtime/codex-citation-gate-confirmed/`；四组追踪均为空，文件打开期间没有改变输入 thread。不能把当前通过称为已确认首次瞬态的原因。
- 早段 HTTPS 验收使用 PID 2723967；后续该监听由外部改为 PID 2626814 的 HTTP 服务。没有由本任务重启、停止正式前端或 Agent，后续环境与结果见下节。临时参考服务仅在验收中使用，未提交或推送。

## 后续 HTTP 环境与真实复制验收（2026-10-11）

外部前端变更后，当前局域网入口为 **HTTP :8484** `http://10.30.0.24:8484`，监听仍为 `0.0.0.0`。旧 HTTPS 地址返回 SSL 协议错误；不擅自将当前服务切回 HTTPS。临时原组件参考仍是 HTTP :43831，PID 1882670，只在本任务验证期间运行。

- HTTP 页面缺少 `crypto.randomUUID`，`useAgentCenterStore` 初始化抛错，导致「会话界面加载失败」。23 个含无条件调用的生产模块改用项目已有 `uuid.v4`；保留基于 getRandomValues 的随机 UUID，不改同步操作、正文缓存和 Agent 生命周期。已有明确能力检查的 codexService 兼容分支保留。红灯 `/tmp/codex-http-uuid-red.log`；HTTP 初始化与导航同步、分屏 4 文件／19 用例绿灯 `/tmp/codex-http-uuid-green.log`。
- 代码／表格／回复复制在 HTTP 缺少 Clipboard API 时复用应用既有同步 textarea 回退，并通过真实 copy event 写入原文字与清理后的表格 HTML。复制后恢复原焦点、输入选区与 DOM 选区，临时 listener 与节点立即清理；API 已存在时保留拒绝错误，不掩盖权限失败。红灯 `/tmp/codex-http-copy-red.log`、`/tmp/codex-reply-http-red.log`；语言尚未初始化时，回复复制的中文标签和引用范围使用同一个中文默认值。
- 窄屏普通提示原本贴左边缘，原插件实际留 8px，新增水平坐标断言并设置碰撞边距。红灯 `/tmp/codex-link-collision-red.log`；默认朝上／自动翻转与长地址断行断言保留。桌面自定义 list-hoverBackground 被较晚的透明背景规则覆盖，调整同一限定规则顺序；红灯 `/tmp/codex-table-custom-hover-red.log`。
- Tooltip 测量新增文字填色、字距、textRendering、边框、阴影及水平位置；只剔除 Tailwind 的透明且零尺寸阴影占位，实际绘制阴影、颜色和尺寸继续严格比较。
- 相关单测 113 文件／437 用例通过 `/tmp/codex-link-http-units.log`；新增焦点／选区／HTTP 回复补验 5 文件／12 用例通过 `/tmp/codex-reply-http-confirmed.log`。两组有重叠，不相加作为唯一用例数量。
- 原生 HTTP/EventSource 休眠 60 秒释放、完成／审批、只读恢复及草稿保护通过 `/tmp/codex-link-http-idle-memory.log`。未放宽传输、正文缓存或内存门槛；本轮不是新的 30 分钟 RSS 验收。
- HTTP 引用脚本首次因直接调用不存在的 `clipboard.readText` 失败，记录 `/tmp/codex-citation-http-red.log`。改为 HTTPS 继续读取真实系统剪贴板，HTTP 观察应用写入的真实 copy event；不安装剪贴板或 execCommand 替身。引用完整范围、memory notes、导出、跨项目只读定位和输入归属的原断言保留。四组合与代码／表格／回复实际复制，共 6 场景通过 `/tmp/codex-citation-http-confirmed.log`。HTTP 证明浏览器 transfer 数据，不把它称为另一个应用实际粘贴验收。

提示截图仍有像素残差：原包提示与产品在同一 320×120 几何、相同文字颜色、边框／阴影及文字 CSS 下，文字栅格呈现仍不同。诊断中取消合成提示或临时改为 absolute 定位均未消除差异，不把这些临时诊断改动写入产品；测量与原图保存在 `.dev-runtime/codex-link-compositor-probe/`。这是未解决项，不因 CSS 参数通过就宣称像素一致。SVG 页面截图残差也继续保留。

最终整组 **18／18** 通过 `/tmp/codex-link-http-delivery.log`，截图及几何／剪贴板记录在 `.dev-runtime/codex-link-http-delivery/`。`pnpm check` 通过 `/tmp/codex-link-http-check.log`；最后的回复复制改动后，前端类型检查及完整生产构建再次通过 `/tmp/codex-link-http-web-types-confirmed.log`、`/tmp/codex-link-http-web-build-confirmed.log`，保留已有 bundle 体积提示。验证为 main 的未提交工作树，HEAD `8e7fb60`，不将它当成提交或发布证据。原包文件未修改，临时参考 PID 1882670 核对目录与命令后退出，3 个临时诊断 spec 已移除；正式 HTTP 前端 PID 2626814 与 Agent 未由本任务停止或重启。

提示裁图剩余差异为 10,946／38,400 像素、最大通道差 71，记录在上述 compositor probe 的 `pixel-comparison.json`；没有删除或放宽像素保护。HTTP 初始加载记录还曾出现 Vite HMR WebSocket 连接错误，本轮没有修改外部启动参数或本地配置；显式页面加载与行为验收通过不代表该开发连接已修复。

当前 HTTP 的复现命令：

```sh
PLAYWRIGHT_SKIP_WEBSERVER=1 \
PLAYWRIGHT_BASE_URL=http://10.30.0.24:8484 \
PLAYWRIGHT_FRONTEND_PROTOCOL=http \
CODEX_NATIVE_REFERENCE_URL=http://10.30.0.24:43831/native-markdown.html \
pnpm exec playwright test \
  tests/e2e/session-codex-code-controls.spec.ts \
  tests/e2e/session-codex-table-controls.spec.ts \
  tests/e2e/session-codex-link-controls.spec.ts \
  tests/e2e/session-codex-http-clipboard.spec.ts \
  tests/e2e/session-codex-citations.spec.ts
```

特殊图片／GitHub PR 富预览、其他 editor／dialog 功能与 SVG 页面截图残差仍继续按完整清单审计，不以本页通过缩小完整目标。
