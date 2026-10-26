# 普通模型选择器提示文案与弹层打开时的提示清理（R28e9a）

普通模型选择器的悬浮提示现在显示操作用途：当前模型模式为“选择强度”，Default 模式为“选择模型”。菜单打开时，共用 `ComposerTooltip` 立即从 React 输出中移除整个提示 Content，避免关闭动画仍留下短暂可见文字。本轮仅修改 `NativeModelTrigger.tsx` 和 `ComposerTooltip.tsx` 两个产品文件；完整 Dca 选中后抑制与普通指针离开行为仍为后续独立事项，整体 Goal 尚未完成。

## 原版依据和实现范围

官方 VSIX 保持不修改。原始包 `openai.chatgpt-26.51007.21434-linux-x64` 的 `app-initial-fee819fe4f22.js` SHA256 为 `460201045b5f5a4255fda737c9baa4768367a973d735cb37f3467bfe6af95316`；本机安装包 `openai.chatgpt-26.1007.21434` 的 `app-initial-7a199c66e670.js` 为 `59b909377a370e09cb8523ab99a1f4ff282a0126527bd339db31e6d9ac7c9c26`。两整包不同，FT、v4t、Dca 及受控关闭路径的 18 份精确源码片段分别核验，不把整包称为相同版本。

原生 FT 进入 v4t，受控 `open=false` 时 `Ce` 为 false；默认 `forceMount=false` 的渲染分支返回 null。本地 Radix Tooltip/Presence 原先会保留 `data-state=closed` 的 Content 执行退出动画。真实浏览器旧版八例均捕获到正透明度退出节点，故在原文案合同之外明确增加一个共用组件的局部渲染修复，随后对双产品与追加 Goal 控制重新联合独审、准入；不是把原一次文案准入默认为动画改写许可。

`NativeModelTrigger` 只把 enhanced 路径的提示 label 改为已有 `pickerOpenLabel`。generic、pending/error、basic 与独立 Side Chat 保留原适配。`ComposerTooltip` 只在 `popupOpen` 为真时不输出整个 `TooltipContent`；Provider、Root、Trigger/asChild、受控 open、200ms 延迟、状态、快捷键与 false 分支均保留，未改共享 Tooltip、CSS、按钮/ref、宽度、ARIA、原始模型/强度或权限语义。

共用组件有四个生产使用方：模型选择器、附件菜单、权限菜单以及 Goal 卡片编辑/状态/清除提示。前三个 composer 文件之外的 `features/goals/ThreadGoalCard.tsx` 也已计入；Goal 产品源码未改，新增测试只在其原 10 例完整前缀后追加一条真实 GoalCard/Tooltip 控制。该控制保护同一编辑按钮、goalMap 与 Goal 身份/字段、目标/预算/计数及零意外发布或写入，并在 finally 清理订阅/挂载/fetch spy。它在旧产品上也通过，属于控制，不能作为 CSS 动画 RED。

## 实际验收

| 验证 | 实际结果 | 口径 |
| --- | --- | --- |
| 原旧 focused 单测批次 | 32例：12FAIL、20PASS，7.4788s | 新16子集有11条文案RED和5条控制；另1条 legacy 早期文案失败，其后的守护未达，不补认通过 |
| 同 V6 八例，旧 E8 产品 | 8FAIL、48 soft failures，100.3471s | 每例2个文案条件及1个正透明度退出条件，各双断言；全部硬守护/清理到达，不是仅文案的纯 RED |
| Goal 全文件旧产品控制 | 11/11PASS，4.5284s | 原10例加1条控制；JSDOM不证明 CSS 退出绘制 |
| 类型检查 | web旧控制27.1706s、新产品26.9340s；严格E2E12文件3.0071s，均exit0 | 未变更共享协议或后端类型 |
| 新产品相关单测 | 42文件618/618PASS，67.7118s | 包含新16和Goal11，子集不能重复加总 |
| 同 V6 八例，新双产品 | 8/8PASS，88.3976s | model/default × 1440/390 × main/Sheet；同字节、同ID顺序、worker1/retry0 |
| 完整浏览器控制批次 | 5文件45/45PASS，289.3101s | 原38完整保留，增加原Goal7；不是拼接子批次 |
| 生产构建 | 唯一一次exit0，78.9816s，Vite48.72s | 在全部浏览器结束后；原dynamic-import/chunk warnings保留 |
| 只读运行状态 | exit0，0.7782s | 正式运行身份不变，磁盘新运行层未激活 |

45例的发现与执行ID顺序一致，原38例子序列完整。配置默认30秒，原测试体保留60秒覆盖：实际45例中12例30秒、33例60秒（原focus16、unknown16及Goal1），未放宽任何旧阈值。Goal7复用其原fixture，不声称拥有本批专项SSE服务器或统一的console聚合记录。

