# 桌面应用桥接：REA 静态证据与运行边界

本文记录对用户提供的 Mac 应用和隔离研究使用的 Linux 应用所做的桥接分析。它是实现方案的证据输入，不是已经实现兼容或完成 1:1 验收的声明。分析未执行 Mac 程序、修改原包或操作正式 Agent。

## 样本与可复查材料

- Mac：[app.asar](../../../third_party/ChatGPT.app/Contents/Resources/app.asar)，应用 `26.1027.61615`、build `24141`；ASAR SHA-256 `bb88615052255e79b5977885f9a0cc212c268589587c79d4d3b7c4b46e881a95`。
- Linux：[app.asar](../../../.dev-runtime/chatgpt-linux-audit-20261103-7jyjn55e/extracted/usr/lib/chatgpt/resources/app.asar)，[包控制信息](../../../.dev-runtime/chatgpt-linux-audit-20261103-7jyjn55e/evidence/deb-control.txt)中的版本为 `26.1027.51404`；ASAR SHA-256 `1588e6a0e1dcfc615060152ef264d4adf2c3ff6bb7496986c72163b5853e2a2e`。两者版本不同，Linux 运行结果不能直接视为 Mac 实机结果。
- [聚焦成员清单](../../../.dev-runtime/chatgpt-linux-audit-20261103-7jyjn55e/evidence/rea/manifest.json)记录父 ASAR、成员路径、字节数、SHA-256 及零基 ASAR 绝对偏移。SHA-256：`5e9057fa76e15afd5f76c1f8ff0e38c6e9314a55c9359333811a720bb1e531fc`。其中 `/tmp` 提取路径是当时的临时工作路径，不保证永久存在；成员可按父包和偏移重新核对。
- [REA 证据包](../../../.dev-runtime/chatgpt-linux-audit-20261103-7jyjn55e/evidence/rea/evidence-with-comparison.json)含 21 条记录，大小 344,530,017 字节，SHA-256 `4cd31d73a0def43d8bd249ce6681c3953b70cad1bac446eedf9ffad2ea3f9da5`。目录权限为 `0700`、文件权限为 `0600`；`.dev-runtime` 被 Git 忽略，材料仅在保留本机研究目录时可用。导出结果里的 ledger unknown 数不是语义覆盖为零的证明。

所有成员的提取字节都与各自 ASAR 元数据中的成员 SHA-256 一致；分析使用每个成员独立的临时目录。完整 ASAR 不在这些单文件图中，成员内未解析的依赖不能解释为依赖在原包中不存在。

## 聚焦模块

| 样本及成员 | 成员 SHA-256 | REA parent Evidence | 覆盖边界 |
| --- | --- | --- | --- |
| Mac 与 Linux `.vite/build/preload.js` | 两包均为 `aa8be920fd14a9b98eca16c91d97a55105b196698fda36d5063e966620a0c54a`，7,027 字节 | `ev_8d30fc85339d43520975e100a82c5943c7fda8f66d21583c9f7065e71e915d7f` | Mac 成员 1/1 完成解析；application coverage **partial**，semantic **unknown**，394 项 semantic unknown。Linux 对应成员字节相同，但此证据不验证平台原生依赖及运行行为。 |
| Mac `webview/assets/connect-app-host-2c1800fa8f03.js` | `a3a327f26f9f068ed933e18b58db297ee424b7dae29901a384308a2e44bb239b` | `ev_04949159c46bd81466a95b70f1f2976a5b99235f619da12501050e9417b3b456` | 单文件 application coverage complete；semantic unknown 18。导入的共享模块不在单文件输入中。 |
| Linux `webview/assets/connect-app-host-a98f43cf0d03.js` | `5b9297cf96836c73cb3006ae78ca8894379ef47027d98f9b2bb635e47d8a59e9` | `ev_dfe588830170af1eae6d065ef0efd583d570fdb0b06b273ff13b642774ad1185` | 单文件 application coverage complete；semantic unknown 18。导入的共享模块不在单文件输入中。 |
| Linux `webview/assets/rpc-d8f3b0083493.js` | `5012c81e7aafcc3d9cca24d9c3711f4af2914683f3176da952029fad8fc8ee07` | `ev_4e161e216402685cb18997911bd67291018e343ecb4a149ed14ec1b263d47a9b` | 单文件 application coverage complete；semantic unknown 6。该成员是 `appHost`、`appServices` 及设置函数的重导出，不能当作完整 RPC 实现。 |

