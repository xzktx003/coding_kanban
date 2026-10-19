# Codex 模式连接修复与只读检查（2026-10-19）

## 原因及修复

本机正式入口为 HTTPS `https://10.30.0.28:8484/?mode=codex`，网关端口来自 `.env`。旧宿主 HTTP 正常、官方扩展能打开，已安装自有 companion 却仍是 10 月 13 日的内容。当前源码要求实例状态栏标记、私有实例 broker 和精确窗口控制；旧安装均缺失，版本号仍为 `0.1.0`，不能只比较版本号或 HTTP 200。

部署在全新私有 HOME／Codex HOME 中安装当前自有 companion 和未修改的官方 `openai.chatgpt 26.51007.21434`，宿主 code-server 为现有 `4.116.0`。沿用用户已授权的连接副本，不复制历史或接管默认 CLI IPC。宿主绑定 loopback，用户级临时服务名为 `coding-kanban-native-codex-20261019.service`；部署记录位于忽略目录 `.dev-runtime/codex-connection-20261019/`。这不是机器重启后自动恢复的承诺。

只修改 `.env` 还不够：本机网关 watcher 已继承旧 `NATIVE_CODEX_*` 环境，dotenv 不会覆盖显式继承值。核对进程命令和工作目录后，仅重载本网关 watcher 的启动环境；独立会话运行层和旧原生宿主保持运行，不停止或中断用户任务。

## 只读检查

```sh
pnpm codex:status
node --test scripts/native-codex-status.test.mjs scripts/startup-env.test.mjs scripts/session-runtime-status.test.mjs
systemctl --user status coding-kanban-native-codex-20261019.service
```

命令验证 loopback 配置、私有记录权限与符号链接限制、宿主端口、网关精确项目／窗口身份以及授权 broker。四个自有打包文件按内容比较，manifest 只忽略安装器 `__metadata`。不输出原始 broker 响应、账号或凭证。仅 GET，不发送模型任务或执行进程控制。

实际旧安装返回 `companion=stale`，差异为 package.json、extension.cjs、control.cjs、appserver-send.cjs；即使宿主和网关都可达也不会报告就绪。新安装返回 `companion=current`、`state=broker-ready`。公共 `sendAvailable=false` 保留官方版本门控，独立模式的原生输入框不依赖它。10 项新增回归及 8 项启动／会话状态回归通过。

`broker-ready` 只证明插件和某个私有实例控制接口已激活，不能替代当前浏览器、登录、模型回复或长期连接验收。缺少浏览器激活和插件激活失败均可能表现为 `host-ready-awaiting-browser`。

## 真实浏览器

通过正式同源网关、1440×1000 Chromium 和原版插件完成官方四步 Next 引导，页面显示“当前会话可输入”。仅在新私有项目发送一条明确禁止工具和文件修改的连接验收消息；官方输入框发送后，正文实际显示助手回复 `KANBAN_CODEX_CONNECTED_20261019` 及 `Response complete`，没有 pageerror。未向既有项目或线程发送测试消息。

原始本机证据保留于忽略目录：`chat-verification.log`、`composer.png`、`chat-result.png`。初次更换 `.env` 和 package 清单期间的 HMR 重载、动态资源取消是部署中的观察，不作为稳定浏览器通过证据；稳定后另行运行了上述真实对话。

另外在同一浏览器上下文刷新前后，分别等待“当前会话可输入”，实际填入未发送文字并清空；两次都通过。刷新后另保存 390×844 截图。证据为 `reload-verification-2.log`、`reload-mobile.png`。首个刷新脚本遗漏新浏览器的官方 Next 引导而超时，保留在 `reload-verification.log`，不将它当成产品刷新失败。此检查只证明空闲原生输入框重新连接，不代表已验收运行中任务、已发送历史及所有多窗口恢复。验收线程只从共享关注列表移除，未删除原生历史或停止实例。
