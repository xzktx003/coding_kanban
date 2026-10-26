# 原生提交后的页面收尾与独立客户端对照

2026-10-16，继续执行[完整计划](refresh-recovery-plan.md)。候选仍未启用，阶段 0 与两秒关卡仍红。本批使用未修改的 VSIX 26.51007.21434、匹配 CLI 0.162.0-alpha.17.2、全新无登录 HOME、私有 native/授权观察/control；原包与摘要沿用[固定版本验收](refresh-preload-fork-20261016.md)。没有连接默认 CLI IPC、修改官方 DOM/MessagePort 或调整传输、资源预算。

## 验收修正

此前仅断言原生接受、completed 和历史标记，不能证明原生页面结束等待。新增 `tests/e2e/codex-refresh-ui-settlement.mjs`：在精确原生轮次完成后，只读检查正确 thread、唯一可见输入框、已清空草稿、无 busy/Stop/Queue，且存在 Send。空草稿的 Send 可以按官方规则禁用；实际发送能力由此前真实发送及精确回执另证。默认最多等待 15 秒，单次 evaluate 也受总截止时间约束。失败只保留一个固定字段控制状态，不记录正文、DOM 引用或无界采样；不清稿、不点击、不重发、不伪造原生完成状态。

顺序与并发浏览器脚本均接入此断言。首次实际接入误把 Locator 当作 ElementHandle 调用 `ownerFrame()`，在一个标记已被接受并完成后失败；原 `ui-receipt/three-final` 保留，不重发。现使用短暂 ElementHandle 取得真实 frame 并在 finally 释放；后述独立夹具重新验证三端。

`codex-refresh-fixture.mjs` 新增严格客户端/profile 对应：只允许显式一个共享诊断 profile，或三端各自精确 profile；三项 id、startupId、根目录均须唯一，目录不能交叠、越界或含控制字符，UUID 必须是字符串。原浏览器脚本无论有多少 profile 都取第一项，不能用于证明三宿主隔离。现两个入口均按客户端 index 选择，并逐一核对实际私有目录；没有缺失时回退到另一宿主。

红绿灯证据：`.dev-runtime/codex-refresh-20261016-ui-receipt/settlement-red.log` 为缺模块失败，初始 7 项转绿；`private-clients/profile-red.log` 为旧路径 2 绿/新增 2 红，随后 4/4。`strict-observation-red.log` 暴露宽松类型和缺失超时状态；修正后 12/12。`thread-identity-red.log` 进一步拒绝被正则隐式转字符串的数组 UUID，green 8/8。最终整组和构建见持续进度。

## 单端与共享宿主的真实结果

证据根 `.dev-runtime/codex-refresh-20261016-ui-receipt/`。iPhone 单端两次真实发送均精确接受、完成及历史一次；冷初始化约 20104.80 ms、普通刷新约 11555.00 ms。原生 completed 后页面清稿/退出 busy 另需约 414/502 ms，然后以本用例的未提交探针验证 Send 可用；这不是两秒通过，也不能把 completed 紧接着的一帧截图判成持续卡死。

同一 code-server 宿主、三个浏览器源的 `concurrent-1` 在发送控件等待超时，三个草稿保留，未提交、原生不存在该组标记。不能用其后截图反推超时瞬间具体控件状态。`concurrent-2` 三次真实桌面 click/手机 tap 均到达原按钮，三标记在一个 completed turn 中各一次；但是新增页面断言等待 15 秒仍失败，截图保留重复气泡和 Stop。该轮整体为红。

有界桥接元数据证明三次 turn/start 都经同一个官方扩展 CLI 连接 PID 1054398，三个请求回执均早于 completed。另两个扩展连接在该窗口只有账号查询。只读原包中 `UN()` 使用 CODEX_HOME/ipc/ipc.sock，IpcRouter 会路由请求；这支持进一步核对原生扩展所有权，不能证明它是唯一根因，更不能称为迟到原生回执。

原生日志的合法启动分段显示，某次普通刷新 app 总计约 5888.8 ms，其中 shell_visible 4200.7、resume_started 4654.4、resume_finished 5780.7、thread_visible 5888.8 ms；hydration 1126.1 ms，真正 runtime_resume 约 31.4 ms。该分段不等于完整导航到接受时间，也没有证明某个 SDK 是全部耗时的唯一来源。

