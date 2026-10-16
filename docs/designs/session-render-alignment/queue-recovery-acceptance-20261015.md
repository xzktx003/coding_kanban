# 失败队列与外部占用恢复验收（2026-10-15）

## 问题与修复

截图中的 `SESSION_OWNED_ELSEWHERE` 属于发送前的明确拒绝，队列条目为 failed。原界面无条件把所有暂停显示为“由于你中断了当前响应”，且继续按钮和消息菜单没有遵循后端对 failed／uncertain 的限制，因此用户点击继续后得到“请先处理失败或送达不明的消息”。

- 暂停原因改为显示实际 `state.paused`，保留旧 `interrupted` 值的中文映射。
- failed／uncertain 存在时，主入口改为“处理失败消息／核对送达状态”，打开完整队列；消息菜单中的继续同步禁用，后面的失败消息也能找到。
- 外部占用、释放中、获取中、未知或读取失败时，禁止重试、继续及引导；编辑／移除仍按原条目状态可用。确认对话框内的重试同样受限，取消不受占用限制。
- 执行重试、继续或引导前额外只读核对当前占用；继续前重新读取队列，避免直接提交已知冲突。点击并发有本组件操作锁；服务端 revision 和原拒绝规则继续兜底。
- 释放仅恢复操作入口，不自动重发；未知送达仍需确认，消息 ID、附件和入队配置不替换，不改聊天正文中的原生接纳证据。
- 仅增加用户操作触发的元数据读取，不改变历史轮询、正文缓存或内存回收机制。官方 VSIX 和独立运行层产品逻辑未修改。

主要实现：`apps/web/src/session-mode/components/codex/composer/FollowupQueue.tsx`；提示样式限定在 `.session-mode`。

## 红绿灯与构建

1. 新增恢复测试首次运行：16 项中 14 项失败、2 项通过，复现暂停原因错误、无效继续、占用时仍可重试及缺少点击前核对等行为。日志 `/tmp/ck-queue-recovery-red.log`。
2. 修复后增加两个访问边界回归，恢复测试 18 项及既有插件标签测试均通过。与提交身份、回显及占用缓存一起复验，最终 6 文件、78 项通过：`/tmp/ck-queue-web-final.log`。
3. 后端队列／路由／真实 HTTP 集成 42 项通过：`/tmp/ck-queue-server-final.log`。补充断言：failed／uncertain 的 resume 被拒绝后，快照、消息、附件与 revision 保持不变；释放后的显式重试复用原 ID 且仅派发一次。
4. 当前工作区 `pnpm check` 通过，覆盖 shared、运行层、网关和前端类型检查／生产构建：`/tmp/ck-queue-check.log`。构建保留既有大 chunk 提示。

定向命令：

```sh
pnpm --filter web exec vitest run --config vitest.session.config.ts \
  src/session-mode/components/codex/composer/FollowupQueue.recovery.test.tsx \
  src/session-mode/components/codex/composer/FollowupQueue.plugin.test.tsx \
  src/session-mode/services/followupService.test.ts \
  src/session-mode/services/followupService.identity.test.ts \
  src/session-mode/stores/useCodexAccessStore.test.ts \
  src/session-mode/components/codex/thread/CodexDeliveryEchoes.test.tsx

pnpm --filter server exec tsx --test \
  src/services/codex-followups.test.ts \
  src/routes/session-followups.test.ts \
  src/routes/session-followups.integration.test.ts

pnpm check
```

## 浏览器验收

初始工作区存在并行合并冲突，先在 `/tmp/ck-queue-recovery-20261015/project` 验证；标记清除后更新隔离源码快照并复验。隔离前端绑定 `0.0.0.0:18495`，局域网 HTTP 地址 `http://10.30.0.24:18495`，验收结束关闭该自有测试前端。

- 新队列恢复、消息投递和停止回归合批 13 项通过：`/tmp/ck-queue-browser-current.log`。
- 队列编辑、排序、刷新、精确 turn 引导回归 1 项通过：`/tmp/ck-queue-order.log`。旧用例最初仍查找“排队消息”“排队消息 N 的更多操作”，超时后只更新为现有名称，保留顺序、内容和投递断言。
- 在正式局域网 HTTPS 前端 `https://10.30.0.24:8484` 运行核心 4 项，各重复 3 次，最终 **12/12 通过**：`/tmp/ck-queue-live-browser-final.log`。API 由隔离 fixture 和私有 Fastify 队列接管，不向真实 Agent 发送、释放或接管。

核心场景共 4 项：

1. 桌面 1280×900：占用期间按钮／菜单禁用，零恢复／重试 mutation；查看失败消息；释放不自动重发；显式重试复用原 ID 和参数，只投递一次，另一个新草稿保留。
2. 手机尺寸 393×852：同一流程；详情可见、没有横向溢出，保存截图并人工检查。
3. 未知送达：确认前保持 uncertain；确认后才重试；普通暂停可继续。
4. 外部占用时仍能移除失败消息；释放后可显式继续；被移除的消息不重发。

首次正式重复验收 7/8 通过，另 1 项在断言完成后的夹具清理阶段失败：后台 `ux-1` 队列 GET 尚未完成，HTTP fixture 已关闭，触发 socket hang up。修复为停止接收新代理请求、等待在途请求结束、停止页面后再移除路由和关闭服务；正常请求错误不吞掉，原产品断言不削弱。随后上述 12 项重复验收全部通过。原失败日志保留在 `/tmp/ck-queue-live-browser.log`。

```sh
PLAYWRIGHT_SKIP_WEBSERVER=1 \
PLAYWRIGHT_BASE_URL=https://10.30.0.24:8484 \
PLAYWRIGHT_FRONTEND_PROTOCOL=https \
pnpm exec playwright test tests/e2e/session-queue-recovery.spec.ts \
  --repeat-each=3 \
  --output=.dev-runtime/queue-recovery-20261015/live-browser-final
```

日志、源码哈希清单和手机截图归档于被忽略的 `.dev-runtime/queue-recovery-20261015/`。正式前端首页、修复组件和网关 health 均返回 200，组件包含本次访问核对逻辑。

## 验收边界

- Chromium 的桌面和手机尺寸模拟已通过；没有物理 iPhone 验收。
- 尝试 WebKit，3 项均在浏览器启动前被主机缺少动态库阻止，包括 GTK4、ICU70、GStreamer 等；不计为通过。日志 `/tmp/ck-queue-webkit.log`，未为此修改系统或绕过检查。
- 本次是定向回归及完整构建，没有宣称全仓 `pnpm test` 或长期内存验收通过。
- 检查后再次发生的占用或队列竞态仍可能被服务端拒绝，前端保留消息并显示具体错误，不盲重试。
- 不清空用户的历史、队列、草稿或附件，不重启独立会话运行层，不修改并行工作，不提交或推送。
