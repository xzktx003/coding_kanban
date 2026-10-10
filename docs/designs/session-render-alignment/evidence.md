# 插件复刻：源码证据与功能差距

2026-10-09 只读核对。项目基线 `00c0674a37dc1dd2e095eec2cdf11c9be731e3aa`，工作区另有并行任务的未提交修改；结论来自当时实际文件，不代表基线 commit 单独内容。

## 参考身份

| 参考                                                       | 身份                                                                     | SHA256                                                             |
| ---------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `third_party/openai.chatgpt-26.51002.51308-linux-x64.vsix` | openai.chatgpt / Codex，26.51002.51308，VS Code ^1.96.2                  | `c5f534abf7dd1f08330483b5db6754001f2ad452096fc8e63925e597d3761373` |
| `third_party/ChatGPT.app/Contents/Resources/app.asar`      | openai-codex-electron，26.924.22138，build11645，bundle com.openai.codex | `d0ba973179d2f717affd39e012b64a095464a54a51c6bccb7bc6b3d2a1cfba80` |

ChatGPT.app 同时含 Codex 本地会话与 ChatGPT 云会话，不能仅根据目录名把其中所有功能算作插件功能。没有实际运行 macOS App。

原始解包及格式化审计副本在被忽略的 `.dev-runtime/session-render-alignment/`。行号引用格式化副本，不冒充原始 TypeScript；无可用 source maps。入口和函数/字面值锚点可在本地原包复核：

- VSIX `extension/webview/index.html` → `assets/index-16e77114425f.js` → `app-main-ed7bbec8573d.js`。
- 本地会话：`local-conversation-page-8a5061e966e3.js`、`local-conversation-thread-6b8a7f284834.js`、`local-conversation-turn-8d1d57382579.js`。
- 语义渲染：`sites-end-resource-39518ab206b4.js`、`split-items-into-render-groups-428a6e87827a.js`。
- 本机详细审计：`plugin-audit.md`、`app-audit.md`、`project-audit.md`。

## 用户截图的对应结构

本机参考图片 `b35a39764d76be9b563afa8a7d574ee5b598b622f6931c2a00e42d3e17fa0c8f.png`，1232×1752。

用户随后补发 `/tmp/coding-kanban-codex-image-nJehgO/f0ae3ddf-c169-442f-84aa-696a73f97ccf.png`。已使用图片工具读取，两份 SHA256 均为 `b35a39764d76be9b563afa8a7d574ee5b598b622f6931c2a00e42d3e17fa0c8f`，确定是同一参考图。

| 截图内容                                 | 插件证据                                                                                                                                         |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 无卡片边框的助手正文、行内 code pill     | Markdown `_MarkdownRoot_176oq_2`；local-conversation-turn 用户/助手分组                                                                          |
| 灰色工具摘要与命令行                     | `sites-end-resource-39518ab206b4.js:zx/Vx/cS`；`user-message-attachments-c8ee28a17401.js:an/Xt/on`；`tool-activity-disclosure-69ae50a6ddea.js:x` |
| 原始行号、语法色和逐词变化的 inline Diff | sites-end-resource `GC→YC→XC`；code-diff/file-diff-presentation                                                                                  |
| 上下文已自动压缩                         | sites-end-resource `tx/nx`，inProgress/interrupted/manual/automatic                                                                              |
| 输入区上方文件数与 +/− 查看变更          | sites-end-resource `VT/HT`；local-conversation-turn above-composer portal                                                                        |
| 底部原生输入框                           | `_ComposerLayoutRoot/Body/Footer_15oep_2`；共享 initial bundle/composer-entry/utility-bar                                                        |

图像包含宿主主题输出，未凭图像推断具体字体/DPR。最终标尺需要真实宿主参数。

## 精确样式来源

`app-initial-961644ef2fa7.css`、`app-initial-983230c36f03.css`、`user-message-f152e09d34c3.css`：

