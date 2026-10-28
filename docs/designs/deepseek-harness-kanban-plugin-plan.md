# Coding Kanban 接入 DeepSeek Harness：插件包装计划

日期：2026-10-28。状态：需求已澄清，方案待实施；本文不代表插件或全功能嵌入已验收。

## 1. 已确认的目标和边界

- 将现有 Kanban 完整页面放进 Harness，保留终端、会话、原生 Codex 三种模式及原有功能入口。
- 首阶段只接页面；本文同时设计后续 Agent 工具，工具不属于首阶段交付。
- 优先不改 Kanban 和 Harness 源码，允许增加独立插件包及部署配置。确有必要时只对 Kanban 做兼容改动，默认直接访问行为保持原样。
- 接入当前 Kanban 服务、数据和运行层，不新启动 Kanban 实例，不迁移历史，不接管或重启已有 Agent。
- 公网和手机接入留给后续阶段。首阶段在本机／局域网桌面浏览器验收。
- 当前已安装 Harness 为 `0.2.1-rc.4`，实施时再次核对实际版本；先为该版本验收，不泛称兼容所有后续版本。

## 2. 推荐架构

新增独立插件 `harness-kanban`。浏览器侧注册 Harness 导航入口、工作台容器和连接设置，容器通过 iframe 加载当前 Kanban 的完整 HTTPS 地址。Kanban 页面继续在自己的 origin 下访问 API、SSE、终端 WebSocket、VS Code 和原生 Codex 网关。

```text
桌面浏览器
  └─ Harness 页面：导航入口 + Kanban 容器（新增插件）
       └─ iframe → 当前 Kanban HTTPS 页面
                    ├─ 当前 Node 网关 / API / SSE / WebSocket
                    ├─ 当前会话运行层 / tmux / SSH
                    └─ 当前 VS Code / 原生 Codex 宿主

后续 Agent 工具（可选）：
Harness Agent → 插件服务端适配器 → 当前 Kanban 网关的指定接口
```

独立插件包可以先放在 `packages/harness-kanban`；它是新增代码，不把 Kanban 前后端复制进插件。插件安装、构建和卸载独立，不改变当前 `pnpm dev` 的启动职责。安装格式及打包脚本以实施时已安装 Harness 的插件契约为准。

插件设置只保存 Kanban URL 等非敏感连接信息；端口、主机、协议由配置选择。认证材料不放入 iframe URL 或仓库。

### 为什么保留 Kanban 自己的 origin

当前前端有绝对 `/api`、`/ws`、`/vscode`、`/native-codex` 路径，不能靠给首页增加 `/kanban` 前缀完成包装。`native-surface.ts` 还限制原生 iframe 路径。保留当前 origin，能够复用已有代理和浏览器存储作用域。

已有设备的 Kanban 存储仍须实测：嵌入上下文可能受到浏览器存储分区影响，不能保证 iframe 与独立标签共享所有本地草稿和布局。服务端历史、项目和运行状态则继续来自同一服务。若浏览器分区造成必要功能不一致，先验证受支持的部署配置；仍需兼容代码时只改 Kanban，保持普通入口默认行为。

### 前置验证 A：安全上下文

本轮只读探测：Kanban `https://10.30.0.28:8484/` 返回 200；Harness `http://10.30.0.28:3080/` 的未登录请求返回 401。地址仅为当前观察，不能写死到插件。

局域网 HTTP 父页面会影响嵌入文档的安全上下文，不能将 iframe 内使用 HTTPS 当成完整解决。正式接入前验证 Harness 的 HTTPS 部署配置，或部署独立 TLS 入口转发至现有 Harness 进程；两种方式均不新增 Kanban 实例。TLS 入口须保留 Harness 的 Host/Origin 认证语义，验证证书、登录 cookie 和 WebSocket。若更改 Harness 配置需要重启，实施时先核对活动任务并使用安全窗口；计划阶段不执行切换。

嵌入必须验证 clipboard、microphone、fullscreen、下载以及嵌套编辑器需要的权限委派；不套用会直接破坏原有脚本、存储、弹窗或下载的通用 sandbox 配置。新增 TLS 入口属于部署组件，不能描述成完全不增加任何监听器或配置。

### 前置验证 B：容器生命周期

