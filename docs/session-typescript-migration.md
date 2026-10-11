# 会话运行层 TypeScript 迁移

## 目标与完成标准

用户授权将会话模式全部迁移到 TypeScript。最终由 `packages/session-runtime/src` 的独立 Node 进程承担当前自有 Rust 运行层的全部职责；前端、网关、CLI 原生登录目录和协议行为保持兼容。Codex、Claude、ACP CLI、PTY、SQLite、语音推理等外部程序或原生依赖可继续使用，不能用保留自有 Rust 服务做代理的方式宣布迁移完成。

全部现有 HTTP/WebSocket 路由、数据格式、后台任务和生命周期规则都在范围内，包括低频与 UI 暂时隐藏的接口。`route-contract.json` 记录迁移开始时实际 Rust 路由的方法、路径和处理函数；不能以注册路由、返回空结果或兼容错误代替功能实现。现有 `UPSTREAM_ROUTES.json` 含历史解析污染项，不能直接作为实际路由全集。

## 迁移顺序与进度

- [x] 独立 TS 包、配置、健康检查、HTTP/SSE/WebSocket、事件重放、待审批快照、JSON 配置存储及协议传输基础。
- [x] Codex：原生进程发现/初始化、只读历史、写入权、轮次/目标、审批/提问、子 Agent、回滚、账号/配置/模型/MCP。
- [x] Claude：进程/SDK 适配、权限、会话恢复/历史、设置/MCP、用量。
- [x] ACP：连接、串行会话创建/加载、流式消息/图片、权限、模式/模型/配置、安装发现和持久历史。
- [x] Bots、协作 MCP、自动化调度与运行记录、SQLite 无损兼容及显式导入。
- [x] 文件读写/检索/监听、Git/worktree、终端、技能/市场、统计、语音、配对、休眠、发布及遥测。
- [x] 启动/构建/状态/进程归属迁移；默认新启动不再编译或启动自有 Rust。
- [x] 移除被替代的自有 Rust 实现及 Cargo 构建依赖，保留上游来源/许可证及 Nucleo MPL-2.0 通知。
- [x] 全仓检查、代表性协议差分、旧数据升级、原生 CLI 隔离验收、LAN 浏览器回归与内存防回归；未实测的外部设备/云能力在下文单列。
- 运维后续（本次未执行）：在单独授权的活跃 Agent 安全窗口切换正式运行服务，核验实例与已测试产物一致；源码迁移和默认新启动不要求隐式终止旧进程。

开始实施时工作区干净。现有 Rust 源码约 24,009 行（含测试）。迁移期间保持已运行服务；TS 验证使用独立端口、`SESSION_DATA_HOME` 和 CLI 数据目录。未迁移的模块明确保持待办，整个目标持续有效。

## 必须保留的验收边界

1. 网关热更新复用独立运行进程；关闭页面、标签或工具面板不停止 Agent。过期 PID、异仓库服务和未知端口不能被终止。
2. HTTP/JSON、错误状态、SSE/WS 序号/过滤/重放与既有消费者兼容；审批/提问独立于有界重放窗口保存，回复校验实际 thread/request/turn/item/实例，迟到和重复回复拒绝。
3. 原生历史读取不 resume、不获取写入权。执行/中断/自动卸载分别遵守 `session-ownership.md` 与 `session-subagents.md`。
4. `SESSION_DATA_HOME/.codexia` 数据可原地读取；显式导入事务化、去重，不复制 CLI 登录凭证。失败不能用默认值覆盖损坏记录。
5. 保持 `session-memory-contract.md` 全部边界：浏览器前裁剪、事件驱动历史恢复、相同快照不通知、有界正文和大字符串释放。新增运行层缓冲还须同时限制条数和字节数。
6. 所有后端路径、主机和命令参数校验；命令以参数数组启动。协议断开/超时后，可能已提交的操作标记为交付未知，不自动重发。
7. 测试先红后绿，检查覆盖实际协议行为；全量完成必须核对每个路由与后台职责，并完成真实 HTTP/EventSource/浏览器和原生 CLI 验收。fixture 或单测通过不能代替正式实例切换证据。

## 验证命令

实施期间单独使用 `pnpm --filter @agent-orchestrator/session-runtime test`、`check`、`build` 验证 TS 包。`pnpm session:build/check/test` 已指向 TS；`session:clippy` 保留兼容命令名，实际运行 TS 类型检查。根命令、AGENTS、启动指南和架构文档同步更新。已有运行进程的切换与磁盘构建分开验收。

## 2026-10-10 首批实现证据

