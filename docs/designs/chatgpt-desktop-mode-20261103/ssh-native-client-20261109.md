# 原版 SSH 的固定 UDS 客户端

新宿主构造参数 `serverSsh:true` 才将 `{version:1}` 写入私有配置并安装 `__kanbanServerSshBridge`。默认模式不安装该对象；退休后保留已关闭对象，禁止回落到容器本地 SSH。宿主保持 control/state 与 bridge 的原有路径隔离，仅在启用 SSH 时向私有 profile 发布 `serverSshSocketPath = join(bridgeRoot, "server-ssh.sock")`；候选服务从该已验证字段创建唯一 UDS，容器内只连接 `/bridge/server-ssh.sock`。HTTP 不选择路径或连接目标。SSH child 和 UDS listener 均由候选服务的唯一 manager 持有，native 不创建第二份服务。

受控 `service-cli` 的私有配置现接受同一 `options.serverSsh` 布尔选项，原样传给新宿主；非布尔值、访问器以及自选 socket/SSH 参数均拒绝。可与既有 `accountSnapshot`、`accountSync`、`historyRoot` 组合，账号同步继续沿原启动前授权和撤销流程，不改变凭据快照规则。CLI `status` 仅在配置为 `true` 时接受上述精确 socket 字段，并保留原 broker hello、PID/start ticks 与 profile 前后核对；它不连接 SSH UDS，也不证明远端或模型可用。默认和 `false` 继续拒绝 SSH profile 字段，恢复入口仍不支持 SSH。对应 CLI 红绿用例覆盖配置、原样传递、路径和默认分支，未操作任何存活服务。

固定原 c23 的 `efr.saveCodexManagedRemoteSshConnections`/`loadRemoteConnections` 将别名保存、刷新交给该私有通道；原 `eTi.connect` 获取真实连接载体，原 AppHost 继续注册 execution host、thread catalog 和 window。原 SDK 自行生产 initialize 与 thread/list，bridge 不伪造初始化结果。每帧 2 MiB、队列 8 MiB/64 项；固定 socket 的 owner、模式、inode 和完整 profile/generation 逐次核对，不重连或重放未知消息。关窗宿主退出、控制连接断开或 scope 永久失效会关闭自有客户端，候选服务随该流关闭其自有 SSH child。

同时修复了既有编译闭包的旧 pin：host 实际已为安全 SSH namespace 版 `9714f7…`，picker/app 却仍要求 `34ab1b…`。按原有唯一补丁顺序重新计算固定摘要，未改补丁正文或放宽 hash。默认与共享完整编译、原 SDK/真实 UDS/假 SSH 往返及客户端撤销均已通过；两份原 Linux wrapper 也已实际准备，未启动。该原生客户端验收没有连接真实 SSH、读取真实密钥或发送远程任务。后续服务端仅开放三个线程动作的 allowlist 已部署到 8484；实际远端仍未连接。

私有证据与精确参数：`/data01/home/xing.hu/.cg-ssh-native-qxiy501b/handoff.json`；其中区分旧首因、pin 修复、6 项专项验证及两份 wrapper 准备结果。真实 Mac/浏览器菜单与远程宿主的整机验收仍待进行。

2026-11-09 已另起全新无账号、network=none 的原生宿主及当前工作台 HTTPS/Vite 夹具，profile 和生命周期保持有效。原版 iframe 显示 ChatGPT 登录页；在真实 iframe 焦点下各按一次 `Control+,`、`Meta+,` 后仍无 Settings/SSH 入口，未登录、改 flag 或借用旧账号。完整回执和截图位于 `/data01/home/xing.hu/.cg-ssh-ui-deqjmhow/workbench-ui-result.json` 及同目录 `settings-workbench-inspect-4.png`。本次 SSH child、SSH RPC、模型请求均为零，因此只证明真实工作台页面与宿主启动，不能算 GUI 添加/连接通过；上述原 SDK/UDS/假 SSH 组合通过证据独立保留。先前代理缺少 HTTPS 转发头及旧测试 profile 撤销分别保留首因，未复活旧代次或触碰 8484。

验收结束后，按各自完整 container ID、generation、PID/startTicks 清理本轮两只自有容器和其网关/Vite/宿主进程，测试地址已退出；证据目录及各自 `pre-cleanup-receipt.json`、`cleanup-result.json` 保留。
