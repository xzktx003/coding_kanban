# 接续指定 Harness 会话后的 Mac 原资源核心验收

> 最新核心交付：Mac 原版 v2 已通过三轮真实收发（第三轮在关闭重开后续聊），地址为 HTTPS 8512。见 [核心可用交付](core-mac-usable-20261106.md)。下文旧实验失败记录保留为历史证据。


2026-11-06，接续 `deepseek-harness/session-87af675b-9e9d-445d-8bc5-f88bf4f47d14`。该会话最后停在原版 AppServerManager 初始化调查。本轮在保留原服务和任务的前提下，已经由浏览器原版输入框、原版发送按钮完成同线程两次真实模型收发；下述 Mac 资源链路与 [8507 Linux GUI 核心候选](core-live-acceptance-20261106.md) 分别验收。

当前候选为 LAN HTTPS `https://10.30.0.26:8508/?mode=chatgpt&view=agent`，前端绑定 `0.0.0.0`。入口认证已在真实浏览器完成，启动前安装字体的新 Chrome 已能显示实际中文侧栏；**独立重开仍复现队列满，暂不将该地址描述为全部核心关卡通过。**

需先打开仓外 owned `0600` 文件 `/data01/home/xing.hu/.cgmac-feature-33uxj88s/auth/open-url.txt` 中的完整私有链接，之后使用普通地址。口令只在 fragment，同源 POST 后自动清除；Cookie 为 Secure/HttpOnly/Strict，匿名 API/资源及真实 LAN WSS 为 401。源码、检查与边界见[访问认证](candidate-access.md)。

## 已确认的真实行为

- 浏览器严格校验证书，通过 TLS 1.3 访问实际 LAN 地址；没有使用 `ignoreHTTPSErrors`。
- 复用固定 Mac `26.1027.61615` 前端资源和 Linux 原生宿主；没有改写原 ASAR，没有用 VNC 或模拟回复代替本轮证据。
- 原版 Choose project / New project / Add、受限目录选择器、Create project、Trust folder 实际走通，项目为全新仓外测试目录。
- 第一条中文指令通过原版编辑器逐字核对，只点击一次 Send；实际回复 `MAC_SINGLE_9D28DD7C40`。
- 同线程追问“请原样重复你上一条回复，不要添加其他内容或调用工具。”，不含答案，只点击一次 Send；真实回复仍为 `MAC_SINGLE_9D28DD7C40`。
- 原生线程 `01a1af32-91c5-7f90-9dc6-a4941667be75`，完成回合分别为 `01a1af32-a903-75e3-b299-9cd2fa48fecc`、`01a1af34-a561-7cc0-b9c7-dc5a722fc262`。两条用户原文各出现一次，两个对应完成回执，零工具调用。
- 两次回复均在真实页面中；完成后只有一个可见原版 composer，原 ProseMirror 文档只含一个空段落、`textContent` 为空，没有 Stop 或 Queue；完整文档属性保留在私有 JSON 中。
- 通过真实四模式按钮切至终端再回 ChatGPT，保留同一个 iframe，原生仍为上述两轮，没有额外发送或重启。

原版空输入会显示 `Start voice chat`；原版建议文字以 `data-cumberbatch`、`inert`、`aria-hidden=true`、`contenteditable=false` 的 widget 展示，不属于编辑文档。旧临时验收先误等空输入的 Send，再误将 widget 的 innerText 视为草稿，均在第二轮之后的只读检查失败，未导致重发。最终核对原 ProseMirror `pmViewDesc.node` 的真实文档及忙碌控件，没有删除原版建议或修改产品行为。

## 首次分屏候选失败的保留记录

本轮先使用 version 4 分屏配方。项目创建成功，但首个 Send 后，浏览器 renderer 持续占用一个核心、RSS 约 1.6 GB；JS evaluate、截图及原始 CDP Profiler/Debugger 均不能及时取得响应。原生容器存活且没有 OOM。Native 处理过 `thread/start`，但没有可与该次标记绑定的最终回执、持久线程或 `turn/start`；**该次结果仍为 unknown，未重发该消息。**

保留旧发送 ledger 和采样失败证据后，只关闭精确自有卡死 page；没有停止原生实例。8508 自有网关切回默认 version 2，原 native PID 未变。重新打开后保留的自有旧测试草稿已另存，显式 New chat 后改用新测试标记，取得上述两轮结果。

