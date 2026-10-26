# 模型行选择后的视图与焦点（2026-10-16）

普通模型列表行接纳选择后，菜单保持打开并请求返回强度视图；Enter／空格操作聚焦该视图第一项，指针操作保持菜单容器焦点。目标最终只有0／1项可选强度时仍显示高级列表，并保留行焦点。本批只修复这些视图与焦点规则，不引入跨模型预设、Default 或持久 selectionMode。

前端验收入口为 **HTTP `http://10.30.0.24:48865/`**，绑定 `0.0.0.0`；业务 API／WebSocket 由独立 fixture 接收。390×844 为手机／触控模拟，未验证实体设备或认证扩展宿主。

## 原版合同与最小实现

完整原 `ssa` 的 radio `onSelect` 先 `preventDefault`，仅在未选中或锁定时调用该行回调，然后无条件请求 `h('simple')`。hCa 另以最终 `powerSelections.length < 2` 强制 advanced，两层不能混为“选择后总是 advanced”。普通行不调用关闭并回 composer 的 Fn，Escape 是另一条路径。

原 ssa 在 Enter／空格时保存当前 view，实际 view 改变后选择已选 radio 或第一项；pointerDownCapture 清除该键盘标记。实际 view 没变时不因此再聚焦菜单。原 `lCa` 对当前模型、且当前 effort 被支持、tier 有效或为空的普通行不重复提交 pair；这不等于所有无效／null effort 或 tier 都可宣称不写设置。

只读源证据为忽略目录 `.dev-runtime/session-polish-round2-20261016/menus/model-advanced-selection-r19-audit/`：8个原父片段、13个精确摘录与当前原资源字节一致，17个产品／测试输入稳定。跨模型完整前置合同另见 `model-power-presets-r19-plan/`；这些静态结论不冒充真实原包运行。

[NativeModelSelector.tsx](../../../apps/web/src/session-mode/components/codex/composer/NativeModelSelector.tsx) 的 choose 由保持 advanced 改为请求 simple。render 和既有焦点 effect 共用 `showAdvanced = advanced || !canAdjust`，因此0／1项下只改局部请求不会新增焦点 RAF。普通模型行的 Enter／空格记录键盘意图；实际返回 simple 时聚焦第一项。菜单内容的 pointerDownCapture 清除旧意图，保留既有 owner、可见性、scope 与 RAF 取消保护。

原 pair setters、nextReasoningEffort、service tier、recent、线程／默认设置、目录请求与缓存均不改。该共享行修复也使已列出的 custom provider 模型行回 simple，其原五档和设置语义保留；不能称 custom 的视图行为完全未变。unknown 额外 checked 行、手输 ID、recent 路径不经过 choose，未在本批补齐。

## 红绿灯与验收记录

| 门禁 | 实际结果与边界 |
| --- | --- |
| 首次夹具运行 | 11失败中，9项在行操作前被混用键盘打开／缺 pointerDown 的点击前提挡住，另2项已到达真实 view 失败；完整日志保留，不计11个产品红灯 |
| 修正输入后的基线 | **8 RED／3对照通过，12.70秒，exit 1**；产品原字节不变，8项都在最终 advanced→simple 断言失败，之前的 owner／raw／四API／defaults／草稿控制通过 |
| 初版修复 | 新11项 **全部通过，4.44秒**；随后10文件／180项通过，22.52秒，初版web类型／构建通过，Vite48.80秒；下述指针标记问题仍属于该版 |
| 指针标记追加反例 | **1 RED／3延迟控制通过／11未选中，3.74秒，exit 1**；真实 warm-provider 失败后点 Retry，目录1→2，40ms后错误聚焦caption，设置／owner／defaults／草稿及9次精确读取通过 |
| 最终相关单测 | **10文件／184项全部通过，22.71秒，exit 0**；包括原键盘、快速重开、指针锁、数量、persistent、unknown／null及新15项 |
| 最终web类型／构建 | **通过，exit 0**，含shared／web tsc及Vite46.33秒；对应184单测的最终源码 |
| 正式浏览器首批 | **38通过／4失败，3.8分钟，exit 1**：原初焦点16／指针锁6全部通过；新20中的4项在最后的触发器click断言失败，真实视图和焦点三个时点均正确。2943条输入冻结，原始结果保留 |
| 浏览器断言修正后 | **新20全部通过，2.0分钟，exit 0**；仅一处click→pointerdown，产品与其余2942输入不变。两批共执行62条（58通过／4原夹具失败），旧22＋新20共42个不同场景最终通过；新20全部重跑，其中16个此前已通过，不能称单次42全绿或58个不同场景 |
| 完整原 hCa 行选择 | 首次候选因open-trigger Enter超时未取得选行观察，exit 1；保留失败。新候选恢复原打开350ms后实际exit 0，真实三次Enter得到simple→advanced→simple，选行后三时点均聚焦简洁首项，菜单仍打开 |

