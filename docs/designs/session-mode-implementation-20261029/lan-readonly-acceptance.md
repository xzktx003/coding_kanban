# 实际 LAN 的只读部署验收

`tests/e2e/session-lan-readonly-acceptance.mjs` 只连接显式提供的现有前后端。默认只 GET 文档、健康和已关注集合，不启动浏览器、不访问原生 context 或历史、不启动/替换服务。它不读取 `.env`、登录配置或用户浏览器存储；本机本轮入口是 HTTPS `https://10.30.0.24:8484`，后端 HTTP `http://10.30.0.24:8282`，不能把预检 HTTP 200 当作输入可操作。

准备一个 owned、非 world-writable 且规范路径的私有输出父目录，然后提供新的绝对输出路径；每次运行不能覆盖旧目录：

```sh
node tests/e2e/session-lan-readonly-acceptance.mjs \
  --frontend "$LAN_FRONTEND_URL" --backend "$LAN_BACKEND_URL" \
  --output "$LAN_ACCEPTANCE_OUTPUT"
```

自签名 LAN 证书只在这次明确验收中显式加 `--accept-untrusted-tls`；不会修改服务证书或浏览器全局设置。`result.json` 为 0600，输出目录 0700，只保存固定身份元数据、数量、计时和错误摘要。没有消息正文、标题/预览、请求头、scopeToken、账号内容、截图、录像、trace 或响应正文日志。错误信息以摘要保存，避免异常文本带出凭据。

## 部署信号之后的实际浏览器

只有整合 owner 发出 deployment go，才在同一命令加 `--run --target-file "$LAN_ACCEPTANCE_TARGET"`。目标文件必须是 owned 0600 规范普通文件，不超过 8192 bytes；允许字段只有 `version:1`、`kind:"codex"`、精确 `threadId`/`cwd`、部署后的 `runtimeInstance`、原生 `namespace` 与 64 位小写 hex `daemonIdentity`。这些值必须来自实际只读核对，不得用 fixture 值或猜测填入。可选 `expectNoInterruptedHistory:true` 只加强自有 canary 的断言，不授予发送权限。

运行前要求健康明确为 `shared-daemon`、已有关注集合已初始化且含该精确目标；前端同源代理与显式后端分别按 `context → includeTurns:false metadata → context + health` 核实来源，不能只验证后端。已读 gate 必须看到原生 `readState.firstUnread === null`、不变的实际 revision，以及共享管理记录已包含并读过同一个最新终态 turn。原生缺失 `firstUnread` 是未知，不能猜已读。共享 management namespace 是 `hash(service domain + native namespace)`，不等于 lifecycle native namespace；通过固定只读 `management/read-context` 将该管理 namespace、精确最新 turn/revision 与前后同一个原生 scope 关联，不猜两个 namespace 相等。

三个新隔离 context 分别为两个桌面和一个 iPhone 16 尺寸模拟；不导入用户的 storageState/草稿/outbox，不写 URL thread 目标、不注入选择、不增删或移动关注标签。只验自然选中且已读的现有目标；找不到正确 composer 会明确失败，不选择替代会话。若没有适合的已读目标，停在元数据预检，由整合 owner 决定是否显式建立自有 canary；runner 本身没有创建或发送能力。

每页核对精确唯一输入及真实历史行，用 ArrowLeft 验证真实焦点/keydown/两个动画帧且文本长度不变，再刷新和仅对该隔离 context 注入短暂 offline。断线后必须观察到新的真实 EventSource 连接；重新核对目标、历史和原生当前轮状态，不能仅据缓存仍在或 HTTP 200 称重连完成。不会按 Enter、输入正文、点击发送/继续/审批/停止。

不拦截、改写或合成任何 API 请求。观察到任务、管理内容或未知写入时幂等关闭自有浏览器并保存失败元数据，不重试、不回滚服务器快照。正常空操作同步 ack、客户端 watch/sleep 资源及已有设置控制的 active telemetry 单独计数，不算作任务写入；不修改 telemetry consent，关注内容前后必须一致。受控 offline/refresh 只按实际受影响 request 身份和有界故障窗口归因精确网络错误，恢复阶段真实 app 控制台错误仍失败；不以整段 offline/reconnect 阶段为由屏蔽错误。

执行状态只保存实际已加载 store 的小型投影与原生 activity 元数据，不新建模块制造证明。新 canary 可要求从页面初始到刷新/重连均不出现“已中断”；一般旧会话的合法历史中断不据标签数量判错，同轮当前 native inProgress/completed 与 UI interrupted 矛盾才判失败。无来源或 store 证明则明确失败。该脚本不代表物理手机、完整长历史、实际模型提交或 30 样本两秒性能；这些分别验收。

## 当前证据

策略 URL/目标字段白名单及读写识别的三条 Node 测试先红后绿，已读严格来源、有界精确故障归因和幂等失败关闭另有真实红后绿；最终六条通过，语法检查通过。日志在 `.dev-runtime/lan-readonly-20261030/policy-{red,final-green}.log`、`already-read-red.log`、`fault-shutdown-red.log`。实际默认预检 `.dev-runtime/lan-readonly-20261030/preflight-http-2/result.json`：文档 200，前端代理及后端 health 均 ok 且精确实例一致，关注 6 项；codexBackend 字段缺失，仍为旧运行服务。浏览器页面 0、原生 context 0、任务写入 0；自有 runtime 状态独立只读确认为 PID1676067/typescript/older。尚未运行部署后的浏览器分支，不能写成已验收。
