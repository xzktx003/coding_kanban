# 子线程身份与父会话安全释放验收（2026-10-14）

用户已批准 [修改方案](session-subagent-identity-release-plan-20261014.md)。本轮在大量既有未提交修改之上进行限定修复，不提交/推送、不修改官方 VSIX，不连接默认 CLI IPC，不复制登录凭证，不停止正式 Agent。

## 最终行为

- 协作通信接收者不再制造子关系；仅创建事件和原生父元数据提供关系证据。当前原生主身份可以纠正旧错误节点，历史回放与迟到快照不能将其复活。
- 公共、侧边和子输入使用同一身份/权限规则。真实子输入仅原生明确允许时开放；旧能力、未知/不可用节点不能开放权限。已存在子线索的未知身份可只读“重新核对”，不 resume、启动、停止或发送消息。
- 缺 source 且没有任何子身份线索的旧主线程元数据继续原输入兼容，不据缺字段断言主身份；后端保留实际原生校验。明确 subAgent 源但缺父标识不会被当成主线程。
- v1 观察缓存迁移为待核实线索；明显主线程伪边、自环和环被移除。草稿、附件、关注标签和面板选择保留。索引不持有工具正文，identity 不保存 turns/preview/status，子节点只保存最近轮次元数据；同一业务快照不因 checkedAt 变化通知订阅者。同值 live 元数据独立推进每线程观测标记，迟到旧响应不能恢复已撤销权限；通信项不覆盖接收者的原生模型设置，隐藏模式取消核对与重试。
- 正常 owned/readonly 生命周期不再常驻覆盖聊天。在“当前会话的更多操作 → 查看执行状态”按需查看保留原因；external/releasing/unknown 等真实问题仍有清晰提示。查看状态和“重新核对”只读。
- 匹配已验证 native 版本时，父与全部已核实后代均无活动资源，才取消本项目的父订阅；不对子线程发 unsubscribe、interrupt 或 tree shutdown。活动、交互、目标、后台命令、队列、首次消息及送达未知继续保护。
- 补齐未加载中间祖先；无关家族的循环或正文不阻塞目标。检查起点、最终资源检查及真实 stdin 写入前核对实例/目标/家族状态；ACK 仍不等于 writer 已释放。

## 红灯与隔离证据

初始前端身份回归 12 项失败；浏览器分别复现 V1/V2 通信误禁主输入、旧错误缓存与桌面/手机 owned 浮层。访问提示 3 项、状态菜单 1 项、元数据只读适配 1 项捕获对应红灯。后端新增 9 项捕获 idle 后代不收敛、未加载中间祖先、无关环/正文、新后代查询竞态与未知子身份。

末轮复核另捕获 inspect/verify/snapshot 三入口的同值新权限与旧响应竞态、隐藏模式未取消读取、通信覆盖接收者设置；修复后加入过期 unavailable 与无关线程更新保护。原生写队列的未 dispatch 超时/取消及写帧前检查、送达未知仅查询收敛和输入锁内权限/epoch 亦有确定性红绿灯。浏览器的同值权限场景最终严格通过；其初始浏览器失败发生在前置通知计数，不能冒充直接复现旧 true 覆盖，该直接红证据来自单测。手动释放边界提示两项先红后绿。

原生关卡使用独立 HOME/CODEX_HOME、临时数据、本地确定性模型服务；每轮清理仅自己的进程。原包缺执行权限时只为 byte-identical 私有副本加执行位。

| Native | 原二进制 SHA-256 | 父 unsubscribe ACK 后 writer 实际释放 | 核心结果 |
| --- | --- | --- | --- |
| `0.162.1`（当前正式运行进程使用的同一 binary） | `628e35487d888a28f0427fc37501da529dd3d81fcbad7a2c3421c1e8670d92e1` | 2036 ms | 原父/子 UUID、历史和控制树保留；另一隔离客户端取得原父 writer；恢复后的原子线程恰好执行一轮新任务。 |
| `0.162.0-alpha.17.2`（VSIX 内置） | `73b73b048546993298234a295de01ef2424e7a8b29def9d0ecb1ca7cb77500d4` | 2034 ms | 同上；官方包未修改。 |

