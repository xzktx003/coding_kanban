# 消息与线程工作流实施证据

正式局域网产品：`https://10.30.0.24:8484/?mode=session`（HTTPS :8484）；启用 VSIX 原包只读参考：`http://10.30.0.24:43831/native-markdown.html`（HTTP :43831）。所有 mutation 浏览器验收均隔离拦截 API fixture；没有向正式 Agent 发送问题、没有重启正式运行层、没有提交或推送。原 VSIX 资产和原始 reference harness 未修改。

## 原生主来源与能力边界

| 主来源 | 已验证行为 / 限制 |
| --- | --- |
| `plugin-readable/user-message-a9427cd0db0e.js` `Ft` 983–1700；`local-conversation-turn-8d1d57382579.js` 1080 附近 | 仅最后用户消息提供原生行内编辑回调。实际原包 Copy/Edit 控件22×22px、SVG16×16px；原包真实编辑框13px/17.55px、最小40px、最多25dvh、form radius25px。 |
| `plugin-readable/sites-end-resource-39518ab206b4.js` `tb` / `ub` 6002、7264 附近 | 完成回复复制全文；原生 fork `f3` SVG；助手操作条 mt6/min-height20/gap2/扩展环境向左6px。 |
| `plugin-readable/local-conversation-thread-6b8a7f284834.js` 8180–8268；生成 `ThreadForkParams` | 真实原轮次边界 `lastTurnId` 包含完成轮，`beforeTurnId` 排除所选轮；不把当前活动会话当作异步操作的源。 |
| 同上 `Bh` / `Hh` 7910–7970 | `thread/searchOccurrences`，case-insensitive literal user/final assistant，limit250，真实 turn/item、UTF-16 snippet range、inclusive turnCursor、每item occurrence ordinal；原生版本门槛0.145.0-alpha.24，unknown0.0.0可探测，缺失能力退回本地。生成类型存在不代表当前运行可执行。 |
| `plugin-readable/plan-summary-item-content-11a738be43f9.js` `H`；`local-conversation-turn-8d1d57382579.js:4994` | 真实defaultCollapsed=true；header40px、8px/12px，body12px/16px、折叠320px、渐隐160px、展开auto。实际 Open 发出`show-plan-summary`，携带原planContent/conversationId/hostId。 |
| `plugin-readable/thread-user-message-navigation-rail-48b58b10bc48.js` | rail36×10px、marker26×2px、初始scaleX.2308、邻近hover渐进；定位真实消息身份，不能依赖当前挂载DOM。 |
| `plugin-readable/checkpoint-674a40799147.js`；`checkpoint-bd48a816eff8.js:9–30`；`checkpoint-preview-f412d8448c39.js` | 实际为云Page `/pages/{page_id}/versions/{checkpoint_id}/checkpoint-bootstrap`，校验PageId/checkpointId/expiry并投影PageDocumentTheme。不是本地Codex线程或文件检查点。未添加历史书签冒充该能力，未保留未使用的“checkpoint restore”适配；线程rollback只改历史。真实文件patch Undo/Reapply由review子任务覆盖。 |

自己的 `review/native-message-reference.js` 使用原生组件和真实providers/Router、无账号fixture，只接只读原包页面。`tests/e2e/session-thread-message-reference.spec.ts` 实际对比原生复制/编辑SVG与编辑geometry，并断言真实Open host payload。原包中文“套餐”翻译与产品既有“计划”有差异，不宣称文字像素相同。

原生搜索支持状态由 review 子任务的独立新Rust二进制HTTP测试确认：installed CLI0.161.0和VSIX CLI0.162.0-alpha.2均返回JSON-RPC -32601“thread/searchOccurrences is not supported yet”；新REST adapter明确HTTP501。主要回执`review-readonly-native-http-receipt-0.161.0.json`、`review-readonly-native-http-receipt-0.162.0-alpha.2.json`均记录nativeSearchSupported=false、actualUtf16SearchHitCount=0、loadedThreads/rollout bytes/formal PIDs unchanged、noWriterLock=true。当前正式运行层未重启启用新只读路由，因此可能HTTP404。两者只表示确定不支持，不能把已加载历史搜索宣传成已启用原生全历史搜索；协议边界见`docs/session-native-readonly.md`。

## 产品集成与所有权

- 搜索、用户消息导航、源Markdown导出和会话链接进入既有ConversationMenu；`ThreadWorkflowToolbar` 空闲零高度，root已经挂载搜索面板/rail和稳定虚拟锚点。打开搜索时仅该面板占自身自然高度，保留原生align:top并露出首个匹配消息；关闭后零高度。隐藏的同线程挂载不会消费导出/复制、主动聚焦或发搜索请求。Ctrl/Cmd+F只由实际可见所属面板处理；Enter/Shift+Enter、Ctrl/Cmd+G/F3、IME与Escape由tool子任务集成，CSS Custom Highlight定位真实Markdown文本，保持原DOM。root已经将实际agentMessage.phase投影，completed commentary不会误进入fallback搜索。
- 原生搜索通过只读 `POST /api/codex/thread/search-occurrences`；捕获thread/query/cursor、150ms debounce、AbortController、原生limit250。返回真实turn/item/snippet/UTF16 range/cursor；远端结果在只读加载对应inclusive cursor并找到实际虚拟row以后才导航。较旧owner/query/result不能抢导航；分页点击原子合并，nextCursor重复显式报错。404/405/501才启用已加载历史fallback，400/401/403/5xx、无效响应和游标均显式报错；不制造整段历史或伪造rowId。部分历史的搜索和导出明确标明载入范围。
- 导出从结构化user/assistant/plan消息构造，排除UI、raw reasoning、公开摘要和未完成回复；清洁协议citation且保留代码围栏字面内容。会话URL沿用当前协议/主机/端口，清理无关query/hash/credentials。
- 复制链接入口已接 `useUrlParamThread`。只读验证原生id/cwd/实际turn历史，合并到捕获线程缓存，原完整read响应的设置经`nativeThreadSettings/hydrateThreadModel`按提交前捕获的原owner revision投影；较新原owner设置和B配置保留。通过既有`useLayoutStore.setView`离开保护批准后才加入关注并由`useSessionTabActions.selectTab`同步标签/输入/项目。读历史期间、确认框期间重新检查初始选择CAS；取消或用户选择B时不加入原关注、不切输入/项目、不改草稿。已有`CodexAccessNotice`的`thread/access {release:false}`仅轮询`ownership.access`只读占用状态；没有release:true、resume、execution acquire、start/send/stop。
- 最后用户消息用独立持久行内buffer，保留detached composer原文字、图片、contexts/drawings。显式确认后读取最新实际thread/turn/item并确认idle，rollback精确原边界，再次只读检查边界后发送完整原附件输入。提交前捕获原owner的cwd/model/effort/serviceTier/approvalPolicy/approvalsReviewer/sandbox/network/collaborationMode；等待期间改变活动会话或原设置不会改变提交快照。较新草稿保留。pending/网络或5xx未知结果不盲重发，rollback移出行后的buffer仍可恢复/复制；已知成功fork可以作为新的用户意图再创建分支，同时并发与未知结果仍禁止重复。
- AgentMessageItem提供完成复制/原生fork/selection reply与hook stats；保留引用与侧边追问。有效`::code-comment`经review parser进入`NativeReviewFindings`和按实际thread/turn/item的保存store，虚拟卸载不删除发现。native触控控件44px，无被动自动聚焦。
- Plan Open使用实际同源独立浏览器页面。`main.tsx`在挂载WorkbenchShell之前选择`PlanWindowEntry`，不挂载主/会话App；有界sessionStorage不可变snapshot、opaque UUID query、30分钟expiry、opener=null。独立realm渲染同一CodexMarkdown代码/表格/图片/visualize，捕获theme/owner/cwd；仅显式安全文件引用通过BroadcastChannel在原窗口定位原项目文件，不切输入/项目。独立entry重置并在卸载时恢复自身document的浏览器body margin/background/colorScheme，自己的root与document canvas采用已渲染原生pane实际背景色（透明时才使用有界snapshot fallback），避免8px白边、overscroll白色或工作台背景色带；不写主窗口样式。缺失、错误或过期snapshot显式错误；不插入随机HTML、不用下载替代Open。
- FileViewer原文件选区进入同一`addBrowserEditorContext`校验管线。按动作时捕获真实Codex/draftOwner/thread/cwd，匹配已验证canonical alias与pinned file root，严格子路径/范围/文本限制；来源项目不匹配时显式拒绝，不加到其他项目草稿。CC/ACP既有文字追加保留。

