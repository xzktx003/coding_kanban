# 搜索高亮的正文观察生命周期（2026-10-16）

本批只修改 `CodexThread.tsx` 的搜索高亮 effect：没有选中带 query 的搜索结果、搜索面板关闭或会话模式／聊天页面不可见时，不注册全文 MutationObserver。原有 disconnect、RAF 取消和自有 Range 清理保持；再次显示会话时按原 navigation 恢复高亮。没有修改消息投影、历史／SSE、正文回收、草稿、审批或执行请求。

## 真实反例与修复

旧代码只检查 root 是否存在，始终监听 subtree／childList／characterData；每批正文变化都排 RAF，调用空高亮更新。它有完整 cleanup，不能描述成不断泄漏观察器或无搜索时不断创建 Range。

永久测试 `tests/e2e/session-search-highlight-lifecycle.spec.ts` 在真实产品中操作 Ctrl+F、选择搜索结果、模式切换和关闭搜索。MutationObserver 子类完整转发浏览器原生构造／交付／observe／disconnect；测量 registry 仅保存数字身份、计数和 thread ID，不保存 DOM、MutationRecord、回调或正文。一次受控 DOM 变化用于触发实际监听，不冒充原生 SSE 压力或长期内存实验。

| 实测状态，1280／390px 两例均相同 | 修改前 | 修改后 |
| --- | --- | --- |
| 未搜索／打开搜索但未选结果 | 1 个全文观察器 | 0 |
| 未搜索时受控正文变化 | 回调增加 4，高亮为空 | 回调不增加 |
| 正常搜索及正文变化 | 1 个观察器，回调增加 4，准确高亮 | 保持 |
| 切到终端模式 | 原观察器仍在 | 0 |
| 返回会话模式 | 原高亮可恢复 | 重新注册 1 个，准确恢复原高亮 |
| 关闭搜索后的正文变化 | 1 个观察器，回调增加 4 | 0，回调不增加 |

`search-highlight-red.log` 两例均先失败，原 JSON 保留；`search-highlight-green.log` 两例通过，12.9 秒。两个批次正常搜索、原草稿、errors[] 和执行 calls[] 控制均通过。390px 是窄屏 Chromium，不计实体手机；这里的不可见条件为现有 `useAgentInteractionVisible`，不声称新增了每个离屏 pane 的独立可见性探测。

## 本批检查

- `round7-web-build.log`：前端 TypeScript／生产构建退出 0，Vite 46.36 秒，原大 chunk 提示保留。
- `round7-search-units.log`：7 文件／26 项通过，9.10 秒，覆盖匹配 Range、历史定位、快捷键、搜索工具栏／请求和用户正文展开。
- `round7-search-browser.log`：单批 8 文件／41 项通过、1 项默认跳过、零失败，6.6 分钟；包含实际搜索／消息操作、Goal 三文件、只读恢复、异步提问及自然正文回收。跳过项仅为独立 30 分钟 soak，不能计为已通过。

本批相对 round6 仅改变该 effect，`round7-thread-review.patch` 的旧侧全文已复算到 round6 的精确 SHA。`round7-source-manifest.json` 记录 2834 份源文件与 11 份 E2E；加入未修改的恢复／提问／回收测试后的 `round7-browser-source-manifest.json` 记录 14 份 E2E。`round7-source-acceptance-verification.json` 重新枚举源码集合，确认 2834 源码、14 份 E2E 与 72 个 shared 产物前后不变。scoped Prettier、diff 空白与本地文档链接检查通过。

浏览器使用绑定 `0.0.0.0` 的 **HTTP `http://10.30.0.24:48865/`**，普通 API／WebSocket 为隔离 fixture，不向正式 Agent 发送测试指令。最终两份生命周期 JSON 的空闲／关闭观察数均为零，活跃与恢复为一，errors／executing 为空；汇总为 `round7-browser-evidence-summary.json`。

自然回收与只读重显为 96.809 秒，heap 166,772,124→59,697,964→140,724,576 bytes，浏览器全部 renderer RSS 合计 487,137,280→293,785,600→646,668,288 bytes；没有强制 GC 或刷新，草稿、审批、完成和音频空闲检查保留，errors[]。它验证回收／恢复边界，不作为稳定 RSS 或本修改收益的证据。消息 pending V8 的六种正文卸载后留存为零，亦仅是既有短时释放门禁。

## RSS 仍未归因

只读重算确认旧标准长测 +178.7305 MiB 的单位、窗口和差值正确，原 128 MiB 门槛仍为红。RSS 为浏览器所有 renderer 的合计，heap 仅为 page target；缺少逐 PID/start ticks／数量，缺失 VmRSS 字段被按零处理，因此不能事后证明同进程净留存。实际 862 条均为正数，亦没有证据支持把原红灯判作采集错误。

两个原窗口的 RSS median 为 540.48→523.64 MiB，标准失败来自低尾抬升，而非整个分布一致上移；该描述不是新门槛，也不构成通过。审查证据在 `.dev-runtime/session-polish-round2-20261016/rss-audit/readonly-next-candidate/`。

本批只证明消除了实际无效观察／刷新，未测量长期 RSS 收益，不能将它称为原生分配或 RSS 根因。原 30 分钟红灯、四臂诊断资源中止及最终音频空闲未执行的边界继续保留，见 [内存约定](../../session-memory-contract.md#goal-对齐后的冻结长测2026-10-16)。
