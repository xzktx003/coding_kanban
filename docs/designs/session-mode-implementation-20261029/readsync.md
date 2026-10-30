# 共享置顶与阅读状态：作用域和验收

日期：2026-10-30。本轮属于LG17/LG18及公共跨设备管理。关闭标签、草稿、选中项和分屏布局仍使用各自原有生命周期；本通道只存有界管理元数据，不保存正文或登录数据。

## 实际行为

管理实体按`namespace + provider kind + session ID`定位。Codex namespace来自固定共享daemon连接只读核实的账号/历史域，CC与ACP使用看板数据域；namespace不代表写入授权。置顶使用独立pinRevision，菜单撤销携带前次回执的值与修订，不能覆盖另一设备的新操作。

浏览器每个操作使用独立localStorage键，捕获原namespace、原服务端10分钟operation window及UUID；没有整map读改写互相覆盖。服务端在写入原生前先持久保存unknown意图；网络丢回执只重查同一个操作ID，原生未知不再次执行。过期窗口或切账号保留旧记录并显示阻断，不改用新token。相同快照不重复通知stores，确认缓存仅保留64个小回执。

自动已读必须是当前选中会话、会话模式可见、页面有焦点、最新回复末端确实进入视口。先从固定只读`management/read-context`读取精确thread、最新terminal turn和opaque原生read revision，再开始250ms可见停留；不能等到提交时再获取新revision绕过CAS。原生read-state通知、账号/运行域变化、隐藏或手动未读均使旧观察失效。同值新账号事件同样撤销作用域。原生revision保持字符串，真实写入为`operation:{type:read|unread}`。

手动未读增加独立manualUnreadRevision；旧可见观察和旧pending乐观投影不能清掉新未读。显式“全部标为已读”逐个捕获精确目标的proof，已成功部分保留，失败/未知部分不自动重发。配置原生read同步的服务必须同时收到原观察捕获的revision与scope；省略这两个字段不能退化成只修改看板已读。CC/ACP的公共管理仍不假造Codex原生revision。

首次建立共享namespace或切账号时，原无作用域的本地receipt保留为本机恢复副本，不上传到新账号。旧账号正文、选择或草稿不会通过这条元数据通道被重新绑定。HMR和工作台释放取消自有timer、HTTP和store订阅，不停止Agent。

## 红绿灯和当前证据

专项代码：`apps/web/src/session-mode/services/sessionManagement{Client,Sync}.ts`、`hooks/useSessionReadReceipt.ts`、`apps/server/src/{routes/session-client-control,services/session-read-context,services/session-management}.ts`。

本轮先后真实复现并修复：dwell中手动未读被重新自动清除；第一次namespace误沿用无scope的legacy receipts；旧pending read投影盖过新manualRevision；原生Window.fetch被当作类实例方法调用触发Illegal invocation；局域网HTTP没有crypto.randomUUID导致操作无法创建。UUID复用仓库`uuid`实现，不修改浏览器安全源开关。最后独立审查又复现配置了nativeRead但省略proof即可只改看板的绕过，新增拒绝门禁，保留无nativeRead隔离fixture的本地语义。

当前专项为19项web与13项server通过；省略proof反例日志为`.dev-runtime/session-management-read-20261030/proof-required-{red,green}.log`。实际双浏览器验收通过1项，监听绑定`0.0.0.0`，本次LAN地址为**HTTP `http://10.30.0.24:39471`**（私有测试完成后关闭，不是正式服务地址）。桌面1440与手机393×852使用真实production管理client/store/hook、production HTTP routes及本地原生协议fixture；read→unread在两个context同步，另一设备dwell期间手动未读、刷新保留和延迟proof切账号均通过。12次只读metadata请求、4次精确原生CAS写入分别保存在`current-proof-browser/**/shared-management-http.json`，页面与监听器按自有生命周期清理。

该HTTP测试明确`fullWorkbenchCovered:false`：它证明真实浏览器接收器、状态/视口和HTTP协议，不能冒充完整菜单、三页p95或实体手机。实际官方0.165原生opaque revision CAS另由共享daemon测试覆盖。后台预热不因此清除未读；性能与资源门禁仍由对应组合验收负责。

复验命令：

```sh
pnpm --filter web exec vitest run --config vitest.session.config.ts \
  src/session-mode/services/sessionManagementSync.test.ts \
  src/session-mode/services/sessionManagementClient.test.ts \
  src/session-mode/hooks/useSessionReadReceipt.test.tsx
pnpm --filter server exec tsx --test \
  src/services/session-management.test.ts \
  src/services/session-read-context.test.ts src/routes/session-client-control.test.ts
PLAYWRIGHT_SKIP_WEBSERVER=1 pnpm exec playwright test \
  tests/e2e/session-management-shared-http.spec.mts
```
