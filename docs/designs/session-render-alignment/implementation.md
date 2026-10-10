# Codex 原生呈现实施与验收进度

状态：进行中，不是整项完成声明。完整目标仍为 [plan.md](plan.md) 的 P0–P4；最新范围是 Codex 专用复刻，保留公共输入区分离、文件悬浮 Diff、多项目/标签/自由分屏、持久草稿/附件及所有现有核心能力，Claude 不换渲染器。

正式运行层状态：2026-10-10 15:17（+08）已按用户指令启用新版 Rust，PID79218，运行文件与当前构建一致，`codexAccountMutationsV1` 已声明。文中此前“未激活/旧PID540655”的记录是历史阶段；新增能力的正式接口验收见文末。云任务原入口/API保留，没有新增禁用或拒绝策略；远端可用性限制仍按实际响应呈现。

## 2026-10-10 10:36：请求与插件修正后的阶段门禁

该阶段产品追加为模型原生状态色/Portal 字体、短视口请求滚动、图库圆形触控、插件详情留白与通知。插件产品最后写入10:26:28 +08；以下结果早于随后用户反馈的桌面滚动抖动与消息间距修正，不能代替这些新增修正的合并验收。LAN 产品为 HTTPS `https://10.30.0.24:8484/?mode=session`，原包只读参考为 HTTP `http://10.30.0.24:43831/native-markdown.html`。

| 门禁 | 最新单批实际结果 |
| --- | --- |
| shared/Node/Web 类型与生产构建 | `final-check-request-plugin-visual-freeze.log`：`pnpm check`退出0，Web build42.28s |
| 完整 `pnpm test` | `final-all-tests-request-plugin-visual-freeze.log`退出0：Session332文件/1292项、208.86s；终端531/531；Node731总数中730通过/1既有跳过/0失败；脚本99/99 |
| 最新涉及的文件格式 | `final-request-plugin-web-format-check.log`退出0；在实际web工作目录解析Prettier，检查新增请求夹具、插件通知及专用CSS；没有全仓格式化或改无关文件 |
| Rust 最新相关源码 | 最新三个P3模块写入08:03–08:06，晚于其写入的`final-runtime-p3-boundaries-{check,test,clippy}.log`：172通过/3外部依赖忽略、check/clippy0；`final-runtime-p3-build.log`08:29构建0。后续没有新的Rust源码修改，无重复运行或正式激活 |
| 完整请求与表单流程 | Chromium `requests-owner-actions-final-chromium.log`24/24、5.2min；WebKit `requests-complete-touch-lists-final-webkit.log`24/24、3.7min；六尺寸×两主题×两类流程，各1worker |
| 原包模型菜单与状态 | `model-menu-state-fonts-green.log`6/6、38.7s，真实原包simple/advanced和high/xhigh/ultra；最新专项3文件8项，元数据/Portal flags保持对应源码 |
| 插件最终详情/通知 | `plugin-spacing-notice-final-green.log`4/4、40.4s；专用通知与旧typed/离开保护单批5文件19项，3.58s，types0；手机正常返回/关闭/发送，桌面原几何保留 |

该构建后的UI合并批次为Chromium28/28、WebKit26/28；后者两项是图库夹具在翻页前等待所有未进视口的lazy图片解码，真实浏览器合法延迟加载没有结束。保留该失败记录；仅改夹具逐页真实下一组/上一组并验证每一张进入可见区域后的解码，产品未改，图库新单批两引擎分别4/4（40.4s/41.4s）。不把这些专项拼成原28/28。完整请求的WebKit滚动使用明确的未可信DOM事件处理和实际视口布局，Chromium使用可信CDP触摸；真实tap、准确HTTP身份与草稿保护分别保留，实体Safari手指滚动/软键盘仍未实测。

本轮实际截图复核包括请求两引擎共24张整页、三档模型两主题6张、图库桌面/手机4张以及插件详情/通知/管理10张；最终主页面图另行记录。详情16px侧边/正文留白、正常32px图库圆、44px透明热区和20px通知关闭圆均有几何与中心命中红→绿。所有发送使用隔离HTTP/WS或独立临时Git，不向正式Agent测试审批/停止/发送。

正式Rust PID540655与Vite PID2873879及启动时刻保持不变。当前健康接口只有acpImages/codexOwnership能力为true，新账户操作等flag未启用；新二进制仍遵循活跃Agent安全窗口。实际账号/旧云404、原生非空公开摘要、未提供hookRuns/Guardian gate、两个CLI不支持occurrence、实体手机录音/OS选择器以及全部宿主状态零像素差异仍是明确剩余边界，不能宣布整项perfect完成。

## 2026-10-10 合并检查快照

以下按实际执行记录列出模块及合并验收，**不把不同批次的通过数相加称作一次全绿**。浏览器使用 HTTPS `https://10.30.0.24:8484`；原包固定资产及只读宿主使用 HTTP `http://10.30.0.24:43831/native-markdown.html`。正式运行层与 Agent 未重启；以下合并检查表是 06:39 的历史冻结快照，后续单批检查见文末。07:00 以后完整审计新增的拖放、附件字节、引用和云缓存修复另行记录，旧通过数不能当成新源码验收；早期红灯与过期夹具失败保留。

| 范围                    | 当前实现与证据                                                                                                                                                                                                                                       | 尚需完成或外部条件                                                                                                                                                                |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 真实主 composer         | 原生模型/权限/服务等级/Enter；Agent 与已有直接入口保留；owner/revision 目标、计划、网络及附件隔离。`composer-progress.md`：53 单测、6 LAN 场景；旧紧凑输入回归更新后单次 7/7 LAN 通过                                                                | 实体手机键盘与录音权限没有实测；手机固定高度、左图/删除、常驻入口及桌面原生自动高度分别验证                                                                                       |
| 请求、提问、elicitation | 原生逐题/秘密字段/legacy schema 与推荐导航；原请求/实例/轮次归属。`requests-progress.md`：103 专项、10 LAN；Guardian 8 Node/4 LAN                                                                                                                    | 实际 Guardian 补救批准缺少可信原事件/能力时明确 unavailable                                                                                                                       |
| Markdown/代码/媒体      | 实际原生 Markdown 使用 highlight.js 11.11.1，Diff 独立使用 CODEX TextMate；围栏、列表、表格、标题、引用、inline 与字体合成规则原包 4 profile 门禁通过。Mermaid 原生 ELK 几何/中文隐藏测量/真实下载及 Claude 隔离单次 6/6；14 专项通过                | 所测 flowchart 的节点、边、文本和 viewBox 对齐；不宣称每一种 Mermaid diagram-family 都已逐像素验收；Claude 保持原 renderer                                                        |
| 工具生命周期            | 原生图标、公开摘要/压缩、自动审查、Hook 统计；12 家族连接器 1,108 描述、1,956 实际原包 MCP 输入及 589 动态摘要 identity/descriptor oracle。最终 26 文件/101 专项、120 状态/8 产品 LAN/Hook 四配置通过；MCP 来源新增原包 30 分类和 24 Intl 组合全匹配 | 整页检查另发现展开箭头 0°，补测原包 90° 红→绿：20 状态/4 配置通过；未提供 hookRuns 不推断历史恢复，真实能力 gate 不扩大                                                           |
| review / Git            | 原坐标/字词/并排/虚拟大 Diff/行评论/findings；只读 base/commit/custom 与保存 patch 分离；真实 hunk stage/unstage/revert 与 Undo/Reapply 保留 index/无关修改。`review-progress.md`：最终 12 LAN 场景与实际原包 geometry/ROI                           | 全组件像素差异仍在定位：light 行号偏移 1px 已修正，局部 RGB 差异归零；dark 明确的用户截图配色与原生宿主色分开记录                                                                 |
| 消息与工作流            | 编辑/指定轮 fork 捕获原参数；搜索/导航/导出/原生链接接入正常标签；独立同源计划窗口。`thread-workflows-progress.md`：24 文件/82 专项，包含迟到 fork、选区、ABA 编辑草稿与独立计划窗口门禁                                                             | 搜索栏遮挡已先红后绿修正；定向历史保留连续 cursor，fork/rollback 本地拒绝不误判送达不明；完整工作流最终合并浏览器单次 18/18 通过                                                  |
| VS Code 宿主/项目       | 私有 companion、严格同源/nonce/owner、未保存 Monaco 选区/文件定位/原生 Diff、实际 TODO 行内点击、LSP MCP、推荐技能安装。`host-progress.md`                                                                                                           | 隔离真实 code-server 证据已取得，主产品实际 Vim 整行选区加入原草稿、关闭/重开保持同一 iframe 已通过；非 Git AGENTS 与父仓库作用域边界已先红后绿；39 Node/16 前端/4 companion 通过 |
| 账户与配置              | 真实多桶窗口/剩余百分比、未知状态、threadless 配置/弃用通知及只读文件；登录原 loginId/运行实例与迟到读取保护。`account-progress.md`                                                                                                                  | cancel/logout 固定 REST、health 能力与显式 UI 已补齐；13 文件/47 专项通过，正式能力 flag 仍为 false；最后四主题/设备 LAN 单次 4/4 通过；没有对真实账号执行取消或退出测试          |
| 原生只读接口            | config/read 最小投影、configRequirements/read、searchOccurrences 固定 method，参数有界。`session-native-readonly.md`：Rust web 64 项；workspace 157 通过/3 外部依赖忽略、两个实际 CLI HTTP 验证                                                      | 0.161.0 与 VSIX 0.162.0-alpha.2 都明确 searchOccurrences 未实现，当前 fallback 只搜索已加载正文；正式新运行层未激活                                                               |
| 云任务                  | 原生旧接口/真实账号、环境/任务只读、快照/委派与真实回执已接入。`host-progress.md`                                                                                                                                                                    | 真实 upload_url 两次明确 404，没有签名 URL/上传/任务/模型结果，不能声称远端成功                                                                                                   |
| 独立视觉验收            | 1440/768/480/390、手机横屏及缩小视口 × 两主题 12 LAN 检查，主要按钮实际 hit-test、菜单边界、无整页横向溢出。最终 `e2e-visual-native-font-final.log` 单次 12/12，12 张整页截图已实际查看                                                              | 缩小浏览器视口不是实体软键盘；窄屏信息条和把手遮字已红→绿；整体像素差异、批准的深色宿主 palette 与抗锯齿例外独立记录，不宣称全页面零差异                                          |

