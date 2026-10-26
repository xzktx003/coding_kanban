# 运行中夹具的 SSE 存活与严格页面收尾

日期：2026-10-16。候选入口仍关闭，阶段 0 的两秒部署关卡仍红。本批只修复隔离验收夹具并补官方运行/操作证据，不把本地模型的生成耗时当实际模型性能。

## 已定位并修复

`test/fixtures/refresh-model.mjs` 在 `REFRESH_RUNNING` 请求中只写一次 `response.created`，然后无限等待显式 release。长时间准备三端页面后，真实 native 会按正常 SSE 空闲期限将该 turn 结束为 failed。因此此前“运行中”样本失去运行前提，不能作为任务保护通过。

夹具现在每秒发送固定的 `response.in_progress` 事件：不添加聊天正文，不创建 turn，不重试请求。响应背压时跳过本次写入，不排队积累；release、客户端断开及 fixture close 均收尾等待和定时器。普通 SSE comment 不足以证明重置原生的事件空闲期限，故用实际支持的 Responses 事件。正式 native、官方 VSIX、SDK feature flags、服务预算及正式连接均未改变。

另修复运行验收写死旧 audit 目录的问题。`verifyRefreshSetupProcess` 只核对显式无登录夹具的私有 root、当前 manifest、对应 setup.mjs、实际进程 argv 及 PID/start ticks；不发送信号。调用方核对后只向本批 setup 发 SIGUSR2 释放本地 provider。错误目录、旧身份、别名、开放写权限和非无登录夹具拒绝。此本地检查不声称内核提供 PID 身份与信号的原子事务。

运行中 E2E 的结束条件增加两端官方 composer 收尾：正确唯一 target/editor、输入为空、无 busy/Stop/Queue 且恢复 Send。看到完成文字或 native completed 本身不再足够。只有先核对实际 native turn.status=interrupted 的中断场景，才允许官方空输入区 Resume；普通 completed 仍必须 Send。

## 红绿灯与证据

证据目录：`.dev-runtime/codex-refresh-20261016-sdk-gate/` 与 `.dev-runtime/codex-refresh-20261016-running-keepalive/`。

- `model-stream-red.log`：HTTP 等待进度事件超时；最初 native 测试错误地对 rendezvous 符号链接调用 isSocket，未到需求断言。改用已有 verifyControlSocket 契约后，`model-stream-socket-red.log` 实际复现 native status=systemError，预期 active。
- `model-stream-green.log` / `model-stream-formatted-green.log`：7/7。真实匹配 CLI 的流空闲期限为 1500 ms，持有 4500 ms 后同一 turn 仍 inProgress；release 后同一 turn 完成、输出一次、provider 仅一次调用。用短的隔离期限复现，无需等待默认长超时。
- `setup-scope-red.log`：新进程归属检查不存在时红；实现后上述绿灯包含实际新目录子进程及旧身份/错误脚本/别名/权限反例。
- `native-final.log` 为新增中断收尾反例前的 322/322；最终 `native-resume-final.log`：匹配 CLI、未修改 VSIX 的宿主/适配器整组 **324/324，无跳过**，两组不相加。未提供 NATIVE_CODEX_REFRESH_CLI 时跳过的真实 native 项不计验收。
- `check-final.log`：`pnpm check` exit 0，保留原有大 chunk 提示。

首个 `running-ui/result.json` 为旧 8 条行为断言的真实通过：同一 turn 在 iPhone 16 模拟端刷新、一桌面关闭并超过 10 秒宿主宽限后仍 active；显式释放后完成一次、两存活端看到原完成文字。该进程启动后才加严源脚本的页面收尾条件，故这份 8 步结果不算新 10 步关卡通过。

严格重验使用新建的私有 thread/turn，旧 completed turn 未重发。`running-strict/result.json` 因共享关注集合保留旧测试 thread 得到 4 而非 3，在浏览器操作前失败；只从本批网关关注集合移除已完成旧项，不删除历史或停止任务，再按同一仍运行的新 turn 重验。所有失败原件保留。

`running-strict-retry/result.json` 为严格 **10/10、零错误**。原始 turn ID 保持，两个存活端恢复 Send；采样各耗时 8/4 ms，是 native 完成后的收尾检查时间，不是 navigation→可操作时间。没有重发运行输入。

## 官方 Stop、Resume 与继续

新增 `codex-refresh-interrupt-acceptance.mjs`：三端冷准备后，通过原生手机 composer 单次发送全新受控 running 标记；三端显示 Stop，再用手机原 Stop 单击中断精确 turn。核对原生 interrupted 后，三端均须收尾，再允许一次桌面继续发送。任何收尾失败都停在继续发送前，未知回执不重发。

保留全部实际失败：`interrupt-ui` 在 composer 生成前立即 count 得 0；`interrupt-ready` 误把空输入的换行当非空。这两批均无发送。增加原生 editor 可见等待及空白归一化后，`interrupt-empty` 成功发送一次、原 Stop 中断一次，但旧 helper 只计 Send 而遗漏中断后的 Resume，15 秒判错，未继续发送。截图可见按钮但未在原失败采样中保存 Resume 计数，不能仅据截图改写原结果。

