# 模型菜单初次打开焦点对照（2026-10-16）

本轮保留 [NativeModelSelector](../../../apps/web/src/session-mode/components/codex/composer/NativeModelSelector.tsx) 产品实现，只补初次打开的原版观察与回归。原版四例已完成独立实际审计；产品新增八项单测在未修改实现时全部通过，不能称为 RED→GREEN 修复。根线程实际执行的产品正式 **16 项浏览器、四文件 57 项单测及 web 类型检查均通过**。

## 原版四例实际观察

参考为当前 `third_party/openai.chatgpt-26.51007.21434-linux-x64/extension`。四例分别使用全新隔离 HTTPS 页面，运行完整原 `hCa`、原 controller/editor、Router 和受限原 RPC；没有手工注册焦点 effect、改 menuView、调用 focus hook 或写 query cache 来制造就绪。Main 仅在 HTTP 响应末尾追加 62-byte 导出，磁盘官方包保持原字节。

三时点依次为：首次发现与 trigger 的 `aria-controls` 对应的菜单 DOM、两次真实 RAF 后、约 200ms 后。下表记录各时点的实际 `activeElement`，不把“首次 focusin”与最终采样混为一谈。

| Case | 实际开菜单输入 | 首次关联菜单 DOM | 两次 RAF 后 | 约 200ms 后 |
| --- | --- | --- | --- | --- |
| P | 左键点击 trigger 子 span | 菜单容器 | 菜单容器 | 菜单容器 |
| simpleEnter | Tab 到 trigger → Enter | Select model menuitem | 同左 | 同左 |
| simpleArrowDown | Tab 到 trigger → ArrowDown | Select model menuitem | 同左 | 同左 |
| naturalAdvancedEnter | Tab 到 trigger → Enter | radio 0，checked 为 radio 1 | 同左 | 同左 |

键盘三例的 trusted 事件账本均先出现短暂的**容器 focusin**，随后才到 Select model 或 radio 0。三时点结果不抹去这段过渡，也不证明采样间始终没有其他焦点。P 的真实 pointerdown target 是 trigger 内的 span，使用 contains 而非 target 必须等于 button 的条件确认入口。

前三例旧 driver 曾将 inactive advanced 面板中的三个 radio 计为 enabled。保存的 HTML 明确显示其祖先有 `aria-hidden="true" inert`，因此这些计数、checked 索引和 radio index **不作为活动 radio 证据**；simple 的活动 slider、实际 activeElement 和 trusted focusin 仍可独立核对。

naturalAdvancedEnter 使用修正后的祖先 hidden/inert/aria-hidden 过滤。实际目录顺序为 first／selected／third，selected 在 index 1，只有一个 medium effort；原 committed `lCa` props 为 `selectionMode=model`、`powerSelections.length=1`、`menuView=advanced`。活动 advanced 面板的三个 radio 均通过可见性检查，隐藏 simple slider 不计入 sliderCount。原选择器由合法 synthetic catalog 自然派生 advanced；三时点焦点都是未选中的 radio 0，**checked radio 1 不是焦点项**。这不声称真实账号目录存在该模型组合，也不推广到跨模型 preset 分支。

独立入口为忽略目录 [full-hca-initial-focus-execution-audit/README.md](../../../.dev-runtime/session-polish-round2-20261016/menus/full-hca-initial-focus-execution-audit/README.md)。其 `checks.json` 为 **141／141**，每例 15 个执行输入和 12 个官方来源输入均完成实际哈希核对；捕获的 hCa 与 Main UTF-16 code-unit 半开区间 `[5280001,5301359)` 完全相等，函数 SHA256 为 `7afd35ed0544abfe25e2e0b0a7d9bca19f07e72723dd73457787439584f988aa`。原结果分别保存在 `full-hca-initial-focus-step-{pointer,enter,down}-probe/` 与 `full-hca-initial-focus-active-advanced-probe/`，不能把观察结果直接计作产品 parity。

## 源码差别为何不要求新增 wasOpen

实际产品链路是 [Session DropdownMenu wrapper](../../../apps/web/src/session-mode/components/ui/dropdown-menu.tsx) → 本机 `@radix-ui/react-dropdown-menu` **2.1.16** → `react-menu` **2.1.16**；其 roving-focus 为 **1.1.11**、focus-scope 为 **1.1.7**，不能把 1.1.11 误写成 menu 版本。

Menu 在 document capture 阶段记录真实 keydown／pointerdown／pointermove。FocusScope 挂载时由 Menu 先 focus 容器；容器的 RovingFocusGroup `onFocus` 会**同步**派发 entry-focus。指针模式阻止进入菜单项，键盘模式则依次尝试 active、current 和启用项的集合顺序，focus 第一个成功项。因而调用 `contentRef.focus()` 不等于焦点最终停在容器。

原 hCa 静态 effect 通过 nullable ref 请求 simple slider 或 advanced checked 项；产品现有 effect 在普通打开时 RAF focus 容器，在已确认的键盘 view-toggle 时请求 checked enabled radio。仅比较这些静态 selector 会误判：原版实际初开并未落到 slider／checked 项，产品容器 focus 也可同步重新进入 Radix 的当前／首项。不能凭静态 RAF 推断实际覆盖顺序或最终焦点。

只读审查 [model-initial-focus-r16-read-review/findings.md](../../../.dev-runtime/session-polish-round2-20261016/menus/model-initial-focus-r16-read-review/findings.md) 保存 **19 个精确源码片段**、实际依赖解析、UTF-8／UTF-16 offset 和哈希。该审查当时 K3 尚未完成；本页 K3 结论以随后实际 active-advanced 执行及 141 项审计为准。

