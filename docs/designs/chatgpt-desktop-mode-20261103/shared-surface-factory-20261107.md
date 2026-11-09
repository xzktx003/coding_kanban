# 共享页面的候选构造选项（2026-11-07）

两个服务端 `createChatGptDesktopCandidate` 工厂现在支持固定的 `sharedThread?: boolean`，与 `splitPane` 联动选择文档及同版资产。两项默认均为 `false`，显式非布尔值拒绝；HTTP query、header 和 body 均不能覆盖。现有 CLI 不增加共享开关，受控启动脚本须在构造时显式传入。

| sharedThread | splitPane | 文档版本 |
| --- | --- | --- |
| false | false | 2 |
| true | false | 3 |
| false | true | 4 |
| true | true | 5 |

共享单会话沿用九个适配成员，共享分屏沿用八个成员；原资源摘要、路由白名单、host exports 及预算保持原规则。专项回归已验证两个入口、HTTP 隔离、指定 Mac 原包各成员的实际路由响应与 ETag，以及共享目录 sidecar 的依赖闭包；candidate 和前端类型检查通过。

此选项只选择浏览器文档及资源，不创建 native、不授予共享线程权限，也不代替真实 SDK、host 注册或账号就绪验证。收到 v3/v5 文档不能算共享会话已经可用；真实共享收发由后续独立候选验收。

私有补丁和日志：[交付记录](/data01/home/xing.hu/.cg-shared-surface-k9yju7sw/patch-handoff.json)。本轮未操作存活 source、8484 或 Vite。
