# 普通提示在指针离开时关闭（R28e11）

本轮三处局部修复已完成实际红绿灯、相关回归、唯一后置构建及只读运行状态检查。新14例与原54例分批通过，构成68个当前通过场景；最终冻结、独立终审与阶段放行以 Root 外置收据为准。

普通非交互提示已改为在指针真正离开触发按钮时关闭，并立即移除自有提示 Content。范围包括模型/Default 主输入与真实展开 Sheet、附件、权限和 Goal 提示；不改变这些按钮的业务动作、设置、草稿或输入归属。

## 产品范围和来源

唯一产品文件是 `apps/web/src/session-mode/components/codex/composer/ComposerTooltip.tsx`，全文由11443字节 `782fcfc…` 变为11495字节 `0afe5df…`，只有三处字面改动：

1. 普通 `onPointerLeave` 继续先尊重子处理器的 `defaultPrevented`，再核对既有 `current(event.currentTarget)` 身份。有效离开调用既有 `close()`；无效身份先 `preventDefault()` 再返回，避免随后 Radix 内部组合处理器绕过本地门禁。这是适配防御，不把保存旧 handler 的合成调用当作真实 UI 缺陷证据。
2. 仅在自有 Tooltip Root 设置 `disableHoverableContent`。Provider、共享 `ui/tooltip.tsx` 与第三方依赖保持原字节。
3. 自有 Content 仅在实际 `open && !popupOpen` 时挂载，普通关闭不再等待 Presence 的退场节点。按钮、ref、可访问名称和原有样式保留。

原版 `v4t` 的普通默认值为 `closeOnPointerLeave=true`、`selectable=false`、`interactive=selectable`、`forceMount=false`；普通 leave 进入 `je()` 关闭，false 分支不保留 Content。vendored 与已安装资产整包哈希不同，但本轮8663字节 `v4t` 切片相同（`1dd00a96…`）。本地使用固定 Radix Tooltip1.2.8，不能据此宣称原版交互式/可选择提示、受控拒绝关闭或全部 Dca 已迁移。[公开合同](../../../.dev-runtime/session-polish-round2-20261016/composer-tooltip-leave-r28e11-public-contract/contract.json)和[产品精确差分](../../../.dev-runtime/session-polish-round2-20261016/composer-tooltip-leave-r28e11-product-preparation/metadata.json)保留来源与边界。

既有200ms冷 hover、实际关闭后的有界300ms窗口、generation/ref提交确认、同按钮身份、跨文档/卸载取消、真实新 hover、popup 抑制、H/S 完成状态及固定 `tooltip.open` 协调逻辑不改。挂载期间的自有 peer listener 与 Provider 有界计时器仍可合法存在，不能把 Content 关闭写成所有 Tooltip 全局资源归零。

## 红灯与观察器更正

首轮 V1 浏览器实际14例均未通过，耗时123.088612秒。其中6例到达晚期行为断言，8例因可见性祖先上限32提前报错且 probe 清理不完整；不能把该批写成14个合格产品 RED，也不补认尚未执行的业务保护。[原始分类](../../../.dev-runtime/session-polish-round2-20261016/composer-tooltip-leave-r28e11-root/old-browser-v1-classification.json)保持不变。

V2 只修被动祖先观察器：容量上限改为96，并完整记录实际 body/documentElement 终点、每级样式和深度；第97级仍硬失败。连接、实际 box/clientRects、hidden/inert/display/visibility及严格正 opacity 规则不放宽，没有改动作、等待、业务保护或目标比较。首批8个主区路径实际达到33层，证明旧32上限不足；96是观察容量，不是产品通过阈值。

在旧 Common 上完整重跑同14例后，全部到达 `final-main` 硬保护，再完成 finally 诊断与清理：163.376807秒、182条状态、280条目标比较，其中224失败、56通过；28条真实指针轨迹、683份完整祖先收据。每例自有 SSE 的 accepted/finish/close/ownerEOF 各一次，零活动资源和清理错误。这是完整合格 OLD14 行为 RED，不与 V1 的6例拼批。[OLD14实绩](../../../.dev-runtime/session-polish-round2-20261016/composer-tooltip-leave-r28e11-root/browser-v2-old-common-qualification.json)区分状态行、比较条目和真实测试数量。

旧产品的新16条单测实际为10条行为失败、6条控制通过：失败均在自有 `aria-describedby` 仍保留的关闭断言，未把类型、夹具或清理错误包装为产品红灯。直接 Radix 正向退出控制先完成；旧 handler 边界仅属于适配测试。[单测红灯](../../../.dev-runtime/session-polish-round2-20261016/composer-tooltip-leave-r28e11-root/old-unit-qualification.json)保留原始分类。

## 实际验证结果

| 实际阶段 | 结果 | 墙钟耗时 |
| --- | --- | --- |
| 新16条单测，旧 Common | 10行为RED / 6PASS | 3.157013秒 |
| 精确产品晋升后的相关46文件 | 683/683 PASS，含同16条 | 79.167312秒 |
| 产品后的 web 类型检查 | exit0 | 27.016487秒 |
| V2同14条浏览器，旧 Common | 14合格行为RED | 163.376807秒 |
| V2同14条浏览器，新 Common | 14/14 PASS | 135.150868秒 |
| 原七份spec的54条浏览器控制 | 54/54 PASS | 530.582886秒 |
| 所有浏览器之后的唯一生产构建 | exit0，原有warning保留 | 74.582513秒 |
| 最终只读运行状态 | exit0，正式runtime未替换 | 0.944057秒 |