两版各 6 项关卡通过：idle 家族释放/恢复、运行子线程、父待提问、子待审批、后台终端与活动 goal 的真实原生形状。保护项没有对相关家族执行 unsubscribe；这证明原生资源协议，不替代本项目实际 Ownership 的保护测试。读取、取消订阅、resume 的模型调用为 0；恢复后对原子 UUID 派发恰好 1 次模型调用。没有远程模型请求。

生产只根据真实 initialize 握手精确版本开放 idle 后代释放；未知或未经验证的版本继续保守保留，原因可从状态详情查看。升级 native 后须重新跑关卡再扩展门控，不用磁盘 package 标签代替正在运行的握手。

独立追加跨 app-server 调度诊断：两版第二客户端均可取得原父 writer，但调度仍由第一实例持有 writer 的旧子 UUID 时，原生返回 `already has an active writer`，子没有新增模型调用或任务标记。父写入权交接不能称为整家族控制交接；同一原实例恢复父会话后继续调度原子线程已经通过。诊断保存在 `native/external-control-diagnostic/{npm,vsix}/`，不修改核心关卡 manifest。产品不会为消除该冲突关闭、停止或释放子 Agent；手动释放 toast 已明确这一边界。

另执行既有 `session-ownership-acceptance.py`，使用本轮编译的真实 TypeScript 运行层、同一个 `0.162.1` binary、私有 HOME/CODEX_HOME/应用数据目录及本地模型。实际 HTTP 操作通过：外部持 writer 时历史只读、发送在 dispatch 前冲突、内核锁确认自动释放、释放/发送竞态、原历史保留、外部持有时分页历史、新线程跨 sweep 保留后首次发送。两独立 native 进程、本地模型调用 3 次、远程调用 0；这是实际运行层链路证明，子家族协议仍由前述双版本关卡和 Ownership 专项分别证明。

## 检查与浏览器结果

以下单测与构建在产品改动冻结后完成；浏览器最终结果合并唯一用例，不重复累计复跑。

| 验收 | 结果 |
| --- | --- |
| 双版本原生兼容关卡 | 12/12 通过；manifest 与实际 binary 哈希匹配。 |
| 真实 TS 运行层 → native HTTP 所有权验收 | 通过；本地模型 3 次、远程 0 次、内核锁与原会话历史确认。 |
| 运行层全量与释放/stdio 专项 | 239/239、36/36 通过。 |
| shared 身份归一化 | 3/3 通过。 |
| 网关 subagents/followups 集成 | 21/21 通过。 |
| 前端身份/输入/缓存专项 | 20 文件 118 项通过。 |
| 访问提示、会话菜单、只读 metadata API | 3 文件 85 项通过。 |
| 实际 HTTP → Node 网关 → 原生 EventSource | 2/2 通过，原传输与物理留存门槛保留。 |
| `pnpm check` | 全包类型检查与生产构建通过；最终仅排版变化另以 canonical 编译输出相同和 web tsc 确认。 |
| `pnpm test` | 4,120 通过，2 条件跳过；无失败。另行 shared 3 项不计入该总数。 |
| 浏览器联动 | 66 个唯一用例通过，1 个默认不开启的 30 分钟长测跳过；其中最终子 Agent 全 15 项通过、新身份/竞态 8 项、ownership 3 项、恢复 6 项、默认 idle 与 transcript 通过。包含上表网络 2 项，不重复累计。 |

全量通过明细：native adapter 29、native host 96、运行层 239、终端 web 559、会话 web 2,185、server 886、脚本 126；native host 和 server 各有 1 条件跳过。

