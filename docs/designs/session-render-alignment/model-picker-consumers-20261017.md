# 普通模型选择器共同偏好投影（R28e3，2026-10-17）

主输入、真实展开输入、关闭 Trigger 和会话提高／降低／循环命令现共用本 APP 的强度偏好投影。指针、方向键、状态文字和滚轮使用 Selector 已提交的同一列表；命令在现有 owner 校验后读取最新偏好。模型目录原数组、记录及广告数组引用保持，偏好变化不改写 model／effort／tier、权限／reviewer、默认配置、thread revision／pending、草稿或 FI。

## 来源与范围

原包 hCa→Bm→iU 使用 enabledReasoningEfforts，并将请求的 includeUltra 与独立 rollout 1186680773 相交。当前应用没有这个真实 rollout 来源，也不能由 provider=openai 证明原生非 Copilot 身份。本批采用明确的本 APP ordinary 显示兼容策略 includeUltra=false；这不是官方 flag、账号资格、native 权限或 Copilot 强制／合成 medium 分支的实现。

E1 store 只由新 ordinaryNativePickerModels 适配器消费其 enabled 数组，再调用 E2 纯投影。默认 hAt 六项在已知九档目录中显示 low／medium／high／xhigh。偏好只做成员过滤，保留广告顺序与重复；persistent 仍是合法 wire 值，picker 不提供它。即使显式启用九项，ultra 仍被本批显示策略隐藏。隐藏不禁用合法 wire 值，也不授予任何动作权限。

已知模型过滤成空仍是已知空，不制造六档。未知 canonical 模型继续走原 Pzt 六档，不受空偏好过滤；首次 pending、错误与 snapshot 由原目录状态处理。raw useModels、generic／Side／custom 和共享 nativeReasoningOptions 不接入这个过滤。inactive hook 不订阅偏好，但静态导入 store 仍可在模块首次载入时读取自己的持久 key。

本批只接偏好强度消费者，没有偏好编辑入口、FI 首开 seed、Default／内置 preset 菜单、Lti／Pti／requiredOnModels 共同动作或新账号／native IO。原350ms临时视图、owner／焦点／wheel lease、R27 同当前行 no-op 和 R29 bt 切换继承保持。R29 的两个本地 setter 没有变成一次 revision 或 native 原子 RPC。

## 真实红绿与回归

- 新9组件用例采用真实 hook／cache／stores／Trigger／Radix／ConversationMenu，只 mock 四项目录读 IO。旧产品7项行为 RED，未知六档和撤销 owner 两项控制 PASS；同批既有 R27／R29 十项 PASS，共19项。推广四个产品文件后，同一19项全部 GREEN。
- 相关单批28文件425项全部通过，包含上述19项及 E1／E2 单测，不重复相加。包含 generic／Side／状态／owner／焦点／pointer lock／wheel 等原保护。web 前后 noEmit、选定 E2E 前后 noEmit 通过。
- 浏览器1440×900／390×844各跑主输入与真实 ComposerSheet。V3旧产品4项行为 RED，每例43个目标 soft 断言、19次状态读取，硬 raw／cache／owner／草稿／请求／输入归因／source／SSE 清理均通过；同字节 V3四项 GREEN。原 R27／R29 十二项浏览器另批 GREEN，合计16个不同 GREEN 场景。
- 浏览器使用局域网 HTTP `http://10.30.0.24:48865/`，前端绑定0.0.0.0。偏好变化由显式、有界的真实 own-store 诊断输入触发，绝不调用模型／线程 setter 或在动作后 hydrate；它不是可达偏好编辑器。其余 pointer／arrow／wheel 和嵌套三命令使用真实页面输入。每例四目录读各一次，业务写入／外网／pageerror／cleanupErrors 为空，SSE完整关闭。

旧测试为保留 None／Minimal／Max 的原反例，仅在初始 fixture 显式启用偏好。R29 target [max,medium] 的选择断言未变。两个旧 visible-ultra 断言迁移到本批显示策略，同时继续保护 raw ultra、八档共享 helper 和纯投影 includeUltra=true 分支。显式模型 accent 由 model 决定，不由显示档位决定；迁移 V1 的单个错误 literal 在任何执行前由 fresh V2 修正，旧文本保留。

浏览器 V2首轮4例含退出动画竞争、错误拒绝 Radix 的可信键盘→同步 click 桥接、以及 finally 前过早释放诊断句柄，0例计为合格产品 RED。V3仅修这三处驱动／清理：有界真实 Escape 和退出等待、严格同项可信 Enter／Space 在50ms内产生且恰好两次的派生 click、最后读取后释放句柄；其它输入仍须可信。旧失败证据完整保留，没有放宽产品预期或硬保护。此前的静态无阻断不是运行通过。

Root 实际查看四张最终截图：桌面主输入四档、桌面展开两档、窄屏主输入已知空列表、窄屏展开四档；菜单、草稿、caption和滑条均在可见区域，无需新CSS。不是整份原版逐像素对齐或物理设备验收。

## 证据边界

四个源码根、选定测试／基础设施与shared产物逐命令 bookend，3033（unit）→3034（browser）→3035（新适配器）记录仅在声明的推广步骤变化，执行期间零漂移。产品候选先封、独立字面矩阵后封，但测试作者未读产品；不宣称 E3 字面矩阵先于产品候选。新测试、迁移和浏览器由独立审查后提升；V2实际失败后的三点 V3差分另有审查。

只读 session:status 确认正式 PID2712539 继续运行，运行产物与磁盘不同，新运行代码未激活；没有重启服务或停止 Agent。当前结果是合成目录下的本 APP 显示与交互验收，不是原生账号／真实 catalog、官方 flag、native 原子提交／CAS、ChatGPT GUI、当前长时 RSS 或完整 Goal 完成。

证据 root：`.dev-runtime/session-polish-round2-20261016/model-picker-consumers-r28e3-root/`；最终独立复核与放行收据写在 root 外。FI／Default／跨模型 preset、真实要求与共享动作授权仍继续推进。

生产构建随后退出0（wrapper72.374秒，Vite43.81秒），保留已有动态／静态混用与chunk体积提示，不声称零warning。浏览器全部结束后才开始构建，72份shared产物前后字节不变。本批15条验证命令均有独立receipt和source bookends；其中V2失败另列，未重复计算通过数。
