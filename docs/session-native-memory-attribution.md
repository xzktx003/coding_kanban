# 会话页面剩余原生内存的归因（2026-10-20）

本轮已修复 [子 Agent 大包轮询](session-subagent-memory.md)、[HMR 旧缓存](session-hmr-memory.md) 和 [React 属性原生序列化](session-react-performance-memory.md)。这些修复各有局部因果证据，但最终冻结源码的原标准三十分钟长测仍失败：renderer RSS 低点增长 153.070 MiB，JS used heap 仅增长 5.451 MiB。原门槛、失败记录和源码指纹保留，不能用下述短对照替代验收。

## 测量范围

所有组顺序运行，每组新浏览器，记录同一 renderer 的 PID/start ticks、RSS/PSS、V8 used/total、embedder 和 backing storage；自然窗口不强制 GC、不刷新、不改变产品源码、不停止正式 Agent。测试服务绑定 `0.0.0.0`，使用本机局域网 HTTP 地址；具体端口由隔离服务动态选择。页内 API 和 SSE 都由自有夹具提供，不执行真实任务。

十分钟对照主窗口固定为 90–180 秒和最后 120 秒；额外列出后半段趋势，避免高预热基线掩盖末态增长。显式 GC／原生 dump 仅在自然样本完整落盘后执行，单独保存；dump 本身也会分配内存。

## 已排查的测试环境因素

- 开发版与生产版均有 RSS 增长，生产版基础占用较低，不能仅归因于开发版 React。
- 将 Playwright **实际使用的主页面 Network session** 限为总计 4 MiB／单资源 1 MiB，没有得到稳定改善；不能只给另建的 CDP session 限额。
- 把 `route.fulfill` API 夹具换成真正的 HTTP 服务，保留相同 Network 限额、源码和 SSE 负载，也没有改善。两组都是 289 轮、58,605,845 B SSE；原拦截组 RSS 低点增长 7.453 MiB，原生 HTTP 组增长 23.848 MiB。前者预热基线较高，不能按差值直接比较收益。原生 HTTP 组最后自然 RSS 557.676 MiB，峰值 594.867 MiB，页面错误和执行型请求均为零。

开发／生产和 Network 限额细节见 [前序对照](session-react-performance-memory.md)。原生 HTTP 指标位于忽略目录 `.dev-runtime/session-native-http-memory-20261020/network-limited/summary.json`；两组源码／构建指纹完全一致，运行后的浏览器和监听端口均已清理。

## 容量与存活对象必须分开

原生 HTTP 组自然窗口结束后，独立采集同一进程的 native dump，并执行显式 GC。下列指标是各自分类，包含父子分配关系，**不可直接相加**：

| 分类 | 诊断前，MiB | GC 后，MiB |
| --- | ---: | ---: |
| renderer RSS | 557.676 | 309.930 |
| V8 heap allocator 容量 | 180.285 | 57.887 |
| Blink GC 堆容量 | 136.055 | 34.038 |
| Blink allocated objects | 16.187 | 7.503 |
| malloc | 55.447 | 50.387 |
| PartitionAlloc | 63.590 | 58.680 |
| buffer live objects | 57.647 | 56.069 |
| parkable strings | 41.50 | 41.50 |

大量差值属于两个 GC 堆的容量，不能把 RSS 全部称作聊天正文引用泄漏。这个结果也不能证明自然回收足够及时，更不能成为产品强制 GC、制造临时垃圾触发 GC 或周期性刷新页面的理由。原始 dump 为同目录 `native-{before,after}-explicit-gc.json`，采集前后身份一致。

## 不加载 Kanban 的原生 SSE 对照

Chromium 145.0.7632.6、真实 HTTP EventSource、3000 条 × 64 KiB 正文，页面只保留数量／长度／序号计数，不保留正文，不加载 React。两组先设置相同 Network 限额，第二组在连接成功后关闭该 Network agent。

调试协议确实额外收到了开启组的全部 3000 条／187.5 MiB 正文，关闭组为零；但自然峰值 RSS 为 160.49／160.93 MiB，末点为 154.60／154.73 MiB，独立 GC 后为 91.94／92.21 MiB。两组完整收到 196,657,893 B 线格式数据，单连接、无错误和丢序。

