# 长历史读取期间的送达核对

前端最近历史现在允许等待独立只读 reader 的既有 120 秒期限，但队列状态读取此前也共用四个 `recent` 名额。四条长历史未结束时，发送 POST 超时后的五秒送达核对可能一直未发出 HTTP，最终把服务端已经接收的消息留在待确认状态。原行为不会自动重发，不过用户无法及时看到回执。

## 实现

`sessionReadQueue.ts` 从原四个 recent 名额中固定保留一个 `status` 名额；最近历史三个、完整历史两个、队列状态一个，总数仍为六。`followupService.load`（包括既有可见队列观察及发送超时核对）使用该状态通道，仍按 thread 合并重复请求。没有新增轮询、增加原生 reader、扩大正文或 RPC 预算。

POST 的 15 秒等待与随后五秒只读核对保持。状态通道本身拥塞仍受核对的五秒总期限限制，包括排队时间；超时后保留内容和同一提交身份，不自动重发。状态读取取消、隐藏页停止快轮询、队列 revision 及迟到回执保护保持。

另一个红灯确认前端尚未派发的历史请求无法及时取消：`cancelCodexHistoryRead` 已中止 controller，但调度器直到旧名额释放才会运行该请求，届时才检查 signal。现在只对调用者明确提供的拥有者 signal 移除尚未开始的 job、清理监听和去重键、立即结束等待；再次打开同一目标可以排入新读取。独立复核又确认已开始的请求被取消后，同一个 JavaScript turn 内重开也会复用旧 Promise：现在取消时同步解除该 job 的去重身份，活跃名额仍保留至原任务实际结束，旧 finally 只能删除仍属于自己的记录。已开始的请求继续由原有 transport/deadline 处理，不因解除去重而提前放行活跃任务。共享队列状态读没有新增消费者取消行为。

## 验收

- 新用例在旧实现下失败：四条未完成最近历史占槽，服务端可提供的 `sent` 回执未被读取，得到“消息提交确认超时”。修复后同一用例得到原消息回执，POST 恰好一次。
- 原排队期限测试改为占住实际状态通道，继续证明五秒期限包含队列等待，而非删除超时断言。
- 调度测试同时注入三种工作，断言仅 3+2+1 条实际运行，总数六；后续工作正常释放和完成。
- 上述四个文件及独立 `codexHistoryCancellation.review` 共 **77 项通过**，包含真实历史服务取消后立即结算、同目标新读取不会复用旧取消 job、活跃任务取消不提前放开准入、旧 finally 不删除新身份的红绿灯。独立复核红灯在 `.dev-runtime/session-read-queue-review-20261027/active-cancel-red.log`，最终单测在 `review-green.log`。
- 浏览器加载实际服务与调度模块，保持三个真实浏览器 fetch 未完成且第四条排队，状态 GET 仍在五秒内返回；历史 HTTP 峰值为三，任务写请求零。该浏览器用例使用路由夹具，不是原生模型任务或服务器历史性能测试。
- 同一浏览器用例同时取消第四条未发出的读取，核对它立即返回 `AbortError`，随后同 key 的新读取在释放原三条后正常完成。追加证据为 `cancel-red.log`、`cancel-green.log`、`browser-cancel.log`。

证据：`.dev-runtime/session-receipt-lane-20261027/{red.log,green.log,browser.log,browser/}`。浏览器使用实际前端 **HTTPS https://10.30.0.24:8484，端口 8484**，API 全部限定为夹具；没有重启正式 Agent。

```sh
pnpm --filter web exec vitest run --config vitest.session.config.ts \
  src/session-mode/services/followupService.test.ts \
  src/session-mode/services/sessionReadQueue.test.ts \
  src/session-mode/services/codexService.test.ts \
  src/session-mode/hooks/useFollowups.test.ts
PLAYWRIGHT_SKIP_WEBSERVER=1 PLAYWRIGHT_BASE_URL=https://10.30.0.24:8484 \
  PLAYWRIGHT_FRONTEND_PROTOCOL=https pnpm exec playwright test \
  tests/e2e/session-receipt-read-lane.spec.ts
```
