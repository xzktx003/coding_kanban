# 共享线程审批回复：隔离实现与验收

第四模式的共享真实线程入口仍保持 `CONTAINER_SHARED_NOT_READY`。本方案实现的是默认关闭的审批链；它不会自动连接既有线程、提交普通消息、重启或停止任何 Agent。此阶段仅支持原生 `item/commandExecution/requestApproval` 和 `item/fileChange/requestApproval`；其他审批与问答类型继续拒绝。

## 授权和投递

固定 Mac 原包的 `pending-request-item-panel-cef204561ca3.js` 有两条明确的批准和拒绝回调。仅在服务端显式启用共享资源适配时，固定哈希补丁在原回调同步栈中捕获视图代次及原请求的 host、thread、request 和 item，随后保留原审批组件和决策值。原版可在发送前进入异步 nudge，因此捕获点必须早于这一步；模式隐藏、视图失效或代次变化后不得继续写出。普通隔离模式保持原资源路径。

原宿主只处理属于当前已连接视图的单次意图。真实 daemon 的待审批事件提供原始 request ID、thread ID、turn ID、item ID 和方法；服务端最终写入前再同步核对这些值、账号修订、daemon/native 代次、项目、view 和 client。相同 item 上不同 request ID 保持独立。未知决策类型拒绝；命令和网络策略修订必须与原请求建议一致。每次动作及原审批至多写一次，未知回执不得重发；原生 `sendResponse` 旁路保持阻断，完成后保留有界 tombstone。

写出后等待真实 `serverRequest/resolved`。该事件证明请求已解决；在多个客户端并发处理时，它本身不能证明哪个客户端或哪个决策导致解决。单条审批决策最多 64 KiB，待审批身份及策略提案的保留元数据总计最多 8 MiB；原始 daemon 事件仍遵守既有传输预算。超限失败关闭，不扩大预算。

## 固定资源和链路

Mac 参考包 SHA-256 为 `bb88615052255e79b5977885f9a0cc212c268589587c79d4d3b7c4b46e881a95`。审批资源原始 SHA 为 `2a3129cf4465d9d024e07f7d83b7d0c6a6e0cec913babcb68efb523d5434dbd1`，补丁后为 `0a8e10719f7623e7df27e678fa7fa6cc2b7420a17194e56d3e7ef637816f03ad`。共享适配共四个资源；项目创建适配加入一个固定资源后，组合最多九个，新增资源上限为 64 KiB，其余资源各不超过 512 KiB，并发适配响应租约上限仍为 4 MiB。资源均按固定名称和哈希校验。

实现分别位于 `packages/chatgpt-desktop-host/src/shared-thread-approval.cjs`、`shared-thread-authority-channel.cjs`、`shared-thread-authority-wire.cjs`、`native-shared-thread-integration.cjs`、`browser-shared-thread-navigation.mjs` 和 `shared-thread-navigation-assets.mjs`。类型固定的 `shared-approval` 只经已拥有的私有通道传输；不可通过 HTTP 选择主机、socket、命令或 daemon。

## 验收证据与边界

- 最终固定审批源码的私有 alpha `0.166.0-alpha.5.1` 和 stable `0.166.0` 双客户端测试各通过：原 owner 的运行轮次和队列保持，第二客户端明确拒绝同一个待审批请求一次，原 owner 收到同一轮完成；未登录，未使用真实 daemon。日志分别为 `/tmp/chatgpt-shared-approval-native-alpha-final-20261105.log` 和 `/tmp/chatgpt-shared-approval-native-stable-final-20261105.log`。
- 整合代码的 64 项组合测试通过，包含原资源哈希、私有 wrapper、请求身份、跨 scope、重复、未知回执、过期和写入重入边界，日志 `/tmp/chatgpt-shared-approval-integrated-combination.log`。
- 随后项目目录 guard 合入后的固定源码再次通过 66 项组合检查，包含原 Linux 包 wrapper、原 Mac 资源及审批策略，未跳过；包 `check` 通过。日志为 `/tmp/chatgpt-shared-approval-final-combination-20261105.log` 和 `/tmp/chatgpt-shared-approval-final-check-20261105.log`。该组合的 `native-bootstrap.cjs` SHA 为 `4dd9a8d6f364d3a131abfb6f38fdfad588745f2456b7e8d19ccd06eb7399ae71`，`native-shared-thread-policy.cjs` SHA 为 `80ef8a64824d7aa824ac674c45ee5f5c3fd2e1f282195c063338a0e4c1fb1550`；此轮没有重跑真实原版界面。
- 项目目录 guard 随后补充对已保存的无效或显式空默认目录的识别；以最终源码重跑上述原包 wrapper、资源与审批组合，66/66 通过、0 跳过，日志 `/tmp/chatgpt-shared-approval-new-guard-combination-20261105.log`。该次 `native-bootstrap.cjs` SHA 为 `26ab171e5fe4f91154ec5c274d0ec41f95deda832970687777f7b33a2d318812`，`native-app-policy.cjs` 为 `18d1e812163739e8f5d91b864fb05ee261639e650db4e71a32bd911e1e2f8374`，`native-shared-thread-policy.cjs` 为 `807aeb3598038e30412987b63107bf36ec7c63b5b46a7c899a22c286de9af430`。这是组合回归，不是最终源码的完整原生审批界面验收。
- network-none、无账号的隔离 Chromium 私有双客户端测试中，直接加载固定 Mac ASAR 的完整原版 `PendingRequestItemPanel` React 组件，可信点击走原版审批面板与回调；错误 item 被拒绝，正确原始请求只投递一次并收到真实解决事件。alpha 和 stable 分别记录在 `/tmp/chatgpt-shared-approval-original-panel-gui-alpha.log` 和 `/tmp/chatgpt-shared-approval-original-panel-gui-stable.log`，两次测试使用同一源码清单 `08341a2e6d417ffb86dbf49926b1dee703ace48e7565e07550fc39b595f5d77f`。夹具代替外围 AppHost、视图生命周期 ACK 和 renderer 到 native 的传输，**不能作为完整 Electron 原界面验收**；文件修改审批也尚未做真实 daemon 测试。
- 单独的一次 stable 文件修改审批尝试没有通过：隔离 provider 收到的工具目录中没有 `apply_patch`，故未产生文件修改审批事件，等待后超时。日志 `/tmp/chatgpt-shared-file-approval-native.log`；该自有轮次已结束，其 daemon 和夹具目录已由测试清理，容器内只余 supervisor 时再关闭容器。该结果不是文件修改审批的实现验收。

在启用共享入口前，还须使用最终组合源码完成实际原界面和完整进程桥接验收，并补齐共享初始化、配置 override、事件/订阅、其他审批类型等各自能力。任何验证均须使用全新自有无账号环境，不接默认 CLI IPC 或用户任务。