这是一项负结果：该负载下，关闭 Inspector 的额外 SSE 上报没有改善内存。共同的原生接收／分配路径仍需区分，不能据此宣布所有 EventSource 使用都有泄漏。证据位于 `.dev-runtime/session-sse-inspector-memory-20261020/summary.json`。

## fetch 接收仅作为候选

再次使用相同输入、两组均关闭 Network agent，比较原生 EventSource 与 `fetch` reader + 流式 TextDecoder + 有界纯 JS SSE 解析。后者不创建原生 MessageEvent/EventTarget，也不保存正文集合。

| RSS | EventSource | fetch 解析 |
| --- | ---: | ---: |
| 自然峰值 | 160.92 MiB | 168.34 MiB |
| 自然末点 | 154.78 MiB | 115.35 MiB |
| 独立 GC 后 | 92.29 MiB | 94.92 MiB |

fetch 末点较低但峰值较高，backing storage 峰值为 66.10 MiB；两组收齐相同输入且没有错误。它支持继续做完整页面对照，尚不支持直接替换正式连接层。证据位于 `.dev-runtime/session-sse-fetch-memory-20261020/summary.json`。

任何正式接收层替换都必须遵守 [WHATWG SSE 解析规则](https://html.spec.whatwg.org/multipage/server-sent-events.html#event-stream-interpretation)，保留既有序号、审批、命名投影错误、断线恢复和取消边界，并通过完整页面原门槛的自然内存回归；不能用这个十几秒的小对照代替。

## 完整页面 fetch 对照：不采用替换

随后在同一开发页面、真实 HTTP API 和相同 SSE 负载下，仅替换诊断接收器；产品源码没有引入候选实现。浏览器主 Network session 仍限为 4 MiB／1 MiB，源码和构建指纹与原生 HTTP 基线一致。600.676 秒完成 288 轮、9,216 帧，单连接、错误为零，首个回复和实际标签切换均有断言；解析器不保留正文集合。

| RSS 指标，MiB | 原生 EventSource 基线 | fetch 诊断候选 |
| --- | ---: | ---: |
| 90–180 秒低点 | 488.47 | 514.83 |
| 末 120 秒低点 | 512.32 | 552.59 |
| 低点增长 | 23.85 | 37.76 |
| 自然末点 | 557.68 | 590.45 |
| 自然峰值 | 594.87 | 618.14 |
| 独立 GC 后 | 309.93 | 325.35 |

第六到第十分钟低点增量分别为 19.93／16.39 MiB，拟合斜率为 7.93／3.70 MiB/min；但候选的绝对末点、峰值和主窗口增长均更高，不能选择单个有利指标宣称改善。因此不替换正式 SSE 连接层，也不提交隔离候选。纯接收器的小实验无法预测完整应用收益。

证据位于忽略目录 `.dev-runtime/session-fetch-ui-memory-20261020/network-limited/` 的 `comparison.json`、`summary.json` 与 `cleanup.json`；自有浏览器、HTTP/SSE 和 Vite 服务均已关闭。独立 GC 后 Blink 存活对象显著下降仍只能说明有可回收分配，不能将它误称为已经定位的 DOM 引用泄漏。当前结论仍是三项局部缺陷已修复，原标准长期 RSS 验收未通过。

## 用户后续观察与停止范围

2026-10-20 用户补充：过一段时间后内存自行下降，并要求“就先这样”。开发者工具／扩展是否开启仍不确定，不能归因于用户环境。按请求停止继续调查，保留三项已有修复及原长测失败；未采用 fetch 候选，也未触发页面自动刷新或停止正式 Agent。

最后一次正式服务只读空闲观察在用户要求停止时结束，共 22 个样本、最后样本位于 210 秒；renderer RSS 388.85→285.26 MiB（最低 279.62），JS used heap 75.00→55.28 MiB，页面错误 0。源码指纹未变；只读探针阻断写操作和 HMR，自有浏览器已结束。这是提前结束的短时观察，不记作五分钟验收通过，也不能证明此前崩溃已彻底解决。摘要在忽略目录 `.dev-runtime/session-idle-regression-20261020/live-final-summary.json`。
