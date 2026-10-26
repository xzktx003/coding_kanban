# Default 与模型选择状态的纯派生（R28e4，2026-10-17）

`nativePickerPresentation.ts` 将已验收的内置预设、广告 pair 与 TX 回退组合为无副作用的展示数据。它接收两份显式输入：完整普通展示目录 `models`（原 ke）与调用方已投影的可选预设目录 `presetModels`（原 vt）。没有生产 UI consumer，也不读取 store、账号、目录接口或 native；输入类型约定不构成资格、来源或权限证明。

## 原版合同

固定 VSIX `26.51007.21434` 的 hCa/P17、首开处理 P19、mJr、CCa/SCa 为本批直接依据。E4 源计划包含26个原始片段；独立静态审查逐项核对13个必要片段。原包文件、精确 codepoint/UTF-8 跨度和哈希保存在准备包，未 import 或执行完整 bundle。

- 内置 `presets` 和平铺 `advertisedChoices` 使用 vt，复用 [已验收的纯算法](model-built-in-presets-pure-20261016.md)，保留声明顺序、下标空洞、广告重复和标签。
- `preferredModel` 是 ke 中第一个 `isDefault` 的原对象，即使它不在 vt 或内置预设中。`defaultChoice` 对本次 presets 执行 TX，返回其中原对象；不存在默认记录时继续使用原 TX 回退。
- `selectedPreset` 按 canonical model 与调用方提供的显示强度 bt 精确匹配，不能把 raw、模型 default 或当前菜单 TX 回退冒充 bt。
- 当前 pair 不在 presets 时，`effectiveSelectionMode` 为 model；在 presets 时，使用已保存的 default/model，未保存则为 default。保存为 default 而当前 pair 不在 presets 时，不修改保存值。
- 只有传入保存值为 null 时，`initialSelectionMode` 才给出当前有效模式；其它情况返回 null。该字段只是数据建议，后续只能在真实准入的首次打开时消费，不能在 render/mount 时保存。

结果不克隆或重排 helper 返回的选择对象。preferred 保留输入记录引用，default/selected 保留本次 presets 内引用。没有模块缓存、调用方数据修改或运行时冻结承诺；接口为窄 TypeScript 合同，不是新增 schema/资格解码器。

## 实际红绿灯

独立字面矩阵先于产品候选封存；测试作者读取原始来源与矩阵，没有读取产品候选。产品及16项测试先独立静态审查，再在 E3 独立终审放行之后，原字节提升到正式路径。

| 检查 | 实际结果 |
| --- | --- |
| 提升测试后、产品缺失时 web noEmit | 退出0，26.5607秒 |
| 旧产品，同一16项测试 | 14个显式新 API 可用性断言 RED，2个既有 C 控制 PASS；Vitest1.14秒，wrapper2.1943秒 |
| 提升2954B纯模块，同字节16项 | 全部 PASS；Vitest1.01秒，wrapper1.8929秒 |
| 新模块与 C 直接相关回归 | 单批2文件38项 PASS，包含上述16项；Vitest1.11秒，wrapper2.0092秒 |
| 提升产品后 web noEmit | 退出0，26.0571秒 |

14个旧产品失败均发生在测试第31行的显式 availability AssertionError，正常收集16项，没有 suite-load、TypeError 或0测试冒充 RED。它证明新接口缺失，不是旧 UI 语义错误复现。产品存在后，同一14项实际检查完整字面输出、输入冻结且不变、重复/顺序、跨列表默认、bt 与 TX 分歧，以及原对象引用。两项旧 C 控制不依赖新模块存在。

每项禁止 fetch 与 Storage get/set/remove，并在 finally 恢复全局。它们是本纯模块的具体无 IO 保护，不是任意运行时 API 隔离证明。没有修改 C、E1/E2/E3、既有产品或测试文件。

## 执行范围与未接入部分

五条验证命令各自有日志、receipt 和前后输入快照。四个源码根、选定测试/基础设施及 shared 产物保持稳定；3039条基线只在提升测试、提升产品时变为3040/3041，执行期间无漂移，HEAD 不变。最终2880源码、16选定测试、73基础设施、72 shared 产物，不把仅冻结的浏览器文件算作已执行浏览器验收。

本批新增纯接口，没有创建可点击 Default、跨模型 slider、FI 首开保存或普通行 FI 写入，没有接入 Lti/Pti、requiredOnModels、资格缓存、原生原子 RPC/CAS。当前 E3 的本 APP ultra=false 展示策略保持，不据此伪造官方 rollout、Copilot 身份或 Ultra 确认框的可达条件。

未运行新浏览器、生产构建、原生账号/GUI、物理设备或长期 RSS。沿用的隔离前端为局域网 HTTP `http://10.30.0.24:48865/`、绑定 `0.0.0.0`，地址来自前阶段，不是本批新 HTTP/设备探测。没有重启正式运行服务、停止 Agent 或切换运行产物。

证据：`.dev-runtime/session-polish-round2-20261016/model-picker-default-r28e4-root/`；源计划、字面矩阵、产品/测试候选和静态审查分别封存于相邻目录。后续终审与放行写在 root 之外；完整 Goal 和生产选择器接入仍继续。
