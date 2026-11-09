# 第四 ChatGPT 桌面模式暂停进度（2026-11-09）

## 当前状态

- 用户要求暂停第四 ChatGPT 模式开发并隐藏入口。`WorkbenchModeSwitch` 现在只显示“会话、终端、Codex”；`mode=chatgpt` 深链、模式代码、服务和已有数据保留，便于后续接续。
- 本次没有重启网关、原生宿主或 8484。`https://10.30.0.26:8484/` 返回 HTTP 200，监听进程是本仓库 Vite 开发页；前端源码改动由 HMR 加载。
- 已停止尚未启动的 `local_snapshot_capacity` 子 Agent。其他已结束的协作任务和正在运行的服务均未清理。
- 用户要求助手创建的测试对话在使用后删除。本次没有创建对话线程；隔离容器探针已删除。

## 已有进度与证据边界

- 既有验收记录称 8484 原版 Codex UI 已完成两轮真实本地文字收发，本地 Create project/Trust UI 也通过。该证据不代表 SSH 远端或文件工具已通过，见[核心工作区进度](core-split-usable-20261106.md)和[8484 核心验收](main-8484-core-20261106.md)。
- SSH 项目选择器在 8484 上能显示 hm21 的 34 个目录；在随机 `/tmp` 目录上完成了创建和信任交互。但侧栏没有出现项目，`projects.createRemote` 是否持久化仍未确认；没有因此创建远端线程或发送模型消息，见[SSH 远程项目目录选择](ssh-remote-project-picker-20261109.md)。
- SSH 桥的代码已实现受限 `thread/start`、`thread/resume`、`turn/start` 转发及绑定活动原生请求的 command/file/permission 审批回执。相应验证使用 UDS/假 SSH；真实 SSH 主机、远端线程、真实模型回复和远程审批仍未验，见[SSH 服务端桥接](ssh-server-bridge-20261109.md)。
- 原生 `control.sock` 只读握手报告 profile 身份匹配、`projectPersistenceStatus=active`。一次临时宿主 view 返回 Electron bootstrap 并发出三条 `viewMessage`，关闭连接后 view 销毁。该结果证明宿主持久化状态和 view 启动接口可用，不证明浏览器中原版页面已挂载或可以创建线程。
- 最新隔离 bwrap 探针保留了网络关闭、非 root、只读根、cap-drop ALL、no-new-privileges、私有 PID/IPC/cgroup 和受限 seccomp。它通过 user/PID namespace、根挂载传播、临时 tmpfs、newroot bind 和 `pivot_root`，随后在 `/oldroot` 到 `/newroot` 的递归 bind 处收到 `EACCES`。探针容器已清理；文件工具沙箱尚未通过。暂停期间不继续追加宿主权限规则。

## 尚未完成

1. 通过安全隔离运行原版文件工具，并验证真实读取/修改行为；不得使用 privileged、unconfined、伪造响应或隐藏错误来绕过沙箱。
2. 完成远程项目创建持久化，然后在真实 SSH 主机上走通 `thread/start → turn/start → 原生模型回复 → 同线程追问`。
3. 对真实远程审批、项目文件访问、原生 UI 和登录后恢复做实际验收。目录列表、假 SSH、页面显示和单测都不能替代真实收发。
4. 分屏、云任务/云工作区和完整 ChatGPT Mac 视觉对照仍在总目标内，首轮核心链路未闭合前不视为完成。

## 后续接续顺序

1. 用户明确恢复后，先检查当前工作树、8484 和原生宿主身份；保留现有任务、服务、数据和他人改动。
2. 先解决上面记录的 bwrap 最后一个拒绝点。沿用隔离约束；如果精确策略不能通过，改用等效安全的运行环境，不放宽为 privileged/unconfined。不要在用户暂停期间重载或扩展宿主策略。
3. 继续原版 UI 的 `ProjectsManager.createRemote` 路径，捕获项目持久化结果；随后用一次性隔离项目验证远端线程和真实回复。
4. 每次只删除本任务新建并已确认结束的测试对话/临时项目。保留真实用户线程、运行任务和工作区数据。
5. 最终交付前重新核对 8484 可访问性，并给出可复现操作和真实完整收发证据。

## 主要代码与参考

- 前端入口：`apps/web/src/components/WorkbenchModeSwitch.tsx`。
- 第四模式：`apps/web/src/chatgpt-mode/`。
- 宿主与控制协议：`packages/chatgpt-desktop-host/`。
- SSH 项目浏览与创建记录：[目录选择验收](ssh-remote-project-picker-20261109.md)。
- SSH 原生 RPC 桥：[服务端桥接说明](ssh-server-bridge-20261109.md)。
- 整体目标与历史审计：[第四模式执行方案](development-plan.md)。
