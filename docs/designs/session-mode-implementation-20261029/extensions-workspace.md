# 本地执行环境、MCP App与实时语音

日期：2026-10-30。属于已批准全量方案E/F；不修改官方VSIX，不实现IDE宿主适配、云任务执行或云工作区。本域组合功能验收使用独立冻结 **HTTPS `https://10.30.0.24:38887`**，语音全链使用更新冻结 **HTTPS `https://10.30.0.24:46593`**，最后手机工具键盘修复使用 **HTTPS `https://10.30.0.24:40475`**，均绑定`0.0.0.0`，没有正式API代理；普通浏览器用例显式安装隔离fixture。地址与私有PID/start ticks、源码manifest存于忽略目录`.dev-runtime/extensions-workspace-20261029/frontend-{38887,46593,40475}.json`。旧监听在验收后按精确自有身份关闭。这不是正式部署或两秒性能结论。

## 范围与逐项证据

| 方案ID | 本域实现 | 本轮验证与边界 |
|---|---|---|
| CMP-31（本域子能力） | `features/files/{ProjectReferencePicker,projectReferences}`、`features/mcp-apps/McpAppView`；本地UTF-8文件/单层目录快照及MCP消息/上下文进入原owner草稿 | 项目引用选择/同值账号撤销/UTF-8预算、桌面1440/手机393引用保稿浏览器通过；MCP桥接原owner上下文有单测。此复合行还含其他owner的线程、PR与托管平台引用，不以本域子能力通过代替整行完成 |
| CMP-36 | `features/workspace-execution/*`、`services/codexService.ts`、`services/apiAdapt/git.ts`、运行层`git/index.ts`、服务端`workspace-environments.ts` | 新聊天/分支实际使用新worktree目录；选择基础分支只用于新worktree起点，不检出原仓库。环境命令以明确argv执行；只确认保存不会执行。已核对start/fork捕获目录、账号/运行scope、未知创建记录、准备回执及只读inspect红绿 |
| CMP-37 | `ExecutionLocationPicker/Panel`与`composer/slashCommands`工作树命令 | 菜单/斜杠共用新会话设置；已有会话保持原cwd。桌面/手机工作环境选择与草稿保持通过，真正新建目录/原生cwd另由服务和运行层测试核对 |
| CMP-38 | `features/workspace-execution/ExecutionLocation{Picker,Panel}`与`workspace-environments.ts` | 明确打开后才加载配置；环境创建、版本保存、删除、设置命令显式确认与失败恢复；同值账号撤销组件2项与17项服务器回归通过。没有单独照搬官方IDE configPath打开入口，配置编辑使用看板自身面板 |
| CMP-39 | 同一工作环境面板的baseBranch选择、`codexService.prepareWorktree`与运行层Git | 按项目隔离起点分支，新工作树实际目录用于start/fork；已有会话cwd不随dropdown改变。创建/恢复单测、实际Git目录/环境执行服务器测试与两尺寸工作环境浏览器通过 |
| CMP-27/H20（本域子能力） | 自有项目文件/文件夹引用与`openWorkspaceFileReference` | 文件/目录快照可加入原owner草稿；已注册canonical root别名与撤销反例通过。IDE编辑器选区注入不在本期，设备文件上传/图片标注/粘贴/drop/order/undo分别由composer owner补整行证据 |
| LG22（保留回归） | `features/files/FilesPanel`、文件document store与`AppLayout` | 6文件35项单测通过；1440/393文件全文503行、保存期间新稿、跨工具/文件、失败保稿、关闭未保存文件后取消保留草稿与键盘inert通过，文件树1440/390通过。393发现背景工具未inert先红，修复后六项组合绿46.5秒，追加两尺寸关闭文件确认2/2绿14秒 |
| LG23（保留回归） | `features/vscode/VsCodePanel`与`useVsCodePanelStore` | 既有独立编辑器保留，不新增IDE功能；375/1440真实iframe fixture验证缓冲区与frameIdentity跨工具/四个功能页保持、项目固定/跟随、canonical alias合并、503后重试。包含于最终6/6保留浏览器46.5秒；不是实际code-server/VSIX模型交互验证 |
| CMP-51 | `features/realtime-voice/*`、`features/audio/microphoneLease`、运行层`codex/realtime.ts` | 精确官方CLI0.165.0的WebRTC客户端已接入：preflight→明确替换确认→start/SDP→appendText→stop；普通turn不参与语音投递。实际UI→实际网关→实际运行层→官方私有daemon→真实Chromium双peer/typed/owned stop完整链路通过；测试provider不生成模型音频，不能据此宣布在线语音内容已验证 |
| T21 | `features/mcp-apps/*`、运行层`codex/{mcp-apps,mcp-app-source}` | 原生精确thread/turn/item→实际目录工具/资源→资源HTML→双iframe握手→显式工具同意→native call；关闭/隐藏/账号变化撤销。真实本地官方native及两尺寸Chromium通过。托管codex_apps的connector/link/originCallId有拒绝反例，真实已登录托管服务未在无登录夹具中验证 |
| T20（兼容回归） | 既有MCP活动/工具卡、native source reader | 原生MCP真实工具item与独立只读历史详情核对；不将UI摘要作为工具原始结果 |
| LG30/31/32（兼容回归） | 既有`features/native-mcp-auth`和MCP管理页 | 控制器、service、管理配置单测纳入本域广域检查；4个深浅主题/两尺寸认证详情文字对比度红灯修复后全部转绿，OAuth流程、配置保留与拒绝跨实例由隔离fixture核对，不能代替真实账号OAuth |

