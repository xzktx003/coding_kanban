# 模型菜单 persistent 过滤与显示回退（2026-10-16）

本批修复已知 OpenAI 模型将 `persistent` 暴露为菜单档位的问题。主／展开输入、侧边模型面板及会话的提高／降低／循环强度操作，统一从原始目录派生原版允许显示的八种强度；目录与已保存设置保持原样。打开菜单不补写模型、强度或服务等级。已配置 `persistent` 且目录含 medium 时，主触发器和强度控件按原链路显示 medium，只有用户明确选档才写设置。

这是有效目录输入的组件对照和产品修复，不能推断真实账号当前使用该配置。原版跨模型预设、用户启用强度／ultra gate、未知模型 fallback 等仍是独立工作；当前真实网关的 Goal 附件接线与正式运行层启用边界见 [Goal 验收](goal-parity-acceptance-20261016.md)。

## 原版依据

参考为当前仓库官方 VSIX `26.51007.21434` 的 Main／Native 资源。`yC` 识别 `none/minimal/low/medium/high/xhigh/max/ultra/persistent`；`dQ` 与 `gJr` 明确过滤 `persistent`。因此 UI 允许的集合是前八项，顺序来自原目录；不是按强度名称排序，也不是删除目录中的原始条目。`gJr` 在无可展示项时补一个 medium 显示占位，不代表目录广告了额外能力。

`persistent` 不是损坏数据：Native 的 `iU` 在显式及默认 enabled-efforts 路径都保留它，随后进入 `FJr`。离线 CLI schema 的 ReasoningEffort 是非空字符串，**没有 enum**；上述九值来自 UI 的 `yC`，不能混称协议枚举。

显示链为 `Z6r → s2e → JNn`：值若不在展示选项中，返回原 `Mzt='medium'`。Main／Native 的 import/export alias 与初始化片段均单列核对；普通打开不因此修复存储中的配置。原版可能初始化独立的 picker selection-mode 偏好，这也不等于模型／强度写入。

精确来源在忽略目录 `.dev-runtime/session-polish-round2-20261016/menus/model-cross-presets-r17-reference/persistent-branch-evidence.json`，保留十个新增及七个复用片段、完整源文件哈希和三种半开区间。独立实现审查重新计算 **17／17** 片段及原文件哈希；没有执行原包来得出这些静态结论。

本批同时按 `$reverse-engineer-anything` 实际运行 `analyze_javascript_application`，输入为六个精确原片段组成的 **996-byte、两文件有界载体**，没有拼接成完整程序或执行 JS。结果为 318 AST 节点、零解析错误、58 个语义未知；`application complete` 只限该载体。记录为 `menus/model-effort-filter-r17-reference/rea-summary.json`，summary evidence 为 `ev_2e95aad95add8f54c19abc725be5674fb5ab8af2f8c6a3b222f34d6e5f3e0e2f`，parent 为 `ev_f03a0893a1cdaae9db817d1300ab5a9b9edb4384982c023feea96f8a410ed907`。import alias／初始化的结论仍依赖另外保存的原片段，不能从有界图推导完整应用运行行为。

## 产品范围

[nativeReasoningOptions.ts](../../../apps/web/src/session-mode/components/codex/composer/nativeReasoningOptions.ts) 只过滤并复制选项值，保留原顺序，不改变 Model、数组或缓存身份。显示 helper 只返回当前合法档或 medium，不调用 setter。

- [NativeModelSelector](../../../apps/web/src/session-mode/components/codex/composer/NativeModelSelector.tsx) 使用过滤后的数量决定 simple／advanced；raw `[medium,persistent]` 只剩一档，因此自然 advanced、无强度滑条。
- [NativeModelTrigger](../../../apps/web/src/session-mode/components/codex/composer/NativeModelTrigger.tsx) 对已知 OpenAI 模型使用相同显示派生；自定义和未知模型保持原行为。
- [ReasoningEffortSelector](../../../apps/web/src/session-mode/components/codex/composer/ReasoningEffortSelector.tsx) 的真实侧边面板只展示过滤后的档位。`nextReasoningEffort` 未改，合法 raw 配置不会仅因打开界面而被修复。
- [ConversationMenu](../../../apps/web/src/session-mode/components/codex/composer/ConversationMenu.tsx) 的提高／降低／循环操作使用同一过滤规则，已有当前值处理和步进算法不变。

