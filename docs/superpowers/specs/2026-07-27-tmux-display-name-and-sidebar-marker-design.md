# tmux 真实标题与右侧小卡标记设计

## 背景

当前项目在部分 tmux 发现和扫描入口中，把连接方式、pane 当前命令或远程位置直接拼进 `displayName`：

- `tmux:dev`
- `tmux:dev (bash)`
- `tmux:dev/bash (远程: repo)`

这些字符串不是 tmux 的真实会话名。真实名称已经保存在
`transportRef.tmuxSession`，连接类型也可以由该字段可靠判断。把这些信息再次拼进
标题，会让卡片名称变长，并混淆“会话名称”和“连接元数据”。

宫格卡片已经在底部元数据区显示低调的 `tmux` 标签，但聚焦视图右侧的小卡片没有
对应标记。用户希望标题保持真实名称，同时在右侧小卡中通过不显眼的独立标签识别
tmux 会话。

## 目标

1. 新建、发现、扫描和连接 tmux 时，标题严格使用真实 tmux 会话名。
2. 不再把 `tmux:`、pane 当前命令或远程位置拼进标题。
3. 已有系统生成的旧标题在服务加载时恢复为真实 tmux 会话名。
4. 宫格卡片继续使用现有 `tmux` 元数据标签。
5. 聚焦视图右侧小卡在标题后显示低对比度 `tmux` 文字标签。
6. 保留现有内部 tmux 标识，避免影响去重、恢复、连接和终端控制。

## 非目标

- 不改变 tmux session、window 或 pane 的真实名称。
- 不改变用户主动执行的 tmux 重命名流程。
- 不新增 API 字段、WebSocket 事件或持久化字段。
- 不把右侧小卡改成新的布局或增加底部元数据栏。
- 不修改大屏窗格编号、黄色活动关联、状态徽标或点击语义。

## 方案选择

### 采用：后端规范标题，前端使用现有结构化元数据

后端在产生或恢复 tmux 会话记录时，把 `displayName` 规范为真实
`tmuxSession`。前端不再解析标题，而是通过
`Boolean(session.transportRef?.tmuxSession)` 判断是否显示 `tmux` 标签。

该方案让 API、持久化状态和所有页面共享同一个标题语义，同时复用已有数据模型。

### 不采用：仅在前端隐藏前缀

仅在 React 组件中处理字符串，会让 API、持久化状态、排序、通知和其他消费者继续
看到拼接标题。服务重启或增加新入口后还可能再次出现。

### 不采用：新增 `transportType`

`transportRef.tmuxSession` 已经是可靠的 tmux 判据。新增字段会产生重复状态和同步
风险。

## 标题契约

### 新记录

所有 tmux 入口都遵循同一规则：

```text
displayName = tmuxSession
```

示例：

| tmux 会话名 | pane 命令 | 主机 | 标题 |
| --- | --- | --- | --- |
| `dev` | `bash` | 本地 | `dev` |
| `coding_kanban` | `codex` | 本地 | `coding_kanban` |
| `train-01` | `python` | SSH | `train-01` |

pane 命令继续由 `agentKind` 表达，主机、目录和状态继续由现有
`hostId`、`sshTarget`、`workingDirectory`、`interactionState` 等字段表达。

### 旧记录迁移

服务加载持久化记录时，仅迁移可以证明是历史系统格式的 tmux 标题。记录必须包含
非空的 `transportRef.tmuxSession`，并满足下列一种格式：

```text
tmux:<tmuxSession>
tmux:<tmuxSession> (<command>)
tmux:<tmuxSession>/<command> (远程: <location>)
```

匹配后统一写成：

```text
displayName = transportRef.tmuxSession
```

不匹配上述格式的标题保持原样，避免误改未知来源或用户自定义记录。迁移只修改
`displayName`，不修改 tmux 本身。

### 内部标识

以下值继续保留 `tmux:` 命名空间：

- `transportRef.runtimeId`
- 发现结果的 preview ID
- 本地和远程会话去重键

例如 `runtimeId = tmux:dev` 或 `tmux:<host>:dev`。这些值不属于用户可见标题。

## 后端数据流

### 专用 tmux 发现

