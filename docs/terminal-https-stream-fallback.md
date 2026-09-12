# 终端同源 HTTPS 流回退

## 决策

真实终端仍以同源 WebSocket（WSS）为主通道。只有某次终端挂载的 WSS 从未成功进入 `OPEN`，前端才会自动切换到同一页面源上的 HTTPS 流；已经成功打开过的 WSS 后续断线继续按原有退避策略恢复 WSS，不会因为普通网络抖动永久降级。

该方案保持用户入口不变，例如 `https://10.30.0.22:8484/?view=mobile`，也不新增后端监听端口。Vite 继续将同源 `/api` 请求代理到 Fastify。

## 输出协议

- 路径：`GET /api/agent-sessions/:id/terminal-stream?replayBytes=<bytes>`。
- 媒体类型：`application/x-ndjson`。
- 每行是一个 JSON 字符串；字符串内容与现有终端 WebSocket frame 完全相同，因此复用 `replay`、`replay-complete` 和普通实时输出的解析逻辑。
- 连接建立后先订阅 live PTY，再读取 bounded replay；回放期间到达的 live frame 暂存，并在 `replay-complete` 后按原顺序发送，避免历史与实时输出乱序。
- 服务端每 15 秒发送空行心跳；前端忽略空行。

## 输入与尺寸

HTTPS 流是单向输出。回退期间：

- stdin 复用 `POST /api/agent-sessions/:id/stdin`；
- resize 复用 `POST /api/agent-sessions/:id/resize`；
- 多笔请求在前端串行发送，保持终端控制字节顺序。

WSS 主通道仍保留原有文本、resize 和 binary frame，桌面正常环境不增加逐次 REST 开销。

## 资源与安全边界

- 客户端默认 replay 为 512 KiB，手机为 256 KiB；服务端仍执行自己的硬上限校验。
- 单个 HTTP 响应待写队列超过 1 MiB 时主动断开，让客户端通过 bounded replay 恢复，避免后台页面无限积压。
- 前端拒绝超过 2 MiB 的未分隔单行，防止异常代理或响应耗尽内存。
- 连接卸载或重试时使用 `AbortController` 关闭旧流。
- 接口只接受已登记的看板会话 ID；不存在的会话返回 404。浏览器不直连 Fastify，也不扩大 SSH、tmux 或文件系统权限。

## 未采用方案

没有把相邻的 HTTP 端口改造成完整页面与 WebSocket 兼容入口。该做法要求用户记住第二个地址，增加明文入口和代理生命周期复杂度，也无法满足“继续使用原端口”的要求。相邻 HTTP 端口因此维持原有 308 HTTPS 跳转行为。
