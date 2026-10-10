# Codex 请求呈现与身份边界实施记录

2026-10-10，已批准的 `plan.md` P2 请求范围。产品联调地址：**HTTPS `https://10.30.0.24:8484`（端口8484）**；原包只读基线：**HTTP `http://10.30.0.24:43831/native-markdown.html`（端口43831）**。正式 Rust 服务与用户 Agent 未重启，未提交或推送。本记录来自当前含并行改动的工作区，不代表任一历史 commit 已包含这些功能。

## 原包证据

参考为已核实的 `third_party/openai.chatgpt-26.51002.51308-linux-x64.vsix`，SHA256 见 `evidence.md`。下列资产均来自它的 `extension/webview/assets`，格式化副本只是定位依据。

| 内容                                      | 实际源码锚点                                                                                                                                                                  |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 审批卡片、scope menu、hotkey输入/菜单保护 | `app-initial-3192ac99b6cd.js`：`Kba/Uba/M4i`；格式化 `plugin-readable/approval-request-card.js`                                                                               |
| patch文件列表与保存Diff，审批身份图标     | `plugin-readable/pending-request-item-panel-b330ce37efac.js`：`Gn`1668、`zr`审批分支3840–4410；真实图标 `Swt/gft` 与 `hand-10b23d108053.js`                                   |
| 编号选择、导航、180ms前进、校验           | `plugin-readable/request-panel-960b28c40ada.js`：`Jn`1415、`$n`1727、`rr/ar`1857/1955、`dr`1978、`hr`2175、`Qr`4162、`ni`4368；180ms与键盘保护4457–4615                       |
| 标准MCP schema默认值与值校验              | 实际 `app-initial-e98b9eaef8e3.js` 字节位置：`Dpt`401971、`Opt`402110、`kpt`402422、`Apt`403050、`Mpt`403469、`Ipt`403845、`Lpt`404097                                        |
| OpenAI form实际路由与schema               | `app-initial-3192ac99b6cd.js` 字节621725将`openai/form`映射legacyOpenAIForm；`app-initial-e98b9eaef8e3.js`：现代`amt`404434、legacy `fmt/hmt/Cmt`406519/406769/407297         |
| 实际卡片/编号圆角与宿主颜色               | 原包浏览器测量：卡片25px；编号20×20px、圆角5px；选择行min32px、padding6px 8px；`app-initial-961644ef2fa7.css`将`surface-elevated-secondary`映射`--vscode-dropdown-background` |

`.dev-runtime/session-render-alignment/request-native-probe.mjs`只加载原资产并提供本地`onReply`数组，未连接运行服务。成功运行截图/DOM为`native-request-form.png/.json`，没有pageerror。`session-codex-requests-reference.spec.ts`将真实原包与产品置于同一616px区域、system-ui及完整相关浅深宿主变量下，对比上述卡片/选项属性；两主题通过。它只证明指定属性与状态，不能当作完整页面像素一致。

## 当前行为

审批保留既有 authoritative `availableDecisions`，显式空数组不生成授权范围。真实command/cwd/domain/额外读写权限保留；使用原包Terminal/Edit files/permission SVG。scope菜单继续传递原始授权对象。Enter只在请求区域且目标不是编辑器、按钮、菜单或dialog时批准允许的一次范围；重复/IME/隐藏区域不响应。Escape仅收起，未回复或丢弃请求。patch预览来自相同thread/turn/item的等待快照，保留原始行号、移动路径、新增/删除原始文件内容，不读取当前Git内容冒充等待patch。

同步问题使用推荐标签原文、编号选择、自由输入、逐题导航、180ms选项前进，末题需显式提交；Cmd/Ctrl+Enter与已选末题的Enter有效，IME及文本内数字/方向键不被接管。自定义答案切换到固定选项再返回仍保留。`isOther=false`不开放额外选择；实际`isSecret`使用password输入且只在内存保存。`respondToRequest`捕获完整原request对象，拒绝被新token/turn/item实例替换的目标。

异步问题使用同样的编号行和180ms前进，继续复用固定共享composer及原编辑器节点。进入新轮次会收起旧问题并拒绝旧source送入新turn；同source id的新轮次不继承旧草稿。旧HTTP成功返回不能覆盖新实例草稿或关闭新面板。关闭保留草稿，过期提醒不发送；uncertain保持锁定并核对原client receipt，不盲重发。

Elicitation按实际schema逐字段显示。header前后导航保留内容，继续验证当前字段，末次验证全部并定位首个无效字段；普通单选180ms前进，自由建议选项遵循原生不自动前进。标准schema覆盖required、finite number/integer、min/max、字符串长度、enum/const、多选范围、boolean和email/URI/date/date-time。清空optional数字省略，不能变成0；普通string、数字、显式boolean及过滤后多选default沿用原包规则，单选enum不预选。支持结构明确的`openai/form`普通字段、pattern、自定义suggestions和字符串数组；自定义数组仅合并一次并校验uniqueItems。原包typed MCP schema没有password格式，未推测或添加该字段。