## 红绿灯及当前证据

下列日志、screens和隔离产物位于git忽略的`.dev-runtime/session-render-alignment/`；文件名带green但实际失败的早期产物仍按失败处理。

| 验收 | 当前有效结果 / 证据 |
| --- | --- |
| 消息/编辑/ledger基础红绿 | `thread-workflows-model-red.log`、`thread-workflows-delivery-red.log`、`thread-workflows-inline-edit-red.log`、`thread-workflows-plan-red.log`到对应green；包含IME、附件、未知结果和detached原草稿。 |
| fork明确新意图与不可变源 | `thread-fork-intent-red-fixed-fixture.log`2真实失败 → green7例/2文件。 |
| fork当前选区而非缓存 | `thread-fork-selection-current-red.log`3真实失败（null selection、foreign-owner selection、更新的fragment）→`thread-fork-selection-current-green.log`10例/3文件；点击按原contentRef.ownerDocument当前实际selection取值再不可变捕获。`thread-fork-selection-current-browser.log`实际延迟fork/选区/跨标签草稿1通过。 |
| 完成review保存投影 | `thread-review-projection-green-final.log`5例/2文件。 |
| 可见owner键盘focus/导出 | `thread-search-owner-focus-red.log`2失败 → green6例/2文件。 |
| 原生可搜索来源与URL边界 | `thread-search-link-source-red.log`2失败 → green6例；plan/公开摘要/commentary/live assistant不当做原生搜索消息；重复/空turn URL拒绝。 |
| 原生只读API / cancel /分页 | `thread-native-search-red.log`缺少实现 → `thread-native-search-green.log`3例；`thread-native-search-owner-red.log`1真实并发分页失败 → `thread-native-search-owner-green.log`10例/3文件。 |
| 真实remote anchor与设置快照 | `thread-native-search-edit-owner-green.log`8例/2文件；原tier/reviewer/权限在延迟read和另活动owner后保留；远端错item或过期query不能导航。 |
| 链接只读/CAS/离开保护 | `thread-link-layout-guard-red.log`2失败 → green6例；`thread-link-selection-guard-red.log`2失败 → green11例/3文件，cancel不follow，confirm只执行一次。 |
| 链接实际LAN roundtrip | `thread-link-entry-browser-final.log`2通过/12.1s；真实clipboard URL在新browser context打开正常关注标签/项目/精确turn；晚到read只缓存原历史。`e2e-thread-link-entry-final/`含全页截图。早期endpoint名“access”断言失败是只读状态轮询语义澄清，保留原红log，不当成执行权限获取。 |
| FileViewer上下文 | `fileviewer-editor-context-green-final.log`8例/3文件，原draft key、trustedalias、跨项目拒绝与CC保留；实际Ace浏览器验证另见下方最终记录。 |
| Standalone Plan snapshot/owner | `thread-plan-entry-owner-scope.log`8例/3文件；无resume/start/fork/rollback，原owner安全文件请求。 |
| Standalone Plan实际4组合 | `thread-plan-entry-four-browser-final.log`4通过/25.9s；1440/390 × dark/light，PNG真实naturalWidth120×72、code/table、visualize交互与nonce resize、popup自己的展开dialog、原cwd安全文件定位、opener=null、主draft intact、无mutation/pageerror。`e2e-thread-plan-entry-four-final/`有四组合图片。 |
| 当前子任务scoped总检 | `thread-workflows-native-final-owned-unit.log`24文件82例通过/19.32s，包含最终popup canvas颜色修正；较早`thread-workflows-final-document-theme-types.log`前端tsc空输出、退出0。最后`thread-workflows-native-final-types.log`仅因同期新`vite.config.ts:10`导入`../../scripts/vite-dev-cache.mjs`缺声明TS7016退出2，已交根任务统一闭合，不计为通过。测试包含新增API/URL/Plan/FileViewer/旧buffer恢复、布局离开保护callback及既有回滚/图片/review；较早22文件75例为历史阶段记录。 |
| 原包+完整工作台最终浏览器 | `thread-workflows-final-all-browser.log`17例通过/1.6min，完整message-reference2+工作流4+fork/edit/unknown3+独立Plan4+链接2+真实Ace1+remote fixture1；`e2e-thread-workflows-final-all/`有原包与实际全页/四种popup截图。 |
| 最终合并单次完整浏览器 | `thread-workflows-merged-final-browser.log`18例全部通过/1.8min，1 worker、`session-thread-workflows.spec.ts`+`session-thread-message-reference.spec.ts`同一轮，LAN HTTPS8484与原包HTTP43831。包含原包深浅2例、桌面/手机深浅搜索与导航4例、不可变源fork/延迟完整附件与settings编辑/未知send防重复3例、最终Plan原生菜单与canvas4例、真实复制URL正常follow与晚到CAS2例、实际Ace选区跨项目保护1例、真实turn/item/cursor远端fixture1例、较新user turn后旧buffer恢复1例。`thread-workflows-merged-final-screens/`保存原包和实际工作台/Plan全页截图。本轮没有产品source或测试夹具变更，无失败重试。Vite HMR连接warning保留，不算pageerror；当前CLI原生搜索未支持的来源边界仍成立。 |
| 首条搜索结果露出 | `thread-native-search-occlusion-red.log`真实匹配row y109被面板bottom177盖住 → `thread-native-search-occlusion-green.log`5例通过/31.3s，4device/theme local profiles+真实远端cursor；明确断言target top >= panel bottom，保留原生align:top。 |
| 独立Plan scoped snapshot | `thread-plan-snapshot-scope-red.log`1失败 → `thread-plan-snapshot-scope-green.log`11例/4文件，缺少session-mode或数组CSScontainer明确拒绝，合法owner与media保持。 |
| URL原owner设置 | `thread-link-owner-settings-red.log`1失败（model/tier/permissions未hydrate）→`thread-link-owner-settings-green.log`6通过；原owner revision保护及B隔离。 |
| 较新用户turn的旧编辑buffer | `thread-edit-changed-target-buffer-red.log`2失败 → `thread-edit-changed-target-buffer-green.log`12例/3文件；即使原row仍在，原turn/item不再最后用户时独立内容仍可访问。`thread-final-source-guards-browser.log`4通过/20.3s，含真实新turn到达的可复制buffer、未知send不repeat、URL+CAS；`e2e-thread-final-source-guards/`有全页图。 |
| 本地未发起mutation的确定性 | `thread-mutation-not-started-red.log`1失败/5通过 → `thread-mutation-not-started-green.log`14例/3文件。根任务中性`MutationNotStartedError`只标记RPC之前本地guard；ledger用instanceof识别，rejected可在稍后明确意图重试，非结构化“Invalid params”等文字不推断未执行，network/5xx仍uncertain。 |
| 行内提交revision | `thread-edit-buffer-revision-red.log`1失败/6通过（text A→B→A的新revision被误删）→ `thread-edit-buffer-revision-ui-green.log`13例/3文件；helper仅清理捕获的原buffer revision+text，组件不重复删除较新buffer。 |
| 编辑最终LAN防漂移 | `thread-edit-revision-final-browser.log`3通过/14.5s：原settings/附件与detached草稿、未知send不repeat、较新user turn后的旧buffer可恢复。 |
| 既有测试协议与owner夹具修正 | `thread-workflow-existing-fixtures-red.log`2失败/6通过 → `thread-workflow-existing-fixtures-green.log`4文件18例通过。unsupported native rollback使用真实HTTP400 `SessionApiError`明确拒绝，不按未结构化错误文字推断未执行；既有选区夹具补真实native thread cwd/pinned root，断言原/另owner文本和contexts保留。网络未知和typed本地未发起的既有保护同跑通过。 |
| 独立Plan默认canvas留白 | `thread-plan-canvas-margin-unit-red.log`1失败/1通过，`thread-plan-canvas-margin-browser-red.log`移动dark真实x8/y8/width374而viewport390 → `thread-plan-canvas-margin-unit-green.log`3文件7例通过；`thread-plan-final-native-menus-canvas-browser.log`4组合通过/30.8s，x0/y0且宽度等于视口，自身body margin卸载恢复。 |
| 独立Plan原生画布和实际菜单最终4组合 | `thread-plan-canvas-theme-red.log`1失败/1通过 → `thread-plan-canvas-theme-green.log`3文件7例通过；`thread-plan-canvas-native-background-red.log`实际app RGB32/37/44与native pane RGB32/33/29不一致 → `thread-plan-native-final-browser.log`4通过/32.1s。1440主页面/960 popup 与390 mobile × dark/light，exact body==native pane RGB、x0/y0与真实视口宽度；code wrap+真实clipboard+code.ts下载、table TSV真实复制+table.csv下载、decoded PNG、visualize nonce resize/interaction/popup own dialog、captured file owner、opener null、无popup App/mutation/pageerror。`thread-plan-native-final-screens/`保存最终4组，dark截图实际底部RGB32/33/29、light白色，与原生pane一致。 |
| 真实Ace最终独立证明 | `fileviewer-editor-context-browser-owner-final.log`1通过/6.5s；最终完整17例运行已补合法canonicalize/read-directory fixture并去掉不相关文件树错误，原选区text+真实1–2行进入原context；切B后pinned原项目file拒绝，两owner文字/contexts不漂移。 |
| 消息原包及工作台初次完整LAN | `thread-workflows-popup-browser-final.log`10例通过/57.6s（原包2 + 工作台4 + fork/edit/unknown + 早期popup）。此运行没有真实decoded图片证据；图片证明使用之后的standalone四组合。 |