CMP-12和CMP-48的主动作/听写语义由输入owner负责；实时语音仅提供精确目标的`sendText/stop`控制与互斥麦克风lease，不另外实现一套普通消息发送器。

## 本地执行事务

创建意图在设备端按真实native namespace、服务目标、项目和唯一意图ID登记，保留准备/worktree/setup/native阶段。原生写出前重新读取`lifecycle/context`并核对scopeToken，最终JSONL写出继续核对，不能把客户端guard称为跨客户端CAS。

工作树创建和设置失败保留已创建目录。回执未知不自动重建目录、重复执行设置命令或重发native start/fork；已有待核对记录阻止再次创建同一意图。准备阶段可显式只读核对git worktree注册和精确环境receipt；只有已证明尚未进入native阶段，才允许用户结束本次记录，目录和已执行结果仍保留。native已发送/不明不能通过“列表为空”解锁。手动选择候选结果还要核对原scope/cwd及记录未被另一页面更新。

环境配置保存带版本冲突检测；执行命令通过`spawn(program,args,{shell:false})`，设置receipt先写unknown再执行，同一intent不会再次执行。命令输出和执行时间有界，超时/输出超限保持unknown，不能伪报成功或自动补偿。参数中的`$()`、反引号保持普通argv内容。

## MCP App的身份与生命周期

页面不能提交任意服务器地址、资源目录或native方法。固定路由从现有有界EventHub读取精确原生MCP源；旧项才使用原独立只读detail reader。该reader不持有第二份正文缓存，遇到账号同值通知、断线或连接代次变化撤销旧源，读历史不resume。

工具目录、源resource URI和实际resource响应必须一致；托管连接还核对connector/link权限及originCallId，不根据显示名猜权限。HTML、目录、工具数据及并发请求均有预算。资源CSP声明经过限制后才创建opaque-origin代理和内层sandbox，widget不拿到工作区、凭证、MessagePort替换权或任意Agent RPC。

握手完成后才投递初始tool-input/result；来源完成通知可更新该精确结果。工具调用每次显示名称与参数并明确允许，按native scope/目录再次核对，重复RPC/intent不重投。widget message/model context只进入原会话草稿，不隐式发送。正常关闭先请求teardown；隐藏正文、离开页面、账号撤销会释放iframe、观察者、消费者和原context。已经写出的未知调用不自动撤销或重试。

## 语音状态与资源

