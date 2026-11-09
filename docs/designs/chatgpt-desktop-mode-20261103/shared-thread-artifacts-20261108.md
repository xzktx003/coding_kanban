# 共享线程的原版目录与发送参数

第四模式共享 Codex 线程沿原版完整 I2 和 SDK 序列化链发送。普通文字首轮及续聊会为允许写入的权限创建线程专属 visualization 目录，再把该目录加入本轮的 `runtimeWorkspaceRoots`；这条路径不等待 `thread/settings/update`。本地 realtime voice 的设置更新是另一条路径。

目录由真实 daemon 的 `codexHome`、固定原模块 38591.CV 的 UUID 日期算法和精确线程 UUID 派生。只有已绑定的八字段 scope、当前账号／daemon／view／项目及执行证明均有效时，才允许原生 `fs/createDirectory` 创建这个目录。宿主不代替 native 创建，不伪造成功或权限错误。真实成功回执和实际目录身份共同形成一次性证明；后续轮次重核身份，不复用过期创建票据。

只允许精确目录，不能借此添加 HOME、父目录、其他线程或任意子目录。文件描述符和目录身份核对是时点检查，不宣称路径原子性。原版 read-only 和 external 权限的完整 I2 实际不读目录、不 mkdir；workspace 和 full-access 才走追加根路径。原生错误保留，失败不自动重发。

原 I2 还生成 `summary`、`personality` 和 `responsesapiClientMetadata`。适配保留原值并检查固定枚举和原 search-context 结构；嵌套 JSON 字符串不重序列化。原 SDK 的 null 默认字段只按固定合同投影，任何非 null `cwd` 和未知额外上下文仍拒绝，不能借发送切换项目。

直接回归位于 `shared-thread-artifacts.test.mjs`、`shared-execution-artifact-proof.test.mjs` 和 `shared-permissions-schema.test.cjs`。完整原 I2 测试须显式提供 `CHATGPT_SHARED_I2_ORIGINAL_DIR` 与 `CHATGPT_DESKTOP_NATIVE_OPTIONS_MODULE_DIR`，固定原件摘要；缺夹具的跳过不计验收。原始 producer、SDK serializer、canonicalizer 和执行证明的首轮／续聊四种权限已验证，不能据此声称真实模型收发完成。

v28 实际启动发现新增 metadata 分支过早接管所有 `fs/getMetadata`，原版启动的非项目路径查询因此撤销 source，尚未打开浏览器或发送用户消息。分流现已修复：已实现的固定 metadata scope 走真实 native 查询，其余保留既有明确 unsupported 能力错误；反例先红后绿，下一条合法查询仍能继续，HOME mkdir 仍拒绝。该轮没有保存具体路径，不能猜测它是 HOME 或任意项目。新候选仍须真实启动及收发，主 HTTPS 8484 继续使用已交付的免密码版本。

v29 真实启动和项目 metadata 查询已通过，创建原生线程 `01a1b882-4652-7143-adf8-371ca4e899f6` 成功。随后 mkdir 的路径摘要精确命中该候选容器的本地 CODEX_HOME 下的 UUID 目录，和真实 daemon 的 codexHome 不同；因此执行域拒绝正确，未发出 mkdir 或用户 turn。原 `jY.readCodexHome` 因共享连接的 local kind 直接取进程 HOME，忽略了 connection 的真实初始化目录。现仅对精确共享 host 调用原 connection.codexHome()；工厂核对同一原 connection、双 registry、当前 source，并在 await 后重核，不回退容器 HOME。普通 local／remote、原目录函数和 feature flag 保持原行为；没有把容器路径追加到 daemon 允许根或改写 mkdir。固定原 jY 和 SDK getter 的反例先红后绿，v30 真实 UI 收发另验。旧页面已关闭，线程保留，没有重发。

