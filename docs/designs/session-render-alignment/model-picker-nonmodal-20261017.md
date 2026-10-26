# 模型菜单的非模态输入与展开编辑边界（2026-10-17）

本节记录 E12 的产品改动、合格红绿与兼容验收：普通 OpenAI 模型菜单不再拦截同输入区第一次真实点击，展开编辑仍保留外层 Dialog 的背景保护。相关单测、浏览器、类型、生产构建与状态检查均已完成；阶段冻结及放行以 Root 的输入快照和独立审查后的外置 release 收据为准。

## 改动后的交互

会话模式中，OpenAI 模型菜单打开时，原模型按钮和同一输入区编辑器保持可交互且可被辅助技术访问。用户第一次点击仍然打开的原按钮，会关闭菜单；第一次点击菜单外、同输入区的实际编辑器空区，会关闭菜单并自然聚焦该编辑器。不能把关闭菜单之后才发生的 click、命中或第二次点击当成这次首个 pointerdown 已经到达。

真实展开编辑 Sheet 内采用相同的内层模型菜单规则。外层 Dialog 继续锁住其后的工作台并隐藏背景 AX；Sheet 自己的按钮与编辑器保持可达。展开后物理 owner attribute 实际为 null，测试没有补造该属性，而是分别核对实际 Sheet、捕获的原节点与生产 reader 中的逻辑草稿归属。

本次只改 [NativeModelSelector](../../../apps/web/src/session-mode/components/codex/composer/NativeModelSelector.tsx) 的四处字面逻辑：为每个打开层捕获 modal 值，OpenAI 为非模态；将原始 modelProvider 纳入作用域身份，使 provider 变化关闭旧层；Root 使用已捕获的层策略。非 OpenAI provider 保留模态行为，custom-A→custom-B 也会结束旧 provider epoch。层已打开后，目录读取由 success 变 error 不重解释现有模态策略，也不以换层清掉焦点。首次主目录 pending 的禁用 Loading 控件保持原样；已接纳的错误、未知模型、空 effort 列表及辅助目录 pending 均不被借作新的全局禁开条件。

设置、模型/强度选择、FI、Default、Power、wheel、recent、owner、350ms 视图复位与草稿逻辑均保留。Common Tooltip、Trigger、CSS、ct/H/S、共享 Radix primitive 和后端没有改动。这是本应用的菜单适配；原版固定资产中非模态调用的源码依据不等于已经实测官方 GUI 或实际账号权限。

## 核心红绿与观察器修正

新增 12 项真实组件单测使用生产 store、useModels 和真实 Radix/ComposerSheet。旧 Selector 实际为 10 FAIL、2 PASS；控制项是首次 primary-pending 禁开和非 OpenAI 模态。修正后的相关单测单批 47 文件、695 项全部通过，其中已包含这 12 项，不能再把 12 叠加为另一个总数。产品后的 web 类型检查通过。

浏览器核心使用同一个 V3 测试的 1440×900 主输入和真实 Sheet 两例，每例完成原按钮 A 和原编辑器 B 两次真实可信左键、无 Ctrl 的首 down。旧产品完整两例在全部硬保护和清理完成后形成合格行为 RED：26 条比较中 18 条失败，主输入的首 down 落在 HTML，Sheet 则落在外层 overlay。只提升四处 Selector 改动后，同字节 V3 两例全部通过：四次首 down 均到达捕获的原 Trigger 或编辑器，down/up 后菜单关闭，B 自然聚焦原编辑器；主输入不加 body 锁，Sheet 的外锁和背景 AX 仍在。

两例共记录 30 条状态，其中 28 条直至各自 final-main 执行完整硬保护，两条 finally 仅为诊断。全部 26 条行为比较通过，目录四读取每例各一次，源哈希、原始目录对象、A/B/default 设置、草稿、运行状态及归属保护通过。每例自有 SSE 的 accepted、finish、close、ownerEOF 各一次，零活动连接、错误和清理失败；两条已知 Vite WebSocket 诊断保留，并非 console 全空。目录 model/list 的 POST 是读取，不能把业务写被拒绝概括成“零 POST”。

早期结果单独保留。最初 OLD2 批次只有 main 形成完整行为 RED，Sheet 的原观察器限额 8 小于原同一 Trigger 在可信 mousedown 后实际产生的 9 个 CSS transition，未完成两次动作及后置硬保护，不能补算为完整产品 RED。随后单独 Sheet 诊断保留限额 8，只补详细动画信息，同样不是产品验收。V3 才将有实据的观察容量改为 16 并保留每项类型、属性、同节点身份和实际计数；动作、等待、物理/AX/焦点判据、业务硬保护及清理不变，且逆差可恢复完整旧测试。完整 V3 OLD2 之后才允许产品提升。

