# 会话模式插件对齐与秒进审计（2026-10-27）

状态：用户 review 后已实施启动提速与中断历史提示。当前验收门槛为单窗口及三窗口并发下 composer p95 ≤ 2 秒；完整 Codex 插件视觉对照和跨设备协议验收不在本次改动范围内。

## 实施结果（2026-10-27）

- 模块导入安全：i18n 初始化、Codex 运行代次／账号观察、线程模型 BroadcastChannel 与焦点同步、浏览器防休眠可见性监听，都改为实际会话工作台挂载时显式启动并在卸载时清理。Mermaid 运行器仅在渲染 Mermaid fence 时加载。
- 独立 Plan 窗口：该路由不挂载主 App，现只在有效快照存在时启动 i18n，并等待初始化后再克隆语言实例；初始化失败显示明确重载入口，无效快照仍直接展示校验错误。
- 加载路径：工作台首次空闲时预热 SessionWorkbench；当前进入会话模式时并行预载 App 和 AgentComposer；AgentView、会话列表、卡片、欢迎区和子 Agent 面板分块懒加载。首屏编辑器使用真实 `[contenteditable]` 可见状态计时，不使用 loading DOM 作为就绪信号。
- 验收采用隔离生产构建与 Chromium 新 context，健康、项目、标签、线程历史均由测试夹具提供；没有连接正式 Agent 或发送任务。桌面／手机尺寸视口为 1440×900、393×852。

| 场景 | 样本 | 导航 p50/p95/max | composer p50/p95/max | 请求数 p50/p95/max | 传输字节 p50/p95/max |
| --- | ---: | ---: | ---: | ---: | ---: |
| 单窗口 393px | 30 | 0.413/0.457/0.476 秒 | 1.206/1.327/1.333 秒 | 206/214/217 | 1,918,227/1,930,065/1,935,842 |
| 单窗口 1440px | 30 | 0.401/0.443/0.447 秒 | 1.187/1.280/1.285 秒 | 213/225/225 | 1,943,944/1,958,328/1,962,550 |
| 三窗口并发 393px | 30（10 批 × 3） | — | 1.414/1.591/1.626 秒 | 204/207/207 | 1,883,467/1,899,934/1,900,716 |
| 三窗口并发 1440px | 30（10 批 × 3） | — | 1.413/1.529/1.529 秒 | 211/221/222 | 1,909,620/1,931,058/1,931,397 |

并发压力回归还在三窗口都打开时实际向活动 composer 填入草稿，两种视口通过；所有场景均断言没有 `turn/start`、`turn/interrupt`、`thread/start`、`thread/resume` 或 `thread/unsubscribe`。三窗口是同一 Chromium context 中的三个页面，覆盖同源存储和渲染争用，不等同于三个原生宿主窗口。

刷新中断回归确认：原生历史中 13:40:57 开始的轮次在 13:43:28 以 interrupted 结束；14:17:01 后续另一轮正常完成。运行层 PID 954963 的启动时间为 13:43:39，但时间接近只构成相关性，不能证明进程切换导致该轮中断。刷新只读读取历史，UI 改为“该轮已中断”并说明状态属于单轮；浏览器回归通过。

上一轮实现基线验证：`pnpm check` 通过；递归单测包含 593 个 Web 测试文件／3668 项、370 项 session-runtime 和 152 项脚本测试。本工作区差异后的复验见文末。

## 当前主工作区改动后的生产加载复验（2026-10-27）

用户将可接受门槛确认为导航与可编辑 composer 均在 **2 秒内**可用，手机多窗口也需保持流畅。合并当前 Codex composer 主动作改动后，重新执行 `pnpm --filter web build`，构建通过（49.22 秒，8304 个模块）；保留已有 dynamic/static import 重叠和大 chunk 警告。随后在临时生产预览 `http://10.30.0.24:8877`（绑定 `0.0.0.0`）运行 Chromium 加载关卡，完成后停止该临时预览；正式 LAN Vite/网关没有重启。

运行命令：

```sh
SESSION_STARTUP_RUNS=30 SESSION_STARTUP_MULTI_WINDOW_RUNS=10 \
PLAYWRIGHT_SKIP_WEBSERVER=1 PLAYWRIGHT_FRONTEND_PROTOCOL=http \
PLAYWRIGHT_BASE_URL=http://10.30.0.24:8877 \
pnpm exec playwright test tests/e2e/session-startup-performance.spec.ts
```

| 场景 | 样本 | 导航 p95 | 可编辑 composer p95 | 最大值 |
| --- | ---: | ---: | ---: | ---: |
| 单窗口，393×852 | 30 | 0.490 秒 | 1.300 秒 | 1.328 秒 |
| 单窗口，1440×900 | 30 | 0.476 秒 | 1.295 秒 | 1.297 秒 |
| 三窗口并发，393×852 | 30（10 批 × 3） | — | 1.560 秒 | 1.570 秒 |
| 三窗口并发，1440×900 | 30（10 批 × 3） | — | 1.529 秒 | 1.581 秒 |