同夹具原生 turn_context 从首次 gpt-6.1-sol/low 变为刷新后 gpt-5.5/medium，未记录显式模型选择。它是设置关卡的反例，尚未区分模型目录回退或旧端 Resume 等原因；不得声称设置不被覆盖已通过。

## 三台独立宿主的对照

证据根 `.dev-runtime/codex-refresh-20261016-private-clients/`。三台 code-server 各自独立 HOME、CODEX_HOME、TMPDIR、用户数据、扩展目录、CLI 连接和原生扩展 IPC；三个浏览器源各选对应 profile，同一个私有 native/control 和测试 thread。为让原生打开同一工作区，诊断网关子类仅将普通 folder URL 固定到已核对的私有公共项目目录；产品宿主的 projectDir 仍要求位于本 runtimeRoot，因此本夹具不是已完成的正式共享工作区启动契约，更不是自动 profile 管理验收。

| 用例 | 原生历史 | 原官方页面 | 总结果 |
| --- | --- | --- | --- |
| concurrent-1，独立标记 PRIVATECLIENTS_1 | 三个不同 completed turn，三输入各一次 | 桌面两端收尾；手机仍 Stop，15 秒断言失败 | 红 |
| three-final，顺序普通刷新后发送 | 三端各自精确接受、completed、标记一次；草稿步骤 9/9 | 三端清稿/空闲，完成后另需 154/134/77 ms；真实触控及 659/430/852 高度重排通过 | 性能红：11886.70/13905.70/12378.10 ms；18 项 ERR_ABORTED 保留 |
| concurrent-2，新独立标记 PRIVATECLIENTS_2 | 一个 completed turn，三输入各一次，未中断 | 三端收尾通过，5 步、零错误 | 此独立用例绿；不能覆盖第一组红 |

两组并发均只有三次用户手势，不重发失败或未知提交。三个宿主各自确有 turn/start 请求；原生 userMessage 的 clientId 存在。新夹具 thread/read 的 model 仍为 gpt-6.1-sol；不能据此消除前一夹具的设置反例。独立宿主没有稳定修复并发 UI 收尾，不能直接提交“增加宿主就修好”的实现，也不能用延迟模型响应、改原生 turn 顺序或清空 composer 隐藏问题。

iPhone 16 为 Chromium 145.0.7632.6、CSS 393×852、DPR 3、触点 1、移动/触控模式、模拟 iOS 18 Safari UA。真实页面 touch 事件、唯一目标与 iframe/父节点保持另有结果；不是物理 iOS、WebKit、系统输入法、真实软键盘或硬件剪贴板验收。

## 清理、安全及未完成边界

两批均仅私有人工线程：共享宿主最终 7 轮（idle 5 completed、running 1 failed、人工审批清理 interrupt 1）；三宿主最终 10 轮（idle 8 completed、running 1 failed、人工审批清理 interrupt 1）。运行夹具长期无 SSE 数据最终 failed，不能计为运行保护通过。模型 Responses 分别 10/12 次，不等同用户轮次数。清理前逐一核对 thread/cwd、原标记精确一次或未发送组缺失；只对本批人工审批的精确 turn 清理中断。

三宿主关闭浏览器后的单次进程快照为 20 个自有进程、RSS 合计 2886287360 bytes（共享页可能重复计数）。它没有浏览器 JS 堆/renderer RSS连续采样，不是预算定标或 30 分钟长测。按持有的 PID/start ticks 清理，共享宿主 12 个、三宿主 20 个自有进程均退出，零错误，私有根和 TLS 删除。前端均绑定 0.0.0.0；临时 LAN HTTPS https://10.30.0.24:5173 和 https://10.30.0.24:5174 已关闭。

2026-10-16T11:27:03.769Z 核对正式 Session/native launcher/native host 仍为 2712539/55361120、2718477/83117363、2729812/83119682；正式 HTTPS https://10.30.0.24:8484/?mode=codex（端口8484）及后端/Session健康均200。session:status 仍 ready，运行产物与磁盘构建不同，未切换运行层或停止正式 Agent。

仍须解决原并发手机漏发、本批并发 UI 等待与两秒性能；完成 manager 单独保温、11→10/冷恢复、旧端设置、180次三状态矩阵、再次进入、官方完整交互、ChatGPT/OAuth、自动宿主/持久源及资源准入、长历史/2MiB兼容和自然内存长测。计划范围与门槛保持，不能用本批测试基础设施通过替代最终验收。
