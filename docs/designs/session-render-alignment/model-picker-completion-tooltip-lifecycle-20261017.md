# 普通强度操作完成后的提示生命周期（R28e9b）

普通模型选择器在 Power 滑块上按 Enter 完成操作后，会保持提示关闭：第一次真实 blur 只消耗跳过标记，后续 blur 或真正离开按钮才释放抑制。自然等待 350ms 不会提前恢复提示；释放后重新进入，仍显示 model 的“选择强度”或 Default 的“选择模型”。展开编辑器原按钮的焦点也保持稳定。本轮修复四个产品文件，并完成 45 文件 667 项单测、63 个浏览器用例及生产构建。手机展开输入区的长模型名称与权限入口重叠仍可见，列为下一项，整体 Goal 继续进行。

## 原版依据与实现

官方 VSIX 保持原字节。本机安装的 `openai.chatgpt-26.1007.21434/webview/assets/app-initial-7a199c66e670.js` SHA256 是 `59b909377a370e09cb8523ab99a1f4ff282a0126527bd339db31e6d9ac7c9c26`；存档整包 `app-initial-fee819fe4f22.js` 是 `460201045b5f5a4255fda737c9baa4768367a973d735cb37f3467bfe6af95316`。整包不同，使用已核验的精确行为片段建立对应关系；本轮 v4t 片段 8663 字节，SHA256 `1dd00a96551225eec87bd785e3c1792eccea4e208353b92dbf14e85b81bd6f86`。本地行为验收不冒充官方 GUI 操作或原生逐帧测量。

`NativeModelSelector.tsx` 的普通 enhanced simple Power Enter 设置 hold 与 skip-first-blur，调用原按钮 blur，再沿既有关闭/焦点返回链完成操作。标记按 thread/draft owner 身份清理；仅传到 `NativeModelTrigger.tsx` 的 enhanced 提示抑制参数。已有选项、模型/强度提交、权限、草稿和发布规则保留。这里没有把普通 Power Enter 的规则扩展为完整 Dca 所有选中关闭路径。

展开编辑器曾在关闭菜单时丢失按钮焦点。一次隔离被动诊断捕获了 SVG 后代替换与 FocusScope 恢复路径；它仍以原硬断言失败结束，不是成功验收。`NativeComposerIcon.tsx` 将已有 19 份 SVG body 的 `__html` 对象稳定在有限模块映射内，避免无关重渲染替换后代节点。原 18407 字节图标前缀、图形、属性与调用方覆盖顺序保持一致；两个旧版 DOM 身份用例先失败，再由原用例转绿。此证据支持已观察路径，不声称找到了所有可能焦点问题的唯一成因。

共用 `ComposerTooltip.tsx` 接管自有按钮的鼠标进入/移动、键盘焦点、取消与重新进入调度，保持本地 200ms 打开和关闭后 300ms 跳过延迟期限。按下、触摸、被子事件 `preventDefault`、弹层打开、旧节点或文档身份失效均不误打开；取消待打开任务不会凭空打开提示。普通 pointerleave 继续沿现有 Radix 离开宽限链关闭，未在本轮移植原生 c 路径的即时离开策略。

此适配明确绑定 Radix Tooltip 1.2.8。受控 Root 的 open prop 本身不会广播其私有 `tooltip.open` 事件，因此本地按已审查的令牌与自通知深度协调真实原组件：打开新提示会关闭仍保有焦点的旧提示，外来或嵌套通知取消本地旧任务。受控外部组件拒绝关闭、没有 Content 的外部 pending 等仍是接口边界；没有宣称通用 Radix 协议、热更新状态接管或完整原生 v4t 复刻。

实际执行还暴露了 Slot/asChild 的 ref 抖动：真实依赖链中 SlotClone 每次组合 ref，旧回调可能先收到 null，再收到相同 DOM。最终实现只对暂时 null 建立有界的提交后 microtask 确认；同一节点/文档立即重附着保留 hover 代次与原期限，实际替换立即失效，最终 null 在第一次有效确认时清理。每个实例最多一个当前有效任务，旧任务受 mount/ref 身份门控，卸载同步失效；没有增加轮询、frame 或 timer。StrictEffects 的取消逻辑有源码审查，未另称拥有专项真实 StrictEffects 单测。

