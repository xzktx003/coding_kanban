# 未知 OpenAI 模型的六档回退（2026-10-16）

本批对齐普通 OpenAI 选中模型未出现在成功读取目录中的强度控件：使用 `minimal → low → medium → high → xhigh → max` 六项，允许 low 向左选择 minimal、xhigh 向右选择 max。未落在六项中的已存值只在界面派生为 medium，打开菜单不修复设置或目录。已知 0／1 项、自定义提供商、加载中和读取错误继续使用各自原路径。

范围是主／展开输入的 NativeModelSelector／Trigger。原版更早的账号／模型准入、未知模型的 Custom 名称、id／model 匹配差别、跨模型预设与 Default 行仍分别记录，不以本批宣布整个模型菜单或全会话模式完成。

## 原版与输入边界

原 Main `bC` 初始化 `Pzt` 为上述六个字面值。`dQ` 按 `.model` 查找：已知时返回广告且通过 UI 过滤的档位，未找到才生成 Pzt；known 空／单项不走六档。hCa 还要求 `ke != null && hU(ke,Oe)==null`，由此生成带原未知 model 的六个 power selections。不能把尚未加载的空 cache、读取错误或 custom provider 当成这个已就绪分支。

`Z6r → Native JNn → Main Mzt='medium'` 对不在六项中的值做只读显示回退。原 ReasoningEffort wire schema 是非空字符串，没有 enum；none／persistent／未来字符串都可能与 UI 六项集合不同，不应改写原目录来伪造能力。

原更早 `$Nn` 在 ChatGPT 身份及特定 provider／account／managed 条件下，会把目录没有的 saved model 先转默认模型；该输入随后不再是 hCa 的未知模型。无登录／API-key 也需满足没有 managed、reserve、draft／thread 覆盖等条件，不能从静态函数推广真实账号当前可见目录。

原 `hU/dQ` 只按 `.model` 匹配；产品此前支持 id／model 二选一。本批正例明确同时缺失两者，没有顺便修改这个身份边界。custom provider 即使与 OpenAI 同 ID，仍保留本地原五档。

只读来源为 `.dev-runtime/session-polish-round2-20261016/menus/model-unknown-efforts-r18-reference/`：**40 个精确片段、26 次完整函数体实装同体、21 输入哈希不变**。`findings.md`、三种完整合法静态输入和协议片段均保留。没有用静态输入冒充真实账号或组件运行。

另按 `$reverse-engineer-anything` 实际分析十个完整原函数组成的 **4402-byte 两文件有界载体**：1620 AST 节点、零解析失败、318 个语义未知，没有执行 JS；完整性只限该载体。`model-unknown-efforts-r18-rea/rea-summary.json` 的 summary evidence 是 `ev_6f96bbaa4a7718fec4eaa95390f09af456b934545d2cae857332f7375a63962e`，parent 为 `ev_af677444788952afa19909f64966b09bcc13d1913f8b6215a63c489aa53bc924`。精确函数及 alias／初始化语义仍以原始片段为据，不称完整应用图已闭合。

## 最小实现与成功标记

[nativeReasoningOptions.ts](../../../apps/web/src/session-mode/components/codex/composer/nativeReasoningOptions.ts) 增加独立只读六项常量，没有把 `nativeReasoningOptions(undefined)` 全局改成六项，以免扩大侧边面板、快捷操作或 known0／1 的能力。

[useModels](../../../apps/web/src/session-mode/components/codex/hooks/useModels.ts) 只额外订阅并返回现有 `cache.loaded`。load、四个 API、去重、缓存、refresh 和错误处理原字节保持；没有新增请求或存储写入。Selector／Trigger 的未知分支明确要求：OpenAI、非空 model、目录未命中、`loaded === true && !loading && error === null`。

仅检查 `!loading && !error` 会把首 render 当成功；仅检查 loaded 也不够：既有 `refreshProviders` 失败会设置 error，但仍保留 loaded=true。本批用真实方法复现后一状态，控件保留原五项和原配置，不能伪造 loaded／error 来证明门槛。

[NativeModelSelector](../../../apps/web/src/session-mode/components/codex/composer/NativeModelSelector.tsx) 与 [NativeModelTrigger](../../../apps/web/src/session-mode/components/codex/composer/NativeModelTrigger.tsx) 只派生成功未知分支的选项和显示；没有改线程 owner、菜单焦点／复位、提交或服务等级。`nextReasoningEffort`、ReasoningEffortSelector、ConversationMenu、所有业务 store／后台／shared 均未改。修改前已阅读 [会话内存约定](../../session-memory-contract.md)；新增订阅只持有布尔值，不增加正文引用或外部监听。

