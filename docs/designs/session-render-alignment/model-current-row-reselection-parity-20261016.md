# 当前原生模型行的只读重选（2026-10-16）

普通 OpenAI 模型菜单重选已经选中的行时，只切回简洁视图，不重新写入推理强度或清理服务档位。本项用真实 hook／缓存／store／Radix 单测及完整页面的主／展开输入先红后绿；跨模型 presets、Default／FI、账号策略与原生协议能力仍分别验收。

## 原版合同与局部修复

参考为仓库当前 VSIX `26.51007.21434` 的 `app-initial-fee819fe4f22.js`（SHA `460201045b5f5a4255fda737c9baa4768367a973d735cb37f3467bfe6af95316`），`ssa` 的真实 `PR.Item.onSelect` 在 selected 且非 locked 时跳过 `e.onSelect()`，随后请求 simple。原跨度及 UTF-8／UTF-16／codepoint 位置保存在 `model-current-row-null-r27-red-preparation/official-surface-row-supplement.json`。`lCa` 同模型短路、`Rn` 设置 FI 属于下层保护，不能误称已选行必然调用它们。这里没有运行该原组件的新 GUI 场景，也不以静态片段冒充认证宿主验收。

旧 `NativeModelSelector.choose` 虽已跳过同 id 的 `setModel`，仍对 raw null 推导目录 default high，随后写 effort；saved fast 未在目录广告时还会清成 null。这会无故增加 revision、设置 pending，并让显示从中变高。

现在仅在 `modelProvider === "openai" && id === settings.model` 时令 next effort 为 undefined，并跳过该行的 tier 清理。模型 id 精确比较、不同目标的 default／tier 策略、generic／custom、目录及 helper／hook／store 均保持；视图、焦点和最近使用记录的流程代码逐字保留。原始 alias 不迁移，不将其当 canonical 当前行。raw null 仍由既有显示层派生；本反例目录含 medium，trigger 与简洁菜单均显示中，其它目录的 TX fallback 不变。

最近使用是本项目已有扩展。本项保留插入／去重流程，但不能声称 payload 全不变：同项 raw null 时，effort 随 next 的变化从旧 default high 变回 raw null，相应去重键可能变化；不从原版 selected-row 合同推导原版 recent 行为。新草稿初始化不在 diff 内，原 selected-row skip 不依赖 conversationId；新增六例主要覆盖已有线程，不把 null-owner 焦点用例算作真实新草稿设置验收。

唯一产品文件为 `apps/web/src/session-mode/components/codex/composer/NativeModelSelector.tsx`，修复前 SHA `8d1be08c49b9f265db655dc73b7d50060f57c674507ab8780a4e587134b4a73d`，修复后为独立审过的 v2 `85d3d7cd19a8cc985564bbc5f50b2cecc28a72aabdb6312bf0ff900db0797d16`。准备包 v1 未应用。

## 红绿灯与回归

| 范围 | 实际旧实现 | 实际修复后 |
| --- | --- | --- |
| 新6＋原 canonical12 单测 | 3失败／15通过，4.60s | 同字节18通过，4.56s |
| 相关28文件 | — | 394通过，49.02s |
| 新1440／390 × 主／真实展开 | 4失败，wrapper34.7445s | 同字节4通过，Playwright28.1s／wrapper29.6268s |
| web 类型 | 退出0 | 退出0，26.1286s |
| E2E 类型（含原 canonical spec） | 最初新spec及边界措辞版均退出0 | 最终两spec退出0，2.0643s |
| web 生产构建 | — | 退出0，72.5165s；含 shared 构建、web 类型及 Vite43.92s |
| 原模型身份6场景 | R25历史另存 | 原spec不改字节，另批6通过，Playwright40.8s／wrapper42.4537s；不合称单批10 |

新单测真实读取四个 API，保留真实 hook、缓存、store、Trigger 和 Radix；只 fixture 四个读 IO，不 mock choose、helper、readiness 或权限。两个 null 用例分别为主／展开结构；第三个 RED 用 supported medium 隔离 saved fast 的意外清理。三个新对照分别保护 supported medium 同项、不同项采用广告 default、不同项清掉未广告 fast；原十二例保护 canonical／alias／generic 与目标 tier 规则。初次22个 soft 失败是这三个用例的重复状态投影，不是22个独立 bug；所有 mount／open、A其它字段、B／默认值／自定义目录／草稿、原目录引用、四读及零 submit／fetch 硬保护均先完成。

