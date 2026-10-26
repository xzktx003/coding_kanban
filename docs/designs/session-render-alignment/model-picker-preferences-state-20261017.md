# 模型选择器的自有偏好状态

2026-10-17，R28e1 新增 `stores/settings/useNativeModelPickerPreferencesStore.ts`。它提供本 APP 的 UI 偏好状态，还没有菜单消费者或编辑入口。模型、推理强度、service tier、reviewer、线程 pending/revision、草稿和原生配置均不由该 store 修改；主／展开菜单、Trigger、三命令与滚轮的共同投影仍在后续阶段接入。

## 状态与来源

仅持久保存两项数据：`selectionMode:null|'default'|'model'`，初始 null；`enabledReasoningEfforts`，准确默认 `[low,medium,high,xhigh,ultra,persistent]`。该默认来自实际 Main `Yb/hAt`，不是 Native 中未用于这条链的四项 kMn。运行时接受九种明确值：none、minimal、low、medium、high、xhigh、max、ultra、persistent。generated ReasoningEffort 实际为 string，因此这里有独立的运行时校验，不改变全局 wire／配置合法性。

持久键为本 APP 自有 `kanban.session.native-model-picker-preferences`，version1，范围为当前 origin／浏览器设备。没有读取或导入官方持久 atom、账号设置、custom models、config store 或 thread store。原 FI 的 key 及 publisher 链不能单独证明官方存储拓扑；本阶段不宣称账号同步或跨标签自动同步。

simple/advanced 仍是每个菜单层的 transient view，不进入此 store。setter 不执行首次打开时的 FI seed，不派生 effective mode，不修复 raw pair/defaults，也不包含原 DMn/OMn 的 native 默认配置或 prewarm 写入副作用。ultra 偏好值不授予 Full access，实际独立 flag、确认与模型动作仍须按各自来源处理。

## setter 与 hydration

显式 setter 对非法 mode、非法整个数组、任一未知／非 primitive 成员和稀疏槽，在任何 state 更新前抛 TypeError。合法数组保留顺序、重复与空数组，克隆后冻结；不冻结调用者输入。相同 mode 或逐项相同数组返回原 state，不通知订阅者。不保证 persist middleware 不重复写相同 JSON。

partialize 只保存两项数据；merge 按 own 字段逐项检查，只接受合法字段，不导入未知字段或覆盖方法。一个字段非法或缺失时保留该字段当前 live/default 值，另一合法字段可独立接受；畸形整个 state 保留当前状态。hydrate 的新数组同样克隆冻结，相同数组复用当前引用。

版本行为按当前实际 Zustand5：只有数值 version 与1不同时调用 migrate，本 store 返回空对象，随后保留当前字段。缺失、字符串或 null version 仍进入字段白名单 merge，不宣称这些 envelope 均被版本门拒绝。本阶段没有额外包装 storage，也没有证明任意自定义 iterator、storage 异常或异步存储时序。

## 实际验证

独立静态审查核对了原来源、实际 ESM/CJS middleware 与类型，再提升测试。web noEmit 首先通过；旧实现实际14项中13项在 `actualStore:42:79` 的明确新模块 availability 断言 RED，1项独立旧 helper 控制通过。后续的 store 行为在旧实现不可达，不称为语义 RED。推广精确候选后，同一14项全部 GREEN。

用例覆盖真实 Zustand persist／localStorage roundtrip、独立字段 hydration、方法与未知字段隔离、数值版本迁移及 versionless 的实际语义；Storage spy 转发到真实 jsdom storage，不替换被测 store 或成功 payload。fetch/WebSocket 被设为禁止；外部 key 的合成 sentinel 在创建、修改和 rehydrate 后保留。单批4文件89项相关回归通过，包含新14项及 D1、联合 pair 动作、既有 reasoning helper，不重复相加。web 前后 noEmit 均退出0。

六条实际命令分别核对四个源码根、14份选定 E2E／fixture、55份基础设施与72份 shared 产物。提升测试时3013条、加入模块后3014条及 HEAD 均在命令前后不变；相对 preformal3012条只新增模块和测试，既有源码与测试没有修改。V1 准备文本的两行阶段注释在任何执行前由 fresh V2 删除，其余字节不变，旧包保留。独立审查收尾曾把 root 已有意提升的正式 test 当作应继续缺失的目标，记账断言在输出前停止；已按 exact V2 presence 记录，不是 reviewer 写入、输入漂移或产品 RED。

这是状态 API 的验收，没有生产 UI／浏览器／物理设备、原生账号或长测结果。现有隔离前端仍为局域网 **HTTP `http://10.30.0.24:48865/`**，绑定 `0.0.0.0`；本阶段没有新页面行为。只读 `pnpm session:status` 确认正式 PID2712539 继续运行，磁盘运行产物未激活，没有重启或停止 Agent。

证据在忽略目录 `.dev-runtime/session-polish-round2-20261016/model-picker-preferences-r28e1-root/`，独立最终复核与放行收据在该 root 外。后续 ordinary non-Copilot effort 投影、共同消费者及 FI／Default／preset 行为仍须各自完成真实红绿和浏览器验收；本阶段不表示完整模型选择器或整个 Goal 完成。

后续 R28e2 已实际验证 [显式强度广告纯投影](model-picker-effort-projection-20261017.md)：16项与相关59项通过。在R28e2阶段，模块未读取本store或接入共同UI消费者；这些独立验收不能相加当作菜单完成。

后续 [R28e3共同消费者](model-picker-consumers-20261017.md) 已在普通主／展开、关闭Trigger和三命令应用本store的enabled数组，真实19组件、新4／原12浏览器与425回归通过。FI仍未首开seed，编辑入口／Default／preset和真实原生权限继续独立推进；本store不成为官方账号偏好来源。
