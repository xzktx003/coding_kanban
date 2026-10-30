# 插件市场、认证后续与多页一致性（LG27–LG29）

本期保留 Codex 本地客户端的插件、技能与连接器体验，不依赖 VS Code IDE，也不建设云任务服务。市场、插件 opaque ID、安装策略及认证策略均取自官方协议；看板只协调自身明确提交的操作，不能替其他 CLI 客户端提供原生不存在的跨客户端 CAS。

## 本轮修复与状态机

列表项身份由市场路径/名称及插件身份共同组成。安装按原生 `plugin/read` 重新核对精确市场与名称；卸载 opaque ID 从这次匹配详情取得。两个市场返回相同显示 ID 时，不会把另一项一起改为已安装，也不共用 React key 或 loading 状态。官方 remote ID 与本地 share 副本的优先规则继续保留在 `pluginTargets.ts`，不改为显示名匹配。

看板插件变更统一走固定 `/api/codex/plugin/mutation`。运行层从真实 `operationContext` 获取账号/daemon namespace，并在实际原生写入前再核对 scope。每个明确意图先保存 metadata receipt，再调用原生；记录不含正文、OAuth URL 或凭据。状态为 `unknown → accepted / state-confirmed / rejected`。网络断开、响应损坏或写后失败保持 unknown；下一次手势与刷新后恢复都只核对原意图，不重新安装/卸载。服务端对同一 namespace 串行，最多 8 个变更/认证读准入；回执文件最多 2 MiB，最多保留 100 个 unknown 与有界已结算记录。该机制防止看板自身重复投递，不宣称原生幂等。

已接受意图后其他客户端再次改动插件，旧 receipt 的读取显示实际当前状态；需再变更时，用户明确发起一个新意图。不存在通过丢弃 unknown、自动恢复或空原生目录来解锁写入的路径。运行层缺少持久数据目录时，新入口明确返回不支持，不回退 raw install。

安装结果保留全部 `appsNeedingAuth`。每项都有明确的认证入口，按原生数组顺序展示；打开 URL 不标记认证完成。用户点击“核对认证状态”时，固定只读 `/api/codex/plugin/authentication` 重新读精确插件，并只接收该插件 app ID 在实际 `app/list(forceRefetch)` 中的 `isAccessible`。缺失值显示未核实，false 保留认证入口；不由邮箱、套餐或打开过页面推断成功。详情中的原生应用入口可以重新展开认证，不把 OAuth URL 持久化到 localStorage。

详情读取与操作回执绑定 selection generation，迟到的 Alpha 回执不能替换当前 Beta 详情；卸载期间禁用同项按钮。账号同值事件、配对凭据更改、运行层代次与 SSE resync 都撤销旧目录缓存、详情、认证动作和迟到结果。列表响应与缓存最多 2 MiB，超限保留原来的有界导航并显示局部重试；跨页通知只存一个 nonce，各页重新从自己的连接域只读刷新。现存 composer 的插件 mention 候选也订阅同一有界修订，隐藏输入不主动取目录，预载模块不安装全局监听。

## featureId → 实现 → 验证

| featureId | 实现路径 | 本轮专项、原生及浏览器证据 |
| --- | --- | --- |
| LG27 安装与认证后续 | `packages/session-runtime/src/codex/plugin-mutations.ts`、`codex/routes.ts`；`features/plugins/pluginOperations.ts`、`hooks/usePluginsView.ts`、`components/PluginAuthenticationPanel.tsx` | runtime 并发/回执重启/未决不重发、原接受后外部变更、认证来源与 2 MiB detail 预算、HTTP 固定参数/no-store/不支持共 6 项；官方私有 daemon install/read，独立 CLI list 共享状态；真浏览器桌面 1440/手机 393 两个认证入口逐个打开、打开不算成功、只读目录核实成功；unknown 刷新与重复手势保持原生写入一次。 |
| LG28 卸载与状态刷新 | 同一运行层 manager；`pluginTargets.ts`、`hooks/usePluginsMarketplace.ts`、`components/PluginDetailView.tsx`、`pluginScope.ts` | 官方私有 daemon 以实际 opaque ID 卸载后 CLI installed 为空；两个尺寸真浏览器精确卸载；双页只读刷新不替换另一市场详情，同 ID 跨市场不串 installed；同值账号撤销关闭认证入口、迟到详情不能复活。 |
| LG29 插件/技能/连接器导航 | `hooks/usePluginsView.ts`、`hooks/usePluginTryNow.test.tsx`、`pluginNavigation.ts`、`components/PluginsViewHeader.tsx`；`composer/mentions.ts` | 原先 Try now 的离开保护、精确单个输入目标与原生 typed plugin 身份保留；插件全域及 mention 8 文件 29 项通过。桌面/手机、深浅主题输入/触摸/离开保护 4/4 通过（34.1 秒），包括实际切换连接器/技能管理、Try now 取消不改目标和草稿、确认后只提交精确 ux-1 的 plugin:// 身份，未额外调用 turn/start/resume。最终组合结果见下方。创建/编辑连接器的既有专属配置不在本次插件变更中重写。 |

## 可复现的验收与证据边界

