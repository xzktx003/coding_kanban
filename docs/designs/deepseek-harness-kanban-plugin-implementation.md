# Harness Kanban 首版实施与验收

日期：2026-10-28。对应 [已确认计划](deepseek-harness-kanban-plugin-plan.md)。当前交付为首阶段页面插件，原有 Kanban／Harness 业务源码未修改，Agent 工具、公网和手机不在本版内。

## 已实现

- 独立 bundle：`packages/harness-kanban`，版本 `0.1.0`，兼容范围固定为已验收的 Harness `0.2.1-rc.4`，没有新增 npm 依赖。
- 官方导航／页面／设置插槽和持久 overlay；插件自己在 body 建立固定 portal，保留同一个 iframe，兼容 DS Bot 隐藏原导航的整页界面。
- 右上角独立入口、返回 Harness、经典侧栏入口、连接设置与独立打开。打开定位焦点，显式返回还原焦点；普通切换不重建 iframe，不操作当前 Agent。
- 当前浏览器保存版本化的 Kanban origin；拒绝非 HTTPS 局域网目标、带凭据／路径／查询／fragment 的地址和 Harness 自引用。存储被禁用时本次仍能连接并说明未保存。
- HTTPS 安全祖先检查和剪贴板、麦克风、全屏的 iframe 权限委派。跨 origin 无法把 iframe `load` 当作业务健康信号，故无自动历史轮询或任务重试。
- 可选独立 TLS 转发器：Node 内置模块、固定 HTTP 上游、严格外部 authority／Origin、清理伪造转发头、Secure 认证 Cookie、限定 Harness WebSocket 路径、流式上传／SSE／取消与连接清理。

## 本机部署

当前默认入口：**HTTPS `https://10.30.0.28:3080/`**。2026-10-28 用户要求统一使用原来的 3080 端口，已改用 Harness 官方原生 TLS 启动参数，临时 3443 入口已停用。未创建另一个 Harness 或 Kanban 实例。

**首次使用须先打开完整私有登录链接。** 直接点击上面的普通地址，新浏览器会显示 `dsh web authentication required; reopen the URL printed by dsh web.`，这是认证检查，不是服务启动失败。在服务器终端执行 `cat ~/.local/share/harness-web/kanban-plugin/open-url.txt`，将输出的完整网址复制到要使用的浏览器打开。登录成功后地址会自动去掉登录参数，之后即可使用普通地址。私有链接不要放入公开文档或仓库。

2026-10-28 用户反馈认证提示后，先在临时 3443 入口复验完整链接 200、自动去除参数、Secure Cookie 和后续普通地址 200。当时未重启服务或放宽认证；之后按用户要求将默认入口统一至原生 HTTPS 3080，并重新生成私有链接。

- 3080 端口保持不变，协议改为 HTTPS；原 `http://10.30.0.28:3080/` 不再作为入口。首版插件安装未重启主服务；本次原生 TLS 切换在两次确认 51 个会话均无运行轮次、无后台 job 后，重启了同一 `harness-web.service`（PID `2551424` → `3123758`）。核对会话 ID 保留、插件共 220 项、稳定插件 ID 保留；两个匿名运行期 ID 正常重新生成，Kanban 插件仍为 active。空闲检查不宣称为跨客户端原子准入锁。
- 现有 Kanban HTTPS `https://10.30.0.28:8484/` 继续使用。插件首次使用时在当前浏览器填写这个地址，不将地址硬编码进源文件。
- 插件通过官方 `pluginManager.installBundle` 安装本地链接并启用；实际 `pluginManager.listPlugins` 返回 `include:harness-kanban` 为 `active`，并非仅检查依赖存在。HTTP 客户端曾等候超时，随后按原操作结果核对完成，未重复安装。
- 原临时 `harness-kanban-tls.service` 已 disable 并停止，3443 不再监听。可选转发器代码仍随插件保留供其他部署使用；本机使用 `bin/start-host.sh` 的官方 `--tls-cert`／`--tls-key` 参数直接提供 HTTPS 3080。证书路径保存在本机配置，没有改官方源码。
- 活动自动升级配置、readiness／浏览器健康检查、私有 API helper 已同步 HTTPS 3080。Python 信任使用系统公共 CA 加本机 mkcert 根的合并 bundle，Node 使用额外根；cron 只为对应维护命令设置这些环境变量，不禁用 TLS 校验。维护兼容断言先红后绿，既有自动升级单测 20/20 通过；未执行真实升级。原配置和 crontab 均已私有备份。
- 使用已有开发证书，SAN 包含当前 LAN IP。使用现有 mkcert CA 的独立 HTTPS 请求验证通过；系统默认 curl 没有信任该 CA。使用者设备仍须信任相同 CA。浏览器验收采用 `ignoreHTTPSErrors`，不能据此宣称任意设备已建立证书信任。
- 原临时 3443 与旧 HTTP 的 Cookie 按 authority 隔离。当前改用官方 HTTPS 3080 后，首次访问须打开本次启动生成的完整链接，官方签发 Secure Cookie。私有登录链接已更新到本机 `~/.local/share/harness-web/kanban-plugin/open-url.txt`，不进入仓库、截图或验收 JSON。

