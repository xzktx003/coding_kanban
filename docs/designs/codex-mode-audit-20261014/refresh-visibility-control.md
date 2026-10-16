# 刷新恢复：可见页面保护连接

2026-10-15。属于已授权刷新方案的隔离实施，**默认入口未启用，尚未完成阶段 1–3 或两秒验收**。正式 Agent 不迁移、不停止；官方 VSIX、iframe、父节点、MessagePort 与原生输入事件不修改。

## 组件与接入

- `packages/native-codex-host/refresh-prototype/visibility-leases.mjs`：连接现有、已验证的生命周期管理器，只保存有界页面身份与可见 thread UUID。
- `apps/server/src/routes/native-codex-visibility.ts`：显式 profile 的独立 WebSocket 路由 `/native-codex/clients/<UUID>/kanban-visibility`。放在现有支持 WS 的原生代理前缀，实际 Vite 检查这条路径；不修改通用 `/api` 代理规则。复用当前网关的同源校验，不能选择端口、目录、PID 或其他运行服务。
- `apps/web/src/codex-mode/native-visibility.ts`：自有元数据连接。只有 status 明确提供 `refreshVisibility.available=true`、profile 和当前真实宿主实例均已确认才启动；默认入口不连接。
- `CodexWorkbench` 根据实际布局中的可见窗格上报 UUID；空白新聊天没有 native thread 时不登记。模式切换、页面隐藏只调整自己的消费者，后台任务与审批由原生命周期继续保护。

由进程所有者显式创建 manager/resourceMonitor 后接入；资源根仍须列齐，不接受 HTTP 提供的 PID：

```js
const visibility = createVisibleLeaseController({ manager, profileId });
await registerNativeCodexRoutes(app, { gateway, profileId, visibility });
// 关闭该所有者时，先关闭页面连接，再核对清理结果；不调用 native shutdown。
const { unreleasedConsumers } = await visibility.close();
```

独立持久管理进程现也可经 `connection.visibility(profileId)` 提供相同接口，网关退出后中央租约继续存在。每次内部宿主检查通过私有反向 verify 调回实际网关验证，不以一次握手替代写入前检查；启动、复用和资源所有权见 [独立管理进程](refresh-control-process.md)。

新宿主记录的 `refreshConnection` 包含完整 domain/generation/PID/start ticks；网关在每次页面登记操作前后核对它与 manager 的固定服务身份，并通过实际 companion 状态确认精确 instance。旧记录缺字段、身份变化或状态未知均拒绝保护登记，不回退另一服务。已有旧宿主仍可沿原路径工作，不因该字段新增而重启。

## 协议与生命期

首帧为 `{type:"hello",instanceId}`；重连可增加成对的 leaseId/token。服务器返回自己的随机 leaseId/token，令牌仅用于恢复这一个页面保护，不授予原生输入、审批或中断权限。服务端租约表只存摘要，按来源与 instance 绑定；令牌不进 URL、日志或磁盘回执。浏览器仅在本标签的 sessionStorage 保存一份当前实例身份。

可见快照为 `{type:"visible",sequence,threadIds}`，成功后回复 `{type:"ack",sequence}`。序号必须递增，字段严格匹配；客户端一次只等待一份回执，布局变化合并为最新快照。真实 cwd 由服务端 `thread/read(includeTurns:false)` 和 realpath 得到，不接收浏览器目录。该接口不存储或传输消息、附件、草稿、命令、工具正文或完整历史，不转发用户提交。

新连接使同租约旧连接失效，迟到解析、原生读取或回执不得修改新连接的可见集合。更新保留旧保护直到新集合已验证并登记；未知状态不先清空旧消费者。清理失败的租约拒绝继续增加登记，保留未释放计数。

断连保护默认 60 秒，可显式配置 1–300000 ms；仅在最后连接断开后计时，保持连接时没有这个过期时间。它独立于 code-server 断连宽限和 Session 正文 60 秒回收，也**不是保温池 TTL**。到期只释放自身可见消费者，仍空闲的上下文进入原有最多 10 项 LRU；活动、审批、问题及未知上下文不因此停止。