## 实际验收

| 检查 | 结果 | 范围 |
| --- | --- | --- |
| 最终 web 类型检查 | exit0，26.7706s | 完整 web 项目 |
| 原严格 E2E 与新增专项严格类型检查 | 均 exit0 | 保留严格空值检查；新增浏览器只补显式缺失节点 throw |
| 最终相关单测 | 45 文件，667/667 PASS，79.3246s | 包含 completion15、Common 原生5、ref/reentry29、图标2和 Goal11；子集不重复相加 |
| 未改变的 completion 浏览器 | 8/8 PASS，99.0228s | model/default × 1440/390 × main/Sheet，160 状态、56 条晚期目标 |
| 未改变的完整控制批次 | 53/53 PASS，370.2184s | 含原 Goal7 和此前失败的 fresh-hover8；原发现 ID 顺序一致 |
| 新增双向协调浏览器 | 2/2 PASS，18.8234s | 桌面侧栏/附件与手机模型/附件；旧方仍有焦点，无 blur/leave，真实新 hover 关闭旧提示 |
| 最终唯一生产构建 | exit0，76.1132s，Vite46.81s | 全部实际浏览器批次结束后；已有 dynamic-import/chunk warnings 保留 |
| 只读运行状态 | exit0，0.8375s | 正式运行 PID2712539/start55361120 不变，磁盘新运行产物未启用 |

63 个浏览器用例都使用 worker1/retry0。实际超时保持 30 个 30 秒、33 个 60 秒，未修改原阈值。最终类型、单测及三个浏览器批次的 4367 条输入记录四 maps/HEAD 一致；构建和运行状态的 4394 条记录也各自前后完全一致。整个阶段 51 条实际验证命令，包含 12 个真实浏览器批次和保留的 18 条失败命令，彼此不重叠。这里只陈述实际执行，不将静态审查数量当作行为测试。

有统一 JSON 的是 56 个用例：完成8、focus16、unknown16、偏好4、滚轮2、旧提示用途8和协调2。24 个自有 SSE 服务各实际接收一条连接，finish/close/owner EOF 均一次，最终 active response/socket 和服务错误为零。56 份 console 记录含 56 条既有 Vite WS 错误，以及两条显式 warm-error500，未见额外错误。原 Goal7 沿用原 fixture，通过但没有同口径统一 JSON、SSE 或 console 聚合证明。只读 context/bookkeeping 请求保留，不声称零 HTTP POST。

协调用例的固定输入数组是 50 条，实际 hashInputs 还含 OPTIONAL_HELPER，所以原始 sourceBefore/sourceAfter 各为 51 个不同文件，全部逐字节核验。手机一份 quiescence 记录为 roots2/count1/running=false，其他记录为 roots1/count0；测试要求无 pending/running 动画，旧提示的物理不可见与 aria-describedby 清理另有断言，不将仍存在的退出动画对象改述为不存在。

Root 实际查看了最终运行的 16 张截图：8 张恢复提示、4 张展开编辑器自然 350ms 抑制、4 张双向协调。提示文案、保持焦点和单个新提示符合预期；390px 长模型展开页脚仍覆盖权限文字，短 Default 无该重叠。此轮没有 Access 入口的矩形/命中验收，不能将截图观察升级为完整布局通过。

## 红灯与修订边界

旧版 completion15 有 5FAIL/10PASS，25 条晚期条件不通过；完整旧八例随后形成合格 RED。最初 Default 驱动失败、首次类型失败和早期静态阻断单独留存。第一次三产品单测出现测试控制范围错误，按原合同修正测试驱动后重新取得旧 RED；没有删除原硬断言或通过等待焦点救援修复结果。

