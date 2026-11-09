# SSH 远程项目目录选择（2026-11-09）

原版 Codex 的远程项目选择器通过 `workspaceFiles.browseDirectory` 读取目录元数据和子项。SSH 网关此前拒绝 `fs/getMetadata` 与 `fs/readDirectory`，原版弹窗因此一直显示加载后失败。

网关转发这两个只读方法。请求必须带有效 JSON-RPC ID，`params` 只能包含一个规范化的绝对 POSIX `path`（最长 4096 字符且无控制字符）。为支持原版“创建文件夹”确认，又显式增加 `fs/createDirectory`：只接受有效 ID 和精确 `{path, recursive?}` 参数；路径必须是规范绝对 POSIX 路径且不能是 `/`，`recursive` 仅能为布尔值或 `null`。其他写方法仍拒绝。既有 2 MiB 单帧和 8 MiB 队列上限不变；无效请求返回 `-32602`。

## 实际验收

- `https://10.30.0.26:8484/?mode=chatgpt&view=agent` 返回 200，原版 Codex 界面加载。
- 在原版新建项目弹窗的 `Project device` 中明确选择 `hm21`，按钮显示 `Add a folder on hm21`；原版目录选择器显示 34 个目录项，没有加载错误。
- 在隔离的随机 `/tmp` 路径上，原版“创建文件夹”确认和随后“信任此文件夹”确认均已完成。项目弹窗返回最终确认状态，但项目没有出现在侧栏，`remoteProjectCreated=false`。
- Mac 原版 `ProjectsManager.createRemote` 会等待 `confirmProjectFolders` 成功后才写入 `REMOTE_PROJECTS`。当前证据只能证明目录创建和信任交互，不证明项目已保存；没有创建远端线程或发送模型消息。
- 私有验收目录中的 `ssh-remote-folder-after-fix-20261109.json`、`ssh-remote-project-chat-acceptance-20261109.json` 和截图保存了脱敏状态与画面，文件权限为 0600。

服务回归先在未实现时复现 `SSH_METHOD_UNAVAILABLE`，再验证真实 UDS→SSH 子进程逐帧转发、无效路径拒绝，以及 `fs/readFile` 和其他未授权写操作仍被拒绝；27 项定向用例通过。完整 server 类型检查另有既存错误：`src/routes/session-mode.test.ts:443` 的 `Uint8Array | undefined` 类型不匹配，与本次文件无关；单文件类型检查通过。

## 尚未完成

远程项目保存的现场验收需要原版宿主窗口。宿主 Chrome 位于独立网络命名空间，当前工作区无法连接其 CDP；普通 Playwright 新上下文能加载 8484 外壳，但原版 ChatGPT iframe 没有挂载 composer/AppHost。X11 枚举也未找到可确认属于本任务的 ChatGPT 窗口，屏幕上有另一个文件选择流程，因此没有发送鼠标或键盘事件。不要重复用普通浏览器或该显示器点选并据此声称项目已保存；应从宿主自有窗口继续捕获 `confirmProjectFolders` 的真实返回和 `projects.createRemote` 的最终结果。

补充宿主证据：官方 `control.sock` 只读握手核对了当前 profile/PID，`projectPersistenceStatus=active`。经 `connectDesktopControl` 创建的唯一临时 view 返回 `windowType=electron`，收到 3 条宿主 `viewMessage` 后关闭连接，view 随之销毁；没有创建线程或发送消息。该握手证明宿主持久化和视图启动可用，但尚未证明用户可见 ChatGPT 页面已挂载。

这只验收目录浏览；项目创建、远端 Codex 线程收发和文件读写仍需单独真实验收。