旧数量测试中“成功未知模型五点”的兼容期望已显式迁移为六点，只有该测试标题与一个数量断言变化，原 medium→high 断言及其它旧测试保留。这是已证明原版规则的行为迁移，不能删掉该对照来使新测试通过。

## 红绿灯与实际验收

| 验证 | 结果与范围 |
| --- | --- |
| 首轮新八项真实基线 | **3 RED／5 对照通过，3.83 秒，exit 1**；目标为 low 邻位、xhigh 邻位和 none 的只读显示，11 个 soft 断言失败，无夹具错误或重跑 |
| warm-provider-error 对照 | 追加第九项，真实 refreshProviders 拒绝后 loaded 仍 true；**1 基线通过／8 未选中，3.06 秒**，不是新增产品红灯 |
| 初版相关单测 | **8 文件／167 通过，21.47 秒**；另批模型缓存 UX **1／1，1.12 秒** |
| 初版类型与构建 | web build **通过，exit 0**，含 shared／web tsc 与 Vite 44.39 秒 |
| 初版正式浏览器 | **14／14 通过，1.2 分钟，exit 0**；2840 源、26 E2E／夹具、3 infra、72 shared 共 **2941** 条源哈希前后稳定 |
| 完整原 hCa 单次复验 | **实际完成，exit 0，无重试**；未知 model、count6、自然 simple；根另复核 **54／54** 项 |
| existing-thread null 后续红灯 | 独立新增第十项，**1 RED／9 未选中，3.07 秒**；两个 Trigger 显示断言失败，菜单／raw null／defaults／草稿均通过 |
| null 修复后最终单测／构建 | **8 文件／168 通过，21.36 秒，exit 0**；web 类型／构建 **通过，exit 0**，Vite 48.35 秒。模型缓存 UX 的单独一例未改、未无故重复 |
| 最终正式浏览器 | **42／42 通过，3.5 分钟，exit 0，无跳过**：追加 null 后的18例，加 persistent16／known数量8；最终2941条输入哈希与源目录清单前后不变，独立离线证据复核15043项通过 |

原始 RED 在 `model-unknown-efforts-r18-red/`；初始八例仍为后续测试的完整字节前缀，root 只追加 warm 与 null 两例。第九项最初执行命令的输出路径写错，shell 在测试启动前退出；修正后的实际日志才是上表 GREEN，不计产品失败。

初版 [正式 E2E](../../../tests/e2e/session-model-menu-unknown-efforts.spec.ts) 通过真实四个目录 adapter 读取完整三 Model／provider／other／presets，先确认 loaded／完整 raw cache 才操作。unknown low／xhigh／none × 两宽 × 主／展开十二项，加 custom none 两项。custom 使用真实合法 provider 数据，并与 only-medium 的 OpenAI 项同名，不能靠改 cache 模拟隔离。

浏览器使用绑定 `0.0.0.0` 的隔离 **HTTP `http://10.30.0.24:48865/`**；所有 API／WebSocket 由 fixture 接管，已有 ux-0 是明确目标，不 fork／resume／发送。真实 Tab／Enter／Arrow／Escape／展开 Back 只更新 ux-0 的 effort，独立 defaults、其它线程、草稿和 raw 目录 identity 保留。证据先落 JSON／PNG 再断言；Vite fixture 诊断保留，入场截图不是稳定态像素一致性证明。390×844 是 mobile／触控模拟，不是实体手机。

初版日志与结果为 `model-unknown-efforts-r18-browser/browser-run.log`／`browser-run/`；`initial-run-receipt.json`、`round18-unknown-efforts-initial-source-verification.json` 保留初版冻结，不倒写 null 修复。随后独立审计与追加四个 null 场景另封存。

初版独立审计为 `actual-verification-initial/`，**3371／3371** 项通过：14 JSON、126 状态、42 PNG、56 次四目录实际读取及308组 source before／after／current 比较，22份当前源逐字副本另存。六张代表 open 截图已逐张查看，不能由此提升为稳定态像素一致性；该版尚未覆盖 raw-null。

最终 spec 只追加一个 null variant（两宽 × 主／展开四例），Case 允许 null，并仅对该新场景将全局默认初始化为合法 medium；ux-0 本身明确保存 null。其它14例的输入和断言经五个精确变换机械复算保持，见 `prepared-final/old14-preservation.json` 及 `initial14-to-final18.patch`。最终 source manifest 是 `round18-model-unknown-efforts-final-source-manifest.json`，仍为2941项；相对初版只改变 Trigger、追加单测和该 spec 三条记录，没有覆盖初版清单。

