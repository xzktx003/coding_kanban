# Codex 账户、额度、配置通知审计与实施

2026-10-10，已批准方案P4.4的有界补齐。产品局域网访问：HTTPS `https://10.30.0.24:8484`（端口8484）；原包只读基线：HTTP `http://10.30.0.24:43831/native-markdown.html`（端口43831）。正式Rust、用户Agent、登录凭证与账户状态没有因验收改变；未提交或推送。

## 主证据与启用边界

唯一主标尺仍为 `third_party/openai.chatgpt-26.51002.51308-linux-x64.vsix`。以下字符偏移坐标基于其真实 `extension/webview/assets`，不是相邻Electron/App代码的存在性推断。

| 功能                         | 实际来源                                                                                                                  | 本项目判断                                                                 |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| 主composer `/status`额度文本 | `app-initial-3192ac99b6cd.js`：`jya`字符偏移5314036、`Bya`5315811、`cba`5326240                                           | 按原桶/windowDurationMins、剩余百分比、reset未知值呈现；Bya无付费/重置动作 |
| 原生时间窗口舍入             | 同包`Mya/Nya/zya`：5h及月/年窗口5%容差；分钟/小时/天真实单位                                                              | 不能固定把primary称5h、secondary称Weekly                                   |
| 配置/弃用通知接收            | `app-initial-e98b9eaef8e3.js`字符偏移5600338明确单独处理`configWarning/deprecationNotice`；3192的`Uxe/UBa`字符偏移5851763 | 全局host通知，无threadId；按完整值去重，最多20条                           |
| 配置通知显示位置             | `agent-settings-59d38c6bad60.js`：`Xe`读取UBa，`o=t(!0)`开放默认配置区，`workConfiguration.selected`时使用对应项目配置    | 配置页显示警告，不添加虚构聊天toast/banner                                 |
| 通知内容与文件               | 同`Xe`：原summary/details Markdown、path、range.start.line/column与Open file                                              | 本浏览器复用只读文件接口，捕获原路径并以Unicode列定位，不写配置或重启      |
| 通知图标                     | `agent-settings`的`ie`→e98导出`Bd`→`c5`，字符偏移5016072                                                                  | 实际16px圆形感叹号，两个原始SVG path；不使用相邻triangle SVG               |
| 当前运行层读取               | `packages/session-runtime/web/src/handlers/codex.rs:161/177`                                                              | 已有真实`account/rateLimits/read`和`account/read`适配，无需替换正式二进制  |

## 已完成

原额度页的Codex区原来只读legacy `rateLimits`并固定5h/Weekly、显示used百分比。新增 `features/codex-account` 模型与只读控制器，优先使用明确的`rateLimitsByLimitId`（含权威空map），保留真实bucket id/name/window与`100-usedPercent`的clamp。缺失、null及非有限数据明确不可用，不伪造成零消耗。账号更新立即清除旧账户数据；稀疏rate更新重新读取完整快照，不能用nullable稀疏元数据清空或拼造账户。晚到旧读取、卸载/Abort和显式刷新都有实例边界。

`NativeCodexUsage`已用于原`/usage`窗口的Codex区，并通过现有账户菜单的显式额度dialog可达。读取和刷新不会登录、切换账户、购买、消耗reset credit或发送任务。实际账户状态为null且requiresOpenaiAuth=true时才提供既有登录dialog恢复入口，仍需用户显式开始登录。共享账户菜单、Claude额度区和旧usage URL保留；手机按钮至少44px。

真实通知handler在thread路由前收集native配置/弃用通知，保持原`nativeThreadSettings`映射。Codex `ConfigSettings`挂载原通知内容与警告glyph；没有path不造Open file。路径只传给既有只读接口，独立预览没有编辑输入或保存按钮；来源文件按1-based Unicode标量列高亮。Markdown中的文件样式文本不按当前项目重定向，HTTP链接仍是显式浏览动作。配置编辑器及未保存离开保护保留。

## 红绿与验证

所有测试均使用mock或独立Playwright API fixture。凭证/设备授权码未读取或记录；测试文件内容仅为合成的`first/世界a/last`。证据位于忽略的`.dev-runtime/session-render-alignment/`。

