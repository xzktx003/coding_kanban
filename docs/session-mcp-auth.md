# MCP 网页授权恢复

Codex 的 MCP 管理页同时支持桌面宿主与网页。桌面订阅 Tauri 通知；网页复用 `openEventStream` 的 Codex 通知连接，不为每张卡片另建独立 SSE。stdio 服务没有 OAuth 操作。

一次点击捕获服务器名称、协议、URL 与操作实例。只有本次实例仍然有效、服务器名称匹配、`threadId` 为空且 `success` 为布尔值的 `mcpServer/oauthLogin/completed`，才结束对应卡片的等待。更换服务器或离开页面后，旧启动回执不能再打开授权链接，也不能修改新卡片。

`useMcpAuthStatus` 在完成通知、`mcpServer/startupStatus/updated`、连接恢复和窗口返回时只读核对状态；读取版本保证旧请求不能覆盖更新结果。等待授权时每 5 秒只读刷新，不会重新启动 OAuth。120 秒没有确定结果则恢复按钮并明确提示结果未知，用户可以先刷新状态再决定是否重试。

原生 `timeoutSecs` 是 bigint。仅固定 OAuth HTTP 适配器将安全非负整数转换为 JSON 数值；超出安全整数范围在 HTTP 请求前拒绝。没有改变全局 JSON 序列化或其他协议字段。

管理卡片窄于 480px 时将名称/状态与操作分成两行；图标和开关保留 44px 热区，开关轨道仍为 32×18px。详情沿用主题的次要文字色，授权状态分别使用浅色与深色的可读颜色。长地址允许换行，长名称保持单行省略并保留完整 title。

手机本卡片的通知放在下方，授权提示与完成/失败使用同一条通知；离开卡片时只清理该卡片的通知，避免遮住返回和随后显示的公共输入区。桌面保留顶部通知位置。

最小验收包括 `mcpWebNotifications.test.tsx`、`mcp.oauth-timeout.test.ts` 和 `tests/e2e/session-mcp-web-auth.spec.ts`。浏览器在 HTTPS `https://10.30.0.24:8484` 访问真实管理页面；状态、通知和 OAuth 弹窗使用隔离夹具，验证固定请求、其他服务器不能结束等待、成功/后续凭证变化、按钮命中与草稿恢复。该验收不证明真实账号授权服务器的回调可用。