Harness 提供 `main` 页面插槽和导航扩展点；不能假定切换 `main` 页面会保留 iframe。首轮先验证切回后页面是否重载、终端是否重连、草稿和选中会话是否恢复。

若 `main` 会卸载页面，使用官方持久 shell 扩展点承载同一个 iframe，由导航入口切换显示；候选为列表型 `shell.overlay`，位置、遮挡、焦点、热键和生命周期均需验证。不移动已加载 iframe，不通过替换 DOM 父节点保活。隐藏容器必须失去输入焦点，不拦截 Harness 快捷键；重新显示不能自动发送、审批或改变 Agent。

跨 origin 父页面无法直接读写 Kanban DOM。若验证发现容器隐藏仍使 Kanban 保持可见消费者、处理热键或占用显著后台资源，才考虑 Kanban 的显式嵌入兼容开关和有界消息协议。协议须校验精确父 origin、消息来源与版本，普通直接访问不启用。不能在未验证前承诺绝对零源码修改。

## 3. 首阶段实施顺序

| 步骤 | 工作 | 可评审产物／通过条件 |
| --- | --- | --- |
| 1. 记录当前基线 | 核对 Harness 版本、Kanban 地址、已有宿主能力和活动进程；按功能清单建立逐项矩阵 | 标明已可用、当前缺失、待验证；不为包装自动启动缺失原生宿主 |
| 2. 最小接入验证 | 用独立插件加载完整页面，验证登录、TLS、安全上下文、iframe headers 和嵌套编辑器 | 路径可用、页面无阻断错误；仅显示首页不算通过 |
| 3. 页面插件 | 导航入口、完整工作区、设置、连接说明、打开独立页面入口 | URL 校验、无效配置提示；不接受页面参数指定任意代理目标 |
| 4. 保活与隔离 | 验证切换、隐藏、重显、刷新、焦点和资源释放 | 正常导航不重复建 iframe；关闭页面不停止后台 Agent |
| 5. 全功能回归 | 按下表逐项验证原入口与插件入口 | 所有现有可用功能保持可用，缺失项有明确证据和阻塞原因 |
| 6. 打包交付 | 固定兼容范围、安装／配置／禁用／卸载说明，记录升级验收 | 可独立安装和撤销；禁用插件后现有 Kanban 继续可用 |

“打开独立页面”是辅助入口，不能用它代替无法嵌入的功能并声称全功能包装完成。

### 功能验收矩阵

以 [功能清单](../func_list.md) 为逐项来源；以下为分类，不代替完整条目。只对当前已有能力作回归，不把仓库中尚未完成的实验功能升级为已实现承诺。

| 功能组 | 插件入口需要验证的行为 |
| --- | --- |
| 三种模式 | 终端、会话、原生 Codex 入口、切换与状态保持 |
| 会话管理 | 项目、关注标签、分组、搜索、布局、历史、未读、跨页面状态 |
| 输入与附件 | 文字、排队、图片、拖放、剪贴板、文件上传、草稿保存与恢复 |
| 会话交互 | 流式回复、审批、提问、Goal、子 Agent、运行与完成状态 |
| 终端 | xterm 输入、复制粘贴、尺寸变化、多窗格、重连；输入只发当前目标 |
| 文件与 Git | 文件浏览、预览、编辑、上传下载、diff、review、已有 Git 操作 |
| 编辑器 | VS Code 和官方 Codex 的嵌套 iframe、Service Worker、键盘与恢复 |
| 扩展页面 | Bots、定时任务、技能／工具／MCP、用量、设置等已有入口 |
| 系统交互 | 语音、权限、全屏、通知和已有飞书功能不重复启动或重复通知 |
| 生命周期 | 切换 Harness 页面、刷新、断网恢复、禁用插件、旧入口继续使用 |
| 资源 | 多次切换前后 iframe／连接数量、JS 堆及 renderer RSS；保留现有内存边界 |

测试优先用受控夹具和只读现有服务观察；会向模型发任务、修改真实文件、发送外部通知或中断会话的验收，使用明确指定的测试目标。不得拿正在运行的用户会话试停、试发或试审批。

