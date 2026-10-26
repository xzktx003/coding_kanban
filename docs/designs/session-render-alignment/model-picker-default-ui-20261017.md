# Default 模型模式与物理强度选项（R28e7，2026-10-17）

普通 OpenAI 主输入与实际展开编辑器现在接入 Default 行、本地 FI 选择意图和原版派生的物理 model/effort 选项。Default 不再只是纯模块返回值；用户可以在模型列表选择“默认／推荐模型集”，再用同一条强度条切换预设组合。此前已经验收的当前行零设置写入、跨模型 bt 继承和 B 联合本地意图继续保留。

## 产品行为

有效 Default/model 模式与保存的 FI 分开。当前 pair 不在预设中时，界面临时采用 model 模式，保存的 Default 意图保持；以后回到预设 pair 可重新有效。FI 为 null 时，只在真实主输入或展开编辑器的可见菜单获准打开前保存首开模式。挂载、派生、目录加载、hover 和非空 FI 都不会自动修复偏好。

普通模型模式的物理选项采用原版 gJr 对当前 canonical 模型的切片，保留声明顺序和重复项。已知模型的未广告 medium 占位与广告过滤是两套语义，不能用既有 C 的广告 pair 生成器替代；persistent 过滤规则也保留。Default 模式改用 Et 预设，精确匹配当前 model+bt，未匹配时才按原 TX 优先级回退。unknown 仍使用既有六项；物理选项不足两项时自然进入 advanced。

Default 行在普通模型行前独立呈现，标题为“默认”，副标题为“推荐模型集”，仅 Et 非空时存在。checked 由有效模式决定；普通模型行只在 model 模式按 canonical 身份选中。Default caption 不使用普通 model 的 accent。Trigger 的关闭文字和打开文字尚未在本批调整。

选择未选中的 Default 时，先同步保存 FI=default，再一次提交所选 model+effort 的 B 本地意图，省略 tier，不插入 recent，然后返回 simple。已经选中的 Default 不产生设置、FI 或 recent 写入。普通模型行保存 FI=model，继续沿 R27／R29 处理当前行、显示强度和 row-only tier 清理；APP recent 继续使用捕获的原语义。Power 提交实际 model+effort，省略 tier，保留 FI；三条命令继续在当前模型的 gt/bt 域工作，不沿相邻 Default 预设跨模型。

首开 FI 在真实打开处理函数中核对捕获的 root、owner、layer 和可见编辑框，最新 FI 为 null 时于 setOpen(true) 前保存。Default 动作还要求当前菜单实例属于同 root／layer、保持连接且可见。菜单曾在工作台打开后，root 丢失不能回退成独立模式。独立组件的既有普通行／Power 兼容保留，不能借此开放 Default 或 FI 写入。该保护属于 APP 界面归属，不是原生权限授权。

## 已执行红绿灯与夹具修正

产品、测试、原版来源和公开合同分别封存，先提升测试取得真实旧产品结果。最终产品为精确 V3；V1／V2 的静态发现没有计为已执行 RED。首次测试类型检查的10项 TS18047 属于新浏览器探针的可空类型错误，保留原退出1后，仅收窄同一捕获结果。

| 检查 | 已执行结果 |
| --- | --- |
| 新2文件43项，旧产品 | 25 FAIL、10 PASS、8 SKIP；分别为14个 UI 行为 RED、10个 UI 实际入口缺失 RED、1个纯接口可用性 RED、8个 UI 控制、2个 C 控制和8个接口缺失下跳过的纯行为 |
| 精确 V3 与最终 V9 同43项 | 43 PASS；全部 case IDs 与原有重复项保持 |
| 最早2个旧夹具控制 | 旧产品26 PASS；仅补 FI 初值和实例菜单布局 |
| 11个旧菜单布局夹具控制 | 旧产品137 PASS，原136个不同名称及一个重复记录保持；原动作、断言和等待不变 |
| 相关单测首次 | 38文件576项为575 PASS／1 FAIL，原报告保留 |
| 最后一例实例布局修正后的对照 | 精确旧 E6 下完整93 PASS，再恢复精确 V3；同38文件576 PASS，类型检查通过 |
| 最终 V9 新浏览器8项 | 同字节旧产品8个合格 RED，再恢复精确 V3 后8 PASS；主输入／实际Sheet ×1440／390 ×两种场景 |

相关576包含新43、原 E6 的全部495有序记录，以及本轮扩入的 C／presentation 既有38项；不能把这些重叠组相加当独立通过数。原 E6 的495记录逐文件顺序、名称和重复项均未改变。

两轮早期浏览器驱动失败分别误把Sheet的归属当作主Composer、误查不存在的Sheet内层Composer。完整 ComposerSheet 原文显示：实际展开编辑器没有内层 Composer 和 DOM owner 标记。最终探针按真实 editor／trigger／scope 核对，继续保留主 reader 的 owner/currentThread 与 A/B 隔离保护，没有为测试增加产品 DOM 标记。四个 finally 探针错误也保留，未当成产品 RED。

首次 V3 新单测是42 PASS／1 FAIL，首次 V3 新浏览器是4 PASS／4 FAIL。前者错误要求自然单项 advanced 中存在活动 Power caption；后者从 Radix 菜单容器直接 Tab，容器按原依赖实现拦截 Tab，尚未进入活动项。公开合同和独立 delta 复核后，V9 只修这两个观察：单项 advanced 检查没有活动 Power，浏览器先用一次真实 ArrowDown 进入 caption，再保持原有有界 Tab 流程。全部业务断言、原8 IDs、时间预算、IO 和清理不变。修正后重新切精确 E6 跑同43与同8 RED，再恢复同 V3 得到 GREEN；不能把首次4个驱动失败补称产品 RED。

