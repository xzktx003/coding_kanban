# 会话命令输出详情

会话模式的普通命令、读取文件、搜索和列目录均可展开查看命令输出。探索行保留原摘要与文件入口，右侧箭头独立展开输出；摘要不再附带「详情未加载」。展开时读取捕获的原 thread、turn、item，失败可手动重试。

聊天 SSE、只读历史继续使用 `view=chat`，命令输出仍在网关进入浏览器之前清空。展开详情是独立请求，不恢复工具正文轮询，也不把完整正文写入聊天 store、行缓存或持久存储。当前页面只协调一个进行中的读取；同一目标的多个展开行共用请求，其他目标显示繁忙并等待用户重试。读取完成后没有全局正文或 Promise 缓存。

固定接口为 `POST /api/session/api/codex/thread/item-detail`，请求恰好包含 `threadId`、`turnId`、`itemId`、`expectedType` 四个字段，禁止 query 和客户端指定路径、可执行文件、环境、RPC 方法。命令消费者只允许 `expectedType=commandExecution`，完整 JSON、外层与工具项身份、类型及字段校验通过后才显示内容。响应为 `no-store`。

网关与 TypeScript 运行层共用 `packages/session-runtime/src/codex/item-detail-channel.ts` 和独立 reader。正常应用网关使用自己的固定详情通道，按既有 `SESSION_DATA_HOME` 和 CLI 环境解析 provider 配置；不需要替换已运行的会话服务。运行层同样提供 `/api/codex/thread/item-detail`；无本地数据目录的测试网关可走原有流式代理。每个宿主进程只有一个 reader slot，直到其自有子进程真正退出才释放。reader 只发送 `initialize`、`initialized`、`thread/read`，不调用共享 Agent RPC，不 resume/start/subscribe，不触碰默认 CLI socket，不复制登录资料。

网关延迟导入详情通道；`SESSION_MODE_ENABLED=0` 时不导入默认运行层产物。显式使用已有 custom/legacy 运行服务、且默认详情产物不存在时，网关继续启动并使用固定只读代理，按原运行服务实际能力返回结果，不替换运行服务。其他导入错误仍使启动失败，不能吞掉真正的实现错误。后端单独执行 `pnpm --filter server build` 会先编译共享包和详情通道所属包；编译不替换存活的运行进程。运行包根出口只供依赖就绪检测定位清单，代码消费者使用 `@agent-orchestrator/session-runtime/item-detail` 子路径。

reader 使用有界增量 JSON token 选择器，非目标大正文不进入浏览器。初始化 10 秒、总计 120 秒、无原生进展 15 秒；下游背压期间不计作原生空闲。取消传到 reader，依次关闭 stdin、等待退出，必要时 TERM/KILL 仅终止自己的 reader。流式代理不聚合整份响应。

完整原生命令、ANSI 输出、复制控件只在可卸载的详情子组件中生成。收起、隐藏页面或工作模式、离开正文视口、切换身份、运行服务恢复或配对目标变化时立即清空本地 ref、取消未完成读取并卸载正文；普通聊天的 60 秒回收宽限期保持。重新出现时保留展开/阅读位置，但显示「加载详情」，只有新一次显式点击才读取。迟到结果不得复活旧正文。普通 SSE 重连打开与无关配对名称变化不清空已确认快照。

详情是只读原生快照，不改变聊天中的实时运行状态、审批、输入目标或草稿。原生仍在运行或未持久保存输出时会明确提示；不得把 null 输出解释为真实空输出。命令复制沿用既有 shell 包装规范化并保留完整正文，输出复制保留原始 ANSI 字符。输出大小没有新增截断上限，因此显式展开巨大项仍可能产生较大的浏览器绘制分配。

最小验收：`ShellCommand.detail.test.tsx`、`CommandActionItem.details.test.tsx`、既有命令/活动组/可见性测试，运行层 `item-detail*.test.ts`，网关 `session-item-detail*.test.ts` 和 `session-mode.test.ts`，以及 `tests/e2e/session-command-details.spec.ts`。后者检查两个实际活动组调用链、四种动作、显式单次读取、ANSI、手机布局与手动重试；不是源码字符串扫描。真实原生持久化快照验收需另用隔离 HOME/CLI/data 和原生 reader，记录完整复制、无关正文裁剪、取消退出、JS 堆、backing storage 与 renderer RSS；合成持久化记录不冒充命令执行测试。

浏览器回归使用局域网 HTTPS 地址，并设置 `PLAYWRIGHT_SKIP_WEBSERVER=1`、`PLAYWRIGHT_BASE_URL` 和 `PLAYWRIGHT_FRONTEND_PROTOCOL=https`。必须同时运行 [会话内存防回归约定](session-memory-contract.md) 中的真实 HTTP/EventSource、idle、恢复、审批与消息回归，保留原断言和预算。验收记录另见 [本次报告](designs/session-render-alignment/command-details-acceptance-20261014.md)。
