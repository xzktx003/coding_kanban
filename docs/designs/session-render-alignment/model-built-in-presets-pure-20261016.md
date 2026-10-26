# 内置 Power 预设与 Default 的纯派生（2026-10-16）

`nativeBuiltinModelPresets.ts` 提供三项无副作用的本地能力：固定内置预设、实际广告的模型／强度 pair，以及给定候选列表的 Default 回退。它接收调用方已完成资格过滤的记录，不读取原始 catalog、账号、配置或 store，也没有接入生产菜单。前置的 [联合选择动作](model-joint-selection-action-20261016.md) 保持独立。

## 原版范围与算法

固定 VSIX `26.51007.21434` 的实际 `pJr`、`vJr`、`gJr`、`yC`、`TX`、`EX` 和 `gMn` 是本阶段依据。Main 的 `sit as c_` 确实指向 Native 导出的 `gMn as sit`；标签不是 identity 替身。七个原函数和原 var／三项赋值共十一处精确跨度均按完整源、UTF-8／UTF-16／codepoint 和载体哈希核对，当前安装包也找到了相同 gMn 原体。

只复刻 `sliderModelsConfig:null`、`removeXHigh:false`、`stripGptPrefix:true` 的固定路径，不执行带 SDK／动态 uniqBy 的初始化。primary 依次为 Terra-low、Sol-low／medium／high／xhigh／ultra；按 canonical model 与实际广告 effort 同时匹配，至少三对时采用。否则尝试 Terra low／medium／high／xhigh 的 secondary，仍不足三对则为空。保留声明顺序和原 powerSettingIndex，过滤后不压缩下标空洞。

实际广告列表沿原 gJr→vJr：复用现有八项推理强度识别，排除 persistent 和未知值，保留顺序及重复。medium 占位不自动变成可选项；vJr 仍须找到同 canonical model 实际广告 medium 的记录。因此另一个同模型重复记录确实广告 medium 时，前一条占位可以重新被接纳，不能一律删掉占位。标签来自第一个同时满足模型及该 effort 的记录；不以 raw id 或 displayName 做别名匹配。

Default 只在传入的候选和 preferred id 上执行 TX／EX：精确 id → Sol 同末段 effort → Sol-medium → 任一 Sol → 任一 medium → 第一项 → undefined。返回原候选对象，保留附带数据及引用；它不自行选择真实 catalog 的 isDefault、不写设置，也不建立 FI 偏好。私有标签格式化器按真实 gMn 处理 GPT 前缀、空白、大小写、OAI 和 Unicode，不改变既有 canonical／raw-label helper。

`AlreadyEligiblePresetModel` 是调用方假设，不是权限证明或输入验证器。纯算法中的 ultra 合成记录只表示已准入的测试输入，不能用来开启实际账号的 ultra 或跨模型权限转换。

## 原函数执行与红绿灯

先在可信精确载体上独立运行原函数：八项派生＋七项 TX 共15个逻辑场景全部通过；另四个 canonical／重复／persistent／返回列表修改反例也单独通过，没有把两批冒称同一次执行。两次分别36／12次 VM Script 调用、28／39个执行输入前后相同；没有 import 原 bundle。

Node VM 内只接收 JSON 文本、在同 realm 调用真实原函数并序列化结果，每条 Script 使用100ms timeout，禁用字符串／Wasm code generation；不把原函数取回 host 调用。VM 不是通用安全沙箱，前提是审过的七个可信纯函数、固定 adapter 和有界合成输入。原15例的首版 driver 在执行前静态发现失败收据／输入复核缺口，fresh v2 修正后才执行；旧版本未运行。

新测试最初的 V2 已通过类型检查，但首次 Vitest 为 **0测试**：Vite 把 `new URL(..., import.meta.url)` 转成 HTTP，Node fileURLToPath 抛出 suite-load TypeError。这是测试夹具失败，完整保留，不计产品红灯。V3 只把定位器改为 Vite 惰性 glob，22个测试体及期望不变，独立 delta 审查后重新检查类型。

| 检查 | 实际结果 |
| --- | --- |
| V2 类型／首次测试 | 类型退出0，26.1013s；随后0测试加载失败，wrapper1.9775s，非产品RED |
| V3 产品推广前 web noEmit 类型 | 退出0，27.0796s |
| 旧产品，V3 22例 | 19个模块可用性断言失败／3个既有 helper 控制通过；Vitest1.20s，wrapper2.2263s |
| 精确新增纯模块，同字节V3 22例 | 22通过；Vitest1.08s，wrapper1.9784s |
| 直接相关 helper／canonical／effort／cardinality／raw-null 回归 | 单批8文件71例通过，包含新增22；Vitest8.96s，wrapper9.9236s |
| 修改后 web noEmit 类型 | 退出0，26.5503s |
| 正式运行层只读status | 退出0，0.6198s；PID2712539保留，磁盘运行产物未激活 |

