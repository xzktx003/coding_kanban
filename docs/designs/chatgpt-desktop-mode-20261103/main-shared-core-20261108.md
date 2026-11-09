# 主 8484 免密码共享 Codex 核心链路

2026-11-08 已在 HTTPS 局域网主地址上线并完成实际验收：

[打开第四 ChatGPT 模式](https://10.30.0.26:8484/?mode=chatgpt&view=agent)。前端保持 `0.0.0.0:8484`，不要求额外口令或登录 Cookie。

操作：选择或创建项目，点击 `Work in`，选 `Codex CLI（共享）`，使用 `GPT-6.1 Sol`，从项目新建聊天并发送；收到回复后，在同一输入框继续追问。项目已有记录时可从侧栏新建聊天，不必重复添加项目。

实际主地址线程为 `01a1ba6e-de56-7f91-8530-a30a4ae3d593`。两个原生轮次分别为 `01a1ba6f-7719-7782-adab-6c2ac9632831`、`01a1ba70-7101-7de2-9592-2840f6996832`，均使用真实 `gpt-6.1-sol` 并完成。首条要求精确回复随机 marker；第二条未提供 marker，要求根据首条上下文回答，两次回复都准确。没有工具调用、重发或模拟回复。

原版 GUI 同时核对两个回复正文、唯一目标、公共 composer 清稿和 Stop／Queue 结束，消息观察无断口。全新浏览器上下文经可信 HTTPS 进入，实际 Cookie 数与可见密码输入框均为零。主地址只读状态返回当前 profile，旧 profile 静态资源仍返回 HTTP 200。

新宿主为冻结 v56，manifest SHA-256 `34221fe04747d48b2328d8820828a4a75f34d57a622904e73fc4618dc8eb64f1`；profile `b7302eed-c60d-4118-a5a9-2b06384b498c`，generation `ff2e85f8-ee56-4b31-9fd9-b580c6987700`。同一冻结宿主在独立预览也先完成真实两轮，线程 `01a1ba66-a53f-7481-a303-fb93fb5e6c45`。原包保持固定受检摘要；本轮关键修复包括原生已读 CAS、排队消息的 exact prepared.start 能力绑定，以及等待原 ROP RpcPromise 后再绑定。

旧网关、旧 native、默认共享 daemon、项目和历史保持运行或保留，受保护 PID/start ticks 在切换前后相同。服务端私有 `CHATGPT_DESKTOP_CANDIDATE_LEGACY_ROUTES` 为精确旧 profile/generation 保留优先 HTTP/WSS 路由；旧宿主失联不会回退新宿主。Vite 配置重载会关闭物理 socket，文档连续性阻止自动整页刷新；本次不声称物理 WebSocket 无损迁移。

私有完整证据位于 `.cg-primary-upgrade-qi4l4rp5/main-v56-final-delivery.json`、`.cg-main-gui-driver-_80takbw/main-v56-passwordless-2m6my94x/`：包含原生两轮回执、GUI 快照、零 Cookie／密码框及旧资源路由观察，不将凭证写入仓库。

本轮通过范围为当前运行版的新线程文字收发和同线程续聊。文件工具、已有线程接管、刷新／重启恢复、SSH、云及新共享来源的分屏组合另行验收，不扩大为完整桌面版或长期稳定性结论。
