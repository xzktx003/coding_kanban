# 原版 SSH 别名发现（2026-11-07）

工作树已增加服务端 SSH 配置发现，默认关闭，未切换主 8484。连接发起方按用户选择为看板服务器。这里只实现原版设置页的别名列表；添加连接、启动远程宿主和远程模型尚未完成。

工厂显式配置 `sshDiscovery: {configPath, nativeMainChunkFile, homeDirectory?}`。CLI 对应 `CHATGPT_DESKTOP_SSH_CONFIG_FILE`、`CHATGPT_DESKTOP_SSH_NATIVE_CHUNK_FILE` 及可选 `CHATGPT_DESKTOP_SSH_HOME_DIRECTORY`；全部为私有服务端配置，HTTP 不接受路径、主机或命令。固定 Mac/Linux 原件校验后，仅复用原 SSH parser/discovery 的只读文件能力，不运行 `ssh -G`、Match exec、ProxyCommand 或任何连接命令。未知归档/原件摘要、实例变化、读取失败及超预算明确拒绝，不伪造空列表。已在 Node 24.22.1 验证，缺少 `fs.globSync` 时明确拒绝启用。

固定原版 Settings 资源仅替换 discover 调用，沿用原 `{sshAliases: string[]}` 和原列表组件；同源服务端路由为 `GET /api/chatgpt-desktop/:id/:generation/ssh/discover`，前后复核完整 profile。原生 Add/Connect 边界保持，不能据发现成功自动接通远程。

## 实际原版界面验证

独立受信任 HTTPS 候选 **https://10.30.0.26:8531/?mode=chatgpt&view=agent** 使用相同已核实的私有 native，未新建/重启 native，也未影响 8484。打开 profile menu → Settings → Connections，先选择 **SSH** 子页，再点该页 Add；Connections 默认页的 Add 是设备连接引导，不能混用。

原版 **Add SSH Connection** 对话框已显示 `server-demo-include`、`server-demo-server-only`，与服务端临时配置及 Include 文件一致。配置位于 native 挂载范围之外，浏览器实际唯一发现请求返回 200 和两个精确别名；无额外工作台登录 Cookie、bridge 错误或页面异常。没有点击对话框内的 Add/Connect，没有模型发送或 SSH 连接动作。测试配置不代表真实远端。

私有完整结果：`/data01/home/xing.hu/.cg-ssh-ui-s9os_uj0/real-ssh-discovery-ui-result.json`，实际截图 `inspect-8.png`。同目录保留首次开发服务端口/线程失败、默认子页误选及异步观察回执先后顺序的首因，未通过重复连接或放宽原生约束制造成功。

实现补丁与原件/HTTP/资源红绿灯：`/data01/home/xing.hu/.cg-ssh-alias-aldq5jdx`；集成前备份及保护文件校验：`/data01/home/xing.hu/.cg-ssh-integration-wr01gx46`。源码、原包与候选类型检查通过；该能力仍只在显式候选启用。

## 2026-11-08 主地址复核

主地址 `8484` 的固定 SSH discovery 路由当前返回 `503 SSH_DISCOVERY_UNCONFIGURED`。服务器配置文件权限为 `0600`；使用匹配固定 Mac ASAR SHA `bb886150…e881a95` 的原始 parser 成员 `c23f63f8…e11d333` 做本地只读解析，结果为 `configState:ready`、2 个别名。报告只保留数量，不记录别名、路径内配置正文或密钥；未调用 SSH、未连接远端。此结果证明服务端配置可被原版 parser 发现，不证明 8484 已接入 discovery，也不证明 Add/Connect 或远程任务可用。

候选服务注册门槛现额外接受 `sshDiscovery + splitPane + sharedThread` 对应的固定 11 项资源组合；测试同时覆盖任一资源被替换时拒绝启动。此修复只解除候选启动清单冲突，不会自动配置或替换 8484。

使用当前有效 profile、服务器 SSH 配置和固定原版 parser，在未监听端口、未连接 native/远端的隔离 Fastify 实例中执行真实 HTTP handler，返回 200、`configState: ready` 和 2 个别名。主地址 8484 的在线路由仍为 503，隔离 handler 结果不计为上线或远程连接验收。

进一步通过 `createChatGptDesktopCandidate` 组合验收：固定 `splitPane + sharedThread + sshDiscovery`，绑定当前有效 profile，状态、SSH discovery、原版 Connections Settings 资源分别返回 200；资源确实调用服务端 discovery，别名数为 2。实例没有监听端口，也没有打开 native WebSocket 或连接远端。在线 8484 仍未配置该能力。