Root 实际查看了主输入与 Sheet 两张 GREEN 菜单截图；这两图未见新的裁切或叠盖，仅证明所看视图，夹具中的空会话画布不被据此判为产品白屏。

准备期还有一项未执行的夹具错误：原 unit 使用当前环境不存在的两个 JestDOM matcher，V2 只换为真实 button.disabled 与 aria-label 属性负控。该属性读取不冒充计算可访问名称，浏览器继续核真实 AX。此静态纠正没有产品 RED 的含义。

## 兼容与交付记录

核心 GREEN 完成后才迁移两个旧 AX 浏览器 spec：保留同一节点的实时可访问名称断言，要求打开的 OpenAI Trigger AX 可见，删除旧模态状态下以空名称兜底的分支。原 phase、动作、等待、设置/源/清理保护保持；它们是兼容控制，不能反过来充当旧产品核心 RED 的 oracle。

兼容浏览器九个 spec 单批 76/76 PASS，耗时 735.599131 秒，零重试、零跳过；实际场景 ID、顺序与多重性和 discovery 相同，原 67×30s、8×90s、1×60s timeout 保留。连同核心两例，本轮当前 78 个不同场景通过，单测数与多批红绿执行不加入此场景总数。

该兼容批次有 69 份原始 JSON、962 条状态记录及 7941 条显式比较；这些是诊断或断言记录，不是额外测试数。67 例源输入首末相同，自有 SSE accepted、ownerEnded、finish、close 各 67，零活动资源和清理失败；67 条已知 Vite 诊断逐条保留，意外诊断为零。Side 两例有正向 fixture fork／权限写入，不使用此 SSE helper；Goal 七例直接断言正向写入，没有同口径 JSON／SSE。因此不能声称 76 例全局零 POST、全部都采了 JSON 或统一采了 console。

Root 聚合器最初按不存在的 repeatEachIndex 字段读取报告，随后按实际 schema 的 id/projectId/projectName 序列核对；源、报告和用例未改，这属于只读记账错误，不是产品 RED。唯一后置生产构建在全部浏览器批次之后通过，耗时 74.772446 秒，原 dynamic-import／chunk-size warnings 保留；session:status 通过，耗时 1.450482 秒。

本机核心证据位于 `.dev-runtime/session-polish-round2-20261016/model-picker-nonmodal-r28e12-root/`：`browser-v3-old-selector-qualification.json`、`browser-v3-product-green-qualification.json`、`unit-green-related-receipt.json`、`compatibility-admission.json`。17 条 run-checked 命令的输入 maps 与 HEAD 均保持各自 epoch 不变；其中 13 条 exit0、4 条 exit1，后者分别属于旧单测行为 RED、混合 OLD2、Sheet 容量诊断和完整 V3 OLD2。五批实际浏览器共 83 次执行，当前通过的不同场景仍为 78；发现、诊断或重复红绿不增加场景数。浏览器未与TS类型检查或生产构建重叠；related Vitest与核心GREEN2实际并行，不能称17条全串行或CPU互斥。最终输入冻结及阶段放行另有收据，不能以本文或单项 PASS 替代。

局域网联调沿用 HTTP `http://10.30.0.24:48865`，原版参考页为 HTTP `http://10.30.0.24:37575/native-goal.html`，网关健康路径 HTTP `http://10.30.0.24:8282/api/session/health`；最终只读记录中三者均为 200。前端与参考服务绑定 `0.0.0.0`，实际同网物理设备连通性未证明。正式 runtime PID/start ticks 仍为 `2712539/55361120`，前端为 `217746/112857665`，参考服务为 `2973318/111490242`；三者 cwd/argv 与初始记录相同，正式服务 ready，磁盘新产物未激活，没有停止 Agent 或切换运行实例。

## 尚未覆盖的边界

本次核心浏览器为桌面主输入/真实 Sheet，手机尺寸控制若通过也只代表浏览器模拟。没有物理手机或官方 GUI 实测，没有新内存长测、当前 RSS 平台或 native 原子权限证明；没有重启、替换正式 runtime 或接管 Agent。ct、完整 Dca/private grace 仍是后续独立工作；R29 接线缺口将在下一阶段实际修复，无需新增用户许可。本轮不宣称整个目标或所有菜单交互已经完成。

本文作者参与了 E12 测试文本准备；此文是按原始实绩和公开合同整理的交付记录，不自称独立实现 oracle。最终阶段放行以独立审查后的外置 release 收据为准。
