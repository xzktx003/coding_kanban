# 运行层替换：三Provider与独立数据域保护

日期：2026-10-30。接续官方共享daemon实施的整合审查。不能由“Codex任务在独立daemon中”推导出看板runtime.close不会停止任何Agent：Claude Query和ACP stdio仍由该运行层创建和管理。

## 发现与修复

1. 旧自动过期替换只查Codex thread/list，忽略Claude/ACP连接；即使Codex列表为空，也可能关闭它们的活动请求或待审批任务。现在`/health.ownedAgents`仅暴露固定标量计数：Claude连接/活动轮次/待请求，ACP连接/活动prompt/待请求/不确定状态。ACP初始化中的自有进程单独登记，计数与关闭均覆盖初始化尚未返回的窗口；关闭后禁止迟到连接重新登记。计数不包含正文、目录、登录数据或Agent完整对象。
2. 原“孤儿”扫描只凭精确cwd和entrypoint就停止进程，无法区分同一源码下不同SESSION_DATA_HOME的独立服务；甚至主计划skip也会清理。现在这类扫描只有只读候选报告。普通更新与显式维护都只操作已核实的目标runtime，候选不接收SIGTERM或SIGKILL。
3. Codex活动列表达到64页预算却尚有游标时，原实现返回不完整结果；缺少nextCursor也被当作结束。现在均明确“未读完/响应不完整”，自动替换按未知状态保留，不能把部分读取算空闲。

## 自动更新与显式维护

| 触发 | 已核实归属/构建 | 自有Claude/ACP连接 | 私有Codex活动 | 活动不完整 | 共享daemon |
|---|---|---|---|---|---|
| 普通过期替换 | 必须 | 发现即延后 | 发现即延后 | 延后 | Codex任务保留，仅允许替换看板连接层 |
| 显式`--restart-runtime` | 必须 | 按明确维护请求结束，准确报告 | 按明确维护请求结束 | 明确报告未知后执行已授权维护 | 不调用stop/restart/update，不向其进程发信号 |

旧健康响应缺少ownedAgents计数时属于未知，自动更新不会补零。显式维护仍允许使用既有已核实owner/build，避免用户授权了维护却因原生服务不可读而永久无法切换。构建/归属未知、健康不可达的边界不被force绕过。脚本仅向精确目标runtime PID发信号，进程组不是所有权证据。

## 本次只读部署预检（维护前）

日常运行层确认为本仓库旧 TS 构建，仍带有它创建的私有 app-server；小型活动列表和 loaded 列表均为空，但旧健康缺失 Claude/ACP 完整计数，因此保留 `activityUnknown: true`，不能表述为所有 Agent 空闲。监听进程的实际创建身份、父子链与进程组另存私有证据；两个开发服务组内只观察到它们自身的 watcher/构建、通知与锁子进程，原生运行层独立 SID。正式切换前须重查，不能沿用先前 PID 直接发信号。

部署环境的显式 `CODEX_PATH` 实际选择 CLI 0.165.0；官方服务当前运行 0.163.0，管理包链接另指向 0.166.0。三个版本不是同一事实，调用官方 start 不等于获得已安装管理包版本，也不得以此隐式 restart/update。实际只读 initialize、loaded/permissions/config/model/plugins/skills 成功；queue/goal/turns 只读方法对不存在 UUID 返回精确线程错误，证明处理器存在，不是写入兼容验收。此只读预检本身不证明写入与实时能力；同版本的独立私有执行验收见下文，正式线上模型或账号策略仍不由它替代。

后续已经使用与正式运行 executable SHA 相同的保留 0.163.0 二进制，完成八项独立私有原生用例及实际 Chromium WebRTC；修复展示名称导致的握手版本解析，并只将真实验证的 0.163.0/0.165.0 纳入实时准入。正式服务只读附着确认新解析为 0.163.0，原 PID/start ticks/socket scope 保持。因而当前版本障碍可由兼容修复解决，不需要停止、更新或重启共享 daemon；完整证据和默认跳过边界见[版本兼容](native-version-compatibility.md)。

在最终代码/测试和前端关卡完成后，可沿既有命令执行已授权的自有运行层维护：`pnpm dev:restart --restart-runtime`。它先准备构建及核对监听归属，替换自有前后端，再向已核实运行层的单个 PID 发信号；共享官方 daemon/独立 CLI 不作为停止目标。之后核对 `pnpm session:status` 为 current、健康的 shared-daemon 与完整 ownedAgents 字段、官方 socket 域/进程身份保持，以及真实浏览器精确输入目标、接收回执和最终空闲。该段为维护前预检；实际维护结果见下节。

