# Codex Diff / review 实施与证据

日期：2026-10-10。范围为本轮 P2/P3 的 Diff / review 子任务；本文不是 P0–P4 整项完成声明，也不代表逐像素验收通过。局域网产品地址为 `https://10.30.0.24:8484`（HTTPS）；只读原包参考为 `http://10.30.0.24:43831/native-markdown.html`（HTTP）。正式运行层、服务与真实 Agent 未重启；未提交或推送。

## 已落地的行为

- 保存的轮次变更继续固定 thread / turn / cwd 和原生批次，查看不读取当前 Git。原有权威 Undo/Reapply、flock、回执不明处理和 index 保护未改写。新增评论按固定所有者持久保存；只读 Git 审查快照的本地评论另以 digest 隔离。
- 原始 unified patch 的新增、删除、分离 hunk 行号和末行保持；Git C 引号、八进制 UTF-8、空格、百分号、冒号与重命名路径按 Git 语义解码，协议文件名以 literal 文件按钮打开，避免 Markdown / URL 二次解析。
- full-review、聊天 inline 和 hover preview 分别采用原包结构。保留文件预览和手机点击入口；完整 Diff 支持统一/并排、文件菜单、复制原 patch、旧/新片段、折叠、换行和自己的文件位置。二进制、文件模式与空文件变更有明确说明。复制被拒绝时显示失败，不能显示成功。
- gutter 点击、Shift 点击、鼠标拖选、Shift+方向键使用真实 old/new 坐标；跨未提供上下文的范围被拒绝。双击代码定位自己的项目和真实行号。评论可以保存、移除和加入自己的会话草稿，均不发送消息。手机并排评论跨两列，意见标题和文件位置换行分开显示。
- 实际 review 输出是 Markdown `::code-comment{...}` 指令。有效指令提取为 findings；代码围栏、缩进代码和无效指令保留原文。priority、path、start/end、重复项和安全整数受约束；正文使用现有 Codex Markdown。已完成 AgentMessage 的投影按 thread / turn / item / cwd 保存，虚拟化卸载不删除。
- review/start 请求在 await 前捕获 target / cwd，成功后记录实际 `reviewThreadId` 与 `turn.id`。审查结果可读取独立 `source:git-review`：未提交范围为 HEAD→读取时工作区（含暂存、未暂存和普通未跟踪文本）；基准分支为 merge-base→HEAD 已提交范围；提交为第一父提交→指定提交（根提交使用 root diff）。自定义指令不推断 Git 范围。UI 显示 target、resolved refs、读取时间、digest 和遗漏项，明确这是读取时 Git 快照；没有将其称作原生保存的本轮 patch，且无 Undo / stage / revert 按钮。
- findings 附着在新侧实际 end 行；不在此快照 hunk 内的意见单列说明。文件 reveal 和回复仍指向捕获的所有者；不会切换当前项目或修改其他草稿。
- 当前 Codex Git 使用实际 `/git/hunks/read|action`。后端自己生成 patch，并在跨进程 repository flock 内重新核对完整 digest、文件范围和 hunk 身份。支持逐块 stage / unstage / 明确确认后的 revert；客户端不能提交 patch、Git 参数或遍历路径。冲突拒绝写入；超时或不明回执不重复操作，只开放只读刷新。暂存块 revert 使用严格 `--index --reverse`，工作区与 index 不匹配时拒绝。Claude 保留原 DiffView。
- 当前 Git 的整文件 revert 始终显示确认范围；相同文件名组件复用于另一 cwd / section 时，旧确认关闭，不得确认新项目。此额外边界通过最后的独立红绿灯回归。
- 语法状态分别从 old/new 建立；逐词 diff、单行长度和语法输入均有预算，防止生成代码的最坏耗时。大于 1200 行的 Diff 使用虚拟列表。

## 验证

证据位于忽略目录 `.dev-runtime/session-render-alignment/`，保留早期失败记录。

