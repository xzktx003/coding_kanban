# 官方资源缓存与刷新 WebSocket 传输核对

日期：2026-10-16。继续执行[完整计划](refresh-recovery-plan.md)，候选未正式启用，两秒要求保持。此次不修改官方 VSIX、code-server、原生 DOM、MessagePort、SDK feature flag 或共享状态内容。

## 原 Service Worker 缓存已生效

证据目录 .dev-runtime/codex-refresh-20261016-service-worker-cache/。observation/result.json 两次普通刷新均经官方输入框发送，精确 thread/cwd、接受、completed 和标记各一次通过；约 **12574.20 / 10006.40 ms**，不是两秒通过。

原 worker 只增加有界的被动 message 观察器，读取 did-load-resource 的状态、资源 basename、ETag 是否存在，不消费 stream，不改变缓存；结束移除观察器。冷启动观察的11份官方 hashed JS返回200且有stream，之后两次均为 **11/11 304**，原 preframe 的11个对应请求也全部携带 ifNoneMatch。原 CacheStorage 有相应条目。此前浏览器合成200和 encodedBodySize 不能作为完整脚本重传的证据；此次没有为已命中的资源改写缓存策略。

网关只读记录自有 upgrade socket 的 bytesRead/bytesWritten。统计范围是网关这一跳的 TCP 明文字节：入站排除 HTTP upgrade 请求头，包含捕获的 head；出站包含101响应，不含 TLS、网卡或跨跳开销。计数不读取正文，最多32条连接，后续超限明确标记。前两次刷新连接组完整关闭后，出站分别 **30376944 / 26294690 bytes**，不能与 Resource Timing 的虚拟资源大小相加。

## 大包来自官方初始化和共享状态

后续 CDP 只保存 WS 消息大小、原 VS Code framing/IPC 方法和有限 schema 字段名，不保存正文、SDK key、账号值、完整 URL 或源码。解析只保留13字节协议头及最多512字节临时前缀，完成即释放；不代理或替换原生 MessagePort。

message-shape/result.json 中，原通道的约 **6.73 MB** $onMessage/$postMessage 大包包含 sdkKey/userId/accountId/authMethod/stableId/payload/feature_gates 等字段名，回传类型为 **shared-object-updated**。另有约 **1.305 MB** 的 extension identifier/location/manifest 元数据。它们不是可据此删除的聊天历史；此次保留全部原数据与原生处理。

诊断错误均保留：protocol-metadata 原 runner 未将非协议 JSON 连接分类，虽然原生发送完成，整体被过早标绿；现 result.json 改为false，result-before-review.json、SHA256和diagnostic-review.json保留原判定。message-type 以实际 JSON 帧另行分类后零解析错误。message-shape 后来触发32条诊断连接上限而失败，未提高上限；原生发送及大包头部元数据有效，不把缺失的 window-message 快照计为通过。所有这些采样不作为最终性能矩阵。

## 显式 profile 的传输压缩实验

新增服务端注册参数 **webSocketCompression: true**，只允许固定合法 profileId；缺 profile 或非布尔值直接拒绝。默认关闭，HTTP参数不能开启，正式注册入口不传此参数。新路径只在浏览器链路协商 permessage-deflate，双向 no-context-takeover、window bits 10、threshold1024、level3、memLevel4；不保留跨消息压缩字典。请求 concurrencyLimit4，但 ws 库的限流器由同一模块首个实例共享，不能把该选项声称为全进程必定最多4个 zlib 工作；完整资源定标仍待验收。

该分支关闭网关到自有 loopback code-server 的重复压缩，保留原帧数据及节奏。默认分支仍沿用原上游协商。客户端解压后 **8 MiB**、上游单消息 **2 MiB**、待发和出站队列预算均保持，压缩不提供大包绕过。

ws-compression-fixed 是首版真实失败：下游协商成功，但原 loopback 协商仍启用，首次出现额外重连，随后 thread cwd 为 / 而非私有项目。该轮已接受的独立标记不重发；结果false。该记录不能单独证明目录变化的唯一根因或宣称旧端设置覆盖问题已解决。ws-compression-loopback 新独立夹具关闭重复压缩后，两次官方发送的正确 cwd、接受及完成各一次通过，约 **12149.20 / 10757.70 ms**，仍全部两秒失败；每次正常三条连接。完整关闭后的刷新连接组出站 **11759810 / 10099160 bytes**，相对前述两组约减少61%，仅证明这次工作负载下该跳的传输差异，不能归因为整页性能收益。