新增行为先建失败测试再实现，至少覆盖 URL 校验、容器挂载、重复导航、隐藏焦点及故障提示。涉及 Kanban 兼容改动，补普通入口和嵌入入口双路径回归；若影响正文可见消费者，遵守 [会话内存约定](../session-memory-contract.md)。新增功能实施后同步 `docs/func_list.md`；架构边界变化再同步 `docs/project-overview.md`，纯计划阶段不宣称功能上线。

## 4. 后续 Agent 工具能做什么

这些是拟新增的 Harness 工具，不是现有插件能力。Kanban 中有相关接口不等于已做成 Harness 工具。首批建议只读，其次派发／跟踪任务，再考虑修改状态的管理操作；按启用模块提供工具，不一次向模型暴露所有底层接口。

| 工具建议名称 | Agent 能做的事 | 实现基础与边界 |
| --- | --- | --- |
| `kanban_projects` | 查项目、项目目录与概要 | 项目接口已存在；不默认注册新目录 |
| `kanban_sessions` | 按项目、类型、运行状态列会话 | 分清终端 session、结构化 thread、原生宿主，不按同名合并 |
| `kanban_session` | 查精确会话状态、最近结果、待处理请求和队列摘要 | 状态未知如实返回；读取不 acquire／resume |
| `kanban_history` | 分页读聊天或终端摘要 | 聊天复用 `view=chat` 裁剪，终端只返回有界文本；不默认灌入完整工具正文 |
| `kanban_git_status` | 查分支、worktree、变更文件和有界 diff | 复用已有只读 Git 能力；只查已登记项目 |
| `kanban_read_file` | 读项目内指定文件片段 | 使用既有路径边界、文件类型和大小限制；与 Harness 自有文件工具去重 |
| `kanban_open` | 为用户返回精确会话／项目链接 | 有已连接 UI 时再提供显式定位动作；不假定可控制另一个浏览器的 iframe |
| `kanban_send` | 向已存在的精确会话提交任务，忙碌时按明确策略排队 | 优先接 Codex 结构化队列；Claude／ACP、原生 Codex 模式和终端输入分别验收，能力不支持则明确返回 |
| `kanban_wait` | 等待指定任务完成，返回最终回复或进度 | 使用有界等待和 Harness job／事件能力，不能后台轮询完整历史；取消等待不停止任务 |
| `kanban_create_session` | 在已登记项目中新建指定类型会话 | 用户明确需要新会话才使用；与“不新建 Kanban 服务实例”是两件事 |
| `kanban_queue` | 查询、添加、编辑或撤销指定排队项 | 保留既有 revision 和 uncertain 状态；未知发送回执不自动重发 |
| `kanban_goal` | 查询、设置或清除指定 thread 的 Goal | 复用现有 Goal 流程；设置已有线程目标不额外发送普通 turn |
| `kanban_review` | 对指定会话发起变更审查并跟踪结果 | 发起会运行 Agent；与只读 diff 区分 |
| `kanban_interrupt` | 中断指定会话的指定轮次 | 明确 thread／turn／实例，不能用“当前忙碌会话”猜目标；不提供默认批量停止 |
| `kanban_manage_session` | 重命名、归档等管理动作 | 按动作分权限；关闭显示、归档和终止进程语义分别表达 |
| `kanban_inventory` | 查模型、技能、MCP、定时任务和 Bots 概要 | 只读、脱敏；不暴露密钥，不自动改登录／安装插件 |

审批、问题回答、定时任务修改、Git 写操作和原始终端键盘输入可以后续分别评估，不放进第一批控制工具。已有 UI 的完整功能仍保留，这些限制只针对新工具自动化范围。终端任意输入相当于可执行命令，不作为结构化 `kanban_send` 的静默回退。

### 用户看到什么

Harness 左侧增加「Kanban」入口；打开后为现有完整工作台，上方只增加必要的连接状态和「独立打开」。设置中显示当前连接地址、连接说明及后续各工具模块的开关。Kanban 本身继续负责项目、终端、会话与编辑器界面，不在 Harness 再造另一套。

开启工具后，用户可以在 Harness 对话中说：

- “看看 Kanban 里这个项目哪些会话还在运行。” → 列出会话、精确身份、状态和链接。
- “读一下 A 会话最新结果，告诉我有哪些文件改动。” → 查询有界结果和 Git 摘要。
- “把这段任务发给 A 会话，忙的话排队。” → 明确目标和 busy 策略后提交，返回排队／受理状态。
- “等这次任务完成再总结。” → 跟踪本次提交；等待超时返回仍在运行，不重复派发。

