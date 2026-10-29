# 会话缓存的热更新释放边界（2026-10-20）

本次排查来自用户“不操作会话页面也会增长到崩溃”的反馈。在 [子 Agent 周期性大包](session-subagent-memory.md) 之外，隔离开发服务还复现了一个条件性的旧正文留存问题。

## 复现条件与修复要求

`services/sessionCacheState.ts` 的模块级 `cachedTranscriptBaselines` 保存恢复用正文，`cachedTranscriptTimings` 保存相应时间。模块热替换后，当前版本的回收只作用于当前 Map；旧 ES 模块记录仍可持有旧 Map 及其中的正文。原实现没有 dispose 清理。

该文件只有 type imports，没有运行时依赖。因此不能将“修改任意前端文件”说成它必然热替换。复现要求缓存模块本身失效／重新导入，且当时仍有恢复基线；成功历史补读等正常路径可能已经清除基线。现场是否经历这一条件，尚未从用户原标签页取得记录。

修复只清理**被替换模块**的两个内存 Map。不得清空设备历史、草稿、审批、当前 store、工作区或停止 Agent；新模块继续按原逻辑读取缓存和恢复历史。`recentView.ts` 与 `lib/i18n.ts` 的模块级 store 订阅也须在热替换时取消，避免重复回调。不要将这两处小订阅推算成数 GB 泄漏。

dispose 到 React effect cleanup 之间还有异步窗口：旧 IndexedDB 读取返回时，原实例的 `stopped` 尚未置位。模块现在标记自身已失效，`restore` 在启动及每次读取返回后都核对；旧代直接退出，不重填旧 Map／显示 store，也不继续读取后续卡片。确定性红灯延迟读取回执，在尚未调用实例 stop 时释放回执，旧版仍写入、修复后不写；设备原记录和新代正常恢复均验证保留。

旧 Map 对象本身可能因 ES 模块记录继续存在，验收应检查旧正文条目和物理字符串占用，不能要求 WeakRef 一定消失。已经留存在旧标签页、且来自尚无 dispose 的历史版本的 Map，不能由新模块可靠反向找到；加载修复所需的一次正常页面刷新，与运行中周期性强制刷新掩盖增长不同。产品不得新增自动刷新、强制 GC 或终止任务机制。

## 隔离诊断证据

复制未改的原模块到独立 Vite fixture，每版本放入一段 4 MiB 正文，连续 5 次真实 HMR；每次采样前显式 GC，用于证明物理留存，不作为自然 GC 稳定性验收。该载荷直接放入 Map，绕过普通缓存预算，只验证模块生命周期，不代表真实单记录大小。

- 修复前六份 Map 均有正文，`backingStorageSize` 从 4,382,969 增至 25,368,284 bytes。`usedSize` 仅从约 1.29 增至 1.35 MB，仅看这个 JS 堆字段会遗漏外部字符串留存。
- fixture 中加入 dispose 后，旧五份 Map 条目为零、当前一份仍有正文；相同负载的 `backingStorageSize` 约 4.38→4.40 MB。不能把字符串外部存储等同于 renderer RSS。
- 原 `recentView.ts` 五次 HMR 使存活 store 订阅 1→6，每次选择触发多份旧回调。当前最近访问列表自身最多 32 个 ID，不能宣称这项足以解释数 GB 增长。

独立同负载实际源码对照：旧版 renderer RSS 93.699→118.898 MiB，增加 25.199 MiB；首次清理实现 92.762→98.246 MiB，增加 5.484 MiB，外部字符串增量仅 17,820 bytes。两组都记录固定的 renderer PID/start ticks，按顺序运行；这仍是短时物理留存诊断，不能把 RSS 差值外推为现场收益。证据在忽略目录 `.dev-runtime/hmr-retention-audit-20261020/cache-{baseline,current}-rss.json`。

最终实现另有三项真实 Vite HMR 自动回归，先红后绿：缓存旧代 disposed 为 true、旧 Map 正文／时间为空、新代仍保留内容；最近访问与语言切换在五次更新后各只有一个订阅，正常操作仍生效。最终缓存样本 `backingStorageSize` 4,402,152→4,421,487 bytes、renderer RSS 97,210,368→97,619,968 bytes，页面错误为空；完整指标及源码指纹在 `.dev-runtime/session-hmr-final-20261020/**/session-hmr-retention.json`。自有 fixture／浏览器均已关闭。

迟到回执、正文回收、内存治理、历史恢复和最近访问另五文件／38 项单测通过；最终源码 web TypeScript 检查通过。实际 HMR 测试始终使用隔离 HTTP fixture、绑定 `0.0.0.0`，按本机局域网地址发现端口，未改正式前端源来触发测试更新。

```sh
pnpm --filter web exec vitest run --config vitest.session.config.ts \
  src/session-mode/services/sessionTranscriptCache.hmr.test.ts \
  src/session-mode/services/sessionTranscriptRetention.test.ts \
  src/session-mode/services/sessionMemoryGovernor.test.ts \
  src/session-mode/components/codex/composer/recentView.test.ts
PLAYWRIGHT_SKIP_WEBSERVER=1 pnpm exec playwright test tests/e2e/session-hmr-retention.spec.mts
```

原无 HMR 的长期 RSS 红灯仍独立保留；本次生命周期修复不自动将其改判为通过。首次长测先于这组 HMR 修改启动，其页面禁用热更新；不得将其称为全部最终源码的冻结长测。后续 React 原生属性序列化的独立修复与最终冻结验收见 [性能记录内存](session-react-performance-memory.md)。


## 2026-10-29：store 留存是另一条独立路径

本页原先清理旧恢复 Map，不会清除旧 `useCodexStore` 实例中的 events。真实 Vite 三次依赖更新已复现每代保留2MiB旧正文；现通过 HMR data 立即复用唯一 store、重绑新版动作，避免旧命名空间继续持有不同正文。五次更新及真实 React 订阅回归通过，完整红绿数据、手动刷新旧标签页的原因与范围见[本轮记录](session-memory-feedback-loop.md)。本页既有缓存 dispose 与异步旧代 guard 仍须保留。
