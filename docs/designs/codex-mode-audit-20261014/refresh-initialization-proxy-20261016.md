# 官方初始化分段与显式 Node 代理配置

接续 [原包校验](refresh-artifact-verification-20261016.md)。完整刷新计划继续实施，候选未启用。证据分别在 `.dev-runtime/codex-refresh-20261016-rpc-timeline/` 和 `.dev-runtime/codex-refresh-20261016-proxy-profile/`，下文简称 timeline、proxy。两批均为全新私有无登录 HOME、原 VSIX/匹配 CLI、独立 native/authority/control、实际生成桥接、可见启动、Vite HTTPS/WSS；模型调用只走自有无认证 loopback provider。没有改官方 bundle、feature flag、MessagePort、请求或缓存策略。

## 明确修复的配置问题

`buildChildEnv` 保留 HTTP(S)_PROXY 等地址，却丢弃 `NODE_USE_ENV_PROXY`。显式选择 Node 内建环境代理时，子进程丢失这个选择。现在仅保留明确的字符串 `0` 或 `1`，未设置或无效值保持未设置；宿主不提供代理地址，不因地址存在就默认开启。任意继承的 NODE_OPTIONS 仍不传入，保留自有 provider preload。

[Node 官方说明](https://nodejs.org/download/release/latest-v24.x/docs/api/http.html#built-in-proxy-support)要求显式启用内建代理，实际能力依赖 Node 版本。实测宿主自带 Node v24.21.0，不能从项目支持 Node 20/22 推断所有旧运行时都支持。测试的真实请求只用自有 loopback 代理和目标服务，目标名为保留 `.invalid` 域，不触及外部网络。

- timeline/proxy-env-red.log：宿主原 26 项通过，新增两项失败；既复现显式开关丢失，也复现实际子进程 fetch 未到代理。
- timeline/proxy-env-green.log：**28/28、无跳过**。开关 0/1、缺省/无效值、不继承任意 NODE_OPTIONS，以及真实代理到达均有断言。
- timeline/native-final.log：固定 CLI 的宿主/适配器完整 **286/286、无跳过**，包含真实协议、生命周期和新计时采集测试。
- proxy/proxy-environment.json：按持有的 PID/start ticks 读取三个自有 code-server 进程，均收到明确的 1；只记录布尔值，不保存代理地址、凭证或任意环境内容。

这项修复不自动改变当前正式环境，也不能据此把全部页面等待归为代理故障。

## 原始关键路径证据

timeline/empty-git/result.json：空项目两次刷新到接受为 **11603.70、10438.60 ms**；随后仅在同一自有项目初始化 Git，又完成两次真实发送。创建 Git 没有消除等待。这是顺序诊断，样本和缓存条件不足以证明 Git 对整页性能的因果效果。

生成的自有 CLI 包装器只启用既有 onProtocol 元数据回调，每进程上限 256 行另加截断标记。只含方向、方法、ID、字节数、时间与错误码，不含正文。真实 initialize 回复约 1 ms，多项配置/账号/目录 RPC 约 2–14 ms；附件登记的 fs/readFile 为 1–2 ms，返回不存在文件。后续请求前有约 2.7–3 秒间隔，不能把相邻日志当作该文件读取阻塞的证据。

官方 HTTP 服务在扩展宿主通过 fetch 执行，浏览器 request 观察中的空网络数组不证明没有请求。只读观察原 SDK 的 loadingStatus 及既有初始化 Promise，未调用 SDK 初始化、setter、flag API 或修改其状态；只保存状态、数值时刻、success/source/错误是否存在等受限元数据，不读取用户或 flag 值。

## SDK 和实际接受计时

以下各轮均经官方 Send，确认精确 thread 的 turn/started 与 completed，受控标记恰一次。采样监听本身和不同私有宿主/缓存会影响比较，不能称为严格整页 A/B 或最终 180 次矩阵。

| 批次 | SDK 状态与结果 | SDK duration（ms） | navigation→接受（ms） |
| --- | --- | ---: | ---: |
| timeline/sdk-details，未显式开启 Node 环境代理 | Loading→Ready，success=true、source=Network | 2934 / 2647 | 13016.20 / 11085.10 |
| proxy/sdk-details，新宿主明确 NODE_USE_ENV_PROXY=1 | Loading→Ready，success=true、source=Network | 1802 / 1522 | 11387.20 / 10050.40 |

原返回值还带有非空 error 字段，但未采集任意错误内容；不能忽略该字段，也不能在 success=true 时仅凭它宣称网络超时。两批分别保留 **7 和 17 项 requestfailed**，诊断步骤完成、页面 errors 数为零，但总 passed 均为 false。首次 SDK 观察的 sdk/result.json 是另一轮两样本，不能与 details 批相加冒称性能矩阵。

## 原生 Webview 标记

采集器新增固定官方 `webview/webviewElement/*` 和 `webview/index.html/*` 阶段名，仍最多保留 32 项，记录总数与截断标记；不保存 detail、任意名字或查询参数，不清空原性能时间线。timeline/webview-marks-red.log 为 **5 绿/2 红**，修复后 webview-marks-green.log **7/7**，包括越界和私密近似名字反例。

首次临时手工匹配漏掉 index.html 的 `.html`，该轮 preframe 空数组不能用于推断握手等待；正式采集器修正后重新取得实际阶段。timeline/sdk/result.json 两轮 preframe 的 content/started→workerReady 约 **7.5/10 ms**，wroteInnerContent 在文档开始约 111.5/125 ms；workbench didStart 约 1.3 秒、set-content 约 3.9 秒。不能把 workbench 与各子 frame 的时长相加，也没有证据把几秒间隔归为 Service Worker 握手。

## 验收边界

proxy/three-final 首轮在第二桌面遇到官方 Introducing GPT-6.1 Sol 公告，遮罩拦截输入框点击，只有第一端草稿步骤通过，尚无发送尝试/接受回执。这是首次初始化准备遗漏，失败截图保留，不通过删除遮罩、强制点击、改 flag 或盲目重发处理。新增仅供冷初始化的 focusInitialOriginalComposer：正常点击/触控被阻挡时，只在唯一可见的固定官方标题及 Continue with current model 同时存在时，通过原按钮保留当前模型，然后重新命中输入框一次。未知/隐藏/重复 UI、原按钮失败或仍有遮挡均保持失败。initial-prompt-red.log 的旧直接聚焦路径为 **5 绿/4 红**，green 为 **9/9、无跳过**。该处理只用于三端首次准备，普通刷新计时仍直接点击原控件；出现公告或其他遮挡也计失败，不将点击公告排除出刷新计时。

proxy/three-after-initial-prompt/result.json：两个桌面与 iPhone 16 尺寸模拟，三端使用不同 HTTPS 源。第二桌面和手机首次准备各点击一次保留当前模型，普通刷新阶段没有该处理。独立草稿 **9/9**、三个精确接受及 completed turn 均确认，受控标记恰一次；普通刷新到原生接受 **14096.90 / 13229.80 / 13850.60 ms**，全部两秒失败，**17 项 ERR_ABORTED** 保留，passed=false。真实触控和 393×659/430/852 视口缩放均通过，iframe 及父节点身份保持；不代替完整尺寸矩阵和系统键盘。该标准采样未开启 SDK 状态轮询或 CPU Profiler，仍不是 180 次矩阵。

最终私有盘点：timeline 为 3 线程/11 终态轮次（idle 9 completed、running 1 completed、假审批精确 cleanup interrupt 1 interrupted），proxy 为 3 线程/8 终态轮次（idle 6 completed、running 1 completed、假审批清理 1 interrupted）。两批 Responses 调用分别为 14 次（12 idle/1 running/1 approval）、9 次（7/1/1），不等同用户 turn 数，也不推断额外调用用途。原 seed 创建连接保留，不计 manager 单独保温、官方 UI Stop 或最后订阅退出验收。两份 cleanup-final.json 均确认 **12 个已知自有进程退出、零错误**，原 /tmp/ck-ui-life-N7I2uQ 和 /tmp/ck-ui-life-xdDiLP、TLS 已删除；不以停止正式任务完成清理。

最终构建及正式安全核对接持续进度。临时 LAN 为 **HTTPS https://10.30.0.24:5173**，0.0.0.0、端口 5173，已关闭。iPhone 16 尺寸模拟按用户要求采用 Chromium 145.0.7632.6、393×852、DPR 3、触点 1，Safari UA 不能当作真实 iOS/WebKit、系统键盘或硬件剪贴板证据。

proxy/native-final.log 最终为 **295/295、无跳过**；check-final.log 为 **pnpm check exit 0**，保留原有大 chunk 提示；任务 MJS 格式/语法、git diff --check 和文档相对链接核对通过，.env 忽略、.env.example 可提交。没有提交或推送，没有覆盖并发 Session/Goal/model-menu/feedback 改动。

proxy/formal-safety-final.json（2026-10-16T09:10:46.093Z）核对正式 Session/native launcher/native host 仍为 **2712539/55361120、2718477/83117363、2729812/83119682**，正式 **HTTPS https://10.30.0.24:8484/?mode=codex**（端口8484）及后端/Session健康均200。session-status-final.log 仍 ready、运行产物与磁盘不同，未切换运行层或停止正式 Agent；不据这些身份核对宣称所有网关/网页进程从未变化。

两秒仍失败，原并发手机未提交红灯也未据此解决。完整官方中断/继续/附件/提问、旧设置反例、真实 ChatGPT/OAuth、自动 profile/持久来源/全部宿主资源准入、大消息/长历史、180 次三状态矩阵和自然 RSS 长测继续在原目标内。