保留首次失败记录：最终菜单新增测试曾使用 undefined reason 违反接口类型，已修正 fixture；全量前端唯一 suite 在收集时发现旧 CC listener 的 runtime mock 缺 buildUrl，改为 partial mock 保留原 CC 断言，定向 2 项和最终全量转绿。未通过删除断言或修改生产行为消除失败。整文件格式操作曾带来菜单重缩进，已仅撤回本任务的格式噪声；基线既有 dirty 内容保留，canonical transpiled JS 一致。

浏览器首批失败保留在 `e2e-acceptance.log`：旧“打开子智能体”入口已被既有 UI 移除，测试改走实际摘要→子详情→返回列表；ownership 初始断言导入无版本的模块，生成第二个空 Zustand 实例，改为读取实际挂载模块 URI；显式 reload 的请求取消仅按时间、read URI 与 ERR_ABORTED 关联分类。最终 35 项首跑为 31 通过、3 失败、1 跳过，其中三项旧 fixture 分别漏原 thread/turn 的完成事件、缺精准 child metadata、将显式不可用 metadata 404 当作未知错误。补齐真实模拟历史/完成事件及精确已知 child metadata；不可用用例仍返回精确 404，并断言发生及零 mutation，只分类相同请求的浏览器资源错误。定向三项和最终子 Agent 15 项全部转绿，原草稿/权限/模型/审批/目标/停止范围断言保留。

末轮对新身份 spec 删除全部 console AbortError、`[vite]` 与全局 ERR_ABORTED 忽略，再次严格复验。初轮 8 失败揭示共享夹具主动关闭 Vite HMR socket，以及页面真实初始化清理健康/config 只读请求；仅为精确同源 `/` 且只有 HMR token 的 socket 透传，业务 socket 仍隔离。只读 fetch 用观测编号关联实际请求与真实 AbortSignal；不添加 header，不改变正文、Promise、response 或 signal，监听在 settle 时释放。已知 cleanup 的编号、URI/method、AbortError 原因、调用来源和取消时间均须匹配；未知源、超时、写请求或其他 console/page/network 错误仍失败。原始请求/取消/错误和分类完整落盘，afterEach 再次检查。最终新 8 项通过（45.9 秒，`e2e-final-strict.log`），其来源替换旧宽过滤结果，不重复累计 66 项。Playwright mock 的 startTime 为 0，因此不以该值猜测并行请求归属。

网络压力保留上游至少 96 MiB、浏览器正文小于 128 KiB、26 个序号连续、审批和最终回复、巨帧命名错误与上游关闭、回收后 heap 增量小于 8 MiB 的原断言。未放宽阈值。

隔离前端通过 HTTPS `https://10.30.0.24:18493/?mode=session`，绑定 `0.0.0.0`；HTTP `18492` 仅重定向。浏览器全部业务 API/WS 使用独立 fixture，真实网络压力使用自有临时 HTTP fixture，均不向正式会话发测试消息。桌面 1440px 与手机 375px检查发送权限、草稿/目标、按需状态详情、不覆盖正文/编辑器、无水平溢出和页面/网络错误。该证明来自本机访问局域网地址，不等于另一台物理手机已验收。

沿用 [内存约定](../session-memory-contract.md)。短时 idle/stream/transcript/governor 与恢复/审批回归不能覆盖此前已记录的长期 renderer RSS 增长问题；本轮不声称长期内存缺陷全部解决，不关闭保护或周期性刷新页面。

默认 idle 首批实测 96.807 秒：可见 heap 169,945,748 B / renderer RSS 合计 502,222,848 B；休眠 62.375 秒后 heap 60,195,452 B / RSS 301,821,952 B；只读重显 heap 140,963,364 B / RSS 630,079,488 B。正文回收、未读/完成、音频空闲归零和草稿/审批保留通过，resume/start/interrupt 为 0、错误为空。该短测只证明既有回收和恢复断言，重显 RSS 高于初始值也保留；不等于 30 分钟自然低点门槛已通过。最终默认 idle 另复跑通过。

