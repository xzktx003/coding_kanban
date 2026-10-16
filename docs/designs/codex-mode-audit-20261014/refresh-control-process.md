# 刷新恢复：独立持久管理进程

2026-10-15。已授权计划的隔离实现，默认启动不启用，完整阶段 1–3 与两秒关卡仍未通过。官方 VSIX、官方聊天 DOM、输入事件和 MessagePort 保持原实现。

## 进程和连接

新增 `refresh-prototype/control-service.mjs`、内部入口 `control-worker.mjs`、私有接口 `control-channel.mjs` 和有界传输 `control-peer.mjs`。独立 Node 进程持有既有 manager、10 项 LRU、资源监测器与各 profile 的页面租约；网关只持有自己的控制连接。网关连接退出不清空这些状态，重新连接可以用原页面令牌恢复同一租约。

```mermaid
flowchart LR
  page[浏览器自有保护客户端] -->|同源 WSS 元数据| gateway[Node 网关]
  gateway -->|私有 Unix JSONL| control[独立管理进程与页面租约]
  control -->|独立 initialize 和订阅| native[已验证私有 native 服务]
  page -->|现有官方页面协议| host[原始 code-server 与官方扩展]
  host -->|现有私有 CLI 包装器| native
  host -->|显式受控 wrapper 的账号摘要核对| control
```

两条 Unix 通道不能混用：既有 native socket 使用其原生 WebSocket 协议，新 control socket 使用自有元数据 JSONL。它不接受原生 RPC 方法、用户提交、审批答案或中断命令。显式 `--refresh-control-root` 将 CLI 摘要核对接入该通道；新服务另有独立 [原生初始授权锚](refresh-native-authority.md)，跨 manager 重建不改绑。授权锚通道与 control/native 通道也不混用；自动纳入所有客户端及完整官方权限验收仍待完成，见 [桥接授权](refresh-bridge-authorization.md)。

## 显式接入

由本地进程所有者创建全新、规范绝对路径的 `0700` 控制目录，提供已有 private native 的固定 metadata 和完整运行身份；不会启动或重启 native。示意中的路径、profile、预算与进程根均由调用方配置，不接受浏览器参数：

```js
const scope = {
  domain: service.record.domain,
  generation: service.record.generation,
  pid: service.record.pid,
  startTicks: service.record.startTicks,
};
const control = await startRefreshControlService({
  runtimeRoot: freshPrivateControlRoot,
  metadata,
  scope,
  profiles: [profileId],
  roots: ownedResourceRoots,
  memoryBudgetBytes: configuredBudget,
});
const connection = await control.connect();
await registerNativeCodexRoutes(app, {
  gateway,
  profileId,
  visibility: connection.visibility(profileId),
});
app.addHook("onClose", () => connection.close());
```

新网关显式调用 `attachRefreshControlService({runtimeRoot, metadata, scope})`，随后创建自己的连接，不再次 start。控制器返回的 `visibility(profileId)` 与原有注册接口相同，status 和浏览器不接受任意上游地址。固定 profile 清单由所有者提供，自动配置、来源持久分配和完整宿主注册仍待实现。

启动先排除现有 config、记录、socket 或 launch 文件，再以 `wx` 预留目录状态。工作进程使用环境允许名单、私有 HOME 和独立进程组，继承的 stdout/stderr 为 ignore；不导入默认登录或历史。工作进程重新验证固定 CLI/VSIX 和 native 身份、绑定原生账号后，才发布就绪记录。记录先完整写入私有临时文件并同步，再以不覆盖的硬链接原子发布，避免父进程读到半份 JSON。默认启动等待 30 秒，允许显式 1–60000 ms；超时保留自有 launch/config 供核对，不假定进程已死，也不自动重启。

`control-config.json`、`control-launch.json`、`control-service.json` 均为 `0600`。就绪记录包含控制进程 PID/start ticks、随机控制代次、完整 native scope、socket inode/dev 和一个能力令牌；不得复制到日志、浏览器或提交仓库。令牌仅验证本地 owner 通道，页面租约令牌仍按原规则只向该页面回复。

## 验证与有界协议