v30 已真实创建线程 `01a1b893-05f6-72f1-b1b5-6d134e47cf10`，daemon 真实创建该线程在正确 codexHome 下的目录并返回 `{}`；这验证了 HOME 与 mkdir 链路。之后另一条未登记的原版 `thread/start` 因 `creation-not-registered` 关闭来源，用户 turn 仍为零。当前 trace 只保留字段名，不能据 ephemeral／serviceName 键的存在就宣称已确认它是 ambient 请求。原生日志另有可恢复的标题生成失败，具体原 producer 正在对照；未开放后台写入。页面已关闭，原线程和目录保留。

v31 对固定原 pX→oJ 标题、描述、摘要生成合同提供明确的 `-32601 / SHARED_CAPABILITY_NOT_SUPPORTED` 回执：必须是完整匹配的 ephemeral、read-only、never、空运行根及已知 metadata source。它不创建线程、不运行模型、不伪造成功、不消费普通创建 nonce；未知未登记写入及权限变更仍拒绝。真实自有 WS 的该错误回复后同连接读取可以继续。元数据后台生成仍是完整桌面目标的待办，不能把能力错误当成该功能已完成；实际 v30 请求值缺失的归因限制仍保留。新候选仅增加固定枚举／布尔首因分类，不记录正文。

v31 的实际分类已确认 `ephemeral:true`、`threadSource:thread_title`、read-only、never 和空运行根；错误回执后两个真实 thread/list 继续成功。随后原 fallback 的 `thread/name/set` 被旧门控拒绝。名称写入现只允许真实 native-start-response 的当前八字段绑定；写出及回执均重核原对象、账号、实例、执行与历史权限，名称和真实错误／通知不改写。真实隔离 CLI 已核对 `{}`、`thread/name/updated`、Unicode／空名原错误；原 fallback producer 也已验证。

标题回调不是用户 startTurn 的前置 await。原生日志另确认首轮已在原生输入授权层报 `Shared send intent denied`，当前代码将创建及首消息共用创建时起算的 30 秒。v31 创建意图到实际 mkdir 已超过该期限；修复首消息阶段是独立必需工作，不能仅凭名称写入可用宣称用户发送已修复。v32 基座已合名称路径，等待首轮一次性授权生命周期修复后再运行真实界面，旧失败消息不重发。

首轮现分为两阶段。创建 nonce 仍须在原 30 秒内完成真实创建和绑定；及时绑定后，只有原 `withStart` 调用尚未返回、同一 view／epoch／运行身份仍有效时，才保留其不透明首消息能力。该能力固定点击时的文字、clientUserMessageId（如原来存在）、模型／强度和权限选择，不能借延迟换内容；不刷新 nonce，不因后台或页面恢复建立新能力。真正原 I2 首帧完成并匹配后一次消费，实际授权写入仍限 30 秒，丢失回执也按原界限拒绝。调用返回／抛错、撤销或身份变化即清理；数量预算不增加。

旧创建控制即使仍有对象引用，过期后也不能再用于创建或采纳。这里延续的是同一原调用中已捕获消息的预处理阶段，不把新阶段称为旧票据延长。原 I0 和 rt/rG 对单个中文换行及空 text_elements 的转换已执行验证；独立回归覆盖慢预处理、输入／选择篡改、一次消费、迟到及真实写入期限。v32 已组合冻结并进入真实界面验收，协议回归不代表模型回复已成功。


v32 真实原界面中，mkdir 和 `thread/name/set` 均收到原生成功回执，source 保持存活，用户 turn 仍为零；原生首轮错误仍是 `Shared send intent denied`。固定原 `runtime.prepareTurnRequest` 在 I2 之后必加 `additionalContext.codex_apps_client_time_context`，旧 canonical/schema 拒绝所有非空 context。这是独立必修合同缺口；该轮未保留精确拒绝分支，不宣称它就是已观测的唯一首因。

现只接受该固定 application 键、原 timezone/date 模板和有效日期，保留原字符串及冻结结构；其他键、kind、字段或模板仍拒绝。完整原 I2 → runtime.prepareTurnRequest/Rq → automation/r7 DTO → rt/rG → canonical/schema → 首轮及续聊权限证明已执行红绿验证。额外原件通过 `CHATGPT_SHARED_RUNTIME_ORIGINAL_DIR` 提供并逐件校验摘要。v33 继续实际原界面完整收发验收，不能以此协议回归代替真实模型回复；8484 免密码版本不因此替换。

