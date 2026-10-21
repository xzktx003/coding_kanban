# React 开发性能记录的原生分配（2026-10-20）

用户再次报告会话页面即使不操作也会增长到崩溃。子 Agent 大包与 HMR 旧缓存已有独立修复，但标准三十分钟测试仍出现 JS 堆低点只增长约 5.2 MiB、renderer RSS 低点增长约 144.9 MiB 的红灯，见 [内存约定](session-memory-contract.md)。因此继续检查浏览器原生分配，不能只根据 JS 堆或已清空的性能记录判断稳定。

## 可复现路径

当前安装的 `react-dom@19.2.4/cjs/react-dom-client.development.js` 中，`logComponentRender` 将发生变化的组件属性转换为 `detail.devtools.properties`。`addValueToProperties` 对字符串执行 `JSON.stringify`，并没有按聊天正文预算截断字符串。聊天组件反复更新可把正文放进这些诊断数据。

原 `lib/react-performance-retention.ts` 能立即清除 React 时间线条目，却在清除之前仍调用原生 `performance.measure`，浏览器已序列化这些属性。删除时间线记录不等于立即回收此次原生分配：在隔离 Chromium 中，JS `usedSize` 与 `backingStorageSize` 不能完整反映这部分 RSS。

同版本 Chromium、相同 guard、独立顺序浏览器，各运行 3,000 次 × 64 KiB 属性的计时，途中自然回收：

| 诊断 | 原 guard | 仅去掉 React properties |
| --- | --- | --- |
| renderer RSS 起点→末点 | 84.715→294.738 MiB | 84.871→94.598 MiB |
| RSS 增量 | 210.023 MiB | 9.727 MiB |
| JS used heap 起点→末点 | 1.724→2.643 MiB | 1.724→2.535 MiB |
| 留存 React measure | 0 | 0 |
| 最后单独强制 GC 后 RSS | 94.711 MiB | 93.695 MiB |

两组同名应用计时及其属性都完整保留，页面错误为空，单组 renderer 身份不变。末尾 GC 仅用于归因，不属于自然样本，更不会写进产品。结果表明这是一条**可能延迟回收的原生分配路径**，不能称为永远不可回收的对象。本实验只有原生 API 调用，没有真实 React 渲染；不能用该数字代替用户现场收益或完整页面长期验收。原始指标及脚本位于忽略目录 `.dev-runtime/react-measure-properties-20261020/`。

## 上游参考与适用范围

