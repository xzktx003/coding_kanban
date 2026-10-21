# 后端偶发退出与全终端重连（2026-10-21）

## 现场证据

本机 `.dev-runtime/server.log` 记录了四次真实进程退出。下表时间取异常前最后一条结构化日志，接近异常时刻，不是额外埋点记录的精确退出时间；均为北京时间。

| 时间 | 退出的网关 PID | 后续恢复 PID |
| --- | --- | --- |
| 2026-10-21 15:15:37 | 1011484 | 1497452 |
| 2026-10-21 15:16:33 | 1497452 | 1500369 |
| 2026-10-21 18:34:38 | 1500369 | 1952165 |
| 2026-10-21 18:34:49 | 1952165 | 1952906 |

每次都有相同调用栈：`ssh2` 的 Client 发出 `All configured authentication methods failed`，Node 报 `Unhandled 'error' event`，退出码为 1；随后 watcher 输出 `Gateway exited unexpectedly (1)` 并按既有策略恢复。整个网关进程退出会关闭它持有的终端 WebSocket，因此不使用该远端的卡片也会重连。

这是本次现场已确认的退出路径。没有将它归因为内存不足、浏览器刷新或 watcher 无故重启；认证失败本身的远端配置原因不由这份堆栈确定。

## 根因与修复边界

`apps/server/src/services/sftp-service.ts` 是网关内的 `ssh2.Client` 创建入口，连接池仅以 `once("error")` 拒绝首次连接 Promise。第一次错误消耗监听后，SSH agent／认证回调或传输层的迟到错误就可能成为未处理事件，终止 Node 进程。

连接生命周期现遵循以下规则：

- connect 前注册连接和完整监听，Client 的整个生命周期保留 `error` 监听；连接失败、超时、关闭和同步 connect 异常只拒绝／释放该连接。
- 所有释放入口都核对实际 Client 身份，旧关闭回调、旧读操作失败或旧 idle timer 不能结束同一目标的新连接。
- 从连接池删除自身后再 `end()`，避免同步 close／error 重入。
- 后台 homePath 查询的 rejection 必须被观察；绝对路径调用不因此触发未处理 Promise，`~` 路径仍收到原始查询失败，不伪造成功。

不安装全局 `uncaughtException`／`unhandledRejection` 吞错处理，不禁用 watcher 恢复，不修改 SSH 认证参数，不清理其他主机或终端。认证仍失败时，相应远程文件请求仍返回错误。

## 回归与运行验证

在独立 worktree 先复现六个失败用例，再修复；正式源码在验证前未修改。新增用例共九项，覆盖重复认证错误、ready 后传输错误、旧连接 close、旧请求失败、ready 前关闭、后台 homePath rejection、连接超时、同步 connect 异常和 end 同步回调。后台 rejection 用真实 Node 子进程证明旧版退出 1，修复后正常退出且 `~` 仍能读取到原错误。

最小定向命令：

```sh
pnpm --filter server exec tsx --test --test-concurrency=4 \
  src/services/sftp-connection-lifecycle.test.ts \
  src/services/sftp-service.test.ts \
  src/services/file-system-utils.test.ts \
  src/services/workspace-files.test.ts \
  src/services/feishu-workspace-files.test.ts \
  src/routes/filesystem.test.ts \
  src/routes/workspace-files.test.ts
pnpm check
```

上述 73 项定向测试及 `pnpm check` 通过，另经独立只读复审。正式应用走既有网关热更新，不切换独立会话运行层，不停止 tmux pane／Agent；生效时已有浏览器连接会正常重连一次。

本机应用后仅记录一次计划内 shared 准备／网关替换，网关 PID `1952906 → 2522988`。56 个 tmux pane 的 ID／PID 均保持一致，独立会话服务仍为 PID `1970238`；约 30 秒内 16 次健康采样均成功且网关 PID／start ticks 不变，新增日志没有异常退出或未处理错误。LAN HTTPS 代理 `/api/health` 返回 200。该观察仅证明本次应用和短时稳定，不替代长期运行验证。

局域网入口为 **HTTPS `https://10.30.0.22:8484/?mode=terminal`，端口 8484**；实际机器依 `.env`。上线后的短时健康／PID观察不能证明所有长期断线原因均已消除，后续异常仍按退出码、错误栈和 PID 变化分别核对。私有原始日志、进程快照和测试输出不进入版本库。