浏览器使用现有真实前端及完整 Composer／ComposerSheet，只在输入前初始 seed／initialize；之后通过真实鼠标、Escape 和返回按钮操作，不重新 hydrate、调用 loader 或直调 chooser。每例保存 baseline、closed-before、opened-simple、advanced-current-checked、selected-current、menu-escaped、final-closed、finally 八状态。旧四例各25个末尾 soft 差异均为 null→high、revision4→5、pending false→true 及显示变化；其它归属、草稿、原 entry 不可变、目录、受信单次行点击、菜单仍开／返回简洁视图、Escape／Sheet 返回焦点、原主编辑器节点身份等硬控制全部完成。修复后同四例全部通过，entry 仍为原引用／null／revision4／pending false。

新增只读 probe 读取六个已经挂载的模块，上限64次，没有订阅或业务 setter，退出清空捕获引用并释放 handle。严格保护 B／默认／custom／文本草稿／缓存身份和值及目录 array／record／effort 引用；真实展开只允许 v2.expanded false→true→false，contexts／drawings 及其它 owner 数据保持。四目录请求均各一次、method／body精确匹配，业务写入／外网／pageerror／submit／cleanup error 均为零，自有 SSE 全部满足关闭契约。每例仍保留一条特定 fixture Vite HMR 连接 console 诊断，不称零 console；这是本地合成目录与 HTTP/EventSource 页面验收，不是原生 settings RPC 写入验收。

正式浏览器测试 SHA 为 `052ddd7c25f2adeec9473e297d7f682c9251e2f56e1552e95bf6c40f92bed07a`，旧四红与新四绿完全相同。正式化先去两条准备注释，再仅澄清输出 boundary 字面量：UI 会改变本地设置正是反例，排除的仅是真实账号／目录／native RPC／SDK 与实机主张。该字面量修正发生在第一次真实 RED 前，动作／断言不变。新单测 SHA `3df193e43530d86a75d0afb0012a6988c3d4feee814aae94bdd0de8f02d63330` 在两轮18例及最终394例间不变。

每次命令独立核对 before／after／HEAD。初次单位阶段为2988输入，新增浏览器后为2989；它们涵盖四源码根、选定 E2E、infra 和72份 shared 产物，不冒称整个 E2E 树冻结。原六例加入 config.testMatch／E2E类型 files 时只扩大测试入口，没有改 product／新spec，相关版本收据分别保存。构建保留既有动态／静态 import 和大 chunk 警告。四张最终 selected-current-simple 实际截图已由 root 查看。

## 证据与运行边界

产品前端为 **HTTP `http://10.30.0.24:48865/`**，实际绑定 `0.0.0.0:48865`，PID1238668／start100386858；预检 HTTP200。手机为390×844浏览器触控模拟，未验证实体同网段设备。正式运行层 PID2712539／start55361120 保留，磁盘新产物未激活，没有停止 Agent、重启服务、复制登录或连接默认 CLI IPC；本轮 `pnpm session:status` 退出0，再次明确运行进程与磁盘产物不同，保留现有任务。

原始日志、before／after 快照、两阶段 JSON／PNG、分类、精确 promotion diff 和冻结副本位于忽略目录 `.dev-runtime/session-polish-round2-20261016/model-current-row-null-r27-root/`。`unit-old-product-red-v1-classification.json`、`browser-old-product-red-v1-classification.json` 保留最初真正红灯；没有夹具／导入／就绪失败被计作产品红灯。产品静态独立审查 seal 为 `2a1dd52c…`，browser静态审查为 `c2092184…`；后者结束时的 Selector 8d1be→85d3 版本过渡单列，不误写成旧产品执行期间漂移。最终独立收尾保存在同级 `model-current-row-null-r27-postimplementation-review/`，结论以最终 root seal 与 root 外的 release 收据为准，不把预核当作终审或执行。

本项不关闭真实账号／managed／locked／ultra/auto-review、原生跨客户端 CAS、Goal 附件注册归属、cross-model presets／Default／FI、完整原 GUI、物理设备、当前版本长期RSS或正式运行层激活。R25与R26封存证据保持独立、不可重写；整个 Goal 继续进行。

2026-10-17 后续 R29 已补不同模型行的bt继承：raw null／当前不支持的max选择支持medium的目标时明确保存medium。本记录的6个unit／4个browser原字节保留，随新4／8项完成真实红→绿；same-current、tier、revision保护继续。见 [不同模型行验收](model-changed-row-display-effort-20261017.md)。
