# 双页、分屏与长历史联合恢复验收

验收入口：`tests/e2e/session-multi-client-recovery.spec.ts`。本项只新增浏览器测试和本文，不修改产品行为。对应已批准 `plan.md` 的恢复不丢草稿、未知回执不重发，以及多项目分屏／长历史阅读位置要求。

## 场景与断言

- 同一浏览器 context 的两个同源页面，共享真实浏览器存储；A 通过鼠标拖拽建立两个项目的分屏，B 保留单组布局及自己的选中目标。
- 历史通过产品 fetch 路径读取，夹具返回 10 个原生 turn、1,200 个消息 item；正文真实渲染并进入虚拟化阅读。没有通过直接写 store 制造历史、未读或队列状态。
- A 保存草稿并向上阅读，记录可见正文行身份及相对 viewport 偏移。A 隐藏期间，B 在项目 B 输入并提交一次；隔离 API 返回 `uncertain`，B 随后编辑新的未发送草稿。
- 隐藏 4.5 秒窗口中 A 的队列 GET 为零，B 的队列读取继续。A 重显后恢复读取；composer 的 `data-owner-thread`、当前标签、项目标签及双页布局仍匹配，草稿保持。
- 后台任务由 API 的真实历史响应从 `inProgress` 转为 `completed`，要求出现未读提示。A 切换查看该回复后未读清除，再切回原长历史；原草稿和阅读锚点保持，偏移容差为 2 CSS px。
- 网络只允许 B 的一次显式夹具 `/followups/submit`，核对其 thread 和 cwd；禁止额外发送、队列变更、停止、中断、resume、fork 或删除。整个场景不通过重发确认未知回执。

所有 `**/api/**` HTTP 请求均由 `installSessionUxFixture` 或本测试的更具体路由接收，WebSocket 被夹具关闭；EventSource 使用稳定的本地替身。本项不能作为原生 SSE 协议或真实 Agent 执行验收。`document.hidden` 和 `document.visibilityState` 同步模拟，用于排除 headless 窗口管理器差异，不等同于操作系统后台节流或实体手机行为。

这是一项有界联合交互验证，不替代计划中的 10,000 事件长测、30 分钟 renderer RSS 门禁、所有原生像素状态、跨设备网络联调或 HMR 验收。

## 执行与产物

局域网入口：**HTTPS `https://10.30.0.24:8484`，端口 8484**。复用现有前端，不重启正式服务。下面的 `final-01` 必须为全新输出目录，重试使用新的批次目录，保留旧失败记录。

```sh
mkdir -p .dev-runtime/session-multi-client-recovery-20261027/final-01
PLAYWRIGHT_SKIP_WEBSERVER=1 \
PLAYWRIGHT_FRONTEND_PROTOCOL=https \
PLAYWRIGHT_BASE_URL=https://10.30.0.24:8484 \
PLAYWRIGHT_JSON_OUTPUT_FILE=.dev-runtime/session-multi-client-recovery-20261027/final-01/result.json \
pnpm exec playwright test tests/e2e/session-multi-client-recovery.spec.ts \
  --output=.dev-runtime/session-multi-client-recovery-20261027/final-01/browser \
  --reporter=line,json \
  > .dev-runtime/session-multi-client-recovery-20261027/final-01/run.log 2>&1
```

每批保留 Playwright 结果 JSON、文本日志、完整读取／提交记录 `network.json`；通过时额外保存 `receipt.json`、A 未读时与恢复后的截图、B 未知回执及新草稿截图。历史传输统计使用 UTF-8 字节数。最终批次记录产品源文件运行前后哈希，避免将开发期间 HMR 变化称为冻结源码验收。

## 批次记录

- `development-01`：失败在已不存在的 `.session-input-target` 旧选择器；改为实际 composer 目标、标签项目按钮及请求 cwd 的组合检查。不是产品故障。
- `development-02`：夹具只模拟了 `document.hidden`，未同步 `visibilityState`，导致历史恢复在假隐藏期间提前触发。已同步两属性；未放宽未读或轮询断言。不是产品故障。
- `development-03`：1 项通过，17.7 秒。属于开发批次，不能替代最终冻结结果；随后仅完善 UTF-8 字节统计、网络 item 计数及活动标签断言。
- `final-01`：源码冻结后 1 项通过，18.1 秒；运行期间没有并发编译或其他浏览器测试。2,618 个前端、shared 源码／产物及本用例／夹具文件的前后 SHA-256 全部相同，无新增、移除或变化。严格 TypeScript 检查通过，日志为输出根目录的 `types.log`。

最终摘要保存在 `.dev-runtime/session-multi-client-recovery-20261027/final-01/summary.json`：

| 检查 | 实测 |
| --- | --- |
| A 隐藏区间 | 4,922 ms，队列 GET 为 0 |
| 长历史 | HTTP 响应确实包含 1,200 个 item；全场 9 个历史响应合计 1,449,222 UTF-8 bytes |
| 阅读锚点 | `event-long-9-long-9-111`，相对偏移 14.125 → 14.125 CSS px，漂移 0 |
| A 最终 DOM | 目标 `ux-0`，2 个窗口组，A 原草稿完整 |
| B 最终 DOM | 目标 `ux-1`，1 个窗口组，B 未知回执之后的新草稿完整 |
| 未读 | A 重显后出现完成未读，查看该回复后清除，切回长历史保持阅读锚点 |
| 写入 | 仅 B 一次显式夹具提交，thread=`ux-1`、cwd=`/fixture/recovery/project-b`；没有额外 Agent 写请求 |
| 页面异常 | 0 |

`source-before.json` 与 `source-verification.json` 保留冻结校验；`browser/` 内三张最终截图均已实际查看。两个早期夹具失败和开发通过记录完整保留，不与最终批次相加为多个独立产品通过场景。