八例专项每例有15个状态、9条提示检查、两份真实双移动离开回执；原按钮/草稿/设置/目录读取和observer清理通过，四类目录读取均一次。专项8与偏好/滚轮6共14个自有SSE服务器各实际接收一条连接并完整关闭，active response/socket与错误均为0；focus/unknown32及Goal7没有这类自有SSE，不虚增清理数。专项console有8条已知Vite WS错误，原38控制有38条Vite加2条显式warm500，unexpected为0；不把Goal7说成有同口径的零console证据。

Root查看了8张closed-tooltip与4张open-settled截图：1440暗色、390浅色，主输入和展开编辑器均能读到对应用途，展开菜单没有第二个悬浮提示。截图只是本地fixture观察，不是官方GUI像素、逐帧原子时序或实体手机验收。

## 保留的失败历史

早期V2八例在离开驱动处失败，0条合格产品RED；V3单例到达全部控件但额外退出观察没有opacity证据。V4诊断类型检查因可选 `timing.easing` 失败，未运行浏览器；V5单例捕获到opacity=0的已结束退出节点，说明当时物理reader误计隐藏节点，不能追溯推断V3或更早所有帧。V6只补充自身与祖先透明度为正的物理可见判断，保留其他谓词、动作、等待、严格观测和清理；完整旧八例随后均捕获正opacity `0.00699379–0.0752137` 的退出残留，才形成当前明确双产品范围的真实RED。

V1静态严格观测阻断、旧驱动失败、类型失败与元数据reader错误分别留存。Root后续两次只读reader把counts数组当对象、把sourceCopies计数当数组的错误也已记录，均未执行候选或写源文件，不计产品RED。新Goal控制通过不会替代真正的旧版退出RED。所有旧报告、候选和审查包保持原字节。

## 输入、服务与后续边界

本轮25条实际验证命令，含6次真实浏览器批次及14次检查批次；所有命令四maps/HEAD前后稳定，浏览器互不重叠且不与检查/构建重叠。E8与新快照有9个输入差异记录，其中两个既有Goal浏览器文件仅新增到清单、与修改前绑定完全相同；实际产品/测试写入共7条：两个产品、两个新增专项、两份旧文案测试迁移及Goal测试追加。

结束后的正式runtime仍为PID2712539/start55361120；`pnpm session:status`明确新磁盘产物尚未激活。本轮未重启/停止正式Agent、复制认证、接默认IPC、启动native业务操作或git stage/commit/push。隔离前端2973342/start111490273及参考2973318/start111490242均保持身份，监听0.0.0.0，LAN前端 **HTTP `http://10.30.0.24:48865/`**、参考页 **HTTP `http://10.30.0.24:37575/native-goal.html`** 均200。实体同网段设备未直接测试。

本轮仅呈现组件变化，没有网关、SSE协议、正文缓存/store/音频变更，未重跑内存套件。E8的27PASS+1默认长测SKIP及heap/RSS数据是历史基线，不是本轮新增测量；不声称长期RSS、两秒、native完整权限、真实账号、完整Dca或普通指针宽限行为已闭合。后两项继续独立调查和红绿灯验收，整体Goal保持进行中。

## 证据入口

- [双产品范围与源码片段](../../../.dev-runtime/session-polish-round2-20261016/model-picker-trigger-tooltip-r28e9a-exit-root-addendum/contract.json)。
- [联合独审](../../../.dev-runtime/session-polish-round2-20261016/model-picker-trigger-tooltip-r28e9a-coupled-admission-review/review.json)与[Root准入](../../../.dev-runtime/session-polish-round2-20261016/model-picker-trigger-tooltip-r28e9a-root/coupled-supplemental-admission.json)。
- [完整旧八例资格](../../../.dev-runtime/session-polish-round2-20261016/model-picker-trigger-tooltip-r28e9a-root/v6-old8-two-issue-qualification.json)及[新产品完整结果/清理资格](../../../.dev-runtime/session-polish-round2-20261016/model-picker-trigger-tooltip-r28e9a-root/green-validation-qualification.json)。
- [25条命令书签](../../../.dev-runtime/session-polish-round2-20261016/model-picker-trigger-tooltip-r28e9a-root/command-bookend-summary.json)、[实际截图复核](../../../.dev-runtime/session-polish-round2-20261016/model-picker-trigger-tooltip-r28e9a-root/root-green-visual-review.json)及[结束后的服务观察](../../../.dev-runtime/session-polish-round2-20261016/model-picker-trigger-tooltip-r28e9a-root/final-owned-runtime-status.json)。

本文及六份追加记录描述实际实现与执行结果。最终封存、独立终审及本阶段放行由外置 `.dev-runtime/session-polish-round2-20261016/model-picker-trigger-tooltip-r28e9a-release-receipt.json` 记录；该收据只放行R28e9a，不等于整个Goal完成。