### 保留的失败诊断

最初跨document React挂载在about:blank popup：主窗口真实PNG已decode120px，popup同src保持complete=false/naturalWidth0。`thread-plan-popup-four-browser.log`、`thread-plan-popup-image-browser.log`四组合真实失败，`thread-plan-popup-img-stall.log`保留对照。document.open/close实验也失败，其代码已移除。最终采用同源独立entry解决page realm，而不是降低图片断言。原fixture的page.route优先于context.route导致主visualize返回空响应、移动暗色缺owner metadata，以及Ace测试误用layout属性/文本草稿store/末尾空行range的失败日志均保留；最终使用实际mounted HMR store和真实产品选区范围，不改原包render字段掩盖问题。

最终Plan截图的时序诊断`thread-plan-canvas-paint-diagnostic.log`记录：截图前实际root/document高度972px，截图过程中布局收缩到913px、scrollY始终0；截图clip残留白色尾部不能据此声称root没覆盖真实document。fonts/layout等待及直接CDP截图仍保留这个高度变化，之后按真实native pane颜色完整主题化自身document/root，使resize/overscroll canvas本身正确；没有裁去问题像素、改图或改原包render输入。最终截图等待自己的document.fonts.ready、两帧布局及展开dialog实际卸载，用真实popup的`Page.captureScreenshot captureBeyondViewport`保存实际canvas。一次TSV读取发生在浏览器异步clipboard.write完成前（读到此前code文本），`thread-plan-final-own-document-theme-browser.log`保留3通过/1失败；最终明确poll真实clipboard直至exact期望内容。Vite HMR websocket连接warning仍在浏览器日志中保留；popup pageerror、主App挂载和Agent mutation均显式断言不存在，未把开发连接warning宣称为renderer故障。

## 当前真实剩余边界

- REST新只读路由的正式运行层激活仍需根任务安排活跃Agent安全窗口；当前正式服务没有被本任务重启。
- installed0.161.0 / VSIX0.162.0-alpha.2实际均不支持`thread/searchOccurrences`。正向remote结果、分页、真实cursor hydration可用隔离generated-shape fixture验证；不能据此声称当前native CLI已支持全历史搜索。fallback仅搜索已加载原生消息。
- 云Page checkpoint是独立账号/Page路由能力，不是本地thread/files功能；本任务没有创建替代性“native checkpoint”。
- 主题/字号/spacing和整页验收包含原生SVG/编辑geometry及LAN四组合证据；全产品其余面板、原生账号gates与整体像素对齐由根任务汇总，不能据本子任务通过宣称整个工作台像素完全一致。

## 完整范围审计追加：P4 快照不可用状态恢复

2026-10-10 的只读 P0–P4 审计发现 `CodexCloudService` 将同账号/token 的 snapshot HTTP403/404 永久缓存，现有“刷新账号”只返回该缓存；真实接口恢复后仍没有可用的手动重试入口。根任务明确授权此最小后端修复，产品前端和正式运行层未重启。

`apps/server/src/services/codex-cloud.ts` 现在将不可用原因缓存60秒。期限内仍返回 `snapshotAvailable:false` 和原HTTP原因；期限到达后，同账号的 `GET capability` 仅删除过期缓存并返回 `null`（未知、可由用户显式重试），不假设云端已经支持、不发网络探测、不上传、不创建任务。恢复提示明确说明一分钟后刷新账号恢复手动入口。上传仍需现有用户确认与实际签名/上传/finish校验；旧云接口实际404的外部限制仍成立。

`cloud-snapshot-capability-ttl-red-behavior.log` 记录两个真实403/404过期行为红灯（`false !== null`，3既有通过/2失败）→`cloud-snapshot-capability-ttl-green.log` 单次5/5、442.29ms。两个新用例在隔离临时Git与合成账号/fetch中验证59,999ms仍不可用、60,000ms恢复未知；多次capability读取的云fetch计数始终为1，只有后续显式upload产生POST/PUT/finish，任务POST为0。首轮未初始化HEAD的夹具错误保留在`cloud-snapshot-capability-ttl-red.log`，不算行为红灯。`cloud-snapshot-capability-ttl-types.log` 为空，Node tsc退出0；只格式化自己两个后端文件。没有实际云mutation、正式服务操作、提交或推送。中央功能/bug清单由根任务同步。

## Enabled 本地引用与公开记忆追加

只读全范围审计沿真实启用的 Sites `tb` → E98 `Ppi/Rpi` → `Zfi/Rfi/Cfi` 找到文件引用链，纠正了仅按 opaque ChatGPT citation marker 排除的旧边界。原包 `:codex-file-citation{...}` 和本地 legacy `【/path†Lstart-Lend】` 是启用能力；`MemoryCitation.entries` 的 action count/公开 note tooltip 同样由实际 agentMessage 提供。权威来源与 schema 位于 ignored `completion-source-citation-audit.md`、原包 formatted `review/app-initial-e98-readable.js` 和 `plugin-readable/sites-end-resource-39518ab206b4.js`，不是重新发明引用语法。

实现入口为 `features/native-citations`、`CodexMarkdown`、`EventItem`、`AgentMessageItem` 和 `NativeMemoryCitations`。只转换正文中的完整有效 directive/legacy；代码、HTML、普通 Markdown 链接/图片/转义和 malformed range 保持字面原文。外部引用使用实际 HTTP(S) URL；本地点击捕获原 thread/cwd/host，并验证真实 root、路径和起止行。`useEditorStore.revealFile(..., endLine?)` 与真实 Ace inclusive selection 传递完整范围；502–503 等超过500行的引用读取已载入全文进行只读定位，仍须原有显式“加载全文以编辑”，不自动聚焦键盘、不切换输入目标或项目。非法/倒序 range 不生成伪成功 pill。

