# 模型选择的联合本地意图（R28e6，2026-10-17）

普通 OpenAI 模型行原先分别修改 model、reasoningEffort 和 serviceTier。最终值虽然正确，订阅者仍会看到中间组合和多次 revision。本批将既有模型行、Power 和三条强度命令接到已验收的 `setModelSelection`，在可表达完整 pair 时只发布一次本地意图；原有显示回退、当前行只读、归属和档位规则继续保留。

## 行为与边界

`NativeModelSelector` 继续先按 R29 计算 next，并保持旧代码实际最终强度 `next || raw`。不同的已知原生模型且该最终值为 string 时，将 model、effort 和必要的 unsupported tier=null 合为一次 B 调用。只有模型行可以顺带清理不支持的 tier；支持的 tier 或省略的 tier 保留。Power 和命令只提交所选 model+effort，不带 tier。

例如 raw=null、当前广告 low/high、目标广告 low/medium/high 时，R29 的 bt 为 medium。旧实现依次发布 target/null/fast、target/medium/fast、target/medium/null；现在只发布 target/medium/null。raw=max 不在当前广告中且目标支持 fast 时，最后仍为 target/medium/fast，并且只增加一次 revision。

同一普通原生当前模型行仍不调用设置 setter，不修复 raw null，不清 saved tier，不增加 revision；只保留现有视图与 APP recent 流程。原生 Power 使用当前模型，三命令保持 current gt/bt、pending／非空模型、捕获 owner、最新 E3 偏好和边界检查。generic 和空模型的旧适配保留。

空字符串必须单独处理。ReasoningEffort 类型为 string，并不保证非空；目标广告的默认值可以为 `""`。next 为空而 raw 为 low 或空字符串时，联合值仍是旧语义保留的 raw。若实际最终值是 null/undefined，B 的非空 pair 类型无法表达，继续走旧单字段适配及必要的 tier 清理；这条兼容边界不能宣称单次发布。APP recent 则继续使用原 `next ?? raw` 和捕获的旧 tier，可能与实际最终值不同，不能把它改成“看起来更一致”的新载荷。

本批只修改两个既有产品文件，不改 B/store/hook/shared/backend API。一次本地通知不是原生 RPC 原子事务、CAS 或原生完成回执；没有接入 FI、Default/preset、Lti/Pti、guardian、实时来源或新的权限动作。

## 实际红绿灯

产品与测试独立编写并封存，经第三角色和 root 静态审查后，先仅提升测试，再对旧产品执行。产品 V1 的空 effort 语义问题在静态审查被拒绝，从未执行；修正后的 V2 才按原字节提升。这一静态发现不计产品 RED。

| 检查 | 实际结果 |
| --- | --- |
| 新组件用例，旧产品 | 正常收集17项，8个行为断言 RED、9个控制 PASS；最终值和保护先通过后，订阅／revision 断言失败 |
| 四个旧 mock 的增量 B 适配加一个原控制文件 | 旧产品5文件138 PASS；只新增 mock 方法，旧断言与时序保持 |
| 提升精确 V2 后同字节新组件用例 | 17 PASS，同一 case IDs |
| 相关单测 | 单批34文件495 PASS，包含新17；保留既有一条 i18next 提示 |
| 新浏览器用例，旧产品 | 2种raw × main/实际Sheet × 1440/390，共8个合格行为 RED；hard 最终值、目录、草稿、归属、真实输入和清理均通过，soft 单次通知／revision 不符 |
| 提升后同字节、同8 IDs | 8 PASS；每例恰好一份完整 pair，revision 由4到5 |
| web／E2E 类型 | 产品前后及夹具修正后的相关 noEmit 全部退出0 |

ROW01 旧浏览器每例3次发布，ROW02每例2次；最终 effort 都为 medium，不能将最终值正确误报为“没有中间态”。新浏览器每例保留1条明确的 Vite HMR websocket 诊断，共8条，实际 pageerror、意外 API mutation、external 均为0；没有声称控制台完全无输出。四张桌面／手机、主输入／展开截图已人工查看，当前行、目标行、草稿及菜单可读；没有原版 GUI 像素或实体手机等价结论。

## 原控制批次与测试清理修正

首次完整旧控制批次实际68项为51 PASS／17 FAIL，原报告与每例 JSON 完整保留。全部17项只有最后“no pageerrors”检查失败，内容为 localStorage SecurityError，其余业务、隔离、SSE清理、零API写断言均通过。原记录只有错误字符串，缺少 stack/frame/time，不能事后认定那17个具体事件来自哪个 frame。

