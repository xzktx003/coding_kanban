# 原生夹具的 daemon 与 updater 资源回收

日期：2026-10-30。本文件只约束隔离原生测试，不是正式官方服务的进程管理入口。

## 问题与根因

官方 0.165 的 `daemon stop` 会结束原生服务，却保留独立的 `daemon-updater.pid` / `pid-update-loop`。旧测试只检查 daemon PID 已退出，因而功能通过时仍留下后台维护进程。主机只读清点发现 57 个较早私有夹具的 updater；路径前缀、同 UID 或 PPID=1 均不足以取得清理权限，这些存量记录没有本次捕获凭据，继续保留，不执行扫描后批量停止。

## 新夹具所有权与清理

1. 每份夹具创建全新私有 HOME 后、启动任何官方进程前，显式调用 `registerOwnedNativeFixture(codexHome)`。校验规范目录、当前 UID、私有权限及 dev/inode，拒绝默认 Codex HOME、符号链接、已有 daemon/updater PID 或控制 socket。
2. 官方启动成功时捕获原生 PID，以及独立 updater 的 PID/start ticks、实际 executable、完整固定 argv 和原私有域。PID 文件只作定位；还须核对同次注册、实际原生连接域和进程身份。捕获对象固定且只在本测试进程的 WeakMap 中有效，不能从任意 JSON 重新构造清理权限。
3. 先向该私有 HOME 调用官方 `daemon stop`，并确认原生进程退出；随后 `cleanupOwnedNativeFixture(identity)` 只处理此前捕获的 updater。每次信号前重查目录 dev/inode、PID/start ticks、exe/argv，先 TERM，再在有界等待后按相同身份 KILL；不向进程组、正式 daemon、CLI 或其他测试域发信号。
4. 结束检查覆盖原生与 updater。独立真实资源用例额外确认 updater PID 已被系统回收，而非仅将僵尸算成正常结束。浏览器 WebRTC 夹具使用相同预注册和清理协议；首次 RPC 失败的收尾仍尝试在官方 stop 之前捕获本域身份。

## 红绿灯与边界

- `native-updater-resource-red.log`：真实私有官方 daemon 结束后 updater 仍在，原断言失败；失败夹具自行按启动时捕获身份收尾，没有增加存量泄漏。
- `native-updater-authority-unit.log`：默认 HOME、已存在服务、符号链接/公开目录，以及真实但未捕获 PID 均拒绝；三项通过。
- `native-eight-resource-clean.log`：CLI 共享、队列、队列动作、断开重连、MCP App、插件、realtime 和独立资源用例八项真实原生通过、无跳过；资源用例报告 updater monitor 为零且 PID 已回收。前后存量只读数量保持 57，不能把这项辅助计数视为对其他进程的所有权证明。
- `native-browser-helper-cleanup.log`：真实浏览器夹具服务启动到 ready，再明确 close，原生和 updater 收尾成功，子进程退出 0；这是夹具生命周期验证，不另算一次 WebRTC UI 功能验收。

日志位于忽略目录 `.dev-runtime/session-full-implementation-20261029/`。正常应用连接共享官方 daemon 的行为保持不变；本次没有停止、升级或重启正式 daemon，没有复制账号，也没有执行清理存量 57 个进程。
