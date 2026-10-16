# Goal 原生隔离验收

统一入口是 [`scripts/session-goal-native-acceptance.py`](../../session-goal-native-acceptance.py)。它保留 2026-10-16 已复验的 metadata、active、产品 runtime clear 和原生 CAS 反例；这些 fixture 不随开发服务启动。

从仓库根目录运行，CLI 必须由调用者显式指定绝对路径：

```sh
python3 scripts/session-goal-native-acceptance.py \
  --codex /absolute/path/to/codex \
  --output-dir .dev-runtime/goal-native-acceptance \
  --scenario runtime-clear
```

`--scenario` 可选 `metadata`、`active`、`runtime-clear`、`cas`、`all`，默认 `all`。每次在显式证据目录下新建权限为 `0700` 的目录，输出 `summary.json`；各场景保留完整 native 请求、ACK、通知、provider SSE、network decision、strace 和 `result.json`。不覆盖旧证据，不写 fixture 源码目录。

无 CLI 时可以显式跳过，不自动发现系统 CLI、默认 IPC 或登录配置：

```sh
python3 scripts/session-goal-native-acceptance.py \
  --output-dir .dev-runtime/goal-native-acceptance --scenario runtime-clear
```

该命令退出 `0`，但结果是 `status: skipped, passed: false`，不能计作验收通过。指定了不存在的 CLI 默认退出 `2`；显式加 `--skip-missing-cli` 才记为跳过。

## 场景与判定

| 场景 | 验收内容 |
| --- | --- |
| `metadata` | loaded、未加载和外部 writer 历史的 Goal get；内核 writer lock 前后不变；paused 预算设置；clear true/false。无模型 turn，全部 native connect 禁止。 |
| `active` | 新 thread `/goal objective` 的 turn ACK 早于 active Goal set；已有空闲 thread active 自动启动；pause 不再续跑；三轮 blocker 后 blocked；显式恢复；实际 `update_goal(complete)` 工具与精确 turn 完成。 |
| `runtime-clear` | 直接加载当前仓库 `Ownership`、`StdioRpc` 源码。真实 native complete 事件后，等当前 turn 完成再单次 clear；旧 owner generation、同秒旧 full Goal 都必须保留替换目标；不 resume 或读取完整历史。保留产品源码 SHA256。 |
| `cas` | 捕获完成 Goal A，设置不同完成 Goal B，再 raw clear `{ifGoalUnchanged: A}`。只有返回 false 且 B 完整保留才算 CAS 假设通过。 |

已验证的 `0.162.0-alpha.17.2` 原生忽略 `ifGoalUnchanged`，返回 `cleared:true` 并删除 B。因此 `cas` 的实际结果保持 **红灯**，`passed:false`、退出 `1`；包含它的 `all` 也退出 `1`。不会把已知协议边界换成“预期通过”。未来版本仍按同一反例实测，不能仅凭未知字段未报错宣称 CAS 支持。

CAS fixture 要求 A/B 的秒级时间戳相同；仅在已收到明确设置 ACK 后最多准备三组元数据样本。无法满足时记为未能完成反例，不推断能力。该 A/B 反例的 clear 不重发；若原生满足条件，再检验精确对象的清理。

产品 clear-completed 是本地 full Goal/revision、现有 writer/generation/epoch 和 stdin 前的同步 guard；原生 get→clear 之间的跨进程变化仍是协议边界。该验收不声称跨进程原子 CAS。

`usageLimited` 仅通过原生 API 显式设置元数据后验证恢复，没有模拟真实额度错误。pause 与 blocked 的安静观察窗口分别为 1.25 秒、0.75 秒，不替代长测。假 provider 的 token 数是确定性计数，不是真实模型费用。

## 环境与隔离

- 需要 Linux x86_64、Python 3.8+、`strace`。active/runtime 使用 seccomp USER_NOTIF 与 `process_vm_readv` 核对每次 native connect；内核或主机策略不支持时直接失败，不降级到允许外网。
- runtime-clear 还需要项目支持的 Node.js 版本和本 checkout 的锁定依赖（`pnpm install --frozen-lockfile`）。入口不安装依赖，不下载 CLI。
- 每次使用全新私有 `HOME`、`CODEX_HOME`、XDG 和临时目录，环境变量采用允许列表。没有 auth 复制、链接、OAuth 或真实模型调用；native app-server 只走自有 stdio。
- fixture 显式启用 `features.goals=true`，不证明正式用户的默认配置已启用 Goal。
- 假 Responses provider 只绑定 `127.0.0.1` 的系统分配端口。native 只能连接该次 provider；IPv6/UDP、其他 TCP 地址和默认 CLI IPC 都不能连。runtime 的抽象 Unix socket 仅用于把自有网络过滤器交给自有监督进程。
- 只关闭本次 `Popen` 创建的进程／进程组，原生 PID 残留按私有 `CODEX_HOME` 核对；不寻找、关闭或重启正式 Agent、运行服务或默认 IPC。

原始 Goal schema 来自实际 provider request 中 native 广告的工具定义；fixture 不猜测 `update_goal` 参数。`metadata.py`、`active.py`、`runtime_clear.py` 是独立场景，网络监督器与启动包装器在同目录共用。代码未包含任何机器 CLI 路径、固定服务端口或凭据。

入口契约测试不需要 CLI：

```sh
node --test scripts/session-goal-native-acceptance.test.mjs
```

该入口不证明官方 GUI、ChatGPT/OAuth、真实额度恢复、长期内存稳定或正式运行产物已经切换。
