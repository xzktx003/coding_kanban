# ChatGPT 桌面模式：受控分屏实验

## 状态和启用边界

分屏是默认关闭的候选能力。常规服务端配置继续使用单窗文档版本 2 和原有 `DesktopSelectedPaneBoundary`；当前服务没有从 HTTP 参数启用分屏。仅服务端显式调用 `createChatGptDesktopSurfaceOptions({ splitPane: true })` 才为该固定 profile 选择版本 4 的文档和分屏资源。共享线程导航的版本 3 与该候选不可组合。该接口是服务端集成点，不表示现有部署已经提供用户开关。

版本 4 只在校验过 profile、generation 和 view 的 bootstrap 之后设置不可写的分屏标记，并在加载原始 index 前初始化对应组件。首页 composer 和本地线程页面共用一个分屏 registry；普通版本 2 继续使用单窗 registry。标记异常、资源版本不匹配或能力初始化失败时拒绝启动该页面，不回退到另一种布局或重放消息。

固定参考包 SHA-256 为 `bb88615052255e79b5977885f9a0cc212c268589587c79d4d3b7c4b46e881a95`。原 `local-conversation-page-50ae20551907.js` 的 SHA-256 为 `b1293967bb28331c9b90c987c795a24f5ee9f93e1abe6a638e8b82d0bcad89d7`；实验分屏适配结果为 `b9a9d864477661f04eb8de1d947caf21ea2c53b95888514cf4d7aba34558ddad`。网关仅在已审查成员与摘要匹配时返回适配资源，不改写原包。

## 布局和输入所有权

保留原 React 根和原会话组件。布局 registry 管理本地窗格树、选中标签和拖动位置；原页面提供已提交的 host、conversation 和 client-thread scope，能力和公共 footer 只绑定当前唯一的已提交目标。切换窗格、模式或目标会撤销旧的输入租约，异步操作不能将结果写入新目标。背景会话通过原只读正文组件呈现；点击其中的可操作元素先请求显式切换到该会话。分屏本身不授权后台启动、重试或接管任务，也不将输入广播到多个会话。

原首页新聊天使用明确的 `conversationId: null` 和原生 client-thread 身份，与线程正文使用同一个实验 registry；它们不是第二套竞争输入的 registry。首页 owner 离开且已有其他选中线程时，不可切回的首页占位从可见布局移除；内部身份仍保留以供原页面重新附着，不操作原草稿内容。会话标签和输入目标从原版按精确 conversation ID 读取的标题 atom 获取显示名；该标题不参与身份匹配或授权，不可用时退回序号。无法捕获、无法安全复制或不能恢复的上下文会保留明确不可用状态，不从 DOM 推测会话身份。只读或没有 composer 的原页面不会抢占活动 footer。

原生界面的浮动侧栏祖先位于 `z-index: 40`。实验布局工具栏须高于它，否则拆分按钮虽然可见，鼠标事件会被原生侧栏截获。新增真实 Chromium 命中回归，分别验证单标签和多标签时的按钮实际点击以及拆分结果。

## 本轮验证

- 固定原包和原 React 组件的相关 Node 测试为 99/99，覆盖单窗与分屏资源选择、scope/租约、只读页面、草稿提升、不可回切占位、标题变更和无效上下文。后端固定配置及路由测试为 3/3。
- 无网络 Chromium 使用固定原包，最后一次首页单窗和分屏能力及分屏按钮命中测试为 3/3；此前组合测试还包含版本 2 入口初始化。按钮遮挡先红后绿；这些浏览器测试使用自有合成数据。
- 隔离 Linux 原生宿主、network-none 容器和原 Mac 前端资源的真实界面中，通过原生侧栏显式打开两个本地合成线程，用鼠标拆分后两条原生正文同时可见，页面只有一个公共 composer。分别选中 A、B 后各发送一次给本机合成 provider；两条原生 rollout 各自记录种子和对应续聊的两个 `task_complete`，没有对方的续聊或重复。完成时 composer 为空，未见 Stop/Queue；已关闭本次 view，未停止该隔离 native。脱敏计数和截图分别保存在本机私有临时夹具的 `split-history-evidence.json`、`split-after-b.png`。
- 随后的独立 view 从首页显式打开同一合成线程，实际只显示一个标签，标签为原生标题，选中 scope 与该线程一致且只有一个 composer；未发送消息。该次界面计数与截图为 `home-to-thread-ui.json`、`home-to-thread-fixed.png`。这不证明未发送草稿跨路由或跨设备恢复。
- `pnpm --filter @agent-orchestrator/chatgpt-desktop-host run check`、`pnpm --filter server exec tsc --noEmit` 和 `pnpm --filter web exec tsc --noEmit` 均通过。

服务端测试可运行 `pnpm --filter server exec tsx --test src/routes/chatgpt-desktop-surface-config.test.ts`。原包和真实浏览器专项需要显式提供原包路径以及隔离 Chromium；未提供时对应测试跳过，不得计作通过。

## 未完成和验收限制

这次 GUI 使用无登录、无外网的合成 provider；它证明本次两线程的目标隔离，不证明真实账号模型、多设备、所有任务状态或长期恢复。实验还未验收真实远程项目、多窗格并发任务、附件与审批、移动端、分屏持久恢复及完整的草稿恢复。原生标题不可用时会回退“会话 N”；原生浮动面板、水平溢出与窄屏布局也需要继续核实。因此不得将该候选作为已完成的 1:1 UI 或默认启用。