| 项目                        | 原生值或公式                                                        |
| --------------------------- | ------------------------------------------------------------------- |
| spacing                     | `.25rem`，16px 根字号时为4px                                        |
| 聊天字号                    | host UI font，默认回退13px；可由 chat.fontSize 覆盖                 |
| 聊天代码字号                | host editor font，默认回退12px；可由 chat.editor.fontSize 覆盖      |
| Markdown 行高/段落单位      | 字号×1.625；字号/4                                                  |
| 普通条目/聚合条目间距       | 16px / 4px                                                          |
| panel/toolbar gutter        | 12px / 16px                                                         |
| extension Markdown 局部 max | 40rem；不是整个 transcript 永远640px宽                              |
| Diff 字号/行高              | code字号−1px；Diff字号×1.8；行号 gutter至少4ch                      |
| 用户 bubble                 | 普通70%宽、radius22px；leading可100%；compact变体不同，按实际 props |
| 边框                        | foreground mix8%，heavy12%，light5%                                 |
| 表面/文字/链接/Diff/ANSI    | 分别映射完整 `--vscode-*` 宿主变量                                  |
| 动效                        | 150ms/300ms；reduced-motion；滚动渐隐有兼容回退                     |

不能拿 `composer-600fefacf772.js` 当主聊天输入框，它是讨论评论 textarea。主 composer 的 density/surface/radius/rows 等 data 属性决定实际尺寸，要先记录真实状态。

## 完整功能对照

“已有”仅表示存在产品能力，不表示当前视觉已经对齐。P0–P4 对应 [plan.md](plan.md)。

