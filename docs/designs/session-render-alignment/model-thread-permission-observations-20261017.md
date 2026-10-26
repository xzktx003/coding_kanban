# 原生线程权限字段的只读观察（R28e5，2026-10-17）

原生 start/resume/fork 的生成类型包含 `activePermissionProfile` 与 `runtimeWorkspaceRoots`，settings 通知包含前者；原有 `nativeThreadSettings` 会丢弃它们。本批沿既有响应和通知路径保留有界的逐字段上次观察，供后续模型动作核对来源时使用，不读取额外原生接口，也不改变当前模型或权限动作。

## 数据与状态合同

新增 `ThreadModelEntry.nativePermissionMetadata`，两个可选字段各自采用 `{kind:"value",value:...}` 或 `{kind:"invalid"}`。profile 的 value 为仅含 `id`、`extends` 的对象或 null；roots 为只读字符串数组。只有 primary 响应实际提供的 own field 参与，缺失与显式 undefined 都没有新观察；fallback、UNKNOWN、sandbox 和历史 Thread 不补值。`ThreadReadResponse` 只有 Thread，不能通过隐式 resume 或接管补齐字段。

null 与 [] 是明确收到的值，畸形或超过预算的字段成为 invalid 并替换旧值，不保留原文；另一个字段独立处理。保留空串、空白、Windows 路径、顺序与重复，不 trim、去重或解析路径。只复制白名单数据并冻结自有结果，不冻结生产者。纯 helper 避免执行 accessor，但既有 mapper 的 Object.entries 行为保持；这不是对恶意 Proxy 或整个流水线零 getter 的安全承诺。

| APP 留存预算 | 上限 |
| --- | --- |
| profile.id、profile.extends | 每串4096 UTF-8 bytes |
| roots 数量 | 256项 |
| 单个 root | 4096 UTF-8 bytes |
| roots 全部字符串总和 | 65536 UTF-8 bytes |

预算是本 APP 的留存限制，不是原生协议或权限限制。超限使整个对应字段 invalid，不截断、过滤或拼出部分成功。profile 与 roots 预算独立。

观察按字段累计：profile-only 通知保留之前 roots，仅表示两项各自最后一次观察，不能拼成同一次回执、同 native 代次、同账号或同 cwd 的当前权限。该块没有资格或授权语义。

## revision、初始恢复与持久化

整次合并仍在既有一个 Zustand 回调内完成。无 model 和过期 options.revision 拒绝整次 store commit；调用方可以在进入 hydrate 前完成纯归一化。新观察实际变化时复用既有 revision 加一，阻止更早捕获的回执覆盖；同时发生设置变化只加一次。相同观察保留字段、块、entry、根状态引用且不通知订阅者，不承诺 persist 不调用 setItem。

新块不进入可编辑 ThreadModelSettings、nativeSettings、observed、pendingFields、matching/ACK 或通知文案。原设置分支的匹配和 ACK 决策保持，匹配的原生设置仍能确认 pending。initialOnly 只填从未收到的字段；null、[]、invalid 都算已收到。legacy nativeSettings 缺失时仍保护全部可编辑设置，只允许补入缺少的只读观察并推进一次 revision。

该块不持久保存：partialize 写侧、同版本 merge 读侧、migrate 都只剥离新块，保留旧设置、命名空间和版本。getThreadModelSettings 的实际运行时输出同样剥离它；hook、默认设置、followup 和 turn DTO 不增加新字段或 permissions 参数。

## 真实红绿灯与回归

独立字面矩阵先于候选封存；产品与测试分别编写，测试作者未读产品候选，随后由第三个角色和 root 做静态审查。先只提升两份测试，对原产品运行，再原字节提升三份产品；没有修改既有测试。

| 检查 | 实际结果 |
| --- | --- |
| 旧产品，同一21项 | 18个 AssertionError RED、3个既有控制 PASS，正常收集；Vitest3.10秒、wrapper4.1709秒 |
| 提升产品后，同字节21项 | 21 PASS；Vitest2.84秒、wrapper3.7873秒 |
| 直接相关回归 | 单批13文件156 PASS，包含新21；Vitest8.23秒、wrapper9.2055秒 |
| web noEmit，前／后 | 退出0，26.2784／26.6436秒 |
| 内存／恢复浏览器整组 | 单 worker、retry0，8文件28发现，27 PASS、默认长测1 SKIP；wrapper318.2763秒 |

18个 RED 中16个来自实际字段丢失或观察 revision 缺失，另外2个是在 v1/v2 storage 显式注入残留后未剥离的断言。后者是前向恢复负控，不声称旧 normalizer 曾写入这个原本不存在的块。DTO 用例的旧失败位于最终保留观察的断言，不声称旧发送参数泄漏。没有用接口缺失、加载错误、TypeError 或零测试冒充产品红灯。

21项覆盖白名单与生产者独立、Unicode 字节边界及各 +1、字段独立 invalid、duplicate 引用／订阅、pending 原算法、过期回执、initialOnly/legacy、真实跨线程 settings handler、两版 persist，以及捕获 hook setter和本地 mock turn DTO。重复 invalid 的普通回执引用复用另经源码静态核对，没有单独新增运行用例。

浏览器保留原有传输、物理字符串留存、正文自动回收、无强制 GC 恢复、后台多标签、审批／最终回复、阅读位置与未读断言。真实 HTTP → 网关 → 原生 EventSource 用例上游100669814 bytes，浏览器6178个数据字符，最大事件317个数据字符，GC 后 heap 增量35964 bytes；字符数不是网络字节数。另一正文突发用例 heap 增量-41512 bytes。没有更改阈值或正文裁剪代码。

这批没有运行默认30分钟长测，不能由短时 JS heap 或大字符串结果宣称长期 renderer RSS 已解决；也没有新增原版 GUI、截图几何或物理设备验收。

## 执行与继续工作

隔离前端使用局域网 HTTP `http://10.30.0.24:48865/`，绑定 `0.0.0.0`；本批重新核对自有 PID/start ticks、监听和 HTTP200，并实际通过该 LAN 地址运行浏览器。尚无跨物理设备或跨网段访问证明。单测／类型全部结束后才开始内存浏览器，构建在浏览器结束后执行，避免采样混入编译。

执行输入从3057条基线，仅在提升测试和产品时变为3059／3060；各命令覆盖四个源码根、25选定测试、80基础设施与72 shared 产物。最终2883源码，其中本批新增 helper、两测试并修改 normalizer/store；每条已完成命令的前后快照无漂移、HEAD 不变。

证据保存在 `.dev-runtime/session-polish-round2-20261016/model-thread-permission-metadata-r28e5-root/`，后续终审和放行写在 root 外。构建／运行状态结果随本批最终收口追加。

本批没有接入实时来源 lease、requiredOnModels 消费、guardian next-turn、Pti、Default/preset、FI 或新 UI；当前普通模型的展示与选择规则保持。正式运行服务仍安全复用，不停止 Agent 或主动切换运行产物。完整 Goal 和共享模型动作继续，不能据此宣称所有会话功能完全一致。

最终构建／状态：`pnpm --filter web build` 退出0，wrapper72.9410秒（Vite44.27秒），保留既有chunk体积与静态／动态import警告；`pnpm session:status` 退出0，确认正式PID2712539仍在运行，磁盘新产物未激活。本批没有重启、停止Agent或切换正式产物。九条runner验证命令均已完成，唯一预期非零为已分类的旧产品RED；所有命令前后输入与HEAD稳定。
