# 项目、主机、执行位置与工作区对照

2026-11-03 静态对照。原版证据均来自 SHA-256 为 `bb88615052255e79b5977885f9a0cc212c268589587c79d4d3b7c4b46e881a95` 的 ASAR；成员已经按包内声明校验。原版代码中的可见文案或静态分支不等于当前账号可达，也不证明网络连接或真实任务成功。现有会话模式源码在并发工作树上读取，不等于新第四模式已具备这些能力。

| 领域 | 指定版 Mac 原包静态观察 | 当前会话／终端源码中的候选能力 | 差距和待验 |
| --- | --- | --- | --- |
| 产品壳 | `app-primary-75d53eef2374.js` 包含 Codex、ChatGPT 与 Work 选择的共同资源 | `apps/web/src/lib/workbench-mode.ts` 和 `components/WorkbenchShell.tsx` 固定三种模式 | 新模式需独立加载并保留四模式顶栏；不同产品的路由和状态隔离需设计。长期 ChatGPT/Work 不是首期功能 |
| 项目组织 | 同一 `app-primary` 成员内偏移 1,890,678 / 1,890,838 / 1,890,992 记录按项目、按连接和单列表选项；1,891,154 / 1,891,296 / 1,891,425 记录更新时间、创建时间和手动顺序候选 | `apps/web/src/session-mode/components/layout/SideBarProjectList.tsx:40` 按项目渲染；`SideBarAgentPane.tsx:42` 有创建/更新时间排序 | 不能把两种按时间排序等同为原版全部分组、手动排序和状态；交互及默认值须在 Mac 上核对 |
| 项目与历史 | `app-primary` 成员包含项目树、聊天及项目移除确认等候选 | `SideBarProjectList.tsx:66` 和 `SideBarTab.tsx:25` 提供项目与 Codex 会话列表 | 新项目列表按用户后续决定独立；不能因旧模式已有项目树就视为新模式已实现或要求两边共享列表 |
| 主机/项目身份 | `project-repositories-a59394238488.js` 偏移 465 / 581 / 640 分别可见远程项目记录、`hostId` 和 `remotePath` 的静态处理 | `apps/web/src/session-mode/stores/useWorkspaceStore.ts:28` 使用路径字符串；`apps/server/src/routes/session-mode.ts:547` 的现有项目 API 对绝对路径去重 | 同路径不同主机不能合并；新模式须单独建立项目、主机和真实运行域身份。此为基于源码的设计推论 |
| SSH 连接配置 | `remote-connection-editor-draft-905bc915fa20.js` 含受管 `hostId`、SSH alias/hostname、端口和身份文件字段及验证；单文件 REA Evidence `ev_ca51df2b28aec65fd315d48b2b2a2aa26c7be2c34fecb7d293991482d4a2d489` | `apps/server/src/routes/ssh-hosts.ts:8` 从部署服务器读取 SSH 配置；`apps/server/src/services/ssh-command.ts:36` 对连接参数做约束 | 用户已选择由看板服务器发起；它读取服务器侧配置，不是访问者 Mac 的本机配置。是否复用及全链路认证待验证 |
| 远端项目目录 | `create-project-dialog-5d973a8dd7a1.js` 含选定 `hostId`、远端目录校验、映射冲突及创建目录确认分支；`remote-cwd-picker-2f71a83ff7a7.js` 含按 host/目录查询 | `apps/server/src/routes/filesystem.ts:148` 与 `services/sftp-service.ts` 有 SFTP 目录和文件操作 | 现有 SFTP 是候选底座，未证明与远端项目身份、CLI 账号和线程 owner 一致；不能把浏览器提供的任意目标直接等同于受信任主机 |
| 远端认证 | `remote-connection-auth-dialog-5d6fafd4ab4f.js` 包含登录及 API Key 相关提示／操作分支 | 旧会话模式有本地账号和授权能力；SSH 终端有服务器端认证配置 | 远端 CLI 账号可能与看板部署机不同；登录来源、失效和授权范围须按主机分别实测，不能自动复制账户或推断授权 |
| 离线/重连 | `app-primary` 成员偏移 2,271,203、2,725,877 附近包含远端不可用及重连后再新建的提示 | `apps/web/src/session-mode/components/layout/SessionSyncIndicator.tsx` 对现有实时链路提供状态 | 通用 SSE 重连不等于多主机 SSH 项目重连；还需验证任务继续、待审批、队列和未知回执 |
| 真实线程/队列 | `app-initial-18b189e867e7.js` 含队列 `list/add/update/reorder` 和变更通知处理 | `docs/designs/session-mode-implementation-20261029/shared-management.md:7` 规定官方队列为唯一调度权威；共享 daemon 契约在 `official-daemon.md` | 用户要求新模式共享同一主机/账号的真实线程与任务；必须核对 host/account/instance/thread 及请求身份，避免重复发送或隐式接管 |
| 多会话分屏 | `thread-app-shell-chrome-e7e38c7ea254.js` 和 `workspace-layout-step-handler-9a82a5d4d275.js` 有 Chat 与内容标签的 full/split 布局；另有侧聊组件 | `docs/session-tabs.md:5` 描述现有关注会话与公共输入；隔离假数据浏览器观察到两个窗格和一个输入框 | 内容标签分栏、临时侧聊及看板多主会话自由分屏不是已证明等价；新模式须单独满足用户确认的分屏和输入目标 |
| 云任务与环境 | `cloud-environment-editor-8052c3f6abcc.js` 有仓库、脚本、变量/密钥和网络策略界面候选；`app-initial` 有任务与环境请求分支 | `apps/server/src/services/codex-cloud.ts:47` 有旧 VSIX 云协议适配；`CloudTasksPanel.tsx` 未在本次有界搜索中发现生产引用 | 首期纳入云能力；不得把旧适配器或孤立面板当新版云环境已完成。真实 API、账号、策略和回执需验证 |
| 设备远程控制 | `remote-connections-settings-4dd0ca54883c.js` 静态区分控制其他设备、控制当前 Mac、SSH 和 WSL | `apps/web/src/session-mode/components/settings/RemoteAccessSettings.tsx` 有 LAN 和旧配对相关分支 | SSH、LAN 网页访问与官方设备发现/授权/relay 是不同能力，按原版实际可达范围分别审计 |
| 文件、终端与浏览器 | 原包有聊天旁内容标签、终端、浏览器与 Diff 界面候选 | 旧模式有 `RightPanelHeader.tsx` 工具入口，终端模式有 SSH/SFTP；`WebPreview.tsx` 使用 iframe | 原生内置浏览器、扩展、站点工具与网页 iframe 不能直接等同；文件、Git 和终端均须绑定实际执行域 |

## 定位约定与复核

本文件中的成员名均位于 `webview/assets/`，偏移是成员内零基 UTF-8 字节偏移。各成员 SHA-256 和 ASAR 绝对偏移保存在本地私有证据目录的 `remote-cloud-members.json`、`ui-members.json` 及 `asar-inventory.csv.gz`。会话模式其他 54 条候选的逐项源码对照见 [1–27](session-comparison-01-27.md) 与 [28–54](session-comparison-28-54.md)。