禁用页面插件：Harness Plugins 中禁用 `harness-kanban` bundle，不停止 Kanban、Harness 或 Agent。当前无需启动额外 TLS 服务；勿重新启动遗留的 3443 转发器配置。如存在尚未保存的浏览器页面内容，应先自行保存。

## 验证结果

单测先红后绿：先建立 URL／存储／保活测试，再实现页面；发现 DS Bot 隐藏原导航后新增独立入口的失败用例再实现；TLS 测试分别经历缺模块／缺导出红灯。后续浏览器夹具的 UTF-8 和 DOM 查询修正单独处理，不算产品红灯。

- `pnpm --filter harness-kanban run check`：Node 语法检查。
- `pnpm --filter harness-kanban test`：17/17 通过，客户端及 TLS 行为测试涵盖固定上游、跨源拒绝、Secure Cookie、重定向、流式上传／SSE、取消和原始 WS 字节。
- `test/browser-acceptance.mjs`：在全新浏览器上下文通过现有 Harness 认证；受控目标只加载一次，五次打开／返回保留同一 iframe、唯一文档身份和未提交草稿；连接设置取消不重载。
- 真实 Kanban 页面嵌入成功；1440×1000 和 1000×900 桌面尺寸外壳无横向溢出；iframe 报告安全上下文和 clipboard／microphone／serviceWorker API 存在。
- 原生 `/api/remote.mux` WebSocket 建立；经典侧栏导航与 DS Bot 独立入口均通过；普通 LAN HTTP 父页面显示 HTTPS 提示且不创建 iframe。
- 浏览器 `pageerror` 为零。已有外部 Inspector 连接及 DS Bot 的既有 Session 打开 console 错误不归为本插件修复或全站无错误证据。
- 当前本机无 CJK 截图字体，中文字呈方框；可访问名称和交互匹配仍使用真实中文。未为截图安装新字体或改写产品文案。
- 独立代码／截图审查通过；审查提出的焦点落位与返回建议已实现并由浏览器断言验证。
- 已生成可安装归档 `.dev-runtime/harness-kanban-package/harness-kanban-0.1.0.tgz`，归档仅包含声明的六个运行／说明文件，无依赖、测试数据、本机配置或凭据；本机仍通过官方 bundle 的本地 link 使用源码。

可复现命令和环境参数见 [包 README](../../packages/harness-kanban/README.md)。本机浏览器依赖使用已有共享库路径，通过显式 `LD_LIBRARY_PATH` 提供；未安装新系统依赖。脱敏结果与截图保存在 Git 忽略的 `.dev-runtime/harness-kanban-acceptance/`。

默认端口调整后的原生 HTTPS 3080 浏览器复验，保存于 `.dev-runtime/harness-kanban-native-3080/`：登录、原生 WSS、完整 Kanban、安全 API、保活、焦点与经典导航通过，pageerror 为零。当前没有 HTTP 入口，因此该轮明确记录 HTTP 父页面分支未执行；首版 3443／HTTP 双入口验收与单测已有对应证据，不将跳过计为通过。

## 验收边界

这是已可使用的首版包装，不等于所有 Kanban 功能已逐项验完：

| 范围 | 现有证据／剩余事项 |
| --- | --- |
| 页面／导航／保活 | 实际 Harness、DS Bot、经典界面和受控 iframe 验收通过 |
| 数据复用 | 同一现有 URL 和服务；未复制、迁移、重启服务。浏览器分区下不保证独立标签本地草稿自动合并 |
| 终端模式 | 现有真实看板呈现；测试未向终端发送任何输入 |
| 结构化会话 | 原入口完整保留；模型发送、排队、Goal、审批与附件需要在指定测试目标上另行行为验收 |
| 原生 Codex／VS Code | 路径原样复用，但嵌套编辑器及 Service Worker 的完整恢复尚未逐项验收；不自动启动缺失宿主 |
| 权限功能 | 安全 API 存在；未替用户授权麦克风／通知，未发送外部通知、验证真实剪贴板或模型任务 |
| 资源 | 受控反复导航仅一个 iframe／一次文档加载；尚无长时间 JS 堆与 renderer RSS 稳态结论。CSS 隐藏不等于子文档 document.hidden |
| 公网／手机／Agent 工具 | 未实现，仍按计划属于后续范围 |

安装文件／锁文件只新增无依赖的 workspace importer。未运行与本插件无关的全项目构建来替代专项行为证据，也未提交、推送或发布 npm 包。