### 06:39 历史合并门禁

| 门禁                              | 实际结果与日志                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 最新前后端类型/生产构建           | 最后 MCP 来源 scalar 与 helper 冻结后 `final-check-mcp-source-freeze.log`：`pnpm check` 退出 0，shared/Node/Web 类型和生产构建通过，Web build 44.05s；`final-frozen-lock-mcp-summary.log` frozen-lockfile 通过                                                                                                                                                                                                                                                   |
| Session 单测                      | `final-session-mcp-source-freeze.log`：313 文件、1,161 用例全部通过，197.28s；启动 06:39:02，晚于最后产品写入 06:36:12。前一批 `final-session-mcp-source-summary.log` 读取最后 scalar 变更前模块，1 个空串来源断言失败，保留为非最终时序证据                                                                                                                                                                                                                     |
| Node 网关全量                     | `final-server-tests-native-settings.log`：725 通过、1 已有忽略、0 失败；包含真实 serviceTier/reviewer 队列契约的 38 项回归                                                                                                                                                                                                                                                                                                                                       |
| 终端与脚本                        | `final-terminal-tests.log`：531/531；`final-script-tests-cache.log`：98/98，包含开发缓存隔离红绿灯                                                                                                                                                                                                                                                                                                                                                               |
| Rust workspace                    | `final-runtime-check.log`、`final-runtime-test.log`、`final-runtime-clippy.log`：check/clippy 退出 0，157 通过、3 外部依赖忽略；构建与激活分开                                                                                                                                                                                                                                                                                                                   |
| 模型/状态/标签/后台恢复核心浏览器 | `e2e-final-root-core.log`：71 场景中 68 通过，3 个旧夹具失败保留。两模型场景按真实菜单复验 `e2e-final-model-isolation-v2.log` 2/2；失败送达夹具改为实际只读 thread/read+turns/list 后 `thread-failed-delivery-readonly-green.log` 1/1。没有通过 resume 获取写入权                                                                                                                                                                                                |
| 原生正文/输入/性能浏览器          | `e2e-final-root-content-v2.log`：32 中 25 通过，7 个旧 composer 夹具失败保留；`host-composer-compact-final.log` 单次 7/7 转绿。10000 事件 136.6ms；1500 条缓存切换 217.7ms；30 次后台更新 23.4ms；275 挂载 DOM，数值仅代表本机条件                                                                                                                                                                                                                               |
| 活动/命令/探索/请求及整页原包对照 | `e2e-final-native-surfaces-v2.log`：单次 20/20；原包来自未改动 VSIX 资产，不用模拟实现代替原组件                                                                                                                                                                                                                                                                                                                                                                 |
| 完成工具汇总与真实只读目标        | `dynamic-summary-native-label-red.log` 2 红→`dynamic-summary-native-label-green.log` 4 文件/37 绿；`e2e-final-completed-summary-v2.log` 单次 10/10。保留实际 item/namespace/成功失败及 source schema identity；不再用 raw tool 名或按 tool 名误合并                                                                                                                                                                                                              |
| MCP 来源与最后稳定浮层截图        | `mcp-source-summary-native-red.log` 两红、`mcp-source-summary-metadata-red.log` 两红及 `e2e-mcp-source-summary-red.log` 实际原包红→`mcp-source-summary-native-green.log` 4 文件/48 绿；`e2e-final-native-mcp-source-summary.log` 单次 10/10，含真实原组件来源摘要/hover/字体/图标。构建结束后 `e2e-mcp-source-stable-freeze-final.log` 单次 4/4，23.7s；等待实际 opacity=1 后四张整页已查看。前一批构建/HMR 中有一次夹具回到新聊天的失败保留，未修改产品或删断言 |
| 工作流与账户                      | `thread-workflows-merged-final-browser.log` 单次 18/18；`e2e-account-final.log` 单次 4/4；实际 API fixture、隔离 Git/Node 与正式账号操作分别记录                                                                                                                                                                                                                                                                                                                 |

所有最终浏览器都使用 1 worker、隔离 API/数据和局域网地址，没有向正式 Agent 发送审批、停止、撤销或测试消息。项目、多关注标签、自由分屏、背景刷新、阅读锚点和逐会话草稿/模型保留。早期失败来自过期夹具时只更新夹具到实际已批准的原生交互，没有删除功能断言或改用写锁历史接口。

公开摘要额外做了两次隔离真实原生轮次：原 VSIX CLI、编译后的真实 Rust 二进制、实际 catalog 模型，分别为短算术和高强度有限调度题。均正常完成、没有工具或文件、正式四个 runtime PID 不变、临时数据已清理；第二次有 160 个助手 delta。**两次原生源 summary/raw 事件都为 0**，因此没有非空 summary 的真实模型送达或 raw 分支触发证据。实际生命周期通过与该缺口分别保留在 `native-public-summary-real-receipt.json`、`native-public-summary-logic-receipt.json`；运行层过滤/转发有红绿单测，但不能用零事件替代正向验收。

## 当前实现

