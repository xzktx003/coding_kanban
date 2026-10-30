# 原生 HTTP 与完整 Network 观察器的内存验收

这是 [会话内存约定](session-memory-contract.md) 的补充测量方法。原 `session-idle-memory.spec.ts` 的标准负载、门槛和历史失败独立保留。此方法不改变产品、事件输入、缓存预算或用户状态；将测试 API/SSE 从 Playwright 路由转为实际 HTTP，并在 raw CDP 唯一页面 session 仅调用一次 `Network.enable`，显式设置调试器正文副本预算为总计 4 MiB、单资源 1 MiB。所有 Network 事件仍传给并计入观察器，不关闭 agent、不筛除 SSE、不调用 getResponseBody/durableMessages、不强制 GC 或重新加载。

## 为什么单独报告

2026-10-30 的同源码/Chrome/参数五分钟对照：不启用 Network agent、使用 `Network.enable` 默认参数、设置上述固定预算，均完成 148 轮、每轮 30 delta 加 start/completed 的原生 EventSource 输入。90–150 秒与末 60 秒 renderer RSS 低点增量分别为 11.355、66.270、12.703 MiB；默认/固定预算组收到全部 4,736 条 CDP EventSource 回调，固定组序号无缺口/重复。两组源码资源均为 866 次、13,438,907 B；API 轮询受时序影响为 2,055/2,053 次、8,715,287/8,715,615 B，不称为 API 字节完全相同。草稿、审批、单音频上下文、单 SSE 和 renderer 身份均保持，任务写入及页面错误为零。

这只证明当前版本与接收路径下的局部观察成本。[2026-10-20 的负结果](session-native-memory-attribution.md) 必须一并保留：当时 Playwright 主 Network session 相同 4/1 MiB 限额、真实 HTTP 的完整页面仍增长，关闭独立 SSE Inspector 也没有改善。两轮产品接收器、源码、消费者和浏览器测量环境不同，不能宣称限额单独解决所有历史增长，更不能改写先前 30 分钟 Playwright 的 RED。这里不假定默认参数对应某个未核实的固定容量；预算语义以锁定 Playwright 自带 CDP `protocol.d.ts` 的 `Network.enable` 参数为准，是调试器正文复制预算，不是产品正文限制。

负载边界也须单列：本 driver 显式保存 `warmFollowedSessions:true`，不能单独证明空设置设备的默认值；初始三份正文必须已恢复，后续只检查原预算上限，允许被真实资源策略回收，不能据此宣称所有关注正文全程常驻。它按原 stock 夹具关闭所有 WebSocket，静态源 `hmr:true` 只描述源配置，不是本浏览器实际持续连接 HMR 的证明。默认预热/资源回收和真实 H2/HMR 的多页性能验收分别运行，不能混入本项结论。

审批断言与原标准相同：保留初始注入的一项 pending，不是本长测新触发的原生审批交互。指纹覆盖冻结前端/shared/配置、Chrome、driver 及明确列出的 11 个直接测试输入；它不是所有路由/vendor 的递归依赖闭包。原生审批和 CLI 同任务等行为由独立隔离原生用例证明。

五分钟证据位于忽略的 `.dev-runtime/root-native-memory-20261030/raw-http-fixture/{none,network,capped}.json`、`third-arm-summary.json`。首轮缺少真实 user gesture 的失败诊断也保留，不能用于有效对照。

## 可复现入口和边界

入口为 `tests/e2e/session-native-http-memory.spec.mts`，实现为 `tests/e2e/helpers/session-native-http-memory.mts`。默认明确跳过，不能算验收。需要已有的、绑定 **0.0.0.0** 的独立冻结前端及其私有运行记录；不启动正式 Kanban/Agent。静态资源固定代理该源；所有 `/api` 均由原 stock fixture 在新建 LAN HTTP 监听器处理，未知 API 拒绝，原生 SSE 经独立 stock HTTP EventSource 流完整计量。仅到显式固定 HTTPS 源的服务端请求接受自签证书，不改变全局 TLS 或浏览器策略。

显式设置以下环境后运行 `PLAYWRIGHT_SKIP_WEBSERVER=1 pnpm exec playwright test tests/e2e/session-native-http-memory.spec.mts`：

