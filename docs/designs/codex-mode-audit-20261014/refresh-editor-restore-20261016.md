# 避免 VS Code 重复还原后台编辑器

本项属于已授权刷新方案的隔离实施，默认正式入口不启用候选架构。它解决重复还原，不表示两秒关卡通过。

## 现象与实现

网页工作台只请求当前显示的目标，但 VS Code 会先还原自己的编辑器序列化列表。即使网页只显示一个新聊天，后台历史编辑器也会先启动。固定 code-server 4.141.0 的实际 workbench 包包含公开设置 `workbench.editor.restoreEditors`，默认 true。

`buildHostSettings` 在新宿主已显式配置且验证 refresh service/CLI 连接时设置该项为 false，再由现有网页窗口恢复流程打开目标。普通宿主保持平台默认；不修改已运行宿主、模型、reasoning、cwd 或原生权限，不改官方 VSIX、Webview MessagePort 或 iframe 父节点。缺少连接或将连接传给普通宿主会拒绝生成配置，CLI 路径仍经过校验。

本项只关闭 VS Code 的旧编辑器自动还原。`--auto-open-new-chats` 的显式首次打开语义没有改变；本轮私有夹具将自动首开关闭后，由网页显示目标。与首开模式的完整组合及候选自动启用仍需独立验收，不能据此声称所有启动模式都已只创建可见窗口。

## 失败与证据

证据目录 `.dev-runtime/codex-refresh-20261016-editor-restore/`。

- `visible-restore-red.log` → `visible-restore-green.log` 验证配置分支、普通宿主不变、未知连接拒绝及路径校验。
- `hidden-editor-red/result.json` 是单客户端诊断。草稿三项通过，但当前原生实例的公共 tabGroups 中同时存在当前新聊天和后台历史编辑器，明确以 **2 != 1** 失败；不是仅以单客户端脚本的退出码计红。
- 原生 tabGroups 只保留实例、列、viewType 和精确目标 UUID，不记录标签正文、Token 或完整 URI。严格检查使用 `NATIVE_CODEX_REFRESH_VISIBLE_ONLY_EVIDENCE=1`，必须找到每页当前实例且仅有其正确新聊天编辑器。
- 第一次三端新聊天功能回归 `newchat-controlled/result.json` 九项通过、页面错误零，但附加原生 tabGroups 取证未完成：脚本错误要求 profile 根必须是夹具根的严格子目录，拒绝本夹具的相等根。新增路径验证同时允许相等根与真正私有子目录，仍拒绝外部路径、别名和非私有目录；`fixture-root-red/green.log` 及两项单测保留。未把原来缺失的元数据算作通过。

本批三端使用同一个实际 native，新的独立 control 进程、受控 CLI bridge 和实际同源可见页面通道。原创建者/网关/前端已退出，而原 native 与授权观察器代次仍一致，重新接入时原线程为 notLoaded、loaded 列表为空，因此这是冷上下文重入，不能声称离线期间保持了热上下文。之后仅对这个私有完成线程显式 resume/订阅，没有接管默认 IPC 或停止正式 Agent。

手机按用户确认采用 Chromium 的 iPhone 16 尺寸模拟，393×852、DPR 3、触点 1、粗指针、无 hover；Safari/iOS UA 仅为配置。真实中文组合输入保留 trusted start/update，end 为非可信，不能覆盖系统键盘或硬件剪贴板。官方 IDE context tooltip 可能覆盖部分草稿，原截图如实保留，不修改 VSIX 隐藏它。

## 性能边界

最终 `hidden-editor-green/result.json` 为 **passed=true、9/9、errors=[]**。两桌面和 iPhone 16 模拟端均通过输入、并存和普通刷新；每页当前原生实例的 tabGroups 恰有一个 active 的新聊天，UUID 与该页保存的窗口身份完全一致，没有缺证跳过。手机截图显示官方本地 DOM 和独立中文草稿；原生 IDE context 提示浮层遮住部分文字也如实保留，未改动官方 UI。

`native-final.json` 只读核对原私有 thread：仍只有原先一轮 completed 消息，没有测试输入误发。原 native PID/start ticks/代次与初始记录一致，初始授权锚有效。最终宿主及适配器整组 **278/278、无跳过**（`native-compatible.log`，固定匹配 CLI、并发 4）。先关闭本轮自有宿主/网关/Vite/控制进程，再精确关闭已经空闲的原私有 native；`cleanup-final.json` 确认已知所有者进程无残留，并删除包含私有连接副本和临时 TLS 的根目录。此清理不操作正式服务。

前一私有夹具的 A/B/A/B 桌面结果保存在 `.dev-runtime/codex-refresh-20261015-restore-editors/settings-ab/result.json`。没有 CPU profiler、没有点击发送，终点只到正确可交互 composer，**不是原生接受回执或两秒验收**。

| 自动还原编辑器 | 刷新到 composer | 编辑器还原阶段 | 原生草稿 |
| --- | ---: | ---: | --- |
| true | 11694.3 ms | 2618.4 ms | 保留 |
| false | 11185.9 ms | 96.1 ms | 保留 |
| true | 14612.6 ms | 2579.8 ms | 保留 |
| false | 10579.8 ms | 99.7 ms | 保留 |

关闭重复还原缩短了该阶段，但 Webview 的创建和官方初始化仍占主要等待；这四个小样本不能作为显著改善的统计证明，更不能把 warm composer 出现当成两秒可操作。原生大消息、全部客户端自动注册/持久源/资源预算、完整官方多端审批与设置反例、长历史、180 次矩阵和 30 分钟长测仍在原目标范围内。

当前私有实验通过既有实际 Vite/HTTPS/WSS，前端绑定 0.0.0.0，临时 LAN URL 为 `https://10.30.0.24:5173`；这是诊断地址，不是源码默认或长期入口。后台仍为 loopback。最终三端严格结果、检查和清理另接持续进度。