- 实际 Rust router 的生产定义提取出 **208** 个方法/路径；`route-contract.json` 保留其处理函数归属。`pnpm --filter @agent-orchestrator/session-runtime run audit` 创建隔离实例并检查注册状态：**23 已注册，185 待迁移**，当前按预期退出 1。这仅是接口存在性审计，不能证明完整行为兼容。
- 已实现健康、设置 GET/POST、SSE/WS、文件系统全部 14 个路由、终端 4 个路由。新增运行服务尚未成为默认启动入口。
- **22 项回归通过**，每组先运行失败用例再补实现：事件过滤与单调序号、重放/实时交界、独立待审批快照、完整身份校验与一次认领、完成/删除清理、按条数和字节限制缓冲、慢消费者断开、原子 JSON 保存与损坏保护、分片 UTF-8/乱序 JSON-RPC、原生进程退出/超时/超长帧、真实 HTTP SSE / WebSocket、文件读写/二进制/大小与路径边界、忽略规则/模糊查找、监听引用计数/目录数量限制，以及真实 PTY 输入、Unicode 输出、resize 和自然退出清理。
- TS 包类型检查/构建以及根 `pnpm check`（shared、后端、前端类型检查与生产构建）通过；Vite 仍提示已有混合导入与大块资源。新源代码未依赖 Cargo。原生进程测试只创建测试子进程和临时文件，不连接用户正在运行的 Codex/Claude/ACP。
- 文件监听新增 `fs:watch-error` 诊断事件，使用与 `fs_change` 相同的 `fs` 命名空间；动态新增目录仍受监听数量上限约束。JSON-RPC 超时或写入后断开返回 `DELIVERY_UNKNOWN`，不自动重发；发送前拒绝使用 `NOT_SENT`。
- 路径搜索保留逐词 fuzzy、名称 substring、smart case、常见 Unicode 规范化和忽略规则；TS 使用独立评分实现，**与 Nucleo 的完整排序差分仍待验证**。Git worktree/global-ignore 特殊布局也需加入后续差分。
- 待做：其余 185 个路由及后台职责、SQLite 兼容、全量新旧协议差分、原生 Agent/浏览器验收、启动命令切换、删除被替代 Rust、正式运行实例切换。当前通过的 HTTP/PTY 测试不替代这些要求。

## 2026-10-10 并行迁移整合证据

- 六个 Agent 分别迁移 Claude/配置、ACP、Git/搜索、SQLite/Bot/自动化、技能/启动、平台能力；主线程负责 Codex 协议/执行权/服务整合。**208/208 方法与路径已实际注册**，不使用 Rust 代理或占位响应。
- 首轮整合 **137 项 TS 测试通过**；后续缺项审计持续补测，包括启动时未监听不调度、失败构造清理、大工具流与任务状态订阅。全仓首轮 `pnpm check` 通过；`pnpm test` 覆盖终端前端 531、会话前端 1509、后端 782 通过/1 平台跳过、TS 运行层 137、脚本 110。最终变更后的结果另行更新。
- 原生 **Codex 0.162.1** 在临时应用与 CLI 数据目录通过 ownership、subagent `--v2 --questions`、`--v2 --approvals`：同 ID 执行权、外部占用只读、发送/释放竞态、空新线程、真实子线程创建/中断、主线程提问、子线程审批、过期身份拒绝。三个用例分别使用 3/5/4 次本地 Responses 模型响应，远端模型调用均为 0，不读取用户登录。
- 默认新启动为 `node packages/session-runtime/dist/main.js`；manager 用启动锁、原子 identity、PID/命令行/instance 与构建指纹核验。存活 legacy 实例继续复用，健康失败/归属未知拒绝第二份。`pnpm session:status` 现场仍报告复用旧实例，因此不声称正式切换完成。
- 搜索实现与当前 Nucleo 0.3.1 原生参考核验 6400 个 ASCII/Unicode 评分零差分、14 组文件排序，以及矩阵阈值后 greedy 分支、ignore 类型优先级/大小写、linked worktree。测试不需要 Rust；Unicode 表保留 MPL-2.0 通知，不能把有限语料称为完整数学等价。
- Claude 使用官方 SDK 0.3.296，可用 `SESSION_CLAUDE_BIN` 指定外部 CLI；隔离 fixture 验证连续轮次、stream-json、权限和只读 JSONL 历史。TOML 保留未知字段与 `.bak`，格式及注释会规范化；provider 环境密钥保存在应用隔离目录且只影响新进程。
- 语音在本机 Codex ChatGPT 登录可用时走 realtime transcription，失败或未登录时使用外部 whisper.cpp CLI，`SESSION_WHISPER_BIN` 指定程序；统计扫描在 worker 内执行，休眠锁按会话引用并确认原生握手。真实 Whisper 模型推理、各桌面操作系统休眠和真实云发布未运行；Codex 转写用本机登录对一段 “hello” 录音返回了文字。其余用例使用隔离 CLI/HTTP fixture。
- 浏览器在独立、绑定 `0.0.0.0` 的前端执行内存/恢复/审批回归；结果待最终收尾。旧 Rust 删除与现场实例切换仍有独立完成边界。

### 收尾审计与旧源码移除