`LocalTmuxAdapter.discover()` 和 `discoverRemote()` 返回的
`AgentSessionRecord.displayName` 使用 `sessionInfo.sessionName`。状态预览可以继续显示
会话名、pane 命令和连接状态，但不再额外添加 `tmux:` 前缀。

### 目录和 Agent 扫描

`agent-scanner` 的本地和远程 tmux 扫描结果使用真实 `session` 作为
`ScanResult.displayName`。当前命令仍写入 `agentKind`，目录和 SSH 信息继续使用已有
结构化字段。

### 加入看板

`/api/agent-discovery/tmux/add` 使用请求中的 `tmuxSession` 作为新记录标题，避免旧版
客户端或陈旧扫描结果重新写入拼接标题。运行中 attach 和 detached observe 两条路径
遵循相同规则。

### 持久化恢复

持久化记录进入 registry 前执行一次旧标题规范化。规范化函数保持纯函数，输入
`displayName` 和 `tmuxSession`，输出规范标题，方便覆盖边界测试。加载后的正常保存
会自然写回规范后的标题。

## 前端设计

### 宫格卡片

保持现有行为：当 `transportRef.tmuxSession` 存在时，在底部元数据区显示
`tmux` 标签。标题直接渲染 `session.displayName`。

### 聚焦视图右侧小卡

采用视觉方案 A：

- 标题仍直接渲染 `session.displayName`。
- 当 `transportRef.tmuxSession` 存在时，在标题后显示小写 `tmux` 标签。
- 标签使用低对比度文字、细边框和透明背景。
- 标签不参与标题文本，不影响重命名值或搜索值。
- 长标题继续省略；标签保持可见但不挤压窗格序号和状态徽标。
- 标签提供 `title="tmux 会话"` 和可访问名称。

右侧卡片原有顺序保持：

```text
[窗格序号] [真实标题] [tmux] ... [状态]
```

未进入大屏的 tmux 卡片没有窗格序号，但仍显示 `tmux` 标签。非 tmux 卡片不显示该
标签。

## 兼容和错误边界

- 本地与 SSH tmux 使用相同标题规则。
- running、detached、idle 和 exited 状态不影响标签判断。
- 标签判断只依赖结构化 transport 数据，不解析 `displayName`。
- 未知旧格式不自动改名，避免破坏用户数据。
- 标题规范化失败不应阻断服务启动；纯函数对空值和非匹配值原样返回。
- 不改变接口结构，因此现有客户端保持兼容。

## 红绿灯测试

### 后端单元和路由测试

1. 先写失败测试，证明本地专用发现仍返回 `tmux:dev`，期望改为 `dev`。
2. 先写失败测试，证明远程专用发现仍返回 `tmux:dev`，期望改为 `dev`。
3. 覆盖本地和远程 `agent-scanner` 的 tmux 标题只使用 session 名。
4. 覆盖加入看板路由忽略陈旧拼接标题，以 `tmuxSession` 注册 running 和 detached
   记录。
5. 覆盖旧格式迁移的三种历史格式。
6. 覆盖非 tmux、自定义标题和内部 `runtimeId` 不被修改。

### 前端组件测试

1. tmux 右侧小卡显示真实标题和一个低调 `tmux` 标签。
2. 非 tmux 右侧小卡不显示该标签。
3. `tmux` 标签与监控窗格序号、活动黄色关联和状态徽标同时存在。

### 端到端测试

通过 tmux 发现接口加入一个会话，验证：

1. 宫格和右侧小卡标题都是原始 session 名。
2. 宫格现有标签仍存在。
3. 右侧小卡出现 `tmux` 标签。
4. 大屏编号和黄色关联保持正常。

### 最小验收

- 运行与改动直接相关的后端和前端测试。
- 运行 `pnpm check`，同时验证 shared、server 和 web。
- 在绑定 `0.0.0.0` 的局域网地址完成一次页面验证。
- 执行 `git diff --check` 和 `.env` 忽略规则检查。

## 文档维护

实现完成时同步更新：

- `docs/func_list.md`
- `docs/project-overview.md`
- `docs/debug_list.md`
- `memories/repo/debug_list.md`

