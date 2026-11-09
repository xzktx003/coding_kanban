# ChatGPT Mac / Codex 界面静态取证（待动态验证）

- 用户提供 `third_party/ChatGPT.app`；`CFBundleIdentifier=com.openai.codex`；`CFBundleShortVersionString=26.1027.61615`；构建号 `24141`。`app.asar` SHA-256：`bb88615052255e79b5977885f9a0cc212c268589587c79d4d3b7c4b46e881a95`。主机为 Linux x86_64，未执行 Mac ARM64 程序；静态结论均不等于可达或运行行为。
- ASAR 按头部索引读取并核对被抽取文件的内置 integrity。下列偏移为成员内部 UTF-8 文件的 0-based 字节偏移；成员原始包内绝对起点见私有证据目录的 [ui-members.json](../../../.dev-runtime/chatgpt-desktop-audit-20261103-kmy767aq/ui-members.json) 或下方所列。
- 区分「一期 Codex」与「后续 ChatGPT/Work」：资源含产品共用 UI，下面只把与 Codex 工作区关联可见或明确命名的条目标成一期候选；其各自可达性、组织策略、账号、联网和平台门控均须 Mac 原版动态确认。聊天及 Work 通用独立模式进入后续，不从共享 bundle 文案反推其全部行为。

## 一期 Codex 界面清单（均为静态证据）

1. **框架与工作区**：`webview/assets/thread-app-shell-chrome-e7e38c7ea254.js`（SHA-256 `f3e0a96126e0b14e71ff0776ebb9d594741a84912957961893b9612090386165`；ASAR 绝对起点 614861993），成员内偏移 29977/30559 处的英文描述分别为在聊天旁创建内容标签和在完整视图创建内容标签；周围代码使用 `split` / `full` 布局。`workspace-layout-step-handler-9a82a5d4d275.js`（SHA `9b039e007f66a331114a6847ed61fd4e85efecb931bc755cc431aba4e1cfcc69`；ASAR 659132184），偏移 1777/3112 的命令描述涉及 full、split、chat 和 tabs 的切换。`app-primary-75d53eef2374.js` 偏移 586191 附近还存在拖放到左右/底部窗格的提示；它们首先说明内容标签与聊天工作区可分区，尚未证明任意两个独立主会话可并排展示。
2. **临时侧聊**：`webview/assets/local-conversation-side-chat-4d7fc512f796.js`（SHA `a732b0c57fb9360c1901ec9c1e27c9a8f284bdd93b244ddaf8d6deddb2960ff1`；ASAR 415089233），偏移 8015/9419 的 UI 文案包含 Side chat、关闭确认及关闭后无法恢复的说明。`local-conversation-page-50ae20551907.js`（SHA `b1293967bb28331c9b90c987c795a24f5ee9f93e1abe6a638e8b82d0bcad89d7`；ASAR 415013630）包含 New side chat、Starting side chat。须在 Mac 上确认侧聊数据生命周期及其与主会话身份的关系；不能直接拿这种临时侧聊代替用户要求保留的多主会话分屏。
3. **导航、项目和连接**：`webview/assets/app-primary-75d53eef2374.js`（SHA `ebaecd54561e7e3da76c08b0d900e056424d57b1b23675afad4d7d235599f80b`；ASAR 180851788）。偏移 1890678/1890838/1890992 为按项目、按连接、单列表；1891154/1891296/1891425 为按更新/创建/手动排序。偏移 1805495 附近自定义分区提示可组织聊天与项目；2073700、2089288 等附近有管理主机连接及活动/未读/等待统计。2271203 是远端不可用提示，2725877 是离线时先重连再新建聊天的提示。上述是代码中的文本及局部分支，需动态确认账号/功能门控、默认值和完整结果。
4. **项目和会话操作**：同一 app-primary 成员 392061 处的远程项目移除确认说明只从应用移除，不删除文件与已有聊天；374426 是运行中任务的“停止并归档”确认说明，附近另有带定时任务的区别。该区还含新聊天、重命名、置顶、未读、归档、自定义分区、项目与连接操作、加载更多、项目目录不存在、远程项目加载状态等文案。`webview/assets/app-initial-18b189e867e7.js`（SHA `244653d55e434b27618a848bef14d6d6781569bf58e8656cf644445113ffc032`）成员内偏移 7688359–7696486 附近有复制 cwd、重命名、已读/未读、分叉至新 worktree 等消息。这些不证明所有操作在当前账号默认出现；应实测行为而非按文案推断。
5. **输入及运行过程**：`webview/assets/composer-content-b926d24ef280.js`（SHA `cf56f37714e14488239f4eb715b845067e75f8c2e98851c768c4110d3eb6fd08`；ASAR 247355068），偏移 134950/135140/135961 含 queue、steer、stop；136484 有“远程项目不支持语音”的提示；346996 附近有暂停队列后发送时清理已排队消息的确认文案；121411 有 worktree 提示。其具体版本、服务和可见条件需实测，不能由单个提示断言全部运行协议。`webview/assets/local-conversation-thread-2f594f841b07.js`（SHA `af8e8ab2e97566d25d69249ef8adf5a86d0bf0bbf4c306e4fbc50c80e8837263`；ASAR 415212073）为会话正文候选代码。
6. **右侧工作区**：`webview/assets/thread-side-panel-tab-content-d2b583a29734.js`（SHA `25c015eaf9f8e76c93503deb6f26b6cac948b466c7e16f50b39664b0cca01ff7`；ASAR 615133932）含变更、查看/未查看、文件筛选、冲突、大 diff、stage/unstage/revert 等界面文案。`webview/assets/zh-CN-88ebb426d686.js` 还含浏览器、终端、摘要、侧边聊天、文件等面板名称；本地化资源仅证明文案存在，应分别确认实际容器和写操作语义。
7. **产品边界**：`app-primary` 约 2030585 附近包含产品模式选择器的 Codex 条目和“Build, debug, and ship”说明；其周边还存在 ChatGPT / Work 条目。新版看板的第四模式一期应以 Codex 实际可达界面为目标，不能把同一包中的 ChatGPT/Work 专用能力误列成 Codex 已实现能力。