公开记忆只显示 native 本地化 count 与 note，不读取或呈现 private path/threadId。原包中文 locale 的真实值是“引用的记忆”和“{count} 条记忆引用”，SVG 三个 path 取自实际启用 source。完成回复 copy 与会话 Markdown export 使用原包 `wfi/Tfi/Afi` 的 basename/本地化范围格式；例如 `source.ts （第 502-503 行）`。转换使用 Markdown inline grammar，而不全局替换所有 citation 字符串，消息存储保持原样。

实际行为红灯包括 memory metadata `native-memory-citation-red-protocol.log`（2失败/1通过）、range `native-citation-editor-range-red.log`（3失败）、500行 preview `native-citation-file-preview-range-red.log`（1失败）、copy/export `native-citation-copy-export-red.log`（2失败/1通过）、GFM 跨自动链接节点 `native-citations-gfm-red.log`（2失败/2通过）及非法范围 literal `native-citation-invalid-range-red.log`（1失败/8通过）。最终同一轮 `native-citations-full-integrated-green.log` 为 **8文件64测试通过，8.80秒**。这些单测证明 schema、所有权和语义；不能代替原包几何或实际 LAN 截图。引用 source 在07:37:42冻结，根任务最新 `pnpm check` 已退出0、Session 全量323文件1235通过；该全量结果由根任务汇总。

独立 LAN E2E 使用 `session-codex-citations.spec.ts`、1 worker、HTTPS8484与只读原包HTTP43831；四组实际 UI/原包 SVG、public notes、clipboard/export、600行 Ace 定位及 A/B 项目隔离仍在验收。`native-citations-browser-initial.log` 是 seed 清空关注 cards 的 fixture 错误；`...-second.log` 是菜单返回后 native hover actions 不可见的测试定位；`...-third.log` 是自己的 ignored 原包 helper 缺括号，均保留，不当成产品问题或成功回执。原包初步 probe 的失败同样尚未计为通过。所有正式 mutation/restart、private memory file reads 和 source HMR 均禁止；最新单次4组通过回执必须追加后才把实际浏览器门禁闭合。

原包实际 production `Ppi` 需要既有 `PersistedStateProvider` 初始化；独立 helper 复用原生 provider 与标准 `persisted-atom-sync` 只读空状态响应，没有更改 immutable 原包或共享 harness 字段。`native-citations-original-probe-v3.log` **4组完成、pageerrors=[]**，`native-citations-original-receipt.json` 记录实际 copy、SVG、file/memory/tooltip几何，8张 `native-citations-original-{file,memory}-*.png` 为原包全页对照。实际 memory tooltip 为12px/18px、20px radius、8×12padding，button22×22/16pxSVG/9999radius/2pxpadding。`native-citations-browser-surface-red.log` 真实产品17.1429px/6px vs原包18px/20px的红灯后，自己的 CSS 已局部对齐；手机44px触控保留，实际4组绿尚待最新构建后跑。较早 `...-geometry-red.log` 错测 Radix 的隐藏语义 role 节点 padding/radius，保留为 fixture 诊断，以实际 `[data-slot=tooltip-content]` 表面为准。

构建前 `native-citations-final-browser.log` 运行到两个桌面场景，均已显示实际600行 Ace 502–503选区，但发现真实跨项目引用 owner 漂移。`CodexAgentCard.onClickCapture` 原来只跳过原生 button/a/input/textarea，源 citation 是 span role=button，父 capture 提前 selectTab(A)，后续 citation stopPropagation 无法撤销。根任务授权最小修 selector 纳入 `[role="button"]`，没有改 source span 或 Claude。`native-citation-card-capture-red.log` 真实1失败/1通过 → `...-green.log` **2/2、2.42秒**，同时验证明确卡片背景选择依然有效。该浏览器轮在根任务开始 shared build 前停止（exit130），不是最终4组通过回执。最新全部 frontend source 冻结精确时间为08:06:12.194035；不降低 B 输入/项目/草稿和无自动键盘焦点断言。

## P3 安装后的发现与真实插件输入

已有审核 child 在 ignored `p3-bounded-repro/try-now-receipt.json` 执行当前 TS AST callback 和真实 navigation guard 的隔离判别：两个 Try now 入口在 dirty 离开取消后仍切 Codex/项目并改草稿。`plugin-try-now-navigation-red.log` 两个真实取消失败 → 修复；`plugin-try-now-owner-red.log` 两个等待确认期间 owner 已变化仍被改的真实失败 → CAS 修复。`tryPluginInComposer` 现在只在既有 `setView(onNavigated)` guard 批准后提交，重新核初始 draftOwner/cwd/card/kind/remembered Codex；cancel、晚到批准和较新选择均不写旧/另 owner。没有自动发送或创建执行权限。

不能把本项目旧 TUI `$configName` 当成 enabled VSIX 插件语法。真实原包 3192 `Kgn/$k`、`pluginMention` 使用 **@DisplayName + plugin://id**，generated `UserInput.mention` 支持 name/path。本项目后端原来只允许子 Agent identity。新增有界 `validNativeInputMention` 仅供提交，原 `validAgentMention` 和子 Agent 集合/计数严格保留。独立 `pluginInputDrafts` 按原 draftOwner 持久保存公开 plugin name/id；Try now、原有 plus menu 与 @插件候选复用既有 mention chip，提交把确切 identity 合并进原 captured snapshot/queue。新 thread 的元数据移动保留 snapshot 引用，已知成功清理只删原版本；较新相同 token 与 B 元数据保留。移除 token 后 prune 元数据；不会仅靠相同显示文字借用其他插件身份。

成功 plugin install/uninstall 增加能力 revision，已经挂载的 composer 重新只读 `plugin/installed` + `skills/list`。query generation 与 cwd-tagged结果阻止迟到 A 候选覆盖 B，未完成/禁用插件不显示为已安装。`plugin-mounted-candidates-red.log` 2真实失败 → 绿；`plugin-typed-draft-move-red.log` 1真实失败 → 绿。最终 `plugin-final-owned-green.log` **6文件24通过、4.10秒**（新插件测试与既有 followup/Enter保护）；Web `plugin-typed-front-types-v2.log` 与Node `plugin-typed-server-types.log`空输出退出0。新增 typed plugin route `plugin-typed-identity-red.log` 实际HTTP400 → `...-green.log` **5/5**（含原子Agent路由），隔离 queue runtime收到一次原生 `turn/start` 的 exact `{type:'mention',name:'Fixture Name',path:'plugin://fixture-native@market'}`，非法 path 在调用前拒绝，提交后更改客户端 source不漂移。仅证明真实 schema + 产品转发，不声称插件已被实际模型使用。

独立 LAN `session-plugin-inputs.spec.ts` 两种宽度正在准备最新冻结源验收：实际安装 fixture、mounted候选刷新、guard cancel/confirm、子Agent count不混入、captured typed提交。所有插件 install/turn输入均被 API fixture 截获，未修改真实插件目录/CLI配置或发送正式模型请求。Rust skill 路径/CODEX_HOME 的根外复现与最小后端修复由既有 child 在隔离 HOME/CODEX_HOME 下负责，最终准确 receipts 待它冻结后追加；正式 Rust 激活仍是根任务的安全窗口边界。

## P3 技能目录边界与 CODEX_HOME 后端补充

根任务明确授权的三份 Rust 文件已完成隔离复现、最小修复并冻结。原始 witness 在 ignored `p3-bounded-repro/initial-rust-receipt.json`：旧 writer 向隔离 `controlled-home/.codex/config.toml` 成功写入而 native-home 未变；frontmatter `../../installer-escaped` 复制和链接出受管根，link/delete 父段及绝对 name 产生根外 effects。旧两个 config 文件仍存在，身份记录在 `witness-preservation.json`。同目录 `rust-receipt.json` 明确是最终绿色回执：writer 对准 CODEX_HOME，越界请求 Err、哨兵保留，正常链接仍成功。全部根外目标仍在自建 scratch，没有实际用户目录操作。

