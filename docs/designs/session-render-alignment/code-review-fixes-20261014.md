# 2026-10-14 当前代码审查与修复

用户最新授权为“review 当前代码，找到并修复所有你发现的功能和画面和 UI bug 并修复测试”。本轮从占用发送扩展检查会话输入、正文恢复、子 Agent、独立 Codex 工作台和启动/监听链路。没有提交或推送，没有修改官方 VSIX，没有重启共享会话运行层或停止正式 Agent；保留原有工作区的其他改动。

## 发送问题与插件依据

截图的根因是提交服务在明确拒绝前创建了回显，并把所有错误都归为回执未知；failed 队列项也能进入正文。当前仓库实际存在的官方插件为 `third_party/openai.chatgpt-26.51007.21434-linux-x64/extension`；用户此前提及的 26.51002 目录已不存在。对照当前 bundle 的提交函数与 zh-CN 文案：占用预检查在提交前拒绝，明确拒绝撤销 provisional turn，结果未知保留待确认。提取的原始函数验证、源码片段及截图在 `.dev-runtime/occupied-send-diagnosis/`，这不是完整官方 VS Code 宿主行为的替代验收。

- 只读占用快照阻止已知 external/releasing/acquiring/unknown；主输入、侧边输入、允许直接输入的子 Agent 共用保护。快照保持轻量、有界、请求合并，相同快照不通知 UI，运行实例切换丢弃旧响应。
- 明确未接纳只撤销精确 thread + 提交 ID 的回显，保留捕获的文字、附件和草稿版本。原生接纳/turnId 胜过迟到拒绝，模型执行失败不撤销已送达消息；即使持久化失败留下 uncertain + turnId，迟到 failed/cancelled 也不能撤回正文或消除重复投递保护。
- journal flock 的真实占用返回 409、FOLLOWUP_QUEUE_OWNED_ELSEWHERE、not-admitted；其他 5xx 不冒充未接纳。
- 真正未知保留回显并阻止重复投递；既有队列核对和只读恢复保留，不自动重发。

## 功能与画面修复

| 问题 | 修复和防回归 |
| --- | --- |
| 嵌套会话菜单打开即卸载 | 保留父 Popover，补入口名称，释放仍显式确认 |
| 后台发送失效或操作另一个窗口 | 精确 thread/新聊天 draftOwner + 可见输入区，遵守禁用状态 |
| 运行中有稿仍没有发送按钮 | 停止保持可用，草稿发送沿用 queue/steer 和所有保护 |
| 长文本布局、滚动和内边距异常 | 外层 slot 与 Lexical editor 职责分离；手机固定高、桌面自动增高 |
| 历史重试被占用提示遮挡 | 错误存在时抑制重复浮动状态，继续维护占用元数据 |
| 模型警告重复 | 对照官方 v2 中文文案仅保留一次 |
| 同级提示重复 React key | records/access 各自稳定前缀，按会话切换卸载 |
| 原生列表重叠 ID | 保留首项、顺序和输入目标，追加仍去重 |
| 新 Codex 标签被旧共享快照移除 | 保留本地待确认 journal 操作涉及的标签 |
| 原生文件选择/通知不可见或不可点 | 自有 surface 样式恢复宿主弹层，空通知层不截获聊天点击 |
| 角色引用、本轮停止入口失联 | 复用现有组件和安全检查，放回附加菜单及输入状态面板 |
| 不完整发现隐藏或历史重放重新激活已知子任务 | 保留身份和待确认状态；历史元数据不清除 unavailable、不覆盖实时 revision 或已确认权限 |
| 监听配额阻塞运行层与启动脚本 | 仅配额触发有界元数据轮询，清理定时器、保留其他错误和进程 |

行为改动先由失败单测或真实浏览器/启动测试复现，再转绿。测试保留草稿/图片、接纳优先、不可重复发送、审批身份、旧轮过滤、停止确认、可见消费者与网络裁剪断言。浏览器 fixture 更新新版入口、只读恢复的显式选择、view=chat 路径和 TLS 探针；不放宽产品 TLS 保护。失败历史的两条事件恢复路径可合并，逐路径验证最多一次以及有界 recent 请求，不再把总请求次数固定为必然 1。