实际legacy `openai/imagePicker`支持data-image模板图库：初始不预选，横向滚动与边缘导航，原图比例决定portrait/landscape布局，提交原模板id。`request-panel`的普通MCP调用链`ii→ni`仅提供`onPreview`，没有`onPickLegacyFile`；原包`Hr`只有schema.file与`onPickFile`同时存在才显示文件选择。因此产品默认请求同样隐藏文件按钮。显式提供`onPickFile`的调用方可使用现有浏览器picker和10MB会话上传接口，取消保留原值，异步完成捕获原请求，返回真实上传文件URI；这属于可选浏览器宿主适配，不扩大普通native卡片。图库及回调gate的原包只读运行证据为`native-imagepicker-probe.mjs/.png/.json`，无pageerror。

三类RPC回复始终捕获原thread/request/turn/item/token。成功只移除原请求及其草稿；明确拒绝保留草稿，送达不确定禁用回复并提供核对，不能连点或重发到其他会话。类型store同时做requestId与原引用检查，组件失效不能绕开守卫。

关闭与原包的明确差异：本项目X和Escape仅收起填写、保留草稿；显式footer“取消请求”才回复cancel。原包X/Escape同为cancel，本项目按已批准的关闭安全边界保留额外明确取消按钮。手机/触控选择与按钮仍至少44px，文本输入16px，保留项目触控例外。

## 红绿与浏览器验收

研究产物位于被忽略的`.dev-runtime/session-render-alignment/`，不会进入提交。测试所有发送均mock或Playwright API fixture；关闭真实runtime WebSocket，没有向用户Agent审批、发送、steer、resume或停止。

| 红                                                                 | 绿                                               | 范围                                                              |
| ------------------------------------------------------------------ | ------------------------------------------------ | ----------------------------------------------------------------- |
| `requests-red.log`3失败                                            | `requests-questions-green.log`39通过             | 捕获实例、180ms、自由草稿、Escape、uncertain；既有问题/async回归  |
| `async-native-red.log`3失败、`async-instance-red.log`1失败         | `requests-final-green.log`覆盖                   | 旧轮次、同source新实例、旧回复不得覆盖新草稿                      |
| `approval-native-red.log`2失败、`approval-add-delete-red.log`1失败 | `requests-final-green.log`覆盖                   | 审批快捷键、原始patch/owner/行号、add/delete                      |
| `question-enter-red.log`1失败                                      | `requests-final-green.log`覆盖                   | 已选末题Enter、IME保护                                            |
| `elicitation-native/{red,sequential-red,edge-red,openai-red}.log`  | `elicitation-native/openai-final.log`20通过      | typed/OpenAI form、逐字段、草稿、default、验证、unsupported、恢复 |
| —                                                                  | `requests-guardian-final-green.log`14文件103用例 | 上述全体与既有sessionState.transitions；计数来自本次一次执行      |
| —                                                                  | `e2e-requests-gallery-final.log`10通过、59.9秒   | LAN 1440/390px×dark/light八scene；原包属性对照两scene             |

浏览器覆盖command准确身份提交、取消收起无RPC、逐题选择及numeric invalid→valid、原始patch行42、秘密不进入localStorage/sessionStorage、uncertain disabled、async选择与新轮次过期。`e2e-requests-gallery-final/`含28张卡片状态截图（含4張图库）、4张`requests-page-*`整页截图和4张原包/产品对照截图；metrics附在对应Playwright记录。负向断言使用真实`/api/codex/turn/start`、`/turn/steer`路径。`requests-format*.log`及scoped `git diff --check`通过。Guardian `guardian-server-red.log/guardian-web-red.log`与`guardian-receipt-red.log`真实late-receipt红灯已转为`guardian-server-final-green.log`8个Node测试、上述103中的6个web controller测试；`e2e-guardian-final.log`4通过16.6秒，8张整页截图，验证default无按钮、显式fixture能力、uncertain仅核对与原身份recorded。

## 自动审批复核的原始事件与能力边界

`plugin-readable/sites-end-resource-39518ab206b4.js:8798`的`Fx`明确要求`Qs("3487373434")`、`review.event!=null`且未记录批准，才显示“批准”与允许重试一次的说明。原始初始包`S0t=u_`字节218862，`ug`字节177861从Statsig读取gate、缺client默认false。`native-guardian-gate-probe.mjs`实际调用原包hook；`native-guardian-gate.json`值false、无pageerror。此证据仅证明没有账号Statsig bootstrap的提取上下文；未取得当前登录账号启用值，不能以源码存在声称该动作当前启用。

原包`NIi`调用`thread/approveGuardianDeniedAction`，输入为完整原始`GuardianAssessmentEvent`。`third_party/codex/codex-rs/protocol/src/approvals.rs:206`的原始事件含snake_case动作及review_reason/plugin_id/script_path等归因；`app-server-protocol/src/protocol/item_builders.rs:272`的v2完成通知只公开camelCase动作与复核状态，不含原始事件。当前项目运行适配未暴露此原始事件，不能由v2通知反向重建，也不能伪造approvalToken。