有多个同名目标时返回候选，让用户指定；唯一且已明确的目标无需重复询问。工具记录可显示目标、操作、状态、结果摘要和「在 Kanban 打开」，不承诺 Harness 当前版本一定支持定制卡片；普通结构化工具结果为最低实现。

### 参数和返回设计示意

下列是插件 API 草案，不是可直接调用的现有接口。选择会话后返回一个由插件校验的 `targetRef`，绑定当前实例、项目和真实会话身份；失效后重新查询，禁止按旧名字回退到新会话。

```json
{
  "tool": "kanban_send",
  "arguments": {
    "targetRef": "<插件返回的目标引用>",
    "text": "检查登录失败原因并补回归测试",
    "busyPolicy": "enqueue",
    "requestId": "<本次提交唯一标识>"
  }
}
```

```json
{
  "status": "queued",
  "requestId": "<本次提交唯一标识>",
  "operationId": "<可查询的操作引用>",
  "target": { "project": "示例项目", "session": "登录修复" },
  "message": "任务已入队，尚未完成"
}
```

区分 `accepted`／`queued`／`running`／`completed`／`failed`／`uncertain`，绝不把受理当完成。插件本地的请求去重不等于原生跨客户端 exactly-once；无法确认时返回 uncertain，只读核对，禁止重发。请求字段和队列回执要以实际运行层版本为准，缺少能力不能隐式升级或重启运行层。

所有工具请求由 Harness 服务端发送到配置中的同一 Kanban 网关，不让模型指定任意 URL、端口或 shell 命令。目标身份不能取自某浏览器当时选中的标签。复用既有队列、裁剪、权限和实例归属；插件停用只取消自己的观察与等待。

## 5. 何时才需要改 Kanban

只有零改动验证出现明确缺口才进入兼容改动：例如嵌入状态通知、隐藏后的可见消费者／热键处理、受支持的精确会话定位、必要的权限或响应头适配。先证明现有配置和官方插件扩展点不能满足，再加默认关闭的适配入口及双路径回归。

不改业务发送规则、Agent 生命周期或原生插件包来迁就包装。跨 origin 页面是否显示与 Agent 是否运行分别处理。若无法在不破坏普通入口的条件下解决，记录具体未通过功能，不把“多数页面可用”改称全功能完成。

## 6. 交付与后续阶段

首阶段交付：独立插件包、配置示例、安装／禁用／卸载说明、功能矩阵和实际验收记录；必要的 Kanban 兼容补丁单独列明理由与默认行为。验收中保留原地址可用、现有实例／数据复用和现有任务不受干扰的证据。

后续有两条独立扩展：Agent 工具按本方案分批启用；公网／手机另行设计认证、权限、远程可达和响应式体验。当前 iframe 直连局域网地址不等于可沿用 Harness 公网入口，后续须解决路由与访问控制后再宣称远程接入。

## 7. 证据与核对范围

- 本仓库：`apps/web/src/lib/dev-server-config.ts`（根路径代理与 Host 保留）；`apps/web/src/codex-mode/native-surface.ts`（原生路径约束）；`apps/web/src/codex-mode/native-visibility.ts`（可见性）；`apps/server/src/routes/native-codex.ts`（同源检查）。
- 本仓库：`apps/server/src/routes/session-projects.ts`、`session-tabs.ts`、`session-followups.ts`；`packages/session-runtime/src/codex/routes.ts`。这些证明存在相关能力，不证明 Harness 适配完成。
- 已安装 RC.4 官方包：`dsh-client-ui-layout` 的 README 与类型声明提供 `main`、`shell.overlay`、`shell.bottom`；`dsh-client-connection` 提供认证准入契约。
- 官方文档：[UI 插槽](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/ui-slots/README.md)、[页面布局](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/ui-layout/README.md)、[Web 服务与 TLS](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/host/webserver/README.md)。master 文档可能变化，实施以已安装版本为准。
- 当前部署文档表明 Harness 已迁至用户 systemd 服务；旧 Docker Compose 不作为当前运行拓扑。只读观察确认当前监听及页面响应，未进行浏览器嵌入、认证切换或模型调用验收。
