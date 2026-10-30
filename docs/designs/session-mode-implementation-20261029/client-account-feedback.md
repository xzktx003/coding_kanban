# 账号、额度与反馈客户端实施验收

2026-10-30，本期保留账号登录、模型调用和反馈客户端能力；不开发云任务执行或云端服务。以下结果分别记录真实前端、隔离 HTTP/SSE 和未修改官方组件的证据，不把夹具数值称为真实账号或计费结果。

## 已修复的客户端作用域缺口

- `CodexAuth` 先前只核对 endpoint/runtime/loginId。同一个配对设备仅更换 token 时，旧 device code、输入的 API key 和迟到登录完成仍可保留。现在在提交时捕获完整 host/port/token 身份；同 endpoint 凭据变化同步撤销旧 owner、清除敏感输入和旧验证码，只读重新查询当前账号。旧 ACK/完成通知不关闭新登录视图，不自动重发或取消别人的登录。
- `NativeCodexUsage` 原先直到下一次网络回复才可能清理同 endpoint 的旧设备额度。现在订阅精确配对和账号域，变化立即清空旧额度、取消旧读取并推进读取代次，迟到旧 HTTP 不覆盖新设备结果。
- 反馈工作流原先遗漏共享 SSE 的 `onResync`。现在断线重建/事件缺口使旧报告与观察失效；已经实际发出的上传继续一次，迟到结果不能重新创建旧 UI。
- 反馈报告沿用当前官方组件的整数 CSS 像素高度测量。报告正文/语言/状态或窗口尺寸变化重新测量，隐藏/关闭释放 ResizeObserver，长文仍受视口上限限制。原生动画对照先结束有限的进入/尺寸动画，只将无限 spinner 定格；把尺寸动画强行设为零会错误地比较上一状态的高度。

红灯日志为 `/tmp/transcript-client-scope-audit-red.log`（三个作用域缺口）、`/tmp/transcript-feedback-height-red.log`（尺寸测量/释放）；对应绿灯见下表。只改变夹具、首次自动登录提示和动画取样时序的失败没有算作产品缺陷。

## 精确条目映射

| 条目 | 实现与专项 | 已执行动态证据 | 边界 |
| --- | --- | --- | --- |
| LG33 ChatGPT/API key/device code 登录 | `components/codex/CodexAuth.tsx`；`CodexAuth.test.tsx`、`CodexAuth.ownership.test.tsx`，捕获 raw pairing/runtime/epoch/loginId，保留早到完成待核对。 | `session-account-scope.spec.ts` 4 例：1440/393、凭据切换发生在 ACK 前/后，旧 code/API key 清除、旧完成忽略、新显式 API key 输入仍可提交。`session-codex-account-native.spec.ts` 4 例另覆盖正常菜单/登录与外来 loginId。 | 真实 UI/HTTP；测试值为假凭据，不执行真实 OAuth、设备授权或读取主机登录秘密。原生账号策略不由 UI 或套餐推断。 |
| LG34 登录取消与未知回执 | 同一 `CodexAuth` owner 状态，显式 sending/uncertain，关闭弹窗不当作服务端取消。 | 现有完整 account 浏览器 1440/390 × dark/light 4 例本轮全部重跑，runtime 改变拒绝旧完成、取消未知禁止重复、明确取消成功与退出未知保留状态。 | 夹具主动变更 runtime 后，先等真实全局 health observer 确认该代次，再开启下一个独立用例；不放宽产品失效 guard。未执行真实账号退出。 |
| LG35 原生额度与恢复 | `features/codex-account/NativeCodexUsage.tsx`、`usageController.ts`、`NativeAccountUsageDialog.tsx`；同目录 unit。 | 新 `session-account-scope.spec.ts` 2 例：桌面/手机旧额度立即清空、新读返回后旧 HTTP 不覆盖；上述 4 account 例覆盖额度通知、离线/配置提示和恢复。当前未修改 26.51007 quota 原组件五例对照在 `transcript.md` 的 `quota-paired-current`。 | 额度数据是隔离夹具；不是实际账单、组织权限或账号刷新成功证明。原包可比较字体/文字/图标/几何与交互分支。 |
| LG36 反馈入口与权限预检 | `features/native-feedback/preflightWorkflow.tsx`、`preflight.ts`、公共 slash/menu 与 `NativeFeedbackDialog`；`preflight-workflow.test.tsx`、`preflight.test.ts`。 | `session-codex-feedback-entry.spec.mts` 1440/390 × slash/conversation-menu 4 例；真实入口→运行层 preflight 夹具，捕获原 thread/cwd/owner、保留其他会话草稿；未发生上传/turn 写入。新六态测试还逐次断言打开和提交各一次 preflight，共12读/6上传。 | 运行层 fixture 使用当前 shared 编译产物；缺导出的旧 dist 初始报错后只编译 shared 再重跑，没有替换正在运行的服务。正式 ChatGPT 组织策略仍需真实授权环境验收。 |
| LG37 上传六态及关窗后继续 | `features/native-feedback/controller.ts`、`service.ts`、`NativeFeedbackUploads.tsx`、`report.css`；controller/service/report unit。 | `session-current-feedback-parity.spec.ts` 700/393 × dark/light 4 例全部通过：uploading/uploaded/incomplete/disabled/failed/unconfirmed 的文字、链接、图标路径、可见控件和几何逐项与未修改当前原包相等；关闭正在上传的原生/本地报告、完成后通知重开也相等。`session-feedback-scope.spec.ts` 4 例以真实浏览器 EventSource 触发序号缺口 resync 或同值账号通知，已发 HTTP 完成一次且不重建旧报告。 | 原包仅隔离其 host formatter/modal/notification 服务；公共 `startFeedbackUpload` 及报告组件保持未修改。实际反馈 HTTP 是本地夹具，不发送到 OpenAI；通知适配器本身不作为原生通知视觉金标。 |