[新增单测](../../../apps/web/src/session-mode/components/codex/composer/NativeModelSelector.selection-view.test.tsx) 保留真实 useModels／cache、四目录 adapter、Thread／Config stores、Trigger 与 Radix；只 fixture 外部目录读，fetch 失败封闭。主／展开、pointer／Enter／Space、相同／不同模型、自然0／1项→两项、两项→0／1项及 raw2过滤1均覆盖。当前项零设置变化控制使用被 raw 支持的 medium 和空 tier，不能外推 null 或无效设置。

首轮输出重定向路径写错时测试未启动；修正根目录路径后才有首轮实际运行。随后只补 caption pointerDown 纠正输入前提，再取得8个真实红灯，没有为挑绿修改产品。`initial-mixed-input-precondition.log`、`initial-input-classification.json` 与 `corrected-red-classification.json` 分别保存，不能把夹具错误混入产品故障数。

初版遗漏菜单其它按钮的 pointerDown 清理。本轮进一步用真实 refreshProviders 第二次拒绝产生 Retry，保留 loaded=true；随后真实 pointerDown／click Retry 读取新完整目录，models／other／presets各2次、providers3次，没有手填 error 或 cache。该真实追加红灯确认旧键盘意图会迟到影响指针操作，修复才将清理提升到整个菜单内容，匹配原 ssa pe。三项0／1控制另等待40ms核对行焦点。原11例在仅移除新增 act 导入后仍为最终测试的完整字节前缀，追加反例与此前两个版本均另存。

最终源码的独立只读审查位于 `model-advanced-selection-r19-implementation-review/`，seal为 `b345cde2ca7149538f169cf9d8770aab676679f5e59eb63a0198d1df28a30e45`；这里只核对源码、真实红绿灯和184／构建的完成收据，没有提前计绿浏览器。`round19-model-selection-view-source-manifest.json` SHA为 `3bdfb83b652fb2b70430219aacd0884bae5a9a698645cbcaea7806b9f144126f`，相对R18只改变Selector并新增一份unit和一份E2E，没有store、后端或共享代码变化。

原版首次 `full-hca-selected-row-r19-probe/` 的完整来源校验、无登录闭合RPC／controller／原编辑器就绪均通过，但尚在打开按键阶段就超时，未产生stages或最终samples。新driver把原应350ms的打开Enter意外按75ms执行，root审查也漏检；不能据此推断原版行选择结果或断言缩短预算一定是超时根因。该次208项ledger、零页面／控制台／拒绝网络错误、669.078125MiB峰值RSS、自有浏览器六身份退出与监听关闭均保留。新候选只能恢复原打开350ms，保留post-open按键75ms／225ms步骤、4秒peer窗口、资源和cleanup预算；不能放宽原门槛、覆写旧失败或在旧目录重跑。