- `SESSION_NATIVE_HTTP_MEMORY_RUN=1`，`SESSION_NATIVE_HTTP_MEMORY_MINUTES=30`。
- `MEMORY_FRONTEND_ORIGIN`：现有冻结前端的 LAN HTTP/HTTPS origin，禁止凭据、路径和查询参数。
- `SESSION_NATIVE_HTTP_MEMORY_FREEZE`：含 `web/`、`packages/shared/`、`source-manifest.json`、`workspace-dependency-manifest.json`、`configuration-manifest.json` 的绝对冻结目录；实际 shared/package 依赖也须隔离，不能只有 Web 源副本。
- `SESSION_NATIVE_HTTP_MEMORY_SOURCE_RECORD`：本次固定的私有监听记录绝对路径，含 `lanUrl/run/pid/startTicks/launcherPath`，并明确 `nativeHttpFixture:false`、`fixtureHtmlInits:false`、`apiProxy:false`、`watcher:false`、`hmr:true`。不能把已注入另一套 30 会话 fixture 的性能源用作干净静态源；实际 launcher 也参与前后 SHA 校验。
- `PROBE_CHROME_BIN`：锁定的实际 Chrome 可执行文件绝对路径；结果记录 SHA、版本、完整参数和自有 PID/start ticks。
- 可选 `SESSION_NATIVE_HTTP_MEMORY_OUTPUT`：不存在的绝对输出目录；默认采用本次测试输出子目录。

`SESSION_NATIVE_HTTP_MEMORY_SMOKE=1` 仅允许显式最多一分钟的夹具检查，结果始终 `formalAcceptance:false`。短测不能替代长测。

## 三十分钟严格关卡

持续至少 1,800 秒、原 2 秒节奏、每轮 30 delta、真实鼠标选择和原生 EventSource。完整 app pooled subscriber 另以纯数字计数核对序号，证明应用实际消费而非仅发送成功；CDP 同时核对全部帧及 JSON 字节，服务端保存真实 HTTP/API/SSE 字节和全部请求分类，零任务写入。

保留原窗口 **90–300 秒 / 末 180 秒**，两个窗口必须非空：JS heap 低点增长小于 64 MiB、峰值小于 256 MiB；全部 renderer RSS 低点增长小于 128 MiB、峰值小于 768 MiB。每样本必须有精确 PID/start ticks/RSS，缺测、换代或 renderer 集合改变即失败，不能当低点。原 8 MiB/thread、后台合计 16 MiB 检查保留；同时记录 DOM、listeners、backing storage 和 host load。

所有样本保留草稿/审批，后台最新完成仍未读；结束用真实选择确认精确 thread/turn 最新正文存在且与滚动视口的矩形交叠，唯一可编辑 composer 及其 editor 的实际 DOM owner 都等于该 thread。结尾条件等待单列 settlement 耗时，不据此宣称两秒性能通过。连续完成声仅一个 AudioContext，停止输入后 35 秒内自然关闭。开始/结束复核冻结源码、工作区实际源、配置、监听身份、实际消费的 fixture/shared helper/sampler/driver 和 Chrome SHA；清理后只读确认已捕获 renderer PID/start ticks 均退出。只关闭精确自有浏览器、profile、HTTP/SSE，不停止任务或正式服务。

首次最终源尝试在 566.120 秒、278 轮后按明确维护指令取消：独立审计已在忽略副本复现四项 metadata/thread-list 的 endpoint/token 隔离缺口，产品冻结必须撤销并修复。此次不是因 RSS 选取有利结果重试；其 8,896 条连续应用帧、全部样本和显式取消原因保存在 `.dev-runtime/root-native-memory-20261030/strict-final-thirty/`、`strict-final-thirty-cancellation.json`、`strict-final-thirty-cleanup.json`。结果 `completed:false/formalAcceptance:false`，仅向核实 PID/start ticks 的自有执行 helper 发 SIGTERM；自有浏览器、捕获 renderer、HTTP/SSE/profile 全部确认退出，静态源及正式服务未收到信号。该 partial 不计长期内存红灯或绿灯。

完整长测待隔离缺口修复后的最终冻结源重新稳定再执行；不将五分钟改善或 smoke 标记为三十分钟通过。
