# 反馈入口与权限预检（2026-10-16）

当前状态：正常入口、两次权限预检与生命周期修复已完成当前隔离分项验收；前端161项、运行层56＋既有协议14项通过，最终单批26浏览器＋4 HTTP桥接全部通过。真实账号、正式运行产物启用与整体会话模式对齐仍有独立门禁。

## 已确认的问题与范围

`/feedback` 选择 `slashDialog="feedback"`，但 `SlashCommandDialogs` 没有反馈分支；会话菜单发出的 `codex-open-feedback` 也没有生产接收者。现有 `NativeFeedbackDialog` 和上传报告组件的直接挂载测试不能证明正常入口可达。`c1ed881` 的宿主已有同样缺口，不能归因 R20 名称修复或尚待归属核对的 Goal 附件注册改动。

修复范围为正常表单入口、打开及提交前两次只读预检、捕获会话／项目／账号／运行实例的生命周期。原上传服务、分类、日志选择、四字段 native payload、未知回执不重发和上传报告关闭继续的规则保留。反馈读取和上传不新增 writer acquire/resume、turn 或权限修改。

## 当前原包证据

参考固定官方 VSIX `26.51007.21434-linux-x64`，原文件保持不修改。当前 `app-initial-9133cd204fef.js` 的 `MF → zF → HF → DP` 确认命令注册、两次预检、信息通知及判定优先级；不拿较早表单组件的运行对照代替这个 wrapper 的当前行为验收。

原 `DP` 先捕获并在 await 后重核 `(accountId, accountStructure, authMethod)`，再依次判定：

1. requirements 的 `feedback.enabled === false` 或工作区 `beta_settings.enable_message_feedback === false`：`policy`。
2. 所需 ChatGPT 账号信息仍加载／缺失，或不能证明当前个人／工作区结构和必要设置：`unavailable`。
3. 有效配置中经 schema 解析的 `feedback.enabled === false`：`configuration`。
4. 其余返回 null。完整快照里的缺省／null 不是读取失败或公开投影删字段。

原 requirements 失败可取同查询缓存；effective config 失败可取相同 host/cwd 的完整缓存，仍无则空默认配置。工作区设置网络／5xx 失败可用同账号缓存，401／403／404 先清缓存。原当前包 `OP()` 为 false，不得把其短路分支变成普遍拒绝。预检通过也不保证 native 最终接受上传。

当前公开 `config/read {}` 只投影原有权限及 MCP 字段，缺少反馈字段和 cwd，不能用于上述判断；此接口契约保留。新预检只投影所需决定与读取来源，不公开完整 config、layers、origins、账号列表或 token。

账号 authority 放在运行层同一原生连接内部：`account/read` 的完整匿名／API-key 分支不要求 ChatGPT token；ChatGPT 分支使用内部 `getAuthStatus({includeToken:true,refreshToken:false})`，JWT 仅定位账号 ID，再精确取会员响应 `accounts[target].account.structure`，仅工作区继续读取设置。套餐、邮箱和排序第一的账号不充当结构证据；不读取其它 HOME 或调用暂停的云任务服务。不支持协议、opaque token 或身份不足归为该分支无法核实，不伪造组织禁用。

审计位于忽略目录 `feedback-preflight-r21-audit/`，seal SHA 为 `0f28bc51716f66336c603a9dcb0639187359d002194e5eac2c1ffc459928f51d`；44 份输入、74 个精确片段稳定，root 重核86份审计文件无漂移。这是静态证据，尚非真实登录／组织账户或 native 协议运行通过。

## 自有接口与状态边界

新增窄端点 `POST /api/codex/feedback/preflight`，网关沿用 `/api/session` 前缀。捕获 `threadId`；已有会话从同一原生实例的精确只读 metadata 得 cwd，不能由调用者换成另一项目。无会话时显式 null cwd 合法，新草稿使用验证后的捕获项目作用域。返回四态 reason、runtimeInstance 和 provenance，不接受调用者指定账号、host、API origin 或授权 header。

菜单事件携带目标 thread/draft owner，只有可见且匹配的输入宿主接收；不能由侧边或隐藏输入回退到全局当前会话。打开和提交各自等待期间的 owner／配对宿主／账号／运行实例变化均须使旧结果失效，包括 A→B→A 与同值账号新通知。只释放自有预检和观察，不取消、重发或转移已发送上传。

