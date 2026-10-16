# 会话复制动作的 HTTP 与回执验收（2026-10-16）

本批接续 [会话模式对照](session-polish-acceptance-20261016.md)，修复当前网页入口可达的 13 处直接 Clipboard API 遗漏。产品前端为绑定 `0.0.0.0` 的 **HTTP `http://10.30.0.24:48865/`**；所有 API／WebSocket 使用自有 fixture，不向正式 Agent 发送任务，不读取认证或设备 Token。

## 范围和行为

| 入口 | 本批修复 |
| --- | --- |
| 当前会话菜单四项 | 完整保留最后代码块、工作目录、对话路径和页面链接的既有来源及提示；实际成功后才提示成功 |
| Codex／CC 会话 ID、自动化运行 ID | HTTP 回退、失败明确反馈，捕获原 ID；不选择、恢复、运行或中断任务 |
| MCP 资源链接 | 复制原 URI，不打开、解析或请求资源；错误沿用本地化通知 |
| 待办 Copy／Copy as list | 成功且目标 ID 集合与原文仍一致才调用该次原完成回调；原文、换行和列表前缀保持 |
| CC 通用消息复制、网页工作台地址 | 回退、单次在途与可见错误；保留立即 blur／原两秒，以及地址原 1.5 秒反馈 |
| 项目详情路径 | 明确复制事件载荷，失败保留原手工复制提示；不触发定位项目或导航 |

待办选择重排但 ID／原文未变时继续使用原回调；改 ID、编辑同一待办正文或卸载会撤销旧完成回执，保留新选择状态。新目标可显式复制，旧结果不能解锁或完成新操作。版本比较仅在已挂载组件内保留 ID→原文字段引用，不向 pending observer 传递正文，也不新增 store／历史缓存。

自动化运行行另有确定的键盘缺陷：Copy ID 的 Enter／Space 冒泡进入父行 `onOpenRun`。父行现在只处理自己持有的键盘事件；子复制不打开任务，父行本身的键盘入口保留。这三个反例（含同 ID 改原文）为 3 红／4 控制绿后修复，记录在 `batch12-version-keyboard-*`。

所有路径复用既有 `writeNativeMarkdownClipboard`／`useNativeCopyFeedback`；现代 API 返回原 Promise，拒绝明确提示，不自动重试。非安全 HTTP 缺 API 时使用现有 legacy transport 并在原始 `copy` 事件中设置载荷、恢复焦点／选区。没有修改全局终端复制 helper、权限或官方包。等待回调通过模块级函数、空 token 与可撤销 controller 隔离来源，换代／卸载释放原回调与 React 引用。

原 16 处直接调用中，另三处为当前未消费的 `LocalStorageDialog`、生产调用未进入的 `ProjectNavigationButton` 非 global／compact 分支，以及 Tauri 专用 Homebrew 更新。本批未激活或修改这些入口；不能据本批声称所有桌面能力已验收。完整只读入口链为忽略目录 `clipboard-inventory/inventory.{md,json}`，不是逐入口浏览器实测。

## 模态菜单中的真实复制红灯

最初真实组件单测只检查 legacy 临时 textarea 的输入／选区，以及 `execCommand=true`；这不足以证明菜单内复制有效。实际浏览器在 390／1440px 两次复现：Common 原生适配复制后，同页真实 Ctrl+V 得到完整消息；复制网页 URL 也正确；再复制项目路径时，模态焦点被保留在 DIV，事件数据为空、未阻止默认行为，真正 Ctrl+V 仍得到上一次 URL。

这两例没有替换 Clipboard API、`execCommand` 或 copy／paste 命令，页面错误与执行请求为空。它们证明该私有 Chromium 内部的真实粘贴，不外推为外部应用或物理设备验收。原始结果为 `.dev-runtime/session-polish-round2-20261016/clipboard-browser-first/**/component-http-copy.json`，摘要为 `clipboard-inventory/browser-modal-red-summary.json`。

