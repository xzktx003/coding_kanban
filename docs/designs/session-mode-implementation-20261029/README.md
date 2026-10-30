# 多会话方案实施与严格验收

日期：2026-10-29—30。[开发方案](../session-mode-multisession-development-plan-20261029.md)已批准并实施。最新源码的多窗口性能关卡通过。用户已明确决定“先提交已验证修复，内存问题单独跟踪”；M39三十分钟内存验收仍运行，不再阻塞本次提交，不代表内存关卡通过。当前正在整理本地提交，未推送。

日常入口为 **HTTPS LAN `https://10.30.0.24:8484/?mode=session`**，后端为 **HTTP LAN `http://10.30.0.24:8282`**。隔离验收不向正式线程重复发送探测消息，也不停止、重启或升级共享官方 daemon。

## 范围和证据层次

范围保持174项功能、55个场景，scope SHA 为 `db8c95e76320f1ce9f2e02b57ad2b4d044ba249aeae9bac9b3f113aaf7ba34e9`。功能映射为91项专项检查点、71项动态部分通过、12项批准排除。适用功能有实现映射，但不能把162项适用功能描述为全部通过原生、原组件或全部分支验收。实际层次与证据以[执行矩阵](execution-matrix.md)及其[JSON](execution-matrix.json)为准。

排除官方 IDE 宿主桥及部署、IDE 专属租约/编辑器/设置、云任务执行等批准边界。保留自有文件跳转、终端/VS Code面板、账号及模型调用、MCP/插件连接、反馈和听写。本期共享运行服务的客户端为看板和 CLI；不把官方 VS Code 插件共享纳入本期关卡。

| 实现线 | 记录 |
|---|---|
| 官方daemon、能力门控、CLI同一任务 | [官方服务](official-daemon.md)、[版本兼容](native-version-compatibility.md)、[三页与CLI](native-threepage-cli-integration.md) |
| 置顶/已读、事务、归档、官方队列与未知回执 | [共享管理](shared-management.md) |
| 精确输入目标、模型/权限、快捷键、草稿与听写 | [输入区](composer.md) |
| latest/all、正文、Sources、缓存执行状态核对 | [正文](transcript.md)、[执行状态恢复](cached-execution-recovery.md) |
| 工作环境、MCP App、认证、插件、新窗口 | [工作环境](extensions-workspace.md)、[插件](plugins.md)、[新窗口](new-window.md) |
| 有界预热、三类Agent历史与两秒验收 | [性能与恢复](performance-recovery.md)、[辅助历史](auxiliary-history.md)、[ACP选择](acp-history-selection.md) |

Codex/Claude复用既有关注集合；ACP沿用精确native owner登记、只读选择、显式继续及公共正文预算，不声称新增ACP跨设备关注同步或Claude跨runtime自动绑定。

## 最新冻结源码

最新验收源为 **HTTPS LAN `https://10.30.0.24:38519`**，记录 `.dev-runtime/root-native-memory-20261030/app-body-final-freeze/frontend.json`。2890份Web、89份shared、9个导出及12项配置均经root独立逐文件核对。HTTPS/H2、真实HMR保留，watcher关闭，无API代理或夹具注入。

- Web manifest：`09dcff463bfcdc528dbcd3a85a2be3db584a1eb8aac7f6a490e831bdff711214`。
- shared manifest：`2482eb777c1313b7d83beb1eec5e51a12f30e02520e01021368d09bdf82cd493`。
- 配置 manifest：`0ce68d193ced11878bf6968edf16a02cc0a2e93efe0f202421c7874b937a9cad`。

相对38517/C1E4，增加了公式预处理与缓存计量的临时分配修复；相对38518，再以普通state承接共享App import，保留loading、错误边界、真实子项Suspense、卸载清理和草稿组件身份。公式/缓存57文件346项、App加载相关10文件30项通过，均不扩大缓存预算或新增全局正文缓存。

单页诊断确认App模块在health前已resolve，App render后占位仍显示303.6ms；符合React重试节流，但具体nested suspender/lane未证明。最新M54导航到composer的中位间隔仍约275ms，不能宣称已经消除全部300ms级等待或把两轮差值归为单因素收益。

## 自动化检查

日志默认在 `.dev-runtime/session-full-implementation-20261029/`。默认跳过不计通过，未改部分沿用原来源记录。