原 generic form 只有 onSubmit 显式 false 才保留；原提交预检拒绝返回 undefined，表单可关闭。原上传报告的显式 retry 调捕获的上传闭包，不重新调用 DP；本分项不能把更严格的新重试规则冒称原行为。读取与真正写入之间仍有窗口，预检和本地 epoch 不是 native 跨进程原子 CAS。

effective config 缓存按账号 authority 与 cwd 分区；requirements 和账号设置使用各自不含 cwd 的 authority key，切项目不能丢失已知组织禁用。每次调用先尝试 fresh read，再按原分支回退。自有缓存仅保存必要布尔值／结构，四个 map 默认各64条、五分钟滑动空闲 TTL；不是对原 TanStack 查询层完整生命周期的移植。每种资源仅在有效 fresh 提交或明确撤销时推进已应用序号，失败尝试不夺取提交权；旧完成不得覆盖较新有效缓存或复活401／403／404已清设置，也不能因较新请求失败而丢掉迟到的已知禁用。最多32条在途、每条三个临时 key，上限96条，finally释放，不永久保留 tombstone。

原生完整匿名、API-key 和合法 `amazonBedrock` 账号分支均不索要 ChatGPT token；未知或不完整账号不伪造为允许。ChatGPT token 轮换而 account ID／auth method 未变不单独撤销；同值原生账号新通知仍使 epoch 失效。内部 API base 通过 `SESSION_CODEX_FEEDBACK_API_BASE_URL` 显式配置，远端要求 HTTPS，HTTP仅准入 loopback 夹具，不接受浏览器指定。双方 runtimeInstance 使用非空、无控制字符、最多256个UTF-8字节的同一边界。

前端仅在工作流存在期间订阅元数据和宿主祖先 hidden／inert 属性。隐藏／离开后旧结果不能复活，仍在原 owner 的请求标记会清理，用户可重新主动打开。菜单捕获的 draftOwner 优先于全局 fallback；已开始其它 slash dialog 时不再给反馈宿主目标，避免菜单预检迟到叠出表单。这条共享 composer 的意图保护有真实组件反例，未宣称当前原 zF 在完整 IDE 里的同一模态交错已运行验证。

## 实际红灯

| 范围 | 已执行结果 | 证明范围 |
| --- | --- | --- |
| 前端真实 SlashCommandDialogs／stores／API | 25 项中23失败／2控制通过，26.38秒，exit 1 | 失败首先停在缺入口／零预检；不能称23种政策漏洞均已独立观察 |
| 运行层真实 HTTP 路由／RPC 夹具 | 29 项中27失败／2控制通过，859.53毫秒，exit 1 | 27个新端点404；原config接口及lazy零IO控制通过 |
| 实际网关→私有HTTP运行层 | 4项均404失败，exec48749 exit 1 | 网关正确转发目标端点，未启动 native 或 writer；不计为浏览器用例 |
| 正常用户入口／1440×900及390×844 | 4项均缺表单失败，exec62475 exit 1 | slash/menu trusted操作、归属／草稿／32条输入稳定控制通过，零预检／上传；12张截图、22份状态记录 |

HTTP桥接前两次启动为模块加载失败，均零用例；入口初次启动为 CJS named-import 加载失败，也零用例。全部原日志保留，不计为产品红灯。正式入口提升只调整 import／SELF／输入路径和 ESM 加载方式，核心断言与操作保留。

证据根目录为被忽略的 `.dev-runtime/session-polish-round2-20261016/`。真实浏览器使用 **HTTP `http://10.30.0.24:48865/`**，绑定 `0.0.0.0`；API、WS、原生 RPC 与账号数据均为隔离夹具。没有真实反馈、账号外网调用、新原包／SDK 探针或正式 Agent 操作。root 四入口红灯收据 SHA 为 `1b51956d6b1329232324464436a0ef89585b13c149474ab73e851be848352011`；四 HTTP 桥接收据为 `eb31ea1299d6ad5a29857cdbca5e47be77f4bbb9e3cb0874dfe71eb379c25ce7`。

