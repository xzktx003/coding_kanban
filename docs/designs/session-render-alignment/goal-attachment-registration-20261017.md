# Goal 附件在真实网关的入口注册（2026-10-17）

真实网关已接通现有 Goal 附件的 materialize、read 和 cleanup 三个本地入口。修复只在 [app.ts](../../../apps/server/src/app.ts) 增加既有模块 import，并在 session wildcard 之前调用注册函数、传入原 `sessionAttachmentRoot`；没有新增附件协议或改写 handler。

## 现象、根因与历史说明

缺少注册时，真实 `buildServer` 的 materialize 请求落入需要 runtime origin 的 session wildcard。隔离 app 没有上游 origin，实际返回 **503**，而预期是本地 **200**；这不是所有附件路由普遍404，也不是必须先启动 runtime 才能物化附件。

接线前 `app.ts` 是 SHA256 `02fd8e6a1bd934efc627d253d2511c0b72b46f220650e2d05c0ece799a76dd7d` 的基线。本轮没有历史注册提交或其它证据支持旧文档中的“并行工作删除”“归属待用户回复”归因，因而更正当前警告，直接修复已授权的注册缺口；两个较早模型菜单记录只追加同日纠正，不改写历史计数。接线后完整文件为36522字节，SHA256 `15e9895d4cef090a6e75d726c3fb45073f7ff2a8106fec493bd9ce7410f1251e`。

原 [模块测试](../../../apps/server/src/routes/session-goal-attachments.test.ts) 已有真实 buildServer 上传和物化，再关闭该 app、重建 Fastify 并手工注册模块来验证读取/清理。不能把旧测试一概说成“只有手工注册”。新增 [同 app 用例](../../../apps/server/src/app.goal-attachments.test.ts) 补的是在同一个真实生产构造 app 中完成三路由，并核对 Unicode 文件全文、HTTP 全文和清理范围。

## 红绿与构建

新增测试最初在 server tsc 报 TS2347：`made.json<T>()` 所在调用被推断为 any，不能接泛型。只将返回值接到显式类型的 receipt 变量，运行时仍调用原 `made.json()`，断言与动作不变。该类型夹具失败独立保留，不算产品 RED；纠正后的完整 server 类型检查通过，耗时6.894秒。

旧产品实际运行两个文件13项，**11 PASS / 2 FAIL**；失败分别是新增同 app 用例与既有 production-gateway 用例，均为 materialize 预期200、实际503。新增用例后续 read/cleanup 尚未到达，不能补认通过。完整合格红灯之后才提升两个注册 splice，新增测试字节保持不变。

接线后三个 Goal 后端文件 **16/16 PASS**，包括原13项和3项取消控制，零跳过；耗时4.448秒。`pnpm check` 通过，耗时93.906秒，覆盖 shared/runtime/server/web 类型与构建，既有 dynamic-import/chunk-size warnings 保留。本轮七条实际 run-checked 命令为五条 exit0、两条 exit1，后者分别是初始类型夹具错误与合格旧产品行为红灯；各自输入 maps 与 HEAD 不变。本批没有额外浏览器批次，前一阶段 E12 的695单测／78个浏览器场景不叠加为 R29 数量。

## 运行中 HTTP 往返与服务边界

2026-10-17 13:02:31 UTC，在实际 LAN HTTP `http://10.30.0.24:8282` 调用 health 和三个附件端点，均返回200。自有目标文本有 **4251 Unicode codepoint、14059 UTF-8字节**；物化后的磁盘内容及 read 返回均精确等于原全文，cleanup 只删除本次自有 UUID。清理 token 只在探针内存传递，文档与结果不保存其值。

该探针仅发本地 health/附件请求，没有 Goal thread set/clear 或 Agent 控制请求；它核对三个原进程身份，不是全系统 native 调用监控，也不将后端隔离测试说成没有自有 Node lease 进程。原 runtime `2712539/55361120`、前端 `217746/112857665`、参考服务 `2973318/111490242` 的 PID/start ticks/cwd/argv 均保持。`session:status` 实际通过，耗时2.121秒，正式 runtime ready，但明确报告运行中产物与磁盘新构建不同，新运行代码未激活；没有停止 Agent、手工重启或复制认证数据。

前端 LAN HTTP `http://10.30.0.24:48865` 与原版参考页 HTTP `http://10.30.0.24:37575/native-goal.html` 沿用原进程。本轮不证明物理设备、官方 GUI、原生 CAS、当前 RSS 长测或整个 Goal 完美完成；此前原生／UI验收与剩余边界分别保留。

实际收据与本地探针位于 `.dev-runtime/session-polish-round2-20261016/goal-attachment-registration-r29-root/`，包括 `old-behavior-qualification.json`、`goal-related-green-receipt.json`、`workspace-check-receipt.json`、`live-http-result.json` 和 `session-status-receipt.json`。本文只记录这一局部接线修复；阶段冻结、独立审查与外置 release 不由单项 PASS 或本文替代。
