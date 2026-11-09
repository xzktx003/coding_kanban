# v4 原 footer 生命周期

本轮只修复自有 v4 布局的已复现实例重挂，不据离线结果宣称真实冷开队列问题已解决。修改先在新私有副本验收，再将相同源码和用例合入项目；既有线上入口、native 与冻结候选均未改变。

固定原包 `bb88615052255e79b5977885f9a0cc212c268589587c79d4d3b7c4b46e881a95` 中，原 `local-conversation-thread-2f594f841b07.js` 的导出 `i=GI` 将 `renderLayout` 传给原 `app-primary-75d53eef2374.js` 的导出 `jR=Bin`。`Bin` 直接调用 `v({content:e(),footer:...})`；回调函数身份变化不是 React 组件类型变化，不能据此推断重挂。前者 SHA-256 为 `af8e8ab2e97566d25d69249ef8adf5a86d0bf0bbf4c306e4fbc50c80e8837263`，后者为 `ebaecd54561e7e3da76c08b0d900e056424d57b1b23675afad4d7d235599f80b`。REA 对精确原函数片段的静态 Evidence 为 `ev_0a27eead9a9986ea2ea6f222d213743cadacd83fbebe0bd5e271d84c9c6bce0c`；未执行原 SDK，周边未分析导入保持未知。

真正复现的路径在自有 `ActiveSplitPaneBoundary`：同一 `hostId/conversationId/clientThreadId` 的普通字段变化更新完整捕获签名，旧条件据签名不相等令 `scopeReady=false`；`SelectedGI/custom` 因而暂时返回空 footer，随后捕获确认又插回原 footer。真实 React/JSDOM 夹具在 composer 的 `useLayoutEffect([])` 第二次挂载时报 `2 !== 1`。这是布局实例重挂证据，夹具没有执行实际原版 composer 或其 RPC 消费者，尚未确认真实冷开是否发生相同字段变化。

修复后，当前原生目标已确认且本次捕获、路径仍有效时，更新背景快照字节不删除原 footer。目标 identity 改变、路径不符、无法验证的捕获和失去实际 owner 仍走原关闭门控。`registry.remember`、`captureRevision`、`clearTarget`、`commit` 完全保留，普通字段刷新也会使旧输入租约失效并生成当前确认；没有沿用旧授权、清稿、取消任务或重试未知回执。原生账号、发送与附件 generation 的边界不改变。

新增用例同时断言 composer 仅挂载一次、DOM 节点及未提交文字不变、旧 footer lease 已撤销且新 lease 对实际目标有效。运行 `node --test packages/chatgpt-desktop-host/test/desktop-split-pane-react.test.mjs packages/chatgpt-desktop-host/test/desktop-layout-core.test.mjs packages/chatgpt-desktop-host/test/desktop-selected-pane.test.mjs`：35/35，零跳过。原件资源适配与输出 pin 没有变化，只有自有 sidecar 内容摘要变化。

主 Agent 随后用完整冻结组合在 HTTPS 8520 实际冷开，仍触发 `BRIDGE_QUEUE_FULL / waiting_count`，本次没有发送模型消息或图片。因此本修复保留为独立生命周期修复，不能当作启动队列问题的解决证据；[首因记录](cold-reopen-20261106.md)已保存。
