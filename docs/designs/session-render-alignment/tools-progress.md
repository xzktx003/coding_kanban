# 原生工具与生命周期呈现：实施证据

2026-10-10；本范围已列路径的最终验证完成。此记录涵盖工具呈现、真实事件投影、钩子元数据和只读工具目标导航，不代表完整 P0–P4 已完成。正式 Session 服务和现有 Agent 未重启。产品联调地址为 HTTPS `https://10.30.0.24:8484`；只读原包参考为 HTTP `http://10.30.0.24:43831/native-markdown.html`。

## 原包主证据与实现边界

原包版本 `openai.chatgpt 26.51002.51308`，位于 `.dev-runtime/session-render-alignment/plugin/extension/webview/assets`；格式化副本位于 `plugin-readable`。以下锚点来自实际启用组件或其调用/生产路径。

| 行为                                                                            | 原包锚点                                                                                                                                                                      | 本项目实现                                                                                                                                                 |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MCP 默认折叠；执行中无结果时无展开按钮；纯文本、结构化结果、媒体与独立 raw 输出 | `connector-asset-title-query-593200de94fd.js` 的 `ra` / `va`                                                                                                                  | `McpToolCallItem`、`ToolContent`、`NativeToolDisclosure`                                                                                                   |
| 命名连接器参数校验、上下文、预览截断、结果数量与本地化模板                      | `mcp-tool-activity-label-ed4208299cd0.js` 的 `C:1777`、`Zt:1916`、`D:1907`、`Xt/Yt`、`Da:12864`；数量 `Vt/Ht/Ut/Wt:1742`；Drive 标题 `app-initial-e98b9eaef8e3.js` 的 `XS/ZS` | 无 UI/请求/宿主动作的纯 `nativeMcpActivityRegistry`、`nativeToolMessage`、1,108 个原包 `nativeToolLabels`                                                  |
| 公开思考执行中和完成后均剥离首个标题；完成默认折叠；耗时只来自观察到的生命周期  | `sites-end-resource-39518ab206b4.js` 的 `Sw:13807`、`Ew`、`el`、`Dw:14067`                                                                                                    | `ReasoningSummaryItem`、`nativePublicReasoning`；不显示 raw reasoning                                                                                      |
| 网页搜索文本、图标及中文分隔符                                                  | 同文件 `bE/TE`、`i_/s_`                                                                                                                                                       | `NativeActivityItem`、`NativeToolIcons`                                                                                                                    |
| 实际开始时间超过十秒的压缩等待提示、自动/手动来源与原生图标                     | 同文件 `tx/sx/nx:8232`                                                                                                                                                        | `NativeCompactionItem`；时间或来源未知时不推断                                                                                                             |
| 多图查看和生成；自然比例排版、四槽宽度、轮播                                    | 同文件 `MS/LS`；`chatgpt-markdown-view` 的真实图库布局函数 `ss`                                                                                                               | `NativeGeneratedImages`、`nativeImageGalleryLayout`、`activityRows`                                                                                        |
| 只有高风险网络活动改派通知可见                                                  | `local-conversation-turn-8d1d57382579.js:4733`；`sites...` 的 `oC/dC`                                                                                                         | `NativeSystemNotice`、`EventItem`                                                                                                                          |
| 自动审查：批准隐藏、执行中聚合为 Thinking、拒绝/超时/中止独立                   | `agent-activity-item-d62c5a10b6db.js` 的 `dr:1288`；`sites...` 的 `zb:7987/Hb`                                                                                                | 真实 `AutoReviewEntry`、`NativeSystemNotice`、`nativeAutomaticReviewLabels`                                                                                |
| 拒绝详情只有原生授权/高风险说明；其他结果的理由在第二层状态展开内               | 原包 `automatic-approval-review-details` 的 `j/D`，实际调用 `Gh/qh`                                                                                                           | 不添加假状态、JSON 行或永久展开的理由；Guardian 补救动作独立能力校验                                                                                       |
| 钩子为完成轮消息动作；统计不含 running，公开记录不含 context；管理源分类        | `local-conversation-turn...:4192` 的完成轮门控、`Wo:1700`；`hooks-settings-model` 的 `d/f`                                                                                    | `projectNativeHookRuns`、`nativeHookRunsForTurn`、`NativeHookStats`；反馈使用 `NativeHookPromptItem`                                                       |
| Hook 真实大尺寸弹窗、全宽统计、标题/关闭/焦点及禁止合成粗体                     | `user-message-a9427cd0db0e.js` 的实际导出 `a=ft/o=ht`；真实 lazy `hook-stats-dialog-4d9a862d19a0.js`；原包 `xwideTall` 和 computed `font-synthesis-weight:none`               | `NativeHookStats`；680px / 92vw、min(92vh,800px)、20px 内边距、16/28 标题、12/17.1429 正文；手机透明 44px 命中区域保留原生 24px 关闭按钮尺寸               |
| 完成摘要保留真实 item、namespace、成功/失败/反向状态及 native leading/following | `agent-activity-item...` 的 `cr:1270/Q:1257/Dn:740/On:745/Bn:904`；`mcp-tool-activity-label...` 的 `Pt:1558/Rt:1729/Ft:1655`；`sites...` 的 `gD:21309/c_:2727/ux:8510`        | `nativeDynamicToolCompletedSummaryKey`、共用 `nativeCodexToolPresentation`、label 的 leadingSummary 参数；Group/activityRows 由主线程集成                  |
| MCP 完成摘要源归类、源名去重和 native descriptor 分离                           | `inline-followup...` 的 `Ue:950/Me:523/Ae:447/je:489/ze:868`；e98 的 `Ogt:24216/hgt:24076/Cgt:24148`；`sites...` 的 `u_:2799/d_:2815`                                         | `nativeMcpCompletedSummaryClassification`、`nativeMcpSourcesSummaryLabel`；普通source、真正native descriptor、REPL command和空server独立；集成由主线程负责 |
| 第一方工具紧凑标签、实际图标、目标链接和等待审批配置条件                        | `agent-activity-item...` 的 `W:744`、`tr:1196`、`Q/ur:1257`；`app-initial-3192ac99b6cd.js` 的目标解析 `aWt`                                                                   | `NativeDynamicToolItem`、`NativeDynamicToolIcon`、`nativeDynamicToolTarget`、`nativeDynamicToolSemantics`                                                  |