- 不改变事件日志，按 thread/turn/item 投影稳定正文；跨状态事件拼接 delta，最终完整快照替换同一行，保留 phase 与阅读 key。plan 正文/delta、公开摘要和 MCP 生命周期同身份呈现。
- 命令实时输出归入自己的 action source；完成状态/耗时使用会话内命令快照，不优先借用全局同 itemId 的缓存。完成快照可以直接恢复没有 start 的命令。
- Rust 只过滤 raw reasoning，公开摘要放行，reasoning item 移除 raw content；前端也不渲染 raw 内容。**运行层单测已通过，现有正式 Rust 进程尚未替换，实时公开摘要的正式链路仍待安全激活及验收。**
- Codex 独立 Markdown，平铺助手正文、原生间距参数、代码高亮、公式、Mermaid 与表格控件；统一自己会话的文件链接、原始行/列及文件编辑器定位。保留 visualize 与其隔离，普通 Claude Markdown 不替换。
- Codex scoped theme 与分离的公共输入区；原有固定高度、左侧图片、直接删除/工具、模型与权限、浮层、草稿归属保留。用户消息图片增加原尺寸预览和下载。
- saved unified patch 保留原始 hunk 行号，末行无换行不丢失；复制保存原 patch。Codex inline/悬浮 Diff 增加语法色与逐词标记，Portal 有独立 Codex 主题；手机可点击“预览 … Diff”，桌面 hover 保留。
- MCP 展示真实参数、进度、文本/图片/音频/resource/resource_link，结构化及原始结果另有入口。此插件构建关闭的 MCP Apps widgets 不伪装成已支持。
- 审批采用原生卡片的分离授权动作：“允许一次”和范围菜单独立，展示 command/cwd/reason/network/额外权限；`availableDecisions`（包括空数组）权威，发送前再次校验决策及 callback 类型，不把一次批准升级为策略放行。请求实例变更重置长命令展开；submitting/uncertain禁用重复提交，保留只读核对入口。
- 搜索按原生 query/action 与 `site:` 规则显示语义摘要；imageGeneration展示实际图像，imageView展开后只读载入，dynamicToolCall按原生文本/图片/音频显示。上下文压缩显示真实状态，协议未提供source时不臆造自动/手动来源；sleep记录按原包规则隐藏。图片在途读取按owner/path合并，完成后不缓存旧文件。
- 未收到单个item结束事件时，以turn终态结束正文/公开摘要/MCP/动态工具/命令动画；轮次携带最终item快照可补齐原行。结束仅为呈现metadata，不篡改item为成功或虚构exitCode；迟到delta不污染最终正文/命令输出。每轮checklist保留最新快照。
- Diff 采用原包 Codex Light/Dark 的 245 条 TextMate 规则；实际原生 Markdown 围栏使用 highlight.js 11.11.1，单独复用其标签、图标、12px/20px 字体与 token 配色。两条呈现路径不混用；保留原始 patch 复制、围栏换行选择及下载。参考截图自定义深色 palette 与原包默认宿主色的差异独立记录。
- 聊天内Diff不增加文件工具标题栏或原始hunk标头；原行号、逐词色及完整patch复制保留，手机悬浮预览重排工具栏保留完整文件名。Old/New复制剥去context前缀和no-newline标记，仅代表已保存hunk片段，不宣称整份历史文件。旧argv格式审批只规范显示，不修改RPC请求身份。
- 保存的轮次变更固定thread/turn/cwd与净patch，正文查看不再打开全局项目或当前Git内容；统一/并排视图保留原坐标，打开文件定位自己的项目。运行变更条在公共输入区上方浮层；原悬浮Diff和完整列表保留，完整查看主动关闭预览，手机/桌面头部没有叠加或竖排标题。
- Undo/Reapply在Node网关只读核对原生已应用批次，按顺序/反序准备净patch，不再执行全文件回滚。保留后续独立修改/index、支持文本新增/删除/重命名及执行位；冲突拒绝，部分写入/信号/超时保持uncertain。内核锁、持久执行标记与同requestId回执防重发，浏览器刷新只读核对；没有向正式Agent发出文件操作。详见[保存的轮次变更](../../session-saved-patches.md)。
- 旧记录缺失/非法durationMs不再渲染“0:NaN”，同一轮迟到快照保留已核实时长；缺失apply status的旧文件变更保留只读查看，失败/拒绝不获得撤销权限，中断轮次已应用的文件仍可查看。

## 探索行与连续命令切片阶段（2026-10-10）

读取/搜索/列目录从旧Badge改成原包语义行与文案。读取文件链接固定捕获的source cwd，缺失时只向自己的owner查目录，不借其他会话的活动项目；literal path保留百分号、冒号数字与其他真实字符，Markdown行号链接的解析保持原样。搜索表达式和文件名以React文字节点渲染，尖括号不再被Trans当成组件标签。失败/拒绝/终态未完成的探索保留命令输出和实际退出信息，不无声隐藏。

连续命令在可见MCP、完成式正文、warning/checklist等边界按原顺序刷出；生命周期完成继续更新原source，隐形状态/输出不拆组。单条完成动作直接呈现；多条按真实状态显示探索/命令语义摘要，未完成动作不计成已运行。手动展开按thread/turn/首item恢复；body最高224px、4px行距、原生滚动渐隐，不允许flex把长内容全部压扁。手机44px文件热区中动词与路径居中对齐，文件跳转不聚焦输入区或改变选中会话/项目。

红→绿：`native-exploration-red.log`、`native-exploration-summary-red.log`、`native-exploration-pending-red.log`、`native-exploration-literal-red.log`及`native-exploration-warning-red.log`；最终专项`native-exploration-final-scoped.log`（4文件32用例）。完整Session `native-exploration-all-session-tests-final.log`为227文件829用例通过；`native-exploration-check-final.log`为共享包/后端/前端类型和生产构建通过。一次较早全量读取到刚加入的warning红灯，不计为最终绿灯。

真实原包`nS/Wx/Zx`的浅深色文字、字号/行高、链接矩形/font、30%内容/90%动词色和下划线参数均与产品一致；固定DPR1的616×400图片仍有8/10个文件名字形RGB差异，记录在`native-exploration-pixel-check.json`。所有比较基于原插件资产，只读shim和隔离API；没有运行用户命令。手机与桌面两主题验证展开保持、长列表滚动、literal文件路径及captured owner，不改变项目/会话/输入焦点。

`e2e-exploration-regression.log`的84个核心场景中80个通过（8.7min），其4个新增location失败来自Vite fixture读取另一模块实例；不把该运行记作整体通过。修正fixture后`e2e-exploration-read-final.log`的6个专项全部通过（32.1s），覆盖此前4项与2项原包对照；额外验证实际workspace-files/read接收captured root/literal path、编辑器显示返回正文、手机不聚焦任何textarea/input。此前错误的read-text-file mock另保留失败日志。当前源码已成功覆盖84个去重浏览器场景，但结果来自上述回归与专项复验，不冒充单次84全绿。10000事件170.9ms、1500缓存切换173.0ms、30次后台更新45.4ms，208个挂载元素。桌面/手机两主题及原包/product图片均已实际查看。初次红灯揭示flex行高压缩，修复后保留原高度并滚动；另一个location断言读了与mounted renderer不同的Vite模块实例，修正为观察实际依赖，未更改产品行为。所有失败运行保留。完整混合工具活动、native active/thinking/header切换、无body的canExpand语义、skill read例外与其他P0–P4项目继续实施；当前不宣称整页完全复刻。

## 命令面板复刻阶段（2026-10-09）

执行摘要改为原包灰色单行，展开使用紧凑shell名、两行命令独立展开、最高144px反向滚动输出、复制及Success/Exit code/Stopped footer。图标直接取原包执行资产；圆角12.5px与superellipse(1.5)、13px摘要/12px代码及字体回退列表均有真实原包组件对照。缺失exitCode显示unknown，不用完成状态代替成功；命令开始时间来自ItemStartedNotification.startedAtMs，每秒更新，页面隐藏暂停呈现更新、返回立即补齐，结束使用原生durationMs。

thread/turn/item/command隔离展开及输出阅读位置，流式替换不串状态，虚拟卸载可恢复；明确owner不借用全局同itemId的未核实状态。输出安全解码ANSI/回车/退格，不创建HTML或OSC链接；折叠时不解析长输出，复制保留原始stdout/stderr。手机仍有44px复制热区与可见操作，未引入输入框自动聚焦。

红→绿日志：`native-shell-red.log`、`native-shell-identity-red.log`、`native-shell-owner-red.log`、`native-shell-duration-red.log`、`native-shell-decode-red.log`、`native-shell-keyboard-red.log`、`native-shell-timer-red.log`；最终专项`native-shell-timer-green.log`为3文件20用例。`native-command-all-session-tests-timer-final.log`：225文件815用例通过；`native-command-check-timer-final.log`：共享包、后端和前端类型及生产构建通过。