浏览器控制器状态为idle/starting/active/stopping/failed；服务端context另有ready/starting/active/stopping/revoked，绑定精确thread和连接/账号修订。只在官方已加载线程上开始语音，preflight不resume；开始按钮明确说明会替换该线程已有语音连接。

文字语音通过专用appendText和本地未知回执记录，不走turn/start。唯一intent是本层防重复身份，不能描述为原生幂等。旧unknown保留hash与owner，刷新后不能悄悄发送相同文字；不同的新文字也需要用户核对旧记录后显式放弃后续重试。

麦克风lease、MediaStream、RTCPeerConnection和音频接收端由同一个控制器释放。切换会话或隐藏模式只结束本组件创建且仍匹配精确nativeScope/租约的realtime媒体连接；普通Agent轮次、队列和Goal不受影响。账号撤销只释放自有浏览器资源，不停止可能已被其他客户端替换的native语音。切换会话后旧start/stop回调不能覆盖新UI；取消后迟到的麦克风lease仍须释放。返回聊天保留同一个音频接收节点，提供独立麦克风/扬声器静音；不能因为Dialog卸载而丢失回复声音。已结束/取消的context会从有界准入表回收，连续使用不会耗尽32项预检容量。文字哈希等异步步骤完成后再次核对账号/连接/目标，撤销期间不写未知记录或appendText。

## 已执行与待完成验证

- 当前本域广域web检查14文件63项通过，运行层加并发context准入后17项通过，另文件/布局保留6文件35项通过；web最新全量类型检查通过。运行层曾全量通过，最后一次被另域`auxiliary-history-reader.test.ts`返回union类型错误阻塞，本域无错误。后续整合以root最终结果为准。
- 项目文件/环境服务17项通过，含真实argv执行、版本冲突、只读receipt、注册根/符号链接/越界和大目录预算；没有执行正式仓库的设置命令。
- 官方0.165.0私有HOME/无登录native2/2通过：真实MCP source→catalog/resource→显式第二次tool call→旧项只读详情；真实realtime offer→sideband→SDP→typed→stop。结束后核对私有daemon PID/start ticks已退出，未接正式CLI IPC、未复制账号。
- 本域最终组合Chromium **13/13通过，53.2秒**：两尺寸MCP App及同值账号撤销、MCP认证深浅主题/两尺寸4项、插件目录失败/重试、两尺寸工作环境与引用保稿、已注册canonical root别名、两尺寸真实WebRTC。先前4个对比度失败（浅4.471/深3.937，门槛4.5）保留，修复采用同主题foreground文本，不降低门槛；canonical root别名在旧冻结上先红、修复冻结转绿。
- 实际UI→生产网关/运行层→官方私有daemon→Chromium双peer全链最早1/1通过7.9秒，最后hash-await scope修复后的`46593`冻结重验 **1/1通过，9.5秒**；typed文字只接收一次，native realtime/closed只出现一次，无浏览器pageerror，最终核对owned daemon退出。麦克风使用浏览器模拟设备，信令/媒体peer均是真实实现。
- 迟到lease、旧语音phase、Dialog音频接收端、context准入表、工作环境账号撤销及文字哈希等待期间scope撤销均有独立红绿灯。服务端反例还核对旧context收到其他客户端realtime/started后不得stop新语音；全项目候选以整合owner冻结与验收为准。
- 预检发布context前同步重查准入容量：40个并发voice请求最多32项，63个MCP App加6个并发请求仅接受1项，不把异步读取前检查当作最终准入。两个独立反例均先红后绿。

日志、原生指标与失败截图保存在忽略目录`.dev-runtime/extensions-workspace-20261029/`，包括`closure-verified-browser.log`、`closure-native-browser-final-2.log`、`closure-native.log`、`closure-wide-web-final.log`、`context-budget-green.log`、`closure-server-unit.log`、`mobile-tools-inert-browser-green.log`、`file-close-retention.log`及各红绿灯文件。真实在线账号/托管连接、模型语音内容和实体iPhone不在本地无登录夹具结果内；不将浏览器模拟麦克风或viewport写成实体设备验收。
