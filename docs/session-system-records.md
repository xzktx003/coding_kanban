# Codex 会话系统记录

## 展示与状态边界

`thread/closed` 是运行实例关闭记录。它不等同于聊天历史被删除，也不能单凭这条事件推断当前 Agent 仍处于关闭状态。

关闭记录不再进入虚拟化聊天正文的行集合，通用事件组件也不显示它的整行协议卡片。聊天区右下角在有记录时提供一个低强调的「系统记录 · N」入口；桌面按钮高 28px，触控设备高 40px，没有记录时不占位置。

点击入口打开紧凑浮层，同类记录显示为「会话运行实例已关闭 × N」。协议名和会话 ID 在详情中按需展开。Esc、关闭按钮及点击外部都能关闭；更换会话、记录清空及正文卸载会释放浮层，后续新增记录不会自动展开。没有原生时间戳时不编造时间。

N 只来自当前会话**已加载的事件快照**，不宣称覆盖全部历史，不通过轮询补齐计数。只统计 thread ID 匹配的关闭事件；不累计第二份事件缓存，不复制正文或原始 JSON。不可见正文的既有 60 秒回收及只读恢复机制继续负责这些事件的生命周期。

这是前端展示规则。原关闭通知仍通过现有网关、事件序号、状态及待审批清理链路，未从协议流或 store 删除。错误、警告、审批和提问仍使用原展示位置。该入口没有审批、发送、停止、启动或恢复 Agent 的操作，也不改变关注集合和公共输入目标。

## 实现与复验

- `thread/closed` 行过滤：`components/codex/thread/threadRows.ts`；兜底：`items/EventItem.tsx`。
- 元数据计数：`thread/closedThreadRecords.ts`；无全局缓存。
- 角落入口：`thread/CodexSystemRecords.tsx`，由现有 `CodexTranscript` 接入；样式与 Portal 限定在 `.session-mode`。
- 红灯先验证两条关闭事件会占两行；另一个红灯覆盖「记录清空后又出现时浮层不能自动重开」。
- 定向 37 单测及事件处理、正文回收、活动/轮次展示 38 项回归通过。
- 桌面 1440 / 触控手机 390 × 深色 / 浅色四项真实浏览器通过。测试完整工作台及虚拟列表，验证两条记录合并、警告仍在正文、协议详情按需展开、浮层视口边界、Esc 焦点恢复、关闭/点击外部、跨会话隔离、清空后再次出现保持关闭、没有 Agent 写入请求及页面错误。

当前部署验证地址：**HTTPS https://10.30.0.24:8484，端口 8484**；截图在被忽略的 `.dev-runtime/system-records-acceptance/`。测试网络和会话数据由 `installSessionUxFixture` 隔离，不操作正式 Agent。

```sh
pnpm --filter web test:session src/session-mode/components/codex/thread/threadRows.test.ts src/session-mode/components/codex/thread/closedThreadRecords.test.ts src/session-mode/components/codex/thread/CodexSystemRecords.test.tsx src/session-mode/components/codex/thread/threadRows.projection.test.ts src/session-mode/components/codex/items/NativeSystemNotice.test.tsx src/session-mode/components/codex/items/TurnFailureNotice.test.tsx
pnpm --filter web test:session src/session-mode/components/codex/hooks/useServerNotificationHandler.test.ts src/session-mode/components/codex/hooks/useServerNotificationHandler.memory.test.tsx src/session-mode/components/codex/hooks/useTranscriptVisibility.test.tsx src/session-mode/components/codex/thread/activityRows.test.ts src/session-mode/components/codex/thread/turnWork.test.ts
PLAYWRIGHT_SKIP_WEBSERVER=1 PLAYWRIGHT_BASE_URL=https://10.30.0.24:8484 pnpm e2e tests/e2e/session-system-records.spec.ts --output=.dev-runtime/system-records-acceptance
```

更广的恢复回归为 4 通过 / 4 失败：后台标签恢复两视口、低序号快照恢复、阅读位置保持通过；三个静默 SSE 发送场景卡在禁用的发送按钮，另一个失败于两个「重试」按钮的严格定位。未降低断言或隐式操作 Agent；它们不是全量绿色验收。全项目前端类型检查仍有未涉及的 `codex-mode` 类型错误；新入口、行过滤和计数文件没有类型诊断。隔离修复前 UI 的对照证据另随最终验收记录追加。

修复前对照：独立 Vite 宿主只在读取时将 `CodexThread.tsx`、`threadRows.ts`、`EventItem.tsx` 替换成 HEAD 内容，不写回源码，绑定 `0.0.0.0`，使用同样的 HTTPS 浏览器上下文及当前其余源码。静默 SSE 的桌面代表场景仍卡在「发送」按钮，序号缺口场景仍出现两个「重试」导致严格定位失败；两项复现与当前源码相同的失败点。日志 `/tmp/ck-system-records-baseline-https.log`，结果 `.dev-runtime/system-records-baseline/https-results/`。先前 HTTP 对照失败在事件连接之前，不作为等效基线证据。临时前端已关闭，正式服务及 Agent 未重启。
