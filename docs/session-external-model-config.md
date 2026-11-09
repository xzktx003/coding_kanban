# 外部 Codex 模型配置与新聊天

2026-11-09。适用于会话模式，自有 Codex 模型选择器；独立 Codex 模式保持原生宿主行为。

新设备的新聊天默认选择“跟随 Codex 配置”。旧设备只要保存过模型或提供商，缺少新意图标记时保守保留为手动模式。每个字段仍单独存储，不整表回写；已有线程继续使用独立线程设置，不因 Magpie 切换而更改。

只读 `POST /api/codex/model/config/read` 接受可选绝对 `cwd`，调用实际连接的 `config/read`（`includeLayers:false`），仅返回 `status:ready`、`model`、`modelProvider`、`reasoningEffort`。不返回 base URL、账号、密钥、原始配置或日志，不 acquire/resume，不发送模型任务。目录最多4096字符，模型1024、提供商128、强度64；控制字符拒绝。权限配置公开投影保持独立，不增加权限授予能力。

菜单和延迟加载触发器显示“跟随配置 · 模型”。进入可见的新聊天、打开跟随菜单及显式刷新时读取配置；没有后台轮询，已有线程打开菜单不强制重载目录。配置模型独立展示，不要求出现在官方目录中，可“固定使用”成为手动选择。2026-11-09后续补齐：新聊天菜单打开时通过网关只读兼容接口 `/api/session/model-catalog/magpie` 读取已配置的本机Magpie `/models`，独立分组列出，选择时同时保存magpie提供商和精确模型ID。无需替换旧运行服务。仅允许配置中magpie的HTTP loopback地址，不接受客户端地址、不发送凭据、不跟随重定向；5秒截止、1MiB响应、最多2048项，每项1024字符。失败不伪装空目录，菜单提示不可用。无配置时为空；远程或带认证网关尚不支持。

发送手势捕获新聊天意图并立即启动5秒截止的配置读取；异步准备和后续UI选择不能替换捕获结果，读取失败在创建前拒绝并保留草稿。原有运行代次和账号检查继续生效。读取到的模型/提供商/强度作为本次显式参数，null表示原生默认，不能编造openai默认。配置读取与实际创建之间没有原生跨客户端CAS；上游地址、凭据或账号在这期间变化不能由模型标识保证不变。自定义工作树的项目配置仍须按其最终原生语义判断，不能把源目录配置显示当作最终路径全部配置证明。

旧运行服务不存在该端点时，404/405/501明确提示“当前运行服务不支持读取模型配置”，不改读磁盘冒充有效配置，不启动私有app-server，不自动重启服务。当前现场旧runtime需要在安全维护窗口显式更新；构建新产物不代表运行中的服务已支持。接口报告的是原生配置读取结果，不证明配置文件与启动快照一致，也不证明流量或计费上游。当前界面不声称检测到磁盘配置未应用。

验证入口：

- `pnpm --filter @agent-orchestrator/session-runtime exec tsx --test src/codex/model-config.test.ts src/codex/protocol.test.ts`
- web Vitest：`newChatModelConfig.test.ts`、`useNewChatModelConfig.test.tsx`、`useConfigStore.follow.test.ts`、`codexService.models.test.ts` 以及原模型菜单/创建/多页回归。
- 隔离浏览器：`tests/e2e/session-model-config.spec.ts`，375px/1440px，复用绑定0.0.0.0的独立Vite，API全走fixture。此次LAN入口 `http://10.30.0.28:18584`，无正式模型调用。

验收结果：模型相关扩大回归39文件442项通过；新增运行层配置与既有协议8项通过；375px/1440px浏览器2项通过。运行层类型检查通过。web全量类型检查仍被HEAD已存在的 `useServerNotificationHandler.chime.test.tsx:52` 不完整Thread夹具阻塞，本次未修改该文件。没有真实上游请求、运行服务切换或长期RSS测量。

补充：server类型检查同样被HEAD已有 `codex-session-locator.test.ts:1455` 八进制转义错误阻塞。原运行runtime/native PID及10-31启动时间未变。

后续现场复验：正式HTTPS入口目录返回40模型，原runtime/native未重启；隔离浏览器新增目录选择验收，与375px/1440px配置回归共3项通过。前次“没有接入完整目录”结论由本节限定的本机Magpie支持取代；实际上游生成调用未测试。
