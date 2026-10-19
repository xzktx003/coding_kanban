# 会话输入响应与多页持久化（2026-10-20）

## 已定位的问题

用户反馈运行时间长、浏览器页面或页内会话多时，输入卡顿并可能使页面失去响应。本轮发现并复现三条放大路径；它们不代表所有长期 renderer RSS 增长都已归因。

| 路径 | 修改前证据 | 修复 |
| --- | --- | --- |
| 逐键草稿保存 | 300 份各 5,000 字符的旧草稿时，真实 Lexical 按键产生最大 3,040,880 bytes 的同步 `Storage.setItem` 载荷；同值 `setText` 也会经 Zustand persist 完整保存 | 自定义 persist storage 按 owner 保存变化，不对完整 drafts 调用 JSON.stringify；相同状态不落盘 |
| 文件树／附件动作 | 实际递归 100 个文件节点，四次输入产生 2,000 次 node.name 读取；附件按钮三次输入产生九次无关派生计算 | 动作 selector，不订阅输入全文；两项修复后均为零，点击仍使用当前会话 |
| 空闲同步缓存 | tabs/projects 每轮 refresh 与 accept 即使返回原 state，persist 仍序列化和尝试写入；十秒每类十次同值 setItem | 无变化动作不进入持久化 set，真实变更另保留按当前浏览器存储字节去重；不能把不同页面的选择反复写回 |

## 草稿安全与边界

每次修改仍同步落盘，未增加保存延迟、后台保存队列或退出时才保存的依赖。旧 v1 集合只读保留，新 owner 分片覆盖旧记录；清空／移动用空文字或墓碑防止旧输入复活。移动先保存目的地，来源随后遮蔽；失败保留原数据和内存草稿，读取损坏拒绝写回。

审查曾复现部分保存失败的反例：A 页成功保存 x 后 y 失败，B 页更新 x，A 页重试 y 时若仍使用整份旧基线会回滚 B 的 x。现逐项记住成功写入，新增回归先红后绿。两个页面修改不同 owner 能保留彼此文本；同一 owner 的并发编辑仍为后写覆盖，未实现协作合并。旧迁移标记写入合并不等于跨页原子 exactly-once。多键保存没有事务保证：若移动目的地成功而来源墓碑失败，刷新可能暂时看到两份文本；保留文本优先于删除来源。

输入仍会遍历 owner 索引以发现变化，不宣称保存开销与草稿数量绝对无关。旧备份和用户未发送草稿不自动删除。未改动网关 `view=chat` 裁剪、SSE 序号、正文 60 秒释放、审批／回执、后台任务或原生 Agent 生命周期。

## 浏览器证据

隔离前端绑定 `0.0.0.0`，访问 **HTTPS `https://10.30.0.28:18488/?mode=session`，端口 18488**。所有 Agent API／WebSocket 使用现有 fixture；没有发送真实任务或停止 Agent。

`tests/e2e/session-input-responsiveness.spec.ts` 两项通过：

- 300 份各 5,000 字符旧草稿，29 次真实逐键输入，共写 2,302 bytes，最大单写 108 bytes；原 `<8 KiB` 单写、`<64 KiB` 总写门槛保持。刷新后输入及 300 份旧草稿完整。
- 同一 BrowserContext 三个页面在不同 owner 交错输入、追加并逐页刷新，三份独立原文均保留。

29 个按键到下一 RAF 样本为 p50 39.00 ms、p95 48.40 ms、最大 50.30 ms。最终复跑与长测并发运行于共享主机，此时间只代表该负载；旧版仅保留最大写量的失败输出，没有可追溯的旧总写量或旧按键延迟，不作时间倍率比较。UTF-16 payload 字节用于写量统计，不是物理内存。

冷加载／刷新最初遇到 fixture 激活早于已挂载模块就绪，后改为等待编辑器与实际模块 URL 并点击真实标签；冷加载等待 30 秒，逐键 20 ms 间隔和写量断言未放宽。最终复跑 2 项通过、1 项默认跳过（十分钟用例已另行通过）；存储指标文件在忽略的 `.dev-runtime/session-input-20261020/final-input/`，早期复现与首批绿灯在 `.dev-runtime/session-input-responsiveness-verified/`，全量检查、回归和长测记录在 `.dev-runtime/session-input-20261020/`。

另对真实 journal 模块做隔离原生 localStorage 枚举审计：3000 个无关短 key 时，四种扫描的中位数约 1.4–1.6 ms、p95 1.5–1.6 ms（每项 5 次预热、20 次测量）。这不支持将扫描认定为本次严重卡死的主因，未增加缓存或改写 journal；不代表大型真实记录、整轮轮询或端到端延迟。证据在 `.dev-runtime/session-input-20261020/journal-audit/`。

## 三页面持续输入与自然回收

显式 `SESSION_INPUT_SOAK_MINUTES=10` 的 `aged three-page` 用例通过：负载 600.004 秒（含最后刷新恢复 612.2 秒），三页同时运行实际 HTTP/EventSource，286 轮、每页 2,860 条原生通知，发出 SSE data 帧 4,412,211 bytes。每分钟轮流激活页面并真实逐键追加；每页 30 次写、共 2,412 bytes、最大 110 bytes，三份草稿最终刷新均完整，页面错误为空。