v33 再次真实创建共享线程 `01a1b8cc-0f31-7ca1-a041-73d52323714a`，mkdir 和 name/set 的实际回执均成功，用户 turn/start 写入仍为零。私有首错现在精确定位 `canonical-frame / first:true`，说明时间上下文修复尚未完整覆盖实际请求；页面已关闭，未重发。固定原 runtime 还存在调用 inner prepareTurnRequest 后再执行 RL 的外层钩子，正在核对该原链与实际拒绝位置。下一候选只增加私有静态校验站点证据，不通过关闭原 feature flag 或允许任意字段掩盖错误。

v34 私有静态站点已定位真实拒绝在 submission 原行25：非空 `cyberAccessProgram` 实际是 string，时间上下文存在，`codex_git_state` 不存在，另有两个原 additionalContext 键（仅计数和摘要已保存）。真实共享线程 `01a1b8da-3753-7d03-8f76-8cbd888fb2b1` 的 mkdir／名称写入成功，用户 turn/start 仍为零；其他线程的 completed 不能当作共享回复。该证据推翻以 Git 上下文解释本次错误的推测。Git 原合法分支独立支持继续实现；当前修复转向实际 cyber/context producer，未知真实键不能靠放开任意 context 绕过。自有页面已关闭，未重发。

实际两个未知键已从固定 early-bootstrap 的 module72837 解出：`codex_apps_open_page_instructions` 与 `codex_apps_open_page` 的排序 NUL 拼接摘要精确等于 v34 保存的 e66ca9ed…；它们对应无 Page 普通对话的 application 固定指令和 untrusted `page_id:null` JSON。这个结果来自原键字节对照，不是基于 Git 分支推断。原 x8/x9/rC 的合法 cyber 枚举独立确认为 standard/daybreakBlue/daybreakRed；仍须交实际 daemon 做原生账号准入，不能用本地枚举推导 entitlement。当前正把真实已见组合纳入完整原 producer 回归，暂未声称真实共享回复已通过。

最终组合适配保留三种原 cyber 程序枚举、原 k/O/E 无 Page 构造对、时间上下文和原 RL/xZ 有界 Git 元数据，其他原未知上下文仍拒绝。无 Page 指令和 JSON 原串保真，非空 Page 暂不支持；程序枚举不代替账号 entitlement，真实 daemon 的拒绝仍返回。完整原 constructor → I2 → x8/x9/rC → inner/outer runtime → r7/DTO → rt/rG → 分阶段首发和独立续聊的原函数已执行；文件、配置、账号边界仍使用独立测试夹具。实现不改变真实账号目录、模型／权限选择或原开关。该协议证据不能代替 v35 的真实共享模型回复。

v35 合并最终字段适配后，真实创建共享线程 `01a1b8f1-1582-75d2-8d9f-ed07167b6752`，但浏览器在 portPost 2427 发生 BRIDGE_OUTCOME_UNKNOWN/request_timeout，继而来源撤销；尚无共享用户 turn/start，未到新 canonical 拒绝点。因此本轮不能声称字段修复已经过真实模型验证。创建回执交接47ms、binding 处理194ms／写入43ms已保留，超时请求与回执消费的因果关系正在核对。自有页面已关闭，失败消息不重发，8484 免密码可用版本保持原样。

针对 v35 的新桥接阻塞，已确认原 MessagePort postMessage 和 return 是同步交接，不等待工具或模型；原 SDK 首次 MessagePort close 错误出现在浏览器超时之后。现有记录缺少请求2427的 native 投递/return 位点，不能归因于具体业务 handler。v36 只增加私有同 id 的四点、宿主 decoded/subscriber 元数据，以及原网关关闭 warning 的首条固定原因；候选原 logger:false 曾吞掉后者。所有日志不包含消息/账号/上下文值，不改变原守卫、调度、超时或预算；无已证实产品修复前不宣称桥接已恢复。

