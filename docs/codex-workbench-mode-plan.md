# 独立 Codex 模式实施计划

用户明确要求在 `main` 开发第三个 Codex 工作模式，原生插件相关开发集中于该模式。原会话/终端逻辑继续保留。此前单独 VS Code 地址是宿主验证，不是所需产品入口。

## 实施范围

1. 共享模式解析、URL/设备保存、导航控件和 WorkbenchShell 增加 `codex`。三个模式惰性挂载、访问后保持挂载；不可见模式不处理全局快捷键。保留既有二态拖动能力，新增可点击/键盘到达的 Codex 入口。
2. 新增 `/api/native-codex/status` 和 `/native-codex/*` 同源宿主代理。上游只来自显式服务配置、限定 loopback HTTP，不接受浏览器指定上游。公开状态只返回版本、入口与受控测试线程，不返回私有凭证。未配置/失效时显示正确状态。
3. 自有 companion 增加明确配置的两条 fixture 自动打开，默认关闭；不登录、不发送模型 turn，不接管现有线程。官方 VSIX 字节不变。
4. 新 UI 位于 `apps/web/src/codex-mode`，有自身导航及样式范围。后台仍由真实宿主承载原版 Webview/RPC；用户视图只展示原生 Codex 面板。使用同源宿主 DOM 的受控表面适配，不移走 iframe、不修改官方 bundle。宿主 UI 的文件/终端呈现另行开发。
5. 先红后绿测试模式保存/切换、隐藏挂载、受控代理、自动打开与表面清理；前后端类型检查和生产构建。真实浏览器从主应用 `?mode=codex` 进入，验证原版面板、模式切换、刷新恢复与输入归属边界；真实聊天/附件/写操作不凭界面加载计通过。

## 接口

`GET /api/native-codex/status` 返回 `{available, reason?, iframeUrl?, extensionVersion?, fixtures?:[{id,label}]}`。`iframeUrl` 必须为同源 `/native-codex/`；缺省关闭。

服务配置 `NATIVE_CODEX_UPSTREAM_URL` 指定 loopback HTTP 宿主，`NATIVE_CODEX_RUNTIME_RECORD` 指向 owned 0600 的独立运行记录。源包/密码/主机地址/端口均不写进实现源码。后台服务和模式关闭不隐式停止 Agent。