功能前端为独立冻结快照，绑定 `0.0.0.0`，本轮 LAN 地址 **HTTPS `https://10.30.0.24:43025`**（2026-10-30 后续冻结 `1793310237966`）；前端没有 API proxy 或 HMR。浏览器 fixture 仅将固定插件 API 转至隔离的生产网关、生产运行层路由和真实持久 coordinator；其 native RPC 为受控协议夹具，HOME/CODEX_HOME 独立、禁止 daemon start，不加载正式账号。其结果不能冒充真实在线 OAuth。

```sh
pnpm --filter @agent-orchestrator/session-runtime exec tsx --test \
  src/codex/plugin-mutations.test.ts src/codex/plugin-mutations.routes.test.ts
SESSION_CODEX_DAEMON_NATIVE_BIN=/absolute/verified/codex \
  pnpm --filter @agent-orchestrator/session-runtime exec tsx --test \
  src/codex/plugin-mutations.native.test.ts
pnpm --filter web exec vitest run --config vitest.session.config.ts \
  src/session-mode/features/plugins \
  src/session-mode/components/codex/composer/mentions.refresh.test.tsx
PLAYWRIGHT_SKIP_WEBSERVER=1 PLAYWRIGHT_BASE_URL=https://LAN_HOST:PORT \
  PLAYWRIGHT_FRONTEND_PROTOCOL=https pnpm exec playwright test \
  tests/e2e/session-plugin-lifecycle.spec.ts tests/e2e/session-plugin-inputs.spec.ts
```

官方原生测试使用固定 **0.165.0**，全新私有 HOME/CODEX_HOME/dataHome，本地 `.agents/plugins/marketplace.json` 与静态 `.codex-plugin/plugin.json`。市场路径通过真实 `plugin/list` 得到，不使用虚构的成功 schema。全过程不运行模型 turn，不复制登录资料，不连接正式 IPC；退出核对该私有 daemon 的 PID/start ticks。实际线上 OAuth、组织受管远程 marketplace 和实体 iPhone 尚未执行，不列为本地无登录结果。

红灯保存在忽略目录 `.dev-runtime/extensions-workspace-20261029/`：旧冻结缺少全量认证面板 `plugin-browser-actual-red.log`，旧详情被迟到 ACK 替换与认证目标丢失的 hooks 红灯，以及 detail 超预算未拒绝 `plugin-auth-budget-red.log`。修复后的日志分别为 `plugin-runtime-unit-final.log`、`plugin-native-final.log`、`plugin-web-complete-final-unit.log`；最后浏览器结果由 `plugin-browser-current-verified.log`（含 5 项生命周期、4 个输入主题尺寸与原目录重试专项） 记录。局部检查不替代根整合冻结的完整检查、组合和两秒性能验收。


## 后续来源与关闭页缓存复验

后续源码审计补了两个实际缺口：初次详情 enrich 只检查异步代次，没有核对返回市场/插件身份，且可能把超过 2 MiB 的详情发布到组件；关闭插件 UI 后，模块缓存只保存账号值，没有保存账号/运行 scope 修订。现在首次 enrich 与变更后刷新共用精确目标/结构/2 MiB 发布前检查，错误留在原选择代次，原摘要保持；缓存保存捕获 scope，关闭期间的同值账号撤销或运行层替换也能在重新读取时释放旧值，不增加模块全局监听。

红绿：详情错市场/错插件/超预算三项在旧实现红，修复后绿；关闭 UI 的同值账号和运行代次两项红后绿。插件域和 mention 最终 **9 文件 35 项通过**，web 类型检查通过；固定 runtime/API **6 项通过**。日志在 `.dev-runtime/extensions-resume-20261030/` 与前一目录的 `plugin-detail-enrichment-{red,final-green}.log`。详情预算是浏览器发布前界限，本项不宣称插件目录网关传输预算或 renderer RSS 长测通过。

最终冻结 HTTPS 43025 的 **12 项组合中 11 项通过**：四种主题/尺寸 typed input、两尺寸安装/认证/卸载、多页同步、未知回执、同值撤销、详情三个拒绝分支、关闭页重开均通过；旧目录重试用例没有安装原生 EventSource，反复断线 resync 撤销旧目录，不能用它要求原账号数据继续显示。为其接入既有原生 `liveStream` 夹具，并将错误断言限定到实际目录失败卡后，原用例 **1/1 通过，5.1 秒**。结果不合并伪称同批 12/12；原失败截图与日志保留。组合为 `plugin-final-browser.log`，目录专项为 `plugin-loading-final.log`。此前中断的 `plugin-browser-current-verified.log` 无最终摘要，不能作为通过记录。真实在线 OAuth、正式账号、组织策略和实体设备仍未执行。

2026-10-30 最后原生资源复验：精确日常服务同 SHA 的官方 **0.163.0** 与固定对照 **0.165.0** 分别执行八项私有原生测试，均 8/8、零跳过，包含本插件真实 install/read/uninstall 与独立 CLI 共享目录状态；退出同时核对 daemon 和其 updater 后代归零。日志为 `.dev-runtime/session-full-implementation-20261029/native-0163-eight-complete.log`（8.94 秒）与 `native-eight-resource-clean.log`（8.79 秒）。原先只停止 daemon 可能遗留 updater 的夹具问题已修复，所有权先于启动登记，按 PID/start ticks 清理；规则见 [原生夹具资源](native-fixture-resources.md) 和 [版本兼容](native-version-compatibility.md)。正式共享服务只读身份没有变化，这不是升级或正式部署验收。0.163 的实际 UI→网关→运行层→daemon→Chromium WebRTC 也单项通过，不能替代在线账号 OAuth。
