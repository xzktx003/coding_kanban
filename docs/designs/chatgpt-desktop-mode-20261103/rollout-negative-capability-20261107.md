# 原版后台压缩请求的负能力

原版 `sendEnablement` 在配置读取完成后可能自动发送无 params 的 `rollout/compress`。这是固定 SDK 的内部方法，stable0.166.0 schema未列出。共享宿主没有执行这项历史维护的授权，因此仅对这个固定名字、缺省/null/空对象参数返回明确 `-32601` 能力错误。不会压缩历史，也不转发请求；额外参数、未知结构、账号操作及非法 turn/resume 仍按原策略拒绝。

固定 chunk SHA `c23f63f8ff156b2a92a81ee2870d80ab959ced6ce6232d6fe7e54bbefe11d333` 内，压缩调用后的 catch 只记录 `Failed to trigger rollout compression`，可继续原连接。上一轮 `sendEnablement` 惰性静态摘录的 REA Evidence `ev_027ab9bc9b525f42538bc5510f0ccd9ec049e1c7c936ccf441125f1f2bcf7f9a` 已包含该分支；它不代表运行了原应用。

本次窄提取同一固定 chunk 的42个 sendAppServerRequest 字面量作分类，而非通过反复启动来猜方法。其他动态方法与其他chunk不在覆盖内。语法有效的未知方法直接返回 -32601 本身不会赋予执行权限，但将改变现有明确拒绝与错误结构契约；本轮不引入通用未知方法分支，仅维护固定负能力列表。

必要回归先红后绿：明确错误无成功结果、无上游压缩写出、同一新建自有无登录 Unix WS 仍能读取元数据，以及参数、防重放、账号失效和实际任务拒绝边界。未连接默认daemon，未调用模型；原UI最终收发由集成阶段验证。