## 验收与证据

最终命令与输出：

- `pnpm test` 通过：会话/Codex 前端 455 文件、2089 项，网关 879 项（1 项跳过），运行层 191 项，终端 559 项，原生宿主/适配器 117 项，脚本 124 项。输出 `.dev-runtime/review-tests-final-v4.log`。
- 最后补充的 turnId 接纳证据、发送服务、占用快照与子 Agent 历史/实时边界 92 项回归通过：`.dev-runtime/review-history-last-green.log`。
- `pnpm check` 通过：`.dev-runtime/review-check-final-v4.log`；最后补充修改的前端 TypeScript 检查也通过：`.dev-runtime/review-types-history-final.log`。仅有既有的大体积 chunk 提示。
- 选定浏览器验收（13 文件、74 用例）：`.dev-runtime/review-browser-final.log` 与 `.dev-runtime/review-browser-final/`。合并执行暴露两项恢复竞态，71 项通过、1 项 30 分钟测试跳过；两项修正后，失败历史/子 Agent 的 16 项浏览器回归全部通过：`.dev-runtime/review-history-browser-final.log`。最后的状态恢复与内存保护复验 7 项通过、1 项 30 分钟压力测试跳过：`.dev-runtime/review-recovery-memory-last.log`。
- 上述验收覆盖 73 个不同的已执行场景；这里没有把重复执行的测试累加成新增覆盖。
- 真实局域网只读检查：`.dev-runtime/review-live-final.json`，375/1440px 无页面异常、scrollWidth 等于 viewport，HTTP 网关/会话健康均 200。

局域网入口为 `https://10.30.0.24:8484/?mode=session`，协议 HTTPS、前端端口 8484、绑定 0.0.0.0；网关端口 8282，配置仍由本地 .env 决定。浏览器交互使用隔离 API/临时队列，文件监听测试使用独立临时目录和子进程，没有向正式 Agent 投递消息。

## 实测边界

内存验收使用原生 HTTP/EventSource，验证 view=chat 在浏览器接收前裁剪工具正文、不可见正文在 60 秒宽限后释放、真实完成/审批及只读恢复，分别记录自然 GC 的 JS 堆和全部 renderer RSS。不可见正文/恢复测试未强制 GC 或刷新掩盖增长。该隔离浏览器的三个阶段（可见、休眠释放、只读恢复）JS 堆为 164842368 / 64462468 / 66177572 字节，全部 renderer RSS 为 502640640 / 312303616 / 651268096 字节；恢复后的 renderer RSS 比初始值高；JS 堆的下降不能替代 RSS 稳定性证明，因此通过释放/恢复断言不代表长期稳定性结论。最终测量在 `.dev-runtime/review-recovery-memory-last/*/idle-memory-observations.json`。

网络投影测试约 100.7 MB 上游数据，浏览器事件 data 合计 6178 字符、最大单事件 317 字符，验证正文在浏览器接收前裁剪。此独立网络测试的 GC 堆采样不能替代上面的自然 GC 与 RSS 验收。30 分钟持续事件测试默认跳过，本轮不宣称长时间 RSS 闭环。

已按用户前面的重启要求执行 `pnpm dev:restart`，启用本次前后端、网关和启动 watcher 修复；两个端口继续绑定 0.0.0.0。重启前后会话运行服务保持同一 PID 2712539，既有 Agent 未被停止。日志为 `.dev-runtime/review-restart-final.log` 与 `.dev-runtime/review-live-status-after.log`。`pnpm session:status` 确认服务健康，并提示现有运行进程与磁盘新构建不同：新运行层的监听降级已编译和测试，尚未替换现有运行进程，需待任务结束后的安全窗口启用。官方宿主的隔离测试不等于所有插件能力完全对齐；没有实体同网段设备的触摸、浏览器或网络连通验证。