新14共记录182条状态；280条目标比较全部通过，28条真实轨迹和434份完整祖先收据有效；四项 SSE 各14、清理错误为0。祖先收据数量随 Content 实际卸载而改变，不是删测试。相关683条已包含新16，不能再累加为699；新旧14是相同场景的红绿重跑。[新14实绩](../../../.dev-runtime/session-polish-round2-20261016/composer-tooltip-leave-r28e11-root/browser-v2-product-green-qualification.json)与[相关单测收据](../../../.dev-runtime/session-polish-round2-20261016/composer-tooltip-leave-r28e11-root/unit-green-related-receipt.json)分开记录。

14例覆盖1440/390视口下的 model/Default 主区与真实 Sheet，以及附件、权限、Goal 的普通提示。自然 hover 离开朝实际提示/间隙移动并保持静止，分别保存下一次观察与350ms观察；键盘焦点保持在同一按钮，未通过脚本 focus、虚假 leave 或等待退场动画来获得通过。附件/权限只验证原入口与 Escape/cancel，未执行文件上传或 Full Access 确认；Goal 不激活清除/状态动作。真实业务保护位于 `final-main`，finally 仅补诊断和晚期清理，不能替代业务终态断言。

新14的写入、外部访问、页面错误、unexpected console和清理错误记录均为空；14例各有一条已知 Vite WebSocket 诊断，完整保留。原54控制实际组成是页脚19、提示协调2、Full Access8、Goal7、完成提示8、打开模型按钮8与Side2，七份旧spec/夹具正文和全部阈值未改；54 discovery与实际报告ID顺序及多重性一致，retry0、skip0。原超时分布为45例30s、8例90s、1例60s，没有为通过而放宽。

原54中47份JSON含660条状态记录；45例的自有SSE accepted/finish/close/ownerEOF各45，清理错误和活动资源为0，这45例源码首末相同。Side2没有该SSE helper，并保留正向fixture fork/权限写入；Goal7由直接Playwright断言验证正向写入，未生成同口径JSON/SSE收据。47份JSON的unexpected console为0，但仍保存45条已知Vite诊断，不把Goal7外推为同口径全局零console，也不把全部68例写成零POST或零业务写入。[原54控制聚合](../../../.dev-runtime/session-polish-round2-20261016/composer-tooltip-leave-r28e11-root/browser-original-controls-qualification.json)保留这些边界。

新14加原54是68个当前不同场景；V1旧14、V2旧14、新14、原54四个实际浏览器批次共96次执行，旧14重跑没有增加不同场景数。16条run-checked命令实际13条exit0、3条exit1，后者分别为旧16单测行为红灯、V1混合失败和V2完整OLD14行为红灯；discovery不算额外通过用例。四轮实际浏览器均未与类型检查或生产构建重叠，唯一生产构建在全部浏览器之后。

## 运行与未完成边界

隔离前端绑定0.0.0.0，LAN HTTP `http://10.30.0.24:48865/`、参考 HTTP `http://10.30.0.24:37575/native-goal.html` 与网关健康地址 HTTP `http://10.30.0.24:8282/api/session/health` 最终均200。只读身份收据确认：正式runtime PID2712539/start55361120、前端PID217746/start112857665、参考PID2973318/start111490242均保持原归属。正式runtime仍ready，磁盘新产物没有激活，没有重启或切换运行服务。[最终运行身份](../../../.dev-runtime/session-polish-round2-20261016/composer-tooltip-leave-r28e11-root/readonly-final-identities.json)与[后置build收据](../../../.dev-runtime/session-polish-round2-20261016/composer-tooltip-leave-r28e11-root/web-build-final-receipt.json)分开核对，HTTP健康不替代新二进制激活证明。

Root实际查看5张原始截图：旧1440主区及新1440主区、390 Sheet、390 Goal和390权限提示；没有把PNG数量计作测试，也没有据此声称全页面视觉完善。[目检收据](../../../.dev-runtime/session-polish-round2-20261016/composer-tooltip-leave-r28e11-root/visual-review.json)保留所看图及限制。源码/测试bookend沿各命令纪元保存；最终源、副本与manifest数量以Root的 `final-frozen-inputs.json` 等冻结记录为准，本文不预造文档晋升后的永久计数。

390视口为模拟手机，并非实体同网段设备验收；没有新增官方 GUI/native 运行、登录/账号探针、运行层激活、停止 Agent 或长期 RSS 测量。ct 指针按下、完整 Dca、交互式 pointer grace 等分项仍独立推进；本轮不改变 dropdown modality，不新增权限资格门，也不宣称整体 Goal 完成。

本文由产品文本准备者整理实际收据，独立测试与联合审查另有记录；不是独立实现 oracle。最终冻结与独立终审由相应收据记录，阶段放行以 Root 外置release为准；本文不提前声明release已存在。