最终 idle 自然采样 96.657 秒：heap 161,588,204 → 59,350,364 → 143,485,208 B，renderer RSS 500,576,256 → 307,830,784 → 660,131,840 B，同样保留重显峰值。13 个 spec 的 67 个唯一用例（66 通过、1 长测跳过）、日志来源、8 张最终截图、最终 idle 测量与精确 404 原始证据统一列于 `e2e/acceptance-summary.json`。404 追加证据复跑不重复计数，记录精确 child-atlas metadata 404、对应 1 ms 后资源错误、unexpectedErrors 与 mutationCalls 均为空。

## 复跑

验收结束已关闭本轮自建的 18493 隔离前端，自有浏览器/native fixture 已退出；正式 8484 服务保留。复跑须先重新准备隔离前端，再使用其实际局域网 URL：

```sh
pnpm --filter @agent-orchestrator/session-runtime exec tsx --test ../shared/src/session-subagents.test.ts
pnpm check
pnpm test
python3 scripts/session-subagent-release-acceptance.py --codex /absolute/path/to/codex --output-dir .dev-runtime/subagent-identity-release-20261014/native/recheck
python3 .dev-runtime/subagent-identity-release-20261014/runtime-native-ownership-driver.py /absolute/path/to/codex
PLAYWRIGHT_SKIP_WEBSERVER=1 PLAYWRIGHT_FRONTEND_PROTOCOL=https PLAYWRIGHT_BASE_URL=https://10.30.0.24:18493 pnpm exec playwright test tests/e2e/session-subagent-identity-release.spec.ts tests/e2e/session-subagents.spec.ts tests/e2e/session-ownership.spec.ts tests/e2e/session-message-delivery.spec.ts tests/e2e/session-failed-delivery.spec.ts tests/e2e/session-drafts.spec.ts tests/e2e/session-state-recovery.spec.ts tests/e2e/session-async-questions.spec.ts tests/e2e/session-idle-memory.spec.ts tests/e2e/session-codex-stream-memory.spec.ts tests/e2e/session-transcript-memory.spec.ts tests/e2e/session-memory-governor.spec.ts tests/e2e/session-network-memory.spec.mts
```

证据位于 git 忽略目录 `.dev-runtime/subagent-identity-release-20261014/`：红绿灯日志、native `manifest.json` 和两版 `latest-result.json`、e2e JSON/截图与网络/heap/RSS 测量。纯函数初始审计在原计划中的 `/tmp/ck-subagent-plan-20261014-*`，重要坏结果已经纳入正式测试。

## 正式启用边界

前端源文件可由开发服务热更新。编译后的新运行层不自动替换已存活进程；正式启用须有安全窗口，并用 `pnpm session:status` 核对实例与产物，而不是只看 HTTP 200。部署状态在最终验收后单独记录，不能用隔离通过宣称正式后端已更换。

本轮只读状态核对：正式运行层 PID `2712539`、native PID `2712736` 保持，健康为 ok；观察到 12 个 loaded 会话，其轮次 metadata 均 idle。idle 不能单独证明没有后台资源、goal、交互或未知回执，未据此停止原实例。`pnpm session:status` 明确报告磁盘产物与运行代码不同。正式局域网入口为 HTTPS `https://10.30.0.24:8484/?mode=session`，端口 8484、前端绑定 `0.0.0.0`；本轮后端修复尚待安全窗口启用，未提交或推送。

正式前端源码 GET 确认已经包含本轮 identity/fence 修复，返回 200；它只证明开发服务可提供新源代码，不代替用户已有标签页的刷新/HMR确认。正式实例和源码状态证据分别为 `formal-runtime-readonly-status.json`、`formal-frontend-source-proof.json`。部署或后续升级必须再核对实例、队列、已加载线程与资源，不以隔离测试替代正式安全窗口。