该旧命令测试的无条件 `addInitScript` 会在每次文档导航重新运行，而 finally 又导航到 about:blank。额外隔离诊断只提供一个自有 LAN 最小 HTML，阻止其它请求，不加载应用或原生服务；两个顺序新 context 均正确 seed。旧初始化器在 about:blank 主 world 产生1次精确脚本／执行上下文绑定的 SecurityError，限定顶层且 exact owned origin 的版本为0。这证明初始化器存在清理风险，不能补回原报告缺失的 frame。

第一版诊断自身退出1：它错误地把 Debugger 返回的完整源码与提交源码直接比较，遗漏 Playwright InitScript 的外壳。原失败和全部双臂证据保留，不计 GREEN 或产品 RED。V2 绑定安装的 Playwright page.js 与完整外壳，四份 wire script 精确匹配后一次通过；excerpt 文件哈希包含末尾 LF，JSON excerpt 字符串不含该 LF。

独立复核后只提升原命令 spec 的初始化入口：非顶层或非捕获 origin 直接返回，storage body不变，仍完整收集 pageerror。34个原命令 case 的断言、等待、阈值、清理不变。新增类型检查通过后，以fresh输出、worker1/retry0完整跑同34项：34 PASS，pageerror／意外写／external 为0。42条控制台输出全部是原明确的 Vite 或注入读取错误诊断。原批次其它34控制保持原PASS记录，不把两批合称单批68绿。

## 内存、恢复与运行状态

8个既有内存／恢复文件和所有阈值原样运行，28项中27 PASS、默认30分钟长测1 SKIP，worker1/retry0。包含正文60秒回收、后台状态、审批、最终回复、未读、阅读位置、只读恢复与真实 HTTP/EventSource 裁剪，未用刷新、停止任务或修改阈值掩盖问题。

网络裁剪用例上游100669814 bytes，浏览器6178个data字符，单事件最大317个data字符；字符数不是网络字节数。其GC后heap增量35964 bytes，另正文突发用例增量193808 bytes。

自然GC的短时正文回收用例同时记录 JS heap 和该隔离浏览器全部 renderer RSS，采样错误和页面异常均为0：

| 阶段 | 秒 | heap bytes | renderer RSS bytes |
| --- | ---: | ---: | ---: |
| 可见与后台正文 | 0.007 | 170192664 | 492171264 |
| 休眠正文已回收 | 62.302 | 59857948 | 295374848 |
| 只读重新激活 | 96.527 | 101636820 | 600641536 |

这是三个短时采样点，恢复后的RSS高于起始值，不能据此宣称长期RSS稳定。默认30分钟自然GC/RSS长测仍未运行。本批不修改正文缓存、SSE或内存治理代码。

`pnpm --filter web build` 退出0（wrapper77.1985秒，Vite48.33秒），保留既有chunk大小和静态／动态import警告。`pnpm session:status` 退出0，正式运行服务仍为PID2712539，磁盘新运行产物未激活；未重启或停止Agent，也未切换正式服务。

## 证据与继续工作

隔离前端局域网 HTTP 地址为 `http://10.30.0.24:48865/`，监听0.0.0.0；自有前端、reference和正式服务均按PID/start ticks只读核对。浏览器实际经该LAN地址运行，尚无跨物理设备访问证明。

本批18条runner验证命令均有日志、退出码与四个源码根／选定测试／基础设施／shared产物的前后哈希；每条命令内部无漂移且HEAD不变。输入数从3069到提升测试后的3071，夹具诊断显式增加7个基础设施输入后为3078。夹具额外类型检查仅在已结束浏览器批次之间运行；没有编译与浏览器采样重叠，生产构建在内存组结束后执行。

完整证据保存在 `.dev-runtime/session-polish-round2-20261016/model-picker-joint-consumers-r28e6-root/`，封存后终审与放行写相邻外置包。功能清单、项目概览、实施记录和两份bug记录同步追加，保留原文前缀；未改全局Codex记忆。

本批完成既有消费者的本地一致提交，完整用户Goal继续。下一批Default/FI与物理pair菜单只有TEXT候选和公开合同；它们仍须本批放行、独立总审和自己的真实红绿灯，不得因准备完成就宣称产品已接通。