命名标签注册表保留原包纯参数 schema 和分支回调，只有识别到真实连接器名才初始化。其 `.d.ts` 提供严格入口；既不引用原包 UI 运行时，也不注册 widget、请求或宿主能力。现有 zod 3 适配与原包 schema 的已捕获输入对照一致。新增 ICU 格式器仅解释原包模板，公开参数中的花括号保持字面内容。

当前包的 MCP App widget 能力未启用，resource URI 不构成启用证据。环境设置卡片也不是默认工具路径：原包 `wBa` 仅在 `threadStartKind=environment_setup/all` 添加相关生产工具，默认 `default` 排除；未启用的 prototype 不作为本次 renderer 缺漏。

## 投影、所有权与安全导航

- 自动审查 started/completed 以 thread、turn、review、target 四元组更新同一记录，终态不会被迟到 started 覆盖；通知边界先冲刷此前缓冲。批准项目隐藏不制造成功行。
- 相邻同线程、同轮、同类型图像合并为呈现数组，原始事件和单项身份保留。不同 owner 不合并。
- Hook started/completed 保留在真实事件中，正文不重复显示通用工具行。统计只附在已完成轮动作；最新活动轮不提前显示完成统计。
- `EventItem` 优先使用事件 `params.threadId` 绑定文件、图像、审查和工具 owner，并保留原消息编辑身份。图片编辑在异步读取前捕获草稿 owner，真实像素经现有 `DrawingEditor` / `useImageAttachments` 保存到原会话，不自动发送。
- 创建会话的工具链接只接受成功结果的第一个实际 `inputText` JSON，禁止从参数或后续文本猜测目标。Codex 占位身份遵守原包 `client-new-thread:` 前缀；read/send 使用实际 `arguments.threadId`。
- 本地 Codex 目标通过工作流只读历史校验后进入正常已关注标签；无 resume、start、审批或写入权获取。外国宿主、ChatGPT、未解析 client 身份保留紧凑原生标签/图标，通过键盘和真实触控可访问的小说明展示能力不可用，不制造 URL 或改向本地线程。
- 原生搜索采用实际 thread/turn/item/cursor，目标页加载传递 `preserveEarlierCursor:true`，等待真实 item 投影后滚动并设置 DOM Custom Highlight。正常向前分页保持原行为；隐藏根不处理快捷键，异步 owner/query 变化取消旧导航。

## 红绿灯与主要差异证据

全部日志位于 `.dev-runtime/session-render-alignment/tools`。行为变更先红后绿，主要可复现项如下：

