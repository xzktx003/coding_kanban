# 子 Agent 空闲轮询的正文透传修复（2026-10-20）

用户再次反馈会话标签页内存持续增长直至崩溃，并确认“不操作也会涨到崩溃”。本次独立复现了一个不需要用户输入的大数据入口；它是已确认的缺陷，不代表已证明全部现场崩溃都来自同一原因。

## 根因与边界

`useSubagentFamilySync` 在会话模式可见时，每 15 秒查询关注会话的子 Agent，即使子任务面板没有打开也会查询。`CodexSubagents.discover` 为恢复活跃子任务的精确轮次，原来请求 `thread/turns/list` 的 `itemsView: full`。独立的 `/api/session/subagents/snapshot` 路由没有经过通用 `view=chat` 投影，直接将包含工具输出的轮次返回浏览器。

前端 `boundedSubagentThread` 会丢弃这些 items，但在它执行之前，浏览器已经接收、解码并解析完整 JSON。限制可见消息条数、隐藏工具行和回收聊天正文都不能阻止这条入口的周期性分配。`verify` 的旧运行层 `metadata → read` 回退也存在相同问题。

修复包含两个边界：

- 发现活跃轮次优先使用本地生成协议中已有的 `itemsView: notLoaded`，只有明确的不支持字段／枚举错误才回退到 `full`。连接故障、超时和身份错误不触发全量重读。显式停止操作保留原来的独立校验。
- `snapshot` 和 `verify` 在网关 JSON 序列化之前投影元数据；旧运行层即使忽略视图或通过 `thread/read` 返回完整历史，也不会向浏览器透传。保留精确 ID、目录、父子关系、昵称／角色、输入权限、状态、最近轮次与时间。移除工具 items、原始 spawn prompt 和未知大字段，显示描述按字段限长并断开大字符串引用。

这不是对任意响应的统一字节硬上限：精确身份路径不能截断，错误事实与状态标记仍保留。不得因减小响应而伪造权限、漏掉审批或改变停止范围。

## 回归入口

```sh
pnpm --filter server exec tsx --test \
  src/routes/session-subagents.test.ts src/services/codex-subagents.test.ts
pnpm --filter web exec vitest run --config vitest.session.config.ts features/subagents
PLAYWRIGHT_SKIP_WEBSERVER=1 pnpm exec playwright test \
  tests/e2e/session-subagent-network-memory.spec.mts \
  tests/e2e/session-subagents.spec.ts
```

新的网络回归启动独立 HTTP 假运行层和真实网关，通过浏览器原生 `fetch` 每 15 秒读一次，共五次，再验证旧运行层的身份读取回退。假运行层故意忽略视图并返回 4 MiB 工具正文，证明保护发生在浏览器接收之前。测试不发送真实任务、不加速时钟、不强制 GC、不刷新页面，保存传输字节、page target JS 堆以及带 PID/start ticks 的所有 renderer RSS。

正常 UI 的子 Agent、审批、消息投递、恢复、不可见正文回收及原生 SSE 投影仍需分别回归；单独的 HTTP probe 不替代完整页面或长期稳定性验收。原标准 30 分钟长测及既有阈值保持不变，历史红灯见 [内存防回归约定](session-memory-contract.md)。

## 验收证据

- 相同独立 HTTP fixture 的连续三个快照，修复前每次 4,194,641 bytes，修复后每次 199 bytes，后者不含 items。
- 新服务端红灯把 4 MiB 正文放入工具项、preview、spawn source 和未知字段，原响应 16,777,890 bytes，超过原定 16 KiB 测试预算；修复后通过。覆盖 snapshot 重复读取、verify 与 metadata 404 回退，以及轻量视图协商的成功／不支持／普通故障分支。
- 最终网络回归 60.579 秒、33 次自然采样：上游 25,168,574 bytes，浏览器共 2,627 bytes（snapshot 每次 397 bytes，verify 642 bytes）；heap 894,296→579,824 bytes，renderer RSS 77,115,392→90,927,104 bytes，峰值分别 986,664／91,189,248 bytes。全部样本为同一 renderer PID/start ticks，错误为空。此页为纯 fetch probe，不是完整会话页；内存数字不能与完整页面直接比较。完整 JSON 位于忽略目录 `.dev-runtime/session-child-memory-20261020-evidence/`，独立测试 HTTP `http://10.30.0.28:40429` 绑定 `0.0.0.0`，验收后已关闭自有服务。
- 正式服务只读检查两个现有关注根的快照，分别 6,002／4,524 bytes，均 complete、无错误、无工具 items；对两个根请求 `notLoaded` 均 HTTP 200、515 bytes、保留一轮元数据且 items 为零。只证明当前运行版本支持该视图和新路由已生效，不向 Agent 发送任务或停止运行层。
- 正式服务只读采样没有在五分钟内复现用户标签页的数 GB 崩溃；末段与构建、网关热更新重叠，仅作排查线索，不作为稳定源码的前后对照，也不记录用户正文。

相关检查：服务端子 Agent／聊天代理共 28 项单测、前端子 Agent／事件流／历史及回收共 18 文件／160 项单测通过；原生 SSE 投影、子任务身份／权限／审批、异步提问、投递与恢复共 38 项浏览器用例通过。后补 HMR 释放的最终源码另有缓存单测及真实热更新回归，见 [HMR 记录](session-hmr-memory.md)。

最终源码的自然回收、页面恢复及状态恢复九项中，八项首轮通过；一项仍匹配旧版合并提示文字而失败。已核对旧 HEAD 的 UI 也将标题与正文分开，测试改为校验 alert 中两段真实提示、至少五次健康探测失败和 HTTP 503，原消息单次投递／回复／草稿断言保持，针对性复验通过。首轮失败与复验分别保留在 `.dev-runtime/session-idle-regression-20261020/final-recovery.log` 和 `health-recovery.log`，不把旧测试定位失败算成新的内存回归。

长测单独记录于 [内存防回归约定](session-memory-contract.md)；不能用上述传输缩减直接推算 RSS 收益。