v36 同 id 记录已证实普通 portPost 同步返回后，在宿主读取／转发前等待数秒；v37 再次在 portPost 2424 超时，已观察末批浏览器数据均发出对应 ACK，但不能把浏览器 send 当作服务端已消费。自有页面均已关闭，失败消息不重发。独立真实 Unix 输出测试仍按八帧批量交接，未复现此前猜测的单帧批次退化。

v37 在首发期间做了有界、无调试网络端口的 Node 自身 CPU 采样。关闭前约 23 秒内空闲仅约 0.73%；主要成本为同步文件读取、lstat、readlink，daemon 监听身份核验的全 FD 扫描尤为明显。该轮 broker 单次核验最高约 26ms，不能解释数秒停顿。当前修复因此收窄为身份核验算法成本，保持实际发送前的所有授权和身份检查；固定 daemon 的只读测量显示 222 个 FD 中第 34 项已命中监听 socket，找到后继续扫描其余 FD 没有增加“存在一个匹配 FD”的证明。优化及真实共享回复仍须独立验收，8484 的免密码原版入口继续保持。

监听 FD 首命中结束扫描已合入，真实 Linux FD 与受控错误回归均由旧红转绿。v38 真实创建共享线程 `01a1b926-64c9-7f51-9295-097da9b38966` 后，首发仍在 `sendMessageFromView` 调用2413超时；用户 turn/start 为零，自有页面已关闭，未重发。新采样最后七秒中仍有约六秒位于 guarded 通知派发，说明这一小优化不足以修复完整链路。进一步实证发现账户层在同一调用中重复执行已有内部完整核验，下一修复仅允许真实冻结对象的进程内品牌证明省去紧邻的外层重复计算；未知对象、delegate 后检查和实际写前核验仍保留，不缓存校验结果。

同栈重复核验合并已通过真实 observer／内核读取及撤销反例并合入。v39 的真实原生新线程为 `01a1b931-fa01-7661-9e61-9c5b86e73af3`，该 UUID 被 WS 观察到；等待期间没有桥接丢线，仍未通过 DOM 目标／composer 结束验收，不能称为页面绑定完成。用户 turn/start 为零，当前精确首因已推进到 `copyClientMetadata` 原行20的顶层形状检查，Page／时间上下文没有未知键。原 normal composer 的固定 OTs 还会注入 `source:'codex'` 与 `client_type:'desktop_app'`，此前 schema 没有接受它们。现对照完整原 producer 修复；自有页面已关闭，原消息不重发，8484 保持原免密码版本。

普通入口元数据修复已合入：只保留 OTs 的两项固定值、原有界 string-map 消息来源及 SDK nw 的已知 UUID 安装标识；其 JSON 允许仅安装标识或与 search-context 共存，原搜索限制和原 JSON 字节保持，未知键仍拒绝。完整原 OTs／安装 ID 生成／I2／nw／DTO 到首发及续聊均已执行验证。非 null nw 首次测试曾因夹具缺少 record-schema 依赖而被原 best-effort catch 吞掉，首次红灯已保留，现已补齐显式库边界而未改原 nw。复验继续使用原 I2/options 环境；`CHATGPT_SHARED_RUNTIME_ORIGINAL_DIR` 指向包含这些固定原函数的夹具目录。v40 只机械更新私有拒绝站点与既有 schema 摘要，不增加原包依赖、复制项、权限或预算，继续真实 GUI 收发验收。

v40 真实原界面再次在更早的 `sendMessageFromView` 调用2394超时；线程 `01a1b946-1f76-7301-a724-3d0d22269141` 已创建，尚未走到元数据校验／用户 turn/start。浏览器最后序列4100，随后断线；新 CPU 采样和首因已保留，自有页面已关闭，未重发。这证明 v39 的单次不丢线不足以宣称共享链路稳定，当前继续修复首发同步核验开销。8484 仍是已验证的免密码版本，未换成这些失败候选。