只读原包发现专门的 composer.submitButtonTooltip.resume；新红灯 `interrupted-controls-red.log` 保留，绿灯 `interrupted-controls-green.log` 为 **10/10**。明确 expectedTurnStatus=interrupted 才允许唯一 Send 或 Resume；completed 时 Resume 仍失败。busy/Stop/Queue、未清稿、缺测、重复控件、冻结 frame 和错误身份继续拒绝，超时只留固定控制元数据。新 resumeCount 和 submitAction 为有界诊断字段，不保留正文。

`interrupt-resume/result.json` 使用另一条全新标记，不重发旧标记；真实 **12/12、零错误**。官方手机 Stop 再次精确中断 native turn，三端实际 submitAction 均为 resume；桌面随后单次继续，在新的精确 turn 接受/完成且输入各一次，三端 submitAction 均为 send。三端中断收尾采样 8/25/4 ms，继续完成后 87/3/2 ms；均不是两秒恢复计时。此前普通 completed 后 Stop=1 的并发反例未改判，也未称全局并发稳定性已修复。

另一次只读新页面控制诊断 observe-controls 发生在重新打开之后，初始模型仍 loading 时看到 Send，不代表原失败页面当时的状态；它未用于性能结论。

## 初始化假设排除

`native-config-result.json` 的四个全新无登录原生进程只读 config/read：未配置 analytics.enabled 时，有无 --analytics-default-enabled 均返回 null；明确 false/true 分别保持 false/true。没有模型请求、登录复制或正式 IPC 连接，DNT/OTEL 隔离环境保持。不能声称增加该 flag 能改变配置或解决 SDK 等待。

只读原包源码显示匿名与 ChatGPT 账号的 SDK 初始化分支不同；已有匿名初始化计时不能替代真实 ChatGPT/OAuth 的全部验收。本批不改 SDK 网络、账号或缓存策略。

## 保持的验收边界

三独立 code-server/profile 使用实际 --refresh-workspace-dir 与标准网关，全部实验数据在私有 /tmp 根。临时前端绑定 0.0.0.0，局域网 HTTPS https://10.30.0.24:5173（端口 5173）。iPhone 16 尺寸模拟为 Chromium 145.0.7632.6、CSS 393×852、DPR 3、touch=1；不冒称物理 iOS/WebKit、系统键盘、硬件剪贴板或完整尺寸矩阵。

创建连接仍保留，因此本批不计 manager 单独保温、最后一个订阅退出或服务级资源预算定标。两秒/180 次矩阵、再进入、11→10 与冷恢复、并发残留 Stop、旧设置、完整附件/提问、长历史/大消息、自然 30 分钟 RSS 与自动 profile/源/资源准入继续属于原目标。正式任务未迁移，完整目标仍 active。


## 三端审批、资源与正式安全复核

`approval-ui/result.json` 为 **8/8、零错误**：三独立原生页面显示精确原请求，刷新一端仍待审批，三端真实点击 Allow once 均完成；服务端原请求解决，私有命令文件恰一次 APPROVED，原 turn 完成，三端原审批按钮消失并显示完成结果。该脚本未记录 composer 收尾或两秒时间，不能与中断脚本的收尾证据混称同一关卡。

`native-final.json` 核对本批 4 个私有 thread、7 个终态 turn：idle 中两轮 completed、两轮为真正官方 Stop 导致 interrupted；两个独立 running 场景各一轮 completed，approval 一轮 completed。没有 cleanup interrupt，也没有 failed。所有受控输入在各自 thread/turn 恰一次；8 次 provider Responses（idle 2、running 4、approval 2）不等同用户轮次数。创建连接保留，不计 manager 单独保温。

浏览器关闭后的 `owned-rss-snapshot.json` 是20个已知自有进程的单次RSS，不含活着的renderer，也不是30分钟JS堆/RSS或预算定标。`cleanup-final.json` 确认20个自有进程全部退出、零错误、私有根 /tmp/ck-ui-life-DzI40a 与 TLS 删除；临时HTTPS https://10.30.0.24:5173（0.0.0.0、端口5173）关闭。

`formal-safety-final.json`（2026-10-16T12:19:49.781Z）确认正式Session/native launcher/native host仍为 **2712539/55361120、2718477/83117363、2729812/83119682**，正式 **HTTPS https://10.30.0.24:8484/?mode=codex**（端口8484）及后端/Session健康均200。session:status仍ready，磁盘与运行产物不同；本批没有切换运行层或停止正式Agent，不声称所有网页或网关PID未变化。无提交/推送。

完整计划继续执行，阶段0部署门槛仍红、候选未启用。下一项重点仍为普通completed后并发Stop收尾、官方初始化关键路径及未完成的两秒/180样本与资源矩阵；本批新通过的隔离运行/Stop/继续/审批不会替代这些关卡。
