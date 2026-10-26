# 模型自动审查要求的数据解码与原版查询

2026-10-17（本地日期），R28d1 新增 `apps/web/src/session-mode/services/nativeModelRequirements.ts`，承接 [R28a 有界要求投影](model-auto-review-requirements-projection-20261016.md)。它只解码数据并回答原版模型 predicate，不读取 HTTP、store、账号或线程，不开启预设菜单或自动选择审核者。`known` 表示特定运行实例返回的数据投影通过检查，不是账号、cwd、线程、writer、reviewer 或模型资格。

## 数据合同

`decodeNativeModelRequirements(dto, expectedRuntimeInstance)` 要求调用者独立捕获非空 primitive 实例字符串，随后精确匹配 DTO 的 own projection。版本须为1、source 为 `configRequirements/read`、scope 为 `runtime-global`、status 为 `known`，六种 autoReviewSource 必须与 normalized own 字段一致：

| 原生来源标记 | 必需的投影形状 | 解码列表 |
| --- | --- | --- |
| `native-null` | own `requirements:null` | null |
| `auto-review-absent` / `auto-review-null` | requirements 对象的 own `autoReview:null` | null |
| `required-models-absent` / `required-models-null` | own autoReview 对象的 own `requiredOnModels:null` | null |
| `required-models-list` | own autoReview 对象的 own 合法列表 | 独立克隆的列表 |

旧服务缺 marker、错误、unsupported、实例缺失或错配、继承关键字段、来源与 payload 矛盾、整个列表非法时返回 `unavailable`。不能把这些情况转成空列表或 null。合法缺省由 producer 的来源标记证明，不能再从 normalized 字段缺失推断。额外未来字段可存在但不解释；旧五项 permission 字段保持独立消费，不在此重做 permission schema。

列表预算保持 R28a：最多256项，每项为非空 primitive 字符串，UTF-8 最多512 bytes，原列表累计最多65536 bytes；拒绝 C0 和 DEL，保留 C1。case、空白、Unicode、顺序、重复和列表中的 slash 原样保留，不截断、过滤或去重。TextEncoder 测量 UTF-8；提前拒绝超过512 code units 的字符串不会扩大 producer 的有效拒绝范围。结果对象及自有克隆数组冻结，调用者 DTO 不被修改或冻结。

## 原版 predicate

Main 原版 `F_t/G_t` 的完整函数体及 byte/codepoint 位置均已核对。`isAutoReviewRequiredForModel(known, target)` 对 string/null/undefined 域执行同样查询：nullish target 或合法 null 列表为 false；无 slash 的名字原样查 includes；只有一个 slash、前缀非空且属于 `[A-Za-z0-9_-]+` 时去掉前缀，suffix 不再含 slash。只规范化 target，不规范化列表，不限于 Terra/Sol，也不做 trim、大小写或 UI alias 修补。

补充的本 APP 类型边界为：运行时误传 unavailable，或 target 不是 string/null/undefined，一律 TypeError，不能伪造 false；非法 target 类型不属于原版差分的有效域。合法 native-null／缺省来源得到的 false 仅表示该 predicate 没有匹配要求。旧 raw helper 的 null 不能用于启用 reviewer；两个结论用途不同。

## 实际验收

候选经独立静态审查后先只提升测试，web noEmit 通过。旧产品实际执行51项：48项全部在新模块存在性断言 `actualAPI:26:119` RED，3项既有 raw helper／编码控制通过；这是接口 availability RED，不冒称已有实现的语义错误。Vitest 把48个失败打印为16组，分别6、11、18及13个单例。随后仅新增已审纯模块，同一测试文件不改字节，51项全部 GREEN。

相关单批5文件99项通过，包含新51项及内置 preset、reasoning options、既有权限入口和联合模型动作控制，不重复相加。前后两次 web noEmit 均退出0。真实 `pnpm session:status` 退出0，正式 runtime 仍为 PID2712539，磁盘运行产物未激活。

独立原函数差分另执行一次：11种合法来源／列表 family ×35个 null/string target，共385次比较全部一致，两个 VM script 各100ms，动态代码生成关闭，仅 JSON primitive job 入、序列化布尔结果出；未 import 原 bundle、执行 SDK 或读取账号。10份执行输入前后与当前匹配。385是比较数，不是额外单测数，不证明真实账号或完整原生 GUI。

差分 driver V1 的工作目录错误在执行前由独立审查发现：`pnpm --filter web exec` 会在 web 包目录运行。fresh V2 仅改两行，从 fresh run 文件 URL 定位仓库并引用 V2 准备包；V1 从未执行，旧封包不变。实际 V2 执行未触发超时；外层15秒为执行等待上限，之后另有最多2+2秒的自有进程组清理，不能称总墙钟不超过15秒。VM 超时不覆盖自有模块 import 或 host IO。

七条实际命令每次均核对四个源码根、14份选定 E2E／fixture、52份基础设施与72份 shared 产物；测试推广后的3008条、产品推广后的3009条记录及 HEAD 均无命令期间漂移。相对 preformal3007条只新增该模块和测试，既有源码和测试不变。测试 V1 的准备期两行注释在任何执行前由 fresh V2 删除，其余字节完全一致，不改写旧候选或已有封存。

## 接线与运行边界

本阶段没有 UI 消费者、HTTP 调用、缓存、轮询或生命周期订阅，也没有新增模型限制、服务切换、production build、浏览器或物理设备验收。既有隔离前端仍为局域网 **HTTP `http://10.30.0.24:48865/`**，绑定 `0.0.0.0`；它不是本次 UI 验收结果。原版 QXr 当前 requirements 调用只传 host，不能从通用 cst 可选账号元组签名反推此调用已填完整身份，或给本 APP 普通偏好新增资格门槛。实际同源读取、账号观察失效及 Default／preset／FI 界面接线仍分别继续。

可复核证据位于忽略目录 `.dev-runtime/session-polish-round2-20261016/model-requirements-decoder-r28d1-root/`，原函数实际运行位于同级 `model-requirements-decoder-r28d1-oracle-run/`。最终只读复核与放行收据保留在 root 外；本阶段通过不表示整个 Goal 完成。