| 验收 | 结果与证据 |
|---|---|
| 定向 Session 用例 | `review-scoped-final.log`：12 文件、34 用例通过；随后整文件确认隔离 `review-file-confirm-owner-red.log` → `review-file-confirm-owner-green.log`：2 用例通过 |
| 真实 Git / Fastify | `review-server-final.log`：9 用例通过。覆盖两个 hunk、并发实例、stale digest、确认范围、中文/空格/百分号/冒号、未跟踪文本、二进制/非法 UTF-8，以及 index 字节与后续改动保留 |
| 后端类型 | `review-server-types-final.log` 无错误，退出 0 |
| 前端类型 | 最后 `review-web-types-post-confirm.log` 无错误，退出 0；更早并行修改中的失败日志保留。整仓 gate 仍由主线程最终执行 |
| 真实 LAN E2E | `e2e-native-review-complete.log`：15/15 通过，1.7 分钟。1440/390px × 浅/深色各 4 个实际逐块 Git/评论/换行场景、4 个 base+commit 只读审查/findings 场景、6 个原包 full/inline/hover 几何对照和 1 个大 patch 场景 |
| Git 隔离与回执 | E2E 仅对临时 Git 目录请求实际 LAN 路由；不 stub hunk / review 成功。`review-mutation-scopes.json` 记录 stage、unstage、确认 revert 的 3 次真实动作。`readonly-review-responses.json` 记录实际 200 响应和 refs；无 review/start / hunk mutation 请求，index 字节、工作区和 status 不变 |
| 超大 patch | 最终 `large-patch-metrics.json`：50,000 行初次可见 92.9ms；33 行、236 个挂载元素；滚动可见第 50,000 行。无长行逐词计算 |
| 最后手机样式复验 | 目视完整 15-case 手机图后调整意见标题/文件位置堆叠；`e2e-native-review-mobile-finding-polish.log`：390px 浅色实际 base+commit 复验 1/1 通过 |
| 最后 summary / frame 增量 | `review-footer-green-final.log`：2 文件、10 用例通过；`review-footer-types-source-final-v2.log` 前端类型退出 0；`e2e-native-review-source-frame-final.log`：12/12 通过，含 6 个真实原包 Diff variant、2 个真实 UT footer 对照、1440/390px × 浅/深色 4 个临时 Git Undo/Reapply 场景 |

红绿灯另包括 `review-native-red/first-green`、`review-comments-store-red/green`、`review-git-hunks-red`、`review-git-hunks-route-red`、`review-git-bytes-red/green`、`review-git-hunks-client-red/green`、`review-syntax-sides-red/green`、`review-finding-indented-red/green`、`review-presentation-red/green`、`review-special-paths-red/green`、`review-inline-literal-red/green`、`review-target-store-red`、`review-git-target-red/green`、`review-finding-rich-red/green-third`、`review-empty-findings-red/green`、`review-selection-drag-red/green`、`review-hunk-action-placement-red/green`、`review-copy-rejection-red/green`、`review-meta-display-red/green-third`。较早 metadata 测试把 JSX `\n` 当成换行，修正为 JS 字符串表达式后通过；该错误记录未删除。

实际浏览器中意见、评论、base/commit Diff 和工作区动作的手机/桌面图均已查看。较早 E2E 的失败分别记录 fixture 背景 metadata 使用另一个 cwd、HMR 重复模块、调用 status 刷新测试自身 index 基线、选到手机抽屉后面的 backdrop，以及桌面 hunk 需真实 hover。修复 fixture / 操作步骤后才记最终通过；不将早期失败汇总成通过。

## 原包视觉、主题来源与未通过的像素 gate

full `bn`、inline `XC` 和 hover `YC` 均实际调用抽取的原包模块。完整原包依赖、provider、persisted-atom 消息和 builtin icon sprite 在只读 fixture 中运行；host shim 仅记录消息，不产生真实文件或 Agent 操作。提取产物与新增 export shim 位于忽略目录，原 VSIX assets 未改写。

三个 variant 分别测量，未将 full-review gutter 盲目套在 inline 上：实际都为 11px 代码、19.8px 行高，2 位行号 gutter 48.171875px，source 1ch padding；full 的 32px line-info 与 38px 文件 header 独立。六个几何 gate 对字体、字号、行高、gutter、源代码高度与起点通过；这不是全组件逐像素相等。

实际局部线程 primary caller 是 `thread-side-panel-tab-content-f69c91c28eb8.js` 的每文件 `Vo`，导入 `pull-request-code-review-6c0264558bf4.js.a` (`zr`)。`zr` 设置 full-review、line-info、wrap、richPreview 和 extension surface override，再经过 `code-diff` bn → Dn → K → Mt → `file-diff.D` → presentation.X。最后参考 fixture 直接渲染该 `zr`，不是只以 bn 近似 primary caller。`SettingsProbe` 实际调用原包设置 atom，响应原包 `get-settings`，记录 resolved light/darkCodeThemeId=`codex`、diffMarkerStyle=`color`。原 VSIX 文件未改写。

