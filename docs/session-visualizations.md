# 会话 HTML 可视化预览

会话正文里的 `visualize{"path":"/project/draft.html","mode":"wide","title":"设计草图"}` 会显示可交互的 HTML 预览。`path` 必须指向已登记项目内的 HTML 文件；`mode` 和 `title` 可省略。Codex、Claude 以及复用公共 Markdown 组件的正文使用同一解析器，复制消息仍保留原文。

流式输出尚未补齐结束标记时显示「正在接收可视化预览」，不读取文件。代码围栏、缩进代码和行内代码中的标记保留为示例；格式无效的完整标记保持原文。文件加载错误及脚本错误明确显示并提供重试。

前端向 Node 网关的 `POST /api/session/workspace-files/visualization` 发送 `root` 和 `path`。Codex 优先使用消息所属 thread 的项目，其他消息根据登记项目中包含文件的最长路径选择；服务端再次验证真实项目边界，拒绝目录穿越、符号链接、非 HTML 文件、非 UTF-8 文件和超过 1,000,000 字节的文件。接口只读、不缓存，无需调整 Rust 运行层协议。

HTML 通过 `srcdoc` 放入仅有 `allow-scripts` 权限的 iframe，不授予同源访问、弹窗、表单、宿主导航等权限。CSP 禁止网络 API、嵌套 frame 和对象；样式、脚本与字体仅允许固定的公共资源域及内联资源。内容无法读取宿主 DOM、登录状态或工作区 API。宿主只处理来源 iframe 和随机标识均匹配的高度/错误消息，高度限制为 200–1600px。

项目自带一个轻量兼容运行时，提供主题变量、常用布局/表单样式、Lucide 图标、`data-tooltip` 提示、`.viz-carousel` 的 `data-variant` 切换和 `Tweak.addToggle`。`window.openai.widgetState/setWidgetState` 仅保存当前 iframe 的本地演示状态；没有宿主操作或模型调用能力。其他高级宿主 API 和 Tweak 控件尚不在兼容范围内。相对文件资源不会隐式读取项目，资源应内联或来自允许的公共资源域。

「展开可视化」在会话模式内显示较宽的对话框，`mode: wide` 使用更宽上限；内联预览保持挂载，展开视图拥有独立的临时演示状态，关闭展开不会改变内联状态。重试、重新打开消息或响应式布局重挂载会重新加载演示。

## 验证

前后端先以缺少解析/接口的实现运行复现测试，确认失败，再使测试通过。覆盖标记解析、代码示例、半截流式输出、错误重试、thread 项目归属、消息来源隔离、文件边界和大小限制。浏览器测试 `tests/e2e/session-visualizations.spec.ts` 覆盖互动菜单、手机/桌面切换、宽屏展开、代码示例不读取文件和沙箱隔离。

使用 `pnpm dev:restart` 按 `.env` 启动，前端必须监听 `0.0.0.0`。本次联调入口为 [局域网 HTTPS 8484](https://10.30.0.24:8484/?mode=session)。地址与协议取决于本地配置，不写入功能源码。

```sh
PLAYWRIGHT_SKIP_WEBSERVER=1 \
PLAYWRIGHT_FRONTEND_PROTOCOL=https \
PLAYWRIGHT_BASE_URL=https://10.30.0.24:8484 \
pnpm exec playwright test tests/e2e/session-visualizations.spec.ts \
  --output .dev-runtime/visualize-e2e-results
```

如需通过真实只读接口验证已有设计草图，可额外设置 `VISUALIZATION_REVIEW_PATH` 为本仓库内 HTML 的绝对路径；不设置时测试使用独立的模拟文件和 API，不写入或发送真实 Agent 会话。
