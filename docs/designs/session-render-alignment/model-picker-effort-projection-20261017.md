# 模型选择器的强度广告投影（2026-10-17）

R28e2 新增 `composer/nativePickerEffortProjection.ts`，提供 `projectNativePickerEfforts(alreadyEligibleModels, enabledReasoningEfforts, includeUltra)`。它只接收显式输入，复刻原 FJr 的 ordinary non-Copilot 强度投影；尚未接入生产菜单、Trigger、命令或滚轮，也不读取 [自有偏好 store](model-picker-preferences-state-20261017.md)。

## 数据行为与来源

按原 AMn／显式覆盖分支，偏好先转为 membership Set，再加入 persistent。每条模型广告仅保留原 yC 明确认识的九种值、Set 中的值，以及 includeUltra 允许的 ultra；偏好顺序和重复不改变广告顺序或广告重复。九值为 none、minimal、low、medium、high、xhigh、max、ultra、persistent；生成的 ReasoningEffort 实际是 string，因此 future 值即使也出现在偏好中仍不进入广告。

全部输入模型按原位置保留，包括重复 canonical、hidden 和过滤后广告为空的已知记录。不修改 isDefault、defaultReasoningEffort 或其它属性；每次创建新的外层数组、模型记录和强度数组，其它属性及被保留的广告 item 可以保持浅层引用。输入不修改、不冻结，输出不承诺深复制或冻结。后续原始广告数组增删不会回改既有投影数组。

persistent 在这一层保留，由既有 nativeReasoningOptions／原 dQ 后续排除；known-empty／persistent-only 不转换成未知 canonical 的 Pzt 六档。本 helper 不合成模型、不选择 Default、不做 hidden／auth／availability 资格、不返回完整 FJr defaultModel/support flags，也不处理 Copilot 强制或合成 medium。alreadyEligible 是调用者前提，不是资格证书；includeUltra 是显式显示输入，不是实验 flag 观测或 Full access 授权。

独立静态审查复核 P06–P12 与完整 yC 共8处精确原跨度、26项输入。未 import 原 bundle 或执行完整 FJr；本阶段没有新的原函数 VM／差分执行结果。默认 hAt 六值只是测试的显式字面输入，没有从 store 偷读或把该默认当作 ultra rollout 已开启。

## 实际红绿灯

独立字面期望先封存，正式测试采用惰性 glob 的明确模块可用性断言，随后加载真实模块；没有 mock 被测 helper、store 或成功响应。

| 检查 | 实际结果 |
| --- | --- |
| 产品推广前 web noEmit | 退出0，26.2354秒 |
| 旧实现、16项测试 | 13个新模块 availability 断言失败，3个独立旧 helper 控制通过；wrapper2.2470秒 |
| 精确新增模块、同一份16项 | 全通过；wrapper1.9543秒 |
| 直接相关回归 | 单批4文件59项通过，包含新16项；wrapper2.8274秒 |
| 产品推广后 web noEmit | 退出0，26.6225秒 |
| 只读 session:status | 退出0；正式PID2712539保留，磁盘运行产物未激活 |

真实 RED 主断言为 actualProject:19:75，13例打印为9／1／1／1／1五组，不是 loader／suite-load 失败，也不是旧 UI 语义缺陷的证明。9项字面表和4项结构用例验证完整输出、顺序／重复、已知空记录、输入值／引用、输出新数组以及跨调用／调用者修改；另3项旧控制不加载新模块。fetch 和实际 Storage get/set/remove 都断言零调用，这不是对所有运行时 API 的通用隔离证明。

六条命令各自核对四个源码根、14份选定 E2E／fixture、58份基础设施和72份 shared 产物；测试提升后3018项，模块加入后3019项及 HEAD 前后不变。相对3017项 preformal 只新增模块和测试，既有源码／测试没有改变。正式模块 SHA 为 `6337fa418b87b176e6994766553e342ee0c2a3315c70bf95b2a86c0415eaa279`，测试 SHA 为 `b16dc89eb361c9deafb306b364db9f64f2e39ed6203d77e52fcfedb6774b79cb`。

## 后续接入

原始 model cache、旧 generic helper、Side／custom、model／effort／tier／reviewer、thread pending／revision 和草稿未改。本阶段未跑生产构建、UI浏览器、物理设备、原生账号或长测；没有正式运行层切换。现有隔离前端为局域网 HTTP `http://10.30.0.24:48865/`，绑定 `0.0.0.0`，没有新增页面入口。

证据在忽略目录 `.dev-runtime/session-polish-round2-20261016/model-picker-effort-projection-r28e2-root/`，独立最终复核与放行收据在 root 外。后续主／展开菜单、闭合 Trigger、三命令与 pointer／arrow／wheel／status 必须使用同一投影；真实非 Copilot 来源、原 ultra flag、FI／Default／preset 及模型动作权限仍各有输入与验收边界。完整 Goal 继续。

后续 [R28e3共同消费者](model-picker-consumers-20261017.md) 已通过独立适配器调用此纯模块，覆盖普通主／展开、关闭Trigger、三命令及Power动作。本模块仍无store／IO；适配器采用明确的本APPultra=false显示策略，未知六档和raw cache独立保留。不能将该接入视为完整FJr／Copilot／资格或原生动作授权。