`file-diff.D` 虽然读取 selected codeThemeId，实际 diff theme R 使用 `code-theme-b9f8ff2360a8.js` 的 CODEX registration；另一 review-file-source-item/editor 使用 selected theme，不能混为同一 variant。`register-pierre-themes-864c25317d54.js` 覆写外表面 `--diffs-bg`，代码背景仍是 dark `#111111` / light `#ffffff`。**最初参考缺少完整 IDE Git token，已纠正**：`app-initial-961644ef2fa7.css` 设置 `--diffs-addition-color-override` / deletion override 为 `--color-codex-git-added` / deleted，extension provider 再映射到 IDE Git decoration token。因此变更 base 不是固定 Codex fallback `#00a240` / `#e02e2a`。最后同宿主参考提供 dark added `#81b88b`、deleted `#c74e39`、foreground `#ccc`、surface `#20211d`；light added `#587c0c`、deleted `#ad0707`、foreground `#3b3b3b`、surface white。完整字段与实际 resolved 设置均写入 `e2e-native-review-primary-host-corrected.log` 对应 JSON。

source 使用 Lab 混合 dark 80%背景 / light 88%，gutter dark 85% / light 91%；原包 word emphasis alpha dark .20 / light .15。浅色产品已采用这些原包公式，source / gutter 实测 removed `(251,228,222)` / `(252,235,230)`、added `(235,239,226)` / `(240,243,233)`，与同宿主 native 相同。暗色仍保留主线程批准的用户截图 source `(52,32,25)` / `(39,48,40)`、host foreground `#ccc` 和先前 word alpha .25，gutter 按批准宿主 base 的 Lab 公式映射为 `(47,32,26)` / `(37,44,37)`；当前原包同宿主、代码背景 `#111` 为 source `(51,30,25)` / `(38,46,39)`、gutter `(42,27,24)` / `(33,39,34)`、代码 foreground `#fcfcfc`。用户截图缺少 VSIX 版本、codeThemeId 和 provider metadata，不能断言属于另一个版本或称为逐像素一致。

有效 unified `XC` 路径无 scroll-fade class；`QC` 原始 code fallback 才使用 max-h-40 与 vertical-scroll-fade-mask，未把 fallback fade 加到 native unified Diff。字体由代码主题和 IDE font provider 继承，在同状态 fixture 中分别测量 full / inline / hover。

`review-native-pixel-mismatch-source-frame-final.json` 是最后完整 provider、实际 primary caller、DPR1、同数据图的量化记录。六个几何 gate 通过；整体颜色与像素 gate **未通过**，23,360 像素行区域结果如下：

| variant | 暗色差异像素，RGB MAE | 浅色差异像素，RGB MAE |
|---|---|---|
| full | 23,144；1.4909 | 22；0.0017 |
| inline | 23,143；1.4889 | 0；0 |
| hover | 23,091；1.5257 | 132；0.0682 |

浅色 inline 的该行区域逐像素一致；full / hover 的差异仅在外边框和角的抗锯齿区域，未声称完整组件像素一致。暗色保留批准截图颜色而产生上述 residual，不将几何通过解释为整项像素通过。`review-native-primary-host-pixel-mismatch-corrected.json` 和 `review-native-pixel-mismatch-after-glyph-corners.json` 是完整 provider 的早期校准记录，保留原数值；更早 `review-native-pixel-mismatch.json`（full dark MAE 7.8583、light 4.4517 等）遗漏 Git override，不能用它声称“同 IDE 完整 provider”比较。最后原包 6/6 几何复验通过；整项 gate 仍由主线程验收。

最后样式直接来自原包，而非按截图猜间距：number border-left 0 / border-right 2px；删除标记为 `linear-gradient(0deg,line 50%,token 50%)`，repeat size 为 `1lh / round(1lh / 2px)`；word emphasis radius 3px。实际 full primary `extension:rounded-lg` computed 为 12.5px，底部 `pb-0.5` 为 2px；inline 外层 radius 0；hover 外层 12.5px、内部 radius 0、foreground 8% oklab 边框。三者分别应用，不互相套用。`review-variant-corner-computed.json`、`visual-native-diff-word-metrics.log` 和 `visual-native-diff-marker-pseudo.log` 保留实际 source/computed 证据。

## 已保存轮次 summary / footer 的最后校准

