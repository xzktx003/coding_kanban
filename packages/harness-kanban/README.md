# Harness Kanban

将正在运行的 Coding Kanban 完整页面接入 DeepSeek Harness。当前面向已验证的 Harness `0.2.1-rc.4`，无新增 npm 依赖，不修改 Harness／Kanban 现有业务源码。

## 使用

1. 保持当前 Kanban 和 Harness 服务运行。插件不启动、停止或接管它们。
   若使用新的 HTTPS authority，须先在该浏览器打开转换后的完整 Harness 启动登录链接；原 HTTP Cookie 不自动作为 HTTPS 登录。未登录直接访问普通地址会返回 `dsh web authentication required`，不应据此关闭认证或重启服务。本机部署的私有登录链接位置见实施记录。
2. 在 Harness 的 Plugins 页面安装本目录的绝对路径，并启用 bundle。插件提供 `dsh.bundle.patch`，可由官方插件管理器热加载；若管理器明确提示需要重启，先安排安全窗口，不自动重启活动服务。
3. 点击右上角 **Kanban**（或经典界面左侧 **Kanban**），输入现有 Kanban 的 HTTPS 服务地址，例如 `https://kanban.example:8443`。只能填写 origin，不包含路径、查询参数、凭据或登录 token。
4. 点击“保存并连接”。地址仅保存在当前浏览器，首次进入 Kanban 时才加载页面。也可在插件设置页调整地址。

没有硬编码部署地址。当前机器实际接入地址与验收边界见 [实施记录](../../docs/designs/deepseek-harness-kanban-plugin-implementation.md)。

本机按用户约定默认使用 **HTTPS 3080**；此前临时 3443 已停用。首次登录仍使用本机私有的完整启动链接，普通地址不能替代首次认证。

完整工作台使用原来的项目、历史、运行层、终端和编辑器。切换 Harness 页面仅隐藏同一个 iframe；连接设置的取消也保留它。更换地址和显式重载才重建页面。禁用插件会卸载页面，但不会停止后台 Agent。重新进入后，页面恢复由原 Kanban 完成。

## HTTPS

局域网 HTTP 的 Harness 父页面会破坏嵌入页面的安全上下文。因此插件会提示使用 HTTPS，不在不安全父页面内加载工作台。可使用 Harness 官方 TLS 配置；已有 HTTP 服务不能重启时，本包还提供可选的独立 TLS 入口，仅转发到指定的现有 Harness。

```sh
node tls-proxy.mjs --config /absolute/private/tls.json
```

示意配置（所有地址和文件路径均由部署者选择）：

```json
{
  "host": "0.0.0.0",
  "port": 3443,
  "externalOrigin": "https://harness.example:3443",
  "upstream": "http://127.0.0.1:3080",
  "certFile": "/absolute/private/server-cert.pem",
  "keyFile": "/absolute/private/server-key.pem"
}
```

配置文件必须为当前用户拥有的私有普通文件（如 `0600`），使用绝对路径。证书必须包含外部地址且受访问设备信任；浏览器忽略证书错误仅用于验收，不能代替设备安装受信任 CA。可选 `idleTimeoutMs` 为 1000–3600000，默认 300000。

代理保留验证过的外部 Host／Origin；Harness 必须已允许该 authority。同一个 Harness 绑定 IP 的不同端口在 RC.4 可以使用；示意中的其他域名需要配置 Harness 官方 `trustedHosts`。不以 Host 重写绕过准入。

代理只连接固定上游，校验外部 Host／Origin，去除伪造转发头，仅允许 `/api/remote.mux` WebSocket；上传和响应保持流式、取消会断开对应上游连接。原有 Harness 登录检查保留；认证 Cookie 按外部 authority 隔离并增加 Secure。停用 TLS 入口只关闭其自己的连接，不关闭 Harness。

TLS 入口是可选部署组件，不是另一个 Kanban 实例。不支持从浏览器参数选择上游，也不代理 Kanban 的路径。证书更换需要重启该 TLS 入口。

## 界面和数据边界

- 通过官方 `main`、`sidebar.panellist`、`settings.plugins.tab` 插槽提供入口；持久 iframe 由自己唯一的 `shell.overlay` 列表项管理，不替换 Harness 的其他插件。
- 插件自己的 portal 固定挂在 body，提供右上角独立入口，兼容 DS Bot 隐藏原导航的整页界面。经典导航模式按主区域定位，独立入口使用带返回按钮的完整窗口。隐藏时取消内部焦点并禁用输入；展开时定位焦点，显式返回时还原焦点，不移动 iframe 的 DOM 父节点。
- 通过 iframe 的 Permissions Policy 委派剪贴板、麦克风和全屏；实际权限仍由浏览器／操作系统决定。
- 浏览器跨 origin 存储分区可能使原独立标签的本地草稿、布局与嵌入页面分开。服务端数据共用，但不复制／合并设备草稿。
- 隐藏 iframe 仍保留 Kanban 应用和连接。CSS 隐藏不等同于子页面 `document.hidden`；当前版不声称拥有跨 origin 的后台正文回收控制。
- `load` 事件不能证明上游所有接口健康；页面空白时提供独立打开／显式重载排查入口，不进行完整历史轮询。
- 首版没有 Agent 控制工具、公网或手机代理；后续设计见 [计划](../../docs/designs/deepseek-harness-kanban-plugin-plan.md)。

## 验证

```sh
node --test test/*.test.mjs
node --check client.js
node --check index.js
node --check tls-proxy.mjs
```

真实浏览器验收使用仓库已有 Playwright（不列为插件运行依赖），明确指向已运行的 Harness 和 Kanban：

```sh
HARNESS_ORIGIN=https://harness.example:3443 \
KANBAN_ORIGIN=https://kanban.example:8443 \
HARNESS_LAUNCH_LOG=/absolute/private/harness-web.log \
HARNESS_KANBAN_OUTPUT=/absolute/private/acceptance \
node test/browser-acceptance.mjs
```

脚本在新浏览器上下文中读取指定的本机启动凭据，只向同主机 Harness 认证，不输出／保存 token。先通过受控页面验证 iframe 身份、导航、草稿和设置保活，再只读连接真实 Kanban。不会发送任务、输入终端、审批、停止 Agent 或修改用户文件。脚本检查安全 API 是否存在，不替代真实麦克风授权、剪贴板读写或模型回归。

## 禁用和卸载

在 Harness Plugins 页禁用／移除 **harness-kanban** bundle。浏览器中的插件连接地址可单独删除，不处理原 Kanban 的存储和会话。若另外部署了 TLS 入口，可独立停用该服务；原 Harness HTTP 地址和 Kanban 地址保持不变。