React 上游 [频繁更新下开发版原生内存暴涨报告](https://github.com/facebook/react/issues/34770) 记录了 JS 堆小、进程内存大的类似现象；[清除较大性能记录的修复](https://github.com/facebook/react/pull/34803) 明确处理属性副本的时间线留存。另一个 [改用 console.timeStamp 的改动](https://github.com/facebook/react/pull/32736) 说明减少性能条目与附加对象的分配成本。这些是本次源码检查的参考，不能证明本仓库全部增长来自同一路径。

本仓库已经有 React 条目即时清理，当前新增的是**序列化前剥离属性**，其收益由自己的原生 API 红绿对照确认。上游报告不是直接升级依赖或清空所有应用计时的依据；完整页面标准长测仍失败的事实在下文单列。

## 修复边界

只在开发模式、只对明确标识为 `Components ⚛` 或 `Scheduler ⚛` 的记录，在调用原生 API **之前**将 `devtools.properties` 设为 null。保留计时、名称、轨道、颜色、tooltip 和其它元数据，仍使用原保留名与立即清除策略；PerformanceObserver 继续接收计时。通过新对象传递参数，不修改 React 复用的原始对象。

这不修改 React 依赖本身：React 在调用前构造属性字符串的 JS 开销仍存在；修复阻止其继续进入原生序列化，不能据此承诺没有任何渲染分配或 CPU 开销。

普通应用的 measure／mark、同名应用计时和生产性能 API 保持原行为。代价是开发性能轨道中不再附带组件属性详情；正常聊天正文、审批、历史及任务执行不受此诊断裁剪影响。不得恢复“先序列化完整 props 再清空”，也不得清空全部应用计时、关闭 Agent、自动刷新或强制 GC 来掩盖增长。

运行 `apps/web/src/lib/react-performance-retention.test.ts` 和 `tests/e2e/session-react-performance-memory.spec.mts` 验证原生调用边界与 Chromium 分配；长期效果仍以未更改负载和阈值的 `session-idle-memory.spec.ts` 三十分钟自然 GC 验收为准。

## 自动回归

原实现的新单测有两项失败：调用原生 measure 时属性仍在，observer 也仍收到属性；修改后四项通过，覆盖冻结输入对象、两类 React 标识、普通应用／同名计时／mark、生产不介入与 observer 元数据。新增 Chromium 回归运行实际 guard 源码，自然采样 RSS 峰值增量旧版 210.4609 MiB，最终实现 10.8281 MiB，通过原定 64 MiB 的专项门槛；JS heap／backing storage 和普通应用记录同时核对。该专项只证明这条分配路径，不把小 fixture 的 64 MiB 门槛用于完整页面。

旧／新指标位于 `.dev-runtime/react-measure-properties-20261020/regression-{red,green,final}/`。旧源码 sha256 `12f2914f91311619b581d7d51048dbd1b5f531ca25c5c43618d2f857aedea1c1`，当前源码 `1d7dbc1e9d44acca08f7ad13044447a08a5feb4ce5635584070e46d253f41df4`。

最终源码补足非对象 options 的提前转发／类型缩窄后，四项单测、web TypeScript、三文件格式检查和 13 秒原生浏览器回归通过。完整页面长测必须使用该最终指纹，不能沿用中间实现的构建记录。

复验命令（仓库根目录）：

```sh
pnpm --filter web exec tsx --test src/lib/react-performance-retention.test.ts
PLAYWRIGHT_SKIP_WEBSERVER=1 pnpm exec playwright test \
  tests/e2e/session-react-performance-memory.spec.mts
SESSION_MEMORY_SOAK_MINUTES=30 PLAYWRIGHT_SKIP_WEBSERVER=1 \
  pnpm exec playwright test tests/e2e/session-idle-memory.spec.ts \
  --grep 'long-running native'
```

专项创建绑定 `0.0.0.0` 的独立 HTTP 服务，动态选择本机局域网地址和端口，退出清理。完整页面使用当前部署的局域网 HTTPS 地址 `https://10.30.0.28:8484`，通过 `PLAYWRIGHT_BASE_URL` 与 `PLAYWRIGHT_FRONTEND_PROTOCOL=https` 指定；全部会话 API 由 fixture 隔离，SSE 使用真实原生 EventSource。不同机器按实际配置设置地址，不将其硬编码到产品。

## 最终 guard 的标准长测：仍失败

最终 guard 完成并通过 `pnpm check` 后，冻结 2,930 份产品源码／shared 产物／测试夹具，执行原标准 HTTPS 页面＋原生 SSE 30 分钟，前后指纹无变化。1802.013 秒、863 轮，heap 低点 53.9794→59.4300 MiB（+5.4506），backing storage 低点 +0.1733 MiB；renderer RSS 低点 327.9961→481.0664 MiB（+153.0703＞128），峰值 627.7461 MiB。无页面和采样错误，同一 PID 3268711／start ticks 150981861。

该结果仍为红灯，不能用前述原生 API 专项绿灯替代，也不能把每分钟打印样本当作完整低点统计。失败在 RSS 低点断言，后续 RSS 峰值及最终音频空闲归零断言未执行；循环内仅观察一个音频上下文。原负载／阈值保持，没有强制 GC、刷新、源码热更新或停止正式 Agent。源码裁剪修复有独立因果证据，但未改善这一完整页面长期 RSS 指标；剩余来源继续归因，不宣称全部现场问题闭合。

完整指标位于 `.dev-runtime/session-idle-regression-20261020/guard-soak/`，摘要 `guard-soak-summary.json`，日志 `guard-soak.log`，冻结校验 `guard-soak-source-{before,after,verification}.json`。

## 开发版／生产版的顺序对照

同一冻结源码和构建、相同 HTTP 服务和原生 SSE 工作负载，分别用新浏览器运行十分钟；通过界面预热三份历史，不导入开发模块，不强制 GC。以 90–180 秒与最后 120 秒的最低值比较：

| 指标增量 | 开发版 | 生产版 |
| --- | --- | --- |
| renderer RSS | +81.164 MiB | +49.465 MiB |
| renderer PSS | +81.165 MiB | +49.225 MiB |
| JS used heap | +0.093 MiB | +3.669 MiB |
| backing storage | −0.269 MiB | −0.222 MiB |
| SSE 总传输量 | 58,403,017 B | 59,619,985 B |

两组均无页面错误、无执行型请求，React／普通 measure 留存均为零；源码和构建指纹前后相同。生产版基础占用较低，但仍有 RSS 增长，不能仅归因于开发版 React，也不能把切换生产构建当作根治方案。该对照保留 Playwright API 拦截，和标准长测的时长、预热方式及 WebAudio 观察不同；它用于区分构建因素，不替代标准三十分钟验收。

原始样本、逐分钟最低值、网络请求次数与冻结指纹位于 `.dev-runtime/session-dev-prod-memory-20261020/`，汇总为 `comparison-summary.json`。后续需继续区分页面留存与浏览器／测试工具的原生分配。

## Network 缓存限额对照：未证明有效

按 Playwright 当前实现定位其自身的主页面 CDP session，在导航前成功设置 `Network.enable` 的总预算 4 MiB／单资源 1 MiB；没有仅向新建的另一个 CDP session 设置限额。工作负载、冻结源码及十分钟窗口沿用开发版对照。601 秒、289 轮、58,605,845 B SSE、单连接，无页面错误或执行型调用。

受限组前／后窗口 RSS 低点为 481.62／489.07 MiB，增量 +7.45 MiB，但前窗口比默认组高约 138 MiB、末窗口也高约 64 MiB。最后自然 RSS 为 504.27 MiB，默认组为 437.28 MiB；第六至十分钟 RSS 低点净增 25.87 MiB。因此不能把较小的窗口差值当作缓存限额有效，亦不能据此放宽原长测门槛。

自然样本完整保存后，另行执行一次显式 GC：RSS 504.27→301.64 MiB，PSS 同降约 202.63 MiB；V8 used 76.79→54.93、total 151.00→59.82、embedder 31.01→7.54、backing storage 32.03→26.87 MiB。这证明大量分配／容量可以回收，不能将全部差值归为永久引用泄漏；它不证明自然回收及时，也不是产品内的自动 GC 方案。指标位于 `.dev-runtime/session-network-limited-20261020/comparison-summary.json`，显式 GC 数据与自然窗口分开保存。