## 修复后的实际验收

| 范围 | 最终执行 | 证明范围 |
| --- | --- | --- |
| 前端六文件 | 161/161，21.52秒，exec69877 exit0；web noEmit exit0 | workflow40、DTO／字典19、会话菜单81、原表单3、service10、controller8；初159收据后三项分配写错，总数未错，独立交叉审已更正且旧seal保留 |
| 运行层三文件 | 预检56＋既有路由／协议14＝70/70，1075.64毫秒，exit0；runtime noEmit exit0 | 原29同字节先绿；后续HTTPS／滑动TTL、账号轮换、跨cwd requirements、合法Bedrock和缓存两向交错均另有真实RED，旧38／50中间版不冒充最终版本 |
| 网关与页面联合 | 最终exec11275 exit0，30/30，2.7分钟，无跳过／自动重试 | 26浏览器＋4纯HTTP；1440×900／390×844，正常slash／菜单、组织／项目拒绝、二次拒绝、503／截断、切会话／ABA／隐藏／其它弹窗、consent true／false及未知回执单次上传 |
| 跨端类型与生产构建 | 最终工作区 `pnpm check` exec62415 exit0，Vite49.02秒 | shared、运行层、网关、web均检查；反馈最终源码版本的较早46.92秒构建另存，构建不激活已有运行服务 |

最初修后四入口仍全部失败：真实handler已返回allow200，有限SSE夹具却立即EOF；390 slash曾短暂出现表单后撤销。保留exec85987及其截图，随后仅将精确events读路由接到自有loopback持久在线流，并只读等待真实onopen，不替换EventSource或产品guard。旧测试还把metadata次数写成1，现按运行层首尾scope保护精确断言2；这是已解释的夹具修正，不能称正常入口测试与原RED字节相同。

首次持续流联合批次exec5972为27通过／3失败（2.9分钟）：手机两例tab中心命中了独立项目详情按钮，另一例编辑区被仍打开的附件Popover遮挡，实际会话／model切换未发生。原JSON／截图／日志保留；正常点击会话标题、先Escape关闭外层菜单后，**完整30例**重新执行通过。没有force点击、删场景、改产品或放宽owner／政策断言；两批仍是30个不同场景，不能累计为57或60个。

自有SSE只服务GET注释／心跳，CORS固定当前前端源，逐例保存自有PID／start ticks、连接与EOF记录。页面释放后关闭自有response／socket／listener，26例均核对零残留；不处理其它进程。四次显式上传只进入隔离raw RPC夹具，原四字段与日志同意逐值核对，没有向真实反馈服务发送。

最终54条实际反馈依赖逐例前后哈希相同。完整2963条清单另有并行Codex模式文件变化：首批四项、后批两项，均保留并单独记录，不能写成整棵工作区冻结无漂移。独立审核核对30份canonical、26份字节相同附件、78张PNG完整性／尺寸，8745项检查无异常，并实际查看10张代表图；该视觉检查不替代完整认证原宿主的像素对照。最终浏览器收据 `feedback-policy-r21-execution/actual-final-v2-receipt.json` SHA 为 `bd15f9054f032b80d084b9150738da83dfe922f982488143e365ae1b348a928f`；较早失败和更正补丁均在同目录，独立截图／artifact审核另存 `feedback-r21-final-independent-verification/`。

## 仍未闭合

实际browser只证明当前可见主输入宿主。侧边／隐藏／错误目标事件不借主宿主打开，不能将此拒绝对照说成侧边专属反馈表单已可用。当前官方DP wrapper的完整真实登录IDE、实际getAuthStatus协议与组织权限HTTP、原查询完整生命周期、宿主诊断附件／远程上传和物理设备均未因此验收。新实现为最小必要投影，不宣称原会员全字段normalizer或includeLayers:true原wire全部复刻。

`pnpm session:status` 确认正式PID2712539与磁盘新产物不同；正式服务／Agent未重启，旧端点缺失时仅提示无法核实。前端、只读参考和正式运行层的PID／start ticks保持、HTTP均200；健康不代表新产物已启用。Goal附件路由的并行删除归属仍待回复，不恢复该改动；其它Goal、模型命令／加载错误门禁与全会话模式目标继续进行。
