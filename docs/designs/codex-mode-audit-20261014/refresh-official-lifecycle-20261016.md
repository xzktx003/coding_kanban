# 三端官方审批、运行中恢复与发送验收

接续 [可见启动](refresh-visible-startup-20261016.md)。完整计划继续实施，候选默认未启用；本批功能通过不代表两秒或最终矩阵通过。证据目录 `.dev-runtime/codex-refresh-20261016-ui-lifecycle/`。

## 环境与协议边界

全新无登录 HOME、私有项目，未修改 VSIX `26.51007.21434`，匹配 CLI `0.162.0-alpha.17.2`，实际常驻 native、独立授权观察器/control、CLI 桥接、同源可见页面通道及 `--restore-visible-windows`。初始选择 `gpt-6.1-sol`，模型仍为无认证 loopback Responses fixture，不调用外部模型、不复制登录。

两桌面与手机使用三个不同 HTTPS 源；临时前端 **https://10.30.0.24:5173**（HTTPS、端口 5173、绑定 `0.0.0.0`）已清理。iPhone 16 模拟：Chromium **145.0.7632.6**，CSS 屏幕/初始视口 **393×852**、DPR **3**、触点 **1**、粗指针、无 hover。Safari/iOS 18 UA 是模拟参数，不等于真实 WebKit、系统键盘或硬件剪贴板验收。

脚本只通过应用已有元数据选择目标，所有实际发送/审批走官方真实 DOM，没有替换 API、MessagePort 或事件处理器。独立 observer 保留有界生命周期元数据，完成事件后读取本夹具小历史核对实际 UUID/turn/输入项。最初 seed 创建连接保留，不代替最后一个订阅退出或 manager 单独保温验收。8 GiB 为诊断预算，不是生产资源定标。

新增 `tests/e2e/codex-refresh-ui-fixture.mjs` 及 approval/running/concurrent-send 三个 acceptance 脚本。必须显式提供自有、0600、真实路径的 `NATIVE_CODEX_REFRESH_BROWSER_MANIFEST` 和全新 `NATIVE_CODEX_REFRESH_BROWSER_OUTPUT`；缺失直接失败，不回退正式宿主或以跳过代替通过。本批 setup 是私有取证程序，不是已交付的自动生产 profile 管理器。

## 无输入框不能推断引导

真实待审批页面显示官方 `Allow once`/`Deny`，此时没有 composer。原外壳把“已渲染但无 composer”直接判作需要完成官方引导。现在 `CodexWorkbench` 单独保存原生已有检测结果中的 `onboarding === true`；只对明确引导显示提示，其他缺输入框的已加载页面保留“原生页面已加载”。移除窗口和 iframe 重载清理集合，相同状态不重复更新，没有新增正文读取或 DOM observer。

`approval-guide-red.log` 为 **1 红/23 绿**。第一轮 green 仅因测试误写“原生界面已加载”失败，产品原文为“原生页面已加载”，修正测试而未改产品文案。`approval-guide-final.log` 四文件 **73/73**，覆盖真实引导与无 composer 的非引导状态；手机 `approval-three/mobile-pending.png` 已无误导提示，保留官方审批控件。

## 真实三端功能结果

| 用例 | 结果 | 实际原生核对 |
| --- | --- | --- |
| 待审批经一端刷新、三端同时点击 | `approval-three/result.json`，**8/8、零错误** | requestId **0** 正确识别；原 thread/turn/item 不变，原请求解决，私有文件恰一次 `APPROVED\n`，原 turn 完成一次，三端同步消除审批 |
| 运行中手机刷新、关闭桌面 A | `running-three/result.json`，**8/8、零错误** | 原 turn 仍 active，native PID/start ticks 不变；关闭后等待 11 秒，超过该私有宿主 10 秒宽限；仅释放自有模型后原 turn 完成一次，B/手机同步完成 |
| 三端不同草稿并发发送 | `send-three-traced/result.json`，**5/5、零错误** | 三个独立 userMessage 项各一次，在同一个 completed turn 内被接受；三端自己的草稿清空；只读记录实际桌面 click、手机 touch/click |
| 三端各自普通刷新后发送 | `refresh-receipts/result.json`，草稿 **9/9**，**整组失败** | 三个精确 turn 均接受并完成，耗时均超过两秒，另有请求失败记录 |

