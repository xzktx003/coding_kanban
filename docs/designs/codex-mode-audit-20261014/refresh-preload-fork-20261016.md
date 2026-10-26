# extensionHost 的实际 fork、preload 与精确版本发送

接续 [初始化核对](refresh-initialization-proxy-20261016.md)。本批继续隔离开发，完整两秒关卡未通过，候选未启用。证据目录为 `.dev-runtime/codex-refresh-20261016-host-wait-profile/`、`codex-refresh-20261016-fork-preload/`、`codex-refresh-20261016-fork-preload-final/`（均在 `.dev-runtime/`）。

## 实际发现的启动问题

固定 code-server 4.141.0 在创建 extensionHost 前清除 NODE_OPTIONS、VSCODE_NODE_OPTIONS 等环境项。原宿主只通过 NODE_OPTIONS 传入自有 preload，因此父进程收到它也不等于 extensionHost 已加载。原单测直接启动带 NODE_OPTIONS 的普通 Node，没有覆盖真正的环境清理与 fork。

host-wait-profile/host-companion-run/companion-0.json 取得真实实例状态：preloadInstalled=false、providerCaptured=false、sendAvailable=false；官方自带 composer 仍能发送。该记录来自原实例私有登记与实际监听端口，PID 归属通过创建时持有的 launcher 身份及 Linux 后代关系核对，不把 HTTP 返回的 PID 当作所有权。

新宿主派生内部 NATIVE_CODEX_HOST_CODE_SERVER 标记。自有启动 shim 仅在该 code-server 包的父 Node 入口安装 fork 钩子，按真实可执行路径核对包目录。只有固定 bootstrap-fork、唯一 type=extensionHost、固定 VSCODE_ESM_ENTRYPOINT、捕获的 companion 配置路径与合法 execArgv 同时匹配，才在克隆的 execArgv 中增加固定自有 preload。原数组、环境、其它参数和 fork 返回值保持；不同实例、其他子进程和普通 Node 原样透传。任意继承的 NODE_OPTIONS 不会作为新参数传入。

父进程的启动钩子只服务该自有进程后续的客户端创建，不保存 child、thread 或正文集合。extensionHost 的 provider 观察仍在精确注册后恢复 API/Module 钩子。同步 Node builtin 的 ESM 导出，使 CJS 与 ESM 调用都覆盖。未识别的 code-server 布局不扩大注入范围；该实现核对本轮 bin/code-server 包布局，不声称任意包装器兼容。

## 红绿灯与原生版本门控

host-wait-profile/fork-preload-red.log：真实 Node 父进程模拟同一清理及 fork，**1 绿/2 红**；CJS、ESM extensionHost 均丢失 preload。green 定向整组 **33/33、无跳过**。后补实例/入口/type/参数不可变反例的 fork-scope-green.log **4/4**，普通 Node 不安装启动钩子，不同配置及后续环境改绑不改变捕获的父实例范围。

fork-preload/actual-provider/result.json：全新宿主真实 preloadInstalled=true、preloadProviderCaptured=true、providerCaptured=true，provider 注册恰一次、captureInstalled=false。但 sendAvailable 仍 false，因此整项失败且没有发送尝试。原因是发送适配器只接受 26.51002.51308，而本轮原包是 26.51007.21434。未知版本拒绝是应保留的策略，不能把它改成接受任意版本。

新增精确 26.51007.21434 分支，保留旧版及未知版本拒绝；已知版本仍检查原连接方法、精确打开列、thread/cwd、真实 idle 状态和持久去重回执，不覆盖原生模型或权限。version-red.log **51 绿/1 红**，green **52/52、无跳过**；对未知版本连 provider 属性都不读取，近似/后缀/空值版本不获权。分支是否真正可用还须由未修改 VSIX/匹配 CLI 的真实发送证明。

fork-preload-final/actual-provider/result.json 首版 **4/4**：全新安装的自有 companion、原 VSIX/CLI、真实 native/control/授权锚，无登录、无认证 loopback 模型。首次及普通刷新后的两个独立实例都 preload/provider 捕获成功、sendAvailable=true；官方 UI 与捕获的原 app-server 桥接各向同一精确 thread 接受并 completed 一轮，标记各一次。桥接 HTTP 200 与 turn/started、completed、原生历史一并核对，回执文件未保存正文。它验证私有 companion 发送通道，不冒称 Session 公共 composer/队列入口也已完成全流程验收。

首版普通刷新到原生接受 **11396.70 ms**，两秒失败。302 项宿主/适配器完整回归无跳过对应保留计数修正前的源码；最终整组及三端另接持续进度，不与中间299项相加。

## 钩子计数与后续复核

真实状态里 apiPatchRetainedCount 原来在恢复后仍为 13/11，实际 API 已恢复，累计计数没有减少。retained-red.log 两项先失败；现仅在本钩子确实不再占据原 API 属性时减计数，重复恢复不重复减少，后来的其他钩子保持，恢复被只读属性阻挡时仍保留非零。retained-green.log **8/8**，后续真实新实例要求直接保留数为零。该计数不等于堆、RSS 或外部扩展持有的函数引用统计。

actual-provider-restored/result.json 再次 **4/4**：两个新实例首次及普通刷新后的 preload/provider 捕获均真，直接保留数 **0/0**，sendAvailable=true。官方 UI 与精确捕获桥接各接受并完成一个新独立标记，历史各一次；不是重发上一轮标记。普通刷新到接受 **11372.80 ms**，仍两秒失败。