**决策：不新增 wasOpen，也不另建 opener modality refs／全局监听。** 新八项真实 Radix 基线测试已反证“现有 RAF 必然令键盘停容器”的推断，尚无需要产品状态修补的红灯。保留现有键盘／指针 view-toggle、owner／thread／visibility、layer identity、Escape 回原输入及 350ms reset 保护；不改模态锁或协议。若将来出现真实反例，须先复现再评审；不能将候选 wasOpen 方案当已实施修复。

## 验收状态与历史保留

| 验证 | 本文状态 |
| --- | --- |
| 原版四次 one-off 观察 | 已完成；独立实际审计 141／141，非产品测试 |
| 产品新增初焦点单测 | **8／8 基线通过**；主／展开 × pointer／Enter／Down，以及自然 advanced Enter，无产品改动 |
| 产品正式初焦点浏览器 | **16／16 通过，1.3 分钟，exit 0**；1440／390 × 主／展开 × 四种开法；`menus/initial-model-focus-r16/browser-run.log` |
| 四份模型菜单单测 | **4 文件／57 项通过，6.48 秒，exit 0**；`final-model-unit-corrected.log` |
| web 类型检查 | `pnpm --filter web exec tsc -p tsconfig.json` **通过，exit 0**；`final-web-typecheck.log` |

正式入口为 [NativeModelSelector.keyboard.test.tsx](../../../apps/web/src/session-mode/components/codex/composer/NativeModelSelector.keyboard.test.tsx) 与 [session-model-menu-initial-focus.spec.ts](../../../tests/e2e/session-model-menu-initial-focus.spec.ts)。新单测使用真实 Radix wrapper，未调用旧 helper 的 `caption.focus()` 掩盖初始焦点；允许 mock 模型数据和设置回调，核对未写模型／强度／服务等级、未发送且草稿保留。`menus/initial-model-focus-r16/initial-focus-unit-eight.log` 为 8 passed／21 skipped，4.34 秒；21 项是此次定向过滤之外的旧用例。最早名为 `initial-focus-unit-red.log` 的文件实际也是六项通过，名称不能作红灯证据。

产品浏览器使用绑定 `0.0.0.0` 的隔离 **HTTP `http://10.30.0.24:48865/`**，业务 API／WebSocket 均由 fixture 拦截。spec 从实际输入开始，经真实 Tab 或 pointer 打开，先保存三时点 JSON／事件／输入哈希再断言；Escape、展开页返回、草稿及另一 owner 设置和无业务写入等原断言全部通过。16 份实际 JSON 与截图位于 `menus/initial-model-focus-r16/run/`，不把前置 `ready.json` 当执行结果。每例保留 fixture 关闭 Vite WebSocket 的控制台诊断，不声称控制台零错误。

独立只读复算为同目录 `actual-verification/verification.json`，**826 项检查全部通过**：48 个实际焦点样本、256 组源码 before／after／current 哈希、16 次真实目录 POST 和 32 张 PNG 完整性／尺寸核对；业务写入、pageerrors 与截图错误均为 0。16 张初始菜单截图已逐张查看，菜单未越出视口或产生页面横向溢出。主输入实际 Tab 3 次、展开输入 2 次，P 不使用 Tab；K3 四例均首行 active 且 unchecked、第二行 checked。三次焦点采样仍可能处于入场动画中，不据其几何声明最终像素完全相等。

根线程第一次运行四文件时漏带 `--config vitest.session.config.ts`，Node 环境的 57 项均因 `document is not defined` 失败；原 `final-model-unit.log` 保留。这是测试命令错误，不是产品红灯。补上项目既有 session 配置后，四份正式测试全部通过，未修改产品或测试断言。

最终源码记录为 `round16-initial-focus-source-manifest.json`：2837 源文件、24 个 E2E／夹具、3 个基础设施输入及 72 个 shared 产物，共 **2936** 条；`round16-initial-focus-source-verification.json` 解释相对 R15 的新焦点测试和 motion 纯类型收窄。产品 selector 仍为 R15 的 `dc7e01054b7d8855ead2bd7ffd1578a301fe18b19d02c56aee2bfb250b523629`。2026-10-17 补正：R16 当时只证明 Goal 附件注册缺失，不能归因于并行删除或待用户回复；后续 [R29 实际验收](goal-attachment-registration-20261017.md) 已补齐接线。本页 R16 历史计数、正式运行层未启用及全量 510 文件测试的当时边界保持。

历史 `full-hca-initial-focus-enter-probe` 原结果仍为 **unknown、inputs=[]、observed=false**，原因是 `insufficient-window-with-cleanup-reserve`，不是一次已发 Enter 的产品失败。后续 driver 将每次 Tab 按 75ms 逐步重新准入，并保留原 4s one-read、500ms peer cleanup、15s Node cleanup 预算；active-panel 过滤也只修观察器。预算 unknown、观察器修正和后续新目录执行分别保留，不包装成产品 RED→GREEN。

四次原版执行的 HTTPS 与 Playwright WS 监听均已退出。独立审计仅核对创建时记录的 PID/start ticks：**28 个已证明归属的 PID 当前全部 absent，8 个精确端口均关闭**；没有按同 UID 扫描或清理其他进程。资源记录是有界完整浏览器进程树 RSS，不替代长期内存验收。原 query 仅消费明确声明的 synthetic zero-body 401；没有读取真实设置、账号／凭证或连接 native CLI／默认 IPC，也不声称完整 IDE、真实模型服务或物理手机验收。390 是同一 Chromium 的触控／视口模拟。