源码红灯 compression-red.log 为0/4（原不支持该选项）；首个测试夹具漏 protocol/projectDir，造成1011的中间失败另存，不充当产品队列复现。补齐真实运行记录后 compression-valid-fixture-red.log **3绿/1红**，明确上游仍错误协商压缩；修正后测完整字节回传、双向协商、解压后超限1009、上游独立2MiB及配置反例。最终源码及三端复核见持续进度，本实验不能替代完整启用。

首个私有 route 副本使用 .ts，位于 ESM 包外被当作 CommonJS，启动在网关阶段失败；没有浏览器发送，保留失败并清理自有进程。后续 .mts 副本只用于因果诊断，最终夹具改回实际 apps/server 源码与显式注册参数。最终三端 runner 的诊断插入表达式首次未匹配，在执行前拒绝；修正前未发送，记录在 runner-preparation-failure.json。

## 验证边界与下一步

固定 VSIX 26.51007.21434、匹配CLI0.162.0-alpha.17.2及其SHA256沿用[实际 fork 验收](refresh-preload-fork-20261016.md)。局域网入口、最终构建、三端结果、清理及正式运行身份另接持续进度。iPhone16按用户要求模拟，不能声称物理iOS/WebKit、系统键盘或剪贴板实测。

最终 .dev-runtime/codex-refresh-20261016-ws-compression-final/ 使用实际源码注册参数，不再导入私有 route 副本。三端草稿 **9/9**、原实例捕获/可发送/直接保留钩子0 **6/6**、正确接受与completed标记各一次 **3/3**；导航至接受为 **13306.40 / 14064.50 / 13668.10 ms**，全部两秒失败，15项ERR_ABORTED保留，总passed=false。实际101回执确认原生连接协商双向no-context-takeover、window bits10；其它服务连接无该扩展不被误算为原生协商失败。Chromium145.0.7632.6、iPhone393×852、DPR3、触点1，真实触控及659/430/852缩放、iframe/父节点身份保持；首次无公告点击。accepted-2截图仍可见刚提交文字及忙碌图标，测试只证明原生接受/完成，未断言官方前端此时已清稿/结束等待，不把截图当完整交互闭环通过。

最终 gateway-typed-final.log **48/48、无跳过**，涵盖原网关/页面租约与4项新增传输测试；其它宿主源码未因压缩而改，不冒称重跑此前304项。首次check-final.log暴露本批测试将Fastify.thenable传给assert.rejects的TS2769，已用async回调保留拒绝断言；最终check-typed-final.log **pnpm check exit0**，原大chunk提示保留。任务测试格式、源码diff、链接与.env忽略另按实际命令核对，无提交/推送。

四个ready夹具（原资源/首版压缩/关闭回环/最终源码）均12个已知自有进程退出、零清理错误并删除根/TLS；未ready的模块副本失败夹具为7个。原资源夹具9终态轮次含running的SSE超时failed，不算运行保护通过；首版压缩4轮、关闭回环5轮、最终源码6轮均终态，人工审批仅由精确清理interrupt结束。最终源码idle4 completed、running1 completed、approval1 interrupted，Responses6次；创建连接保留，不算manager单独保温/最后订阅退出/官方UI中断通过。首批释放命令的Node模块格式错误、清理后重试遇ENOENT均保留且未发信号到其它进程。

formal-safety-final.json（2026-10-16T10:46:57.482Z）核对正式Session/native launcher/native host仍为 **2712539/55361120、2718477/83117363、2729812/83119682**，正式 **HTTPS https://10.30.0.24:8484/?mode=codex**（端口8484）及后端/Session健康均200。session-status-final.log仍ready且磁盘/运行产物不同，未切换运行层或替换活跃实例。各私有前端绑定0.0.0.0；最终LAN **HTTPS https://10.30.0.24:5174**（端口5174），其它临时5173，均已关闭；正式profile未传压缩开关。

本批确认缓存命中和 SDK 共享状态传输成本，没有删除状态、延迟审批或提高预算。仍须完成两秒/180次三状态矩阵、原并发红灯、manager单独保温及容量/冷恢复、官方中断/继续/附件/提问、旧端设置、ChatGPT/OAuth、自动profile/持久源/完整资源准入、长历史/大包和自然RSS长测。阶段0仍为红，候选继续关闭。