| 红灯                                                      | 绿灯                                   | 证明范围                                                                                                   |
| --------------------------------------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `account-usage-red.log`                                   | `account-usage-green.log`7通过         | 多桶、空map、未知值、窗口公式、sparse refetch、账户变化与迟到读取                                          |
| `account-usage-ui-red.log`                                | `account-usage-ui-green.log`9通过      | 真实读取与剩余额度UI、明确retry/login恢复                                                                  |
| `account-notices-red.log`、`account-native-glyph-red.log` | `account-notices-green.log`6文件16通过 | threadless通知真实handler、去重20、severity/path/range、16px原glyph、只读文件；既有settings映射/leaveguard |
| `account-entry-red.log`                                   | `account-final-green.log`5文件14通过   | 当前账户额度dialog可达，无新window或隐式账户切换                                                           |
| 账户/Auth/取消/退出新增红灯见下文                         | `account-full-green.log`13文件47通过   | 上述与既有通知handler/settings导航、原有Auth回归及新增归属/三态/回执规则，计数来自最终一次执行             |

`account-final-typecheck.log`曾见本测试的ByRoleOptions.exact类型错误，已改为精确正则；另见并行goalDrafts、未完成nativeActiveExploration模块和layout callback测试错误。formatter与scoped `git diff --check`通过；完整工作区gate由主线程统一复查。`e2e-account-final.log`最终一次 **4/4通过，1.4m**：1440/390px、桌面/手机、深/浅色，包含额度/未知/通知/只读文件及真实原glyph与八项布局参数对照。输出 **44张fullpage PNG**（36张产品状态、8张原包基线）；不以fixture宣称真实账户或付费额度验证成功。

## 其余审计边界

已有 `CodexAuth`、账户快照列表/切换、任务完成通知与浏览器显式权限入口、beep/wake-lock、任务详细度/公开摘要设置、config.toml编辑与保存。本次没有移植整套插件账户、遥测或远端宿主管理。

正式旧Rust运行层目前没有account/login/cancel、account/logout或reset-credit消费入口；仅生成绑定的存在不能证明本机账户/企业策略开放。Review Agent已在源代码和隔离新二进制中实现前两项严格REST，正式运行层仍未替换。前端只在同一个真实health.instance且`health.capabilities.codexAccountMutationsV1 === true`时提供显式取消/退出入口；旗标仅证明guarded adapter部署可用，不证明企业策略允许每次原生RPC。真实登录、切换、取消、退出、付费/重置及真实账号网络联调没有在用户活跃Agent期间执行。

### 登录归属、账号读取与取消/退出

`account-auth-primary.json`记录原包实际ID检查、捕获ID取消和await logout RPC的只读源码检查；同时记录completion的Unicode字符偏移4389595与UTF-8字节偏移4427084。

真实VSIX宿主生命周期 `app-initial-3de816c37e10.js` 字符偏移4389600处理 `account/login/completed` 时仅在 `activeLogin?.loginId === notification.loginId` 后完成当前登录。字符偏移4383427的 `cancelLogin` 只提交原 `loginId`，字符偏移4987817的 `logout` 等待真实 `account/logout`。本项目现有Auth对任意success触发onAuthenticated，以及账号读取catch写入null，已用隔离测试复现；`account-auth-red.log`、`account-state-red.log`保留失败证据，后者三个断言分别证明未知被改成false、已知账号丢失和晚到旧账号覆盖。

归属修复已完成。Auth在显式login/start前读取真实health实例；只有本次实际回传的原loginId与原实例/source/restart epoch都匹配，才消费completion并关闭dialog。先到的通知暂存在最多16项内存队列，等真实HTTP确认ID及实例后才按ID处理；外来/null/重复、旧实例或旧HTTP回复不影响当前流程。Tauri与浏览器使用同一检查，变化的回调通过ref读取，不因此重建SSE。待授权与未知HTTP回执锁定重复start；本次权威失败才能解锁。本地设备码、登录URL和API Key未放入journal。

`useCodexEvents`读取失败、HTTP200缺失account及未知account类型都保留null/true/false三态及最后权威Account；只有实际account:null才表示已退出，不能把未知误写成false导致自动登录框。generation、source与运行重置epoch使旧读取不能覆盖新账户/新实例；SSE、Tauri、reconcile与账户快照私有存储链路继续沿用。