| 检查 | 实际来源和结果 |
|---|---|
| `pnpm check` | 最新App加载源码通过，`check-app-body-final-20261030.log`，Web build46.22s |
| 完整Web | 38518源754文件4645项通过；其后仅上述3份App文件变化，相关10文件30项通过，不冒充重新跑过最终全套 |
| 终端 | 569项通过，`terminal-final-history-compare-20261030.log` |
| 后端 | 1138通过/1平台跳过 |
| TS运行层 | 503通过/10显式原生跳过；迁移audit208通过 |
| 脚本 | 197通过/1浏览器显式跳过 |
| shared | 37项通过 |
| 原生宿主 | 334通过/5显式跳过；不把这些等同于本期所有UI原生分支 |

首次allocation构建因新增测试联合类型访问TS2339失败，已改成正确的结构断言并通过；原失败日志保留。完整构建的大chunk提示和JSDOM导航提示不作为通过项或新增错误。

## 最新浏览器结果

- **M54通过**：30个全新context、每轮3页、30关注/4可见窗格、90样本、首冷计入。原生同源HTTPS/H2 API及SSE/HMR，无Page.route/Fetch拦截，无预热、重试或放宽门槛。三页interactive p95为1791.8/1869.5/1821.5ms，最大4595.8/4727.2/4716.7ms。未缓存四正文p95为3811.3/3822.7/3828.5ms，最大约7.66秒，单列历史读取。
- 输入两帧p95为48.9/50.0/87.3ms，原p95门槛100ms；第三页最大108.8ms保留。错误/任务写入为零，全部source哈希及自有资源清理通过。root独立复算保存在 `m54-app-body-final-native-http-01/root-independent-audit.json`。
- 最新暖切换、50/100关注压力3项通过，使用精确grep；暖切换仍核对正确正文、保存草稿和真实输入，50/100全正文耗时只作压力记录，不冒充两秒加载。完整记录为 `app-body-final-browser-closure.json` 及 `warm-pressure-app-body-final-01/`。
- 38518源M08三次434.6/434.6/316.1ms通过；三种正文保留/回收自然等待通过。HMR首轮因主机inotify配额ENOSPC在负载前失败，保留原证据；仅自有临时Vite启用轮询监听后3项通过。App加载改动后的恢复/草稿/错误边界验证另由专项及最新M54覆盖，不把旧源记录改成新执行。
- M03/M34实际隔离native分页与新聊天、M55实际CLI同线程三页/手机尺寸/运行刷新属于此前独立来源的动态子集。正式LAN canary只发送一次唯一accepted/completed任务；原v7总报告false保留，完成和只读错误归因另记，不把旧canary冒充最新App源码全路径重验。

上述“通过”是本轮p95与所列分支，不代表每次冷进入均≤2秒，也不代表全部正文≤2秒、物理iPhone或全部原生组件分支已验证。

## M39与历史红灯

用户在本轮明确决定“先提交已验证修复，内存问题单独跟踪”。这只放行本次已验证修复的提交，保留原内存标准及全部红灯，未将M39改成通过。

最新源码唯一一次原标准三十分钟M39已在23:01启动，输出 `.dev-runtime/root-native-memory-20261030/app-body-final-strict-thirty/`，当前仍运行，尚无验收结论。保持≥850周期、90–300秒/最后180秒窗口、heap64/256MiB、RSS128/768MiB门槛，自然GC、完整Network回调和4MiB/1MiB观察缓存预算；不修改源码、强制GC、刷新、清缓存或并行运行其它浏览器负载。

38517/C1E4原标准885周期/1800.284秒的RSS低点增长134.910MiB，仍为RED；RSS断言阻断的内部末态UI/audio/source断言不计通过。38518的原M54单次90样本p95=2013.4ms RED也保留，未对同版重复挑绿。38518的M39仅准备过，因新App修复而superseded，不能算一次长测或失败。

更早38337、38444、38445的通过/失败、错误HMR夹具、22分钟原生分配诊断、10分钟Network-disable诊断和4分钟V8采样均按原来源保留在矩阵及性能记录。V8采样的profile取回会触发强制GC，后段只作诊断；采样分配总量不是存活堆、RSS或根因闭合。四分钟热点修复不能替代当前三十分钟结果。

## 服务与提交边界

共享官方daemon的实际版本为0.163.0；原PID/startTicks和binary身份已只读复核保持。CLI链接/配置所指其它版本不能代替实际运行身份。`daemonIdentity`为固定Unix端点文件身份摘要，不是SO_PEERCRED。自有运行层维护与现有服务兼容规则见[维护记录](runtime-replacement.md)。

按用户最新决定，已验证修复统一作本地提交，M39独立跟踪，不等待其结算作为提交前提。提交前核对证据、忽略规则和索引内容；没有推送授权。私有部署配置、日志、证书、凭证和工作区无关的三个下载HTML不纳入提交；所有旧红灯及未覆盖边界保持可见。