`skills.rs` 统一单名称、agent/scope/cwd、canonical 来源与 managed-root symlink 检查；link 保留合法重复行为，delete 在任何删除前校验全部根且不追随叶 symlink。`skillssh.rs` clone 前约束 source/id/scope/cwd，复制前约束 frontmatter 名称、来源树和目标根，不覆盖既有内容，链接错误透传。`config/mod.rs` 使用非空 CODEX_HOME 的真实 native 目录；missing/file override 明确失败，空/缺省保持默认。实际 codex-cli 0.161.0 的隔离 `config/read` 旧回执只看到 native-home marker，确认旧错写消费来源；本次没有修复后 native 重跑或 MCP tools/call。原生启动自行尝试 DNS/GitHub443，trace 如实保留；没有 thread/turn/model mutation。

`source-red.log` 真实12例8失败/4通过 → 同12例绿；展开包含源码 harness 最终 `source-green-expanded.log` **16/16**（15个本次用例+1个既有 MCP parser）。最后一次正式 Cargo 五项 `cargo-checks-receipt.json`：shared skill边界 **6/6**、shared installer **5/5**、codex config归属 **4/4**，共 **15/15**；两个 crate 的 offline `check --all-targets` 与 `clippy --all-targets -- -D warnings` 全部退出0。不是完整 workspace/session:test。三源码 SHA和检查被冻结在`backend-freeze.json`；本分支未改 frontend/E2E、未触发 pnpm build/HMR、未重跑绿色检查、无 commit/push。详见 ignored `completion-p3-bounded-repro-and-fix.md` 的 exactscope、旧/新证据与原包启用链。

**正式运行中的旧 Rust 尚未激活这些改动，不能称正式 skills 接口已经受到新 guard 保护。**安全窗口下启用及普通 native install/config 的实际消费仍由根任务汇总。Try now 的 TS AST/真实 guard 取消漂移复现已交接父线程；旧 `$configName` 不是原包插件语法，原包 typed `@DisplayName`/`plugin://id` 链由父线程闭环。中央功能与 bug 清单由根任务负责，本后端分支完成并停止。

## 合并引用、插件与触摸提示回执

`citations-plugin-final-browser.log` 首次单轮 **6/6、49.1秒**，证明四组引用与两种宽度 typed plugin 的实际 LAN 交互。该轮 list reporter 的 `info.attach` JSON 没有落盘，不能宣称存在持久 JSON。随后测试仅增强文件回执、memory tooltip 全页截图、安装前后实际候选读取计数；`citations-plugin-final-receipts.log` 单轮 **5通过/1失败**，390深色真实 tap 后公开 note 曾可见、随后 tooltip 消失，几何读取超时。保留该红灯和其它五组持久 JSON，未用 hover、force 或重试跳过触摸问题。

`NativeMemoryCitations` 的本设备显式 tap 是手机可读性适配：启用原包 `sites-end-resource:7592–7657` 的 `fb` 仍是普通 `Vi` 桌面 tooltip，没有显式 tap pin。不能把原生桌面 tooltip 的滚动关闭宣称为 bug。安装的 Radix `TooltipContentImpl` 对包含 trigger 的祖先 scroll 调用 onClose；判别单测 `native-memory-touch-scroll-red.log` **1失败/3通过**，真实 touch 打开后发祖先 scroll 即丢失 notes。简单 tap 和 synthetic pointerLeave 两个较早用例均绿色，不计为行为红灯。

最小修复只在显式 touch activation 时保持提示可读；桌面 hover/focus 的正常滚动关闭保持。第二次 activation、Escape、外部 pointer activation 均显式解除 pin，pointerDown 不自动聚焦手机键盘。`native-memory-touch-final-green.log` **6/6、7.51秒**，同时覆盖 touch/scroll、桌面 scroll、Escape/outside/再次点击与原 public notes/private path 隔离。产品源码只改该组件，最后写入08:25:08.826436807+0800，shared Tooltip 未改。四组引用 LAN 加入触摸300ms后的持续可读断言；最新合并 `citations-plugin-touch-final-browser.log` 的6组回执尚运行，不能以首轮历史绿色替代此次最终结果。

## Node 自有 tmux prompt 就绪门槛

根任务全量 Node concurrency4 两次在旧 rename prompt 用例出现 `original-windowrenamed-*`，而孤立同文件6/6。ignored `tmux-prompt-readiness-probe.mts` 仅创建/清理12个自己唯一命名的 scratch session，保留 `tmux-prompt-readiness-receipt.json`：**3/12错误，12/12发送Ctrl-U前尚未收到实际 prompt**。失败第0轮 comma HTTP200在1987ms、Ctrl-U在1989ms、文本在1990ms，而 `(rename-window) original-window` 第一次实时绘制在1992ms。没有操作正式会话、读写全局 tmux 选项或修改产品 input Router。

`apps/server/src/routes/agent-sessions.tmux-add.test.ts` 现在持久监听自己的 terminal WS，每次等待只收新 live frame，排除 terminal-control replay 并拼接/解ANSI，确切看到当前种子名称的 rename prompt 后再发送Ctrl-U。tmux 3.4没有可查询的 prompt buffer格式；client_prefix/key_table、pane capture和show-messages都不是该就绪信号。原 vi Ctrl-U、完整 committed/cancelled 名称断言保持，未以 sleep作为新增就绪门槛。旧取消后的100ms尚保留，不是本次Ctrl-U修复机制。

`tmux-prompt-readiness-green.log` 同文件 **6/6、3357.10ms**；随后标准 `pnpm --filter server test`（原 concurrency4）一次 **729总数、728通过、1既有skip、0失败、21434.06ms、退出0**，完整日志 `final-server-prompt-readiness.log`。测试只操作自有 fixture，产品/正式 tmux 配置不变；不声称修复了原生 tmux或产品输入顺序。

最新触摸修复后的合并 LAN 单轮 `citations-plugin-touch-final-browser.log` **6/6、51.5秒、1worker、退出0**。`citations-plugin-touch-final-receipts/` 实际持久保存 **6份 JSON 与18张PNG**：四组 source file/memory 与产品 tooltip/Ace选区全页，以及两种宽度 typed plugin。390深色先前消失的提示在真实tap后300ms仍有全部公开 notes；没有 hover、force 或降低所有权断言。四组实际原包与产品 tooltip12/18px、20pxradius、8×12padding、SVG三个path、desktop file181.03125px宽/15px高精确比较；手机文件/记忆保留44px。600行真实Ace502–503选区、readonly、keyboard:false及A文件root/B输入目标/项目/两份草稿全部通过；私有memory reads/native mutation endpoints为空与六组pageerror为空均由测试实际断言。JSON记录捕获owner/range/read路径、几何、copy/export与typed queue payload，不宣称真实模型/plugin安装消费。

## Typed 插件输入合并后的 editor 竞态闭合

根任务增强浏览器实际发现清空后快速输入 `$fixture` 又变成“保留原会话草稿$fixture”。`ComposerEditor` 每render构造新 merged items，而外部同步effect依赖items；onChange尚未回写的旧value因此在非文本更新中重新覆盖Lexical。`plugin-composer-external-sync-red.log` **2失败/1通过**真实覆盖non-text label重渲染和captured plugin元数据更新，不以等待清空或增加超时替代修复。

最小修改仅 `composer/editor/ComposerEditor.tsx`：memo merged/plugin/skill lists；capability metadata不触发外部文字同步；真正value变化使用该次捕获的当前mention列表，保持真实plugin chip与无自动聚焦。验证同一restore管线时另复现旧caret指向被动替换后删除节点，`plugin-composer-stale-caret-red.log` **1失败/3通过**丢失还原上下文。现在恢复前验证anchor/focus仍附着当前tree，只为无效节点选择当前末尾；有效caret位置保留。

