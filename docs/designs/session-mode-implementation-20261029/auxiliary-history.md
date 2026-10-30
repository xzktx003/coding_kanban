# Claude/ACP 有界最近页与只读恢复

日期：2026-10-30。属于已批准方案B/G公共体验。现有虚拟列表只约束DOM，原完整历史响应和canonical store仍可能无限增长，因此增加真正的传输分页，再与统一资源治理接入。

`POST /api/cc/session-messages?view=recent`、`POST /api/acp/session?view=recent` 接受 `{session_id,cursor?,limit?,metadataOnly?}`。limit为1—256，默认80；响应 `{data,nextCursor,revision,truncated,projection,metadata?}`，页内按时间正序，游标绑定provider、精确session与稳定源行。完整JSON响应保持2MiB以内，数据预算另外预留元数据空间。旧无query接口保持原SDK消息/ACP原始更新数组，现有外部消费者不被切断。

Claude返回原SDK消息形状和UUID；已安装SDK0.3.296支持从起点计算的limit/offset，但没有本入口所需的最近页/UUID向前游标。当前实际读取仍经过原64MiB有界SDK worker，随后服务端投影最近页，不能称为底层文件流式分页。`metadataOnly`只核对已有会话元数据缓存/文件变更，不调用getSessionMessages；文件大小/修改时间变化触发正文恢复。超过128KiB的单条消息返回明确truncated预览与historyDetail引用，不能据预览宣称完整消息已加载。

ACP在应用自有SQLite生成版本化派生投影，不修改或调用原生Agent。每128条源更新让出事件循环；已处理进度落在同一数据库事务内，不重复扫描全部历史。agent/thought连续chunk合并为不超过64KiB的Unicode安全片段；工具更新按精确toolCallId合并初始title/input和后续状态，条目ID基于源行/工具身份。更早页从真实投影锚点读取，长历史可持续分页，不靠盲截最近N个delta制造缺失基线。配置/模式随小元数据投影保存，metadataOnly查询源count/maxID而不解析正文。单条历史源仍有64MiB安全上限，超出明确拒绝，不放宽原生接收边界。

大工具、图片或消息的完整内容通过只读 `POST /api/cc/session-message-detail`、`POST /api/acp/session-detail` 按需读取：请求 `{session_id,item_id,offset?,limit?}`，limit最多65536；返回 `{text,nextOffset,format:'json',revision,itemRevision}`。offset为JSON表示的UTF-16位置，服务端不拆Unicode代理对，预留JSON转义开销；itemRevision用于检查后续片段是否仍属同一源。每次只返回有界片段，不在正文store中重新保留完整巨项。源失效/范围无效明确报错，不connect、load、resume、停止或发送普通消息。

红绿灯和专项验证：`storage/recent-history.test.ts`、`claude/recent-history.test.ts`先因缺少实现出现4项红灯；实现后，与`core/recent-history.test.ts`、`claude/recent-routes.test.ts`合计7项通过，运行层类型检查通过。覆盖600条CC真实向前分页、ACP长Unicode回复全部分页重建、跨session游标拒绝、工具初始/末次基线、稳定ID、元数据不读正文、巨项详情及raw兼容。日志位于忽略目录`.dev-runtime/session-full-implementation-20261029/aux-{cc,acp,recent}-*.log`。

以上是后端和路由专项证据。浏览器实际传输、60秒释放/恢复、审批独立保留和统一16MiB预热资源预算由[预热与恢复](performance-recovery.md)记录；未执行的浏览器测试不在本文件计为通过。

## 实时源身份与投影验证

ACP持久化返回真实SQLite源行ID，自有live envelope增加`historySourceId`，最近页条目保留最后修改源ID，`metadata.historySourceId`给出实际投影边界。调用方提供的`client_message_id`仅关联本地乐观用户行：自有`prompt-persisted`事件带精确连接/Agent/session、clientMessageId及`sourceRows[{historySourceId,partIndex}]`，其中文字为0、图片依序1…N。此事件发生在本地持久之后，不是原生接受回执，也不提供幂等重发。原生ACP请求不携带这些自有字段。真实子进程加真实SQLite验证live→recent源身份和用户ACK，先红后绿；日志`aux-source-*`、`aux-prompt-ack-*`。

聊天SSE的`view=chat`在正式网关序列化前也处理CC/ACP工具大包。ACP工具字段和Claude tool_use.input/tool_result.content按结构有界，单字段至多64KiB；超过预算标记truncated，详情引用分别绑定精确toolCallId/session或SDK UUID。ACP detail额外接受`tool:<toolCallId>`，只查询该历史session；不接受从请求注入目录或连接地址。普通助手文本、权限事件、审批选项、事件seq和sourceID不变。超大不完整tool input JSON delta明确留空并标记未加载，不能传出被截坏的JSON当成完整输入。