`e2e-command-timer-final.log`：7场景通过，1440/390px×浅深主题验证流式输出、状态/退出码、展开、复制、阅读位置和真实开始时间计时；另2场景直接运行原包Vx/an/Xt/on，在同一固定宿主参数下核对面板宽高、输出高度、字号/行高、实际font-family、背景与圆角；1场景验证1500条历史缓存切换169.6ms、30次后台更新25.2ms，208个挂载节点。冻结源码后的`e2e-native-command-timer-regression.log`：63个核心浏览器场景全部通过，包含实际原包对照，没有跳过reference场景。10000交错事件108.4ms可见；1500消息缓存切换150.6ms、30次后台更新17.3ms，208个挂载节点。

对照产物为`e2e-command-timer-final/**/product-*.png`与`reference-*.png`，实际插件原包、只读shim与隔离APIfixture；测试设置`CODEX_NATIVE_REFERENCE_URL=http://10.30.0.24:43831/native-markdown.html`，缺失reference环境会显式skip这2个专用场景。固定DPR1的原图RGB比较仍有约481/486个差异像素，集中于摘要箭头与命令字形；**没有宣布整页或本组件逐像素完全一致**。下一步须继续核对字形/抗锯齿与状态、工具分组/读文件链接、后台PTY及原生运行摘要。较早4个浏览器失败来自把反向scrollTop误当作阅读锚点，断言改为距正文起点的位置；另一次fixture直接改关注缓存被权威同步覆盖，改走addAgentCard与持久操作链。失败运行保留，不并入最终63通过计数。核心输入区分离、悬浮Diff、项目/标签/分屏及Claude原renderer保留。

## 此前阶段：保存的轮次变更（2026-10-09）

`saved-review-all-session-tests.log`：224文件、802个Session用例通过。`saved-patch-backend-final.log`：19个后端定向用例通过，含网关协议、原生身份/批次核对、真实Git多次修改/冲突/重命名、index和后续改动保留、并发网关以及部分写入后的不明回执。`saved-review-check-final.log`：共享包、后端、前端类型与生产构建通过。

冻结源码后的`e2e-saved-review-final.log`：57个核心E2E全部通过。10000交错事件119.3ms可见；1500消息缓存切换184.8ms、30次后台更新20.0ms，末端208个挂载元素。保存变更的4个1440/390px×浅深色场景接入真实Fastify路由与Git服务，原生回执为隔离fixture，在独立临时仓库执行Undo/Reapply及冲突核验；截图见`e2e-saved-review-final/session-codex-saved-review-*/saved-review-*.png`。局域网HTTPS只读操作回执接口返回`{result:null}`，未对正式会话进行破坏性测试。

红→绿证据包括`saved-patch-red.log`、`saved-patch-route-red.log`、`saved-review-red.log`、`saved-summary-red.log`、`saved-patch-client-red.log`、`saved-panel-red.log`、`saved-split-red.log`、`running-changes-red.log`、`saved-patch-lease-red.log`、`saved-patch-mode-red.log`、`saved-patch-partial-write-red.log`、`saved-preview-close-red.log`及`native-duration-red.log`；对应专项与最终合并绿灯均在同目录。较早合并E2E的4个中断文本断言误选中工具和轮次两个状态，已限定工具行；一个目标草稿场景当时缺失，单独复验及冻结后完整57场景均通过，不把早一次运行记为通过。

这些是本阶段验收，完整P0–P4仍在推进；原生逐像素对照、所有工具/请求、完整review与宿主/云功能还未整体验收。

## 本阶段合并验证（2026-10-09）

`session-tests-final-stage.log`：216文件、784个Session用例全部通过；`e2e-core-final-stage.log`：53个E2E全部通过，含真实SSE故障、20/50标签后台恢复、阅读锚点、Codex/Claude持久草稿、图片上传/重试、手机无自动键盘、自由分屏、子Agent权限及本次原生呈现。10000交错事件最新正文181.6ms可见；1500条缓存切换152.1ms，30次后台更新13.6ms，末端仅208个挂载元素。数值仅代表该工作区、主机与隔离fixture。

`check-stage-green.log`：前后端类型与生产构建通过；前一次构建发现新增RTL单测误用了Playwright的`exact`选项，已改正。`e2e-inline-patch.log`额外4个1440/390px×浅深色场景验证聊天内Diff展开、原坐标、真实浏览器剪贴板完整patch及悬浮预览标题宽度。原生主题与旧argv回归在`native-palette-argv-green.log`；Diff先红后绿见`native-inline-red.log`/`native-inline-green.log`。这些是阶段验证，完整P0–P4仍未完成。

## 原包组件对照环境

已直接运行原 VSIX 中未修改的 Markdown 和 approvalRequestCard 组件，补齐真实 AppScope/QueryClient/Intl providers 与原 CSS layer顺序；VS Code host仅提供样式及只记录消息的shim，不启动或操作Agent。局域网对照页为 `http://10.30.0.24:43831/native-markdown.html`。观察到13px正文/21.125px行高、行内代码11.96px/1px 6px/6px圆角；原生使用 `\\(...\\)` / `\\[...\\]` 公式，美元分隔保留文字，Codex renderer已有对应回归。原中文语言包也已纳入对照。宿主全部主题变量、浅色、其他组件、完整DPR与逐状态叠图仍须补齐，不能把当前host shim截图视为全量像素验收。

## 已取得证据

测试日志和图片均在忽略目录 `.dev-runtime/session-render-alignment/`。测试通过局域网 `https://10.30.0.24:8484`，API/队列使用隔离 fixture；不向正式 Agent 发送消息、审批或停止请求。

| 范围                                                       | 证据                                                                                      | 当前结果                                                                     |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 交错 delta、最终全文、公开摘要、plan与命令输出             | `p0-red.log` → `p0-green.log`                                                             | 最初8个失败转绿；后续扩展生命周期用例                                        |
| 公开摘要/原始 reasoning 分离                               | `summary-red.log` → `summary-green.log`                                                   | Rust3个测试通过                                                              |
| 助手 Markdown、自己项目行定位、visualize                   | `markdown-red.log` → `markdown-green.log`                                                 | 8个用例通过                                                                  |
| hunk行号/原patch复制/无换行末行                            | `diff-red.log` → `diff-green.log`                                                         | 3个用例通过                                                                  |
| 当前前端专项回归                                           | `p0-p1-tests.log`                                                                         | 当时14文件65测试通过，后续修改还须重跑                                       |
| 前后端类型/生产构建                                        | `check.log`                                                                               | 当时 `pnpm check` 通过，后续修改还须重跑                                     |
| 桌面/真实touch窄屏、浅深主题、分离输入、文件预览、流式补齐 | `e2e-regression.log`、`e2e-regression/**/native-*.png`                                    | 5个新场景通过                                                                |
| 固定高度/左图/删除/慢上传/重试/主题/窄窗口与长历史         | 同上                                                                                      | 合计13 E2E通过；1500消息缓存切换188ms，后台30次更新17.4ms                    |
| MCP参数与混合媒体/资源                                     | `mcp-red.log` → `mcp-green.log`                                                           | 2个用例通过                                                                  |
| MCP start/progress/completed、命令快照状态                 | `activity-red.log` → `activity-green.log`                                                 | 扩展后11个用例通过                                                           |
| 用户图片放大与下载                                         | `user-image-red.log` → `media-green.log`                                                  | 联同MCP媒体3用例通过                                                         |
| 原生公式语法/美元文字/代码隔离                             | `native-math-red.log` → `native-math-green.log`                                           | 2文件6用例通过                                                               |
| 审批授权范围/实际信息/实例/路由与防重发                    | `approval-red.log`、`approval-scope-red.log` → `approval-full-green.log`                  | 4文件27用例通过                                                              |
| 审批范围菜单、长命令、真实请求身份                         | `e2e-approval.log`、`e2e-approval/**/approval-*.png`                                      | 1440/390px×浅深色4场景通过，浏览器提交到隔离fixture                          |
| 终态、最终item补齐、checklist合并                          | `terminal-projection-red.log` → `terminal-projection-green.log`                           | 4个新增失败转绿，当时12用例通过                                              |
| 命令晚到输出/终态/自己快照                                 | `command-terminal-red.log` → `command-terminal-green.log`                                 | 当时2文件7用例通过                                                           |
| 搜索/生成图/查看图/动态工具/压缩                           | `semantic-red.log` → `semantic-green.log`                                                 | 当时2文件19用例通过                                                          |
| StrictMode预览重复读取                                     | `image-remount-red.log` → `image-remount-green.log`                                       | 当时8用例通过                                                                |
| 实际PNG解码/音频时长/资源链接/放大与中断                   | `e2e-semantic-red.log` → `e2e-semantic-green.log`、`e2e-semantic-green/**/semantic-*.png` | 1440/390px×浅深色4场景通过；PNG自然宽120，WAV时长0.1秒，展开图片只发一次读取 |