私有证据目录 `.dev-runtime/session-full-implementation-20261029/`：`runtime-deployment-preflight.json`、`deployment-listener-groups.json`、`deployment-cli-discovery.json`、`runtime-deployment-native-readonly.json`、`deployment-daemon-capabilities-readonly.json`。重启 help 同步改为区分自有 Claude/ACP/旧私有任务与共享官方服务；help/status/replacement 共 53 项通过，help 不启动、编译或停止进程。

## 红绿灯与验证

`scripts/session-runtime-replace.test.mjs`先复现自动停止私有活动轮次、共享daemon掩盖Claude/ACP连接、skip仍杀同入口候选和显式维护错误阻断等反例；`restart-agents-red.log`保留失败。页预算/缺cursor另有`restart-page-red.log`。`transport/server.test.ts`先因缺少ownedAgents健康字段失败（`owned-health-red.log`），随后加入计数和初始化连接管理。

当前脚本replacement/status合计21项通过；runtime ACP/Claude/HTTP/SSE/WebSocket相关22项通过；runtime类型检查通过。覆盖真实隔离ACP初始化进程在明确close后退出、不迟到注册；Claude/ACP实际待审批/活动计数；健康字段只保留标量；共享任务保留与精确PID信号；缺测、页预算和独立数据域候选保护。信号测试使用捕获函数，没有对正式服务执行维护或扫描后杀进程。

证据均在忽略目录`.dev-runtime/session-management-read-20261030/`的`restart-agents-{red,green}.log`、`restart-page-red.log`、`owned-health-{red,green}.log`和`current-runtime-types.log`。本节专项测试本身不表示新构建已激活，也不替代整页浏览器两秒、真实设备或长时间资源验收；实际部署见下节。

```sh
node --test scripts/session-runtime-replace.test.mjs scripts/session-runtime-status.test.mjs
pnpm --filter @agent-orchestrator/session-runtime exec tsx --test \
  src/transport/server.test.ts src/acp/service.test.ts src/claude/service.test.ts
```

## 2026-10-30 正式维护结果

最终 `pnpm check` 通过，随后实际执行 `pnpm dev:restart --restart-runtime` 成功。部署入口为 **HTTPS `https://10.30.0.24:8484/?mode=session`**，后端为 HTTP `http://10.30.0.24:8282`，两者均绑定 `0.0.0.0`。旧运行层缺少完整活动字段，维护准确报告“部分 Agent 活动未知”，没有称其安全空闲；按用户既有明确维护授权，仅替换已核实归属的看板运行层。

维护前旧 TS runtime PID 1676067/start ticks 218263974，维护后已退出；新 runtime PID 2721432 为 `binaryState: current`、`codexBackend: shared-daemon`、实际连接原生版本 0.163.0。新的 Claude/ACP 自有连接、活动、待请求及未知状态计数完整且均为零，不能由此反推旧未知任务的维护前状态。

共享官方 daemon 的 PID 1670516/start ticks 165493204、实际可执行文件 SHA 以及控制 socket 的 dev/inode/ctime 在维护前后完全一致。没有停止、重启或升级官方 daemon。维护前后私有证据为 `.dev-runtime/session-full-implementation-20261029/deployment-final-{before,after}.json`，执行日志为 `deployment-final-restart-correct-args.log`。这些健康及身份核对不替代后续正式浏览器收尾/模型接受回执；具体结果见实施 README 和 LAN 验收记录。

首次按旧文档写成 `pnpm dev:restart -- --restart-runtime` 时，pnpm 10 将多余 `--` 传入脚本，立即报参数错误，未操作服务；错误日志独立保留。当前文档已与脚本帮助统一为正确命令。

后续为激活归档只读错误分类、断线恢复和最终正文预算修复，再次实际执行同一维护命令，退出码为零；自有 runtime 从 PID 2721432 替换为 1785846。这次维护前后 Claude/ACP 的完整自有连接、活动、待请求和不确定计数均为零。共享官方 daemon 的 PID 1670516/start ticks 165493204、可执行文件 dev/inode/SHA、原生 namespace 和 daemonIdentity 均保持一致，没有对它执行停止、重启或升级。第二次证据为 `deployment-current-{before,after}.json` 与 `deployment-current-restart.log`，均在上述私有部署目录。

第二次维护后的正式页面完成已有唯一 canary 线程的桌面刷新、第二桌面及手机尺寸恢复，以及三次真实 SSE 离线重连；未追加发送、停止或恢复任务。原始 v7 报告保留 `passed=false` 及浏览器诊断，独立附件给出 completed-thread 界面与只读恢复的限定通过结论。41 条只读请求取消未采集逐条发起者，不能推断原因；运行中刷新由独立 M55 原生三客户端/CLI 用例覆盖，不能由已完成的 canary 反推。详见实施 README 的正式页面证据与错误分类边界。