最终 `plugin-composer-external-sync-final-caret-green.log` **4文件13通过、3.06秒**，含清空/快速输入、真实metadata刷新、明确外部pluginchip恢复/no autofocus、失效caret与有效caret上下文插入、候选更新及原Enter语义。`plugin-composer-external-sync-types.log`为空，Web tsc退出0；产品源码最终写入08:36:18.812814083+0800，测试08:36:46.833199048+0800。此前51.5秒六组浏览器证明的是touch冻结版本；editor变更后的真实输入浏览器门禁由根任务增强controls与后续typed plugin两组最新回执汇总，不能仅复用前一轮宣称覆盖新editor竞态。

根任务最新 MCP/editor 合并 check/build 退出0后，当前冻结源码的 **最终六组单轮** `citations-plugin-editor-final-browser.log` 再次 **6/6、51.5秒、1worker、退出0**。`citations-plugin-editor-final-receipts/` 已核实落盘 **6 JSON、18 PNG**，全部引用/公开notes/原包几何、跨项目readonly真实选区、copy/export、typed plugin guard/候选刷新/原identity提交和零pageerror断言保留。汇总 `thread-workflows-final-owned-receipt.json` 记录该次真实日志、artifact清单、editor/memory/完整Node的准确计数及当前关键源码SHA256，避免与历史同耗时51.5秒的touch轮混淆。根任务的快速清空技能候选、两engine联合性能和 MCP 通知实际浏览器结果仍以根任务最新日志为权威；本分支完成，源码不再改动。

## 浏览器快速清空后的残余选区竞态

根任务后续最新 `e2e-chromium-mcp-editor-composer-final.log` 在严格未改的 compact-controls 第262–264行仍复现“保留原会话草稿$fixture”。此前metadata重渲染/stale caret修复及51.5秒六组引用/插件浏览器仍是各自真实绿色，不能据此宣称该快速Delete路径已闭合。

ignored `composer-clear-trace.spec.ts` 保持原 Escape→fill("")→pressSequentially("$fixture",20ms) 顺序和断言，只在开菜单前安装只读 DOM/选区/Lexical状态/真实draft-store trace；没有在清空与输入之间加await或等待。`composer-clear-focus-trace.log` 单轮8个同360light fixture **3失败/5通过、1.4分钟**。repeat2的 `clear-trace.json` 显示Delete5377.9ms实际focus仍在输入框、DOM已全选（root0–1），而Lexical选区仍是末尾offset7；5378ms删除采用旧caret、提交零dirty节点，再把DOM选区收回末尾，故旧草稿根本未删。该失败没有菜单触发器回焦，也没有旧value复写；不能按候选假说改Popover。初次在fill前加观测await的单绿trace不作定因，后8轮观测移到菜单打开前。

对应真实Lexical TDD `composer-delete-selection-measured-red.log` **2失败/5通过**：全选与部分DOM选区在native selectionchange尚未送达时，Delete/Backspace不处理选中内容。早两轮unit夹具缺fireEvent/错误SPAN边界及jsdom Range几何缺失日志保留，不能替代该纯行为红灯。

最小产品修改仍只 `ComposerEditor.tsx`：在该editor root捕获Delete/Backspace时，若当前DOM有完整落在自己root内的非折叠选区，使用Lexical `applyDOMRange` 同步真实范围，再交原删除handler处理。没有强制清空/正文重写/延迟/全局键盘监听/自动聚焦。已有node/chip selection保持；composition、editor.isComposing、229及已prevented事件不接管，原Enter不变。`composer-delete-selection-final-boundaries-green.log` **4文件19通过、2.99秒**，含非折叠局部范围、三个IME判别、chip删除和前述restore/metadata/Enter；`composer-delete-selection-types.log`空输出退出0。产品最终source09:04:05.982604866+0800，测试09:04:53.871497516+0800冻结。根统一check后还需同8轮实际Chrome诊断复验和根两engine完整原控件门禁，尚未提前标绿。此前 `thread-workflows-final-owned-receipt.json` 的SHA对应旧editor六组绿色时间点，保持历史原文而不覆盖。

根统一 `final-check-keyboard-mcp-annotation.log` build/type退出0后，同一诊断copy/未改根控件spec的原 Escape→fill→press 序列 **8/8、1.1分钟、1worker、退出0**，日志 `composer-delete-selection-browser-green.log`，输出目录同名。8份实际 `clear-trace.json` 均验证Lexical确实commit空文字、随后DOM准确 `$fixture`，没有旧草稿后缀。`thread-workflows-keyboard-final-receipt.json` 把先前3失败/5通过、clean unit2红/5绿、最新19单位绿/8浏览器绿、全部trace路径与当前source/test/diagnostic SHA256放入同一回执。根两engine完整33/32与最新全量测试并行，仍由根任务记录它们的真实单轮结果；本分支最终冻结，无其它源码变更。


## 最终模型菜单残差的有界闭合（2026-10-10 09:31，产品源码再次冻结）

主线程追加授权仅修改 `NativeModelSelector.tsx` 和 `composer-native.css` 的模型菜单选择器。先只读复核旧 `composer-progress.md:36` 的四个桌面截图，再以原包实际 `ps/ms`、`s9i/e9i` 与 `impl-517ea8aeeec5` / `impl-1c8b0a94e9ce.css` 作为主来源，建立 `tests/e2e/session-codex-model-menu-reference.spec.ts`。双方使用完全相同的 foreground / dropdown / sidebar / description / font 宿主值，不修改共享原包 harness。

真实差异及修复：副标题从独立 muted 改为原包 foreground 65% 透明度；11px 副标题 line-height 从小数像素改为原包 `calc(1 / .75)`，消除 14.671875 / 14.65625 的真实布局差；caption grid 恢复 align-items:center 和 500 字重，Chevron 恢复 native tertiary 色，消除 y30 / 31.328125 差；按原包 `dt(percent)` 的 `28 / 2 - 1 = 13px` 端点同步 tick / thumb / pointer 分母，消除高端 1px 偏移；恢复滑轨 0.5px inset ring、旋钮 0.5px border / `0 0 2px #0000001a` 阴影，以及菜单外层原包 ring 与 spread shadow 的两条实际 ring。触控仍保留 44px 热区，28px 视觉旋钮的原生边框移入既有伪元素，不改 Claude 或全局主题。

浅色原包旧参考写入 #242424，而产品既有 host fallback 为 #3b3b3b；统一双方 host 为 #3b3b3b 后，行文字与强度字体/颜色相同，因此这部分旧差异属于 host 参数边界，未修改全局 --codex-text。高级自然 panel / 列表双方实测都是 **83.421875px**，每行 25.140625px、padding 一致；原包仅将外层 motion wrapper 通过 offsetHeight 取整到 83px，产品 PNG 裁切 ceil 为 84px。没有为降 pixel 硬裁高度。简单自然 panel 恢复 94.65625px，删除人为 95px min-height，外框与原包 offsetHeight 的取整关系保留。

红灯：`model-menu-same-host-behavior-red.log` 两个 simple 实际失败、两个 advanced 通过（27.6s）；`model-menu-overlay-shadow-red.log` 原包菜单双 ring 对照 1 项真实失败；`model-menu-endpoint-red.log` 1 失败 / 2 通过。初轮 lazy slider 未挂载与一次 entry animation 仍缩放的测试时序诊断分别保留在 `model-menu-same-host-red.log` / `model-menu-same-host-green.log`，不计作独立产品失败或最终绿灯。最终门禁等待实际动画完成与 width224 后采样，不放宽精度、不添加 sleep。

绿灯：`model-menu-same-host-final-green.log` **4/4、24.4s、1 worker**；四状态逐项核对自然 panel、各字段 x/y/width/height、fontSize/lineHeight/fontWeight/color/background/padding、thumb border/shadow、track inset ring 与 menu visible shadows，pageerrors 全空，无 resume/turn/start/steer/fork/rollback。对应 4 份持久 metrics JSON + 8 张原包/产品 PNG 位于 `model-menu-same-host-final-green/**/`。`model-menu-final-unit-complete-green.log` **3 文件 18 项、3.29s**；`model-menu-final-types.log` 空输出、exit0。没有运行整仓 build/check，也未替换任何活跃服务。