上述计数属于各自执行时的工作区，不能相加当作一次完整验收结果。

## 截图发现并修复

首次悬浮 Diff 截图中，Portal 不在 `.codex-presentation` DOM 内，主题变量没有继承，导致红绿行背景丢失；添加 `.codex-file-preview` 的独立 tokens。后续 E2E断言真实行背景不是透明，同时分别截图浅深主题。原始文件行115/307/308的坐标保留，手机不用 hover 也能进入预览。

## 当前剩余验收与依赖

1. 最新全量 Session/终端/后端/脚本和 Rust 检查已通过，详见顶部逐次记录；核心、新增和实际原包浏览器分批复验，不把历史批次相加称作一次全绿。最后 MCP 来源修正冻结后 `final-check-mcp-source-freeze.log` 类型/生产构建与 `final-session-mcp-source-freeze.log` 全量 1,161 项通过，浏览器稳定四场景在构建结束后执行。
2. 围栏主题、Diff 行号、搜索栏遮挡、账户、窄屏 context/sidebar、字体和 Mermaid 测量已定位并修复；最新 12 个整页场景及 10 个工具汇总/目标集成通过。逐组件尺寸/颜色/SVG 对照与整体 RGB 像素差异分开，不能宣称完整页面零差异。
3. 第一方专用动态工具 enabled-path 审计、12 家族适配、120 逐状态和 8 产品 LAN 门禁已通过；箭头遗漏维度另有 20 状态红→绿。Page checkpoint/restore 和环境原型卡片均有实际 gate，不能仅因 registry 存在而启用。
4. 主产品真实 VS Code iframe 的菜单、整行选区加入原草稿与关闭/重开保活已取得证据；隔离 CodeLens/LSP/技能和主产品接入证据仍分开记录，不以协议 fixture 代替实际 UI。
5. 新 Rust 适配器正式启用遵守活跃 Agent 安全窗口；当前进程不会因界面验收被替换。真实原生非空公开摘要与未返回的 hookRuns 恢复仍缺实际事件证据。
6. 原生 occurrence 搜索在两个实际 CLI 都返回 unsupported，保留已加载正文回退及说明。原包 checkpoint/restore 的 Page 路径必须依实际启用 gate 判断，不能做成虚构本地书签或用全局 Git 回滚替代。
7. 旧云任务 snapshot 端点实际 404；远端创建、续聊与模型结果依赖可用的原生账号/API，不能用 fixture 当作成功。实体手机录音权限与 OS 软键盘也未在设备上验证。

当前 goal 保持 active。正式Rust运行层与Agent未重启，Node网关沿用热更新；没有提交或推送。

## 完整范围审计追加：拖放、WebKit 附件与可恢复能力

2026-10-10 07:20，逐项复核批准 P0–P4，已保留 `completion-p0-p4-audit.md`、核心、composer 和安装配置的只读矩阵（本机忽略目录）。原有保留能力、已验模块、实现缺证、真实 enabled 遗漏及外部条件分别记录，没有把普通目录 fixture 当作原生安装成功，或把此前 opaque marker 结论泛化到真正的文件/记忆引用。

- 桌面文件 drop 原来没有接入。原包主 composer `Eat`→`fAi`→`nma` 实际分离 images/otherFiles，且不自动 submit；网页现在在公共输入和展开编辑接 Files，图片复用原 owner 的持久上传；UTF-8 代码/文本保存完整快照，不虚构本机服务端路径，二进制入口边界见 [草稿规则](../../session-drafts.md)。普通文本/标签拖放、受限子 Agent、异步原归属、文件读取顺序与悬浮提示均有明确处理。
- 真正可运行的 WebKit 首轮 6 场景在 newPage 前 EGL 失败，不能列产品失败或通过。隔离官方库补齐 Mesa 软件 EGL 与 TLS 后，第二轮实际页面执行 4 项焦点/阅读通过，2 项相册上传失败；诊断为 `UnknownError: Error preparing Blob/File data to be stored in object store`，与依赖错误分开。附件存储改为真实 ArrayBuffer 字节及文件元数据，恢复重建 File，继续兼容旧记录，不绕过保存失败再上传。
- 混合图片/文本附件先显示图片，避免图片删除入口落在首屏横向滚动外；手机删除采用 44px 透明热区与小圆形叉号，输入框高度保持 124px。单选区文件按原拖入顺序保存，不被读完速度重排；切目标不会恢复陈旧拖放 hover。
- 红灯：`composer-drop-red.log`（入口 helper 缺失）、`e2e-drop-red.log`（实际 dragover 未接）、`drop-selection-order-red.log`（异步顺序）、`e2e-mixed-attachments-red.log`（首位图片）、`e2e-image-remove-hit-red.log`（32px）、`drop-stale-hover-red.log`、`photo-remove-before-upload-red.log`（保存字节期间移除后仍开始上传）；WebKit 实际上传红灯和同错误模拟 `webkit-file-storage-red.log`。最新相关单测 `drop-portable-storage-final-v2-green.log` 为 5 文件/19 项通过，保留 bytes/MIME/name/lastModified 一致性、原 owner、失败重试、移除防复活与路径/绘图 metadata。
- 入口的第一批 Chromium `e2e-drop-first-green.log` 是 4/4、31.7s，覆盖 1440/390×两主题、真实 DataTransfer、失败/重试、切会话、刷新和完整提交；它早于后续图片优先、44px 和字节修改，不能当成该最终版本全绿。最新两引擎/Enter/整页视觉复验待源码统一冻结后记录。
- 云 snapshot 403/404 改为 60 秒能力缓存，到期 GET 只回到未知，用户可显式重试，不自动 upload/task，不宣称接口已经恢复。两个真实行为红→5/5专项；`final-server-tests-cloud-ttl.log` 单次 728 项中 727 通过、1 既有跳过、0 失败，21.48s。真实旧远端接口 404 的外部条件仍未闭合。
- 原生文件 citation 和 agentMessage.memoryCitation 已确认真实 enabled，并按原 schema、captured owner 和实际行范围闭合。最终 `citations-plugin-editor-final-browser.log` 单批6/6、51.5s，含4个引用及2个typed plugin场景；600行文件的502–503行、directive/legacy来源、复制/导出literal与公开notes均有实际回执。不读取私有记忆文件或 raw reasoning；手机说明保持可读，另一会话的输入/草稿不漂移。

WebKit 依赖只从官方 Ubuntu 包提取到忽略目录，SHA256 已验证，原浏览器缓存/系统/正式运行层未替换；第一次 browser.launch/close 不等于 newPage/产品或实体 Safari 验收。三种 Enter 与浏览器 composition、两浏览器手机和新的整体美观验收均保留为待复验项，未宣布完整任务完成。

## 2026-10-10 07:55：跨浏览器真实红灯与容量口径

`final-check-native-citations-drop.log` shared/Node/Web 类型与生产构建退出 0（Web42.37s）；同一冻结快照的 `final-session-citations-drop.log` 为323文件/1235项全部通过，203.70s。此结果先于后续容量、memory几何与P3链修正，不能称最新源码最终全绿。

冻结后 Chromium 与 WebKit 的输入合并批次各14项、各11通过/3失败。三种 Enter、浏览器 composition/229、桌面焦点、手机切标签不自动聚焦、桌面附件拖放和 Claude 相册恢复通过；三个失败都实际进入上传与持久恢复后被 Codex 44px 删除热区截获预览点击，不是 WebKit 库或 IndexedDB 错误。日志 `e2e-final-chromium-input.log`、`e2e-final-webkit-input.log`；WebKit 已能完成真实页面、相册 File 保存和 HTTP 上传，但实体 Safari/软键盘仍未验证。