v41 将 provider 同栈的额外 daemon 核验合并到原账户 reader 的完整实时检查。reader 只由真实冻结 observer 支撑的账户工厂登记，品牌绑定精确 observer、native generation 和 profile；可信 source 装配只接入原函数一次，不能凭同修订数值、包装函数或新工厂重绑。coordinator 保留原函数而非创建失去出处的包装层；每次仍检查当前账号、容器与 daemon，异步后及真正写前的复核保持。旧调用没有 profile 时继续使用原检查路径。独立真实 Unix／内核读取反例已验证跨 scope、同值撤销和写前变化仍拒绝；`native-account-revision-reader-scope.test.mjs` 无额外环境变量。原私有诊断及静态 schema 摘要保持，v41 继续真实界面验收。

v41 实际创建线程 `01a1b95a-d894-7b70-b683-7f12d98c2efe`，名称写入成功，原调用正常返回且桥接未断线，但用户 turn/start 为零，DOM 目标与 composer 结束条件仍不满足。完整原 `startConversation → ID/ep` 回归已确认，正常 resolve 也可能表示 `firstTurn.not-started` 或 `outcome-unknown`，不能把它视作消息已送达。新增 `native-shared-original-first-turn.test.mjs` 使用 `CHATGPT_SHARED_FIRST_TURN_ORIGINAL_DIR`、`CHATGPT_SHARED_FIRST_TURN_EXPECTED` 和 `CHATGPT_SHARED_FIRST_TURN_MODEL_SETTINGS` 显式固定原件及自有输入；其余服务为明确夹具，不代替真实 I2／SDK 和模型验收。

v42 合入[普通 WS FIFO 调度修复](shared-normal-ws-fifo-20261108.md)，并仅在私有候选观察原调用的真实结果。实际线程 `01a1b979-07ba-7aa2-ab09-d0ac2149c0f8` 返回 `created / firstTurn.outcome-unknown`，不是 accepted；原 ID 的第四个回调赢得 Promise.race，底层 await 可能仍在途。观察窗口没有用户 turn/start／thread/inject_items 写出，原生 rollout 也没有首轮或回复，桥接未断线。自有页面已关闭，原任务、线程和数据保留，未知消息没有重发。下一步定位原 SDK unknown 回调的实际触发点，不能把零轮次当作允许重试的回执，也不据这一轮宣称共享模型链路完成。主 HTTPS 8484 继续使用已交付的免密码版本。

v43 的私有实际首因记录为 `dispatch-catch / turn/start / shared`，入队及 dispatch 后均约 1ms 抛 `TypeError`，观察窗口仍无原生用户 turn 写入。记录位于 `/data01/home/xing.hu/.cg-shared-v43-3i5y20ye/b/private-shared-dispatch-first-cause.json`；catch 站点本身不等于 throw 栈。完整固定原 SDK 的严格模式 closure 回放进一步定位：SDK 无条件执行 `e.params = nw(...)`，即使 installation ID 为 null、原参数不变，给冻结顶层对象赋值仍同步抛错。

修复仅在共享 `turn/start` 的 SDK 交接边界生成可变顶层 envelope；内部 canonical 授权快照及嵌套 `params` 继续冻结，实际写前仍核对精确帧。`native-shared-original-sdk-envelope.test.mjs` 执行完整原 sendRequest closure、nw、rG／rt 及真实共享 connection.send，旧实现红、新实现绿；独立 actual writer 回归确认已授权同一安装标识保真，授权后新增／替换标识及输入、权限、线程、scope 漂移均零写入。私有红绿和最小补丁保存在 `/data01/home/xing.hu/.cg-sdk-envelope-yjlex88u`。这不改变权限、预算、期限或未知回执不重发规则。

v44 修复后，真实原生 `turn/start` 已接受并完成。只读 native helper 验证 `ONE_TURN_EXACT`：线程 `01a1b9a0-1cd0-7121-8c75-2e760d2649ce`、轮次 `01a1b9a0-ae58-70a3-b687-dcd9ad8c9bcd`，真实模型 `gpt-6.1-sol`，cwd 正确，首条输入逐字匹配（允许原版单个尾随 LF），精确 marker 回复一次，工具调用零次。但后续合法 hook 的 started／completed 通知尚未分类而被拒绝，source 断开，原页面未满足正确唯一目标、composer 清稿及 busy／Stop／Queue 结束的完整验收，续聊也未通过。该结果只证明真实共享原生首轮，不能称为可用 GUI 完整收发；原消息不重发。主 HTTPS 8484 免密码入口继续在线，未切换为 v44。