| 插件真实能力                                | 当前项目                                      | 本次工作与阶段                                                                                      |
| ------------------------------------------- | --------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 用户/助手 Markdown、GFM                     | 已有两套 renderer；助手带边框                 | 统一原生 presentation、spacing与消息操作 P1                                                         |
| 代码高亮/复制/换行/未闭合围栏               | 未完整配置聊天插件                            | 原生状态与复制规则 P1；不凭 SSR 判定 live复制按钮不存在                                             |
| 数学/Mermaid/表格复制和展开                 | 聊天未完整接入；文件预览不能代替              | 统一聊天实现 P1                                                                                     |
| 文件链接、行定位、上下文菜单                | 部分 renderer 支持；使用 global cwd、无精确行 | owner path/line/column context P0/P1                                                                |
| 来源引用和外链                              | 不完整                                        | 协议来源解析、有效跳转与外链策略 P1/P2                                                              |
| 流式正文与最终回复                          | 已有；探针复现全文丢失/重复 key               | 稳定 item 投影、phase、最终快照 P0                                                                  |
| 公开 reasoning summary                      | Rust及前端过滤                                | 仅放行公开摘要，原生折叠/状态 P0/P2                                                                 |
| 工具探索分组/折叠                           | 已有聚合                                      | 原生摘要/图标/交互/记忆展开 P2                                                                      |
| 命令实时输出、ANSI、耗时/exit               | 有完成聚合，实时 delta 未连接                 | 同 item live output，PTY输入受权限控制 P0/P2                                                        |
| MCP arguments/progress/results              | completed JSON为主                            | typed content[]、资源/媒体/raw、进度 P2                                                             |
| 网页搜索/来源/打开页面/页内查找             | 能启动搜索；缺专用结果UI                      | 类型化呈现与引用 P2                                                                                 |
| 图片查看/生成结果                           | 结果回退JSON；用户消息 plain img              | 相应语义UI、lightbox与操作 P2                                                                       |
| dynamic tool 结果                           | 缺专用UI；执行取决运行宿主                    | 已提供协议的结果 P2；真实provider P4                                                                |
| compaction/wait/hooks/模型reroute           | 类型/部分动作已有；专用UI不足                 | 不靠文字猜状态 P2                                                                                   |
| plan正文/提案/实施                          | PlanContentItem无人调用；进度已实现           | 正文delta与提案流程 P0/P2                                                                           |
| 同步请求/异步提问                           | 已实现，含恢复/自动展开/过期过滤              | 复刻视觉与导航，保留 request身份 P2                                                                 |
| exec/patch审批                              | 已实现，但重要上下文未展示/固定按钮           | command/cwd/network/policy/availableDecisions P2                                                    |
| requestPermissions/elicitation              | 已实现                                        | typed schema、校验、scope与原生布局 P2                                                              |
| inline Diff / turn changes /完整review      | 已有清单/面板；聊天Diff重算行号               | 原始hunks、syntax、worddiff、统一/分栏 P2                                                           |
| Diff选择/注释/stage/unstage/revert          | 不完整；右侧Git能力需复用                     | perfile/hunk真实Git操作与finding定位 P2/P3                                                          |
| Undo/Reapply/检查点restore                  | 有撤销与rollback；不是同一能力                | 历史 patch 重放 P3；实际 checkpoint 属云 Page bootstrap，不是本地 thread/files 恢复，见下方启用边界 |
| 最后用户消息编辑                            | 已有                                          | 原生外观/IME/最后消息范围 P1                                                                        |
| assistant copy/引用/侧聊                    | 已有                                          | 状态/hover/focus/触控对齐 P1                                                                        |
| whole fork/指定轮fork                       | 整会话已有；历史轮选点不足                    | 真实原生指定轮分支 P3                                                                               |
| 会话内搜索/用户消息导航 rail                | 未发现对应实现                                | 虚拟列表搜索定位 P3                                                                                 |
| Markdown导出/会话链接/路径复制              | 未发现完整等效工作流                          | 可携带会话URL与干净文本导出 P3                                                                      |
| composer/file/skill/plugin mentions         | 已有                                          | 主composer精确布局、真实上下文 P1/P4                                                                |
| 当前编辑器文件/选区自动上下文               | 自带编辑器选区已有；iframe桥缺失              | 来源校验的VSCodeWeb bridge P4                                                                       |
| 图片相册/上传/paste/移除/标注/恢复          | 已有                                          | 保留owner+revision与左图；补桌面drop P1                                                             |
| 长粘贴为上下文/展开编辑                     | 展开编辑已有；粘贴策略待齐                    | 不截断内容；真实上下文保存 P1/P3                                                                    |
| model/effort/permission/mode/context        | 已有，逐thread隔离                            | 原生视觉、reroute区分、snapshot不变 P1/P2                                                           |
| queue/steer/interrupt、编辑/暂停/重试       | 已有                                          | 原生快捷键/状态/菜单，exactly-once P1/P3                                                            |
| 三种 Enter 设置/一次性切queue/steer         | 中文IME/Enter部分已有                         | 原生设置与快捷键 P1/P3                                                                              |
| review changes/base/commit/custom           | 已有                                          | inline/detached结果与finding闭环 P3                                                                 |
| 子Agent tree/状态/观察/允许输入/审批        | 已有                                          | 复刻呈现，保留本项目观察与权限 P2/P3                                                                |
| skills/plugins/MCP/AGENTS配置               | 已有部分页面                                  | native推荐/安装/配置闭环 P3/P4                                                                      |
| CodeLens TODO、可选LSP MCP                  | 未发现等效宿主桥                              | VSCodeWeb companion桥/可选socket服务 P4                                                             |
| branch/Git宿主操作                          | 有Git工具，需逐动作完整适配                   | 真实目录与变更操作 P4                                                                               |
| 旧Codex云task/environment/local→cloud       | 未发现完整链路                                | 账号/HTTP/snapshot/任务与结果真实服务 P4                                                            |
| microphone composer dictation               | 有浏览器fallback                              | 原生视觉与浏览器音频实际可用性 P1/P4                                                                |
| limits/account/error/notifications/settings | 部分已有                                      | 真实capability与错误、设置一致 P4                                                                   |
| 背景terminal/output面板                     | 已有自带终端                                  | 真实执行身份映射与原生展开 P2/P4                                                                    |
| 本地history/read-only/retry/恢复            | 已有                                          | 视觉对齐，保留只读回补/缓存/阅读位置 P0–P3                                                          |