独立 `e2e-image-preview-hit-red.log` 保留缩略图截图与 elementFromPoint 断言：图片中心命中删除按钮。Codex 手机缩略图改96×62px，透明44px热区保留，小圆叉在右上，固定124px输入区不增高；禁止用force或偏离中心的测试点击掩盖原问题。新源码两浏览器复验待统一冻结。

另外正向trace未改动 VSIX `app-initial-3192ac99b6cd.js` 的 \_ma/cma/Z5n/r7n 与中文语言包：容量是 last.totalTokens/modelContextWindow，原进度SVG12px、r5/stroke2/currentColor/底圈.16、pathLength100，tooltip为当前已用/剩余与千token。旧Widget用 total.totalTokens 累计且红黄绿，存在语义与视觉差距。`context-capacity-native-red.log`8/8实际失败→`context-capacity-native-green.log`8/8通过；最新容量、360px桌面容器全部菜单、技能候选与非零safe-area浏览器场景已新增，尚未把待跑标为已验。

上述 browser composition 是浏览器事件验收，非实体中文输入法；CDP safe-area 是非零平台变量验收，非实体刘海屏；WebKit 渲染引擎是额外兼容证据，非实体 iPhone 验收。


## 后续跨浏览器与基础全量合并检查

以下是 09:15 前后完成的合并批次。它们晚于 MCP 网页通知、编辑器选区同步、附件/标注字节和视口观察修复，**早于后续模型菜单细节及表单滚动追加**；后者以各自新单批和最终构建为准。所有日志/截图位于被忽略的 `.dev-runtime/session-render-alignment/`，正式 Rust PID 与运行中 Agent 保持原样。

| 门禁 | 单批实际结果 | 范围与边界 |
| --- | --- | --- |
| shared/Node/Web 类型与生产构建 | `final-check-keyboard-mcp-annotation.log` 退出0、Web46.32s；通知样式追加后 `final-check-toast-style-freeze.log` 退出0、Web41.50s | 不把构建视为新运行二进制已启用；后续模型/滚动/插件样式还须最后构建 |
| 完整 `pnpm test` | `final-all-tests-keyboard-mcp-annotation.log` 退出0：Session331文件/1282项，210.86s；终端531/531；Node729总数中728通过/1既有跳过；脚本98/98 | 此为一次全量执行，不相加其他历史批次 |
| Rust workspace/构建 | `final-runtime-p3-boundaries-{check,test,clippy}.log`：172通过/3外部依赖忽略，check/clippy退出0；`final-runtime-p3-build.log` 构建退出0 | 技能根/链接边界和 CODEX_HOME 有隔离实际红→绿；正式仍用旧进程 |
| Chromium 主界面/输入/读取 | `e2e-final-keyboard-mcp-annotation-chromium.log` 单批33/33、3.0min | 7个spec：6尺寸×两主题整页、360px菜单/候选/运行中停止与队列、实际drop/恢复、3种Enter/IME事件、Codex+Claude手机相册/焦点、两项目各10000条历史与延迟媒体、非零safe-area |
| WebKit 主界面/输入/读取 | `e2e-final-keyboard-mcp-annotation-webkit.log` 单批32/32、3.5min | 同范围6个spec，明确不含 Chromium 专用 CDP safe-area；实际独立 WebKit 运行，非 Chromium 冒充 |
| 展开编辑与原图标注 | `mcp-annotation-notice-final-{chromium,webkit}.log` 各单批6/6，38.7s/45.5s | 两次真实上传、原图200×160像素、笔画/中文批注、移除/撤销及刷新后继续编辑；不是只断言弹窗打开 |
| 文件预览/评论/Git与原包 | `fixture-native-review-final-chromium.log` 单批17/17、1.9min | 两主题full/inline/hover/单文件摘要原包几何、桌面/手机实际临时Git hunk操作、50000行有界DOM与尾部、Guardian真实能力未知不重发；实际账户/Guardian成功不由fixture推断 |
| MCP 管理页最终触控/外观 | `mcp-visible-circle-final-chromium.log` 4/4、23.3s；`mcp-visible-circle-final-webkit.log` 4/4、25.7s | 两主题×1440/390，44px开关/动作、状态/详情对比度、通知正常位置、20px可见关闭圈+44px透明热区、实际关闭及返回；网页完成/启动事件和版本保护用隔离HTTP/SSE，不冒充真实账号OAuth回调 |

主批次 Chromium 与 WebKit 共24张整页图已全部用图片工具复核，包含1440、768、480、390、844×390横屏与390×420缩小视口。手机图片96×62px保留小叉与44px透明热区，图片中心正常打开预览，输入框124px稳定。上下文容量按当前 last.totalTokens/modelContextWindow 显示，未知不造零；文本输入、背景更新与切换保留原owner、阅读位置和未读。

浏览器 composition/229 属于真实浏览器事件门禁，CDP 非零安全区属于浏览器平台变量门禁；两者以及 WebKit 都不能代替实体 iOS/Android 的中文键盘、软键盘、安全区、原生picker和录音权限。

## 桌面滚动抖动与连续消息间距：展示和阅读规则

用户明确的症状是滚动时元素抖动、像重新渲染出来，而不是仅首次打开历史等待。两个独立协作者分别复现滚动和间距，保留失败日志、帧级测量和截图；前端访问仍为 HTTPS `https://10.30.0.24:8484/?mode=session`。

新挂载的虚拟行在绘制前读取真实边框高度，ResizeObserver递送使用已有borderBoxSize，不重复强制布局；零尺寸保留有效缓存。虚拟化和overscan=2不取消，已有WebKit视口回调下一帧边界保留。向上滚轮，包括2px小步、所属Radix滚动条鼠标拖动和真实导航键，立即解除底部跟随；手动到底或“回到最新”恢复跟随。编辑器、已消费键与IME独立拥有键盘事件。阅读中的行自身长高时，其顶部保持，仅补偿完全位于视口上方的行；异步阅读恢复服从新的用户滚动意图。

多段正文仅末段尾距归零，正常13px段间距和16px虚拟行间隔保持。实际渲染为空的reasoning/plan、完成sleep与空hookPrompt不生成占位行，原始事件与稍后出现的公开有效内容保持。桌面assistant操作栏22px，手机44px触控保持；完成消息正文间距52→44px。流式消息上的自有引用/侧边追问入口保留，明确与原包空footer不同，不删功能来缩小间距。

第一次合并`final-check-scroll-spacing-freeze.log`被另一会话随后加入的轮次分组类型错误阻塞。其合法threadId/method窄化已修正；原滚动和间距修复保留。新增轮次分组改为单遍process索引，避免每个轮次重复扫描整个历史；独立相同输入的10000事件/2500轮对照，旧块3056.317ms与25042500次字段访问，当前块15.284ms与52500次，输出2500header/5000行及raw-key SHA一致。此为模块基准，不是浏览器FPS证明。最终门禁需覆盖当前分组与原滚动修复的整合，不能把分组写入前的专项视作最新版证明。


### 2026-10-10 12:20 整合回归快照

`final-all-tests-scroll-spacing-integrated.log` 是11:35开始的一次完整执行：Session340文件/1330项、终端531项、Node733项中732通过/1既有跳过，以及脚本99项全部通过。之后另一会话追加轮次终态与恢复首击守卫；最新源码另跑 `final-scroll-spacing-lifecycle-unit-accepted.log`，5文件27项全部通过，并通过 `final-check-scroll-spacing-accepted.log` 的shared/Node/Web类型及生产构建（Web43.61s）。最初遗漏Session Vitest配置的失败日志仍保留，不把错误测试环境视为产品通过。