分屏源码另修复了可独立复现的缺陷：原 GI 首挂、输入 owner 尚未 commit 时，同一 scope 被再次提供给 PassiveTranscript；等待切换时也可能重挂当前 scope。现在展示选择与输入 owner 分开，同 scope 不再创建第二套背景 providers。直接红绿通过。**这尚不能证明它就是旧页单核死循环的完整根因，也尚未部署到 8508 的单会话入口。**

## 当前实例与复现证据

- 自有 native 服务 `cg-mac-candidate-POrLXAMd.service`；容器完整 ID `f6c83203878cb685f3cc361eaffe4d6e36dbc7ada396603e4aca4553b3da1755`，init PID `416067`。实例身份必须在后续操作前重查。
- Profile `/data01/home/xing.hu/.cg-mac-candidate-POrLXAMd/s/p.json`；profile ID `bad9653a-0c6e-456d-9197-4e71291285d6`，generation `862d99c8-383a-4d36-8514-2947f4e7c148`。
- 新独立持久历史 `/data01/home/xing.hu/.cg-mac-candidate-POrLXAMd/h`；登录是授权访问快照，HOME 在独立 tmpfs，不复制刷新令牌；未导入用户旧 CLI 历史。
- 固定测试项目 `/data01/home/xing.hu/.cg-mac-candidate-POrLXAMd/p`，界面名称 `Mac parity acceptance 33uxj88s`。当前候选没有挂载用户整个主目录或真实主项目。
- 前端/网关冻结目录 `/data01/home/xing.hu/.cgmac-feature-33uxj88s/stage`；服务分别为 `cgmac-feature-33uxj88s-web.service`、`cgmac-feature-33uxj88s-auth-gateway.service`。先前无认证的自有 gateway 已停止，native 未重启。机器配置在仓外私有文件。
- 私有证据根 `/data01/home/xing.hu/.cgmac-feature-33uxj88s`：`single-send-ledger.json`、`single-{first,second}-draft.json`、`single-two-turn-native-evidence.json`、`single-mode-switch.json`、`single-two-turn-complete.png`。
- 旧分屏首次失败保留 `send-ledger.json`、`first-send-cpu-summary.json`、`first-send-stack.json`、`first-send-abandon-page.json`。不要把首次未知样本与后续 version 2 的成功样本拼接。

## 仍待完成

新浏览器及单只读重连均复现 `BRIDGE_QUEUE_FULL / waiting_count`，没有发送模型消息。唯一带计数的重连在约 15.6 秒失败：端口已就绪 2 个、未就绪 0；pending 34，其中 portPost 32；等待 232 条均为已就绪端口，保留约 0.5 MiB，触发快照 116 字节；双向序号为 973 / 1630。未扩大原 64/264/8 MiB 预算。原始计数为 `single-reconnect-wait-counts.json`，重连意图与结果单独保留。

网关实际 profile 的只读核验中位约 0.65 ms；原生身份 guard 同步化的同口径夹具节省不足 0.132 ms，未据此部署无效优化。固定原 ROP 的合成订阅/通知在完成后收敛，尚无依据认定为订阅循环或丢弃、合并消息。下一候选改为显式独立 Worker 承载 AppHost 收发，默认入口保持现状；该候选尚未完成真实验收。

严格 HTTPS 下的三次有界独立重开仍未通过。完整 Mac 视觉/功能对齐、自由分屏真实模型组合、旧 CLI 线程/任务共享、SSH、云及机器重启恢复仍未完成。本轮真实两轮不等于完整一期或最终 Goal 完成。

### Worker 首次真实只读观察（未通过）

- 独立 `8510`/`44115` 页面使用 v6 Worker 接线，原生仍为原实例；未发送消息、点击线程或更改设置。Worker 资源确实加载，首屏项目与历史可见，但仍报 `ENTRY_BRIDGE_FAILED / BRIDGE_QUEUE_FULL`，模型列表停留在加载中。
- 页面已关闭，自有候选网关已停止；原先真实线程的 `task_started/task_complete` 均保持 2/2。该观察不能算作已解决重开，也不能替代完整收发验收。
- 证据保存在本机私有 `.cg-worker-candidate-64mmdx10/readonly-probe-result.json` 与同目录截图。下一步仅在失败时记录有界数字，区分真实 ACK 吞吐、端口生产突发与 Worker IPC 占用；不会提高预算或自动重发。