因此本批新接入的短 ID 和项目路径也改用明确提供事件载荷的既有 native writer。ID 的 copy-event 定向测试 7 红／57 项后修复，直接 8 文件／69 项通过；项目详情新反例 5 红／13 项后修复，合并 4 文件／35 项通过。旧的 textarea 参数单测绿灯保留，不能倒写成当时已有真实复制证据。第一轮普通会话菜单用例漏了“加号→当前会话”的正常入口，超时另记为测试导航错误；仅修入口选择，不计产品缺陷。

## 验证批次

| 门禁 | 结果与证据 |
| --- | --- |
| 初始六组件／Hook | 44 项中 38 红、6 控制绿；`clipboard-inventory/batch12-red.log` |
| 通用消息／地址／项目详情初始组 | 22 项中 19 红、3 绿；该次转绿未关闭后续模态浏览器问题 |
| 最终构建 | `pnpm check` 通过；`round5-check.log` |
| 最终组合单测 | 18 文件／236 项通过，31.27 秒；`round5-units.log` |
| 最终 HTTP 复制 | 两尺寸组件 2/2 通过（`clipboard-browser-final.log`）；普通产品入口另跑 1/1 通过（`clipboard-browser-row-hover.log`），后者先修正正常侧栏悬停导航；同一产品源码，分次执行 |
| 综合浏览器 | 8 文件／38 项全部通过、无跳过，3.9 分钟；`round5-browser.log`，含 Goal 原组件／流程／完成、消息释放和 12 条菜单路径 |

上述日志均在 `.dev-runtime/session-polish-round2-20261016/`。`round4-source-manifest.json` 属于模态修复前的红灯源码；`round5-source-manifest.json` 记录修复后的四个 src 目录 2834 文件、9 份 E2E，浏览器前核对无变化，并记录构建后的 72 个 shared 产物。历史 151 项、69 项、35 项等是各自阶段，不能累加成一次总通过。

两尺寸最终 JSON 的完整消息原生粘贴控制通过，项目路径原生粘贴均为 `/fixture/复制项目`；普通入口五个 copy 事件依次为代码原文、目录、rollout 路径、页面链接与精确 thread ID，全部有明确数据且阻止默认复制，errors／执行 calls 均为空。普通入口第二次超时只因测试直接点了桌面未悬停的隐藏按钮，覆盖其上的 age label 正常；悬停父行后按钮可交互且用例通过，无产品源码变更、无强制点击。原失败日志保留。`round5-browser-source-manifest.json` 单列该测试导航／格式修订，2834 源文件仍与 round5 相同。

最终 `round5-source-acceptance-verification.json` 重新枚举四个 src 目录的全部 2834 文件、9 份 E2E 及 72 个已编译 shared 产物，与浏览器前哈希均一致；未用旧的 2508／92 项覆盖本批源码。HTTP 三例与综合 38 项为分次执行，不称单命令 41 项。`session-status-round5.log` 确认正式 PID 2712539 保持，新运行产物尚未激活。

新增永久浏览器入口为 `tests/e2e/session-http-copy-actions.spec.ts`：普通产品页面通过加号／当前会话菜单和项目侧栏执行复制；其它消息／待办／资源／地址／项目控件挂载在私有 fixture React root，执行真实点击与 HTTP copy 事件。390px 的待办使用浏览器右键，不冒称物理手机长按或完整导航验收。

独立 Node/V8 transport 控制使用 262144 字符、永不 settle 且不保存参数的假 Promise：释放 caller 后，全局 boolean helper 留 1 个 marker，native direct-return writer／未调用控制均为 0。该结果只解释 transport 选择，不是新 React 组件物理释放或长期 RSS 证明。初次默认 1024 字符快照截短导致 mounted marker 为零的结果明确无效；有效 v2 显式提高快照字符串上限，原失败仍保留。

长期 RSS、认证宿主、原生跨客户端 CAS 及正式运行层激活继续按 [原验收边界](session-polish-acceptance-20261016.md#合并检查) 判断；本批不重启正式服务或 Agent。