| 修复                                                                         | 红灯                                                                                                                                                 | 绿灯/证明                                                                                                                            |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 自动审查身份/排序、批准隐藏、图像合并、Hook 行隐藏                           | `activity-projection-red.log` 等投影日志                                                                                                             | `activity-projection-green.log`                                                                                                      |
| 已完成公开思考错误保留首标题                                                 | `reasoning-completed-title-red.log`                                                                                                                  | `reasoning-completed-title-green.log`                                                                                                |
| 拒绝详情错误添加理由和状态行；非拒绝理由未按原生第二层折叠                   | `auto-review-details-red.log`                                                                                                                        | `auto-review-details-green.log`                                                                                                      |
| Hook running/context 错误参与公开统计                                        | `native-hook-public-statistics-red.log`                                                                                                              | `native-dynamic-ui-green.log`                                                                                                        |
| 第一方工具未按实际结果提供目标和紧凑可访问说明                               | `native-dynamic-ui-red.log`、`native-dynamic-target-red.log`                                                                                         | `native-dynamic-ui-green.log`                                                                                                        |
| 命名 MCP 缺失实际标题/上下文                                                 | `native-mcp-context-red.log`                                                                                                                         | `native-mcp-context-oracle-green.log`                                                                                                |
| Hook 通用弹窗错误尺寸/间距/焦点与手机关闭按钮覆盖                            | `hooks-reference-geometry-red.log`、`hooks-close-focus-red.log`、`hooks-reference-final.log` 手机两例红灯                                            | `hooks-reference-fonts-final-green.log`、`hooks-final-unit-green.log`                                                                |
| Hook 中文标题被合成粗体，空输出提示错误                                      | `hooks-font-synthesis-red.log`、`hooks-no-output-red.log`                                                                                            | `hooks-reference-fonts-final-green.log`、`hooks-final-unit-green.log`                                                                |
| 完成动态摘要 raw tool 拼接、namespace 碰撞；跟随措辞和成功/失败/反向状态丢失 | `dynamic-summary-helpers-red.log` 七例；`dynamic-summary-original-oracle-red.log` null 与 Pt 注册差异；主线程 `dynamic-summary-native-label-red.log` | `dynamic-summary-original-oracle-green.log` 3 文件 16 用例，actual original `cr/Ft` 589 条逐一匹配；主线程集成最终证明另记           |
| 展开工具箭头仍向右，遗漏原生90°旋转                                          | `tool-chevron-rotation-red.log` 实际LAN原包90°/产品0°；整页人工复查发现，旧120比较未包含 rotation                                                    | 两个 leaf 绑定共享 CSS 的 data-expanded；`tool-chevron-rotation-green.log` 五种展开状态×四配置20状态，4/4通过（1分钟）               |
| 普通 MCP 完成组被错误归为调用工具；native MCP 被误作integration              | `mcp-sources-summary-red.log` 四例、`mcp-native-summary-gates-red.log` actual cloud_threads.read；主线程 source-summary 原包对照红                   | `mcp-sources-summary-final-green.log` 三文件22例；actual原包30分类＋24原生Intl文本全部匹配；主线程集成48单位/native10 checkpoint通过 |
| 失败 MCP 被剩余结构化数据误标成成功数量                                      | `native-mcp-failed-count-red.log`                                                                                                                    | `native-mcp-failed-count-green.log`                                                                                                  |

`native-mcp-primary-capture-proof.json` 校验可提交的紧凑 oracle 与实际原包浏览器捕获逐条一致：12 个家族、1,956 个有效原包分支结果，涵盖 null、空对象、公共上下文三组参数 × active/completed，及实际公开结构化计数结果。家族为 browser、figma、github、gmail、google_calendar、google_drive、linear、notion、sites、slack、vercel、wallet。此计数不是所有可能参数组合的穷举；数量、无效 schema、ICU 和失败状态另有明确回归。

完成摘要独立原包捕获 `dynamic-summary-primary-capture.log` / `dynamic-summary-primary-proof.json` 与可提交 oracle 为 589 条实际 `cr/Ft` 输出。它检查纯元数据工厂，并未新增工具启用、导航权或宿主能力：namespace 参与 key；未知路由无假第一方 descriptor；Pages 翻译存在不等于 Pt/Mt 注册。read_thread 不按目标猜分组键，handoff/get-status 只按原 schema 校验身份，Page 三个特殊 renderer 按真实 descriptor ID。

MCP 源摘要有限修正有两组新主证据：`mcp-summary-primary-capture.log` 的实际 Ogt/Lt/Ue 30类与可提交 fixture逐条一致；`mcp-source-labels-primary-capture.log` 用实际原包 `u_` 和真实 React Intl 渲染24种中英文、leading/following、重复显示名和混合源组合，`mcp-source-labels-primary-proof.json` / `mcp-source-labels-primary-compare.log` 验证24/24、0差异。普通source按key聚合并保留最后的真实name，顺序保留首次key，任何一次真实plugin/logo命中就优先；`u_` 再按name去重，以conjunction列源名，不显示调用数。MCP与dynamic native摘要共享单一Set/数组，保留彼此输入顺序。appName的nullish语义另有 `mcp-source-nullish-name-red.log` 精确红灯；空串保留原值，不替换为connectorId。

