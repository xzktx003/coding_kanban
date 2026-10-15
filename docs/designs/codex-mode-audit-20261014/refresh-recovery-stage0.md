# Codex 刷新恢复：阶段 0 实施与严格验收

任务始于 2026-10-14，最终收尾于 2026-10-15（Asia/Shanghai）。**阶段 0 连接原型已实现，恢复/性能关卡失败；阶段 1–3 未实施或启用。** 本次遵循 [已授权计划](refresh-recovery-plan.md) 的停止条件，不将连接通过写成两秒恢复、10 项保温池或多端能力已支持。续案见 [待 review 的调整](refresh-recovery-stage0-review.md)。

## 修改与真实连接

新增 `packages/native-codex-host/refresh-prototype/cli-bridge.mjs` 和两份测试。正常 launcher、网关和工作台不启用此模块。隔离原型通过官方开发专用 `chatgpt.cliExecutable` 选择自有连接桥接；官方 VSIX/CLI 不作补丁，保持本地浏览器 DOM、原生 iframe 父节点与 MessagePort。

实际官方 VSIX 为 **26.51007.21434**，附带 CLI 为 **0.162.0-alpha.17.2**。SHA-256 分别为 `75cee7497cf38c721cfeaa7383b579537b4e4439086f996258705de5da03ad56` 和 `73b73b048546993298234a295de01ef2424e7a8b29def9d0ecb1ca7cb77500d4`。另装的 `0.162.1` 未代替该版本；版本/哈希不一致时拒绝连接。

附带 `app-server proxy --sock` 在自有 Unix listener 上六秒未收到 initialize 响应；同版本的 WebSocket 握手能初始化。原始字节 proxy 与该控制端点不兼容，因此按计划验证自有 JSONL/Unix WebSocket 适配。该 native 版本生成 rendezvous link 与带请求路径 SHA-256 的物理 socket；原型只接受精确哈希、owned0600 socket 和 owned0700 canonical 父目录，不允许链接到任意或默认 CLI socket。

各 bridge 独立连接，原始请求 ID 不变。单条输入 8 MiB、输出单帧 2 MiB、待发 8 MiB，保留背压；畸形、截断、超限或断连终止当前连接，不重连重放，不管理后台进程。只保留有界诊断字段/字节数，不记录 params/result/工具正文；截取字段时复制，避免 SlicedString 留住大字符串。哈希用流式读取。大历史原子响应的兼容性尚未验证，不能据此放宽现有网关预算。

真实协议测试在全新无登录 HOME 创建一个 ephemeral/read-only thread，三个连接独立 initialize、使用重复数字 ID 获取各自正确响应；退出一个客户端后另一客户端仍观察到同一已加载 thread，原生进程存活。没有模型轮次，不代表运行中任务保护或审批恢复已验收。