这里的 `complete` 只描述指定单文件输入的 application 图，不能推广为整个桌面应用或所有语义路径已覆盖。REA 记录的静态调用与导入关系不证明实际执行。

### 可观察的桥接结构

1. 两份 `connect-app-host` 成员均包含创建 `MessageChannel` 的代码；页面向当前 origin 发送 `type: connect-app-host` 和 `port2`，再把 `port1` 交给导入函数。两个完整成员的 SHA 不同，其各自成员内零基 `[115, 263)` 的 148 字节相同，片段 SHA-256 为 `f767f4608eac8fd806b8520567d4825250e11021f9b14acecdc5951ec1fb9a6c`。被调用的导入函数及依赖不同，不能由这段相同字节推导完整行为等价。
2. 两包字节相同的 `preload.js` 中，可观察到检查消息来源和 `connect-app-host` 类型后，通过 `codex_desktop:connect-app-host` 转发端口的代码；它还包含 `electronBridge`、系统主题、视图消息与 Git worker 等桥接候选。REA 在该单文件中静态识别 3 个 contextBridge 暴露对象、27 个 IPC 操作及 18 个字面 channel；图为 partial，部分通道未配对，这些数字不是完整功能清单，也不证明主进程已注册相应处理器。
3. 两个 `connect-app-host` 单文件图的 REA 比较 Evidence 为 `ev_e38cd0e2d12ca5613e31ded6c52846d8d29359b0e8481a8cb15715a9cb4fa8a7`。比较没有建立精确摘要、source-map 或结构指纹配对；报告的 unmatched/added/removed 限于这两个隔离输入，不能解释为功能新增、删除或应用整体不兼容。

## 与运行证据的关系

另一次隔离 Linux 运行的[直接 CDP 脚本记录](../../../.dev-runtime/chatgpt-linux-audit-20261103-7jyjn55e/evidence/native-runtime-scripts.json)包含 `app://-/assets/connect-app-host-a98f43cf0d03.js`，所捕获的 383 字节 source SHA-256 为 `5b9297cf96836c73cb3006ae78ca8894379ef47027d98f9b2bb635e47d8a59e9`，与上述 Linux ASAR 成员一致。这个比对说明记录到的脚本字节与该成员一致；它不证明桥接函数被调用、登录后流程可用或 Mac 行为相同。运行环境、启动状态和后续交互以独立运行记录为准。

REA 的 `list_electron_targets` 对该 `app://` 目标报告不支持的 URL，`list_javascript_runtime_targets` 对所见位置报告不支持；因此本次没有对该目标完成 REA runtime reconciliation。上面的运行 source 比对来自直接 CDP 记录，不能表述成 REA 被动运行观察或 REA 跨层验证。

## 全包扫描与完整性限制

Mac ASAR 首次 REA 全包分析因解包原生成员完整性矛盾而拒绝；随后使用 `record-and-continue` 显式保留矛盾。客户端调用等待 300 秒超时后，从同一 REA 会话找回部分 parent Evidence `ev_e87282ac95e587953df2412dec1c791886b5c1983900a494c433a875ae7f2aef`。summary 显示 17,534 个相关文件，只有 2 个 JavaScript 文件完成 AST 解析；一个 worker 的语义分析耗尽 1 GiB 堆，另一源文件达到 60 秒分析上限。全包 application 与 semantic 覆盖均为 partial，不能根据未观察到的项得出功能不存在。

REA 报告的 7 个 unpacked 原生成员与 ASAR 声明摘要存在矛盾：

- `node_modules/@worklouder/device-kit-oai/node_modules/@worklouder/wl-device-kit/dist/native/darwin/permissions.node`
- `node_modules/@worklouder/device-kit-oai/node_modules/@worklouder/wl-device-kit/node_modules/node-hid/prebuilds/HID-darwin-arm64/node-napi-v4.node`
- `node_modules/@worklouder/device-kit-oai/node_modules/@worklouder/wl-device-kit/node_modules/serialport/node_modules/@serialport/bindings-cpp/prebuilds/darwin-x64+arm64/node.napi.node`
- `node_modules/better-sqlite3/build/Release/better_sqlite3.node`
- `node_modules/node-pty/build/Release/pty.node`
- `node_modules/node-pty/build/Release/spawn-helper`
- `node_modules/objc-js/prebuilds/darwin-arm64/node.napi.armv8.node`

矛盾原因未知；签名、打包过程或复制差异均需独立验证，不能直接断定完整或损坏。它们也不改变已单独核验的 packed JavaScript 成员哈希。