v45 已补齐当前 CLI 0.166 的两类合法 hook started／completed 通知，按原 hook run 严格 schema 校验有符号数、可空字段及原生枚举，原文本保持，不补造默认成功。通知沿对应线程既有 follower 转发，不获得执行写权限；未知通知仍拒绝，原预算及账号／线程边界不变。实现和独立 native WS 回归已合入，v45 实际也已通过多次 hook 通知。主 HTTPS 8484 未替换，原消息不重发。


v45 的只读原生核验为 `ONE_TURN_EXACT`：线程 `01a1b9ab-8d80-71e2-bc60-011e30d85d39`、轮次 `01a1b9ac-2193-72e1-a2ec-51affab5e39b`，真实 `gpt-6.1-sol`、正确 cwd、精确 marker 回复及工具零调用。source 在收到 20 条 agent delta 后，唯一首拒为第169条 `turn/moderationMetadata`；后续 completed／readState／goal 不是首因。自有页面已关闭，原消息未重发。

现补齐固定 CLI 0.166 的该只读通知：必需外层恰为 `threadId`、`turnId`、`metadata`，保留原 `JsonValue`（包括 null、标量、数组和对象），不遍历或解释正文、不派生指令或写权限。当前线程绑定过滤、原 follower FIFO／字节预算、账号撤销及未知通知拒绝保持；定向和真实 Unix WS 回归已先红后绿。v46 已实际通过该通知和完整浏览器 WS 链路，但 GUI 结束条件仍未通过，见下方草稿绑定首因；主 HTTPS 8484 免密码版本未替换。


v46 原生只读核验 `ONE_TURN_EXACT`：线程 `01a1b9b5-466b-71e2-9549-edf3a3856cee`、轮次 `01a1b9b5-b90c-7490-ba99-da486bbc1862`。连接、hook／moderation 及同线程浏览器 WS 的 item／turn completion 均通过，GUI 150 秒仍空白。真实 Fiber 定位同 client 的 local／shared 两条 null-conversation 草稿触发 `SPLIT_PANE_AMBIGUOUS_CLIENT`；两个 sourceSet 交集中的 presentation source 已确认严格为同一对象，原生返回与共享 manager 注册没有缺失 host。

草稿修复仅在同 client 且原 presentation source 对象相同的宿主切换中，复用原 key/context 迁移并撤销旧 owner；原 created promotion 不改，跨 source 仍拒绝。独立边界和固定原 Se＋WLt／RLt＋React 回归已先红后绿。v47 已运行并仅首发一次，真实 GUI 两轮、唯一目标、composer 清稿及 busy／Stop／Queue 结束仍待验收；8484 免密码版本在线未换，原消息不重发。

v47 实际已越过草稿重复阻塞：原创建 binding 在 `1794118379239` 成功交付，`1794118398447` 继续请求真实 `queue/list`；gate 缺少此 readRequest 分支，在第 667 行以 `SHARED_DAEMON_DENIED` 拒绝，用户 `turn/start` 写入仍为零。新的私有无登录 CLI 0.166 stdio 已确认方法存在，未知 UUID 返回原错误 `-32603`、非法 UUID 返回 `-32600`，不能用空队列代替这些结果。现已补齐只读 shape、threadHistory／cursor 与原错误保持，原分页生产者与真实隔离 Unix WS 已验证。v48 的一次真实点击停在原客户端创建调用之前：原 pending client route 已出现，registry 为单条 shared 草稿且 scopeReady；150 秒后用户 thread/start、turn/start 和 queue/list 写入均为零，连接及来源未断。已有 ACK／finished 阶段未记录 accepted 值，不能据此判断授权拒绝；mounted guard 位于 pending route 之前，已排除。保留现场且不重发，正在核原 N 调用前的上下文加载；共享 GUI 两轮仍未通过。主 HTTPS 8484 继续使用已验免密码版本，原消息不重发。