- 已移除 134 个受版本管理的旧文件（122 Rust 源文件、10 Cargo TOML、Cargo.lock 和原 provider JSON）；删除前核对这些路径无其他未提交修改。`target/` 中既有运行二进制未删除，存活服务不受源码删除影响。保留 `LICENSE`、`UPSTREAM.json`、`route-contract.json`，新增 `THIRD_PARTY_NOTICES.md`；外部 Codex CLI 仍可以是 Rust 程序。
- 补齐 standalone CLI 的 `--web-port` / `--remote` / `--allow-origin` 与 CORS/OPTIONS；远程模式沿用 Tailscale 检测，实际 API 仍校验设备令牌。
- Claude 列表读取持久化元数据缓存，变更才启动 SDK 扫描；全局 `includeWorktrees=false` 恢复原筛选。扫描限 1 万目录/10 万记录，超限显式错误，不做空闲正文轮询。
- 完整历史和回滚补读受 256 页、10 万 JSON 节点、32 MiB 编码字节、128 层预算限制，超限明确返回 413 并提示分页接口。已成功回滚后的读取失败明确提示不要重复回滚，不能静默截断。
- 自动化内部订阅在入队前过滤工具增量并投影完成元数据，完整工具协议仍保留给其他消费者；不再因大工具帧而永久停止记录后续完成。

- 大批 SQLite 导入和预览计数已放到独立 worker，保持整批事务、取消回滚与事件重复次数。8,000 条记录隔离测试中，主线程心跳从旧实现 3 次增至 65 次、最大间隔约 8ms；这不是浏览器 RSS 测量。WAL 保证读并发，但 SQLite 仍串行写，导入时并发主线程同步写可能等待 busy timeout；未通过丢弃事件或降低超时掩盖该限制。

## 最终源码迁移验收（2026-10-10）

- 自有会话运行层已全部改为 TS/Node，默认构建与新启动不需要 Cargo；208 个方法/路径实际注册，旧自有 Rust/Cargo 文件已移除。外部 CLI 和原生依赖不计为自有 Rust 回退。
- 最终 `pnpm check`（shared → TS runtime → server → web）通过；`pnpm session:test` **166/166**，脚本 **113/113**，frozen lockfile 校验与 `git diff --check` 通过。前述全仓单测的前端/后端结果保持有效，后续改动限定运行层、启动脚本与文档。
- 独立前端绑定 `0.0.0.0`，以 **HTTPS `10.30.0.24:59207`** 运行既有 52 项内存/恢复/子 Agent/异步问答/消息交付浏览器测试，全部通过。早期 HTTP 尝试因非安全上下文缺少 `crypto.randomUUID` 失败，切换既有产品要求的 HTTPS 后转绿，未改产品前端或放宽断言。测试服务随后关闭。
- 新增 `tests/e2e/session-typescript-runtime.spec.mts`：真实 TS 服务 → Node 网关 → LAN 浏览器原生 EventSource，补测 **1/1 通过**，合计 **53 项浏览器回归**。上游 100,670,177 字节，浏览器 6,469 SSE 字符、最大帧 325 字符、26 个连续序号，审批完整身份、最终回复、重连待审批快照全部保留；GC 后 heap 增量 26,004 字节，运行层重放保留 29,362,493 字节，小于 32 MiB。测量仅适用于该明确工作负载。
- 删除旧源码后的最终 TS 构建再次通过 Codex 0.162.1 原生 ownership / V2 questions / V2 approvals，全部在隔离目录使用本地 Responses fixture，远端调用 0。机器证据位于 `.dev-runtime/session-typescript-migration/*-final.json`。
- 当前正式实例仍是此前的 legacy 进程；源码变更没有停止或替换它，也没有提交、推送或部署。新实例默认采用 TS，正式旧实例的安全切换须单独授权，不能由构建成功推断已上线。

## 正式切换与后续合并（2026-10-10）

用户明确授权重启后，先备份应用数据并核对无活跃原生工作；切换前出现新活动线程时保护检查中止了停止操作，待该轮结束后才继续。旧运行层及其三个空闲后代退出，新 TS 实例实际启动，默认入口、健康身份和全树构建指纹匹配。前端 HTTPS 绑定 `0.0.0.0:8484`，正式 LAN 地址 `https://10.30.0.24:8484/?mode=session`；原 105 个 tmux pane PID 全部仍存活，SQLite integrity check 正常。

正式只读 UI 检查已覆盖桌面、手机、刷新、模式切换、4 项目与 9 个关注集合；列表和关注内容前后相同。导航显式取消的健康请求按 AbortSignal 时间戳解释，稳定窗口两层健康均 200。该轮发现 Claude SDK 隐藏续接父会话，原历史未丢失；源码已补兼容并完成必要红绿验证，运行实例应用及最终全量结果将在用户要求的“拉取合并 → push → 全量检查和验收”顺序中验证。

本节不将推送前的测试结果冒充推送后的验收。正式只读与原生隔离证据在 `.dev-runtime/session-typescript-migration/formal-browser/` 和 `post-restart-native/`，不会提交用户数据或测试生成物。
