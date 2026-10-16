# 浏览器 renderer RSS 采样身份与缺测（2026-10-16）

本批只修验收采样器，产品源码没有变化。旧采样把缺失 VmRSS 字段按零处理，空 renderer 集合也得到零；长测还会吞掉 Linux procfs 读取异常，后续过滤 undefined 时可能缺失 RSS 门禁。旧 JSON 没有逐进程身份，不能事后证明各时点来自同一组 renderer。

## 修改与红绿灯

新增 `scripts/session-renderer-memory.mjs`，由既有 `session-idle-memory.spec.ts` 的自然回收短测和标准长测共同调用。CDP 给出的 renderer PID 先验证为不重复的正安全整数，然后读取 `/proc/<pid>/stat` 的 start ticks、核对 status 的 PID 和严格 kB VmRSS，再次读取 start ticks。缺测、零值、错误单位、进程消失或读取期间 PID 身份变化均明确失败；不会补零或跳过。每条样本保存各 renderer 的 PID、start ticks 和 RSS，以及合计值。聚合单位保持 bytes，不是 PSS、private bytes 或单 page 内存。

`session-renderer-memory.test.mjs` 使用有界合成 proc 数据验证十项契约。抽取旧算法后 9 项失败、1 项通过，保留 `renderer-memory-red.log` 和原算法提取文件；新实现十项通过，`renderer-memory-final-green.log`，零跳过。CDP 中非 renderer 条目不读取、含括号的 comm、身份错配／复用、异常 PID、字段缺失／格式错误／读取失败均有覆盖。根目录现有 `node --test scripts/*.test.mjs` 已自动包含新文件。

Linux 必须完成 RSS 采样；其他平台仍没有 procfs RSS 证明，需要另行采样。原自然 GC、工作负载、2000ms 采样间隔、30 分钟默认跳过规则、heap 64/256 MiB、RSS 128/768 MiB 及音频空闲断言保持，没有刷新、强制 GC 或修改产品。

## 验收边界

本次采样器修正只影响之后的样本。旧 862 条正值样本仍不足以排除部分缺测，但没有证据认定其错误；既有 RSS 低点增长 178.7305 MiB 的标准长测红灯保持。新增进程身份也不能把所有 renderer 的合计 RSS 直接解释成当前页面净留存。

每个 PID 的 guard 窗口仅为第一次 stat→status→第二次 stat；CDP 枚举至第一次 stat、各 PID 之间的读取均不是原子快照。若枚举后、首读前已发生 PID 复用，仍可能读取到另一个稳定身份；该边界由纯注入反例留证，不能推断旧长测曾触发。结果只用于测量和记录，不证明进程所有权，不得据此清理或终止进程。独立只读审查保存于 `rss-audit/renderer-meter-review/`，五项合成检查及旧快照五段逐字节比较通过；没有另开浏览器或重跑正式单测。

产品前端为独立绑定 `0.0.0.0` 的 **HTTP `http://10.30.0.24:48865/`**；全部业务读写与 WebSocket 由隔离 fixture 接收，不向正式 Agent 发送测试任务。源码与测试清单分别记录，旧批次哈希证明不覆盖本次已修改的 E2E。

浏览器接入 `round8-idle-browser.log` 为 1 项通过、1 项默认长测跳过、零失败，1.7 分钟。自然回收／只读恢复 97.055 秒，三次均为同一 renderer PID 750549／start ticks 102161383；heap 为 167,894,672→60,502,716→140,601,956 bytes，RSS 为 492,785,664→293,203,968→636,334,080 bytes。每条逐进程值与合计相等，页面及采样错误均为空。草稿、审批、最终回复、未读和音频自然空闲检查通过；不把该短测解释为长期稳定。

`round8-source-manifest.json` 和 `round8-source-acceptance-verification.json` 核对 2834 份产品源码、14 份 E2E、2 份采样脚本和 72 份 shared 产物在本批浏览器前后不变。相对 round7 只有 E2E 采样接入和两个新脚本改变；没有产品代码变化，不重复生产构建。全部原始证据保存于被忽略的 `.dev-runtime/session-polish-round2-20261016/`。


## 独立标准长测追加

之后原标准 30 分钟长测单批通过，862 样本全部为同一 renderer 身份、无缺测，原最终音频空闲断言通过。RSS 低点增长 26.2578 MiB，heap 增长 4.4072 MiB；未放宽门槛。前窗口 RSS 低点高于旧失败批次，不能把差值下降归因于本采样器或某个产品修复；旧红灯保留。完整时长、峰值、哈希和证据见 [内存约定追加](../../session-memory-contract.md#当前源码的一次标准长测通过2026-10-16)。
