# HTTP JSON 响应的字节消费与回执保留

2026-10-30 的修复将公共 `getJsonWithOptions` / `postJsonWithOptions` 的成功响应改为 `readResponseJson`：读取 Fetch 字节流，经增量 UTF-8 `TextDecoder` 后 `JSON.parse`。读取结束或失败均释放 reader 锁及临时正文；保留 BOM、非法 UTF-8 替换、JSON 语法错误、取消信号和已消费正文的 `TypeError` 语义。没有新增第二份缓存、轮询、强制 GC 或页面刷新。既有网关/RPC/聊天预算继续生效，不用该客户端消费器代替浏览器接收前裁剪，也不新增会截断旧显式 raw 历史的全局上限。

错误响应现在只解析一次，不再 `clone()` 两次消费。完整的 `code`、`deliveryStage` 和消息继续保留。额外发现的安全反例是：HTTP 409 错误正文在接收中丢失或 JSON 不完整，原逻辑吞掉解析失败，再按 409 判为明确拒绝，可能清掉调用方的未知回执记录。现此种情况明确返回 `outcome-unknown`，调用方不能据此自动重发。完整且明确的拒绝契约不变。

## 红绿灯与真实浏览器

`readResponseJson.test.ts` / `shared.response.test.ts` 覆盖拆字节的中文/emoji/BOM、替换解码、语法/流错误、锁释放、已消费但已解锁的正文、请求头/取消/读取优先级及未知回执。截断与流失败的 409 加已消费正文共三项先红后绿；与生命周期、队列、Goal、历史和 EventSource 回归合计 9 文件 71 项通过。日志保存在忽略目录 `session-management-read-20261030/rss-diagnosis/read-response-certainty-{disturbed-red,green}.log`。

`tests/e2e/session-json-response-memory.spec.mts` 使用绑定 `0.0.0.0` 的独立 LAN HTTP、生产 reader 源码及正常 Playwright Network 观察。240 次读取共 251,668,080 bytes，不调用原生 `Response.json()`；中文/BOM、正文消费身份与错误锁释放同时验证。加强版还由生产公共 API（仅环境入口替换为隔离 fixture）读取真实 HTTP 409 截断 JSON，检查不被当作明确拒绝。它只向自己的 HTTP 夹具发请求，不连接正式 Agent。

## 原生分配对照及局限

**完整 Chrome 的对照没有复现旧增长，不能作为收益证据。** 相同 Chrome 145 完整浏览器中，原生 JSON 已自然回收，活动 renderer 约 139 MiB，而 reader 约 172 MiB；每个浏览器还有 3→4 个 renderer，该次旧采样未记录 start ticks。原结果保留在 `production-consumer-probe.{mjs,json,log}`，不把全部 renderer RSS 与页面堆混称。

随后只进行一次精确到 Playwright 默认 `chrome-headless-shell` 的对照，两个独立自有浏览器均为 `145.0.7632.6`，相同 240 次约 1 MiB JSON / 25ms 间隔、相同 raw CDP 观察；两边均未开启 Network 域，没有强制 GC、刷新或复用生产页面。reader 使用当时实际源码的哈希 `6e322370d054ae485b18275fbb23a831cb133221ec351608ac71e3f81a9cbf9b`。

| 消费路径 | 单一 renderer 身份 | 起始 RSS MiB | 完成/自然空闲 5s RSS MiB | 观测 RSS 峰值 MiB | 完成 JS heap MiB |
| --- | --- | ---: | ---: | ---: | ---: |
| 原生 `Response.json()` | PID 1699816 / start ticks 222842445 | 77.53 | 576.55 | 576.55 | 240.79 |
| 生产字节 reader | PID 1706704 / start ticks 222844065 | 77.02 | 132.88 | 166.48 | 12.42 |

该对照支持特定 headless 原生消费器的分配路径差异；它不是所有浏览器的收益证明，**也不关闭完整工作台的 30 分钟 RSS 红灯**。普通 Playwright 保持 Network 观察的短测还会包含调试网络缓存；首轮同一 renderer 的 RSS 为 80.91→370.61 MiB，不能以此声称达到 128 MiB 长测门槛。完整页面必须保留原负载、自然 GC、90–300 秒/末尾 180 秒低点窗口及原 heap/RSS 上限，另由冻结源码验收。诊断证据在忽略目录 `session-management-read-20261030/rss-diagnosis/headless-consumer-probe.{mjs,json,log}`，旧红灯和完整 Chrome 的负结果均保留。