`full-hca-selected-row-r19-v2-probe/` 在全新目录只执行一次，真实Tab抵达触发器后，三个Enter分别打开、进入高级列表、选择当前普通模型行；没有手动focus或覆写菜单状态。初始原lCa为已知模型、3项强度、simple及model选择模式；选行后首次关联、两个真实RAF及约200ms三个采样均为simple、首个启用menuitem（Select model）持有焦点。草稿设置和编辑器文字前后相同。208项连续通信记录与NDJSON相等，零页面／控制台／拒绝网络错误，峰值自有树RSS为668.77734375MiB。root另行复核15输入、12官方资源、完整hCa原跨度、自有7个运行身份与两个端口退出等66项全部通过；未以SDK手工灌入状态或调用原生CLI，结果不外推完整账号／IDE、跨模型pair或其它行类型。

另一份独立执行审计在 `full-hca-selected-row-r19-v2-execution-audit/`，141项证据核验通过，seal为 `547fcf8026dee7c9803019d8b77b82e06e6773ed5b93b69afb8cdbb44a1bffac`；这些是离线核验数，不是浏览器运行次数。最终三个页面时钟为4241.1／4281.1／4465.3ms，末样本比首样本约晚224.2ms；不声称精确200ms或动画结束。关闭前bridge已inactive且pending为0，原RPC释放sink；statsig仍有一个页面订阅元数据，不能称全部订阅都收到unsubscribe。随后context、自有浏览器树和监听均已关闭。

首批4个浏览器失败均来自测试把Radix指针打开合同误写成“触发器必须收到click”。实际每例均收到一次可信pointerDown；打开菜单后click目标已在触发器外。caption与模型行各自的可信click、owner／设置／四API控制以及即时／两个RAF／约200ms的simple和容器焦点都已满足。只将触发器这一处事件类型改为pointerdown，保留次数、目标、其它事件和全部行为断言；原38／4结果不重标为全绿。

首批独立复核封存在 `model-advanced-selection-r19-browser/actual-verification/initial42/`，seal为 `b0944aa4b301657ef8e6804e88c3911da1a989407cc01a47f6949f24e5f59487`；42份主JSON、444状态、100PNG与2943份输入副本保留。纠正后spec为 `fec14dcc82877272832043aac9484f3b0bf7642fa891248210aae621e610e03f`，list20与定向tsc实际exit 0。新冻结 `round19-model-selection-view-corrected-source-manifest.json` SHA为 `b40bf8b0eca0fe1fc55ebfe50a0777a986e9ae08c4b002ad3a1c60cbc50a8450`；相对首批仅该一处测试字面量改变，产品仍为184单测及web构建对应版本。新20实际完成后root再次核对2943条输入全部稳定，收据 `round19-corrected20-source-verification.json` SHA为 `81384175ccb597374cdd422d7b9124d4960b8b034734a1348e66adfa77136663`。

新20的独立封存为 `model-advanced-selection-r19-browser/actual-verification/corrected20/`，seal `0668fb009d701da9a059a3bb59e630044d33e6cd2a3b08977a7f36ac6ce55b24`。20份主JSON及20份附件、270状态、64PNG完整校验，实际查看12张代表原图；13572项离线证据核验全部通过。2943源码与副本相同，3152条历史／执行／准备文件保持，未再改产品或扩大实验。源冻结里的计划字段“重复16”指此前已通过后再次通过的16例；实际新20全部重跑，另4例在断言修正后首次整例通过。不能用离线核验数冒充浏览器测试数。

所有临时记录位于 `model-advanced-selection-r19-red/`、`model-advanced-selection-r19-implementation/`。没有重启正式运行服务或 Agent，没有恢复 [Goal 附件注册的待核对改动](goal-parity-acceptance-20261016.md)。全会话模式及完整原生账号／权限／跨客户端边界继续按原计划推进。

本分项完成收据为 `.dev-runtime/session-polish-round2-20261016/round19-model-selection-view-final-receipt.json`，SHA `9f9363c344a03226e926958af7d27dc2b674874312abb4588cb0b5e13f098d01`；root最终复核2943源码输入及2957个独立审计封存文件均无漂移。`stageComplete=true` 仅指本分项，`overallGoalComplete=false`。下一项unknown可见名称的只读审计和13例RED候选仅封存在忽略目录，尚未应用或执行，不能算作已修复。