生成原生协议为 `account/login/cancel` 参数 `{loginId:string}`、响应 `{status:'canceled'|'notFound'}`；`account/logout` 参数undefined、响应 `{}`。Review新增REST分别为 `/api/codex/account/login/cancel` `{loginId,runtimeInstance}` 与 `/api/codex/account/logout` `{runtimeInstance,expectedAccount}`；server验证/去掉guard字段再发送原RPC，logout在同一实例重新读取原公开Account并做最小值比较。这是防旧状态的global logout guard，email不是认证/授权标识，未虚构accountId或读取私有auth文件。Review的隔离HTTP验证与Rust64项测试见 `docs/session-native-readonly.md`；实际原生cancel/logout发送数为零。

前端“取消本次登录”只对本次已知loginId显示；Escape/X只收起并保留既有关闭行为，不隐式cancel。账户菜单“退出当前Codex账户”是明确全局账户动作，携带捕获的最小公开snapshot并复查实例/当前账户，旧回执不清空另一个账号。退出成功不自动弹出首次登录提示。未知回执禁止重复发送；退出的“检查退出状态”仅做真实同实例account/read，只有权威null才确认退出，失败或同一账号仍在不能造成功。模块锁与本设备journal保留sending/uncertain回执；journal仅用保守摘要作重复发送键，不记录email/API Key/设备码/auth URL/token，也不作为授权。

新增 `account-auth-red.log`、`account-state-red.log`、`account-auth-race-red.log`、`account-mutations-red.log`、`account-mutations-ui-red.log`、`account-runtime-red.log`、`account-cached-receipt-red.log`、`account-completed-receipts-red.log`、`account-invalid-payload-red.log`、`account-cancel-not-found-red.log`，到 `account-full-green.log` **13文件47项通过**。涵盖actual ID/实例、早通知、Tauri/稳定SSE、未知/已知账号、晚到读取、capability、取消/退出snapshot、权威失败、未知回执与只读确认。原生取消的`notFound`只显示没有待取消登录并只读刷新当前状态，不能声称“取消成功”或触发onAuthenticated。运行实例变化立即清除旧quota，晚到旧读取不能恢复旧百分比；已存complete也仅是禁重复发送标记，不能代替本次真实原生回执或同实例权威只读确认。已确认terminal回执在达到存储上限时可老化，避免100次正常取消耗尽后续功能；sending/uncertain回执不会因此删除或允许重发。最终LAN四场景通过，不以mock或新二进制的能力宣称正式旧运行层已经开放。

`account-formal-capability.json`来自正式LAN `/api/session/health`真实只读HTTP：200、存在非空instance、`codexAccountMutationsV1:false`。文件只记录上述布尔值，不记录真实instance字符串或账户数据；正式旧运行层取消/退出入口保持隐藏。`e2e-account-mobile-probe.log`记录先前手机暗色完整场景通过21.0s。最终`e2e-account-final.log`的四场景在产品源码冻结时一次全部通过；此前`e2e-account-before-offline-fixture.log`保留3通过/1失败，末步fixture强行把退出后的权威false改成null却仍有正常只读结果收尾，已仅将fixture改为离线后fresh mount，直接验证真实初始未知，不放松产品guard。导航fixture仍走真实secondary-page/mobile-Sheet与可见combobox。所有截图仅含合成fixture邮箱与`FIXTURE-ONLY`设备码。

额度页复用本项目双provider/账户入口布局，只复刻原生额度字段、状态和对应样式参数；配置“打开文件”在浏览器中为独立只读预览，原插件打开VSCode编辑器。尚未验收完整宿主菜单/账户页面逐像素一致；不会将本次有界补齐声称为P4整体完成。

原有 `CodexAuth.test.tsx` 的device-code fixture在统一测试中缺少loginId、runtime buildUrl与health.instance，已按真实协议补齐并断言旧capability不显示Cancel、不会以mutation探测功能；未放松归属guard。最新account-full-green.log包含原有用例与所有新增账户用例，13文件47项通过。
