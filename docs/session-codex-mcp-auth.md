# Codex MCP 重新认证

本阶段继续完成 MCP 认证；云任务、云环境和云端委派延期至下一阶段。MCP 认证指让 Codex 重新取得外部工具服务的访问权限，与把代码任务提交到云端执行是两个独立流程。

## 来源和行为

参考固定为未修改的 VS Code 扩展 `openai.chatgpt 26.51002.51308`，`app-initial-3192ac99b6cd.js` 的 `_Ha` / `CHa` 负责重连观察，`rxr` / `Ybr` 负责通知卡片。生产实现位于 `apps/web/src/session-mode/features/native-mcp-auth`。

- 启动失败先只读核对 `config.desktop.mcp_startup_authentication` 和 MCP inventory；配置等待中收到 ready 后不再展示过期通知。启动 ready 与 OAuth 完成对既有通知的清理时机分别遵循原分支。
- 工具挑战保留原 `mcp/www_authenticate` 的 scope；只在用户点击后执行 OAuth。等待防重复，返回链接复用，启动失败或授权完成失败允许显式重试。通知关闭不停止 Agent。
- 原生版本至少 `0.143.0-alpha.26` 或运行层明确声明能力时才传 threadId。原生登录作用域与当前选中线程分别保留，切线程不改变已发出的请求身份。
- 账号命名空间由原生 `account/read` 的 `workspaceRouting.chatgptAccountId` 提供；仅展示 email/plan 不能识别工作区。相同账号调整 plan 不取消 OAuth；切换账号、工作区或连接释放旧观察并忽略迟到链接。
- 使用现有共享 `view=chat` EventSource；重连只恢复配置和 MCP inventory，不读取聊天正文或创建轮询。卸载释放订阅、AbortController、通知与引用。

## 运行层与投影边界

新增 `POST /api/codex/mcp/reload` 固定转发 `config/mcpServer/reload`，参数为 null；额外参数返回 400。health 声明 `codexMcpAuthV1` / `codexMcpOAuthThreadId`，旧运行服务未声明 reload 能力时不发送该动作。构建不隐式替换运行服务，不中断真实会话。

共享投影提取有界挑战：最多 32 条头、每条 4096 字符；最多 32 个 scope、每个 256 字符、合计 2048 字符。超额标记 truncated 并清空 scope，不授权部分集合。MCP result 正文仍为 null，参数中的常见凭证字段不得成为公开摘要。授权 URL 只允许无嵌入凭证的 HTTP/HTTPS，由显式点击打开。

## 已验证与待验证

2026-10-11 浏览器最终批次 `tests/e2e/session-codex-mcp-auth.spec.ts` 共 7 项通过。隔离前端 HTTP `http://10.30.0.24:18571/?mode=session`，原包参考 HTTP `http://10.30.0.24:43831/native-markdown.html`；地址为本轮环境记录，启动端口可配置。

四种 390/700 宽度 × 深浅色组合比较原 `rxr` 卡片，包含正常、等待及错误；检查 SVG、几何、字体、superellipse、2 秒 steps(60,end) 旋转及减少动画规则。冻结相同动画相位、使用相同截图背景后，卡片内部 RGBA 差异为零；此结果不代表整个工作台截图完全一致。原版独立工作台背景和本项目导航保留原始整页截图。

真实 HTTP 上游 → Node 网关 → 浏览器原生 EventSource 路径把 4MiB 工具结果投影为 378 字符，正文为 null，scope 保留。流程覆盖关闭后重现、重复点击、错误重试、链接复用、同 email 工作区切换和迟到链接隔离。证据：`.dev-runtime/codex-mcp-auth-frozen-browser/` 和 `/tmp/codex-mcp-auth-frozen-browser.log`；前面的失败批次保留。

单测覆盖配置/ready 竞态、plan 与工作区身份、重连只读恢复、投影和路由。私有 `_Ha` / `CHa` 依据源码逐分支移植，截图使用公开原卡片；没有将重写的状态机当作原组件运行证据。真实外部账号 OAuth、多 VS Code 窗口以及正式旧运行服务的新能力启用仍待实际条件验收，不能由本地夹具宣称完成。

跨运行层复核追加：公共 `config/read` 只接受空对象，前端按这个接口发送 `{}`；运行层固定向原生发送 `{includeLayers:false}`，仅额外保留明确 boolean 的 `desktop.mcp_startup_authentication`，不公开其他 desktop 字段或配置层。此前带原生参数并依赖宽泛配置夹具的做法在真实公共接口会失败；两端红灯、修复及浏览器实际 `registerCodexRoutes` HTTP 验收已保留，证据 `.dev-runtime/codex-mcp-public-config-http/`。该配置用例单列，不冒充此前 7 项已经覆盖了真实运行层配置处理。
