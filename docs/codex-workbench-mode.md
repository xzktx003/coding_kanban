# Codex 工作台模式

应用保留会话与终端模式，新增独立 Codex 模式。原生 Codex 插件的适配与后续多窗口开发放在 `apps/web/src/codex-mode`，不替换会话模式的 renderer、草稿或 Agent 状态。顶栏共用三模式切换；`?mode=codex` 可以直接进入，本设备保存选择，三个工作区访问后保留挂载状态。

## 实现边界

未修改的官方 VSIX 由 `packages/native-codex-host` 的独立 code-server 宿主运行。自有伴随扩展负责显式打开两个隔离 fixture 面板，默认不自动打开；启动时加 `--auto-open-fixtures` 才启用。原版插件和伴随扩展单独安装，后续升级官方插件需要重新核对命令、DOM 与协议契约。

Node 网关只从本机环境配置读取上游和 owned0600 运行记录。`GET /api/native-codex/status` 只返回可用状态、版本、界面 URL 与 fixture 标识；私有 broker 凭证不进入浏览器。`/native-codex/` 提供同源 HTTP/WebSocket 代理，校验浏览器 Origin 与实际 Host；原生路由使用独立方向限制：浏览器发来的单消息及待发队列各 8 MiB，宿主返回的单消息及浏览器待发缓冲各 2 MiB（上游连接完成后，待发达到 256 KiB 即暂停继续接收；握手期间队列也有 8 MiB 上限），保留终端既有接收限制。此上游无子协议需求，因此带子协议的握手明确拒绝。HTTPS Vite 转发保留 Host 并传递协议。

Codex 页面只展示原生 webview 窗口：自有适配样式隐藏宿主 IDE 外框、按窗口数量铺开。原生 iframe、父节点与 MessagePort 保持原位，既不复制 webview 正文也不修改插件。后台仍加载 IDE 运行框架，因此不承诺它与独立聊天页具有相同内存成本。隐藏模式暂停 DOM 观察器，保留原生 iframe；状态请求仅进入时或显式重试发生，不做周期轮询。

## 开发与部署

在被忽略的 `.env` 配置 `NATIVE_CODEX_UPSTREAM_URL` 和 `NATIVE_CODEX_RUNTIME_RECORD`；前者必须是明确的 loopback HTTP 地址，端口匹配运行记录，后者为启动器生成的记录。不可从请求参数选择主机或文件路径。上游、broker 端口和各运行目录全部由启动参数配置。

开发入口继续使用 `pnpm dev` / `pnpm dev:restart`。正式应用中选择 Codex 或打开 `?mode=codex`，不向用户提供裸 IDE 作为入口。当前联调地址：**HTTPS https://10.30.0.24:8484/?mode=codex，端口 8484**；地址属于本机部署记录，不是源码默认值。用户已要求关闭站点密码，此部署显式使用启动器的无认证选项。已有会话运行服务及 Agent 不因原生宿主启动或网关热更新而停止。

## 最小验收与阶段范围

- 模式选择、URL/设备偏好、隐藏工作区保留与焦点恢复由导航红绿灯测试覆盖。
- 代理测试覆盖元数据过滤、路径/端口、跨站请求、HTTP/WS、握手取消、分片大小和子协议拒绝。
- 伴随扩展覆盖显式自动打开、取消、并发锁、监听冲突与监听建立期间关闭。
- Codex 页面覆盖同源 URL、不可用状态、无轮询与 iframe 保留；surface 测试核对原 iframe/父节点/窗口身份与样式恢复。
- 真实浏览器验收使用隔离 Codex HOME 和两个空 fixture，检查官方登录页、同源资源、窗口尺寸和模式切换。此阶段不代表真实登录、发送/流式回复、审批、中断、看板窗口组和公共输入已完成。云任务继续延期。

运行 `pnpm check`，及 `pnpm --filter web exec vitest run --config vitest.session.config.ts src/codex-mode`、网关与宿主对应测试。真实宿主测试可按 `tests/e2e/native-codex-mode.spec.ts` 的环境开关运行；不得通过恢复正式线程或停止活跃 Agent 代替隔离验收。

## 初版验收记录（2026-10-12）

主分支已部署到上述 HTTPS LAN 入口，站点密码关闭。真实 Chromium 使用当前开发证书的 SPKI 信任配置，未复用用户浏览器、账号或正式线程；实际两份官方登录页在桌面与 390px 视口中可见，宿主菜单已隐藏。两个原 iframe 保持原父节点；自有容器标记解除宿主编辑器的 `clip-path`/overflow 裁剪，清理按共享窗口引用计数恢复，只调整自有属性与样式，不改原 inline 几何。

隔离原生 E2E 已通过双页面、窗口尺寸、30 秒无原生连接关闭、会话/终端切换的 iframe 身份保持与刷新恢复。浏览器与生产构建按顺序执行，避免 shared 编译触发网关热更新干扰稳定性测量；编译不停止会话运行服务或 Agent。源码测试还覆盖实际窗口命中区域，防止只凭 DOM 可见性误判画面可见。

`pnpm check` 与 `pnpm test` 已通过，初次完整测试记录为 3,660 项通过、1 项跳过；后续传输/绘制修复分别通过最新网关 19 项、Codex UI 10 项和独立复审。宿主与适配器共 72 项通过。单独额外运行旧 `app.vscode-web-proxy.test.ts` 仍有一个既有 HTTP/HTTPS 期望不一致，该文件没有改动，也不属于当前 `pnpm test` 的路径范围；没有以删除断言代替通过。

官方安装产物 `out/extension.js` 与本地原包摘要一致：`bc0b44429768ea49c559c6a5524dcd710c500d6193f3bfe62c81cab75c18661c`；官方 VSIX 摘要保持 `c5f534abf7dd1f08330483b5db6754001f2ad452096fc8e63925e597d3761373`。这证明本轮未改该原版宿主代码及 VSIX，不代表跨版本升级已验收。实际发送、流式回复、登录/OAuth、审批、中断、附件、窗口组与公共输入、物理手机及长期内存验收继续保留为后续范围；初版提供独立原生开发入口。