## 本轮可复核记录

- 本地前端冻结为 **HTTP `http://10.30.0.24:42973`**，监听 `0.0.0.0`，不代理正式 API、不含 HMR；私有 source manifest 在 `.dev-runtime/session-multisession-20261029/frozen-1793299945605/`。这些是临时验收地址，不是产品硬编码。
- 当前官方参考为 **HTTP `http://10.30.0.24:40465/native-goal.html`**，由 `scripts/codex-goal-reference-server.mjs` 从未修改 VSIX 26.51007.21434 的受控提取包提供。新 `session-current-feedback-reference.ts` 对 reference manifest/version 做门控；`feedback-upload-10d8b6133f0f.js` SHA-256 为 `810e784944cd7b342c16f5dd46366466d87683d00251cffac6745141dc9e1f07`。旧 `session-native-feedback-reference.ts` 固定26.51002，不能冒充当前版本。
- `account-final` **10/10**：`/tmp/transcript-account-final.log` 与 `.dev-runtime/session-mode-implementation-20261029/client-account/account-final/`。
- `feedback-entry-runtime-current` **4/4**：`/tmp/transcript-feedback-entry-runtime-current.log` 与同名私有目录。
- `current-six-states-final` **4/4**：`/tmp/transcript-current-six-states-final.log`，每例保留七份 paired metrics、截图、12次 preflight 和6次上传参数；所有公开记录只使用 fixture 值。
- `feedback-scope-entry` 的新 scope **4/4**：`/tmp/transcript-feedback-scope-entry.log`。同一旧组合中原 entry 的4个失败来自 shared dist 缺少导出，已由上面的新4/4替代，不能把旧组合整体称为8绿。
- 尺寸单元 **4/4**：`/tmp/transcript-feedback-height-green.log`。本域最终 account/feedback/notifications 广域检查和 web/server 类型检查日志为 `/tmp/transcript-client-final-{unit,web-types,server-types}.log`，以日志结尾为准。

完整 Workbench 多页面两秒、所有非 IDE/非云条目整合、正式运行层启用及长时间堆/RSS依然是各自独立门禁。这份文档不以账号/反馈专项绿灯替代这些门禁。

## 闭合组件与混合套件复验（2026-10-30）

完整编辑器、反馈表单和上传报告仅在真实手势或报告存续时加载；轻量预检入口先捕获可见owner并执行只读预检，跨懒模块仍保留原scope。关闭的报告不订阅大UI，已经发出的上传由轻量控制器继续一次。桌面1440/手机393真实浏览器验证首屏三模块请求为0、首次操作才下载、取消/503局部关闭保留草稿、账号撤销后迟到模块不再弹出，日志 `/tmp/transcript-closed-dependencies-green.log`；本轮重新组合见下述最终日志。

组合回归保留两种夹具红灯：固定200ms截屏有一次在手机取样早于实际反馈表单挂载；Playwright1.58.2在混合.ts CJS与.mts ESM套件时，其按filename共享的内存转换缓存使真实shared导出错误呈现为缺失。后者不是产品或编译产物缺少函数。预检夹具改为私有HOME、自有tsx worker及IPC，仍执行原 `registerCodexRoutes`/`CodexService` handler，仅四个精确只读RPC，没有监听端口、正式账号、daemon或上传；测试关闭等待自有worker退出。表单检查改为10秒有界等待实际可见组件，继续保留immediate/2raf和实际时间，不能把它换算成两秒性能通过。

更新后的原始反馈入口4项与闭合组件2项、来源原文8项、来源原图8项以同一命令连续执行，使用独立冻结 HTTP LAN `http://10.30.0.24:44649`（0.0.0.0），**22/22通过（1.2分钟）**，原始结果见 `/tmp/transcript-origin-and-lazy-worker-final.log`；JSON/截图在 `.dev-runtime/session-mode-implementation-20261029/client-account/origin-and-lazy-worker-final/`。旧4项导出误报和3过1早取样日志保留，不将旧组合称为通过。独立原包六态、scope和正式2秒/RSS门槛仍各自记账。