最终实际日志为 `browser-run-final.log`，独立审计为 `actual-verification-final/`：42 JSON、368 状态、112 PNG 完整，实际抽看12张；新18／保留16／保留8分别按22／23／12条输入核对，共860次 case-input 比较一致。全部2941条清单、四源根2840文件及244份既有执行／封存输入均无漂移；15043是离线证据检查数，不是另跑的测试数。新18及persistent16的窄屏为390×844；旧数量8的窄屏为390×1000、coarse=true，且没有新组的trusted-event observer，不能混称同一设备参数或事件证据层次。

根最终收据为 `round18-model-unknown-efforts-final-receipt.json`，SHA `b4014c055dc0bc896da5b11b86bc89674e39e95c884b70900c7c89cc6402290e`；独立审计seal为 `3ea158ccb875e3aa5ad3005d1e2d3f0beb0d1b9b5f80da162d1a483c7928c4a2`。源码最终复核保存在 `round18-unknown-efforts-final-source-verification.json`。中间 review 曾将八值 picker Set 错抽为六档数组，最终 review 已用精确导出声明纠正这个观察元数据错误；产品常量一直是六项，旧seal没有改写，也不把该错误计作产品红灯。

## 完整原组件运行证据

全新私有 **HTTPS `https://10.30.0.24:46031/`**（已关闭）只把成功 R17 输入中的 config/read.model 改为目录外 `fixture-unknown`。原 catalog／current medium／无登录／Router／controller／RPC／driver／资源预算与清理规则保持。完整原 hCa 的磁盘字节不改，Main HTTP 响应只追加导出；不是重建一个近似组件。

三个实际 config/read 交付均为 unknown／openai／medium，model/list 交付完整三模型且没有 unknown。committed `lCa` 为 `{model:fixture-unknown,count:6,menuView:simple,selectionMode:model}`；三个时点均有一个 slider，active 是 Select model。既有 DOM 有六 tick、range 0..5／now2、`Custom Standard, 3 of 6.` announcement 和 Custom／Medium header。

**观测器未保存完整 effort 数组，DOM 也没有六个名称；精确顺序仍归静态来源，不能称已逐档运行原版。** 此次 effort 始终 medium，max／none／null 不是此次原包运行输入。208 ledger 连续且同体、页面／控制台／网络错误为空；15 执行输入与 12 官方资产哈希保持，RSS 峰 675.71 MiB。七个已证明归属的 PID/start ticks 退出，HTTPS 46031／WS 37053 拒连；根只读复算见 `model-unknown-efforts-r18-implementation/root-original-verification.json`，没有第二次运行。

## 显式 null 与其余边界

直接 existing-thread null 不能与新草稿 config-null 混称同例。原 `iPn` 在非空 thread model 时保留 thread effort 为 null；到 hCa 的 `Z6r(null,gt)` 后才派生 medium，lCa／uca／oca 在闭合 trigger 调用 Jsa(medium)。原新草稿 `YNn` 对 config-null 则可能先使用 catalog 默认 high；这不构成本页的直接 thread-null。

初版 Trigger 的 `options && reasoningEffort` guard 对 null 跳过 helper，形成菜单 medium／触发器“默认”的真实不一致；第十项 RED 使用实际 hydrateThreadModel 的合法 null、另一默认 high 和真实 hook 验证，没有把全局配置设成 null，也不因显示修复写回 null。修复只让成功未知分支的 null／undefined 进入现有 helper；已知／custom／pending／error 的旧 guard 保留，Selector／helper／useModels 此次均原字节不变。十例与真实 RED 副本完全相同，旧九例仍为完整前缀。

原 null 链静态证据另见 `model-unknown-efforts-r18-null-reference/`：31精确片段、16完整函数体与6个alias token实装同体、12输入不变；没有再次运行原包或把该静态链计入前述 medium probe 的运行覆盖。独立中间 review、null RED 与最终 review 分别保留，不用最终结论覆盖最初发现。

已知模型的 null、custom 的全部回退、原 Custom 显示名称、`.id` 与 `.model` 不同的匹配、跨模型预设／Default／持久 UI mode 仍不据此宣称通过。真实认证宿主、物理设备、正式运行产物启用、跨客户端 CAS 与 [Goal 附件注册归属](goal-parity-acceptance-20261016.md) 保持原独立边界；没有停止或重启正式 Agent。
