# 三页面刷新、唯一发送与真实 CLI 同任务验收

2026-10-30，M55按用户批准的“本期看板和CLI共享”边界执行。保留原三IDE宿主场景文字作追溯，不启动IDE宿主，不声称VSCode插件共享已验证。

## 可复现入口与实际结果

- [真实浏览器测试](../../../tests/e2e/session-multiclient-cli-native.spec.ts)及[独立服务夹具](../../../tests/e2e/helpers/session-multiclient-cli-native-server.mts)。缺少显式二进制/源地址时默认跳过；默认1项skip不能计通过。
- 最终仓库入口：1/1通过，14.8秒（测试主体13.6秒）；日志 `.dev-runtime/m55-integration-20261030/repo-final.log`。显式默认跳过另见 `repo-default-skip.log`。此前ignored入口1/1通过13.9秒，不能与最终入口相加算两种场景。
- 最终浏览器入口 **HTTPS LAN `https://10.30.0.24:33491`**，自有监听绑定`0.0.0.0`；仅静态资源只读转发自不可变 **HTTPS LAN `https://10.30.0.24:38337`**、`frozen-1793325611544`，2887 Web/89 shared，未修改该源/监听器。临时33491已在测试结束关闭。
- 浏览器无Fetch/API/WebSocket路由拦截；真实UI经独立TLS监听→生产`registerSessionModeRoutes`网关→完整`createRuntime`→官方0.163 daemon→loopback Responses provider。TLS夹具自签名证书仅限本次私有目录，未伪造浏览器安全API。
- 固定官方二进制SHA-256：`399ff69c431c066e40de318fba45c2b07f45a76b19939d247ee4828fc70c4215`。fresh私有HOME/CODEX_HOME、空项目与数据目录，未复制账号、登录、历史或默认IPC。原生夹具创建前登记所有权，退出按原官方stop及既有daemon/updater清理契约执行。

最终产物目录 `.dev-runtime/m55-integration-20261030/repo-final/session-multiclient-cli-na-fa932--actual-CLI-shares-one-task/` 包含 `m55-real-chain.json` 和 `m55-owned-cleanup.json`。测试时主机load average为13.72/12.71/13.23，正与已授权的其他非计时检查并行；此项不作为延迟基准。

## 同一次生命周期的分层断言

| 层级 | 真实断言与结果 |
|---|---|
| 页面与输入 | 3个独立browser context，桌面1440、1440和手机393；各页精确唯一composer owner，分别发送不同文字；刷新时不重新灌入选择/草稿 |
| 意图与原生任务 | 3次真实`/api/session/followups/submit`、3个不同intent ID、3个不同thread UUID；provider恰好3次请求，每个原生线程恰好1个turn |
| 运行中刷新 | 同时reload3页；原精确turn仍`inProgress`且metadata为`active`，各页Stop可见、草稿空，无虚假“该轮已中断”；provider仍恰好3次，无重复发送 |
| CLI共享 | 实际官方PTY进程通过`--remote unix://<本次私有socket> resume <精确thread0> --no-alt-screen`附着；不覆盖既有权限/模型；TUI真实显示同一用户文字及之后同一最终回复，不发送额外prompt |
| 终态与正文 | 释放本地provider后3个精确turn各完成一次，各页显示自己的最终回复；原生历史每线程仍仅1个completed turn，原生queue为空 |
| 页面收尾 | 3页均精确owner、composer清稿、无Stop/Queue/busy、有Send；不能只凭native completed计空闲 |
| 错误与清理 | page/server错误0；刷新/取消引发的3次只读请求socket取消单列，未当作服务成功或真正错误丢弃；自有daemon/updater/CLI退出、临时数据删除，cleanup两项为true |

最终精确thread：`01a18a9d-2eb6-72b2-954f-6e32d65987b0`、`01a18a9d-2ed8-7242-8901-2209938ec150`、`01a18a9d-2eeb-7681-9aec-029ccd7d5498`。官方daemon PID2757807/start ticks224537617，实际CLI PID2760192，均只属于本次私有夹具且已退出。

## Common harness 默认兼容复验（2026-10-30）

在当前immutable `https://10.30.0.24:5173` source上，默认/common-harness入口（无显式native opt-in）再次通过 **1/1，14.3秒**。三页分别提交一次到三个唯一official 0.163线程，每个意图/provider call各一次；真实PTY CLI读取同一任务，刷新期间仍active，最终三页清稿且无busy/Stop/Queue。owned official daemon/updater/CLI清理均记录退出成功。

原始runner输出 `.dev-runtime/m03-m34-20261030/m55-default.log`，每页native状态及cleanup在 `.dev-runtime/m03-m34-20261030/m55-default-results/`。当前source Web manifest `ab6a9e1e…f80ce1b`、shared manifest `2482eb77…82cd493`。该复验保留为default compatibility补证；不替代原14.8秒显式入口、当前源性能90样本、未知ACK故障或长测。

## 边界与保留失败

本项关闭M55适用的正向“3页面同任务体系并发发送/运行中刷新/真实CLI同任务/UI收尾”整合缺口。两秒逐页p95使用同最终Web源码的独立90样本验收，保留冷服务最大4.63秒；不从本项14.8秒总时长推导两秒性能。自然30分钟资源、正式用户实例与真实账号能力仍分别验收。

未注入丢失/未知HTTP ACK，未测试真实账号OAuth、托管模型、实体手机系统冻结或GUI/VSCode宿主；不能由正向每意图一次证明全部故障路径原子幂等。原生并不提供跨客户端CAS保证。

保留attempt1启动503（遗漏私有网关存储，页面未发任务）、attempt2观察器过早读取未materialized历史、attempt3预期下游取消误记错误、attempt4 CLI试图覆盖远程任务权限被官方拒绝的原始记录。修正均限验收夹具/观察器：未materialized明确记readError而不伪造空页；只对实际下游已取消分类；CLI继承原任务设置。不将这些环境/夹具失败描述为产品bug红绿。

```sh
PLAYWRIGHT_SKIP_WEBSERVER=1 \
PLAYWRIGHT_FRONTEND_PROTOCOL=https \
PLAYWRIGHT_BASE_URL=https://LAN-HOST:PORT \
M55_FRONTEND_SOURCE=https://LAN-HOST:PORT \
SESSION_CODEX_DAEMON_NATIVE_BIN=/absolute/path/to/verified-official-0.163-codex \
pnpm exec playwright test tests/e2e/session-multiclient-cli-native.spec.ts \
  --output=/absolute/fresh/private/acceptance-output
```

源地址须是已有受控局域网前端；二进制须与固定SHA匹配。夹具自行分配全新私有HOME/IPC、TLS端口及内环动态端口，实际CLI只连接该私有daemon，不附着正式会话。