单一回执 `.dev-runtime/session-render-alignment/model-menu-source-final-receipt.json` 含 source SHA、逐状态 host/metrics 与明确边界。产品最后写入 `composer-native.css` **09:31:23.647794 +08**；Selector SHA `9020ed232824d3d9889ea891da372586e7df99defd8136dddf69769ce72ec476`，CSS SHA `b3f816bbe386e5a509ea291b51306e32770d68d45fc5b7215a14546e44516ab7`。旧 1.3%–3.5% 是历史像素 artifact，未重新生成、不能作为本次 source 的误差统计；不同 backdrop 和 native 外框整数取整仍不应被低全图分数掩盖。本次 4 状态为桌面；修复后的移动端真实触控矩阵由主线程最终合并门禁汇总。


## 模型状态色与独立 Portal 字体门禁（2026-10-10 09:52 源冻结）

在主线程有界授权后，原包 `native-model-e9i.js:81–85,159–161` 与 `native-model-menu.css:55–59` 确认显式 model 使用 charts-blue，只有 `isMaximum` 或真实 ultra 才使用 charts-purple；不能把 xhigh 或最后一档当 maximum。新增独立参考入口 `review/native-model-menu-state-reference.js` 调用原包 `ps/ms/KIt`，不改共享 harness 或原始 assets；双方显式写入相同 host 和 chart tokens，powerSelections 来自有效 supported-effort 元数据，未注入 isMaximum。原包 KIt 对 high/xhigh/ultra 均通过，实测 native data-maximum 为 false/false/true。这证明启用 renderer 的分支与 schema，不能宣称正式 CLI 目录已提供 ultra。

干净行为红 `model-menu-state-fonts-red.log` **6 失败**：四个正常浅深 simple/advanced 状态的 own Portal synthesis/smoothing 不同，以及两主题 high/xhigh/ultra 真正状态色；pageerrors 均空。`model-menu-state-metadata-red.log` **3 失败 / 3 通过**。仅修改模型 effort span 的 data-accent/data-maximum 和该 model menu 的 CSS：charts-blue/purple，font-synthesis-weight:none、antialiased/grayscale；font-synthesis-style/small-caps 仍 auto，全局/Claude/其它 Portal 不变。

`model-menu-state-fonts-green.log` **6/6、38.7s、1 worker**，保留两页浅深 × simple/advanced 的自然几何/字形/颜色门禁，再补三状态两主题的属性、RGBA 和 own menu/子标签实际 font flags。深 high/xhigh 蓝 `[86,156,214,255]`、ultra 紫 `[197,134,192,255]`；浅色分别 `[0,122,204,255]`、`[175,0,219,255]`，双方完全一致。菜单 weight none、webkit antialiased，style auto，实际 Mozilla computed 返回空字符串按两页相同记录，不伪造支持值。`model-menu-state-fonts-unit-final-green.log` 当前独立最小范围 **3 文件 8 项、2.77s**；`model-plugin-touch-types.log` 空输出 exit0。当前单位范围不与前一09:31历史18项合并累计。

新回执 `.dev-runtime/session-render-alignment/model-menu-state-fonts-final-receipt.json` 含6份实际metrics、native三状态元数据、Source SHA与边界。产品最后写入 **09:52:06.950733217+08**；Selector SHA `8ff4a2c415c0366c5f7097579670571f1ac4c174e222a8725d7343ba9423412c`，CSS SHA `c2251540b8be91e75e01b541c742c40f8df954b3e19f621f434fb0a502e4dc0a`。原包 motion 外框整数取整与后台内容透明合成边界继续保留，没有低全图分数或硬裁高度声明。无整仓build/check、正式mutation/restart、credential、commit/push。


## 插件手机触控门禁（2026-10-10 09:58 产品源冻结）

主线程追加授权后，只扩大插件组件专用粗指针热区，没有改通用 Button、typed plugin 提交、owner 捕获、离开保护或候选刷新逻辑。`PluginCard`、`PluginDetailView`、`PluginsViewHeader` 和 `TabSwitcher` 增加专用 target class；`PluginsView` 导入 `plugin-touch.css` 并提供独立 scope。全部新增 CSS 位于 `.session-mode .session-plugin-view` 的 `(pointer: coarse)` 条件中，设置44px最小宽高；卡片摘要可以收缩，手机详情标题/动作自然换行，桌面不应用该规则。

`plugin-touch-measured-red.log` 手机浅深两个用例是完整实际行为红：卡片 Install/Use 32×32、详情动作高32、详情返回高36、管理入口32×32、管理tabs高28、管理返回36×32，只有>=44断言失败。所有目标中心命中真实为true；真实 tap Install→detail Try now→cancel→manage/return→card Use→cancel/confirm→captured typed提交仍执行结束，pageerrors空。首轮管理时fixture仍保持dirty、以及空名管理返回locator命中页面返回按钮的诊断保留在 `plugin-touch-red.log` / `plugin-touch-behavior-red.log`，不作为产品根因。最终fixture只在管理浏览阶段明确设dirty=false，Try now阶段恢复true，原有取消后A/B草稿/输入目标/插件集合不变断言未削弱。

`plugin-touch-final-green.log` 最新单轮 **4/4、32.9s、1 worker**，真实LAN `https://10.30.0.24:8484`，1440/390×浅深；桌面click，手机hasTouch/isMobile真实tap。手机卡片与管理入口/返回44×44、详情动作和返回高44、管理tabs高44，全部中心命中true。详情 Uninstall 和 Skills 仅测量，不触发另一个删除/配置动作；实际tap覆盖Install、card Use、detail Try now、详情返回、管理进入/active Connectors/返回、确认/取消和发送。提交仍捕获ux-1，文字`@Fixture Plugin`与实际mentions的`plugin://fixture-native@fixture`一起进入唯一一次followups/submit；未调用直接native start/resume/fork/rollback，候选readonly刷新计数增加。此是隔离HTTP/WS fixture证据，不宣称真实模型消费或实体手机成功。

桌面两主题8个前后共同目标x/y/width/height/font/color一致，尺寸保留32/36/28px。先前31.5s绿色的一次浅色card-use background取到了hover transition中间色，回执保留差异而不声称全颜色exact相同；最新32.9s门禁采样前桌面pointer移出、等待实际target动画完成，并持久记录hover=false、pointer:coarse=false，纯coarse新增CSS不作用桌面。没有sleep或降低断言；历史 `plugin-touch-green.log` 4/4、31.5s不覆盖。

`plugin-touch-unit-green.log` **4文件13项、3.47s** 保留既有loading/typed身份/guard边界；`model-plugin-touch-types.log`空输出exit0。`.dev-runtime/session-render-alignment/plugin-touch-final-receipt.json` 包含红/绿日志、四份新完整typed receipt与40项几何/hover/pointer数据、前后桌面比较和Source SHA。每profile有catalog、未装详情、已装详情、管理中心和提交后五张整页截图，共20张；供主线程审阅。产品最后write **09:58:35.359949946+08**，此后只改该spec采样和本progress/ignored receipt。无整仓build/check、正式服务restart/activation、凭证、commit/push。中央功能/bug清单由主线程合并更新。


## 请求模板图库箭头触控（2026-10-10 10:13 产品源冻结）

主线程最后有界授权只补gallery箭头：独立 `tests/e2e/session-codex-request-gallery.spec.ts` 使用有效openai/form imagePicker的8个模板，使Next/Previous真实可见。通过现有LAN整页和mounted store实例夹具，手机浅深使用实际tap；桌面浅深click。首轮 `request-gallery-red.log` 4失败来自错误的“scroll-snap起点一定0/上一组必定hidden”夹具假设，真实原有首项会吸附到padding4；保留该诊断，不作为产品红灯。最终门禁捕获真实起点4并要求Previous精确返回4，未强制scrollLeft或放宽提交/选择断言。