## 插件宿主能力核实

不把共享 bundle 中出现的字符串直接当成已启用功能。

- capability：`app-initial-3192ac99b6cd.js:eHt/$Vt`，`XVt` 对父子 supportedClients 求交，`tHt/Bw` 核验 extension 和账号/config门槛。
- host：`out/extension.js:eL.handlers` 实际实现 IDEContext、find/read/pick-files、Git/apply-patch、skills/AGENTS、HTTP/account、queue locks、show-diff/show-plan-summary、snapshot准备/上传等。
- legacy云任务：`cloud-Iwa` 快照准备→申请上传→上传→校验；`cloud-yor/wor` 新任务/续聊 `/wham/tasks`；`cloud-lor` 环境列表；列表受 ChatGPT登录方式限制。静态路径不证明当前账号可用，实施须真实联调。
- 可选LSP：`useExperimentalLspMcpServer` 默认false；开启后 `codex-lsp-mcp` + `stdio-to-uds`。不能宣称所有账号或项目自动提供。

**此构建明确关闭或host为空，不列为“插件有而我们没有”的必补项：**

- MCP Apps 富widget：local-conversation-thread `enable_mcp_apps && Li()`，`Li→KOt→QO(){return false}`。普通MCP结果/表单仍支持。
- realtime voice（父 voice只支持electron）、嵌入式浏览器、global dictation、新Work云编排、local/cloud automations。
- app-managed worktree创建/删除/owner、remote SSH管理、projectless cwd、SFTP、内部artifact write/save、原生system apps/computer capture。
- Google文档/表格/演示、appgen和其他ChatGPT云专属surface，没有真实extension启用证据。

本项目已存在的scheduler、自由分屏、文件编辑、worktree等特色不因此删除；只是不能把它们说成复刻插件缺失项。

## 已执行的复现证据

探针（不发送、不审批、不resume真实Agent）直接调用当前项目 `compactDeltaEvents/buildThreadRows`：

```text
delta("first") → tokenUsage更新 → delta(" second")
→ completed("first second FINAL")
实际：2条正文行，只有1个唯一key event-turn-a；FINAL不在渲染正文。
```

入口：`components/codex/stores/eventUtils.ts`、`components/codex/thread/threadRows.ts`。`mergeThreadHistory` 既有迟到历史保护必须保留。

另外裸 Streamdown 静态输出未包含 KaTeX/语法色；SSR 无复制按钮不等于浏览器懒渲染后没有复制按钮，本方案没有以此作缺失结论。

公开summary过滤证据：`packages/session-runtime/crates/codex/src/app_server.rs` + `EventItem.tsx`；plan无人调用：`items/PlanContentItem.tsx`；审批完整参数在 bindings `CommandExecutionRequestApprovalParams`；Diff 行号问题在聊天 `DiffViewer`，右侧Git已保留hunk，不一概说全项目都错误。

完整审计只写入忽略的研究目录。本阶段没有执行产品完整测试、原生云任务或原生macOS应用，后续验收必须分别记录。

## 2026-10-09 原包主题与浏览器对照补证

原Markdown与approvalRequestCard已补齐AppScope/QueryClient/Intl并运行；中文文案直接核对zh-CN-b05cfd55c534.js。默认语法主题由code-theme-b9f8ff2360a8.js注册CODEX，原资产codex-dark-5fb95d1c65ca.js/codex-light-53d4e35e1869.js各245条TextMate规则；不是Monokai。源资产SHA与复制说明见apps/web/src/session-mode/components/codex/presentation/themes/README.md。实际围栏数字暗色#6DCBF4/浅色#0071EA已做浏览器断言。