浏览器另用全新 HOME/项目/应用目录，沿已有授权的 `--connection-profile-home` 副本路径复用登录和所选模型，不导入正式历史/MCP，不接管默认 IPC。真实官方 composer 在私有项目创建测试 thread、提交纯文字任务，核对正确目标的接受及完成记录。OpenAI 将 WebSocket transport 标为实验性且不受支持；本原型没有将开发专用 CLI 设置包装成官方支持的正式部署。[官方协议](https://learn.chatgpt.com/docs/app-server#protocol)

## 性能关卡失败

隔离开发入口为局域网 **HTTPS `https://10.30.0.24:5173/?mode=codex`，端口 5173**，前端绑定 `0.0.0.0`，使用当前开发入口源代码与 Vite 配置。网关使用仓库实际原生代理及原预算；最终对照使用真实标签持久化接口。该服务验收后回收。正式入口仍为 HTTPS `https://10.30.0.24:8484/?mode=codex`，保留原路径。

本次分开三轮，保留全部失败样本：

1. 最小目录/标签夹具的桌面/手机缓存刷新，官方引导控件约 9.49 / 8.86 秒出现，正确 target composer 未恢复。夹具未实现完整同步序号，恢复失败不能直接归因为正式代码。
2. 更换真实标签接口后，发现首次发送没有捕获关注记录；在计时前显式加入自有测试 thread。未选择保存的 history 标签时仍显示新聊天引导，此轮不当作热 target 可操作时间。
3. 最终计时前点击保存的自有 history 标签，确认官方 composer UUID、后台 idle、loaded/list 命中。普通刷新后仍未恢复；截图显示打开链路 HTTP 409。后台进程 **3992691** 未变化，结束后仍命中该 thread。

| 从 navigation start 起的阶段 | 桌面 1440 px | 手机视口 390 px |
| --- | ---: | ---: |
| 外壳/标签 | 523.5 ms | 556.9 ms |
| code-server workbench DOM | 1914.6 ms | 1800.6 ms |
| 私有实例标记 | 3785.5 ms | 3510.4 ms |
| 正确 thread 的可操作 composer | 额外等待 45 秒仍未恢复 | 额外等待 45 秒仍未恢复 |
| 两秒硬线 | **失败** | **失败** |

未把终点改成 iframe onload、标记、缓存文字或任意输入框。最终两项没有取得恢复后的真实发送回执；不能声称约两秒可输入。初次 composer 约 18.94 秒，含该隔离 profile 的四步官方引导，不混入热刷新数据。

共享 app-server 只处理后台运行域，不能自动解决浏览器协议对象重建、官方初始化、profile 与目标恢复。HTTP 409 的完整归因、旧实例/窗口绑定和原生 IPC 角色尚未定位闭环；没有通过释放旧实例、停止 Agent 或点击接管制造通过。

阶段 0 已触发停止条件，没有执行各 30 次 × 空闲/运行/审批的矩阵，也不为缺失 endpoint 计算 p50/p95。物理手机、第二台同网段设备、10/30 分钟重入、运行中刷新、审批/提问、独立草稿、IME/附件/触控与旧长历史均未验收；视口模拟不代替物理设备。

## 自动验证

| 检查 | 最终结果与边界 |
| --- | --- |
| 桥接红绿灯 | 模块不存在先红，八项转绿：中文分片、ID 隔离、退出、畸形/超限、native rendezvous 与诊断不保留正文 |
| 诊断红绿灯 | 初始 ID 无界导致新增用例失败；修复后有界，原始协议 ID 不变 |
| 真实匹配 CLI | 显式提供 `NATIVE_CODEX_REFRESH_CLI`，一项真实 native 测试通过；未把默认 skip 计为通过 |
| 自有宿主与只读适配器 | **126/126** 通过，含九项新测试 |
| Codex 前端定向 | 14 个文件，**92/92** 通过 |
| 原生网关 | **31/31** 通过，保留原 WS 大小/分片/解压/背压保护 |
| 交接测试编译补充 | 现有 `ConversationMenu.native.test.tsx` 可空 state 令全量检查失败；仅加严格合法夹具检查，**78/78** 通过，产品交接行为未改 |
| `pnpm check` | 最终共享包、运行层、前后端类型检查及生产构建通过，保留原大 chunk 提示 |
| 真实官方刷新 | **失败**，不因单测和构建通过而标绿 |

未声明全仓测试/浏览器矩阵或阶段 1–3 完成。没有修改会话 SSE/历史/正文 store、原生 renderer 或网关传输语义；会话内存保护没有放宽。交接测试仅收紧非法 fixture 输入。

## 资源与安全

短程进程树快照从已验证的自有宿主、原生服务、fixture 网关/前端 roots 追踪父子关系：app-server RSS 292.48 MiB；三个保留的 extensionHost 合计 923.50 MiB；三个 bridge 合计 279.24 MiB。code-server 的断连宽限期允许旧扩展进程暂时保留，**不能声称断开客户端的资源已受控**。一次快照不推导单/十 thread 预算或增长斜率。

没有完整同步 JS heap/renderer RSS 样本、十 thread/长历史准入数据或指定场景的 30 分钟自然实验，内存关卡未通过。没有清空性能 API、强制刷新正式页面、停止其他作业或修改 inotify 限额；EMFILE/监视降级和 sandbox 诊断保留。纯文字任务通过不代表命令 sandbox 通过。

正式宿主 launcher/host **2718477 / 2729812** 和会话运行层 **2712539** 在原型期间保持存活；不启用新正式路径，不向正式 thread 发送/审批/中断/接管。清理仅针对生成记录、进程对象及父子关系确认的自有 fixture。

最终清理确认全部 13 个自有 fixture 进程退出，无强制 KILL；native 自行删除物理 socket，私有目录与复制的登录配置已移除。正式应用/会话/原生健康均为 HTTP 200，会话实例仍为 `bb852815-5380-4f39-88c9-c250e14df4aa`。正式宿主与会话 PID 保持，原版 extension.js 与 VSIX 哈希复验一致。

## 证据与复验

- [连接实现与配置](../../../packages/native-codex-host/refresh-prototype/README.md)。
- [真实官方 UI 完成测试任务](refresh-proof/official-idle.png)。
- [保存目标刷新未恢复：HTTP 409](refresh-proof/warm-target-not-ready.png)。
- [两项最终原始样本](refresh-proof/final-samples.json)。

完整本地记录在被忽略的 `.dev-runtime/codex-refresh-20261014/`：proxy 探测、红/绿日志、native/宿主/Codex/网关/交接检查、`check-final.log`、各轮 browser JSON/log、协议元数据、资源树及清理/正式服务复验。协议计数混合多轮隔离探测，page-target CDP 字节数不覆盖所有 OOPIF/worker，均不能当作单次完整 Webview/历史流量。

没有降低两秒线、修改 VSIX、重写官方 UI、恢复画面转发、迁移活跃 thread、提交或 push。正式产品刷新恢复仍未闭合；按原计划须 review 续案后再推进。