新增Node `session-codex-guardian`接口及`CodexGuardianDenial`注入式服务。默认无可信能力时snapshot为unavailable、approve为409，不发RPC。只有可信适配同时给出已启用gate、原始事件、当前thread/turn、精确review/target/start/end/instance、原生`canAcceptDirectInput===true`及绑定运行实例的RPC能力时，服务才签发opaque授权token。服务验证公开动作/状态与原始事件一致、再次读取完整快照，将原始事件原样交给RPC；浏览器请求禁止event/action/decision等额外输入。批准仅记录重试权限，不执行、不resume、不start或steer轮次。

批准前先持久写入uncertain receipt；flock与原子journal保护网关热更新/并行实例，丢失回包时旧身份不能换clientRequestId再次发送。可信只读recorded receipt才能消除不确定。前端也捕获完整复核快照，复核变更阻止提交；uncertain期间禁用按钮并仅提供核对。设备只持久保存复核身份/runtime/client receipt状态，不保存授权token、动作、命令或原始事件。详情组件在默认unavailable及已recorded状态不显示批准按钮。

## 精确剩余边界

原包实际wire的`openai/form`映射为legacyOpenAIForm，并由`Cmt`执行legacy parser。现代`x-openai-input`resource/file/template等字段不满足legacy parser，原包显示unsupportedOpenAIForm；不能把共享Electron/App表单中存在的现代代码当作当前VSIX wire的已启用功能。产品对这些同样显示原字段id/类型并禁用接受，保留decline/cancel，禁止发送部分表单。标准gallery已完成；普通卡片文件能力gate未开放；现有主composer附件上传核心保持不变。提取schema与原始parser见`elicitation-native/openai-parser-readable.js`。

Guardian当前正式运行层缺原始事件、启用gate和记录查询能力，因此保留只读复核详情。注入式安全接口与显式能力调用方已测试，不能作为正式运行层已启用的证明；启用仍需要真实原始事件通道和可信gate来源，不在活跃Agent期间替换Rust运行层。

本次属性对照没有验收所有宿主字号/DPR、全request状态逐像素差异，未声称perfect pixel全量闭合。请求区域Enter局部处理；插件的Electron默认全局Enter/Escape binding不直接移作本项目隐藏模式全局监听。

请求与Guardian完整server `tsc --noEmit`通过`requests-guardian-server-typecheck.log`；最新完整web检查`account-final-typecheck.log`记录并行goalDrafts/探索模块/layout callback测试问题，本账户测试类型错误已修。最终工作区整体gate由主线程完成，不把本模块计数当整体完成。

## 短视口、滚动与两引擎追加验收

2026-10-10，扩展完整请求流程到1440×1000、768×900、480×900、390×1000、844×390和390×420，各有浅深主题与两类实际交互。保持原 thread/turn/item/request/token 的准确 HTTP 回复，覆盖 Escape 收起无 RPC、Enter 审批、逐题自由答案、数字无效→有效、默认图片模板及显式文件能力、原行42 patch、秘密仅内存、uncertain 不重发与旧轮异步问题失效。API/事件使用隔离夹具，不向正式 Agent 发出测试操作。

`requests-nested-scroll-cause.log` 保存字段容器实际无可滚范围92/92却使用 contain 的红灯：用户滚动被吞掉，不能把提交滚进聊天。字段区允许纵向传递；图库仅保留横向边界，纵向同样传递。卡片高于短视口时通过正常阅读滚动逐项到达，测量真实中心命中再点击，没有要求整张卡片同时可见、强制点击或修改产品阅读状态绕开问题。

最终 Chromium `requests-owner-actions-final-chromium.log` **24/24、5.2min**；WebKit `requests-complete-touch-lists-final-webkit.log` **24/24、3.7min**，各1 worker。前一 WebKit 单批22通过/2失败来自测试自造 TouchEvent 缺少 changedTouches；补齐三个实际事件列表后两场景2/2，再完整24/24。此是夹具形状修复，未改变产品触摸监听。两引擎各12张 requests-page 整页截图已全部用图片工具查看，控件/阅读区域几何与各场景原请求回复另有 JSON 回执。

Chromium 手机滚动使用 CDP 实际可信 touchStart/move/end，横屏与短视口触摸后完成准确提交；桌面使用真实 mouse wheel。Playwright mobile WebKit 不支持 mouse.wheel 或原生 swipe，本批明确是**未可信 DOM 触摸事件处理 + 实际视口滚动/布局与真实 tap**，回执标注 webkit-synthetic-touch-handler-and-viewport-scroll。它不能替代实体 Safari 手指纵向拖动、软键盘或 OS 选择器；不把两个引擎的证据混称实机全通过。

模板边缘箭头另有 `request-gallery-behavior-red.log` 手机32×44椭圆→`request-gallery-green.log` **4/4、22.3s**。仅粗指针热区44×44，内层32px圆保持原中心；真实 Next/Previous 的 snap 位置4→712/266→4，选中模板、输入目标、草稿与请求身份不变，无审批/提交。桌面两主题几何保留。新增规则只追加专用gallery块，不改schema或原包资产。