最新合并浏览器批次 `final-scroll-spacing-chromium.log` 为49/49、5.6min；`final-scroll-spacing-webkit.log` 为46通过/3失败、6.3min。两个引擎的6项实际滚动、2项阅读/尺寸恢复、4项轮次生命周期、4项间距布局与2项手机操作入口均通过。WebKit的两个桌面hover入口与1500条缓存历史切换尚有真实失败，未降低按钮中心命中或500ms门槛。foreground与真实trusted标签点击复核排除了未聚焦猜测：真实切换918ms，首RAF615ms、最新行769ms。失败及后续修复门禁分别保留，不将不同批次拼成一次49/49。

六尺寸×两主题的两个引擎最新24张主界面截图均已由主线程逐张查看；这证明相应页面快照的排版与视觉检查，不替代悬停可用性、物理手机或所有动态状态验收。正式Rust运行层和活跃Agent没有重启，也没有提交推送。

WebKit助手hover后续闭合：`message-footer-webkit-cssom-red.log`保留媒体与选择器均匹配但computed hidden的实际失败；仅限定助手fine+hover的展开规则转绿。`message-footer-webkit-final-green.log`4/4、25.4s，与`message-footer-chromium-final-green.log`4/4、21.3s，含真实hover与键盘focus-within、复制/分支/引用/侧边追问、原owner与另一输入草稿；`message-footer-focus-gate-unit-green.log`6/6验证原window-focus门控。headless WPE跨页bringToFront后原document始终hasFocus=true，实际失焦诊断留红，只由单测验证该门控，不虚构浏览器失焦成功。

长历史布局核对没有放宽500ms门槛。`perf-hotspot-diagnostic-webkit.log`的唯一CPU投影见证中，只挂载5行/258内部元素；历史纯JS投影约19ms，26次尺寸测量共239ms，其中四次mount布局分别49/65/62/63ms，不能将它们直接等同全部首帧等待。试验将mount改为stable ref收集、layoutEffect内先读全部高度再更新虚拟器，RO继续用supplied border box，移除行、隐藏零尺寸、更新期间新入队与异常清理的试验门禁为3文件11项。此批量策略单独实测949ms，不能宣称改善。随后pinned内容在绘制前同步定位，使首RAF即显示最新消息：`perf-layout-follow-webkit.log`711ms，只读viewport复核716ms/首RAF590ms；Radix内层实际为block，未按猜测改CSS。500ms仍红，性能验收未闭合。

底部真实正向220px滚轮不产生scroll事件、userScrolling保持true的新增判别用例曾在trial中得到348px离底样本；去掉这个guard后仍有391px瞬态，不能归因为guard单一根因。最后试验9项为7通过/2失败：半露出行增高又漂移600px，正向跟随391px；因此这两项试验生产代码都已按片段逆patch撤回，完整CodexThread与measure helper分别恢复152e3c93763b…/e46ec9bf4ca1…，所有原scroll guards、轮次分组和22px样式保留。试验代码只留在忽略的perf-mount-batch-source诊断目录，不冒充交付收益。

恢复原实现后，`scroll-original-baseline-webkit.log`的两项判别为半露出增长漂移0、正向跟随仍408px跨帧瞬态，明确区分试验600px回归与原RO→下一RAF跟随问题。RAF回调早于该帧RO递送，单个pre-RO样本不能当作已绘制屏幕；后续验收保留原样本，并对RO后的浏览器渲染阶段维持≤1px跟随标准，先在旧实现验证真实红灯，避免用等待或宽松阈值吞掉问题。

当前底部跟随修复没有保留试验batch或整段events同步跟随。只在现有observer中增加已挂载最后数字data-index行的观察，并按last key/数量/已挂载范围重绑：pinned正文/最后行尺寸递送同步使用实际有界scrollHeight定位，viewport仍RAF，detached立即退出。`scroll-positive-render-phase-red.log`在原实现用同一RAF→0任务阶段见证，RO后最大391px，阈值仍≤1；新定向WebKit两例13.2s全部通过，rawRAF391px仍原样记录、RO后0，半露出增长漂移0，页面/RO错误及Agent突变请求均为0。此为浏览器阶段证据，不宣称实体屏幕录制；该阶段方法没有额外等待另一帧，完整专项随后记录。

Chrome完整专项在同源码中另有8/9与positive的0任务样本348px：其JSON明确显示正文React提交发生在RAF和0任务之间，而新高度RO尚未递送；因此0任务不是跨引擎的RO完成保证，不将此测量方法误差当作已绘制产品失败。验收继续保留raw/timer双阶段，再新增最后行与thread-surface的实际native RO递送及回调后microtask几何；旧RO→下一RAF策略用同方法先红，当前版按真正递送阶段继续保持≤1px。产品源冻结，未为测试改变几何阈值、增加等待帧或改滚动实现。

实际递送见证的结果与0任务误差分别保留：旧RO→下一RAF块通过ignored Vite响应变换只影响测试页，未写产品源；WebKit旧块实际growth RO microtask最大391px红，Chrome旧块实际delivery0、1/1绿，不能制造Chrome旧块假红。当前版WebKit1/1、7.2s和Chrome1/1、5.2s均通过，最后行与surface的growth实际递送后几何为0；raw391与timer样本原样保留。初始delivery独立保存且排除，要求实际新高度增长超过200px，所有growth实际递送后仍≤1px，没有额外等待帧来吞掉偏移。当前生产CodexThread SHA7192d81ce57e…、measure helper精确基线e46ec9bf4ca1…；测试方法冻结后两引擎单批9项重新执行。

### 2026-10-10 13:10：滚动、间距最终专项验收

最后一行尺寸递送后的虚拟总高度提交还可能遗留17px尾部间隔。现有following observer标记pending resize，随后layout effect先清除标记，再仅在仍pinned时完成有界定位；卸载清除pending。没有把整段events改为同步跟随，也没有恢复已撤回的批量挂载试验。源码冻结为CodexThread `7192d81ce57e63fb8d9a395ad3ec1f911b30fd5b5fb6b9956d5a6544928bd324`，专项spec为 `f3f7eb4b7bd99c3d41082855e1f82413d4a52753827314dfc281e1406cb6d3a6`。

| 最终门禁 | 单批实际结果 | 说明 |
| --- | --- | --- |
| shared/Node/Web类型与生产构建 | `final-check-scroll-spacing-ro-accepted.log` 退出0，Web43.79s | 现有大chunk提示仍保留 |
| 最新相关单测 | `final-scroll-spacing-ro-units.log`，6文件33/33，5.14s | 轮次投影、虚拟测量、键盘边界、空行和助手入口门控 |
| Chromium滚动与阅读 | `scroll-actual-ro-chromium-final.log`，9/9，51.5s | 7项真实滚动和2项阅读/尺寸恢复 |
| WebKit滚动与阅读 | `scroll-actual-ro-webkit-final.log`，9/9，1.1min | 相同范围、独立实际引擎 |
| 助手操作栏 | `message-footer-{chromium,webkit}-final-green.log`，各4/4 | 桌面hover/键盘、手机44px、原owner及另一草稿保持 |
| 1500条缓存切换性能 | Chromium446.4ms通过；WebKit946ms未通过 | 保留500ms门槛，分别见`perf-pinned-ro-completion-{chromium,webkit}-final.log` |

最终两引擎的混合行接缝、半露出代码增长漂移、轮次折叠/恢复漂移及实际growth RO递送后离底距离均为0px。每引擎最多挂载9行，保存的6份RO诊断均无错误；阅读位置、未读与原会话草稿门禁保持。收据为`scroll-pinned-ro-final-receipt.json`，原RAF和0任务阶段数据完整保留。真实帧间隔P95分别66.6ms/136ms，不能据接缝为0宣称持续60fps。以上各批次独立列出，不把历史49项与后续专项拼成一次全量通过。

主线程逐张查看最终18张滚动/阅读PNG，包括两个引擎的1440/390阅读、触控板、底部增长、混合消息、滚动条、半露出代码、编辑器键盘和轮次生命周期。正式Rust运行层、Agent及Vite进程没有重启；WebKit长历史切换性能、实体设备和此前外部能力边界没有被宣布完成。

### 2026-10-10：当前源码收尾快照