19例真正红灯均在 `actualPureAPI` 的显式模块可用性断言；Vitest 将它们打印为六组（8／7／1／1／1／1）。三个控制独立检查现有 canonical、强度识别及当前模型 TX helper，不调用新模块。缺失接口不代表旧 UI 已发生错误。产品推广后同一份 V3 测试继续检查完整输出、输入冻结／不变、重复、对象引用和 fetch 零调用；没有 loader／TypeError 冒充接口红灯。

## 512 组合差分

另一条实际命令固定遍历 Terra 四项 effort 的16个子集 × Sol 五项 effort 的32个子集，共512个逻辑场景。原函数与正式本地三项 API 的完整对象、顺序、标签逐项相同；两份列表各九个 preferred id 同时检查 TX 值、undefined 标记、所选下标及各自原列表引用。实际完成 **29,696项比较**，全部一致；比较数不是测试数。wrapper1.4050s，执行器内部约0.402s，没有失败后重跑挑绿。

矩阵包括256次逆序、46次重复 effort、171次 persistent、103次未知 effort、46条广告重复记录及28条“unknown-only 同模型记录由另一记录广告 medium 后重新接纳”的场景。八组标签各64例，覆盖真实 gMn 的前缀、空白、OAI、大小写及 Unicode；实际最多3模型／7 efforts。985B 的单份声明式 JSON 进入 VM，展开后的各场景模型序列化给 host 正式代码处理；累计展开320,534B、单场景最多1430B，不能把累计数据称为≤64KiB。517次 VM Script 调用均受100ms限制；该限制不覆盖 host import、tsx、IO 或总墙钟。

差分实际44个输入前后相同，包含正式模块、依赖、原始证据和运行 driver；本阶段九条检查命令各自冻结3002或3003条执行输入／HEAD。与正式前3001条相比只新增模块和测试两个文件，既有产品／测试未修改。V3测试 SHA 为 `5daf7875e618abba8b3ca78273ae7744825a060aa852b964824c441c0a74e537`；正式模块 SHA 为 `0430504c9c5398a4e509d836e89144edcffb16257383af721a51239e43397c5f`。V2零测试失败与V3真实RED分别保留。

## 接入边界与证据

本阶段没有创建 UI consumer、FI／偏好 store、资格缓存或原生 RPC，不改已有普通菜单、命令、滚轮、Side／custom、权限、正文生命周期或草稿。没有重跑生产构建、UI浏览器、物理设备或长期 RSS；上述纯结果不替代这些验收，也不证明账号资格或 native ACK／CAS。

后续生产状态审计已区分 app 自有 UI 状态与真正 native 权限。原 hCa 的偏好默认来自 Main `hAt=[low,medium,high,xhigh,ultra,persistent]`，Native 未被使用的四项 kMn 不在该链；这项静态纠正没有改动当前偏好。普通上下文可以明确建立，不能以摘要缺失推断外部线程没有 managed／reserve 约束。R28a 已保留 auto-review 字段，后续应验证来源及 runtime／账号／目标／cwd，区分真实 native null／合法缺省与 legacy／错误，不把所有情况统一拒绝或一律放行。

证据位于被忽略的 `.dev-runtime/session-polish-round2-20261016/model-built-in-presets-r28c-root/` 与相邻的原15／extra4／512差分包；候选、执行器和测试的独立静态审查及最终独立复核各自封存，最终放行收据在 root 之外。现有隔离前端为局域网 HTTP `http://10.30.0.24:48865/`，绑定 `0.0.0.0`；没有因本阶段重启正式服务或停止 Agent。完整生产预设 UI 仍继续。

2026-10-17 后续 R28e1 已提供本 APP 自有 FI／enabled-efforts 状态，默认准确 hAt 六项；14 项与4文件89项相关回归通过。它尚未接入本纯模块、资格过滤或任何 UI，不能将 store 存在视作 preset／Default 已启用。原版普通 model row 的 FI 保存和权限确认各有时序，后续按实际链路接入，详见 [偏好状态验收](model-picker-preferences-state-20261017.md)。

2026-10-17 后续 R28e4 已复用本模块组合完整目录默认、预设、广告pair与当前bt的展示状态。完整ke和可选vt保持分开，只在FI为null时返回首开保存建议；16项及直接相关38项通过。仍无生产UI/Default/FI动作消费者，详见 [展示派生验收](model-picker-presentation-20261017.md)。前述R28e1“无UI”描述为状态阶段，enabled-efforts当前消费者另见 [R28e3](model-picker-consumers-20261017.md)。