本范围最终单测 `owned-final-after-mcp-summary-green.log` 为 26 文件、101 用例通过（18.93 秒），包括既有1,956 MCP及589动态摘要oracle回归；前端完整类型检查 `typecheck-mcp-source-summary-final.log` 退出 0。箭头 checkpoint 为26/95。以下最终 LAN 套件全部通过，保存整页截图并严格使用实际原包或产品组件：

- `session-codex-tools-reference.spec.ts`：`reference-120-final.log` 为 4/4 通过（2.7 分钟），30 状态 × 桌面/手机宽度 × 深浅色，共 120 状态对照。比较实际绘制文本的字体、位置、颜色，SVG 路径/尺寸/透明度和展开状态；隐藏文本不计作可见正文。思考、MCP、网页、压缩、动态工具、改派、审查两层详情和第一方工具均包含。
- `session-codex-tools-lifecycle.spec.ts`：4 个完整产品配置，真实触控手机、图片解码、多图布局、本地图读取、编辑上传并检查原 owner 草稿、Hook 统计、拒绝详情、搜索键盘与 Custom Highlight。
- `session-codex-native-targets.spec.ts`：4 个完整产品配置，桌面键盘和手机真实触控打开不可用目标说明，再验证实际只读目标历史与正常标签；断言无 resume/start/stop/interrupt/approve/respond 或 release:true。

`lifecycle-targets-final.log` 合并 8/8 通过（45.9 秒）；Hook 合成粗体样式修正后，受影响的完整图库/Hook/审查流程再次在 `lifecycle-fonts-final-green.log` 4/4 通过（28.1 秒）。未受影响的只读目标流程不重复计数。

整页复查揭示旧120对照未包含 computed rotation：主线程共享 command 样式使用 data-expanded，而工具叶子只传 is-expanded class，造成展开箭头仍向右。新增角度比较得到实际原包90°/产品0°红灯，两处 leaf 绑定属性后 `tool-chevron-rotation-green.log` 五种展开状态×四配置、共20状态4/4通过（1分钟），保存40张整页，其中产品20张已逐张查看；原包/产品每状态的角度、字体、颜色、路径、边界均由严格对照验证。文字/边界/图标路径旧120结果保留，旋转最终证明以此补测为准。

独立 `session-codex-hooks-reference.spec.ts` 使用原包真实 `ft` 点击并加载实际 lazy body，以及完整产品页挂载的实际 `NativeHookStats`。`hooks-reference-fonts-final-green.log` 4/4 通过（29.7 秒），同时严格比较原包/产品弹窗边界、正文/标题绘制位置/字体/颜色、font-synthesis、关闭按钮/SVG及焦点；手机使用真实 tap 打开、展开、关闭。原包/产品 × 折叠/展开 × 四配置共 16 张整页已全部逐张查看。

源代码冻结后的 Vite 缓存隔离使旧 `/node_modules/.vite/deps/react.js` 参考注入路径过时；本范围 fixture 改为捕获已加载的真实 React/ReactDOM resource URL，共用实际单例。新聊天初始页使用公共输入区的准备状态，后续通过真实关注日志选定目标；不以未出现的专用 composer 阻塞准备。两次 fixture 超时日志保留，不计为产品红灯或最终成功。旧目标说明截图曾捕获 Popover fade-in 中途；最终 target fixture 等待 popup opacity=1，作为截图准备条件，产品行为未更改。主线程最终分组/目标整页复验结果另记。最后共享构建写入shared曾触发浏览器HMR回到新聊天；在最后scalar源冻结之前启动的全量Session和并行构建期间的页面结果保留作时序证据，不计为最后冻结版本的验收，最终全量/浏览器由主线程顺序复验。

## 实际运行能力限制

1. 公共历史 Turn 类型当前无 `hookRuns`。兼容转换只恢复服务器实际返回的扩展 `turn.hookRuns`，校验线程/轮/run 身份并安全处理 bigint/整数时间；运行版本若不持久化该字段，刷新后无法凭工具结果补造。
2. 真实 Guardian 服务默认能力不可用；详情中的补救按钮只有服务提供确切事件与权威 capability 快照时出现。前端 fixture 不能证明当前实际账号开启此能力。
3. 当前原生 CLI 0.162 的 searchOccurrences 返回不支持，真实 HTTP 501 路径回退已加载历史；独立 fixture 验证精确 cursor 的真实读取链路，不代表正式 native RPC 已支持。
4. 当前 editor host broker / legacy cloud task 适配没有原生 handoff operationId/steps 快照。handoff 标签保留真实结果，步骤详情不从注册表或成功字段推断。
5. 原包参考对照覆盖已列的 compact/body 状态，Hook 弹窗外层及正文已经独立完成四配置严格对照。未知第一方工具的专用图标不能由已列已识别工具的对照计数替代；未知类型保留安全诊断，不静默删除。