在上述13:10快照之后只追加两处产品修复：CodexThread稳定 getItemKey 回调（SHA256 `97c94f383dc63768929068179dfed2ff345543c552f1358ab21bad3d81611c80`），以及公共AgentComposer在粗指针/隐藏模式下不发送被动Claude聚焦请求（`6726e8a50144bc38b378df86c23e6612087ae99e6b6ed68eda9dae9689c0c00d`）。Claude输入器和正文渲染器保持原文件；桌面和显式输入焦点保留。手机真实touch切换的原版浏览器红灯及粗指针/隐藏模式单测红灯均保留。

| 当前源码专项 | 单批实际结果 | 边界 |
| --- | --- | --- |
| 滚动与阅读，Chromium | `scroll-stable-key-chromium-final.log`，9/9，51.6s | 接缝、半露出行增长、轮次生命周期漂移和growth RO递送后离底均0px |
| 滚动与阅读，WebKit | `scroll-stable-key-webkit-final.log`，9/9，1.2min | 最多挂载9行；两引擎各6份RO诊断无错误 |
| 手机/混合Agent输入，Chromium | `mixed-agent-passive-focus-chromium-green.log`，7/7，47.3s | 手机两主题与桌面；逐会话文字/图片、慢上传、重试和刷新 |
| 手机/混合Agent输入，WebKit | `mixed-agent-passive-focus-webkit-green.log`，7/7，55.6s | 手机被动切标签不聚焦，桌面保留；不冒充实体手机软键盘 |
| 回调缓存专项 | `scroll-stable-key-units-final.log`，2文件7项；另实际TanStack模型3项 | 同实例/同rows1500行读key1521次，不用旧27000聚合样本推算总体速度收益 |
| 原包命令组件 | `command-summary-wrapper-aware-baseline.log`，2/2，16.4s | 原生Vx→FEi→CEi整体链、两主题rest/hover/leave/expanded，非只抽取图标primitive |

真实帧间隔P95当前Chromium50ms、WebKit139ms，P99为100ms/330ms；零接缝不能证明持续60fps。当前WebKit原生产实现1500条缓存切换为989ms，仍高于原500ms门槛（`perf-stable-key-webkit-final.log`）。最后一个只在忽略目录中的官方useFlushSync:false反事实为1023ms，无改善，没有写入产品；先前446.4ms的Chromium性能值属于7192源码，未冒充当前97c性能结果。没有降低门槛、缩小数据集或重试挑选绿灯。

当前62项核心保留功能的Chromium单批为56通过/6失败（`core-preservation-current-chromium.log`）。失败定位为测试仍假设完成轮次过程一直展开、旧文件API/旧React缓存路径和后台resume；测试改为实际展开工作摘要、当前workspace-files read/save、页面已挂载React依赖和后台只读turns/list/read。修正后的六项Chromium单批6/6、40.3s，WebKit先为5通过/1失败；剩余刷新边界及最后整仓检查以随后收尾回执为准，不将不同批次相加成虚构的62项全绿。

WebKit原in-flight刷新诊断中，3条Fetch/EventSource网络diagnostic发生在旧document卸载附近，requestfailed为Load request cancelled；两个document的真实window error和unhandledrejection见证均0，新document pageerrors为0，正文/状态/未读/原owner/阅读位置恢复断言全部执行通过。route.fulfill没有异常，不能说已证明测试路由race。已观察基线→整页刷新用例保持原strict errors=[]，定向WebKit1/1、13.5s通过；原in-flight诊断红灯仍保留，不过滤错误或将旧错误改成产品绿灯。

正式Rust进程和活跃Agent保持原样。运行二进制源码构建通过不等于正式服务已经启用新能力；实体设备、外部账户/版本不可用能力、全产品所有动态状态零像素差及WebKit500ms性能仍不是已完成验收项。

最后刷新门禁不再用网络quiescence来消掉边界，也不要求每次旧document网络拒绝都有requestfailed回执。永久用例记录真实两页init/pagehide/error/unhandledrejection以及全部原Playwright报告：两页JS异常严格0，新页pageerrors严格0；只有reload时间窗内、旧页pagehide成立、实际原生Fetch/EventSource类型且同源session URL的报告能归为旧导航diagnostic。原WK六项v2仍为5通过/1失败（过强取消回执要求），未重标为全绿；修正后 `core-fixture-status-document-final-webkit.log` 单项通过、12.3s，记录旧页原生EventSource报告1条、取消回执1条、新页错误0。该用例先前Chromium定向1项10.4s通过；最终改动仅移除旧页取消回执必需条件，未改变通用恢复和JS守卫。

最终相关单测 `final-current-scroll-focus-units.log` 为9文件42/42、7.36s。包含轮次/规模、键缓存、虚拟测量、空行、助手操作门控及公共输入区粗指针/隐藏模式/原owner焦点守卫。最后整仓构建结果以同目录 `final-current-scroll-focus-check.log` 为准，收尾收据记录相同生产源码和实际退出码。

最后 `pnpm check` 已退出0：shared、Node、Web类型检查和生产构建通过，Web构建44.04s；现有大chunk提示原样记录。完成后生产源hash仍为上述97c/6726，`git diff --check`退出0；分支main/HEAD7bf41319保持，`.env`仍被忽略、`.env.example`可提交。局域网HTTPS页面200，正式Rust PID540655和Vite PID2873879及其启动时间未变。没有提交推送或重启Agent。对应收尾收据为 `.dev-runtime/session-render-alignment/final-current-delivery-receipt.json`；仍未达标的WebKit500ms性能及外部/实体设备边界继续保留。

### 2026-10-10 15:17：正式新版Rust启用

用户明确要求启用新版Rust，随后明确保留云服务。云入口和API保持原实现：CloudTasksPanel及原测试已与修改前原文字节/SHA一致，Node云路由未改，没有新增拒绝规则或开关；取消开发的日志不列为交付门禁。

增量 `pnpm session:build` 退出0；备份运行身份、旧二进制和8份应用状态文件，SQLite一致性备份quick_check为ok。停止前核对本项目持久身份、健康实例、实际运行路径和PID归属；使用pidfd仅向旧Rust发送SIGTERM，旧Codex后代自然退出，没有对外部进程、tmux或zsh执行停止。新实例通过既有Node健康恢复入口启动，Node/Vite不重启，未并行运行同数据目录的两个Rust实例。

新正式PID79218、instance `51f8b176-fb55-4e19-82fb-24630c79a79b`，运行二进制SHA256 `cf60016abe5a49d8914144c596aaeffd9e908a55a60feadad5daf8f4a50626a6`；inode与磁盘一致。`pnpm session:status` ready且不再提示旧构建；网关health200并声明acpImages、codexOwnership、codexAccountMutationsV1。原生只读config/read、configRequirements/read、model/list、thread/loaded/list均200，模型目录返回5项。既有会话的最新一轮历史读取200、返回1轮，读取前后loaded线程数0，不resume/start/steer、不恢复执行或重发任务，也未执行真实账号cancel/logout。

应用项目、关注标签、队列、宿主伴随记录、设置和原终端会话文件与备份逐字节一致；仅runtime.json按设计更新。局域网HTTPS页面200，Vite PID2873879和启动时刻保持。旧列表第一页100条全部notLoaded只能证明该页状态；后续全量枚举超时，未将其说成全局无运行任务。升级中断风险在执行前已说明，不宣称旧Agent执行连续性。

实际备份及启用/只读/历史/状态回执位于被忽略的 `.dev-runtime/session-render-alignment/runtime-activation/`。正式启用不等于云端任务成功、原生搜索支持、实体手机或所有账户动作已验收；既有WebKit500ms性能和外部能力边界继续保留。

正式LAN无API夹具的Chromium1440/390两页只读冒烟完成，分别6.35s/3.95s：health均200并匹配新instance/账号capability；真实关注标签、输入区和云任务入口可见，独立新context没有选中目标，显示明确“开始一个会话”空态，历史加载提示0。console warning/error和pageerror均0；每页各保留一条health ERR_ABORTED原始记录，独立健康读取成功、页面正常，不过滤或重试挑绿。没有点击执行云任务、账号操作、消息、审批或接管。两张整页截图已由主线程实际查看，browser/context均关闭；此冒烟不冒充选中会话完整动态交互或实体手机测试。结果在 `.dev-runtime/session-render-alignment/formal-readonly-smoke/`。