没有新增请求、全局监听、timer 或模型缓存；thread／draft owner、菜单焦点／350ms 复位、store、网关、SSE、历史和 shared 均未改。侧边仍使用独立 ModelReasonSelector；没有将主触发器的全局 currentThreadId 逻辑推广到侧边。修改前已阅读 [会话内存约定](../../session-memory-contract.md)。

## 红绿灯与验证

| 验证 | 结果 |
| --- | --- |
| 新 Native 五例的真实基线 | **3 RED／2 对照通过，3.61 秒**：raw2 错误显示 simple、raw3 多出 persistent／键盘选错、configured persistent 显示与位置错误 |
| 真实侧边面板与会话菜单基线 | **2 RED／93 通过，22.235 秒**，两份旧文件只追加用例；另追加 configured persistent 显示用例，独立 **1 RED／15 未选中，2.98 秒** |
| 修复后直接相关单测 | **7 文件／158 通过，20.69 秒，exit 0**，含旧键盘、指针锁、数量、侧边与会话菜单回归 |
| web 类型与生产构建 | `pnpm --filter web run build` **通过，exit 0**；shared 编译、web tsc、Vite build 43.85 秒，既有 chunk 提示保留 |
| 独立实现审查 | 17 原片段、四份精确产品差分、历史 RED seal 及旧测试前缀完整；没有 raw/cache repair、owner、I/O、timer、store 或 backend 改动 |
| 原版完整 hCa 有界复验 | **一次完成，exit 0，无重试**；实际 raw2 → power1、自然 advanced，三焦点样本完整；根线程另复算 **44／44** 项 |
| 产品正式浏览器 | **16／16 通过，1.4 分钟，exit 0**；独立只读审计 **4058／4058** 项通过 |
| 已有相关浏览器 | 首批 **36 通过／4 跳过，3.5 分钟**；补上传漏的原版 URL 后，Goal 对照／完成 **7／7 通过，51.5 秒**；覆盖原 40 个不同场景，三个完成用例重复验证 |

六个真实失败来自**三次独立基线执行**，不称单次六红。Native 首次夹具错误使用被 Radix modal 隐藏的外部 textarea role 查询；修正只改为原 label 查询后才获得上述 3 RED，该初始测试夹具失败另存，不算产品红灯。`menus/model-effort-filter-r17-red/`、`model-effort-filter-r17-other-entry-red/` 和 `model-effort-filter-r17-implementation/` 保留原日志及前后源码；产品修改后未削弱旧断言。

Native 五例保留真实 `useModels` 读取与共享缓存：完整 Model／数组 identity、独立深拷贝、四个只读 API 调用、无 fetch／设置／提交及草稿均有断言。侧边组件单测使用 mocked useModels，不能单独冒充实际缓存链证明；正式浏览器另从真实 adapter POST 读取完整目录。

浏览器入口为 [session-model-menu-effort-filter.spec.ts](../../../tests/e2e/session-model-menu-effort-filter.spec.ts)，使用绑定 `0.0.0.0` 的隔离 **HTTP `http://10.30.0.24:48865/`**。主／展开 × 三种输入 × 1440×1000／390×844 共十二例，另有真实侧边面板、会话提高强度各两例。侧边仅在 setup 显式允许一个 fixture fork，后续业务写入全部拒绝并记录；不是原生任务。API／WebSocket 全部为隔离 fixture，390 是触控／mobile 模拟，不是物理手机验收。

正式日志为 `menus/model-effort-filter-r17-browser/browser-run.log`，十六份实际 JSON 与截图在 `browser-run/`。每例实际 POST `/api/session/api/codex/model/list` 并读取完整三模型目录；没有手工写 cache。所有打开／调整／退出采样均保持 raw 数组和对象身份、原 owner／正文／另一草稿／设置，只有显式选档改变目标强度；四个 limited 场景的普通方向键未改设置。Escape 和展开返回保留原输入，错误与事件记录先落盘再断言。每例保留一条 fixture 关闭 Vite WebSocket 的控制台诊断，不称控制台零错误。开菜单截图处于入场动画阶段，不作为最终像素完全相同的证明。