Primary `request-gallery-behavior-red.log` **2手机失败/2桌面通过、24.8s**：手机两箭头实际32×44、可见32×44椭圆、relative centerY80，比原32圆中心74偏6px；中心hit true，但宽度与形状失败。四个实际typed receipt均完整执行Next/Previous，scroll4→712(桌面)/266(手机)→4，原模板选中、ux-0输入目标、原草稿、request910/token保持；无approval/followup/native mutation、无pageerror。

产品仅在 `request-native.css:494` EOF新增gallery `(pointer: coarse)` 专用规则：44×44透明按钮，32×32 `::before` 可见圆，原1px边框/主题background保持；top52/inset-inline−6使44热区和原圆共用原中心。顶部fields/image-picker/纵向overscroll等原 **12709字节** 逐字节不动，prefix SHA `78ba3f775d728105d3518d9d044434f289f82f8e8cdcf7a4a98c45049f5580e6`。没有扩大通用按钮，也没有改Elicitation typed协议或scroll handler。

`request-gallery-green.log` 最新单轮 **4/4、22.3s、1 worker**；1440×1000桌面两主题两箭头仍32×32、位置/中心/颜色/边框与red桌面逐项exact相同。390×1000手机两主题两箭头44×44热区、32×32可见圆、1px边框、relative centerY74、left center16/right center(width−16)，实际中心hittrue。原选择和草稿保持、keyboardFocused=false、pending实例保持、无误提交。四状态各一张fullpage和card PNG共8张已供主线程审阅，截图使用有效1×1图片以隔离图库结构，不宣称原包全图pixel误差或实体手机成功。`request-gallery-unit-green.log` 既有Elicitation native **1文件25项、3.37s**，`request-gallery-types.log`空输出exit0。

新单一回执 `.dev-runtime/session-render-alignment/request-gallery-final-receipt.json` 汇集red/green/geometry/ownership/scroll/4状态截图、before/after exact desktop比较和Source SHA。产品最后write **10:13:24.897311862+08**，CSS SHA `7db27641d4fd7de6673f0fa9ee54c2145883d4745be91df6df8f3f6b3a2015de`，spec SHA `8d66402efa58f0e7dd6f797742be403eb7147a55009abe641dfea9a13e239678`。此后只写本progress和ignored receipt，无build、正式mutation/restart/activation、credential、commit/push；中央bug/功能清单仍由主线程合并。


## 插件详情留白与通知外观限定修正（2026-10-10 10:26 最终源冻结）

主线程实际查看手机/桌面PNG后只授权两处收尾：详情按钮贴x0、Information紧贴动作行；安装normal Toast在手机y16顶部遮住Return且深色仍白色。没有追加候选或修改通用Toaster。Primary `plugin-spacing-notice-red.log` **4失败**：phone浅深安装Toast仍可见时Return中心hit=false、Toast top/white/Close20，详情padding0/bodygap0；desktop返回命中正确，但normal背景/前景也不同于当前Session tokens。四例完整后续typed链仍执行结束，红metrics持久保留。新 `plugin-notice-unit-red.log` **1文件6失败、2.61s**，验证真实market/detail安装成功和失败通知原选项缺专用class、compact仍top-right；错误诊断正文保持。

产品只改插件scope：`PluginDetailView`根加class，`plugin-touch.css`仅coarse增加横向16px内距与header后16px间隔；market/detail/link-error通知调用改用轻量`pluginNotices.ts`，保持标题、description、variant和真实业务调用不变。只有本插件通知加Sonner专用class，notify当下判定narrow/coarse bottom-center、desktop top-right；normal颜色继承当前Session --background/foreground/border，不捕获旧主题。Close粗指针/窄屏使用44透明target与20可见circle，不改全局Toaster/use-toast/其它通知或owner/协议。

首次绿轮 `plugin-spacing-notice-green.log` **2桌面通过/2手机失败、41.1s** 留下真实判别：normal Sonner没有data-type属性，沿用MCP typed selector使Close未匹配，仍20×20、伪元素仅2px。最终仅该私有selector改成实际data-styled=true；源/红日志未掩盖。`plugin-spacing-notice-final-green.log` 最新单轮 **4/4、40.4s、1 worker**：phone浅深安装通知可见时Return中心hittrue并实际tap→guard/cancel，随后实际tap正常Close→通知消失；bottom、44×44透明关闭热区、20×20可见circle，normal背景/前景与当前Session probe exact。dark RGB背景32/37/44、前景229/233/238；light背景252/252/253、前景36/44/53。详情phone padding16/bodygap16且既有所有44目标center hit继续绿。desktop详情padding0/gap0、动作几何/字体/颜色逐项原位，通知仍top-right/20close，仅normal主题色按当前Session修正。完整Install→Use、dirty取消/确认、A/B草稿owner及plugin:// typed唯一提交/readonly刷新断言保留，无直接native start/resume等mutation，pageerrors为空。

`plugin-spacing-notice-unit-green.log` 当前 **5文件19项、3.58s**（含6个新通知集成用例），`plugin-spacing-notice-types.log`空exit0；这两个门禁之后仅CSS selector与测试comment变化，TS业务未改。最新 `.dev-runtime/session-render-alignment/plugin-spacing-notice-final-receipt.json` 含新/中间红、绿、四份typed/notice/spacing实测数据、desktop before/after与24张fullpage PNG。主线程已实际复核6张手机detail/notice/manage及4张桌面detail/notice，认可16px留白/20px圈/bottom结果；本分支另实际查看dark phone Toast和light phone详情。产品最后write **10:26:28.205638475+08**（CSS SHA `ab418b3a985cf5b34b98acea89e797454fed9819f1ba1877156eac8dc517ed12`；helper SHA `4f1ee7235c4bd4871c471911d35fd8019ff50b8cce99e4f396eae80379709480`），此后只本progress/ignored receipt。证据为LAN Chromium touch模拟与隔离HTTP/WS，不宣称实体手机或正式模型消费；无build/check、正式restart/activation、credential、commit/push。中央清单由主线程合并，限定工作结束后暂停追加修改。


## 图库 WebKit lazy 图片夹具修正（2026-10-10 10:46 测试冻结）

Root两引擎28项合并批次中WK手机浅深失败在首tap之前的“全部8图立即decode”断言；桌面通过。只读实际复现 `request-gallery-webkit-lazy-red.log` 1失败，`gallery-image-witness.json` 记录所有图片loading=lazy，前两张可见并decode1×1，第3张已预取，索引3–7离屏complete=false/natural0×0，pageerrors为空。此为合法移动WK lazy解码与旧夹具假设差异，不是模板tap/产品选择故障。

只改 `session-codex-request-gallery.spec.ts`：先验证真实可见图片decode，再通过原生Next/Previous实际tap逐组使全部8张完整可见并验证1×1。没有强设eager/scrollLeft、force、双击兜底、删除decode或放宽owner/无提交断言。手机首次trusted事件实际IMG pointer/touch/click→INPUT click/input/change，radio0正常选中。完整遍历后Previous精确返回原scroll4，原选择、ux-0草稿/request实例不变。

单worker最新WK **4/4、41.4s、exit0** (`request-gallery-webkit-lazy-green.log`)，Chrome **4/4、40.4s、exit0** (`request-gallery-chromium-lazy-green.log`)；八份receipt均fullyVisibleDecodedTemplates=[0..7]、pageerrors空。新单一回执 `.dev-runtime/session-render-alignment/request-gallery-lazy-final-receipt.json` 保留红witness、真实触控链、8份metrics/PNG和SHA。Spec SHA `c5d7473a3ff69ea3fd480a9d0032c54959a97aa2f59fbeb37653ed86cd7950ee`，mtime10:46:39；产品CSS仍10:13原SHA `7db27641d4fd7de6673f0fa9ee54c2145883d4745be91df6df8f3f6b3a2015de`。纯测试修正未build/重复全量单测；用户新提出滚动/消息间距修复后，旧source终验不继续，以上作为准确阶段收据保留。
