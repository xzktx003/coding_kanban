# 普通模型 canonical 身份对照（2026-10-16）

本项接续 [Power滚轮](model-power-wheel-parity-20261016.md)，三文件产品修复、375项相关单测及102个不同浏览器场景已分批通过；原失败与补验批次分别保留。范围限定普通OpenAI主／展开输入的模型投影，不修改通用目录、侧边／custom规则或已保存的raw模型字符串。

## 来源与最小范围

当前官方普通 `hU/dQ` 只用 `record.model === selected` 查找元数据，`lCa` 行值、选中和显式选择同样使用 `.model`。DTO的id、model为独立必需string，查询与宿主保持字段。当前本地Selector／Trigger混用id和model，而R22原生推理命令已经只按canonical查找。

只读来源包记录60个精确跨度，其中24个在当前实装逐字相同；函数索引同时记录UTF8／UTF16／codepoint单位。独立字段契约只证明这种夹具可表达，未证明真实账号当前返回不同id，也未证明CLI接受或拒绝目录id别名。原Aeon入口的alias容忍与ChatGPT上游saved/default归一化另有边界，不外推为普通菜单规则。

普通OpenAI的当前record、列表行值／标签、显式目标record与目标强度／tier检查已统一到canonical投影。通用 `useModels.providerItems` 仍按DTO.id，raw响应／store引用、Side、custom、schema与旧alias／recent不迁移。普通显式选择继续保留现有支持强度／默认值策略，不称为原生model+effort原子提交。原wheel／focus／pointer／arrow块也不因身份修复重写。

## 实际单测红灯

封存准备包含10个新真实组件用例，使用四读API边界、实际useModels／cache、settings store、嵌套Trigger和Radix；另有真实通用hook只读probe，防止通过修改全局loader绕过Native局部修复。单位测试中的输入框为真实textarea；完整会话草稿与浏览器行为另行验证。

web类型检查实际退出0后，产品Selector `ec8d95a9…`／Trigger `f5888b45…` 上运行新10项及旧名称13项，单批2文件／23项为 **8失败、15通过，4.18秒**，2965项执行输入前后不变。新10项中8失败／2控制通过，旧13项仍全绿、两条反向身份预期尚未改。

实际失败为canonical-only显示raw标签而非目录名称、id-only借用了known2而非unknown6、前行id遮蔽后行canonical元数据／显示强度及行选中；显式选择另一行存入DTO.id，点击当前canonical行也改写为alias并更新revision／pending／notice，原alias最近记录被替换。两个main／expanded表面分别复现前三类；另两个显式选择例均有实际失败。日志中的39个soft断言块不等于39个测试。id等于model与grouped custom是通过的兼容控制。

补充两例带有合法初始priority与相反decoy元数据的组件用例后，web类型检查退出0；旧产品上的新12项及旧名称13项实际为 **10失败、15通过，4.54秒**，2969项执行输入前后不变。原10个测试体逐字保留；新增两例的canonical选择断言实际失败，tier本身在旧完整选择链已经正确，主要用于防止只迁移canonical行值却遗留id-OR的tier查找。recent仍记录选择瞬间priority，保持原先记recent再清tier的顺序。

三产品文件的最小候选及两项测试补充均完成独立静态审阅后，先保留完整新红灯，再应用产品。旧名称用例的两条相反预期等实际失败后才迁移，原文件与旧结果保持封存。

## 浏览器基线与观察器修正

首版六例已实际结束，**0通过、6失败**，299.54秒，2968项输入前后不变。1440主输入／深色的三例均走到final-closed，完整复现canonical-only名称／选中及显式选择改写、id-only借用known元数据、前行id遮蔽后行canonical的问题。390展开输入／浅色的三例停在opened-simple：菜单已实际渲染，但Radix模态菜单把背景Sheet从无障碍查询中隐藏，观察器复用的`getByRole(dialog)`在只读evaluate时等待至90秒超时。窄屏三例保留部分UI观察，不能计作完整产品红灯。

六份原始JSON、首版测试源及日志均保留；桌面三例清理无错误，窄屏三例有浏览器超时关闭页面后的清理错误，六个自有EventSource服务最终均已关闭。候选仅保留真实role就绪检查后，将只读观察范围固定到唯一、可见的实际Sheet DOM根；不改变断言、用户动作、超时或产品。该观察器修正与tier补充均须独立审阅后再进入新的执行批次，首版结果不覆盖。