首次相关576的唯一失败来自原命令组合测试：真实工作台 textarea 和菜单存在，但 jsdom 的 getClientRects 固定返回空，新增可见实例保护正确拒绝 ArrowRight，仍为 none 而非预期 high。只在这一原 case 给实际 textarea 和返回菜单各补实例 rect，完整逆变换回原文件；93个动作、断言、high 预期和时序保持。独立审查后先精确 E6 跑完整93，再恢复 V3 跑同576；旧失败报告没有被覆盖。全批14个旧测试文件的迁移均有精确逆变换，没有全局 prototype 布局垫片。

## 浏览器证据边界

最终8例覆盖 raw-null 首开与 Default 声明洞：关闭时 raw/显示 fallback 不被保存；首开 FI 只保存模式；当前行零设置写；Default 的 FI 通知先于一次 B pair；三项紧凑物理条的真实键盘、滚轮、pointer 最终值与一次本地 revision 均核对。每例四项目录请求各一次，缓存引用、其他线程、全局默认、custom、草稿和权限字段保持。

每例 pageerror、意外 API 写和 external 均为0；8条已知 Vite HMR WebSocket console 诊断逐项保留，不宣称控制台全空。每例的有界探针均释放，自有 SSE 停止监听、响应和 socket 全部归零，绑定 PID/start ticks；产品来源前后哈希一致。Sheet 仍打开时保留合法 modal pointer lock，关闭 Sheet 后再要求 body 恢复 auto。

实际桌面与手机尺寸、主输入与Sheet的 advanced／紧凑条截图已经查看。390尺寸是 Chromium 模拟，未证明实体手机访问或官方 IDE GUI 像素等价。隔离前端经局域网 HTTP `http://10.30.0.24:48865/` 运行，监听0.0.0.0。

## 既有控制、内存与运行状态

7个既有浏览器文件以worker1／retry0完整运行，同一单批76 PASS（wrapper704.2718秒）。全部case ID、层级顺序和多重性与原 E6 的旧68和新8对应；原34命令的storage清理guard保持，没有新增测试过滤或延长阈值。76条已知Vite WS和8条主动注入的读取503 console记录全部保留。60例保存了自有SSE终态；原焦点16例没有同类收据，不外推它们的SSE证据。

8个内存／恢复文件、28项和所有阈值保持原样，27 PASS、默认30分钟长测1 SKIP，wrapper324.0989秒。包含后台正文回收、审批和草稿、未读、阅读位置、静默SSE恢复与真实HTTP/EventSource裁剪；未通过刷新或停止任务掩盖问题。

网络裁剪上游100669814 bytes，浏览器6178个data字符，单事件最大317个data字符；字符数不是网络字节数。该例GC后heap增量35964 bytes，另正文突发例增量213492 bytes。

自然GC的正文回收用例同时记录隔离浏览器JS heap和全部renderer RSS，页面异常与RSS采样错误均为0：

| 阶段 | 秒 | heap bytes | renderer RSS bytes |
| --- | ---: | ---: | ---: |
| 可见与后台正文 | 0.007 | 92520324 | 443617280 |
| 休眠正文已回收 | 62.400 | 59381880 | 295149568 |
| 只读重新激活 | 96.841 | 184222856 | 505352192 |

这是三个短时采样点，恢复后的heap和RSS都高于起始值，不能宣称长期稳定。默认30分钟长测未运行，本批不修改正文缓存、SSE或内存治理代码。

`pnpm --filter web build` 退出0，wrapper71.8121秒、Vite43.32秒，保留既有静态／动态import和chunk大小警告。`pnpm session:status` 退出0；正式运行服务仍为PID2712539/start ticks55361120，磁盘新运行产物未激活。没有重启、停止Agent或切换正式服务。

本批29条runner验证命令都有真实日志、退出码和四个源码根／选定测试／基础设施／shared产物的前后哈希，内部无漂移且HEAD保持。输入显式从3202逐步扩入至3304项；编译与任一浏览器批次无重叠，生产构建在全部浏览器结束后执行。相对E6仅20个代码与测试路径变化，其中3个产品、2个新单测、14个旧单测夹具和1个新浏览器spec；另同步7份文档，六份既有文档保留原文前缀。

完整执行证据位于 `.dev-runtime/session-polish-round2-20261016/model-picker-default-ui-r28e7-root/`，封存后独立终审与放行写相邻外置包。历史draft及其预审仅作过程证据，本正式文档已经分开首开FI与Default菜单动作的守卫时序。官方VSIX、非本任务改动、`.env`和全局Codex记忆保持。

## 范围与继续工作

本批产品只增加物理选项 helper、调整 Selector 和必要的局部样式，不改官方 VSIX、C／E4／FI store／B／backend 或正式服务。一次 APP 通知不是原生原子事务或完成回执。完整模型资格、Copilot／guardian、实时来源授权、Qt/Lti/Pti 和权限转换仍未接通，不能用本批预设目录或 UI 归属代替原生授权。

下一批是打开 Trigger 的“选择强度／选择模型”、真实可访问名称以及临时最小宽度；当前只有原版来源、迁移清单和只读矩阵，不计产品完成。完整用户 Goal 继续。