- 每次连接先验证目录、记录字段、控制进程 PID/start ticks、socket 的 UID/权限/真实路径/inode/dev；握手再验证完整 native scope、控制代次和令牌，连接完成后重查。失效记录或 endpoint 不替换、不回退、不停止任何进程。
- 只允许 `hello`、`attach`、`update`、`disconnect` 及私有 `authorization` 摘要读取；反向 `verify` 调用网关持有的实际宿主检查，替换事件仅通知原页面。控制器内部每次 `assertCurrent` 均通过该反向调用完成，不能用握手时的一次检查替代后续写入前核对。
- 单帧含换行最多 8192 bytes，严格 UTF-8；部分帧、解析中帧和 socket 待写队列均有界，最多 64 个待决请求/正在处理请求，保留最近 256 个收到的 ID 拒绝近期重复。未知回执不重放；超时关闭自有通道并拒绝待决操作。
- 默认 RPC 和首帧等待 5 秒。一个控制进程最多 32 条网关连接、32 个固定 profile；每连接至多 64 个页面 handle，全进程至多 64 个同时登记操作。页面和 manager 的原有 64 租约/256 身份及消费者限制仍生效。
- 连接关闭只 disconnect 该连接的 handle，中央租约进入已有断连宽限，不能清除新连接已接管的页面。迟到读取/回执必须重新验证原连接；一个页面的替换回调抛错不能关闭同网关的其他页面。

Node 监听一个随机、未发布的内部 socket 名，再把该 socket inode 以硬链接发布到 `control.sock`。关闭时 Node 只清理自己的内部名；公共名仅在 inode/dev 仍匹配时删除，防止停止监听器时删除后来替换的 endpoint。已存在 endpoint 的启动拒绝及替换后关闭均有回归。

## 资源与关闭

资源监测器自动纳入 native 和本控制进程的精确身份，另外至多 31 个根由实际本地所有者提供。仍是保守的 RSS 求和，并保留完整进程/task 测量、五秒有效期、未知/过期/超预算拒绝新增空闲保温；没有周期性历史读取。调用者没有列出的宿主不能当作已统计，某个旧根退出后也不会自动继承新 PID。全部宿主动态注册和新监听器/宿主准入仍未闭合。

当前操作内对明确的资源缺测错误最多做三次完整复测、间隔 25 ms；持续缺测仍拒绝保温，账号失效会阻止后续测量。启动失败仅在私有 `control-startup.json` 留固定阶段/错误类别枚举，不保留配置内容或异常文本，不覆盖已有文件。旧的未分类失败不能据后续绿色样本推定已经归因。

PID 身份捕获现在只双读 `/proc/<pid>/stat` 并核对 UID、proc inode、start ticks 和非 zombie 状态；不再依赖可能已经退出的工作线程 children。**完整资源测量仍枚举全部 task**，遇到缺测照常失败，不因身份读取修复而忽略后代或缩小 RSS。确定性注入 task 消失的用例同时验证这两条不同契约。

网关的 `connection.close()` 不关闭中央管理进程。控制进程收到本地所有者的 SIGTERM/SIGINT 时，关闭自己的监听器、页面保护与管理订阅，不调用 native shutdown，不发送 turn interrupt，不停止原生服务。没有 HTTP 关闭接口或自动进程接管。

## 验收范围

`refresh-control.test.mjs` 覆盖跨网关连接的原租约复用、其他页面独立、远端宿主检查、身份/令牌/路径/UTF-8/帧限制、权限失效、迟到更新、检查超时、部分初始化回滚及替换回调异常。`refresh-control-service.test.mjs` 使用固定原始 CLI、全新私有 HOME、loopback 受控模型：创建控制进程的父进程退出，运行 turn 与空闲上下文跨连接保留；全部页面消费者离开后空闲上下文仍在池中；显式关闭控制进程只使空闲订阅按原生宽限释放，运行 turn 继续并完成。共两次本地模型调用，运行 turn 只有一次。未提供 `NATIVE_CODEX_REFRESH_CLI` 时真实测试跳过，不能计为验收。

服务端实际 profile 路由通过真实私有通道调用控制器，运行代次改变后拒绝更新并保留旧保护。浏览器平台脚本也经实际 Vite/HTTPS/WSS → 网关 → 私有控制通道检查两桌面与 iPhone 16 尺寸模拟；其 manager 仍是平台夹具、与网关同进程，结果明确 `managerInSeparateProcess=false, nativeService=false, officialNativeUi=false`。它与另一项真实 detached/native 测试不能拼接成未执行的官方 UI 端到端或两秒通过。

原始失败和最终结果见 [持续进度](refresh-recovery-progress-20261015.md)。独立管理进程的组件已实现；全桥接授权、自动 profile/持久源分配、全宿主资源准入、官方操作与大消息兼容、两秒/180 次矩阵/30 分钟长测仍在实施，正式入口不启用。