原 53 控制在四产品阶段为 45PASS/8FAIL，八例均在真实新 hover 的正向提示条件失败。Common controller V1 虽通过类型，相关 45 文件出现 610PASS/54FAIL；不能把后续未到达断言算通过。新增 ref 回归用例后，旧 V1 的 29 例为 9PASS/20FAIL；有些在初始正向 Content 断言即失败，后面的打开保留/卸载断言尚未执行。最终 ref V2 产品与 V5 测试全文分别封存并联合独审，原 26 例前缀和浏览器动作/断言未变，完整 667 单测及 63 浏览器才作为当前绿色结果。

28 条新增浏览器 TS18047 是测试空值类型问题，补充五处实际节点 throw 后严格类型通过；它不计产品 RED。元数据 reader、文档 reader 和本次证据汇总的字段/路径/动画对象假设错误也留存为整理过程问题；它们没有修改产品、放宽原测试或重新解释未运行断言。

## 工作区、服务与后续

相对 E9a，实际产品/测试差异 14 个文件，其中本轮写入 10 个、并行进入的 EventItem/threadRows 四个原文件保持原字节。六份当前完整文档前缀连同已进入的 debug 插入记录全部保留，只在末尾追加；新增本文。最终审查复制 111 份实际源码/测试和 7 份文档，静态依赖、命令日志、前后快照及早期失败另有清单。

隔离前端 PID217746/start112857665、参考页 PID2973318/start111490242 均保持身份并绑定 0.0.0.0。访问地址为 **HTTP `http://10.30.0.24:48865/`**，原版参考页为 **HTTP `http://10.30.0.24:37575/native-goal.html`**，最后只读检查均为 200；实体同网段手机尚未直接验收。前端此前的 SIGTERM 发起方未知，恢复为自有 polling Vite 的过程独立留存，不能归因为本轮产品代码。

没有停止 Agent、激活运行层、复制登录数据、调用 native 业务写接口或执行 git stage/commit/push。没有网关、SSE协议、历史/正文 store 或音频修改；E8 的 27PASS+1 默认长测 SKIP 与 heap/RSS 测量仅是历史基线，本轮没有新增长期内存证据。完整 Dca、ct/c 路径、离开宽限移植、官方 GUI、真实账号、实体设备与逐帧原子时序仍不能由本轮结果推定完成。

下一项先处理手机展开页脚的长模型布局，再继续检查已记录的 ct/c 行为差异。阶段终审和放行由外置 `.dev-runtime/session-polish-round2-20261016/model-picker-trigger-lifecycle-r28e9b-release-receipt.json` 记录；本阶段通过不等于整体 Goal 已完成。

## 证据入口

- [最终 667/63 原始结果资格](../../../.dev-runtime/session-polish-round2-20261016/model-picker-trigger-lifecycle-r28e9b-root/ref-v2-green-validation-qualification.json)、[16 张实际截图复核](../../../.dev-runtime/session-polish-round2-20261016/model-picker-trigger-lifecycle-r28e9b-root/ref-v2-root-green-visual-review.json)。
- [自有输入控制合同](../../../.dev-runtime/session-polish-round2-20261016/model-picker-trigger-lifecycle-r28e9b-tooltip-reentry-controller-addendum/contract.json)、[ref V2/V5 联合独审](../../../.dev-runtime/session-polish-round2-20261016/model-picker-trigger-lifecycle-r28e9b-tooltip-reentry-ref-admission-review/review.json)。
- [51 条实际命令](../../../.dev-runtime/session-polish-round2-20261016/model-picker-trigger-lifecycle-r28e9b-root/command-bookend-summary.json)、[服务与全命令互斥核对](../../../.dev-runtime/session-polish-round2-20261016/model-picker-trigger-lifecycle-r28e9b-root/final-owned-runtime-status.json)、[最终工作区差异](../../../.dev-runtime/session-polish-round2-20261016/model-picker-trigger-lifecycle-r28e9b-root/final-scope-and-incoming-delta-qualification.json)。