## 可复查的 UI 样式依据

`webview/index.html` 静态引用 `webview/assets/fd9b7fd80db1.css`（SHA `8cceab6badac2458d888405f0d0cbdd1b40bfefb2ba33eb74f577b4158c9d3b3`；ASAR 326343338）。成员内偏移 141551 定义默认 sans 字体栈，144203/144403 定义 toolbar 46px 和侧栏宽度 clamp(240px, preferred 275px, max 520px 且受视口限制)；1355059 附近有 electron 13px/12px 文字及 430 权重；1361430 有对话条目 16px / 分组内条目 4px 的间距变量。CSS 同时包含 OpenAI Sans 的 400/500/600 字体定义以及 KaTeX 字体；特定组件和平台可能覆盖这些值。必须取得 Mac 实际屏幕、缩放、字体、CSS 计算值和深/浅主题截图，不能把静态默认变量直接当最终像素结果。

用户提供的唯一原版截图为 3446×2012 像素，展示浅色首页、Codex 视图、侧栏项目与一台远程主机、空态和输入区；其 scale factor、实际组件点击行为、当前账号可见项和隐含运行状态未知。截图右上角加号是待确认状态，静态代码能证实“聊天旁内容标签”路径，但仅凭截图不能证明当前展示按钮确切调用的分支。

## 下一步 UI 动态验收建议

固定原版 build、平台和目标机器；获得独立或受控的 Mac 原版状态，逐项记录单会话、聊天旁内容分栏、临时侧聊、项目/连接/列表三个侧栏视图、主机离线/重连、编辑/归档/定时任务的确认和失败、输入框排队/引导/权限、文件/变更/终端/浏览器、深浅主题、键盘和无障碍。分别记录可见入口、禁用条件、用户手势、状态变化和截图。对新的多主会话分屏增加发送目标唯一性与独立草稿恢复验收，按用户选择保留公共输入框；其与原版内容标签布局的融合必须经用户评审。