独立审计在 `actual-verification/verification.json`：16 JSON、146 状态、42 PNG 的 CRC／完整解码／尺寸及 23 输入 × 16 例的 **368 组 before／after／current** 哈希均通过，共 4058 项。16 次目录 POST、两个 side setup fork、零后续业务写入／pageerror／截图错误、可信 Tab／Arrow／菜单 action 与原 owner 保留均逐项复核；八张两尺寸 × 四 surface 的 open 截图已逐张查看。会话菜单截图展示顶部，目标操作的证据是实际可信点击与 medium 回执，不由截图猜测未展示的行。

相关首批日志为 `round17-related-browser.log`。四项跳过的原因是根执行命令漏传 `CODEX_GOAL_REFERENCE_URL`，不是产品通过；原日志保留。随后用 `CODEX_GOAL_REFERENCE_URL=http://10.30.0.24:37575/native-goal.html` 实际执行原版几何四例及完成三例，`round17-goal-reference-completion-browser.log` 全部通过，无跳过或断言修改。与新 16 例合计为 **56 个不同正式场景分三批通过**，不能写成单批 59 例或首批 40／40。

完整原 hCa 另在全新私有 **HTTPS `https://10.30.0.24:42363/`** 执行一次，监听现已关闭；沿用已核对 driver、原 controller/editor 与封闭 RPC，仅在已选第二个模型的合法目录中追加 `persistent`。Main HTTP 响应只追加导出，官方磁盘资源不改。实际 `model/list` request seq184 → delivery187，同 requestId、交付一次，raw 为 `[medium,persistent]`；committed `lCa` 为 power1／advanced／selectionMode=model，三个时点均无 slider、焦点 radio0、checked radio1。当前配置始终 medium，**不是 configured persistent 回退的原版运行验证**。

原版记录在 `menus/full-hca-persistent-effort-r17-probe/execution-findings.md`。208 条 ledger 连续，页面／控制台／网络拒绝均为空，15 输入与 12 官方资产哈希保持；自有进程树 RSS 峰 664.77 MiB，不替代长期内存门禁。runner 与六个已证明归属的浏览器 PID/start ticks 均退出，HTTPS 42363／WS 36227 均 ECONNREFUSED。dispose 采样尚有一条 inactive statsig 元数据，随后 context 已关闭；不由该瞬时状态推断全生命周期。根线程独立 44 项复算保存于 `model-effort-filter-r17-implementation/root-original-verification.json`，没有再次执行原包。

执行前 `round17-model-effort-filter-source-manifest.json` 冻结 **2839 源文件、25 E2E／夹具、3 infra、72 shared，共 2939 项**。相对 R16 仅四个现有产品、两份追加测试变化，新增 helper、Native 五例及一份正式 E2E；原 app.ts 并行删除继续保留。R14 的全量 510 文件、R9 的标准 30 分钟长测不是本批新源码的全量／长期结果。

## 保留边界

configured persistent 的已验显示前提是 known 目录含 medium。若过滤后仅 low／high，helper 返回 medium，但侧边通用 EffortSlider 会将缺失值显示为首项。补查原版 23 个精确片段确认：原版闭合 trigger 可显示 medium，而 slider caption／aria 还通过 `TX` 选择有效默认 pair 或首项，可能 low 或 high；仅有 raw 和 configured 不足以确定最终显示。因此不能把侧边首项显示单凭 helper 值判为 bug，也不能宣称当前主菜单直接显示 medium 已覆盖全部 fallback。该源码边界未运行反例；修改需要另行真实 RED 和原版最终呈现证据，见 `model-effort-filter-r17-unadvertised-medium-reference-followup/README.md`。

本批不实现原版跨模型预设、Default 行、持久 picker selection-mode、完整模型准入／授权门控或未知模型六档 fallback；这些区别已保存于 `model-cross-presets-r17-reference/findings.md`。后续六档和已有线程 null 的分项修复见 [未知模型回退](model-menu-unknown-efforts-20261016.md)，不倒写为 R17 的实施或验收。没有连接真实账号、native CLI／默认 IPC，也未替换正式运行层或恢复未经确认归属的附件注册。