三窗口保持打开时分别在手机与桌面 composer 实际输入均通过；所有冷进入/并发样本均未调用 `turn/start`、`turn/interrupt`、`thread/start`、`thread/resume` 或 `thread/unsubscribe`。这里的“窗口”是同一 Chromium context 的三个独立页面，健康、项目、标签及历史 API 使用隔离 fixture；不代表三个原生宿主、真实后端数据量或实体 iPhone/WebKit。原始测试输出汇总见 `.dev-runtime/session-startup-active-goal-20261027/current-run/summary.json`。

## 实施前权威基线

- 当前工作区干净，前端／网关服务继续运行在 LAN HTTPS `https://10.30.0.24:8484` 与 `0.0.0.0:8282`。本轮没有重启服务、切换真实 Codex 窗口、发送任务或执行审批。
- 实际 VSIX 是 `openai.chatgpt 26.51007.21434`，SHA-256 `75cee7497cf38c721cfeaa7383b579537b4e4439086f996258705de5da03ad56`；`docs/codex-plugin-parity.md` 和 `strict-parity-plan-20261011.md` 仍以 `26.51002.51308` 为基线，须先换成当前包再做同版比较。
- 通过 REA 检查并提取当前 VSIX。相关证据：包清单 `ev_4cd0a7d74c9d2d7f6b1fa84231c554229b4a33bfcac2d96672dfecdc8e921866`，完整提取 `ev_8957db3bff263fcc5b937196aa94368fea1b42d882d6a57c2a9a40bcff98ed73`。针对 `app-initial-fee819fe4f22.js` 与 `first-run-f061ccffb424.js` 的限定静态分析为 `ev_0009646140a44053f78ada82857292b19abc66b82229b529a08c1efd4402958e`：读取 2 个 JS 文件、1,849,065 个 AST 节点，语义覆盖为 partial，不能替代官方 UI 的浏览器操作与截图。
- 当前官方 bundle 使用 `data-codex-composer`、可访问的多行 `role=textbox`，并含 `data-above-composer-conversation-id` / `data-above-composer-portal` 插槽。当前产品另有 `ComposerRail`、`session-composer-floating` 和紧凑发送目标条；用户提到的“输入栏上方小凸起”需用当前版本渲染图定位到具体插槽，不能先假定其就是某个旧版组件。
- `pnpm codex:status` 只读确认当前插件版本可用。其返回有既存 `newChatWindowIds`，因此本轮没有打开、聚焦或操作正式原生窗口；浏览器 CDP 调试端口也未发现。正式插件视觉对照须在隔离宿主/窗口中做。

## 实施前加载时间基线

测试使用新 Chromium context、空浏览器存储、1440×900 桌面和 393×852 手机视口。为避免触碰共享状态，拦截了项目和关注标签初始化 POST；因此这些数据的首次同步和已有会话内容不计入下列时间。

| 路径 | 工作台可见 | composer 可见/可交互 | 额外数据 |
| --- | ---: | ---: | --- |
| 正式 LAN Vite 开发态，直达 `?mode=session`，3 次/视口 | 桌面 2.13–2.48 秒；手机 1.94–2.27 秒 | 本组仅计到工作台挂载，不能代表 composer 就绪 | 约 249 个 JS 模块请求，9.19–9.53 MB 传输 |
| 正式 LAN Vite 开发态，先打开终端再点会话，3 次 | 2.58–2.89 秒 | 未单独等待 composer | 同样拦截项目/标签写入 |
| 当前源码生产构建的临时 Vite preview，3 次/视口 | 桌面 0.423–0.461 秒；手机 0.396–0.433 秒 | 桌面 0.814–1.315 秒；手机 0.805–1.234 秒 | 15 个 JS 请求、约 1.94–2.01 MB；健康响应为测试合成，列表写请求被拦截 |

`pnpm --filter web run build` 通过。Vite 转换 8,301 个模块；`SessionWorkbench` 产物为 1,995,593 bytes（gzip 586.84 KB）。构建保留既有动态/静态重复导入和大 chunk 提示。生产 preview 时间不能冒充正式后端、有项目数据的完整对话就绪时间。

**结论：**“正在加载会话工作台…”由 `WorkbenchShell` 的 `React.lazy` 边界显示。开发态第一次取入 `SessionWorkbench` 图明显慢于生产构建；工作台挂载后，设置、健康检查、项目/标签同步和正文也有独立等待，必须分段测量。

## 已试候选及不采用原因