v49 新增实际边界：原创建 intent ACK 为 `accepted:true`（`1794120618297`），原宿主 `withStart` 入口也已进入（`1794120619019`）。150 秒后仍无用户 `thread/start`／`turn/start` 写出、无原创建完成回执，连接和来源未断；因此不能继续归因为前端未调用或 scope 拒绝。下一停点在原宿主创建准备链内，正在核固定原 IM／IO／xR／k9 的实际 await；不改 feature flag、不放宽权限、不重发本次消息。v48／v49 均只关闭自有页面，原任务、空线程与主 8484 保留。v49 仅私有最小观察改动，共享 GUI 两轮仍未通过。

v50 私有分段已实测排除 IO／人格／principal／authMethod／identity、renderer inputs、requirements 和 dynamic tools：均已完成，最后为 `shell_environment_started`（`1794121921211`）与 `instructions_started`（`1794121921212`），未见对应结束，用户创建／turn 仍零写出。两条原函数都经 `requestGitWorker` 读取，共同下一边界是原 worker main RPC 的 shared host 客户端获取。worker 进程仍存活，日志的 git watch EMFILE 不能证明它已退出。已精确重核后停止 v28–v32 五个旧 revoked、任务计数全零的自有夹具；未删除目录／历史／容器，未改 sysctl，未触及 default daemon、8484 或 v50。回收后同一 Git 目录只读 watch 可打开并关闭；原创建阻塞仍待验证，不据资源恢复称收发通过。

v51 环境对照已实际越过阻塞：同产品／私有观察字节，清理旧夹具后新 worker 无 EMFILE，shell／instructions 完成并创建共享线程。真实 `gpt-6.1-sol` 首轮已同时通过原生精确消息／回复、零工具调用与原版 GUI：线程 `01a1ba0c-a9db-7640-966a-2d7f5699464d`，turn `01a1ba0d-55e7-7ed3-95f9-8b6006c46a7a`，唯一目标、composer 清稿、Stop／Queue 结束均成立。随后无注册手势的 `thread/resume`（seq96，`1794122843764`）在 gate 第 662 行拒绝并撤整源，第二条消息尚未提交；不能称连续双轮通过。该拒绝帧的 threadId／实际原 caller 未保留，不能断言是当前线程或 ambient。正沿既有能力负错误机制修复“拒绝未授权 resume 时断开主对话”，无手势 native resume 仍不得写出。首轮及原线程保留，8484 已验免密码版本未替换。

恢复错误边界修复（v52）：gate 只在 desktop ready、没有 registration、读身份仍有效且请求是完整既有 canonical／固定 SDK DTO 时，沿既有有界能力错误通道返回 `-32601` 与 `SHARED_RESUME_INTENT_REQUIRED`；原请求不送 daemon，不生成 binding。存在 registration 的原恢复校验与写前证明不改；未知 shape、未知方法、撤销及投递失败仍按原保护处理。固定原 FL／SDK DTO 和 C_ 验证错误完整到 caller，随后原普通 turn 可经真实品牌授权写出；这是原函数合同，实际 v51 的调用方／UUID仍未知。v52 真实运行已确认该策略错误完整返回原调用，连接保持，未发出 native resume；实际请求使用当前线程 UUID，但不据此推定其原调用方。


v52 原生与原版 GUI 首轮均通过：线程 `01a1ba20-11f8-78e0-8a35-6183ea6863cc`，turn `01a1ba20-c3fe-7392-b8e7-e218a24abac8`，真实 `gpt-6.1-sol`、精确 marker、工具零调用。随后 `thread/read`、`thread/turns/list` 均真实往返，`thread/readState/update`（seq99，`1794124149977`）因 gate 缺少合同在第 723 行首拒并撤源；第二条 `attempted:false`，未发出新 turn，原消息不重发。