工具预算按实际JSON线缆字节计算：键、引号、控制字符转义、Unicode、标量、逗号及冒号均计入；结构深度/条目数同时有界。ACP历史与实时投影共用`boundedAuxiliaryToolPreview`，避免原始UTF-8预算在序列化时膨胀。已存在的超页派生行读取时只返回小截断预览，保留原条目/源ID、可前进的原生投影游标与原始工具详情，不返回空页假装历史结束。转义键、控制字符工具字段、旧超页缓存三个反例先红后绿；与源身份/Unicode详情回归共12项通过，运行层类型检查通过；日志`.dev-runtime/extensions-workspace-20261029/aux-{budget,cached-budget}-*.log`。

`auxiliary-chat-projection.test.ts`3项红绿通过。`tests/e2e/session-auxiliary-network-memory.spec.mts`使用原生HTTP上游、实际网关和Chromium原生EventSource，通过HTTP LAN `http://10.30.0.24:39677/probe`（自有测试监听`0.0.0.0`，结束后关闭）。实际源67,113,626 bytes，浏览器180,218 bytes、最大事件11,256 bytes，19条连续seq、8个ACP sourceID、CC/ACP审批和终稿全部保留。指标文件在忽略目录`aux-network-browser-metrics/**/auxiliary-network-metrics.json`，日志为`aux-network-browser-metrics.log`（均位于本轮根验收目录）。这是短时传输验证，没有强制GC或重启任务，也不计为30分钟RSS通过。

## ACP刷新只读恢复

`acp/start`返回实际`runtimeInstance`；前端设备指针不得代替授权或业务状态。固定只读 `POST /api/acp/connection-snapshot` 必须提交`connection_id/session_id/expected_runtime_instance`，分别验证当前运行实例、仍存活连接和该连接真实拥有的session，不创建新进程或调用任何ACP RPC。返回实际cwd、running/deliveryUnknown/lifecycleUnknown、初始化/会话控制元数据与仍待处理的精确权限请求。会话控制元数据每项最多128KiB、每连接2MiB LRU；回收只影响可恢复的控制目录，返回settingsKnown:false，任务和权限不因此删除或推断为空闲。

真实自有ACP进程加SQLite验证sourceID、prompt-persisted和snapshot无RPC；HTTP拒绝旧runtime/其他连接/其他session，mode/model/config成功后快照跟随真实回执，待审批刷新可读、回答后消失。`history-source.test.ts`及原ACP服务回归合计17项通过，日志`aux-snapshot-complete.log`。网页指针恢复、资源释放和composer实际可用由B/G组合验收单列。

## 历史图片按需查看和下载

大用户图片不再只有base64 JSON详情。最近页保留`historyImages:[{index,mimeType}]`和精确源`historyDetail.itemId`，不回灌原始图片字节。固定只读POST `/api/cc/session-message-image` 与 `/api/acp/session-image` 接受`session_id/item_id/image_index/download?`，只从该SDK消息或ACP源行取已保存的PNG/JPEG/GIF/WebP，不接受路径或外部URL。binary响应no-store/nosniff，返回实际MIME、尺寸和字节SHA修订，下载文件名由固定索引生成。

每图10MiB沿用现有附件限制；显式预览另以40,000,000像素限制浏览器decode分配，超限返回`HISTORY_IMAGE_PREVIEW_PIXEL_LIMIT`，仍可通过明确download:true下载符合字节限制的原图。此限制没有缩小上传或原始内容保留范围。超过字节预算和不支持/伪造MIME不能伪装下载成功；前端查看/下载仍须逐字节有界读取并在关闭、隐藏、切scope或换图时释放blob URL。

核心图片读取2项红绿，加真实CC/ACP HTTP源身份、binary/headers、跨session拒绝、largepreview元数据及原始下载测试通过。已安装官方Claude SDK另外在全新私有HOME从真实JSONL读取最近页/更早游标/图片原字节，文件前后完全相同；该测试不启动模型、不继承正式登录。日志`aux-images-http-green.log`、`aux-claude-native-files.log`。浏览器大图实际解码和下载结果由正文验收记录，不把JSON可读当成图片可看。

小文件不会绕过预览像素保护：实时CC/ACP SSE、CC最近页、ACP新派生行及旧v1派生缓存都在传输前使用同一纯字节header检查。只保留≤128KiB base64且真实PNG/JPEG/GIF/WebP头/MIME匹配、尺寸为正且≤40MP的内联图；其他图只保留稳定源ID、文字占位和按需图片/详情入口。普通正文和安全小图保持原对象；外部URL不自动下载或解码。二进制显式下载仍保留原字节。真实50MP tinyGIF分别复现最近页、实时投影与旧缓存绕过，两轮先红后绿，当前共享工具/近期历史/图片/官方SDK私有源组合14项通过，日志`inline-pixel-{red,cached-red,complete-green}.log`，不等同于动画全部帧解码内存保证。