审批的三个自动化点击 fulfilled 只证明 UI 手势尝试完成，不能据此宣称三条审批回复实际写出。运行中任务由夹具创建，本项观察了官方可用 Stop，未点击它，不代替中断/继续；截图曾显示 `Loading model…`，不据 Stop 可见推断空闲模型选择已就绪。

两个未闭合失败完整保留：

- 原 running 夹具在 UI 用例开始前因静默模型等待过长，原生报 `idle timeout waiting for SSE`，见 `running-fixture-timeout.json`。没有提高超时或把它解释成刷新停止任务；后续独立用例创建新 thread/turn，原失败历史保留。
- `send-three/result.json` 首轮三端点击 fulfilled，实际仅 A/B 各接受一次，手机 C 完整留在草稿、原生记录为零。后续 traced 用例使用不同标记，不重发原 C。**首轮原因未定位，不能把一次后续通过记为修复或并发稳定**。新增只读手势/生命周期记录，继续复现竞态，不自动重发未知提交。

## 两秒计时仍失败

普通刷新 navigation start 到相同目标实际原生 `turn/started`：

| 客户端 | 毫秒 | ≤2 秒 |
| --- | ---: | --- |
| 桌面 A | 15291.30 | 失败 |
| 桌面 B | 16281.10 | 失败 |
| iPhone 16 尺寸模拟 | 14789.90 | 失败 |

三个样本完整保留，不是 180 次三状态矩阵。本批还记录 **17 项 requestfailed/ERR_ABORTED**，含 status/theme、静态 vsda 和遥测路径，未过滤或依据后续成功猜测原因。`draftsPassed=true`、`performancePassed=false`、总 `passed=false`。

第一条刷新：外壳约 0.58 秒后加载 workbench，后者自身 `didStartWorkbench` 为 1.302 秒；官方 webview 文档在总约 5.533 秒建立。webview 250 条资源计时、encoded/decoded 合计约 26.67 MB，12 次 long task 合计 3.502 秒，其中一项 2.076 秒。经 ServiceWorker 的 `transferSize=0` 不能单独证明 HTTP 缓存命中，encodedBodySize 也不是本次实际网络字节。下一步继续定位扩展/Webview 初始化关键路径，不修改官方 bundle、feature flag 或消息预算。

私有宿主日志还出现官方 git-init-watcher 的 `EMFILE: too many open files, watch` 和 ResizeObserver 告警；本批没有确认其资源根因或修复，不能把此环境称为资源关卡通过。未修改共享主机限制或停止其他进程来消除告警。

## 检查和清理

`web-final.log` **22 文件/143 项通过**；固定 CLI 的 `native-final.log` **282/282、无跳过**。首次 `check-final.log` 暴露两个测试回调手写类型没有 onboarding 字段；改为复用 `NativeSurfaceOptions["onWindowState"]`，不放宽生产类型或断言，后续整组和构建见持续进度。

`native-final.json` 核对私有项目恰 **4 个 thread、9 个 terminal turn**：idle 六轮 completed、审批一轮 completed、后建 running 一轮 completed、原 running 一轮 failed。原未提交 C 的历史出现数仍为零。`model-calls-final.json` 为 **12 次** Responses 调用（running 2、approval 2、idle 8），不当作用户 turn 数或推断额外调用用途。

按持有的 PID/start ticks 关闭自有 setup/native/control 等进程，`cleanup-final.json` 确认 **12 个已知自有进程退出、零清理错误、私有根及 TLS 已删除**。清理脚本最初对相对 argv 的假设失败，随后停止中遇到 RSS 瞬时缺测；保留失败，只读复核 PID/start ticks/退出状态后才删目录，没有为清理放宽产品资源测量契约或信号其他进程。

完整计划仍包含并发红灯定位、官方中断/继续/附件/提问、旧设置反例、ChatGPT/OAuth、自动 profile/持久源和全部宿主资源准入、大消息、长历史、180 次性能矩阵、自然 RSS 长测。手机按上述明确参数模拟继续，不以缺少实机阻塞。最终构建、格式、正式健康与运行身份核对接 [持续进度](refresh-recovery-progress-20261015.md)。