现按固定 CLI 0.166 合同真实转发阅读状态 CAS：仅当前八字段 history 绑定线程可提交 `{threadId, expectedRevision, operation:{type:read|unread}}`，严格核对原 `readState` 回执，保留原 revision 与冲突错误。它是已读／未读元数据写入，非纯读；与执行偏好分离，配置偏好变化不扩大也不撤掉仍有效的 history scope，账号／view／线程失效则写前和回执前拒绝，不 resume、acquire 或改变模型／工具权限。对应 changed 通知继续复用已有线程 follower。直接 gate、真实隔离 Unix WS 和完整原 xI producer 已先红后绿。v53 已运行，真实 GUI 续聊仍待验；主入口未切换为共享候选。

v53 再次停在 shell／instructions，原 worker 日志在点击前 38 秒记录 EMFILE，同 UID 独立 Git 只读 watch 也失败。关闭唯一测试页面后，按精确进程／容器身份和空闲任务核对回收旧自有夹具；目录、历史及共享 daemon 保留，watch 随后可打开关闭。未修改系统上限，也不据单条 warning 断言原 RPC 永久挂起。v53 用户创建／turn 写出仍零，原待发送页面不重开。

v54 同产品字节已真实完成首轮：线程 `01a1ba37-575e-74f2-b045-f7cb0fe96c8b`，turn `01a1ba37-fd02-7d60-aa6b-b06fc6c236a2`，`gpt-6.1-sol`、精确 marker、工具零调用；原版 GUI 唯一目标、清稿及 Stop／Queue 结束均成立。`thread/readState/update` 在 `1794125665557` 写出并于 `1794125665673` 收到原 `readState` 结果，连接未断。随后真实续聊点击 `1794125668044` 已有 intent ACK 与 consume-matched，但 native 仍只有已完成首轮；私有首拒在 `1794125673527` 记录 `no-first-context / first:false`，精确表示普通 sender.prepareRequest 缺少 AsyncLocalStorage 上下文，不能用默认上下文或线程 ID 补授权。第二轮 150 秒未完成后已关闭自有页面，原线程保留、不重发；正在修复原排队续聊的逐次授权传递。

续聊修复（v55）：固定原 w7／xU 会将 prepare 存入队列，由发送手势以前注册的 execution.readinessChanged 回调执行；实测当时 withSend 仍 pending，故问题是执行链上下文缺失。仅对本次原 prepare 成功返回的 exact start 对象登记进程内 WeakMap 品牌，在固定 c23 唯一 host.start 调用处恢复同一仍有效的 v；复制对象、线程 ID 或消息 ID 均不能恢复能力。原三十秒期限、账号／view／binding、claimed、撤销、清理和最终原生写前核对保持。原函数、最终受检摘要与实际 bootstrap→integration 接线均验证，未知 start 仍沿原路径并由既有末端授权约束；v55 已启动，真实 GUI 两轮另验。

v55 真实首轮通过：线程 `01a1ba54-a6ed-7bb2-a3f9-9d868292c8a3`、turn `01a1ba55-4070-7503-87b0-2b7a206d02b5`，GUI／原生精确 marker、零工具、唯一目标及清稿均成立。第二次点击 `1794127572179` 后，原 Composer 在 `2026-11-08T08:46:13.591Z` 记录 `SHARED_SEND_INTENT_DENIED`，无旧 no-first-context 记录，来源未断、原生仍仅首轮。原 ROP callback 返回非 native Promise 的 RpcPromise，旧 boundPrepare 用 native-Promise 判断后提前把句柄送入 binder，造成拒绝。现只改为按原 w7 语义 await 回调结果，再绑定同一授权；真正原 hEs/mEs＋ROP 返值红绿已到原 start 交接点，未补造 I2 字段或 native 成功。无 start 的 steer-only 返回本来可接受，不是根因。v56 私有首错新增有限 bind/run phase，仍用原 wx 0600 小文件、不落正文；授权期限、原 c23 摘要及固定依赖保持，真实双轮另验。

最终核心交付：v56 已在独立预览与主 HTTPS 8484 分别通过真实 GPT-6.1 Sol 同线程两轮，原生精确回执与 GUI 正文／目标／清稿／Stop、Queue 结束共同通过。主入口为零 Cookie、零密码框，旧 tuple 静态资源仍 200；没有停止默认 daemon 或旧 native。详见[主地址操作、身份、证据和验收范围](main-shared-core-20261108.md)。