实际原包 VT / UT 单文件 ResourceCard 只有 header，没有第二层重复文件行。产品现在使用同样的单层结构：header 64px、chip 40×40 / radius 12.5px、原 SVG 24×24、title 13px / 19.5px / weight 500、subtitle 18px、Git decoration stats；outer radius 12.5px、foreground 8% oklab 边框。多个文件保留原来有边界的滚动列表、每文件入口和撤销能力。IndividualFileChanges 的统计默认跟随原包 muted 活动色，hover 恢复 Git tokens，手机保留可点击控件。

单文件标题仍是自己的 literal 文件入口，桌面 hover 预览和手机 Eye 预览入口都可用；查看变更打开保存的完整 Diff，显式 Undo/Reapply 仍走权威原生批次。产品保留这些批准的额外控件与 44px 手机触控，title 可用宽度和整卡像素与原包有差异，未声称完全逐像素一致。行为红灯 `review-summary-single-red-v2.log` 复现重复 lowerRows；绿灯 `review-footer-green-final.log` 10/10。第一次 source 对照实测手机断点 header 68px → 调整垂直 padding 后 64px，失败 `e2e-footer-primary-reference.log` 保留。

`e2e-native-review-source-frame-final/` 含最后浅/深色原包 footer 和产品截图及 JSON；title 起点 (79,30.25)、字号、header64 和 lowerRows0 均通过。同 run 的四个 `saved-footer-*` 实际 workbench 图先等待 summary/title，再截图，防止较早仅等待 count=0 时拍到加载态。旧加载态图保留但不计为完成的 footer 视觉证据。实际 1440/390px 浅/深色完整保存审查、文件 hover/点击、Undo/Reapply、后续改动和 index 保留仍通过。

## 补充：受限原生只读适配

新增 config/read、configRequirements/read 和 thread/searchOccurrences 的 Rust REST 白名单适配，具体协议与全局配置不能授权项目的边界见 [session-native-readonly.md](../../session-native-readonly.md)。8 个新用例红→绿，完整 Rust web lib 54/54、cargo check/build 与最后前端类型通过。独立二进制的实际 HTTP 证明两份 native CLI 的配置读取 200、无效请求 400、search -32601→501；无成功 native 搜索命中声明，正式运行层启用待安全窗口。预先存在四个 runtime PID、loaded threads、rollout 字节与 writer lock 均未改变。此前没有把任意 RPC 或包含凭证的完整 config 暴露给浏览器。

## 限制与剩余边界

- 已保存原生 patch 只有原协议提供的上下文；未提供的行不从当前 Git 伪补成历史内容。完整历史文件展开、Pierre 所有 context-expand/selection gesture 细节与 model comment 全部交互还没有做逐项等价验收。
- 只读 Git review 是读取时快照，不是原生 reviewer 在其执行时确认的精确文件状态；UI 已明确说明。自定义 review 无可确定的 Git target；初始无 HEAD 仓库的 readonly target 路径尚未专门覆盖。二进制/非法 UTF-8/过大未跟踪文件列为遗漏，不伪造文本。
- 50k patch 为真实浏览器虚拟列表测试；没有宣称所有语言、任意十兆单行或所有浏览器性能等价。手机为 Playwright 的触控/移动 viewport，尚不是实体手机软键盘验收。
- checkpoint/history 恢复、fork、宿主文件桥与云能力由其他 owner 实施；不计入本文的完成声明。保存 patch 的权威变更回执沿用原先已验收实现。
- 整仓类型/构建/完整 Session suite、所有并行任务的最终综合 E2E 和上述像素差异仍需主线程最终验收。

### 最后增量校准与账号适配

独立视觉验收发现行号 glyph 向右偏移 1px，source 原位已最佳。先只对 number 子 span translateX(-1px)，`e2e-review-number-offset-lan.log` 6/6 通过、`review-number-offset-metrics.json` 两个行号 ROI 均 0；随后读到原包实际 border-left0 / right2px，使用该边框规则替代临时 translate，保持外层 gutter/source 不移动。word radius2→3、marker 的原生 fractional repeat、各 variant frame 的校准继续缩小上述 residual，仍不宣称整体通过。一次调用漏设 PLAYWRIGHT_SKIP_WEBSERVER，配置尝试启动自己的后端后被现有端口 EADDRINUSE 拒绝；失败日志保留，随后 LAN-only 复验通过，四个预先存在 runtime PID 完全相同。

账号取消/退出的受限 Rust 适配、运行实例与公开快照 stale-state guard、health V1 capability 和验证记录补入上述协议文档；10 个 auth 用例、完整 Rust web lib 64/64 与 check/build 通过。实际独立 HTTP 仅验证 capability 与拒绝，真实 native auth mutation 为 0，正式功能启用仍待安全窗口。