用户参考截图常见背景取样：主表面#20211d、行内code#3e3e36、Diff context#282a23、删除行#342019、添加行#273028。原图存在压缩/采样邻近值，取样不等于全部宿主变量或字体/DPR已冻结。逐状态整页像素对照仍未完成。

## 执行命令原包基线补充

`command-row` 是快捷键设置行，不能当作 shell renderer。真实执行行是 sites-end-resource 的 `Vx`，默认 collapsed；完成摘要包含命令与实际耗时，展开后用通用摘要，body 为 user-message-attachments 的 `an`/`Xt` 与 `on` footer。原包执行体已在只读 webview harness 运行（RouteScope/ThreadScope/ResizeObserverProvider齐备），并记录 collapsed/expanded截图和metrics；不是仅凭函数名推测。原生块保留紧凑 shell 名（例如zsh）、两行命令展开、最高144px的反向滚动输出、独立复制和右下角 Success/Exit code/Stopped；缺失退出码为unknown，低于1秒不显示耗时。ANSI使用安全React文本与native类名，不执行OSC/HTML。

这些产物位于被忽略的 `.dev-runtime/session-render-alignment/native-command-{collapsed,expanded}.png`、`native-command-metrics.json`；harness限本机原包和只读fixture，未连接或执行用户Agent。完整宿主变量、活动分组和原生PTY后台状态仍属后续全量验收。

命令开始时间已核对生成的`ItemStartedNotification.startedAtMs`；完成通知只有`completedAtMs`，因此不把打开页面的时间或完成时间伪装成开始。已接入每秒呈现计时、前台恢复和原生最终durationMs，红绿灯与四端浏览器场景验证。

## 探索行与活动分组原包补证（2026-10-10）

原包 `sites-end-resource` 的 `nS/Wx/Zx` 分别为读取/搜索/列目录行：13px、19.5px；`Bx` 子内容为foreground 30%（oklab），动词为descriptionForeground 90%，文件链接dotted 0.5px、underline-offset 2px。read链接使用协议literal path，而Markdown href可带URL编码/行号，两者不能共用解码和suffix剥离。`i_` 的book-open/search/folder SVG已从原组件取出，`NativeExplorationIcons`记录版本。四语言文案来自原包字典/英文defaultMessage，动态文件名和查询以React文字节点承接，不交给翻译标签解析。

`inline-followup-markdown` 的 `P/F` 保留连续活动及稳定item身份；`Je`解包单个完成项；`Ye`根据最新slice/turn/探索状态选择active/thinking/summary。`Ue/ke/Ae`聚合探索与命令，不显示旧的数字计数。`cD` body为max-h-56（224px）、gap-1（4px）、scroll fade；`bD`在活动body隐藏未完成普通read/search/list，待完成动作由active header显示；没有可展开body时原生`canExpand`为false。当前阶段只改连续command切片与探索行，完整混合活动/skill read、thinking/header切换与`canExpand`语义仍须进一步接入，不把该阶段宣称成完整activity group移植。

真实 `nS/Wx/Zx` 通过同一只读原包harness运行，两主题与产品逐字段核对文字、font、行高、link矩形/颜色/下划线、child/verb颜色。616×400、DPR1截图的RGB差异为深色8像素/浅色10像素，局限文件名字形；测量与截图见 `native-exploration-pixel-check.json` 和 `e2e-exploration-regression`。这里的宿主参数覆盖这些行的对照，未宣称所有宿主变量/整页DPR基线已完成。

## 完整 Markdown 与启用边界补证（2026-10-10）