1. 在浏览器执行 `import('/src/session-mode/SessionWorkbench.tsx')` 作为闲时预热，3 次样本将点击后工作台挂载降到 0.695–0.747 秒；composer 仍需 1.428–1.762 秒。它在 React 尚未挂载会话模式时注册了 `session-runtime-restarted`、`beforeunload`、`storage`、`focus`、`visibilitychange` 等全局监听。因此不能直接作为预热实现，否则会破坏隐藏模式隔离与草稿生命周期；先拆除这些模块级副作用并补回归，才可重新评估。
2. 浏览器 `modulepreload` 安全加载了 80 个 JS 模块，但实际切换仍需 2.037 秒，当前证据不足以认为单独 modulepreload 能解决该等待。
3. 上述两项都是只读浏览器实验；所有业务 POST 均被拦截，没有触发 session 的健康后写、列表读取或原生任务操作。终端模式自身的恢复请求也被拦截。

## 已批准计划及实现对应关系

1. **先建立真实计时边界。** 在前端仅记录固定阶段数值：document ready、WorkbenchShell、SessionWorkbench、settings ready、health ready、SessionTopNavigation、composer 输入可编辑。区分 dev/production、冷直达/模式切换/第二次切回、桌面/窄屏和多标签；不保存正文、URL、账号或原生协议载荷。
2. **先让模块加载可安全预热。** 追踪当前 VSIX 版本及产品模块的顶层监听/单例副作用，把依赖活动会话的监听改为显式生命周期注册，并保持卸载清理。预热失败、快速切模式、热更新、页面隐藏和低带宽都要覆盖；若无法证明模块惰性加载无副作用，就采用首屏拆分而不是提前执行模块。
3. **拆分真实关键路径。** 先用网络/React profile 定位阻塞 SessionWorkbench 的静态依赖；把首屏导航/连接状态与非关键面板分层加载，优先让会话导航与 composer 可操作。历史正文、模型列表、文件详情和隐藏面板不得阻塞空会话首次显示；也不得以虚假的“已就绪”状态或隐藏 loading 提示替代真实交互就绪。
4. **保留会话语义。** 继续使用同一 thread/project/draft owner；被动加载只能 read-only。预热和懒加载不得启动 SSE/轮询/Agent、不写首次关注集合、不抢焦点、不发消息、不 resume、不 acquire、不改变全局快捷键。保留 `docs/session-memory-contract.md` 的请求/投影/内存预算。
5. **恢复同版插件 UI 对照。** 用当前 VSIX 26.51007.21434 建立空白、新聊天、运行、错误、待审批、长草稿和菜单状态的隔离截图/操作矩阵。优先核对会话导航、composer 表面与上方插槽、工具栏、附件、模型/权限菜单和消息活动；项目导航、跨设备关注标签、队列等看板独有功能继续存在，但外观/交互与原生布局协调。破坏性语义单独评审，不从像素对齐推导停止/审批/发送规则。
6. **多终端严格验收。** 两个独立浏览器 context 并发打开不同线程和同线程：草稿/附件不串写，关注集合和项目元数据按既有共享契约同步，当前选择与阅读位置设备隔离；覆盖迟到响应、并发 reorder/remove、刷新、断线重连、重复请求和零重复发送。使用独立 `SESSION_DATA_HOME` 和 fixture thread，不操作正式 Agent。

## 验收门槛与边界

- 用户最终确认以 2 秒为可接受上限；单窗口和三窗口样本均按桌面／手机尺寸分别报告，不混合平均值。
- 本次使用 Chromium 生产 preview。尚未实测物理 iPhone/WebKit，也未在正式 LAN 服务后端和真实数据量下测得 composer p95；不能把合成夹具数据描述为物理设备或原生宿主验收。
- Codex 插件 26.51007.21434 的空白／错误／审批等逐态视觉 parity、跨设备草稿与队列一致性压力矩阵仍需另行验收；本轮只覆盖首屏加载、三窗口渲染压力和实际输入可用性。

## 当前工作区提交前验证（2026-10-27）

`pnpm check` 通过，包含 shared、session-runtime、server 类型构建与 web 生产构建（8304 模块、47.44 秒）；仅保留已有 dynamic/static import 重叠和大 chunk 警告。全量测试复验中 Web 593 个文件／3668 项与 session-runtime 370 项通过；server 并发回归中发现 `session-chat-history` 测试把 FollowupQueue 的健康/占用后台请求也当成聊天历史请求，已将断言限定到历史接口 URL，随后 `pnpm --filter server test` 946 项通过、1 项按条件跳过。`node --test scripts/*.test.mjs` 152 项通过。首个聚合 `pnpm test` 因该断言失败提前退出，因此改动后的完整覆盖由各包复验结果合并记录，不记为聚合命令通过。

相关浏览器验收：`session-followups.spec.ts` 12/12、360px 桌面/手机浅色/深色控件矩阵 4/4、冷进入与三窗口并发性能用例 6/6 通过。性能结果和夹具边界见本页上方当前生产加载复验。