观察器修正经审阅、类型检查退出0后，第二批六例实际仍为 **0通过、6失败，45.85秒**，2969项输入前后不变。五例到达final-closed并完整复现产品身份问题，原观察器超时消失；390 canonical-known在菜单动作前的baseline保护中读到currentThreadId为null，而实际草稿owner属性仍正确，必须单列为初始选择就绪失败，不能称六例完整红灯。该批六个EventSource均关闭、清理错误为空；准备状态原因仍在核对，没有重复seed或写状态来跳过原保护。

随后只在首次fill前增加同reader的严格thread／DOM owner就绪检查及64条有界轨迹。5秒是轮询预算，不是对inflight evaluate的强制取消；持续null仍失败，原后续baseline也可继续捕获变化，原硬保护与90秒总超时不改。独立审查释放、E2E类型退出0后，第三批实际为 **六例完整产品红灯，50.30秒**，全部到达final-closed、六次准入均首次即匹配，2970项输入无漂移；没有据此解释R19或第二批null的根因。第二批此前已fill，只有菜单click／keydown／pointerdown／submit为零，不声称没有任何UI动作。

## 已应用的最小产品与验收

正式仅改Selector、Trigger及新增`nativeModelIdentity.ts`。只读`Model.model`当前查找、局部canonical行值／名称，以及显式目标的effort／tier共用同一record；通用loader、raw目录／引用、custom／侧边规则及已保存alias保持。完整selectEffort以后wheel／focus／pointer／arrow区和既有六块保护不重写，原菜单状态与owner门禁保留。

只应用产品后的新12项全部通过，未改的旧13项中两条反向身份契约实际失败、其余11通过，单批 **23通过、2失败，4.39秒**。之后只迁移旧controls第272／273行的名称／显示值／六档预期，不改raw选择、目录、helper或保护断言。第三批同字节浏览器源码再跑，**六例全部通过，40.4秒**，2971项输入前后不变；当前行显式选择不改设置，另一行写canonical并取正确强度，B／默认值／草稿／owner／IO保护均通过，六个EventSource关闭且清理错误为空。根线程已实际查看主深色／展开浅色四张已知与未知模型PNG，不称完整原生GUI零像素一致。

前端生产构建实际退出0，包含shared与web类型检查，Vite43.60秒，2971项输入前后不变。相关24文件／375单测首批为 **365通过、10失败，48.44秒**：失败全在同一keyboard夹具查询中文模型行时，尚未执行后续焦点／timer断言。其mock给providerItems中文label、raw Model.displayName却给id，与真实hook的displayName映射不一致。经独立审阅后只改一行raw displayName，29个测试正文与断言不变；第二批完整 **375项通过，43.59秒**，web类型检查退出0，两批执行各自2971项输入前后不变，原失败记录保留。

完整102场景浏览器实际为 **101通过、1失败，13.3分钟**，零重试，2971项输入前后不变。唯一失败为R23桌面主题用例在64步Shift+Tab内未到达主题按钮；此前模型状态检查通过，主题切换与最后状态保护未执行，不能计为102项全绿。原始焦点序列显示附件Popover已报告关闭时，退场中的按钮仍接收Tab；实际移除等待及独立补验另行记录，不提高步数或改动产品。

独立核对确认旧等待只覆盖内层Dropdown，附件Popover实际为另一个带`data-slot=popover-content`的节点；控制状态关闭不等于其Presence已卸载。仅新增一行实际detached等待后，E2E类型检查退出0。首次补验命令因标题筛选未匹配而零项执行，退出1，独立保留、不计红绿；改为指定原测试文件后，1440／390两例 **全部通过，18.9秒**，2971项输入前后不变。两例均执行同节点主题切换、颜色／几何和全部最终状态保护，自有SSE完整关闭；主线程实际查看两张主题切换PNG。原64步、真实键盘、通知生命周期和IO保护不变，没有固定sleep、force/focus或修改产品来挑绿。实际为102个不同场景分批通过，其中一项已通过的手机场景重跑；不称一次102项全绿。完整批次到补验之间只改一行keyboard mock及一行主题测试前提，生产源码与shared产物保持一致。

本项浏览器使用绑定 `0.0.0.0` 的 **HTTP `http://10.30.0.24:48865/`** 与自有HTTP／EventSource；不访问正式Agent或原生设置。真实目录／alias能力、完整认证GUI、原生pair／CAS、Goal附件接线、物理设备、长期RSS与正式运行层启用继续独立记录。