浏览器隐藏通知延迟 100 ms，pagehide 会取消该通知并关闭自有连接，避免普通刷新先发送空集合再丢掉保护。pageshow 可重新连接。新标签可能复制 opener 的 sessionStorage，因此只有实际 navigation type 为 reload 的初次加载才使用保存令牌；新导航新建页面租约，同一文档的网络重连使用内存身份。未知浏览器能力不推断为刷新。

## 回收与有界保护

| 位置 | 上限及行为 |
| --- | --- |
| 单 profile 控制器 | 默认最多 64 个租约，最多 64 个进行中的登记操作；单快照最多 64 个不同 UUID。不是整个服务的最终资源预算。 |
| 单 profile 网关 | 最多 64 个连接；独立 8 KiB 消息和发送队列；拒绝二进制、额外 query/subprotocol 与并发未确认消息。原 native/global WS 预算保持。 |
| 活性与回执 | 首帧和浏览器回执等待有界为 5 秒；30 秒 WS ping/pong 检测断连，无历史轮询；客户端最多连续尝试 3 次连接。 |
| 生命周期管理器 | 现有 256 个身份/消费者与 64 个队列操作限制保持，失效观察至多 64 个；账号失效立即关闭自有保护连接，不停止 native。 |
| 池回收写入 | 已验证目标的可见意图同步生效，池观察版本与原生版本在实际 unsubscribe beforeSend 共同核对。 |
| 成功后的 closed 事件 | 仅对已知成功回执，按新一次原生已卸载证明及双方版本、消费者再核对后移除。未知回执仍保留，不重发取消订阅。 |

## 验证与剩余工作

定向红绿灯：`refresh-pool/manager/adapter/visibility.test.mjs`、服务端 `native-codex-visibility.test.ts`、前端 `native-visibility.test.ts` 和 `CodexWorkbench.visibility.test.tsx`。固定原生版本的 `refresh-service.test.mjs` 增加真实连接断开超过 native 一秒卸载宽限、重连保持、11→10 排除可见项、释放可见后 LRU 与 cold resume；本地受控 provider 共 13 次调用，原运行轮次仍仅一次，正式历史未写入。

实际浏览器平台检查（前端绑定 0.0.0.0，HOST 为本机真实 LAN IP）：

```sh
NATIVE_CODEX_REFRESH_BROWSER_HOST="$LAN_IP" \
NATIVE_CODEX_REFRESH_BROWSER_OUTPUT=/absolute/fresh/private/output \
pnpm --filter server exec tsx ../../tests/e2e/codex-refresh-visibility-browser.mjs
```

该脚本创建自有临时 HTTPS/TLS、实际 Vite/共享代理配置、真实 WebSocket 和原始客户端源码，测试两个桌面页、新标签复制存储、硬刷新空档及 iPhone 16 393×852/DPR 3 触控。明确 `platformOnly=true, officialNativeUi=false, nativeService=false`；它没有官方聊天 renderer，不能代替官方 UI 或两秒验收。实际 native 生命周期由另一组真实原生测试证明，不能拼接成尚未跑过的整端证据。显式负向参数 `NATIVE_CODEX_REFRESH_VISIBILITY_NEGATIVE=1` 只在该测试编译副本去除 reload 判别，确认真实新标签反例会失败；产品文件不改。

平台夹具编译一次诊断客户端并使用 `server.watch:null`，不验证 HMR 或恢复性能。硬刷新先提交新 document 的非脚本前缀，再暂缓脚本，以真实页面卸载形成保护空档；不能只发头后假定旧页面已卸载。脚本独立记录各清理阶段，任一失败使结果失败，临时 TLS 和测试监听器均归本夹具所有。

独立持久管理进程已显式实现，完整官方桥接授权绑定、自动 profile 与持久来源分配、全部宿主/监听器资源准入、完整官方多端交互、180 次性能与 30 分钟长测仍待闭合。已记录的官方普通刷新约 14.59–15.24 秒失败不改变；当前这组功能通过不作为最终启用依据。详见 [持续进度](refresh-recovery-progress-20261015.md)。