早期仅运行普通段落组件的证据不能代表围栏和表格。独立视觉验收补齐真实 PersistedStateProvider，保持同一 root component 身份并只替换 children，运行实际 Markdown 的代码/表格路径；没有修改原 VSIX 资产。CDP CSS.getPlatformFontsForNode 显示原生与产品中文正文同为 WenQuanYi Zen Hei，截图中的字体观感不构成替换字体证据。

真实原生围栏采用 language 图标/title、wrap/copy、12px/20px 代码，没有默认行号；三行测得外框约 122px。真实 table 没有额外外框/斑马背景/顶栏，主要为横分隔与按需复制。产品此前仍继承 Streamdown 默认大标题栏、行号和 table toolbar；独立原包整组件对照发现后正在调整，不以旧普通段落对照宣称全部 Markdown 完全一致。

代码背景先后复现两项真实覆盖问题：Shiki 的多主题 bg/fg 串供 HTML writer 使用，直接放入 React custom property 不是合法颜色；另有现存全局 Prism 的 language-pre `!important` 将 Codex 围栏覆盖为 Monokai/Solarized。修复限定 Codex 围栏，Claude 原 renderer/配色不更换，最终实际浏览器两主题复验另记实施记录。

checkpoint 主证据为 `checkpoint-bd48a816eff8.js:9–30`、`checkpoint-preview-f412d8448c39.js` 与格式化 `checkpoint-674a40799147.js`：云 Page `/pages/{page_id}/versions/{checkpoint_id}/checkpoint-bootstrap` 校验 PageId、checkpointId、expiry并投影 PageDocumentTheme。不能从该构建包含这个 chunk 推断本地 Codex thread 支持文件检查点。没有添加虚构历史书签/全局 Git restore 充当该功能；本地历史 rollback 与真实保存 patch 的 Undo/Reapply 继续分别验收。

## 原生 Markdown 最终参考校正（2026-10-10）

直接运行完整原生 Markdown wrapper 后确认：普通代码围栏使用 highlight.js 11.11.1，Diff 才使用 CODEX Light/Dark TextMate 规则。此前将围栏与 Diff 共用 Shiki 的阶段判断已被实际执行证据修正。围栏 header 48px、12px/20px 代码、20px 圆角、无行号；表格 12px、原生单元格 padding 与 hover copy；h1–h6、列表、引用、分隔线及 inline code 的实际尺寸均已逐项比较。四种 profile 原包/产品 token class/text/RGB 和 SVG 门禁见 visual-acceptance.md，不能把阶段性主题取样当成整页像素一致。

## 完成摘要的来源与中文规则（2026-10-10）

实际原组件的 11 个完成摘要场景确认：中文 Intl plural 为 other，unit 列表无分隔；1/2 文件和命令都可显示“编辑了文件读取文件运行了命令”，不能为美观自行补数字或标点。普通 MCP 则不同：非空 server 必须聚合成命名 integration；`fixture/lookup` 的混合摘要为“已使用 Fixture 集成编辑了多个文件读取文件运行了命令”，空来源才使用未命名工具句。成功与失败的普通 MCP 都按来源展示，不据此宣称执行成功。

原包 Ue/ze 按 source.key 计数、首次顺序和最新公开 metadata 聚合；je 对实际 logo/plugin 来源优先，u\_ 再按显示名去重并使用 conjunction 列表。带真实 Lt 描述符的 MCP 与 dynamicToolCall 放在同一个有序去重集合，不重新归入普通来源；node_repl/cua_repl 计作命令。专用 cloud_threads.read 失败必须使用失败文案，foreign 同名调用不能获得原生专用能力。

取证脚本及原输入保存在忽略目录 `review/native-completed-summary-audit.cjs`、`native-completed-summary-final-audit.json` 和 `native-completed-summary-source-excerpts.txt`。纯 helper 额外有 30 个真实原包 Ogt/Lt/Ue 分支 oracle；主产品 NativeActivityGroup、item/owner 投影和实际 LAN 对照另行测试，未用纯函数通过代替完整 UI。