90 个按键到下一 RAF 样本合计 p50 34.9 ms、p95 61.3 ms、最大 99.6 ms；这是新代码共享主机负载下的观测，没有同批旧代码时间对照，不能推断精确加速倍数。58 次自然回收采样中的三个 renderer PID/start ticks 始终一致。三个进程合计 RSS 峰值 1,679.82 MiB，90–300 秒窗口低点到末 180 秒低点为 1,125.22→1,198.64 MiB（+73.41 MiB）；三页 heap 对应低点为 64.13→62.83、59.68→60.09、58.97→61.64 MiB。未强制 GC，老化期间没有刷新；最终刷新仅检验保存恢复，未用于降低上述测量值。RSS 合计不是单个标签页 private/PSS，未增加任意通过阈值，十分钟不代替标准三十分钟或证明长期内存已根治。

证据为 `.dev-runtime/session-input-soak-10min/session-input-responsivene-86c6f-ndent-input-with-natural-GC/three-page-input-soak.json`；测试默认跳过，复现时在下述前端环境加 `SESSION_INPUT_SOAK_MINUTES=10`，运行该 spec 的 `--grep 'aged three-page'`。

## 最终源码检查

`pnpm check`（shared、会话运行层、后端、前端类型及生产构建）通过；前端会话单测 **516 文件、2,685 项全部通过**。新草稿保存故障与跨页用例、两项动作订阅隔离、空闲同步存储断言均纳入该批；旧文件树键盘测试的 mock 改为支持 selector，原交互断言保留。`git diff --check` 通过。新增文件与其余变更文件的 Prettier 检查通过；`useAgentCenterStore.ts` 全文件检查仅报告 HEAD 已有、此次未修改的 `reorderCard` 格式差异，已与 HEAD 格式化差异逐项核对，未扩散修改。

最终源码浏览器回归 **26 项通过、1 项默认跳过**；跳过项为另行显式运行的 30 分钟长测。覆盖草稿保存与迟到回执、同浏览器共享标签／项目、SSE 裁剪和大字符串释放、可见历史预算、自动回收／休眠后恢复及消息发送。实际工具生命周期的自然回收 24 个堆样本约 35.1–80.8 MB；正文事件突发的短测堆增量为 199,936 bytes。短测不覆盖长期 RSS 门槛。

真实 HTTP → 网关 → 原生 EventSource 两项通过：上游 100,669,814 bytes，浏览器收到 6,178 个数据字符、最大事件 317 字符；连续序号、审批、最终回复以及超大帧命名错误保持。该隔离传输用例沿用原有显式 GC 断言，GC 后堆增量 35,964 bytes，仅检验传输留存，不是挂载应用的自然回收或 renderer RSS 证据。记录在 `final-network/`。

## 长测加载边界

本轮三十分钟测试使用未改动的 `session-idle-memory.spec.ts`、原工作负载和原阈值。最终共享同步修复后，`apps/web/src` 与 `packages/shared/src` 下 1,837 个生产 TS/TSX/CSS 文件（排除 `.test.`）的有序路径＋内容 SHA-256 为 `4a9875147c96bf82b43c87129efe86af6b05be6e447261670ecb34c762c3dcdf`，记录在 `final-frozen-source.json`。新增输入 spec 和文档不在该生产源码指纹内。之前首轮在约六分钟时因补齐不同页面空闲互写修复而取消，明确标为 `superseded-soak.json`，不计为通过或完整长测。

最终标准长测 **仍为红灯**：1801.968 秒、862 轮／862 份采样，heap 低点 54.4669→60.1082 MiB（+5.6413 MiB），RSS 低点 320.8086→502.0703 MiB（+181.2617 MiB，超过原 128 MiB 限制）。heap／RSS 峰值为 212.2511／673.2422 MiB。全部采样为同一 renderer PID/start ticks（784580/147406985），无缺测、无页面错误，React measure 留存为零，DOM／监听器窗口低点仅增加 7／15。堆通过不代表原生分配已经释放；没有证据将全部 RSS 增长归因于正文缓存或本轮输入路径。

失败发生在 RSS 低点断言，之后 RSS 峰值断言和音频最终空闲归零未执行；采样只证明连续负载中创建并复用一个上下文，不能计为结束后关闭通过。未强制 GC、刷新、停止 Agent 或放宽阈值。原有长期 RSS 问题仍待定位，本轮只闭合已复现的逐键序列化、动作订阅和空闲写入路径；输入回归绿灯不覆盖这个红灯。生产源码指纹复核相同；完整 JSON 在 `final-soak/session-idle-memory-long-r-12e42--natural-garbage-collection/natural-gc-soak.json`，摘要为 `final-soak-summary.json`，日志为 `final-soak.log`。

## 回归入口

```sh
pnpm check
pnpm --filter web test:session
PLAYWRIGHT_SKIP_WEBSERVER=1 PLAYWRIGHT_FRONTEND_PROTOCOL=https \
  PLAYWRIGHT_BASE_URL=https://10.30.0.28:18488 \
  pnpm exec playwright test tests/e2e/session-input-responsiveness.spec.ts \
    tests/e2e/session-drafts.spec.ts tests/e2e/session-tabs-same-browser.spec.ts \
    tests/e2e/session-projects-same-browser.spec.ts
```

涉及 store 的变更还运行既有 stream-memory、transcript-memory、memory-governor、idle-memory 和消息回执浏览器回归。长测使用真实时钟、自然回收、原采样器和原门槛，同时记录 JS 堆、逐 renderer PID/start ticks/RSS、DOM／监听器及音频上下文；不能只用短时按键测试推断长期内存已根治。