cache-observation/result.json 只观察原请求/响应和 CDP 元数据，不更改请求、缓存、CSP 或 worker。两个普通刷新发送均完成，约11924.70/10553.40ms。workbench.js 为原始 Brotli、public max-age=31536000；官方 hashed JS 由原 Service Worker 响应，no-cache、有ETag、无Content-Encoding。不能从这些合成响应或 encodedBodySize 推断每次都传了完整正文，后续须核对原worker的条件验证/304及实际WS字节；尚未实施静态缓存改写。

最终 three-fixed/result.json 以标准三端脚本增加只读实例核对：两桌面+iPhone16模拟，首次及普通刷新后 **6/6** 原实例的 preload/provider 捕获为真，sendAvailable=true，直接保留数全为0。草稿 **9/9**，三条精确 thread 接受及 completed turn 各确认一次；导航到接受 **13529.90 / 13301.90 / 13478.40 ms**，17项 ERR_ABORTED 保留，总 passed=false。页面错误0不是这些取消或两秒的通过证明。三端脚本首次误用另一夹具的 run.wait，在发送前失败；three-final 原记录保留，未算发送尝试或通过。

iPhone16模拟为 Chromium145.0.7632.6、393×852、DPR3、触点1；原生触控与659/430/852视口缩放通过，iframe/父节点身份保持。首次手机通过原保留模型按钮一次，刷新计时不处理公告。没有 iOS/WebKit、系统键盘或硬件剪贴板实测，未以缺少实机阻塞。

最终 native-restored-final.log 为固定 CLI 的 **304/304、无跳过**；此前299/302均是源码中间状态，不相加。任务新MJS测试格式、Node源文件语法及diff检查通过；未据此声称全仓 pnpm test 或原前端143项重跑。

## 此前 CPU 诊断及限制

host-wait-profile 使用自有创建链核对 extensionHost，再显式开启本地 Inspector；默认端口占用时不发信号/不操作占用者，实际 socket 必须属于持有的 PID/start ticks。仅该私有过程使用 [Node Inspector 启动契约](https://nodejs.org/api/cli.html#--inspect-porthostport)，未连接正式宿主或默认 Codex IPC。CPU 仅保留受限脚本 basename/函数名/数值及半秒分段，不保存源码、请求正文或完整 URL。

最初的 RSS 读取函数不适用于启动身份发现，VmRSS 缺测失败未被当作零；后续身份观察不读取 RSS，也未放宽产品资源统计。随机调试端口假设不成立时先拒绝；默认端口显式准入后，V8 的无副作用求值又拒绝状态表达式。相关失败保留，未据此推断会话摘要等待。原 descriptor-run 的 runner 误把缺少 provider 状态当作成功，diagnostic-review.json 明确改判该子项失败；原始文件保留为 result-before-review.json 并记录SHA256，当前result.json已标false，时刻/接受数据未追溯重采。后续缺测直接限制总结果。

有效 CPU 样本显示 extensionHost 有大量 idle，而非十余秒持续计算。host-phase-run 首样本约13.46秒、idle约8.27秒；host-descriptor-run 的普通刷新采样约9.17秒、idle约4.57秒、证书处理约410ms、GC约457ms。该次 workbench didStart 约1171ms、set-content约4037ms；preframe content/started→workerReady约11ms。带 Profiler 的数据不作为最终两秒矩阵，不把 program 当作编译、不相加各 frame 耗时。

正式启用、最终构建/清理/安全核对及完整未完成范围见持续进度。官方 ChatGPT/OAuth、自动 profile/源/完整资源准入、大消息/长历史、180次矩阵、自然RSS长测和此前并发红灯仍须完成；本批不降低任何关卡。

三批私有清理均为12个已知自有进程退出、零错误并删除根/TLS。host-wait-profile 的3线程/9终态轮次（idle7 completed、running1 completed、假审批1 interrupted），Responses共10次（8/1/1）；fork-preload 的3个原始轮次终态，未尝试发送，Responses3次；最终夹具3线程/12终态轮次（idle10、running1 completed、假审批1 interrupted），Responses13次（11/1/1）。调用数不等同用户轮次，不推断额外模型调用用途。创建连接保留，cleanup interrupt只用于本批人工审批，不计作官方UI中断或manager独立保温通过。

首次 check-final.log 被并发新增 toast 主题测试的7处 TS2769 阻断：getByRole 不接受 exact。读取时当前文件已由并发工作修正，本批未编辑该测试或toast生产逻辑。最初定向命令漏掉 Session/jsdom 配置而报 document 不存在，日志保留；使用 vitest.session.config.ts 后 toast-session-green.log **3/3**。最终 check-current-final.log **pnpm check exit 0**，原大chunk提示保留。任务新MJS测试格式、Node语法、相对链接及git diff --check通过，.env忽略、.env.example可提交；无提交或推送，保留其它并发工作。

formal-safety-final.json（2026-10-16T10:17:35.840Z）确认正式 Session/native launcher/native host 仍为 **2712539/55361120、2718477/83117363、2729812/83119682**。正式 **HTTPS https://10.30.0.24:8484/?mode=codex**（端口8484）和后端/Session健康均200，session-status-final.log仍ready且磁盘/运行产物不同。未切换运行层、替换存量companion或停止正式Agent，不据此宣称所有网关/网页PID从未改变。临时HTTPS https://10.30.0.24:5173（0.0.0.0、端口5173）已关闭。
