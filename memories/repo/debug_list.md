- 2026-10-12：当前会话菜单补上插件尾部命令。任务、技能、项目列表、侧栏和反馈走现有页面。技能强制刷新、置顶摘要和应用内浏览器没有本机能力，只提示。退出登录只打开设置页。

- 2026-10-12（功能页菜单的布局测试夹具）：功能页新增会话菜单后，旧布局用例完整替换 session-dom 模块，缺少菜单使用的可见性与 Portal 导出，导致 3 项挂载／草稿保护测试失败。改为保留真实模块导出的局部 mock，原挂载次数、返回路径与草稿断言保持；整套测试捕获红灯后复测该文件。

- 2026-10-12（远程合并的文件引用兼容）：合并原生引用的 VS Code 打开动作与远程软链接解析时，保留共享解析及过期点击保护，只有成功打开真实文件后才向所属项目的编辑器宿主传递解析路径；资源「打开方式」也复用解析入口。保留双方菜单与文档记录，新增原路径／软链接目标／拒绝解析及迟到回执回归，先复现编辑器打开动作丢失再修复。

- 2026-10-12：当前会话菜单新增「管理已安排任务」和「前往技能」。它们分别打开现有定时任务页和工具与技能页，不另做管理器。

- 2026-10-12：当前会话菜单新增「显示键盘快捷键」和「全部标为已读」。前者打开只读快捷键清单。后者只清已关注 Codex 聊天的未读回复，不处理已安排任务，也不占用 Shift+Esc。

- 2026-10-12：当前会话菜单新增「键盘快捷方式」。它列出本机已接入的组合键，可搜索，但不能改写或保存。重置时提示「无法保存快捷键偏好设置」。

- 2026-10-12：当前会话菜单新增「从其他 AI 应用导入」。本机没有外部编程智能体配置扫描，所以提示「未找到兼容的导入项」。插件会检查 Claude Code、Claude Cowork 和 Cursor 并复制兼容配置。

- 2026-10-11：当前会话菜单新增「个性」。菜单和 Ctrl 或 Cmd 加 Shift 加 I 打开已有的个性面板。插件还有更多语气，这里只有「亲和友善」和「务实」。

- 2026-10-11：当前会话菜单新增「MCP」。它打开已有的 MCP 状态面板。插件说明是「配置 MCP 服务器」，这里只显示状态，不能在这个面板里改服务器配置。

- 2026-10-11：当前会话菜单新增「设置」。它打开带 `mode=session` 和 `view=settings` 的当前地址，进入现有会话设置页。插件快捷键是 Ctrl 或 Cmd 加逗号，这里没有这个快捷键。

- 2026-10-11：当前会话菜单新增「切换到 Codex」。已经在会话聊天页时提示「当前已是 Codex 会话」。从其他页面打开时切回 `mode=session` 和 `view=agent`。插件快捷键是 macOS 的 Ctrl 加 3 或其他系统的 Alt 加 3，这里没有这个快捷键。

- 2026-10-11：当前会话菜单新增「切换到工作」。点击后提示「本机没有 ChatGPT 工作模式」，不切换会话，也不启动云端任务。插件只在 Electron 里进入 ChatGPT Work。

- 2026-10-11：当前会话菜单新增「切换到聊天」。它打开带 `mode=session` 和 `view=agent` 的当前地址，回到聊天页。插件在 Electron 里切回 ChatGPT 聊天，这里没有 Ctrl 加 1 或 Alt 加 1，也不进入 ChatGPT Work。

- 2026-10-11：当前会话菜单新增「转到最近聊天 2」到「6」，以及「聚焦第 1 个标签页」到「第 9 个」。最近聊天按本机查看顺序打开。聚焦按关注标签栏位置切换。插件的最近聊天按最近更新排序，聚焦标签只在 Electron 里提供，这里都没有对应快捷键。

- 2026-10-11：当前会话菜单新增「转到最近聊天 1」。它打开本机最近查看的第一条关注会话。还没有查看记录时提示「最近聊天 1 还没有会话」。插件按最近更新排序，快捷键是 Ctrl 或 Cmd 加 Alt 加 1，这里按查看顺序，也没有这个快捷键。

- 2026-10-11：当前会话菜单新增「下一个最近查看的聊天」。它切到本机上一次查看的关注会话。没有更早的查看记录时提示「没有最近查看的聊天」。插件只在 Electron 里用 Ctrl 加 Tab 触发，这里没有这个快捷键。

- 2026-10-11：当前会话菜单新增「下一个聊天」。它按关注标签顺序切到当前会话的后一个。已经是最后一个标签时提示「没有下一个聊天」。插件快捷键是 Ctrl 或 Cmd 加 Shift 加 ]，这里没有这个快捷键。

- 2026-10-11：当前会话菜单新增「上一个聊天」。它按关注标签顺序切到当前会话的前一个。已经是第一个标签时提示「没有上一个聊天」。插件快捷键是 Ctrl 或 Cmd 加 Shift 加 [，这里没有这个快捷键。

- 2026-10-11：当前会话菜单新增「下一个需关注的聊天」。它按关注标签顺序，切换到当前会话之后下一个有未读回复或等待输入的聊天。没有这样的聊天时提示「没有需关注的聊天」。插件快捷键是 Ctrl 或 Cmd 加 Alt 加 A，这里没有这个快捷键。

- 2026-10-11：当前会话菜单新增「打开您的 Dot」。点击后提示「本机没有与 Dot 的对话」，不切换会话，也不启动 Agent。插件只在 Electron 里用 Ctrl 或 Cmd 加 . 打开与 Dot 的个人对话。

- 2026-10-11：当前会话菜单新增「核对清单」。展开编辑里，菜单或 Ctrl 或 Cmd 加 Alt 加 6 在普通文字和 `- [ ]` 之间切换。没有展开编辑时提示「当前没有打开的页面编辑器」。结果是 Markdown 核对清单，不是共享页面富文本。

- 2026-10-11：当前会话菜单新增「项目符号列表」。展开编辑里，菜单或 Ctrl 或 Cmd 加 Alt 加 5，以及 Ctrl 或 Cmd 加 Shift 加 8，把选中文字或当前行设成项目符号。没有展开编辑时提示「当前没有打开的页面编辑器」。结果是 Markdown 的 `- ` 前缀，不是共享页面富文本。

- 2026-10-11：当前会话菜单新增「编号列表」。展开编辑里，菜单或 Ctrl 或 Cmd 加 Alt 加 4，以及 Ctrl 或 Cmd 加 Shift 加 9，把选中文字或当前行设成编号列表。没有展开编辑时提示「当前没有打开的页面编辑器」。结果是 Markdown 编号，不是共享页面富文本。

- 2026-10-11：当前会话菜单新增「将焦点移至内容控件」。展开编辑打开且焦点在正文时，菜单或 Shift+F10 把焦点移到「纯文本模式」。没有展开编辑时提示「当前没有打开的页面编辑器」。插件焦点来自共享页面编辑器。

- 2026-10-11：当前会话菜单新增「复制页面链接」。它复制当前页面地址，成功提示「已复制页面链接」。插件复制共享页面链接，Electron 快捷键是 Ctrl 或 Cmd 加 L。本地没有共享页面，也没有这个快捷键。

- 2026-10-11：当前会话菜单新增「工件：便签」。草图画布打开时，菜单或快捷键 N 切到便签，点画布后放上带编号的便签。按钮无障碍名仍是「批注」。没有画布时提示「当前没有打开的工件画布」。

- 2026-10-11：当前会话菜单新增「工件：文本」。草图画布打开时，菜单或快捷键 T 切到文本，点画布后写入文字。没有画布时提示「当前没有打开的工件画布」。本地没有幻灯片和电子表格。

- 2026-10-11：当前会话菜单新增「工件：直线」。草图画布打开时，菜单或快捷键 L 画出没有箭头的线段。没有画布时提示「当前没有打开的工件画布」。本地没有幻灯片和电子表格。

- 2026-10-11：当前会话菜单新增「工件：箭头」。草图画布打开时，菜单或快捷键 A 画出箭头。选择工具改回快捷键 V。没有画布时提示「当前没有打开的工件画布」。本地没有幻灯片和电子表格。

- 2026-10-11：当前会话菜单新增「工件：圆形」。草图画布打开时，菜单或快捷键 O 切到圆形，拖动后画出椭圆。没有画布时提示「当前没有打开的工件画布」。本地没有幻灯片和电子表格。

- 2026-10-11：当前会话菜单新增「工件：矩形」。草图画布打开时，菜单或快捷键 R 切到矩形，拖动后画出矩形。没有画布时提示「当前没有打开的工件画布」。本地没有幻灯片和电子表格。

- 2026-10-11：当前会话菜单新增「画布：询问 ChatGPT」。草图画布打开时，`/` 或 `Shift+?` 在最近指针处打开提示，提交后追加到当前输入。没有画布时提示「当前没有打开的工件画布」。本地没有插件的画布、幻灯片和电子表格。

- 2026-10-11：当前会话菜单新增「工件：选择」和「工件：平移」。草图画布打开时切到箭头和移动；没有画布时提示「当前没有打开的工件画布」。快捷键 V、H 只在画布打开且焦点不在输入框时生效。本地没有可拖动的工件元素。

- 2026-10-11：当前会话菜单新增「聚焦侧边聊天」。侧边聊天已经打开时，焦点移到「侧边聊天输入」。没有打开时提示「当前没有打开的侧边聊天」，不会新开一条。插件命令只在 Electron 里，本地没有快捷键。

- 2026-10-11：当前会话菜单新增「聚焦主聊天输入框」。Shift+Escape 也会把焦点移到当前输入框。

- 2026-10-11：当前会话菜单新增「切换活动视图」，开关现有项目列表侧栏。

- 2026-10-11：当前会话菜单新增「切换聊天…」，搜索已关注的 Codex 会话并切换过去。

- 2026-10-11：当前会话菜单新增「分叉聊天」，为当前聊天创建一条新会话并切换过去。

- 2026-10-11：当前会话菜单新增「切换 Git 追溯信息」，显示当前打开文件所在行的作者、日期和提交。

- 2026-10-11：当前会话菜单新增「在 GitHub 上打开 PR」。没有绑定编号时打开当前分支的拉取请求。

- 2026-10-11：当前会话菜单新增「合并 PR」，打开当前分支在 GitHub 上的未合并拉取请求。

- 2026-10-11：当前会话菜单新增「创建分支」，在当前会话工作目录创建并检出新分支。

- 2026-10-11：当前会话菜单新增「创建 PR」和「创建草稿 PR」，打开当前分支的 GitHub 比较页。

- 2026-10-11：当前会话菜单「提交或推送」先列出提交和推送到远程仓库。没有工作目录时不打开面板。

- 2026-10-11：当前会话菜单新增「在主机间循环切换」。没有远程计算机时提示新任务仍使用本机。

- 2026-10-11：当前会话菜单可提高、降低或循环当前模型目录里的推理强度。

- 2026-10-11：当前会话菜单新增「切换本地/工作树」，切换新任务的本地目录和独立工作树。

- 2026-10-11：当前会话菜单新增「切换规划模式」，切换当前会话现有的计划模式。

- 2026-10-11：当前会话菜单新增「循环切换速度」，按目录里的标准、快速、超快循环。

- 2026-10-11：当前会话菜单新增「在后台发送消息」，点击现有发送按钮提交当前输入。

- 2026-10-11：当前会话菜单新增「添加照片」，打开现有图片选择。

- 2026-10-11：当前会话菜单新增「会议：记笔记」，笔记追加到当前输入，不启动 Codex Meetings。

- 2026-10-11：当前会话菜单新增「切换语音聊天麦克风」和「结束语音聊天」，听写进行中时停止现有听写。

- 2026-10-11：当前会话菜单新增「切换语音聊天」，点击现有听写按钮开始或停止。

- 2026-10-11：当前会话菜单新增「打开项目选择器」，展开现有项目列表。

- 2026-10-11：模型列表新增「打开最近使用的模型」，列出本次页面选过的模型、推理强度和速度。

- 2026-10-11：当前会话菜单新增「重新打开已关闭的标签页」，恢复最近一次关掉的关注标签，不停止 Agent。

- 2026-10-11：切换个性后，输入框内部上方显示「已切换至{个性}个性」，存在该会话本地设置里，不进协议事件。

- 2026-10-11：关闭侧边聊天的确认现在会移出关注列表并删除这条侧边会话；取消不删除。

- 2026-10-11：当前会话菜单新增「撤销上一步操作」和「重做上一步操作」，覆盖最近一次置顶、变更面板或打开终端。

- 2026-10-11：当前会话菜单新增「打开终端」，打开右侧现有终端页；没有终端时先建一个。

- 2026-10-11：当前会话菜单新增「显示/隐藏“变更”面板」，打开或收起右侧现有变更页。

- 2026-10-11：当前会话菜单新增「置顶/取消置顶聊天」，切换现有置顶列表，不改原生 isPinned。

- 2026-10-11：当前会话菜单的正文搜索改名为「查找」，仍打开当前聊天的正文搜索条。

- 2026-10-11：当前会话菜单新增「删除聊天」。确认后走原来的删除请求，取消不删除。

- 2026-10-11：当前会话菜单新增「归档聊天」。确认后走原来的归档请求，移出关注列表，不停止 Agent。

- 2026-10-11：当前会话菜单新增「重命名聊天」，打开现有重命名表单，保存仍走原来的重命名请求。

- 2026-10-11：当前会话菜单新增「搜索文件」，搜索该会话工作目录，点结果在文件视图打开。

- 2026-10-11：当前会话菜单新增「复制对话路径」，复制该会话记录上的磁盘路径，不用工作目录代替。

- 2026-10-11：当前会话菜单新增「清除提示」，只清空当前会话输入文字，附件和其他草稿保留。

- 2026-10-11：当前会话菜单新增「标记为未读」，只重新打开该会话最近一条已读回复。

- 2026-10-11：编辑器行号框改为「转到行」。回车仍按输入的行号跳转。

- 2026-10-11：当前会话菜单新增「复制为 Markdown」和「复制深层链接」。前者复制已载入对话，后者复制带会话编号的地址。

- 2026-10-11：当前会话菜单新增「复制工作目录」，复制该会话自己的 cwd。

- 2026-10-11：当前会话菜单新增「复制最后一个代码块」，复制最近助手回复里最后一个围栏正文。

- 2026-10-11：中断当前回复后，队列提示改为「由于你中断了当前响应，队列已暂停」。手动暂停和失败提示不变。

- 2026-10-11：MCP 工具批准标题改为「是否允许 {连接器} 运行 {工具} 工具？」。高风险显示「较高风险」，按钮是「允许一次」和「取消」。没有连接器徽标目录。

- 2026-10-11：资源链接补上「打开方式」。网站可在默认浏览器打开或复制链接；本地文件在文件视图中显示。没有 Codex 浏览器和本机应用列表。

- 2026-10-11：工作区不干净时禁用「创建并检出新分支…」，提示「提交更改以创建并检出新分支」。

- 2026-10-11：脏工作区切换分支列出每个文件的增减数和冲突文件，确认后先提交再检出。创建入口是「创建并检出新分支…」。

- 2026-10-11：模型目录有替换项时，输入区显示即将停用横幅，可立即切换或关闭。

- 2026-10-11：浏览器听写失败只弹英文 toast。拒绝麦克风时显示插件文案，可关闭或重试听写。

- 2026-10-11：`/personality` 提供「亲和友善」和「务实」，写入当前会话并随后续发送交给 Codex。

- 2026-10-11：`/` 菜单补上归档、重命名、分支、目标、MCP、用量、置顶、IDE 上下文、反馈，以及同一弹层里的「技能」分组。技能插入与 `$` 相同。

- 2026-10-11：输入 `/` 的命令菜单用自有标题，没有插件「斜杠命令」文案，也没有 `/status`。菜单改用插件目录的命令名和说明；`/status` 打开聊天 ID、上下文用量和速率限制。

- 2026-10-11：会话链接的历史晚于用户换会话才返回时，轮次被回收清掉。轮次留在该线程记录上，并用 retainedThreadId 阻止回收清掉它；关注和当前输入不变。

- 2026-10-11：完成轮次的计划正文被折进「用时」，打开计划窗口的按钮保持禁用。完成的 `item/completed` plan 留在对话里；流式 plan delta 仍折叠。

- 2026-10-11：侧栏分页失败只有「更多会话加载失败」文字。补上「重试」，再次拉下一页；首屏失败的重试不变。

- 2026-10-11：子任务摘要没有挂进 Codex 对话，页面没有「查看子任务」。摘要接到输入区上沿；点击在对话右侧打开进行中/已完成列表，同一按钮收起。不恢复工具标签，不停止 Agent。

- 2026-10-10：Codex 输入栏底栏堆了 @、展开、队列和会话菜单，身份行盖住正文；文件改动是大卡片；右侧有独立子任务面板。底栏改为加号、权限、模型、听写、发送/停止；有真实 diff 时改为一行摘要；右侧子任务面板移除。

- 2026-10-10：长聊天 E2E 清空关注 cards 但只设置输入目标，新 solo 正文显示欢迎页。显式激活合法关注卡片后，三种 Agent × 四视口原几何／最新消息／零错误全部通过；只改轮次仍失败的负证据保留。

- 2026-10-10：自动审批 E2E 旧菜单定位和缺少权威 native capability 导致失败。保留初始禁用断言，经真实 SSE thread/settings/updated hydration 开放选项，再核对队列及 turn 的 reviewer／sandbox／禁网络参数；不直接 setStore 伪造能力。

- 2026-10-10：手机终端用例启动新会话后没有选中本轮目标，读到旧 shell 输出。显式使用真实 session picker 定位唯一名称，并核对 stdin 的本轮 session ID 与命令；原 raw／清空断言及 15 项回归通过。

- 2026-10-10：旧浏览器测试的品牌、侧栏初态、终端按钮和分组标签选择器落后于合并顶栏；改为精确入口、显式初态及独立名称／容量断言，保留 PTY 和交互要求。热更新测试改读活动页面 storage，并等待浏览器收到目标版本；隔离红绿覆盖原恢复和终端输入行为。

- 2026-10-10：前端适配器路由门禁仍读旧 Rust，TS 迁移后误报缺路由。AST 提取方法／路径后，在隔离 Node 中从当前 TS 源创建 Fastify 并验证 hasRoute；不监听、不执行 CLI，错误方法及伪端点仍拒绝。

- 2026-10-10：严格滚动用例把人工正文增长放在初始 RO 交付微任务中，同周期改变祖先高度，纯 DOM 亦复现 loop error。注入前等待独立 RAF，保留增长后 RO／绘制前及零错误全部原断言；三次定向与整文件七项转绿，不改产品或门槛。

- 2026-10-10：ACP stdout EOF 先于进程 exit 时，RPC 的一次失败通知使连接注销延迟到 stdio close。独立监听 exit/close 并去重，保留 EOF 后活进程显式 stop 权限；真实子进程先红后绿，退出边界立即释放连接，不影响其他连接。

- 2026-10-10：TS 迁移合并后的 watcher 遗漏 runtime manifest 与依赖预检；监听及安装指纹现包含该包，默认启用模式安装前后校验依赖，关闭或自定义运行文件按配置跳过。失败保留旧网关，隔离红绿确认独立 runtime PID 不被停止。

- 2026-10-10：在线 fast-forward 后 `tsx watch` 可能早于依赖安装重启，因缺少新依赖导致后端退出。独立 finalizer 等待确认的目标 HEAD，执行 frozen lockfile 安装后安全重启；冲突时取消 finalizer。

- 2026-10-10：手机把 tmux PTY 收窄后，电脑端即使还开着也不会再发 resize，所以桌面一直是手机列宽。服务端按 WebSocket 连接记住尺寸，手机断开后恢复到仍在线客户端里最宽的那组。最后一条连接断开时不主动改 PTY。

- 2026-10-10：手机「发送」在 Playwright 里写到了错误后端。`apps/server/src/index.ts` 的 dotenv 默认覆盖进程环境，把测试传入的 `SERVER_PORT` 盖回 `.env`。改为 `override: false`，并让 Vite 的 `WEB_BACKEND_PORT` 跟随同一个测试端口。软键盘可视高度 400px 时，输入框和「发送」必须留在可视区域内，终端面至少 96px。终端手势会拦住按钮 click，「发送」改为在 pointerdown 写入当前会话。

- 2026-10-10：手机变更浮层在 390px 宽把统一 Diff 行切在词中间，横向滚动藏着，关闭按钮被底栏盖住。根因是共享 `.diff-row` 的 360px 最小列和 `white-space: pre`，加上浮层 z-index 低于主导航。只在 `.mobile-changes-overlay` 里换行；还原按钮单独占一行。底部留白用实测导航高度，而不是写死 62px。

- 2026-10-10：手机快捷键栏能设 `scrollLeft` 但横向拖不动。鼠标拖动不会滚动 `overflow-x: auto`，`touch-action: pan-x` 只管触摸。指针横向位移直接写 `scrollLeft`；超过 10px 才算拖动并吞掉这次点击，避免连发或误触。静止点击 Tab 仍发 `\t`，按住 3 秒连发规则不变。

- 2026-10-10：竖屏关闭的会话切换按钮被同一行的「当前会话」和「完整记录 / 变更 / 文件」挤到约 148px，共享前缀被省略号截掉。名称与「当前会话」标签同一行并吃掉该行剩余宽度，操作组换到第二行；不改竖屏 44px 触控高度，也不动横屏 96px 终端保底。

- 2026-10-10：手机横屏终端塌成 16px 缝，是短视口里固定 chrome（顶栏、会话条、快捷键、68px 输入框、底栏）超过 390px，flex 子项被压到 min-content；xterm 仍按旧高度绘制。修复必须写在基础 `.mobile-terminal-surface` 规则之后，否则同选择器会被后面的 `min-height: 0` 盖掉。短视口压紧固定条并保底 96px，不改竖屏。

- 2026-10-09：审批UI必须兼容旧argv快照，否则NativeTextPreview的split会击穿整个Session错误边界；只规范显示不改请求对象。原包代码默认主题是Codex Light/Dark，不是宿主背景看起来像的Monokai；Shiki token浅色在htmlStyle.color、暗色在--shiki-dark，Session根需显式深色覆盖。Diff inline/preview分开，窄预览工具栏不能挤掉文件名；Old/New只复制hunk内容并剥context前缀/no-newline标记。阶段784单测/53E2E及增强复制浏览器用例通过，完整复刻仍未闭环。

- 2026-10-10：已保存单文件变更底栏重复显示汇总和文件行，占高约 118px，并沿用高饱和统计色。按实际原包 UT 的条件移除重复单文件列表，64px 标题区保留 literal 文件悬浮/手机预览、完整 review 与权威 Undo；统计色、12.5px 圆角和各 Diff variant frame 校准。12 项原包与真实临时 Git LAN 用例通过，整体像素残差另记。

- 2026-10-10：普通目录的 AGENTS.md 读取被 Git 状态耦合阻断，子目录的 Git 发现又可能把分支操作施加给父仓库。指令文件读写独立于 Git，未知 branch/dirty 保持 null；返回并展示 canonical repoRoot，分支/checkout/worktree 在写入或等待前拒绝超出捕获项目的父根。先红后绿，相关 Node 39、前端 16 项通过。

- 2026-10-10：fork 选择为 null 后仍缓存旧引用，点击可能继续发送上一次选区。空选择清理动作标题，点击时从实际 ownerDocument/contentRef 再捕获选区，外部节点不作引用；三项复现转绿并保留延迟 fork 的原 owner/草稿保护。

- 2026-10-10：行内消息编辑等待发送时，草稿文本从 A 改成 B 再改回 A，只按相同文字清理会删除较新的 revision。服务只清理提交时捕获的 revision 和文字，移除组件第二次清理；新版本保持可编辑/恢复，13 项专项与真实延迟/不明/新轮三场景通过。

- 2026-10-10：历史搜索命中的定向 cursor 页曾覆盖连续向前分页边界；读取最早轮后 nextCursor=null，夹在缓存中的未读中段会被误判为完整历史。定向补读保留原 earlier cursor，正常分页仍可到 null；运行中的最近页检查先结束，再读取确切目标页，不复用错误页。两项真实状态复现先红后绿，24 项服务/定位专项通过。

- 2026-10-10：fork/rollback 的本地未开始校验使用普通 Error，工作流回执因此把明确未发出的操作永久记为送达不明。五个 native RPC 前的校验改用 MutationNotStartedError；回执只识别该类型与明确 HTTP 拒绝，不靠消息字符串猜执行状态。RPC 后的异常仍保留不明保护，核心 26 项专项通过。

- 2026-10-10：第一方 dynamic tool 活动聚合标题漏掉原生 registry 图标。仅原 namespace 的已知工具使用实际 SVG；其他 provider 不借用第一方身份。原包 read_thread 图标缺失复现先红后绿，8 项分组专项通过。

- 2026-10-10：完整正文索引未保留已完成助手消息的原生 phase，commentary 因而被当作最终回复进入已加载历史搜索。投影保留 phase，完成 commentary/plan/public summary 不进入原生搜索范围；实际投影到搜索的集成用例先红后绿，9 项专项通过。

- 2026-10-10：只读会话链接恢复了正文，却漏掉原读取响应中的模型、服务等级和权限。按捕获的原 revision 使用统一 nativeThreadSettings/hydrateThreadModel，迟到读取不能覆盖新选择或另一会话；链接读取仍不 resume 或取得执行权。

- 2026-10-10：搜索定位到首条消息后，其上半部被零占高的悬浮搜索栏遮住。仅展开搜索时保留实际栏高，关闭后仍为零占高；保持原生 top 定位，不用负 scrollTop 假装首条可见。实际浏览器 y109 < bottom177 的红灯修正，桌面/手机两主题及远端定位五场景转绿。

- 2026-10-10：目标启用标志、计划占位/取消和网络搜索曾依赖全局设置，切换会话或收到迟到提交回执会影响其他草稿。目标以 sessionDraftKey/revision 隔离并随新会话身份迁移；计划、网络和发送取原 owner 设置，旧回执不能清除新选择。目标隔离与捕获参数均有先红后绿测试。

- 2026-10-10：原生模型菜单切换到高级视图时强行聚焦首项，产生原插件没有的背景与焦点状态。按实际原包 pointer 行为保持菜单容器焦点；键盘导航仍能进入模型项，浅深色真实对照和焦点复现转绿。

- 2026-10-10：工具运行标题读文件显示完整目录、目录内搜索优先显示 query，skill 仍用普通文件图标。按原生规范归一化路径、文件 basename、目录优先及受限 skill 根解析；系统 Knowledge 只认实际系统来源，使用原包 skill/knowledge/review SVG。10 项标题、来源与图标用例转绿。

- 2026-10-10：独立计划窗口借用主文档 React/Portal，真实 PNG 在另一文档中可能不解码，控件也依赖错误的 global document。改为独立同源入口与自己的 JS realm，只传有界过期 owner 快照；文件链接回到捕获的原会话目录。桌面/手机浅深色四场景真实 PNG、代码、表格和隔离 visualize 通过。

- 2026-10-10：复制的原生会话 URL 未被历史参数入口处理，链接不能恢复关注标签与指定轮。现在只读核对原 ID/cwd 后接入正常关注日志与离开保护；迟到读取不得抢走后续选择，重复/非法轮参数拒绝，不 resume 或取得写权。实际剪贴板到新浏览器上下文的链接闭环通过。

- 2026-10-10：隐藏会话的工作流工具仍可能消费全局搜索/导出动作，异步 fork 也可能读到已变化的源。挂载实际 rootRef，限定可见 owner，动作一次性消费，发起前冻结源与配置；网页编辑器选区按捕获目录与会话加入上下文，不将固定到其他项目的文件误加入当前会话。

- 2026-10-10：额度页固定把原生桶称作五小时/每周并显示已用百分比，忽略多桶与真实窗口；配置警告没有 threadId，曾被线程路由丢弃。现在显示实际 windowDurationMins 与剩余百分比，未知状态不伪造零；全局原生配置/弃用通知去重后在配置页展示，保留原文件/range 的只读预览。

- 2026-10-10：原登录弹窗接受任意 account/login/completed，其他窗口或旧运行实例的完成通知会关闭本次登录；账号读取失败还把未知/已知账号写成未登录。现在核对实际 loginId、health 实例与读取 epoch，提交不明不重复开始；失败保留未知或最近已知账号，旧读取不覆盖新状态。隔离先红后绿覆盖七个复现问题。

- 2026-10-10：review 的百分号、冒号数字、Git C-quoted UTF-8 路径与新增/删除坐标可能被当成链接语法或丢失；old/new 共用 lexer 状态还会串语法色。保存路径按 literal 解码、两侧独立语法状态，反馈固定 owner/patch digest；复制失败显式反馈，旧全文件撤销确认期间再次核对 cwd。

- 2026-10-10：非空 plan 的 started 与 completed 各自产生一行，导致正文重复及相同 React key。现在首次 started 注册稳定 thread/turn/item 投影，完成快照替换同一行；迟到 started 不复活旧状态。先红后绿 13 项投影测试及实际计划窗口无重复警告验收。

- 2026-10-10：指定历史轮 fork 的迟到响应可能抢走用户已切换的会话。指定边界 fork 改为被动合并，调用方在原选择仍有效时才激活；边界、轮次、继承目标及参数保持原生身份。最后用户消息编辑的图片/技能、模型、服务等级和权限也在异步等待前冻结，不借用另一会话的设置或草稿。

- 2026-10-10：Codex 元数据/设置通知此前只恢复模型与强度，serviceTier 和权限丢失；直接 turn/start 仍读取全局权限。现在读取原会话的完整设置，区分缺字段与明确 null，并保留用户尚未确认的下一轮选择。按会话传递服务等级、审批者、权限和协作模式；受限 override 无法覆盖 thread/input/clientRequestId。

- 2026-10-10：混合工具聚合行中的单条命令完成后切换为独立行，会丢失展开状态和输出阅读位置。独立行与聚合行共用原 entry 身份保存状态；原生标题至少停留 1 秒，完成摘要立即切换，隐藏页面不持续动画。桌面/手机两主题及原包几何、hover 对照分别验证。

- 2026-10-10：交互式 Markdown 图片的放大控件是块元素，被普通段落包裹产生无效 DOM。含图片的段落使用块容器，纯文本仍保留语义段落和原排版；实际 Streamdown DOM 用例先红后绿。

- 2026-10-10：Vite 字符串形式 API 代理隐式改写 Host，使编辑器桥的严格同源校验拒绝合法局域网浏览器请求。代理保留原 Host，目标仍由配置决定；未放宽 Origin/nonce 校验。实际 HTTPS 请求从 403 恢复为预期的无工作区 409。宿主轮询使用只读轻量 metadata，完整历史仅在真实委派时读取。

- 2026-10-10：自动复核批准的只读回执已确认 recorded 后，迟到的 RPC 网络错误曾将其降为 uncertain；现在已记录状态单调保持。可信原始事件与原生能力不足时明确 unavailable，不从公开字段拼造审批事件或自动重发。Node 回执复现红转绿，真实能力限制单独记录。

- 2026-10-09：Codex审批的一次授权必须原样发送accept，不自动变为execpolicy；availableDecisions含空数组均权威，callback类型与owner/request/turn/item/token一并校验。缺item结束用turn终态呈现metadata结束动画，final snapshot补原行但不虚构成功/exitCode；晚到命令delta不覆盖最终输出。图片预览只合并owner/path在途读取，不能把StrictMode双挂载的重复请求当作正常或缓存旧文件。专项红绿灯及桌面/手机浅深色审批、实际媒体E2E已通过，完整目标仍active。

- 2026-10-09：Codex流式展示不能以“收到过delta”证明全文完整。thread/turn/item投影跨非正文事件合并，最终快照替换同一行；原日志与稳定阅读key保留。MCP进度、plan和命令source同身份归并。聊天Diff必须保留原hunk坐标与无换行末行，Portal要有独立Codex主题；手机有明确预览按钮。部分前端/Rust/E2E已转绿，完整复刻及新Rust正式激活仍未闭环，见docs/designs/session-render-alignment/implementation.md。

- 2026-10-09：跨项目 Markdown 图片不能只验 API。终端文件浏览可以离开会话目录，图片 rootPath 仍绑定原会话会导致 400。FilePreviewResponse.resourceRootPath 按文档最近 .git 标记探测，桌面分段和手机保留/复用；不相关旧 root 不作为 fallback。浏览器需验证请求目录和 img.naturalWidth；真实五图场景已先红后绿。

- 2026-10-09：终端 Markdown 图片 404 不一定缺依赖。飞书导出 `@./papers/figures/...` 相对导出工作区而非文档目录；显式 `@./` 可在 rootPath 内逐层向上找最近匹配，普通路径不回退。只对 ENOENT/ENOTDIR/SFTP 状态 2 继续；权限和真实路径越界即失败，保留 16 MiB 限制。补齐 AVIF/BMP/ICO MIME；系统依赖与排查统一见 README，架构见 docs/markdown-image-preview.md。

- 2026-10-08：原生回答失败重复显示 RPC 与本地错误；优先保留 RPC 通知，本地错误仅作无 RPC 状态的兜底，保留重试和答案。见 RequestUserInputItem 测试与 docs/session-background-sync.md。

- 2026-10-08：后台历史先于 SSE 补到问题时，也应对已加载的当前会话复用一次性展开；显式历史、初次加载、旧轮和已收起请求仍保持静默。postNoContent 必须保留 HTTP 状态码，明确 4xx 拒绝与 5xx／超时送达不明分别处理，禁止盲目重发；回归见 docs/session-background-sync.md。

- 2026-10-08：运行标签反复加载／后台正文不跟进：分离初次加载与核对；所有打开成员共用最近只读分页、4／2 读槽及期限，按完成时间限频，返回不拆建健康同步器。设备缓存只恢复展示，稳定消息锚点处理分页按钮消失的 52px 偏移，rollback tombstone 拒绝旧缓存与迟到写入。正文、状态、队列和 pending snapshot 分别核对，不 resume／重发／标已读。见 docs/session-background-sync.md。

- 2026-10-08：已发送回执不等于模型执行成功。排查“等待消息同步”时按 threadId + turnId 核对原生 `turn.error`；无文件变更的失败结束事件也必须保留渲染。回显终态后缺原生 clientId 时只核对一次历史，不重发。历史参数超限可被工具调用中的巨量尾部空白触发；先备份和逐字段验证修复副本，不隐式归档子会话或重启共享服务。详见 `docs/session-message-delivery.md`。

- 2026-09-23：聚焦页顶栏的「屏幕布局」菜单与页签设置重复，顶栏换行。入口收敛到页签设置，页签标注屏幕数，设置面板加宽并截断长分组名。
- 2026-09-23：聚焦页返回宫格后刷新，「返回上次」按钮消失。原因是宫格保存视图状态时丢弃了上次聚焦的会话 id；现宫格同样保存该 id，刷新后按钮仍在并回到原聚焦页。
- 2026-09-23：快捷回复曾在选择模板后要求另点预览并新发编辑卡片。现在目标与模板下拉事件用回调 token 原位更新同一张 Card 2.0，选择不入队；历史直发按钮不再投递，只有同卡编辑表单提交才发送。
- 2026-09-23：快捷回复编辑框曾设置 8000 字，超过飞书 Card 2.0 单框 1000 字限制。现按 Unicode 字符分段编辑并按序拼接，服务端复核字段完整性与每段上限，覆盖 emoji、多行、缺段和超长输入。
- 2026-09-23：Claude 完成通知曾漏掉本轮用户问题：纯字符串 `message.content` 没进入关联文本缓存。现在纯字符串和文本块统一收集，最终回复可带上正确的问题来源。
- 2026-09-23：分组排列的窗格标题不可拖动。现分组模式拖动标题即交换组内顺序并随页面保存，分组外会话拖入无效且不切换当前输入；切到分组时当前页签改为分组名，重名追加序号。
- 2026-09-23：切换「默认」和「页面 2」时标签把当前页移到最前，看起来像两页互换。标签行改为固定创建顺序，当前页只高亮，顺序和各自布局不变。
- 2026-09-23：聚焦页粘贴图片只支持 Codex。Claude 现按 pane 的 `--resume`/`--session-id` 或工作目录唯一 transcript 定位，用 `claude --resume --input-format stream-json` 投递 base64 图片；定位不唯一时拒绝，临时文件立即删除。
- 2026-09-22：Grok 输入框每个字符都触发整份会话快照和聚焦页重绘。普通按键改为合并广播，前端复用内容相同的会话引用并稳定终端回调，所有任务、Git、标签与连接字段变化仍完整更新。
- 2026-09-22：看板会话打字延迟数秒。每个按键都会等待 tmux attach，并再等协议探测；现后台复用 attach 探测，未附着时直接走 tmux pane，附着后走 PTY，普通输入不再等待协议回复。
- 2026-09-22：单窗格切换 session 会因缓存子树重排而关闭 WebSocket、重建 xterm 和重放历史。缓存层改为稳定挂载顺序并保温 8 秒，快速往返复用同一实例和连接，到期再释放。
- 2026-09-22：首次加载重历史终端时，大块 replay 长时间占用主线程。完整历史改为小块、有序、批次让出事件循环；实时输出排在 replay 后，局域网 512 KiB 抽样的窗格呈现约 0.6 秒。
- 2026-09-22：完成通知定位器对每个 pane 高频读取全部 Codex 历史头，使 34 张 tmux 卡片下后端持续约 86% CPU、健康检查秒级抖动。明确 resume ID 现精确命中 rollout，其余元数据按文件时间和大小缓存并自动失效；运行态 CPU 五秒均值约 15%，健康检查多数约 1–2 ms。
- 2026-09-22：电脑端聚焦分屏被顶栏、主内容 18px 内边距和 34px 窗格标题栏挤占。现收紧桌面 chrome 与分屏缝，「当前输入」只保留徽章；回归覆盖密度 CSS 与标题栏结构。Logo 收紧后与「电脑端 Coding Kanban」字号/中线不齐，改为按 24px 高度对齐标题行。
- 2026-09-20：长时间运行期间 `/tmp/tmux-<uid>` 连同控制 socket 被清理，tmux server/pane 仍存活，但完整记录的活动 pane 定位全部失败并误报无记录。运行态通过恢复 `0700` 目录及向已验证的当前用户 tmux server 发送 `SIGUSR1` 无损重建 socket；服务端在 Codex 定位与本地 tmux 命令前复用同一受限自愈逻辑，拒绝畸形 TMUX 值、非 tmux 或非当前用户 PID。
- 同一个 tmux session 分屏运行多个 Codex 时，完成通知过去只解析活动 pane，其他分屏完成会漏报；通知卡片回复又在收到消息时重新解析活动 pane，可能串到另一个 Codex。现用 `tmux list-panes -s` 枚举全部 pane，沿各自 PID 定位顶层 Codex thread，按看板 session + thread 分别维护完成基线/去重；通知绑定的回复、记录和文件动作先验证原 thread 仍属于该 tmux session，再精确投递，绝不因切换活动 pane 改目标。
- 2026-09-17：远程 `research_26` 的 tmux 已开启 `mouse on`，但 `terminal-features` 缺少 `mouse`，导致浏览器 xterm 不产生点击报告。连接命令现在补齐远程 tmux 鼠标能力，前端对 tmux 终端回放完成后主动启用 SGR 鼠标报告，兼容存量会话和不完整能力协商；新增端到端回归。
- 2026-09-17：`research` 的 TUI 启动后可能关闭 xterm mouse tracking，使滚轮无法进入 tmux。登记为 tmux 的交互终端现在在滚轮捕获时检测并恢复 `1002/1006`，并直接补发当前坐标的 SGR `64/65` 滚轮报告；因此恢复动作不会吞掉第一下滚轮，Shift+滚轮仍走本地 scrollback。
- 2026-09-16：桌面聚焦页切换分屏后可能出现整块黑色窗格：自动补位把离线且没有 PTY 回放的历史 tmux 会话交给了 xterm。现自动排布优先在线/降级会话，离线会话只显示带恢复提示的轻量预览；缓存终端从 hidden 层重新显示时由可见性与 IntersectionObserver 触发 fit/refresh，回归覆盖不可用窗格、在线优先和分屏回放。
- 2026-09-07：飞书回复从 PTY 粘贴加 Enter 改为复用原生 codex queue，精确定位活动 thread，完整保留 /goal 与多行正文。队列接受才标记 processed，忙碌线程交给 Codex 排队，失败不回退键盘或盲目补发。
- 飞书回复通知卡片后少数 Codex 会话仍只填入文字：单行回复会触发新版 Codex paste-burst 识别，且 node-pty Promise 不代表底层字节已写稳，紧随的 Enter 仍可能被合并。所有交互回复现统一使用 bracketed paste，活跃 PTY 再等待 50 ms 后单独发送 Enter；普通键盘输入和旧直连 pipe 不变。
- 飞书回复通知卡片后文字会进入 Codex 编辑区但不自动执行：prompt 和 Enter 同批写入时，部分 Codex TUI 忽略同批次回车。输入服务现对交互 PTY/tmux 先写 prompt（多行 bracketed paste）再单独写 Enter，旧版直连 process/SSH 使用一个末尾换行提交，避免重复空命令。
- 多窗口布局一次挂载多个完整 xterm 时，浏览器主线程会被最多 4 MiB/窗格的历史解析阻塞，延迟 WebSocket `open` 事件并让 3 秒握手保护误杀排队连接，形成同频重试和黑屏。聚焦页现只并发两个首次完整回放、优先当前输入窗格，并在 xterm 解析完成后放行队列；等待期间保留轻量终端与加载状态，12 秒安全释放防止队列饥饿，桌面完整历史不截断。
- 电脑端 Markdown 全高预览缺少标题目录，实时分屏两侧也不能同步滚动；更危险的是桌面只读取预览前缀仍允许保存，可能截断覆盖大文件。修复为稳定标题锚点与可折叠目录、默认开启且可关闭的双向比例同步；桌面按最多约 1 MiB 滑窗前后翻段，未完整载入时只读，手机端不变。
- 桌面聚焦页切换未上屏终端会重建 xterm 并回放最多 4 MiB，分组排列还会为离屏窗格建立真实终端；现单屏缓存当前及最近两个实例，分组只挂载当前/可视附近 xterm，TerminalView memo 跳过无变化渲染。服务端把 PTY 碎片按 64 KiB/128 片压缩、用逻辑头游标截断并缓存回放物化，focus POST 改为有序 `204` 且只靠 WS delta 同步，避免完整快照二次重渲染。
- 新版 tmux copy-mode 会发送空选择目标的 OSC52（`52;;data`）；前端解码现同时接受空目标与显式 `c`，避免内容已到浏览器却没有进入剪贴板。
- 电脑端活动 xterm 的捕获阶段 `contextmenu.preventDefault()` 会吞掉浏览器原生复制/粘贴菜单；已删除终端内容区的右键拦截和专用判断，标题栏看板菜单、左键拖选及 tmux copy-mode 保持不变。
- “完整记录”首次滚到底部后，懒加载 Markdown 扩高会让视口留在较早记录；初始阶段现用 `ResizeObserver` 持续锚定最新记录，用户滚轮、触摸或点击记录区即解除，向上分页的锚点恢复逻辑保持不变。
- 拉取新代码后，遗留的旧 `tsx watch src/index.ts` 会监听 shared 的 `dist`，而新后端启动又无条件重编译该目录，形成约 1.5 秒一次的无限重启并让前端持续重连；启动构建现按源码/配置与对应 JS 产物的修改时间判定，仅缺失或过期时执行，首次构建后可在新旧 watcher 下稳定收敛。
- 手机端文件系统“新建”依赖 `window.prompt()`，在部分手机浏览器/PWA 中被拦截，导致无输入框和软键盘；改为底部菜单内的受控原生输入框，并在点击手势内同步挂载与聚焦，16px 字号避免 iOS 聚焦缩放。
- 手机端会话状态通道改为首次全量、后续增量，避免任一终端输出都重复传输全部会话；断线重连重新发送全量基线。手机终端初始 scrollback 改为受限的最近 256 KiB，服务端校验并按 UTF-8 边界截尾，桌面端不变。
- 手机文件系统条目支持 600ms 长按操作菜单；滚动手势取消长按，菜单复用现有本地/SFTP 下载、重命名、删除和复制路径能力，删除必须确认。
- 当前工作区 Diff 把未跟踪目录显示为文件：`git status --porcelain -z` 会折叠目录；修复为用 `git ls-files --others --exclude-standard` 展开目录，只返回实际文件。
- 历史会话恢复通知叉号可见但点不到：banner 根节点是 `pointer-events: none`，关闭按钮未放入 `pointer-events: auto` 的 actions 容器；统一按钮结构并补测试。
- 宫格“可继续/待验收”按钮切换卡顿：PATCH 后又请求完整会话列表，跨列重排还会重挂载卡片；改为本地乐观更新，成功只合并 PATCH 返回值，失败回滚。
- 后端 PID 稳定但 WebSocket 仍频繁断连且 CPU 约 80%：卡片摘要依赖每秒变化的 `lastOutputAt`，反复读取完整 Codex JSONL、启动 Git 子进程，Git 摘要写回又形成快照反馈；前端任务/Git 摘要按 15 秒/60 秒时间窗限流，后端增加同窗口 TTL 缓存和 single-flight，并仅在 Git 业务字段变化时更新 registry。
- 看板频繁自动重连且后端反复 `EADDRINUSE: 4000`：旧 `tsx watch` / Vite 子进程组没有被 PID 文件和端口清理完整覆盖，高负载下会话捕获的 2.5 秒超时又会阻止安全重启；现按仓库路径与开发服务命令定向清理残留进程组，并把会话迁移超时放宽到 15 秒后再启动唯一实例。
- 工作区 Diff 中只有 `new file mode` 的长路径可能是 0 字节未跟踪 `.done` 标记文件，不是目录；生成 Diff 前过滤 0 字节未跟踪文件。
- 用户 push 后仍看到 Diff：push 不会清理 `??` 未跟踪输出；当前工作区 Diff 改为 `git status --untracked-files=no`，只显示已跟踪文件的未提交变化。
- Playwright 创建会话前需等待 `session-restore-banner` 的 restoring 状态结束并关闭可关闭横幅；会话数达到四列共享虚拟化阈值时，先用 API 确认创建结果，并用足够高的视口挂载各列测试卡片，避免 UI 假红。

# 仓库 bug 修复记录

- 2026-10-08：手机切换标签唤起键盘，既来自挂载/切换时的 `focus()`，也来自 Lexical 恢复非空草稿的 DOM 选区同步；只禁用 focus 仍会复现。触屏设备禁止自动聚焦，被动恢复草稿清除内部选区并使用 `SKIP_DOM_SELECTION_TAG`；手动输入和桌面聚焦保留。加号首项“上传图片”原生多选后立即把 File 交给捕获的草稿 owner，慢上传可预览，失败可重试，切换/刷新不串图。回归见 `tests/e2e/session-mobile-input.spec.ts`。

- 飞书完成卡片的本地图片引用过去只能走二进制文件下载，无法直接显示。私聊通知现对安全引用再次校验项目边界、普通文件、非符号链接、PNG/JPEG/WebP/GIF 真实签名及 10 MB 上限，上传为飞书消息图片后用 Card 2.0 `img` 直接展示；上传失败、伪装图片或群聊自动降级，原通知和文件按钮保持可用。

- 长任务完成卡片可能已有完整记录按钮却缺少用户问题：问题提取过去只扫描 `task_complete` 前最后 1 MiB，真实任务的问题可能被大量工具输出推到窗口之外。现保留 1 MiB 快速探测，仅在问题缺失时对本机或 SSH 记录扩大到最多 8 MiB 做一次有界恢复；仍无法可靠关联则省略，不拿旧问题代替。

- tmux 中由 `node` 包装的 Codex 在升级重启、首轮尚未提交时没有 rollout session，提示词编辑和状态栏重绘产生的 `running → idle` 曾被降级成飞书完成卡片。现对 Codex/已有 session/本地 tmux `node` 会话只认可新的结构化 `task_complete`，解析为空或失败不再发送终端摘要；未解析 session 不做负缓存，避免随后首轮短任务漏报，普通非 Codex 边沿降级保持不变。
- Goal 模式的 Codex 会在内部阶段写出 `task_complete` 后自动创建 `goal.internal_context` 下一轮，旧通知器因此把中间状态误发为任务完成。现结合后续 `task_started` 和用户记录来源抑制 Goal 自动续轮，来源元数据尚未写入时先延迟判断，最终完成与人工快速追问仍按真实 turn 通知。
- 飞书完成通知曾依赖终端连续静默 15 秒后的 `running → idle`，所以用户在 Codex 回复后快速继续提问时，多个 turn 会合并并漏报。现直接读取 JSONL 原生 `task_complete`，按 `turn_id` 对本机/SSH Codex 每个完成 turn 单独触发和去重；初始旧记录只作基线，状态边沿保留降级且不会双发，探测按输出变化防抖并缓存定位结果。
- 飞书完成通知过去只发送卡片摘要并再次截断，无法看到 Codex 的完整最终答复。现复用活动 tmux pane/session 定位读取最后一条结构化 assistant 消息，保留纯文本换行与缩进，过长正文按序分片且每片使用稳定幂等键；只有读取不到记录时才回退摘要。
- 飞书通知开关过去无法覆盖按钮开启前启动、且没有加载用户级 `notify` 的 Codex。现由 Kanban 后端订阅全部已登记会话的新完成边沿，已运行会话后续完成也会发送；状态迁移到 `kanban` 接管模式后旧原生 hook 静默，避免双发。重启恢复门控只预先武装重启前确实运行中的会话，旧空闲卡片不会因恢复时短暂进入 `running` 而批量误报。
- 非最大化桌面窗口中，完整记录的刷新/关闭按钮可能被应用菜单或通知层覆盖：弹层过去留在聚焦视图的层叠上下文中，且高度未按动态视口保留安全边距。现通过 Portal 挂载到 `document.body` 的独立模态层，并以 `dvh` 限高、固定标题操作区，窄高窗口中按钮仍可见可点。
- Markdown 本地/SSH 图片曾随会话快照刷新持续闪烁并重复请求：父层每次重建等价资源上下文，渲染器又重建 `ReactMarkdown` 自定义组件表，图片组件因而反复卸载、释放 Blob URL 并重新加载。现按文档/项目根/SSH 字段语义比较渲染 props，并按相同字段缓存组件表；无关刷新和正文更新都保留已有图片实例。
- 六屏等多终端布局过去在视口小于 `1180px` 时直接退成单列，主终端仍足够宽也会过早重排；现改为对 `.focus-main-terminal` 使用命名容器查询，只有终端区真实小于 `720px` 才把多列切成单列，侧栏宽度变化也参与判断。
- Markdown 相对图片过去按看板页面 URL 解析，导致本地和 SSH 文档预览破图；共享渲染器现携带文档/项目根/SSH 上下文，在接近视口时从受限资源接口流式读取 Blob。服务端用规范化及真实路径双层边界校验阻止目录与符号链接越界，仅返回已知图片 MIME，单张限制 16 MiB；预览卸载会释放对象 URL。
- 完整记录此前只是前端每 30 条控制 DOM，后端仍全量读取、解析并传输数百 MiB Codex JSONL；现改为从文件尾部按 64 KiB 块和字节游标每页读取约 30 条，跨页保持工具调用/输出配对及 `exec` 过滤，轻量/完整模式分别限制前端连续窗口为 90/300 条。
- 电脑端聚焦页标题栏曾使用 12px 间距、宽按钮内边距并允许换行，窗口稍窄就占两行；现固定为单行紧凑布局，让会话名独占可收缩空间并省略溢出，按钮保持完整标签，折叠态同步收紧。
- 手机端会话下拉菜单曾被终端的 document 捕获阶段滚轮兜底穿透，滚轮操作落到后台 xterm；现将 `.mobile-session-picker-menu` 纳入统一弹层阻断目标，菜单恢复原生纵向滚动并阻断滚动链外溢。
- 桌面聚焦视图的分组终端切换器曾始终展开全部会话；现将组标题改为可键盘操作的折叠按钮，使用独立 `terminal-switcher` 作用域持久化，不联动主页或侧栏，搜索期间匹配分组保持展开。
- 手机端方向键曾以 `touch-action: none` 抢占从按键开始的横滑，并在按下后约 360ms 快速连发；现允许重复键参与原生横向滚动，移动超过 10px 即取消输入，静止按住满 3 秒才串行重复，并把 `Enter / Tab` 前置到方向键之前。
- 变更面板的“引用文件”仅生成 `@路径` 纯文本，没有真实上下文注入能力，且与“复制路径”重复；普通/全屏 Diff 已移除该入口，手机端同步删除引用草稿状态。
- 手机端现默认直接进入“当前会话”；快捷键全部保留在单行并前置方向/退格，方向键和退格可串行长按重复；输入区只保留安全的“发送 / 粘贴”，失败保留草稿并从失败帧重试，不再重复粘贴或误清空内容。
- 手机端“当前会话”选择器曾复用注意力/活动时间排序，实时输出会让选项跳动；现独立按“可继续 → 执行中 → 其它状态”分组并在组内按名称稳定排序，看板本身的注意力顺序不变。
- “本次任务”曾只放行 `agentKind=codex` 且只解析旧版 `apply_patch`，导致本地 tmux 卡片和新版 Codex 原生 diff 无法映射；现先定位卡片对应的精确 session，再按最新 `turn_id` 映射 `FileChange`，旧格式仅作兼容兜底。
- 变更入口默认落在只归因 `apply_patch` 的任务视图，加上工作区主动排除 untracked，导致新增文件和经 Shell 删除的文件看起来缺失；现默认打开“当前工作区”，逐文件纳入 untracked 并生成 `/dev/null → 文件` Diff，tracked 删除仍返回完整 `HEAD` Diff。
- 手机端变更面板展开全部文件会挤压 Diff：紧凑模式改用原生下拉框选择文件，并提供独立全屏 Diff 覆盖层，支持退出和复制路径。
- 手机端原生受控会话选择框会在实时快照重渲染时被部分手机浏览器重复创建系统选择层，且“变更”按钮作为第四个网格项会换行占高；修复为单实例页面内会话列表，并把“完整记录 / 变更”收进同一行操作组。

- Agent 完成结果直接进入“已完成”会被用户漏看，tmux 恢复运行还可能残留旧标记：新增持久化 `hasUnreadCompletion`，完成先进入“需要你”，聚焦查看后进入“已完成”，新输入或恢复运行后清除并进入“工作中”；所有桌面、手机和多终端查看入口统一走 focus API。
- 分组数量增加后不同分组颜色会碰撞，重启后部分会话回到未分组：旧实现只有四个按 group ID 哈希的 tone，assignment 也只保存单一动态会话 key。修复为按配置顺序使用 12 个醒目基础 tone，并为更多分组生成稳定的高对比 HSL 色值；保存稳定 session ID、agent ID 及安全 tmux 别名，恢复时先按稳定 session ID、再按别名匹配，同时不使用 pane-less 以外的 tmux session 广义别名，避免旧运行身份覆盖当前归属，也避免同一 tmux session 的多个 pane 被错误合并。
- 本地 tmux 中 Ctrl+C 等快捷键可用但普通文字无法输入，或文字落到与当前可见 pane 不同的目标。根因是普通文本走 `tmux send-keys`，而控制键、鼠标和前缀走 attached client PTY，两条通道的活动 pane 与时序可能分叉。修复为 attached client 存在时统一把所有原始输入写入同一个有序 PTY；仅无 client 的离线场景回退到固定 pane 的 `send-keys`。单元回归覆盖普通文本、前缀、清理和 detached fallback，真实 WebSocket+tmux 回归覆盖握手、焦点过滤和分帧粘贴。
- 新建或恢复本地 tmux 时，scrollback replay 可早于 `tmux attach` client 完成，首个文字、前缀或 Codex 输入会被启动 shell 吞掉。修复为用 `tmux list-clients` 的 `client_pid` 匹配 PTY PID 后再写 native PTY；就绪前短暂等待，超时安全回退 pane adapter。CSI-u 修饰 Enter 保持 `send-keys -l` 例外，避免旧 tmux client 吞掉原始字节；真实 rename-window prompt 回归覆盖首帧输入、提交和取消。
- 聚焦视图侧栏切换主窗口延迟且重复请求 focus：单击原先等待 220ms 区分双击，App 切换路径和 active slot effect 又会重复请求同一 focus。修复为首击立即切换、忽略双击第二次 click，并以 in-flight 请求合并和旧响应丢弃保证快速切换只更新一次。
- 多屏聚焦视图从看板进入已显示在非活动窗格里的 tmux 后无法输入：focused session 已更新，但局部 `activeSlotId` 仍指向旧窗格。修复为外部聚焦变化时激活 focused session 所在的可见窗格，使标题、当前输入标记和键盘所有权一致。
- 无侧栏多屏为避免额外 `/focus` 而解耦 `activeSlotId` 后，真正的外部 focused session 变化也可能不再转移输入权，导致用户在 `coding` 中的退格、中文和快捷键持续写入旧“清理空间” pane。修复为仅让同一 focused session 下的本地监控切换保持解耦；focused session ID 真实变化时始终激活对应可见窗格。
- 手机端快捷键缺少 Claude / Copilot CLI 常用控制键：`Shift+Tab`、`Ctrl+O`、`Ctrl+E` 和行编辑组合无法从手机触发，且快捷键类型中残留旧 id 有构建失败风险；修复为扩展手机快捷键表，并在本地 tmux 转换层映射到 `BTab`、`C-o`、`C-e`、`C-u/w/k/y` 等 key name。
- 手机端快捷键说明弹窗缺少无障碍属性：没有 `aria-modal`、`aria-labelledby` 和 Tab 聚焦陷阱，屏幕阅读器用户无法正确聚焦弹窗；修复为增加 `aria-modal=”true”`、`aria-labelledby` 指向标题、Tab 循环限制和 Escape 关闭，卸载时还原页面焦点。
- 手机端快捷键工具栏多行平铺占用纵向空间且不符合横向选择预期：修复为 `flex` 单行横向选择器，使用 `overflow-x: auto` 和 `touch-action: pan-x` 支持左右滑动，并把 `EOF` 按钮展示为 `Ctrl+D`。
- 手机端输入框“发送”只填入 Agent 输入框但不提交任务：文本和回车合并在同一个 stdin payload 时，部分 Copilot/Claude/Codex TUI 没把同批回车当提交键；修复为“发送/粘贴执行”先 bracketed paste 文本，再单独发送 Enter，“粘贴”仍不自动提交。
- 聚焦视图静态区域点击后输入失效或首字符重复：`AgentFocusView` 过度依赖 `keydown` 补发，且把按钮/链接当作输入控件；修复为在 `pointerdown` 直接归还终端焦点并避免重复转发。
- 从终端切回 VS Code iframe 后焦点被终端抢回：`TerminalView` 未把 `iframe` 视为有意外部焦点；修复为把 `HTMLIFrameElement` 加入允许列表。
- 从终端切到文件浏览器编辑器或 VS Code 后，输入过程中焦点仍会被终端抢走：终端只看当前 `activeElement`，交接瞬间看到 `body` 就误抢；同时 VS Code 抽屉把 `reused` 变化当成新实例；修复为增加外部输入焦点保护窗口，并忽略 `reused` 单独变化。
- VS Code 分栏开着时，用户已经点回终端，过一会输入仍会“死掉”：`TerminalView` 只在离散 blur/focus 事件上补救，没有覆盖 iframe 生命周期造成的被动失焦；修复为记录最近一次终端/外部焦点意图，并仅在“最近一次是终端”时启用轻量焦点修复守护。
- 终端已经可输入时，空闲一阵后仍可能再次失焦：被动焦点修复把“从未有外部输入控件接管过焦点”的场景也判成了不该归还终端，导致活动终端的默认输入 owner 身份没有被守住；修复为在没有受保护外部焦点记录时，默认继续修复活动终端 helper textarea 的焦点。
- VS Code / 文件浏览器分栏打开时，用户点回终端后仍可能被后台 iframe 或编辑器程序化 `focus()` 抢走：`TerminalView` 把当前 `activeElement` 是 iframe/input 直接视为外部用户意图，隐藏保活面板也还可聚焦；修复为用最近一次用户意图决定焦点所有权，只有外部指针/键盘输入/带用户激活的 iframe focus 能接管，非 active 侧栏面板加 `inert` 并隐藏时 blur 内部焦点。
- 选定机器扫描 tmux 会话后，“扫描中...”和“刷新”频繁交替：`TmuxDiscoveryPanel` 把全局 `sessions` 放进自动扫描 effect 依赖，WebSocket snapshot 刷新会话列表时会反复触发 tmux scan；修复为自动扫描只跟稳定 host key 走，sessions 只重算已加入标记，并丢弃过期扫描请求。
- 远端文件浏览在真实 SSH 主机上统一报 `All configured authentication methods failed`：终端链路依赖系统 `ssh`，能吃到默认私钥；SFTP 链路直接用 `ssh2`，之前只在 `identityFile` 显式存在时才带私钥，导致未写 `IdentityFile` 的主机全部认证失败。修复为 SFTP 认证支持显式 key、标准默认私钥回退，并兼容 `SSH_AUTH_SOCK`。
- 远端 SSH 会话在线时，文件浏览器首屏偶发空白并报 `write ECONNRESET` / `No response from server`：`SftpService` 在连接还没 `ready` 时就把连接放进池里，UI 初始化打出的并发 `/api/fs/list` 会抢到半初始化连接。修复为复用连接前必须等待 `ready`，并在连接失败时及时把坏连接移出池。
- 远端 SSH 会话已经退出时，kanban 终端只剩 `[连接已断开]`：PTY runtime 退出就删除 handle，terminal websocket 后续重连拿不到 scrollback，只能 4004 关闭，导致真实错误（例如 `fatal: Gerrit Code Review: exec: not found`）被泛化提示覆盖。修复为 runtime 已退出但 session 仍存在时，从 registry 的历史输出回放 terminal 内容。
- tmux mouse mode 下 pane 内拖拽选择停留在 tmux/TUI 内，浏览器侧 xterm 没有 selection 可复制：修复为 `TerminalView` 支持 OSC 52 clipboard 写入，让 tmux copy-mode 负责选择边界并把内容写入浏览器剪贴板。
- OpenCode 开启 mouse tracking 后 hover 会被 Kanban 当成用户输入，持续刷新看板并把鼠标转义串写进预览；修复为鼠标移动报告不进入 TUI、不记用户输入，并阻止明确非 Codex 会话读取同目录 Codex JSONL 摘要。
- OpenCode 与 Codex 共用工作目录时，卡片摘要/完整记录/任务变更曾按目录回退读取最近 Codex JSONL；修复为明确的 OpenCode、Claude、Copilot 等非 Codex 会话不再走这三条 Codex 数据路由，同时保留 `shell` / `node` tmux 的 Codex 兼容定位。
- 已运行的 OpenCode 会话在 Kanban 重挂载后，replay 会清除历史 `CSI ?2004h`，新 xterm 不知道 TUI 已启用 bracketed paste，剪贴板末尾换行会变成 `Return` 并直接提交。修复为只给 OpenCode 活动终端在开放输入前恢复 bracketed-paste 模式；粘贴保留在 prompt，显式 Enter 才提交。
- OpenCode 开启 mouse tracking 时直接拖选会被 tmux 转发给 TUI，部分界面会把复制手势解释成 prompt 输入并提交；OpenCode 活动终端现在延迟无修饰键左键手势，超过阈值后转为 xterm 本地 Shift 选区且不写 PTY，单击重放给 TUI、滚轮不变。
- 普通 zsh tmux pane 的 `mouse_any_flag=0` 时，点击或滚轮仍可能把 `0/64/65;...M` 写进提示符：用户级 `MouseDown1Pane` / `WheelDownPane` 无条件执行了 `send-keys -M`。修复为仅在 pane 主动接管鼠标时转发；普通 shell 点击只选择 pane、滚轮进入 copy-mode。Kanban 不覆盖用户全局 tmux key table，隔离 attached-client 测试确认 shell 命令行不再被鼠标报告污染。
- live stdin 过滤握手应答导致 Copilot CLI 等 TUI 卡死：修复为仅清洗 replay，不过滤 live stdin 的 DA/DSR/CPR 等应答。
- 终端或 tmux 中 Copilot/Codex 的 Ctrl+C 可用但快速普通文本无效，启动命令还可能被写成 `5Rnode ...`：浏览器较早 DA 回复会和当前 CPR、REST/键盘文本乱序交错。修复为根据 PTY 输出的 DA/DSR/CPR 查询类型跟踪短暂 pending，只转发匹配的完整回复，全部完成后才释放普通文本；陈旧回复丢弃，250ms 无回复超时释放。单元及真实浏览器 Copilot 启动回归覆盖该顺序。
- Codex CLI 运行后鼠标滚轮偶发变成输入历史上下翻页：xterm.js 会在 TUI 鼠标追踪或无 scrollback 路径中把 wheel 转成鼠标协议/方向键输入；修复为前端接管 wheel，只滚动 xterm scrollback 并阻止 wheel 进入 stdin。
- 多屏或完整预览终端偶发无法滚动上下文：wheel 只挂在 xterm 内部 handler，事件落在外层容器、缩放空白区或非输入预览终端时可能漏掉；修复为 `TerminalView` 容器捕获阶段统一接管 wheel，所有终端视图都滚动自己的 scrollback 并阻止进入 stdin。
- 运行中终端滚上去后马上被实时输出拉回底部：live `term.write()` 持续刷新底部跟随，覆盖用户刚选的 scrollback viewport；修复为滚轮离开底部后短暂锁定 viewport，新输出写入完成后恢复到该行，回到底部时解除锁定。
- 很多运行中终端滚轮仍控制不了上下文：旧用户滚动锁只有 10 秒，长输出终端停留阅读超过 10 秒后会再次被 live output 拉回底部；wheel 事件也可能落在终端上方的遮罩、空白层或 document-level 目标上，绕过 `.terminal-view` 容器。修复为把用户滚动锁改成“只要未回到底部就持续锁定”，并增加 document capture 兜底，鼠标坐标落在真实 xterm 区域内时一律滚动对应终端 scrollback。
- 终端 focus-report mock 未进入 raw mode 导致测试假红：修复为断言前先切 raw mode。
- Secondary DA 应答污染 shell 提示符：修复为只过滤会造成噪音的 Secondary DA，保留必要握手应答。
- 非交互 tmux 缩略图回写 resize 导致真实 pane 缩小：修复为缓存 live geometry，在前端做本地缩放预览。
- SSH -> tmux resize 不生效：`node-pty.resize()` 不足；修复为额外发送 `SIGWINCH`。
- 远端新建 tmux 会话时，非 shell agent 会在启动命令退出后把整个 tmux session 一起结束，看起来像“只能建 shell，不能建远端 tmux”：前端 `buildTmuxLaunchCommand` 的非 shell 分支少了 keep-pane-open 包装，和服务端实现漂移；修复为复用带 `exec "$SHELL_BIN" -i` 的 tmux pane 命令构造。
- 远端 `10.30.0.24` 上从看板启动 Copilot 会话时，看起来像“tmux 创建失败”，实际是主机把 `copilot` 解析到了缺少 `index.js` 的 `~/.nvm/.../bin/copilot` node shim：修复为远端 Copilot 启动命令优先尝试健康的 `copilot`，命中损坏 shim 时回退到 `node ../lib/node_modules/@github/copilot/npm-loader.js` 直接拉起 CLI。
- 远端 `10.30.0.24` 上直接创建 shell tmux 时，默认名 `10.30.0.24_shell_tmux` 会被旧版 tmux 3.0a 直接拒绝并报 `bad session name`：根因是 tmux 模式默认名仍保留 `.`；修复为 tmux 模式下把 host label 里的 `.` 也归一化成 `_`，生成 `10_30_0_24_shell_tmux` 这类 tmux-safe 名称。
- 本地 tmux 会话刚进入 focus view 后，浏览器 terminal WebSocket 已发送输入帧，但 tmux pane 收不到 `stdin:<marker>`：根因是 stdin 只写 `tmux attach` 的 PTY，attach 竞态或 pane 目标缺失会吞早期输入；修复为本地 tmux 会话优先通过 `LocalTmuxAdapter.writeInput` 的 `tmux send-keys` 队列写入目标 session/pane，失败时再回退 PTY 写入。
- 多屏 focus view 中拖拽 sidebar session 到当前输入 pane，或在当前输入 pane 的 select 切换 session 后，pane 会被 normalize 拉回原 focused session：根因是 active slot 改动没有同步 App 级 focused session；修复为 active select、拖入 active slot、从 active slot 拖出时同步 active slot/focused session，并支持 sidebar card 单击切换 focus。
- 文件浏览器创建弹窗在输入清空时意外关闭：把草稿字符串误当作弹窗开关；修复为显式维护弹窗状态。
- 文件浏览器在 A 会话折叠后，切到 B 会话再切回 A 会自动展开：折叠状态存在全局 UI 状态里，且 `sidePanelOpen=false` 时被 effect 清零；修复为把左右分栏折叠状态放进每个 `agentSession` 的侧栏状态，切换会话不再重置。
- 多屏聚焦视图切换输入终端时文件系统/VS Code 跟随规则错误：active slot 和 App 级 `focusedSession` 总是强绑定；修复为只有侧栏工具已打开时才同步 focused session 并把当前工具类型带到目标 session，未打开工具时只切多屏输入窗格。
- 多屏中快速切换终端时，文件系统侧栏偶发出现、消失或未加载到对应终端路径。根因是每个会话各自保留 `activeTool`，切换时又通过 active slot effect 和 focused session 派生侧栏开关，多个旧会话状态会抢当前抽屉归属。修复为在 App 层维护全局单一 `openSidePanelTool`，切换终端时只把该工具独占写入当前输入终端，并清空其他会话的 `activeTool`。
- 进一步排查发现，`onActiveTerminalSessionChange` 的 React effect 也参与侧栏 retarget，会和用户点击 pane 时的同步 `onSwitchFocus` 路径竞争，导致快速切换时最终目标偶发被较晚提交的 effect 覆盖。修复为 effect 只记录当前 active terminal id，文件系统/VS Code 跟随只由用户激活 pane 的同步路径执行，并补快速 A/B/A/B 切换回归。
- 文件系统/VS Code 侧栏是否显示仍被误建模成“某个终端是否开启过工具”，导致全局文件系统已经打开时，切到一个从未开过文件系统的终端仍可能不显示或按旧会话状态判断。修复为完全移除 session 级 `activeTool` 作为运行时状态，文件系统/VS Code 是否显示只由全局 `openSidePanelTool` 和用户工具按钮控制；每个 session 只保存 host、折叠等配置，切换终端只更换侧栏目标内容。
- 文件系统/VS Code 侧栏折叠状态仍然绑定到 `focusedSession` 的 per-session `sideCollapsed/mainCollapsed`，导致多屏切换终端时一会儿折叠、一会儿展开。修复为把左右分栏折叠状态收回全局 `fileBrowserUiState`，只有用户点击折叠/展开按钮才改变折叠状态，切换终端只更新侧栏内容目标。
- 服务端构建在文件下载路由处报 `archiver` 没有导出 `ZipArchive`，改默认导入后 Node ESM 又报 no default export：根因是 `archiver` v8 运行时导出 `ZipArchive`，但当前类型声明仍按旧 `export = archiver` 函数形态暴露；修复为 namespace runtime import，并在类型层显式声明 `ZipArchive` 构造器。
- StrictMode 下 WebSocket cleanup 造成假断开提示：CONNECTING 阶段过早 close；修复为等到 `onopen` 后再关闭。
- Playwright 只复用前端导致坏后端环境被误复用：修复为前后端分别做健康检查。
- 多轮 Playwright e2e 后 Vite 或后端 `tsx watch` webServer 因 `EMFILE` / `ENOSPC: System limit for number of file watchers reached` 启动失败：测试反复启动 watcher 命中本机 fd/watch 上限；修复为 Playwright web server 默认设置 `CHOKIDAR_USEPOLLING=1`，后端 e2e 服务改用非 watch 的 `tsx src/index.ts`，并把服务复用改成仅在 `PLAYWRIGHT_REUSE_EXISTING_SERVER=1` 时启用。
- HTTPS dev server 已运行时 Playwright 仍探测 HTTP 或因本地证书失败：修复为支持 `PLAYWRIGHT_FRONTEND_PROTOCOL`，HTTPS 下启用 `ignoreHTTPSErrors`，并给 `terminal-preview` e2e 补齐 HTTPS 证书忽略设置。
- `pnpm dev` / `restart-dev.sh` 页面能起但 API 代理可能错连：后端和脚本默认 `3200/3100`，但 Vite 配置仍写死前端 `3000`、后端代理 `4000`，且没复用 `resolveWebDevConfig`；修复为统一走 `resolveWebDevConfig`，按 `WEB_BACKEND_PORT -> SERVER_PORT -> PORT -> 3200` 解析代理，并同步 `.env.example`。
- Playwright Chromium 缺系统库时浏览器测试无法启动：沉淀了本地 `.deb` + `LD_LIBRARY_PATH` 的 rootless workaround。
- idle cleanup timer 未 `.unref()` 导致 `pnpm -r test` 不退出：修复为统一 `.unref()` 并补 `hasRef() === false` 回归。
- `awaiting_input` 单测在高负载下偶发超时：修复策略是收紧测试 override，而不是改全局默认值。
- `awaiting-input timer retries when the first idle check fires early` 测试在 timer `.unref()` 纪律下失败：测试 mock 的 `setTimeout` 返回数字句柄，没有实现生产代码需要的 `unref()`；修复为假 timeout 提供并断言 `unref()`，继续覆盖早触发重试逻辑。
- `launch does not surface npm config warnings before local Copilot starts` 单测稳定超时：测试依赖当前机器真实 `copilot` 启动文案，没有显式使用仓库 `.playwright-bin/copilot` stub；修复为测试内启用 `PLAYWRIGHT_TEST=1` 并把 stub 目录加入 `PATH`，只断言启动输出不含 `Unknown env config`。
- kanban 里的内嵌 VS Code Web 曾在自签 HTTPS 下出现 PNG 预览 / webview 打不开：根因是 code-server 的 webview / 图片预览链路依赖 service worker，而浏览器不会为不受信任证书注册 service worker。旧 mkcert/OpenSSL 证书方案已废弃，现改为前端开发服务只使用 HTTP，`restart-dev.sh` 不再生成或读取证书。
- shell 逻辑默认依赖 zsh 导致兼容性问题：修复为优先 `SHELL`，再回退到 `bash -> zsh -> sh`。
- tmux 路径只支持单一路径导致不同机器行为不稳：修复为支持 `TMUX_BINARY`、Homebrew 常见路径和 `PATH` 自动探测。
- 端口与代理硬编码导致切换环境易错连：修复为统一改成 env 驱动。
- SSH 远端会话打开 VS Code Web 时总被判定为“不支持”：根因是 `VsCodeWebManager` 之前只覆盖了本地 editor 生命周期。修复为补充 SSH 远端 `code-server` 的启动/复用、健康检查与 `/vscode/` 代理目标切换，先支持像 `10.30.0.24` 这类可被后端直连的远端主机。
- `10.30.0.24` 上 SSH 远端会话已经能返回 VS Code URL，但 iframe 仍只显示 404。根因是三层叠加：VS Code tunnel 继承了 ssh config 里的 `RemoteForward 18888`、远端错误复用了 `.vscode-server/.../code-server` 这类 agent binary、旧错误进程还长期占用 `13338` 端口。修复为让 tunnel 走 configless ssh、远端只用 standalone `code-server`，并在健康检查失败时先清理目标端口上的陈旧监听进程，再启动新实例。
- SSH 远端会话在前端里依然打不开 VS Code，只剩文件浏览器可用。根因是 `App.tsx` 里的 `vscodeAvailable` 仍保留“仅本地会话可用”的布尔门禁；后端远端 `/vscode-web` 已经正常 200，但前端压根不让 SSH session 打开 VS Code。修复为让聚焦态 SSH 会话同样允许打开 VS Code Web，并同步修正文案。
- `10.30.0.23` / `10.30.0.21_host` 这类远端主机仍然打不开 VS Code。根因分两层：一是部分机器没装 standalone `code-server`；二是 remote VS Code 的 configless tunnel 虽然避开了 ssh config 里的 `RemoteForward` 污染，却没有先解析 ssh config 的 alias / port / identity，导致 alias 主机和“IP 但靠 ssh config 改端口”的主机都把 tunnel 连错。修复为在目标机补装 standalone `code-server`，并让 tunnel 在 `ssh -F /dev/null` 前先通过 `ssh -G` 解析真实 `hostname/port/identityfile` 再连接。
- 看板通过本地 `/vscode` 代理打开 VS Code Web 时，HTTPS 页面里的图片预览仍可能加载失败。根因是代理层只把后端看到的 `request.protocol/host` 转发给上游 `code-server`；当前端页面是 HTTPS、后端却是本地 HTTP 代理时，上游会误以为公开入口仍是 `http + 本地端口`，进而生成错误的预览资源来源。修复为让 `/vscode` 代理也优先根据浏览器 `Origin/Referer` 或既有转发头推导公开 `host/protocol`，再透传给上游。
- 本地 HTTPS 已回退到 OpenSSL 自签证书时，VS Code Web 的 webview / 图片预览会继续报 service worker 的 SSL 证书错误。根因是浏览器不会为不受信任的证书注册 service worker，而旧脚本在“复用已有证书”路径上没有持续告警，也不会在之后装好 `mkcert` 时自动升级掉旧自签证书。修复为修正 IP SAN 匹配、为脚本生成的证书记录 generator metadata，并在复用 OpenSSL 自签证书时持续警告；检测到 `mkcert` 后则自动重签为受信任证书。
- 点击 `VS Code保持状态` 后运行中的非聚焦终端窗格仍只显示轻量预览：`vscodeIframeCacheMode` 只保留 VS Code iframe，未同步切换 `useLightweightTerminalPreview`；修复为把 VS Code cache profile 与终端预览保真度联动，保持状态时完整渲染运行终端窗格，省内存时恢复轻量预览。
- commit `fc57a80` 引入的终端焦点保留修复过度：`rememberExternalPointerIntent` 仅对受保护目标记录意图，导致点击非保护元素时终端抢回焦点；`hasIntentionalExternalFocus` 对非保护、非 body 元素直接返回 false 加剧了问题。修复为 pointerdown 统一记录意图 + 纯时间戳比较，不再区分 active element 类型。
- VS Code Web 与终端来回切换两轮后，点击 VS Code iframe 内部无法重新输入：上一版只依赖父文档 `pointerdown` 记录外部意图，但 iframe 内点击不稳定冒到父页面。修复为在父窗口 `blur` 和被动终端聚焦前，根据当前 `document.activeElement` 将 hovered iframe 补记为用户外部焦点意图，并补 VS Code -> 终端 -> VS Code round-trip e2e 回归。
- focus view 点击按钮后，Copilot-like TUI 会收到 `focus-out` 并丢掉紧随其后的输入：按钮等非文本控件被时间戳逻辑误判为有意外部焦点，且 keydown 补救路径可能先发送 stdin、后发送 `focus-in`。修复为 `hasIntentionalExternalFocus` 只保护真实输入面/iframe/dialog 和短暂 body handoff，并在 `TerminalView` 发送 stdin 前同步补齐已聚焦 helper 的 focus report。
- HTTPS 前端里扫描并加入本机 tmux 后 focus view 终端黑屏：后端 scan/add/replay 正常，但前端同源 WebSocket URL 固定生成 `ws://`，在 `restart-dev.sh` 默认 HTTPS 页面下会被浏览器 mixed content 策略拦截。修复为 HTTPS 页面默认使用 `wss://.../ws/...`，HTTP 页面仍使用 `ws://...`，并补 URL 回归测试。
- 轻量预览下浏览器内存和网络仍持续增长：资源诊断显示 `/ws/agent-sessions` 全量快照达到数百 msg/s、数 MB/s；根因是每个终端输出帧都触发一次全量 snapshot，前端持续 JSON 解析和 React 更新。修复为后端对输出触发的 snapshot 做 trailing 合并广播，结构性操作仍即时刷新，并避免 observe-only 会话输出时创建无效 awaiting_input timer。
- 本地 tmux mouse mode 下点击终端会把 `ESC[<...M` / `ESC[M...` 鼠标报告作为字符码输入写进 pane：根因是 terminal WebSocket 对本地 tmux 会话优先使用 `tmux send-keys` 直写 pane，绕过了 `tmux attach` client。修复为识别 xterm mouse report，有附着 PTY 时写回 PTY 给 tmux client 处理，没有 PTY 时丢弃 mouse report，避免注入 pane；普通文本仍保持 send-keys 路径。
- 顶栏终端字号滑杆拖动卡顿：根因是每个 range input 中间值都会立刻更新全局字号，导致所有挂载 xterm 同步执行 fontSize、fit、refresh。修复为 TopBar 维护草稿字号，拖动中只更新控件显示，鼠标松开、键盘调整结束或失焦提交后才应用真实终端字号并持久化。
- 拖动顶栏终端字号滑杆后，Codex-like TUI 松手直接打字没有响应：根因是 range input 被保护为外部输入焦点，鼠标提交字号后焦点仍停在滑杆上，TUI 只看到 focus-out。修复为鼠标提交字号后恢复当前 active terminal 的 xterm helper textarea 焦点，键盘调整滑杆不抢焦点。
- 加入大量 tmux 会话后，宫格页鼠标上下滚动明显卡顿，完整预览模式下更严重：根因是 `AgentGrid` 一次性挂载所有卡片，完整预览会同步创建所有非交互 xterm 和 terminal WebSocket。修复为超过阈值后按可视区域虚拟化渲染，只挂载当前视口附近的卡片，并用共享常量同步虚拟行高与 CSS 卡片高度。
- Codex 长输出在切换/重开终端或 tmux observe 刷新后只能看到最近一小段：根因是 live PTY replay 仅 256 KiB、tmux capture 固定最近 200 行、registry fallback 仅 200 条。修复为把 PTY replay、tmux capture、registry fallback、xterm scrollback 做成可配置较大默认值，并在资源诊断展示 PTY 历史裁剪状态。
- 手机浏览器查看 Codex 长上下文终端时，终端区域下拉会触发浏览器下拉刷新，或只滑动页面不滑动 xterm 历史：根因是桌面页面滚动结构没有锁住根滚动链路；首版 touch 监听在冒泡阶段，遇到 xterm viewport/浏览器手势竞争时拦截不够早，且桌面聚焦页没有启用手机触控模式。修复为新增 `/mobile` 手机终端页锁定 `html/body/#root` 滚动，并让 `TerminalView` 手机触控模式用捕获阶段的非 passive `touchstart/touchmove` 接管单指滑动、滚动 xterm 历史，双指缩放字号；触屏设备的桌面聚焦页也启用同一逻辑。
- 手机访问 `/mobile` 进不去或 404：根因是部分运行入口只暴露根页面或只启动后端，history route 依赖前端服务提供 SPA fallback。修复为手机端按钮改用 `/?view=mobile` 根路径 query 入口，并保留 `/mobile`、`/m`、`#/mobile` 兼容解析。
- 手机端 Tab、Esc、Ctrl+C、方向键等快捷键在部分会话里会变成“控制键 + Enter”或不能作为真实按键送入 Codex：根因是手机端快捷键走已有 stdin 路由，旧的非 PTY runtime 会给任意输入追加换行，tmux 控制路径也把输入按行拆分并总是补 Enter。修复为对 stdin payload 做控制字符识别，普通文本仍可补换行提交，Tab/Esc/Ctrl/方向键和多行粘贴按原始输入转发；tmux 接入路径只转换通用控制字符，不增加 tmux 专用快捷键按钮。
- tmux attach 型终端只能看到当前窗口、滚轮翻不到旧上下文：attach PTY 未预灌 tmux pane 历史，且 tmux client 初始 `CSI ?1049h` 会让 xterm 进入 alternate screen，浏览器 xterm 没有可滚动的旧行。修复为 attach 前 capture-pane seed 到 PTY replay（本地直接 capture，SSH 远端通过非交互 ssh capture），并把 tmux capture 默认对齐到 20000 行、registry fallback 到 5000 条。
- `papers/paper-agent` 投稿目录混入重复源码工作副本，容易误导上传范围：根因是最终投稿三件套生成后仍保留外层 `main.tex`、`references.bib`、`sec/` 副本。修复为只保留 `cover-letter.pdf`、`main.pdf`、`paper-agent-spe-latex-source.zip`、`README.md` 和应用识别用 `project.json`，源码以 zip 内内容为准。
- Paper Writer 项目页侧栏分类过多：`所有项目`、`我的项目`、`已归档`、`回收站` 同时出现，其中开放项目视角与“我的项目”语义重叠。修复为当前运行构建产物只保留 `开放项目` 与 `归档项目`，分别对应未归档未回收、已归档未回收的项目。
- Paper Writer 前端打开后不稳定或打不开：根因是临时加入 `dist/index.html` 的自动同步脚本每 2 秒对所有已加载静态资源做 HEAD 轮询，容易造成大量请求、reload 或卡顿；修复为移除当前运行入口的轮询脚本，恢复只加载主 JS/CSS。
- Paper Writer 进入编辑器页时报 `Something went wrong / missing ) after argument list`：根因是手改构建产物新增预览翻译 hook 时多了一个闭合大括号，导致 `EditorPage` 懒加载模块在 Chromium 中解析失败；修复为删除多余 `}`，并用浏览器动态 import 与 `/editor/moe_prune` smoke 验证。
- Paper Writer 预览翻译时报 `ENOENT ... preview-translate-*.json`：根因是前端把随机临时字符串当成 conversation id 传给 `/api/ai/send`，后端按该 id 读取会话文件时找不到 JSON；修复为复用当前会话，或先创建真实 `Preview Translate` 会话再调用 AI 接口。
- Paper Writer 8787 服务停掉后无法重启，前端完全打不开：根因是当前运行目录缺失 `app/apps/backend/src` 与 ESM `package.json`，且 LLM 配置未落到后端读取的本地 `.env`，服务启动时先因源码缺失/恢复噪音失败，随后因空 API key 退出；修复为从 coverage 产物恢复后端源码、清理 Istanbul 标记、补 backend ESM package，并把本机配置同步到被 git 忽略的 `app/apps/backend/.env` 后后台启动。
- tmux 扫描弹层上的滚轮误滚后方单屏终端：TerminalView document-level wheel 兜底按坐标命中终端，未排除 discovery overlay。修复为 wheel 目标在 `.discovery-overlay` 内时跳过终端兜底，让扫描结果列表正常滚动。
- 新建会话弹窗覆盖终端卡片时滚轮失效并穿透到后方内容：document-level 终端滚轮兜底只排除了发现弹层，没有排除 `.new-session-backdrop`。修复为统一识别两类弹层目标并跳过终端接管，同时用 `overscroll-behavior` 隔离弹窗与背景的滚动链。
- `restart-dev.sh` 返回成功后服务端口断开：普通 `nohup` 未稳定脱离调用 session，且前端默认端口与文档/期望不一致。修复为 `setsid ... < /dev/null` 后台启动前后端，前端默认 `8484`，并把 `WEB_BACKEND_HOST/WEB_BACKEND_PORT` 显式传给 Vite。
- 多屏切换已打开 Codex 的 tmux/PTY 终端后出现 `[I`/`[O` 与方向键字面量 `OA`/`OB`/`OC`/`OD`：active PTY replay 不应重放终端输入模式开关；本地 tmux 路径要让 focus/mouse report 走 attached PTY，并把 application-cursor 箭头 `ESC OA/B/C/D` 映射成 tmux 方向键，不能用 send-keys 字面量注入 pane。
- `restart-dev.sh` 默认值漂移会让服务重启到 HTTPS/3100：脚本、`.env.example`、Vite dev proxy 必须统一 HTTP/8484 + backend 4000；`scripts/*.test.mjs` 要纳入根 `pnpm test`，否则脚本默认值回归不会被全量测试发现。
- 多屏 sidebar 双击替换 Codex tmux pane 时出现 `[I` 且替换反弹：本地 tmux 路径不要把 `ESC [ I/O` focus report 写进 attached PTY 或 send-keys，应直接丢弃；sidebar 卡片不能同时立即处理 click 和 dblclick，需让双击取消延迟单击，避免第一次点击替换后第二次点击命中新换出的旧会话。
- 当前终端右键粘贴后出现 `[200~` / `[201~`：xterm bracketed paste 包装符经本地 tmux `send-keys` 路径被拆成 Escape + 字面文本。修复点是 `LocalTmuxAdapter.buildTmuxSendKeySteps` 在 send-keys 前剥离 `ESC[200~` / `ESC[201~`，同时保留正文、Enter/方向键等既有映射；回归覆盖单元解析和 WebSocket 注入到真实 tmux pane。
- `Shift+Left` 等修饰键组合在本地 tmux 终端里变成 `[1;2D` / `D`：xterm 发出 `ESC[1;2D`，但 `buildTmuxSendKeySteps` 只识别普通箭头，导致 send-keys 路径把 ESC 和字面量拆开注入 pane。修复为将 xterm modified cursor/navigation CSI 序列映射成 tmux key name（如 `S-Left`、`C-Right`、`C-S-Down`、`S-PPage`），并保护前后端过滤层继续原样转发这些键序列。
- Codex 会话中右键粘贴多行内容被逐行提交：上一版剥离 bracketed paste 起止符后，区块内换行重新落入 `Enter` 映射。最终修复为完整保留 `ESC[200~ ... ESC[201~` 区块并作为单个 literal 发送给 tmux，区块外换行仍保持 Enter 语义。
- Codex 会话多行右键粘贴的 bracketed paste 可能被 WebSocket/xterm 分成多帧：tmux 输入转换必须按 session 记住 `ESC[200~` 已打开，直到看到 `ESC[201~` 才恢复普通 Enter 映射；不要只依赖单个 stdin payload 内完整匹配 paste 区块。
- Kanban VS Code Web 启动失败但 `code-server` 实际可用：另一个项目占用了默认 `4000/8484`，当前仓库后端在 `4000` 反复 `EADDRINUSE`，前端代理错连外部服务；已清理当前仓库陈旧 watcher，用 `SERVER_PORT=8282 WEB_PORT=8584` 验证可用实例，并让 `restart-dev.sh` 在重启时强制回收目标 `SERVER_PORT/WEB_PORT` 上的监听进程。
- 聚焦视图右侧“其他会话”数量增加后卡片被越挤越小，第一版固定卡片高度后又会过早滚动且显得过大：侧栏 flex 链路高度约束不完整，且缺少卡片指定最小高度策略；修复为超过阈值开启紧凑滚动模式，卡片和终端预览先压缩到最小高度，真实溢出后再滚动。
- 文件浏览器列表缺少 Owner 且列宽固定：`FileEntry` 未携带 owner，前端表头/行使用固定 grid；已从本地 uid 和 SFTP longname/uid 补 owner，并给名称、大小、修改时间、Owner、权限列增加可持久化拖拽列宽。
- VS Code Web 编辑器中文 IME 标点无法输入：中文/英文字符和英文标点正常，说明不是整体丢焦；问题集中在 VS Code Web/EditContext 的 CJK 标点提交路径。修复为本地和 SSH 远端 code-server 的 managed settings 都写入 `editor.editContext=false` 与 `editor.experimentalEditContextEnabled=false`，回到稳定输入路径，并用 `vscode-web-manager` 测试覆盖本地 settings 与远端启动脚本。
- Kanban tmux 卡片第一次改名后再次改名可能无反应：如果第一次显示名包含 `:`，tmux 会把 session 名规范化或把冒号当 target 分隔，但 registry 仍保存原显示名到 `transportRef.tmuxSession`，第二次改名 target 错误且前端吞掉异常。修复为改名前后通过 pane id 查询真实 `#{session_name}`，registry 保存真实 tmux session，显示名和 pane title 保留用户输入；前端改名失败弹出错误。
- SSH 远程终端连接成功后立即退出且原因不可见：启动路由此前先创建 SSH PTY 并返回 `201`，没有验证远端目录、交互式 PATH 中的 Agent 或 tmux，前端还会把具体 API 错误覆盖成会话名。修复为注册会话前执行有时限的 SSH 预检，按目录、Agent、tmux 或连接错误返回结构化消息，前端原样展示；预检后的运行期退出继续保留 exited 卡片、终端输出和退出码。
- 删除 tmux 后“历史会话部分恢复失败”通知永久停留：失败分支缺少关闭按钮，自动关闭逻辑只覆盖 `restore-complete`。修复为失败通知增加 `×` 并在 10 秒后自动消失，成功通知保持 5 秒，恢复中通知不自动关闭；effect cleanup 负责取消状态变化后的旧定时器。
- tmux 中 Codex 的 macOS `Option+Space` / Windows `Alt+Space` 无法作为换行快捷键：xterm 默认未把 macOS Option 当作 Meta，后端又把 `ESC+Space` 拆成 Escape 与空格；修复为开启 `macOptionIsMeta`，并把 Meta+Space、常用 Meta 字母/数字原子映射为 tmux `M-*`。Windows 窗口管理器若先占用 `Alt+Space`，使用现有 `Shift+Enter` 作为跨平台备用。
- tmux/Codex mouse tracking 已开启时当前 pane 仍无法滚轮控制：此前为避免 wheel 变成输入历史方向键，在 capture 阶段无条件阻断所有 wheel，连合法鼠标协议也被吞掉；修复为普通 wheel 在交互 mouse-tracking 终端中放行给 xterm/tmux，`Shift+wheel`、普通 shell 和非输入 pane 仍滚本地 scrollback，并把 E2E 从“点击后总帧数增加”收紧为真实 wheel code `64/65`。
- 返回宫格后双击卡片终端区域偶发无法再次进入主窗口：仅等待最终 `dblclick` 时，终端焦点接管或命中节点变化可能让浏览器不再向同一卡片派发双击。修复为卡片在捕获阶段识别第二次主键按下并立即聚焦，过滤按钮、输入框、分组下拉等真实控件，并允许 xterm helper textarea 触发聚焦。
- 看板长时间运行后浏览器内存再次增长：真实轻量宫格仍接收约 4.2 次/秒、84 KB/s 的全量会话快照，累计产生大量 JSON/React 分配；保持状态还可保活 8 个 code-server iframe，VS Code 响应缓存无上限。修复为输出快照默认约 1 Hz、诊断增加 64 KB/s 吞吐阈值、iframe 上限降至 3，并把历史打开响应限制为最近 16 条。
- Markdown 文件中的 LaTeX 公式显示为源码：原渲染链没有数学 AST；而 `remark-math` 只识别 `$...$` / `$$...$$`，目标论文使用 `\(...\)` / `\[...\]`。修复为接入 KaTeX 链路，并仅在非代码 Markdown 区域规范化反斜线分隔符；目标文件完整生成 93 个 KaTeX/MathML 节点且无公式错误。
- Markdown 预览打开后整个看板持续卡顿：重型 Markdown/KaTeX 与编辑器同包加载，预览随 session snapshot 重复解析，弹窗和后方抽屉还会同时渲染两份。修复为 Markdown 默认编辑、手动加载预览、重型渲染器懒加载并 memo、分屏使用 deferred content，弹窗打开时卸载后方预览实例。

## PM 审计增强 (2026-06-16)

- #32: shellQuote/formatWorkingDirectory 去重 → 提取到 shared 包，三处改为导入
- #21: 宫格空态引导增强 → 三步快速入门指引
- #29: 聚焦视图折叠标题栏 → 显示状态徽标+agentKind
- #16: 快速连接 tmux 记忆历史 → localStorage 保存最近 8 条连接
- #20: 聚焦视图侧栏会话搜索 → 支持按名称/类型/目录模糊过滤
- #19: 会话标签/分组 → AgentSessionRecord.tags + FilterBar 标签筛选器
- #23: 文件浏览器拖拽到终端 → 文件条目 draggable + TerminalView onDrop
- 聚焦视图中会话进入大屏监控后从右侧分组卡片消失：根因是 sidebar 数据源排除了 `terminalSlots` 中的会话，卡片也没有窗格序号和活动状态。修复为全部未隐藏会话继续混在原分组中，监控卡片显示窗格序号，活动大屏与卡片同步黄色高亮；点击已监控卡片只激活原窗格，未监控卡片保持替换行为。
- 热更新恢复中的本地 tmux 输入路由错误：普通输入和分帧 paste 走 attached PTY 会干扰 TUI 与前缀命令；修复为普通输入走 pane，鼠标及 `Ctrl+A` / `Ctrl+B` 前缀和下一条命令走 attached PTY，REST/WebSocket 共用有序路由。
- reload 后持久化焦点过早被清空：首个真实 session snapshot 尚未到达时就校验稳定 ID；修复为等待加载完成且 snapshot 存在后再清理无效焦点。
- 会话状态文件被时间戳和运行态持续触发写入：修复为只指纹稳定元数据，并把持久化连接/交互态规范化为离线恢复态。
- 多标签页可重复恢复同一 tmux 并互相重建 PTY，版本轮询也会重复执行 Git 扫描；修复为 managed restore 和 Git fingerprint 增加后端 single-flight 与缓存。
- 首次迁移原样写入旧 API 快照，会暂存终端输出、PID 和 runtime id；修复为捕获脚本先投影稳定字段再原子写盘。
- 状态文件写入失败会阻止后端启动，重复 session ID 会静默覆盖卡片；修复为写入错误降级为日志并拒绝重复 ID 状态文件。
- 热更新 WebSocket 关闭、重连或恢复时可能遗留 tmux 前缀和跨帧 paste 状态；修复为把 Escape/paste 清理作为 session 输入队列屏障，并在破坏性生命周期前等待，只读预览关闭不清理。
- 大型 tracked diff 超出 Git 输出缓冲区、未跟踪大文件先整体读取会让版本检测失效或占用过多内存；修复为 tracked diff 流式哈希、未跟踪文件循环有界读取，并确定性终止超时 Git 子进程。
- 首次迁移捕获失败仍继续停止本仓库后端会丢失会话目录；修复为仅对仓库归属监听器强制迁移成功，失败时在 kill 前退出，并严格校验正整数 PID。
- 受管 tmux attach 和显式 direct 命令经用户登录 shell 执行时可能被 `.zshrc` 自动启动的 Agent TUI 劫持；修复为两类命令通过非交互 `/bin/sh -c` 执行，仅无命令终端保留用户原生交互 shell。
- 更新提示长期遮挡终端；修复为按 revision 记忆关闭状态，新版本重新提示。恢复成功提示支持主动关闭并在 5 秒内自动隐藏，失败提示保留。
- 单个 tmux window 内鼠标选中右 pane 后输入仍进左 pane：鼠标经 attached client 更新了活动 pane，但普通输入继续向接入时保存的固定 `tmuxPane` 执行 `send-keys`；修复为鼠标或前缀命令后改用 session 级动态目标跟随当前活动 pane，连接清理时重置该跟随状态。
- 扫描、新建或接入 tmux 后标题出现 `tmux:dev (bash)` 或远端路径后缀：根因是 adapter、scanner 和加入路由把传输/命令/主机元数据拼进 `displayName`；修复为用户可见标题统一使用真实 tmux session 名，内部 ID 与结构化元数据保持独立，旧状态只迁移可确定的系统生成标题，并在宫格与聚焦侧栏用独立低调的 `tmux` 标签标识传输类型。
- Safari 中快速连续输入会间歇漏字：WebKit 可能在 xterm 仍记录活动 `keydown` 时派发 composed `insertText`，而 xterm 6 的单一 `_keyDownSeen` 状态会把仍有效的文本事件判为已处理。修复为仅在 Safari 对比短时 xterm `onData` 与原生 `insertText`，只补发缺失字符；状态过期、控制序列、IME composition 和其他浏览器不会进入补发路径。
- 受管 tmux 重连后 pane 与 Codex 仍存活但 Kanban 会话离线、无法输入：旧 PTY 的迟到 `onExit` 按稳定 session ID 删除了新 handle 并覆盖为 exited。修复为本地/远程 PTY 的 data/exit 回调必须先验证自己仍是当前 handle，被替换 runtime 的迟到事件全部忽略。
- Kanban 内嵌 VS Code 提示无法读取浏览器剪贴板：iframe 未委派 clipboard 权限，代理也未声明同源策略。修复为 iframe 增加 `clipboard-read; clipboard-write`，`/vscode/*` 在保留上游其他 Permissions-Policy 指令后追加两项 `(self)` 剪贴板策略。
- 聚焦视图右侧轻量预览空白、竖线或出现 `(B`：PTY 最后一个数据块可能只有 TUI 光标、擦除、边框、短文本碎片或字符集切换，却覆盖了已有可读 `outputPreview`。修复为服务端清理控制序列和框线，只用包含足够可读字符的行更新预览，并对受管 tmux 使用更严格的短碎片阈值；纯绘制块继续用于活动检测但保留旧文本，前端同步清理 `ESC(B` / `ESC(0`。
- 用户在后台 Git 检查尚未结束时确认拉取，apply 曾被 single-flight 误合并为 check。修复为 apply 排队等待 check，随后只执行一次用户确认的 fast-forward；并发 apply 继续共享结果。
- Codex 的黄色 `(jump to forward)` 在 Kanban 中无法用方向键关闭：attached client 已切到新 pane，但输入路由尚未收到鼠标或前缀事件，普通按键仍写入持久化旧 pane。修复为 attached PTY 存在期间从首次普通输入起以 tmux session 为动态目标，持续跟随实际显示 pane；PTY 不存在时才回退固定 pane。
- 局域网 Safari 允许临时绕过 Kanban 证书警告，但 VS Code WebView 的 Service Worker 仍因 SSL 失败：远端设备没有信任开发机的 mkcert CA，顶层页面例外不适用于 Service Worker。修复为 iframe 前置 Service Worker 探测，失败时提供 CA 公有证书下载、Safari/macOS 信任步骤和重试；启动链只暴露能验证当前叶证书且重新编码后的 CA 公有证书，绝不暴露私钥。
- 证书信任后 VS Code 扩展宿主仍可能握手超时：浏览器 WebSocket 已打开时 code-server 上游还在 CONNECTING，旧代理静默丢弃首批初始化消息。修复为用 1 MiB 有界队列保留并按序冲刷握手期消息，超限显式关闭。
- VS Code iframe 与终端之间的分隔条拖动严重卡顿：每个 mousemove 都重渲染整个 App、写 localStorage，并让 xterm 排入多次 fit；鼠标进入 iframe 还会切断父页面事件。修复为 pointer capture、按动画帧直接写面板宽度、松手单次提交状态，并在拖动期把终端 fit 延后到 trailing 收尾。
- tmux 前缀后的 client prompt 不能只识别 `:`：`zhuanli` 实际卡在 `Ctrl+B ,` 打开的 `(rename-window)`，后续输入错误恢复到 pane；主机 `status-keys vi` 下 Escape 又只切换编辑模式。修复为查询当前 prefix key table，所有 `command-prompt` / `confirm-before` 绑定持续走 client PTY，Enter 提交、Ctrl+C/cleanup 取消；裸 Ctrl+C 也走 client，以恢复服务重载后内存状态已丢失的 prompt。
- 源码热重载会把 node-pty 创建的 `tmux attach` 留给 PID 1，`zhuanli` 曾累积 7 个孤儿 Kanban clients。修复为 SIGTERM/SIGINT 先 `app.close()`，Fastify onClose 调用 `PtyRuntimeManager.dispose()` 清理全部受管 PTY；现场 detach 6 个历史孤儿后，只保留当前 Kanban client 和用户手工 attach。
- 聚焦页右侧完整终端预览会吞掉 wheel 并滚动小终端内部历史：`interactive=false` 不会禁用 xterm 自身 wheel listener。修复为侧栏预览启用 `wheelPassthrough` 和被动 pointer 命中面，让滚轮只滚动外层“全部会话”列表。
- 多终端分组切换器点击非输入窗格的“当前”项会意外抢走输入权：自定义选项对已选值仍执行 slot 回调，且 portal 事件时序可能改变回调读取的活动状态。修复为弹层打开时冻结同步意图，当前项只关闭弹层并恢复触发器焦点，不更新 slot 或聚焦状态。
- 多终端分组切换器通过 portal 挂载后，document 级终端滚轮兜底会抢走列表 wheel，导致只能看到顶部选项并像是没有分组。修复为把切换器弹层纳入终端滚轮阻断目标；E2E 同时断言 3 个直接分组容器、组名/数量和真实鼠标滚动。
- 文件系统双击 Markdown 后，独立文件弹窗的滚轮会被 document 级终端兜底按坐标路由到后台卡片，导致文件内容不滚而终端滚动。修复为把 `.file-browser-modal` 纳入终端滚轮阻断目标，并对弹窗、预览和编辑器设置滚动链隔离；单元测试覆盖目标识别，Playwright 验证长文档预览真实滚动。
- 聚焦页彻底删除当前终端后，删除流程曾把主窗格持久化到 `closedSlotIds`，导致返回宫格再双击其他卡片时新 session 被旧关闭标记清空。修复为删除不再关闭窗格，并在明确进入聚焦页时重新开放活动窗格、放入目标 session，兼容自愈已有 localStorage 坏状态。
- 多终端分组切换器的标题虽然声明 sticky，但父分组的 `overflow: hidden` 让标题无法相对外层列表吸顶。修复为改用不建立滚动祖先的 `overflow: clip`，当前标题固定到下一组标题上推替代；E2E 用实际边界坐标覆盖两阶段行为。
- 多窗格局部 `activeSlotId` 与 App 级 `focusedId` 曾因侧面板条件同步而分叉，导致输入已到新窗格但标题、文件或 VS Code 仍引用旧会话。修复为所有改变当前输入目标的入口统一同步顶层焦点，重复选择非活动窗格的当前项继续不抢输入；侧栏 E2E 点击明确的会话名称，避免误命中同一标题行内的分组下拉框。
- 终端 WebSocket 在后端热重载、代理闪断或网络中断后曾只显示断开提示而不重连，导致 xterm 有焦点但所有输入被静默丢弃。修复为挂载中的 `TerminalView` 使用 250ms 到 5 秒有界退避自动重连，replay 完成后恢复输入、resize 和焦点；卸载时取消待执行重连。
- Vite 代理异常时终端 WebSocket 可能永久停在 `CONNECTING`，原有 `onclose` 重连无法触发，xterm 会因等待 replay 一直禁用 stdin。修复为 3 秒握手超时主动关闭并复用退避重连；重启脚本把公开 LAN 地址与同机代理上游分离，默认代理 `127.0.0.1`，仍支持 `.env` 显式远端后端。
- 居中的版本更新提示在 1280px 桌面宽度覆盖顶栏字号滑杆，整个 fixed `aside` 即使空白区域也会截获鼠标。修复为提示容器 pointer-events 透传，只给更新、重试和关闭操作区域恢复点击；Playwright 字号拖拽用例在实际覆盖坐标下回归通过。
- `.env` 中未加引号的空格值（如 `PORTAL_NAME=Coding Kanban`）会被 `restart-dev.sh` 的两次 `source` 当作 shell 命令执行并中断重启，且脚本会在加载 `.env` 前把 `SERVER_PORT` 固定为 4000，忽略 `PORT=8282`。修复为单次安全 dotenv 赋值解析，并在解析后计算端口默认值；保留空格、拒绝格式错误/未闭合引号且不执行配置内容。
- Codex 长输出的中间内容无法靠增加 tmux/xterm scrollback 恢复：TUI 会用擦除行和光标定位原地覆盖屏幕，终端历史不是追加日志。修复为聚焦页增加本机 Codex“完整记录”视图，从 `~/.codex/sessions` JSONL 按序展示 user/assistant 与完整工具调用输出；接口不接受外部路径，优先 session ID、否则按工作目录匹配并明示推断，远端首版禁用。
- 完整记录仍展示 `exec` 输入输出：服务端此前只过滤 `exec` 调用，未按 `call_id` 过滤关联输出，前端兼容层也只识别调用标题。修复为前后端同时隐藏 `exec 调用` 和 `exec 输出`，其余记录继续按最新在前展示。
- 手机文件系统曾把所有 UTF-8 文件统一显示为原始 `<pre>`，且预览容器没有受控高度，导致 Markdown 不渲染、长文档触屏滚动不稳定。修复为桌面与手机共享 Markdown 类型判断，手机端复用懒加载 GFM/KaTeX 渲染器，并将预览区设为受控高度的独立 `pan-y` 纵向滚动容器；表格、代码块继续横向滚动。
- 大文件预览仅能看到开头：根因是本地/SFTP 预览只读字节 0 的固定前缀。修复为共用 `offset` 有界窗口协议，手机端按 64 KiB 前后切换且只保留当前段，服务端硬限 256 KiB 并保护 UTF-8 字符边界。
- 手机大文件虽有 `nextOffset` 但看不到“下一段”：根因是预览内容按整个视口计算固定高度，将下方分段条挤出可见区，而内层滚动链隔离让外层无法追上。修复为工作区剩余高度内的标题/路径/分段条/滚动内容四行网格，分段按钮始终可见。
- Codex 完整记录曾一次挂载全部条目，长会话即使延迟 Markdown 解析也会因大量 DOM 和观察器而卡顿。修复为保持最新记录在前，首次只挂载 30 条，批次末尾由“继续加载”每次手动追加最多 30 条较早记录，滚动不会自动扩充 DOM。
- 名称包含 `.` 或 `:` 的受管 tmux 会被 tmux 实际规范为 `_`，但 registry 旧值曾让 client 就绪检查和 `send-keys` 同时指向不存在的 target，表现为终端可见但英文无法输入。服务端现在统一规范启动、重连、恢复与改名的 tmux 传输名，同时保留用户自定义显示名。
- 手机端为了让多行输入框稳定使用软键盘而不让 xterm 直接接管 stdin，xterm 从未获得焦点；tmux replay 又只有屏幕绘制和最终坐标、没有光标初始化序列，导致 `isCursorInitialized=false`，仅修改失焦光标形状不会生效。触控监控终端现在于 `open` 后同步执行一次公开的 `focus → blur` 初始化并归还原焦点，活动/失焦均使用高对比度下划线；方向键调整已粘贴文字时能看到编辑位置，输入路由不变。
- 多屏中点击 xterm helper textarea 会让浏览器焦点进入新终端，却曾被窗格捕获逻辑按普通 textarea 排除，导致 `activeSlotId` 和完整记录仍指向旧终端；完整记录还保存了打开瞬间的会话对象。现在 helper textarea 可激活窗格，普通表单仍受保护；完整记录只保存开关并持续从当前活动窗格派生，以会话 ID 重建弹窗和请求视图。
- 全屏 Diff 曾嵌在主布局的低层叠上下文中，fixed 子层无法越过顶栏，导致“退出全屏”被遮挡。现在全屏视图通过 React Portal 挂到应用模态层，保留 Escape、焦点管理、手机安全区和独立按钮样式。
- 变更还原曾以文件为粒度调用 `git restore`，一个文件多处修改时无法只撤销目标位置。现在 Diff 按 `@@` 改动块提供悬停/聚焦还原入口，服务端重新读取实时 diff 并校验路径、块序号和块头，再构造反向补丁；同文件其他块、重命名状态均保留，暂存/未暂存混合、新增文件和过期块均有回归覆盖。
- 同一目录内多个 tmux 未绑定 Codex session ID 时，完整记录曾全部按目录命中最近 JSONL；切换同一 tmux 的活动 pane 后还会继续显示注册时固定 pane 的历史。现在本地 tmux 先校验 Kanban PTY 对应的 client PID，再从 session 当前活动 pane 的 `/proc` 进程树和打开文件中解析工作目录一致的顶层 Codex session，排除 subagent 并回写精确绑定；新 Codex 短时关闭 rollout 文件句柄时，仅对明确运行 Codex 的 pane 做工作目录回退；活动 shell pane 不回退旧 Codex，只有无活动 Kanban client 时才回退既有 ID/目录匹配；弹窗低频探测 session ID 并在切换后替换视图。同目录 `qwen3_8-27b` 与 `vllm-merak` 现场验证得到不同 ID。
- 拉取远程代码后 `tsx watch` 可能先重启服务端，再读取旧的 `packages/shared/dist`，导致新 import 报共享包导出不存在、后端退出；带 watcher 参数的旧进程还可能未被旧正则清理。服务端现在启动前先构建共享包，watcher 监听源码并排除 dist，重启脚本按完整命令清理旧 watcher。
- 远程同步曾把跨帧 bracketed-paste 测试期望改成去掉 `ESC[200~`/`ESC[201~`，与既有 Codex 多行粘贴协议不一致；恢复完整区块断言，运行时保留标记避免换行被逐行提交。
- `research` 切到最后的 `pre_smooth_vq` pane 后完整记录仍显示旧的 `moe_quant`/CRISP 会话：卡片旧 `workingDirectory` 过滤掉活动 pane 的 JSONL 后又触发旧目录回退。现在活动 Kanban client 使用 `/proc/<pane_pid>/cwd` 作为 Codex 定位目录，并覆盖打开句柄与关闭句柄回退；新增活动目录不一致和现场 VQ session 回归。
- tmux copy-mode 拖动选择失效：输入过滤器把有按钮的 SGR `32/33/34` 拖动 motion 与无按钮 `35` hover 一起丢弃，tmux 无法完成 `MouseDrag1Pane` 选择。现在按 SGR bit 位仅过滤 hover（含修饰键变体），拖动按下/移动/释放经 attached PTY 保序转发；可控大屏 xterm 捕获阶段屏蔽浏览器右键菜单，真实 WebSocket+tmux 回归确认 copy-mode 返回 OSC52 剪贴板。
- Codex 完整记录按倒序和底部按钮翻页，不符合从最新消息向上回看旧消息的阅读习惯：前端改为正常时间顺序，首次定位到底部，滚动接近顶部自动加载更早页并补偿 prepend 高度保持阅读位置；保留手动按钮和 90/300 条窗口上限，组件测试覆盖阈值、顺序和锚点。
- 分组监控排列曾受固定自由槽位限制且滚轮被单个 xterm 消费：新增自由/分组排列持久化，分组按组内会话生成动态窗格，超出容量由外层布局按帧合并滚动；普通滚轮浏览整体、Shift/⇧ 滚轮浏览当前 xterm、Ctrl/⌘ 保留浏览器行为，分组切换器仅允许同组，并覆盖单屏禁用、活动窗格和浏览器 E2E 回归。
- 桌面文件浏览双击文本/Markdown 不再打开遮挡终端的覆盖弹窗；左侧文件面板现切换为全高内联预览并提供返回列表，文本编辑与 Markdown 渲染/源码/分屏复用同一实例，右侧终端持续可见，手机端不变。
- 分组标题曾与普通卡片文字相似：统一改为居中、加粗的代码风格标题，增加分组色带、弱光晕、边框和计数徽标，并按看板主列/聚焦侧栏分别适配字号；Playwright 覆盖标题居中、字号、字重和颜色一致性。
- 聚焦视图每个窗格的会话切换标题曾过小且不易发现：提升按钮高度、字号和对比度，当前输入窗格使用橙色高亮并增加点击提示；Playwright 覆盖样式和点击打开切换菜单。
- 完整记录曾只允许本机 Codex：远端 SSH/tmux 请求现在通过登记的 sshTarget 使用 SFTP 在目标主机读取 ~/.codex/sessions，按 session ID/工作目录选择并用有界字节分页；不会把远端请求回退到本机文件，服务端路由和 SFTP 回归已覆盖。
- 完整记录初次定位到底部后，程序化滚动只触发 scroll 而没有 pointer/wheel 事件时会绕过初始 pin 并继续加载更早页面，避免分页被初始状态永远拦截。
- 多屏左右切换曾无条件改写 App focused session，布局归一化又按旧 focused session 把 active slot 改回，造成额外 `/focus` 快照刷新；现在无侧栏只切换 active slot，侧栏打开才同步全局焦点，active terminal 回调不再重复确认。
- 自由排列从多屏缩到单屏曾直接截断 slot 数组并卸载其余 xterm，扩屏后所有历史和 WebSocket 都要重建。现在聚焦页保留本页已实际挂载的最多八个手动窗格，缩屏用明确的 `.focus-terminal-pane[hidden]` 规则将多余窗格移出布局（避免基础 `display:flex` 覆盖 HTML hidden），单屏仅展示一个终端，扩屏继续复用；会话删除/移动会去重清理，隐藏零尺寸期间跳过 fit/resize，避免错误改写 tmux 尺寸。
- Markdown 全屏预览通过 Portal 覆盖终端时，后台 xterm 的 document-level wheel 兜底曾按坐标接管滚轮，导致渲染文档无法滚动。现在 `.file-browser-fullscreen-preview` 纳入终端滚轮阻断目标，全屏渲染区、目录和编辑器各自保留原生滚动，事件不再穿透到后台终端。
- 桌面内嵌 VS Code 的 iframe 虽已被 `TerminalView` 保护，聚焦视图的布局同步 effect 仍会绕过该保护并直接聚焦 xterm，导致点击编辑器后焦点稍后被抢回。现在该 effect 同样把 iframe 视为外部输入面，只有用户重新点击终端才切回输入权；回归用例等待超过被动修复周期验证焦点稳定。
- 版本可用、远程可用、冲突和检查失败不再显示占空间的大横幅，统一改成左上角 `24px` 状态灯；状态灯不点击就常驻小尺寸，点击直接更新/拉取/重试，详细版本或错误仍通过 title 与无障碍名称提供。
- Markdown 渲染预览选中文字后很快消失并非内容刷新，而是聚焦页的终端兜底入口会连续三次聚焦 xterm 隐藏 textarea，从而折叠浏览器选区。现在每次同步和延迟聚焦前都检查非折叠 `Selection`，选区存在时不抢焦点；点击终端令选区自然折叠后仍可恢复输入。
- 电脑端图片确认窗口曾缺少显式取消，而当前 Codex CLI 虽在 `queue --help` 声明 `-i`、运行时却拒绝图片附件，导致所有发送失败。现在窗口提供“取消”；服务端原生图片投递失败且错误明确为不支持时，自动向同一 thread 投递可信临时路径，让 Codex 使用图片查看工具读取，并按本机/SSH 目标缓存能力、延迟最多 24 小时清理。
- 电脑端在 xterm 隐藏输入框粘贴截图时，图片可能只出现在 `DataTransfer.items`，且原始 `Ctrl/Cmd+V` 会抵达远端 Codex，导致其尝试不可达的服务端 X11 剪贴板并超时。现在终端把粘贴快捷键交还浏览器，图片同时从 `files/items` 提取并进入确认窗口，普通文本仍由 xterm 原生 paste 通道发送。
- 完整记录虽然已按约 30 条分页，消息正文仍逐条等待接近视口才渲染，向上阅读会不断遇到占位内容。现保留渲染器代码分包和 90/300 条窗口上限，只移除记录条目的 `deferUntilVisible`：每个已返回分页立即整批渲染，新加载的约 30 条也一次完成。
- 电脑端完整记录过去只能通过 Portal 大弹窗覆盖终端，无法边看记录边操作当前会话。现将其提升为 App 级 `SidePanelTool`，复用文件系统的可调宽、可折叠左侧工作区，并随多屏当前输入终端切换数据源；共享记录组件保留 Markdown 和游标分页，面板建立键盘隔离，关闭记录时默认回退当前会话文件系统，手机端仍使用原模态弹窗。
- 桌面完整记录侧栏的文字选区会被 xterm 自己的 `focusout`/500ms 被动焦点修复折叠：记录正文现接管非输入焦点，`TerminalView` 把侧栏键盘隔离边界视为受保护阅读面，并在存在非折叠文档选区时停止被动聚焦；正文显式启用原生选择，点击终端仍可立即恢复输入。
- 聚焦视图的全局键盘捕获声称把 `Esc` 留给弹窗，却会在 `window` 捕获阶段阻断所有非终端目标，导致分组窗格切换器进入“跳转/交换”二级操作后无法按 `Esc` 返回。现对 `dialog` / `alertdialog` 内的事件和焦点显式放行，切换器自身在捕获阶段读取最新二级状态并返回候选列表，避免 portal 重绘后的焦点过渡让快捷键失效。
- 2026-09-07：完整记录全屏滚轮被底层终端 document 捕获拦截；终端滚轮避让列表补充 `.agent-transcript-fullscreen-backdrop`，浏览器回归覆盖重叠区域上下滚动和 Esc 退出。
- 2026-09-07：飞书卡片正文由 plain_text 改为 Card 2.0 markdown；保留纯文本元数据，跨片代码块闭合并重开围栏，飞书 at/person 标签转义，避免源码直出和意外提醒。
- 2026-09-10：飞书把带格式或多段回复标记为 `post` 时，回复服务过去因只允许 `text` 而在绑定检查前忽略。现仅对可信私聊、有效卡片回复开放 `text`/`post` 可读文本，并复用既有长度、控制字符、会话可用性与去重校验；图片等非文本消息仍拒绝。
- 2026-09-10：飞书第二层回复的 `reply_to` 指向上一条用户消息而非原通知卡片，过去因用户回复没有会话绑定而被判为 `ignored_unbound`。现仅在 Codex 队列确认成功后，原子保存该用户消息继承的 session/thread 绑定与去重状态；直接父消息尚无继承绑定时仅按事件中仍有本地绑定的精确 `root_id` 恢复升级前回复链，不查询历史或猜测目标。连续回复保持同一对话，投递失败和普通无绑定消息不建立绑定。
- 2026-09-12：多会话完整卡片预览会并发建立 xterm/WebSocket，并让无界桌面 replay 以单个多 MiB JSON 帧堵塞长期运行的 Vite 代理，手机终端随后可能一直空白；看板和侧栏现固定轻量预览，桌面/旧客户端由服务端硬限最近 512 KiB、手机限 256 KiB，断线展示自动重连与手动重试。
- 2026-09-12：手机“当前会话”虽然能成功建立 WSS 并收到回放，但 `.mobile-terminal-surface` 的 `flex: 1` 没有处在有效 flex 高度链中，终端容器可能折叠为零；现让当前会话内容、session view 和终端区域逐级占满剩余视口，同时保留其他手机页面的独立滚动。
- 2026-09-12：部分手机只临时放行开发 HTTPS 页面，却在 TLS 阶段拒绝同证书 WSS，后端完全看不到终端请求；现保留原 8484 HTTPS 地址和 WSS 主通道，首次 WSS 从未打开时自动切换同源 HTTPS NDJSON 流，继续获得受限 replay 与实时 PTY 输出，stdin/resize 复用 REST。相邻 HTTP 端口仍只做 308 跳转，不增加监听面。
- 2026-09-13：手机端输入框唤起软键盘后仍保留底部主导航的 88px 占位和安全区 padding，且页面未跟随 VisualViewport 的顶部平移，表现为内容上跳、快捷键与发送/粘贴区离键盘很远。修复为把快捷键和输入区组合成不可压缩控制区，聚焦时隐藏主导航并清除底部空白，同时同步可视视口高度和 offsetTop；键盘 viewport 声明、偏移归一化及聚焦布局均有回归覆盖。
- 2026-09-17：文件系统图片预览把 `/api/fs/preview` 的 64–256 KiB 二进制前缀直接拼成 Data URL，较大 JPEG 会只解码出上半部分。桌面/手机现共享完整图片流组件，经 `/api/fs/image` 读取本机或 SSH/SFTP 完整资源、创建并释放 Blob URL、按比例完整缩放；后端校验图片 MIME、拒绝非图片并限制 16 MiB。
- 2026-09-17：远端 tmux Codex 的完整记录曾受注册时遗留的 `agentKind`/工作目录影响，切换活动窗格后会误报无记录；SFTP 还会串行遍历全部日期目录并读取所有会话头，历史较多时请求超时。现请求记录前探测远端活动窗格并用其实时工作目录，仅接受当前 `node/codex` 窗格；远端目录最多 8 路并发读取，会话头每批 8 条且命中即停。`dvs-0` 的 701 份历史现场验证可在约 7 秒返回正确会话。
- 2026-09-21：桌面聚焦页的最近会话缓存和收缩布局后的隐藏手动窗格过去只做 CSS 隐藏，内部 xterm/WebSocket 仍持续处理输出并累积内存。现保留 React 缓存层和窗格状态，但非当前缓存层及布局隐藏窗格进入 `suspended`，复用既有 cleanup 关闭 WebSocket/HTTP 流并释放 xterm；重新显示时通过受限 replay 恢复。
- 2026-09-18：飞书完成卡片「查看完整记录」点击无响应。回调 `action_value` 可能是对象而非 JSON 字符串，原先解析失败后静默丢弃；该入口还和文件工作区共用 `replyEnabled`，默认关闭回复控制时直接忽略。现兼容对象/字符串，并把通知记录查看拆成只读能力，失败时发送说明；文件工作区和发指令仍受回复控制保护。
- 2026-09-15：飞书机器人任务总览过去与回复控制共用 `replyEnabled` 门控，默认关闭回复控制时无法查看当前 session；现允许已配置的飞书能力启动只读总览菜单和翻页/刷新，指令发送、通知回复、完整记录与文件工作区仍要求显式回复控制。
- 2026-09-15：只读总览恢复后，运行态仍受外部事件配置阻断：`application.bot.menu_v6` 未在飞书控制台订阅，`card.action.trigger` 被其他项目消费者占用。事件监听器现在把启动前有界错误写入 Kanban 日志，配置文档说明事件发布、单消费者限制和独立 profile 处理；不停止其他项目进程。
- 分组排列中切换到 CodeCharon 等活动窗格后，点击“完整记录”可能看似无响应：记录工具和目标 session 已正确更新，但之前持久化的 `sideCollapsed` 让左侧面板继续保持零宽；记录已打开时再次点击还会误切回文件页。现将显式打开记录定义为可见操作：从其他工具打开时同步展开侧栏，已打开但折叠时只展开不切换工具，并由浏览器回归验证记录请求仍绑定当前活动窗格。
- 更新后已不存在的 tmux 会话曾继续显示“服务已更新，等待恢复 tmux 会话”：恢复器现在把找不到目标或重连异常回写为“恢复失败：原因”，避免把永久失败误报为等待中；成功重连仍走原有在线状态更新。
- 2026-09-22：飞书普通新消息的现场事件实际没有 `parent_id/root_id` 且被 Kanban 判为 `ignored_untrusted`，未调用终端写入、kill 接口或 `codex queue`；为防事件适配层异常携带陈旧已绑定父 ID，回复路由进一步要求合法 `root_id` 精确锚定本地通知，父绑定存在时必须与根绑定指向同一 session/thread。无回复根的新消息在解析目标前拒绝。
- 2026-09-23：飞书 Card 2.0 独立 `select_static` 不接受 `required`，且实际独立下拉回调可省略 `action_name`。快捷回复入口因此先发送失败，后续选择又被拒绝。独立下拉不设 `required`，处理选择时以回调动作值、消息绑定和选项 token 为准，容忍缺失的 `action_name`；表单内 `input.required` 保留。
- 2026-09-24：完成通知把快捷回复、完整记录和文件按钮混在一个 `flow` 分栏，文件多时最终两按钮会被拆到不同视觉行。改为每个「查看 文件名」按钮各占前面一行，最后一组仅快捷回复与完整记录，两列 `none` 模式固定同行；无文件时不生成空文件行。
- 2026-09-23：本机 tmux pane 已切至 `claude.exe` 时，注册表仍可能保留 `node`，导致 Claude 完整记录被错路由到 Codex，后续飞书通知也缺少 Claude UUID 绑定。现启动时及每 5 秒用 pane ID 与 tmux session 名核对实时命令，只同步匹配的本机会话；运行态确认 `/api/agent-sessions/:id/transcript` 对 `session_agent` 返回 Claude 记录。旧通知无原 UUID 绑定时无法从固定按钮动作安全重建。
- 2026-09-23：Claude 类型同步为 `claude.exe` 后，飞书完成探测和内容 resolver 的精确 `=== "claude"` 判断仍漏掉它；完成通知统一用共享 `isClaudeAgentKind`，避免误走 Codex，回归覆盖没有预设 Claude session ID 时的完成与 UUID 绑定。
- 2026-09-23：远端 Claude 飞书记录按钮读页/导出只传 UUID 与 SSH 目标，Claude reader 没有工作目录就无法定位项目 JSONL。现在仅对远端 Claude 传入注册会话的工作目录与 tmux 标识，读取结果继续要求精确 UUID 匹配。
- 2026-09-24：多显示页面的已有窗格会话在切页时被 `focusedSession.id` 强制替换，之后自动保存使覆盖持久化；分组当前输入会话未包含在页面状态里。页面恢复现在保留有效的已存窗格，仅空白页注入聚焦会话，并在外层聚焦未变化时抑制恢复后的二次同步；`activeGroupSessionId` 随页面状态读写。相关红绿灯测试见终端工作区、布局和聚焦视图测试。
- 2026-09-24：本机 tmux 卡片无 pane ID 时 Agent 类型长期停留 `shell`，即使唯一 pane 已运行 Claude；Shell 静默完成通知会把终端底部状态/警告当正文。唯一卡片与唯一合法 pane 才自动补绑并同步实际命令，未绑定卡片不走终端预览完成兜底；多窗格、重复登记、非法 pane ID 均保持不绑定。`tmp` 运行态已变为 Claude，当前没有可读 JSONL（Claude 显示 transcript 写入失败），不能声称真实完成通知已恢复。
- 2026-09-24：`24_hermes` 远端 tmux 3.0a 不支持 `terminal-features`；附着时把设置和 `attach` 放在同一次 tmux 命令中，设置失败就导致 SSH PTY 退出，而远端 pane 仍继续运行。附着命令移除可选 feature 设置，保留单次 tmux 调用及必要的鼠标、历史、附着步骤；回归用例模拟旧版并确认能附着。
- 2026-10-07：会话聊天区使用 `100dvh`，未扣除工作台/会话导航，长对话输入框被裁切。嵌入布局改为 `h-full min-h-0`，继承父容器可用高度；浏览器回归验证 Codex/Claude/ACP 长消息、桌面/手机/横屏与聚焦后的导航位置。不要在嵌入会话内容区重新使用整屏高度。
- 2026-10-07：切换长 Codex 对话一次性渲染全部 Markdown，后台会话/用量更新又触发全仓库订阅及隐藏 Git 面板重渲染。改用可变高度虚拟列表、按会话订阅和历史索引；尺寸由 ResizeObserver 批量测量，避免同步布局反复阻塞。保留历史浏览、阅读位置、展开状态和草稿；恢复请求去重、晚返回不抢焦点，加载失败可重试。红绿灯覆盖 1500 条格式化消息、后台更新、流式输出、快速切换与桌面/手机布局。
- 2026-10-07：`/` 命令与 `$` 技能菜单的 Portal 位于会话主题之外，表现为白色原生按钮、横向乱排和窄屏溢出；统一挂载到会话容器，采用可测量的视口定位与共享建议面板，主题色、图标、层级、选中/悬停和键盘提示一致。修复 `$` 带连字符技能名提前关闭、空结果 Esc 无法关闭，Claude 鼠标选择保持输入焦点。浏览器回归覆盖桌面、平板、手机、横屏及键盘/筛选/选择。

- 2026-10-07：会话模式 Open in 在服务器启动桌面软件，无法在局域网客户端编辑项目，Run/Publish 入口也与当前工作流不符；移除这些工具栏入口，改为复用同源 VS Code Web 并打开当前服务器目录，补充路径校验、弹窗/失败提示及前后端与浏览器回归。

- 2026-10-07：会话名称通知缺省名称时将 undefined 写入要求 string/null 的 thread.name，导致前端类型检查失败；统一空名称为 null，回归覆盖缺省、null 和有效名称。
- 2026-10-07：终端模式嵌入工作台后重复显示品牌 Logo 和标题；增加嵌入标记，外层统一显示品牌，内层保留统计、工具及电脑/手机切换，桌面与手机独立使用时仍显示品牌。
- 2026-10-07：左下角 Issues 仍指向 Codexia 作者仓库；按本项目 GitHub remote 改为 BrotherHappy/coding-kanban/issues，并共用项目链接常量。
- 2026-10-07：会话重命名仅有隐藏的 Codex 右键入口，名称通知未更新 name 字段，Claude/ACP 没有持久化显示名；增加列表、当前标题和卡片入口，Codex 使用原生接口，Claude/ACP 名称写入服务器设置。串行写入保留既有配置；空名称、重复提交和失败重试有明确状态，名称通知不进入聊天正文。
- 2026-10-07：重命名弹窗打开时，后台输入建议仍可能浮在弹窗上并截获 Enter；模态打开期间隐藏建议，快捷键监听跳过 dialog/alertdialog 输入。红绿灯验证菜单不执行命令，弹窗保存按键正常。

- 2026-10-07：Codex 回滚编辑调用本机已移除的 thread/rollback，且新 thread/revert 只返回空 turns 元数据；增加明确的方法不存在兼容分支、实际 turn ID 边界和保留历史完整分页恢复。回滚每次确认、运行中禁用、重复请求去重，晚返回不抢会话或草稿，旧恢复请求不复活已撤回消息；补充协议、前端与浏览器红绿灯及隔离真实 Codex 实测。

### 会话运行时空输入仍显示发送箭头，停止状态丢失

- 现象：Codex 恢复会话或轮次事件先于状态事件到达时，空输入仍显示发送箭头；Claude 切回运行中的会话后丢失停止入口，附件异常也会禁用停止按钮。
- 根因：Codex 历史恢复没有同步轮次与运行状态；Claude 切换时固定清空运行状态；停止与发送共用了附件禁用条件。旧停止响应还会清空新选中会话的轮次。
- 修复：Codex 结合当前会话的轮次状态恢复按钮并忽略已完成轮次的迟到启动响应；Claude 恢复各会话的运行状态。三类会话停止入口均提供防重复、正在停止和失败重试反馈，保留草稿与附件；停止仅作用于捕获的会话/轮次。
- 回归：运行/结束、空白输入、会话切换、恢复历史、停止失败、重复点击、迟到响应以及附件异常，单测先红后绿并覆盖浏览器交互；浏览器停止请求使用模拟接口，不中断真实任务。

### 2026-10-07 会话工作台体验与数据安全

- 会话列表的子按钮按 Enter 会同时触发行打开；按键处理只接受行自身焦点，管理器区分加载、空结果与失败重试，迟到列表响应不覆盖新项目，批量删除失败保留对应选择。
- 手机输入区项目、Git 和模型控件越过可见边界；按聊天容器宽度重排，长路径截断并保留完整提示，布局选择使用可访问菜单。模型列表请求失败原先显示为空，现提供错误与重试。
- 外部按钮打开的会话管理对话框关闭后焦点掉到 body；保存实际打开按钮并在 Esc 后恢复，清空搜索仍保留输入焦点。
- ACP 权限回复失败会清除待审批提示；审批成功且请求仍属于同一会话时才清除，失败保留请求和重试入口，重复提交禁用。浏览旧消息时不再强制滚到最新，提供返回最新入口。
- 无分类信息的 Codex 命令结果被渲染过滤丢弃；保留原始命令及输出，并提供可展开的执行摘要。
- 工具面板按页面或断点重建终端，造成重复连接与输入状态丢失；复用同一工具树，可见性控制隐藏内容及全局快捷键，真实 xterm 在取消的挂载帧不初始化。
- 大于 500 行的文件预览可直接编辑保存，导致尾部被截断；截断预览只读，明确加载完整文件后才编辑。各文件编辑器保留草稿，跨文件、Diff、终端切换不丢输入，保存失败明确显示并保留草稿。
- 终端扫描以过滤数组下标保存选择，过滤后可能连接另一条会话；选择绑定稳定身份并从原始列表解析。聚焦视图保留控件自身 Tab/Enter/空格操作，文字仍按原规则转发。
- 分叉后的窗口误绑定原 Codex 会话；使用分叉接口实际返回的新身份，原历史不变。
- API 路由验收只按 Rust 原始路径比较 Node 网关健康地址，造成已有失败；测试按网关真实规则去除 /api/session 前缀，再检查运行层实际路由，仍拒绝未注册路径。

验证：行为修改均用失败用例复现后转绿；浏览器使用隔离 SESSION_DATA_HOME 与模拟 API，不向真实 Agent 发送指令。独立审查仍在进行，终端晚启动资源归属、ACP 切换/新建中断及快速历史选择另行等待行为确认，未列为完成。

- 2026-10-07：模型面板的搜索输入位于 cmdk Command 上下文之外，点击搜索会使会话界面报错；输入与列表置于同一 Command，真实浏览器先复现失败，再验证中文、模型 ID、空结果和 Esc 焦点恢复。
- 2026-10-07：手机定时任务模板页签越界，加载失败被误显示为空任务并清除选中状态；标题/页签与任务过滤栏允许重排，加载失败使用独立 alert 和重试，只有成功的列表才能校验当前选择。
- 2026-10-07：用量刷新缺少可访问名称并在手机越界，计价编辑器使用独立固定浮层，Esc 无效且数字列被压缩；补命名与控件重排，计价复用会话 Dialog，数字表格在自身范围滚动，颜色复用主题变量，目录菜单约束到视口并折行长路径。
- 2026-10-07：设置页 GitHub 仍指向 Codexia 作者；复用本项目仓库地址，上游 Discord 和作者链接明确标为上游，避免混淆项目身份。

- 2026-10-07：已打开会话模态/菜单后隐藏会话模式，Radix 仍保留 body pointer-events 锁与焦点陷阱；统一监听模式可见性，隐藏时卸载交互层而保留上层 open/草稿，恢复时重新进入控件。覆盖 Dialog、AlertDialog、Dropdown/SubContent、Popover、Context、Sheet、Select、Tooltip、HoverCard。
- 2026-10-07：文件保存期间继续输入，旧保存回执会覆盖新草稿；基线确认与编辑快照分离，确认已保存内容同时保留后续输入。模态输入里的 Ctrl+S 不再写背景文件，Ctrl+, 不再切设置。
- 2026-10-07：ACP 输入使用局部状态，切工具、用量、设置会卸载聊天树并丢文字/图片草稿；首次 AgentView 保持同一 hidden/inert 树，隐藏视图暂停输入建议与键盘交互，原连接和草稿保留。
- 2026-10-07：ACP 激活时仍展示已存 Codex/Claude 网格，显示对象与输入对象不一致；ACP 当前展示单会话历史，布局入口明确限制，原卡片与布局偏好保持。置顶列表增加自身 Enter/空格处理及触控/焦点取消置顶，选择内置 Agent 时退出 ACP 显示模式而不停止其连接。
- 2026-10-07：ACP 旧审批失败迟返回会覆盖当前会话的失败提示；失败路径也检查连接、会话和请求归属，当前提示可重试。
- 2026-10-07：插件请求失败被呈现为空列表，失败刷新丢当前内容；分离加载错误/真空态，保留已有列表并重试原读取，目录操作按钮补可访问名称。
- 2026-10-07：主模型面板缺少原菜单的手动模型 ID 入口，部分模型/预设请求失败又不提供重试；复用已有选择处理，四类列表失败均可见，重试合并且保留成功部分。模型计价恢复默认后 DOM 仍显示旧输入、保存值却已更新；仅重置动作重建字段，显示与保存一致。

- 2026-10-07：Bot 长中文名称撑开手机卡片、无空格路径穿出气泡，发送/停止控件没有可访问名称；卡片约束最小/最大宽度、长正文允许任意断点换行、工具局部滚动，输入和动作补中文名称。
- 2026-10-07：Bot 切换混用草稿、发送失败清空输入，停止失败又伪装已结束；以 Bot 身份保存非持久化草稿与 UI 请求状态，迟回调不覆盖新输入或其他 Bot，失败保留草稿/运行提示并可重试。阅读旧历史时新增输出不再抢到底部，返回最新恢复跟随，减少动态效果使用非动画滚动。
- 2026-10-07：ACP 无断点长路径使整段聊天横向滚动；普通文本按容器宽度折行，390px 浏览器验证 scrollWidth 与 clientWidth 一致。
- 2026-10-07：连续命令合并摘要共用首条命令 ID 与最后一条输出，可能显示错误输出/状态；每个 action 绑定原命令来源，保留组折叠、分别展开正确结果，索引完成事件避免反复扫描整个组。渲染数据局部推导，不改通知协议、历史或执行接口。

- 2026-10-07：用量页 Agent 页签与账户入口仅有图标而无可访问名称，键盘/读屏难以定位；Agent 页签补 Agent 名称及用量语义，账户入口提供可见名称与手机触控高度，Esc 恢复焦点。真实组件红绿灯与三视口浏览器复验覆盖。

- 2026-10-07：重新打开长会话会恢复旧滚动位置，Claude 切换会话继承停止跟随状态，手机表现更明显；Codex 每次打开从最新回复开始，保留尺寸/折叠缓存，Claude 切换重置跟随并用即时滚动承接异步历史。375px/1440px 浏览器回归覆盖打开、重新打开和阅读历史不抢位置。

- 2026-10-07：手机轻点对话后点击输入或发送，焦点/软键盘布局滚动可能把长会话留在顶部；touchstart 与所有 pointerdown 被误当成阅读滑动，关闭底部跟随。改为识别超过阈值的纵向 touchmove，鼠标仅滚动条拖动算滚动意图；跟随状态纠正布局滚动，排队回调不覆盖随后主动滑动。浏览器红绿灯覆盖轻点、键盘尺寸变化、发送和实际滑动保持阅读。

- 2026-10-07：修正手机滚动行为及前次错误方案：删除输入框聚焦/轻点强制回底部；Codex 使用实际 scrollHeight-clientHeight 替代 MAX_SAFE_INTEGER，避免 WebKit scrollTop 有符号整数转换把底部定位成顶部。单会话视图固定挂载结构，发送新增任务卡不再重建历史并丢失阅读位置。红绿灯覆盖 WebKit 整数绑定模拟、打开底部、聚焦/键盘/发送/流式输出保持中间位置、手动回底后恢复跟随。

- 2026-10-07：项目靠启动读取/整份 workspace 回写，跨设备可能覆盖项目或当前目录，断线刷新后列表丢失；项目改为独立落盘与操作同步，设备目录/Agent/历史本地持久化，旧 workspace 不再覆盖。项目与关注标签补原子写入及上一版备份，统一相对数据路径，离线显示缓存并保留待提交操作。独立进程停止再启动、两设备断线刷新及新设备恢复通过浏览器验收。

- 2026-10-07：会话正文中的 visualize 标记被当作普通文字，HTML 草图无法显示。增加共享标记解析、流式等待和受项目边界/HTML 类型/大小约束的只读接口，以隔离 iframe 提供图标、提示、轮播切换和宽屏展开；代码示例保留原文，文件或脚本错误可重试。红绿灯与浏览器测试覆盖来源隔离、项目路径、真实草图交互和手机布局。

- 2026-10-07：浏览器刷新后 Codex 关注标签恢复了成员，但运行状态 map 为空，SSE 只监听后续变化，后台标签需手动打开才能更新；新增服务就绪后的只读状态快照同步，跨项目/分页覆盖全部关注项，重连与回前台自动补齐，失败重试且迟到快照不覆盖新事件。保持当前标签、输入草稿与后台 Agent。先红后绿验证，相关单测 24 项、浏览器回归 3 项及 pnpm check 通过。

- 2026-10-07：已有 Codex 标签偶尔变成当前聊天中的一段话。继续发送时把本次消息写回卡片 preview，标签将内容预览当作会话名称。名称改为独立持久化状态；仅初始化新会话名称，后续消息和迟到通知不覆盖已确定名称，手动改名优先。首次加载正式名称/首条历史预览可修复旧版临时标签，之后保持固定。
- 2026-10-07：切换 Codex/Claude 会话继承上一输入，刷新丢失附件，发送/回滚迟返回可能清空或恢复到错误会话。文字改为按 Agent 与 session ID 保存，新聊天按 Agent/项目隔离；附件的文件字节及上传状态存入 IndexedDB。关闭标签只取消关注，草稿保留；发送按原会话与提交版本清理，新增文字/附件保留，创建期间切换不抢选中项，回滚恢复原会话草稿。上传中刷新显示可重试状态，存储失败可见且不覆盖读取失败的数据；旧共享文字一次迁移并保留备份。回归同时覆盖 Claude 新聊天初始化不残留 loading。

### 2026-10-07：Codex request_user_input 表单与生命周期

原 UI 将结构化问题变成下拉并自动提交，随后错误开始新实施 turn；resolved 被忽略、草稿跨请求、SSE 首次无 pending 恢复。使用逐题显式提交、request/thread/turn/item 隔离、resolved 清理、独立 EventHub pending snapshot；协作模式发送正式 turn/start 字段，新建/冷恢复会话局部启用默认模式提问。保留用户当前运行实例，snapshot 随下一次重启生效。回归见 RequestUserInputItem.test.tsx、serverRequests.test.ts、events.rs、session-user-input.spec.ts；边界见 docs/session-codex-user-input.md。

- 2026-10-07：顶栏 Logo 被 20–26px 容器裁切，模式下拉与功能导航层级混淆；改为完整比例 Logo、会话/终端共享推杆及独立功能导航分组，覆盖点击、拖动、键盘和窄屏几何边界。
- 2026-10-07：项目入口与会话标签混在一起，侧栏历史按钮在窄列换行，卡片 Agent 只用图标且底栏低对比度；统一项目控件、中文图标操作、可读 Agent 标签及底栏样式，手动卡片尺寸限制在可用宽度内，浏览器覆盖长名称、手机、网格与分屏。
- 2026-10-07：手机项目抽屉关闭后焦点丢失，模式切换后键盘焦点落到页面；Sheet 记录并恢复实际入口，切换后聚焦新模式推杆，隐藏模式不夺取焦点。复现测试先失败后通过。
- 2026-10-07：终端更新指示器固定在左上角，遮挡品牌 Logo；将版本提示嵌入普通/折叠工具栏的状态区，保留恢复通知条和原有显式更新动作。
- 2026-10-07：开发热更新侧栏组件后，新 Consumer 与旧 Provider 引用不同 Context，界面抛出 useSidebar 错误；通过模块 hot.data 保留 Context 身份，生产与不同模块保持隔离，红绿灯与浏览器模块刷新覆盖。

- 2026-10-07：更换 ACP Agent 原本直接停止已有服务；切换前显示后果与明确确认按钮，取消保持连接，确认后校验原连接/Agent/会话身份，过期确认不影响新选择。补充确认、取消及迟到选择回归。
- 2026-10-07：新建 ACP 会话原本隐式取消正在执行的任务，失败时还会静默停止服务重连；中断和重连分别要求显式确认，取消保留原任务，操作前后检查连接归属，停止失败保持原连接并显示错误。
- 2026-10-07：隐藏或关闭终端工具页会卸载终端窗口并结束后台任务；首次打开后保留终端子树，隐藏仅停用交互。开发热更新清理不停止后台终端；显式关闭终端窗口仍按原流程结束。
- 2026-10-07：终端窗口关闭后迟到的启动结果仍可能执行预设命令；启动回调校验当前 xterm 实例，只清理此次返回的终端，不再写入命令，兼容 StrictMode 实例替换。资源归属回归覆盖迟到结果。
- 2026-10-07：切换 ACP 项目或会话时，旧历史加载响应可能覆盖新选择；采用跨 hook 的选择版本、目录与连接身份校验，迟到响应保持新会话不变，加载标记仅由自身当前请求清理。

- 2026-10-07：ACP 手机布局在侧栏关闭时没有挂载新聊天按钮，导致新建入口与快捷键不可用；紧凑标题栏增加同一 NewAgentButton，复用任务中断确认，浏览器覆盖桌面与 320px 手机的取消及确认。

- 2026-10-07：浅色主题下消息正文、输入区和部分工具文字仍显示浅色，白底对比度不足；工作台根节点由固定深色配色改为读取当前主题 foreground/background，保持懒加载时默认配色。浏览器先复现根文字颜色与主题不一致，再修复并截图验证。

- 2026-10-07：手机消息队列展开后挤占分屏正文高度；队列高度按手机视口限制并保留内部滚动，正文与输入区持续可达，分屏浏览器回归覆盖 390px 与 320px。
- 2026-10-07：Codex follow-up 由 Node 持久队列管理，不能把 turn/start 或 turn/interrupt ACK 当完成。排队等精确 turn/completed；未知送达和事件缺口暂停；新建空 thread 不在 thread/list，需从可信创建/恢复/fork 响应补状态；继续队列先刷新 revision。实现与红绿灯见 `docs/session-followups.md`。
- 2026-10-07：CLI 0.159.2 审查的启动/完成 turn ID 可能不同，需持久关联 review ID 与 execution ID；分页历史明确拒绝 detached review 时用 thread/fork + inline review 实现独立审查。不要对一般网络错误执行该兼容路径。

### 2026-10-08：VS Code 新开页面、重复工作区和右侧刷新布局

- 现象：Session 的 VS Code 按钮打开浏览器新标签页；目录别名可能产生重复工作区，多个设备同时首次打开会重复启动服务；右侧刷新后变宽，窄聊天区按钮被标签挡住。
- 根因：window.open 入口、未规范到 realpath 的路径、异步发现阶段缺少合并；左右初始宽度不是互补比例，固定高度覆盖了窄容器的换行样式。
- 修复：同页右侧 VS Code 标签与品牌图标、真实目录唯一 iframe、项目跟随/固定与隐藏保留；realpath 规范化及共享启动 Promise；互补初始宽度与自适应工具栏高度。红绿灯、真实编辑器和手机验收见 docs/session-vscode-panel.md。

### 2026-10-08：旧运行实例导致回退修复未激活

- `thread/rollback unknown variant` 再现时，先核对运行 PID 启动时间及 `/proc/<pid>/exe` 与磁盘二进制；Node/Vite 热更新并不替换 detached Rust 服务。
- 前端回退错误改为确认框内摘要与折叠详情，API 抑制重复 toast；失败不覆盖草稿、不自动重试。20 项前端、4 项 Rust 和手机/桌面 E2E 通过；独立 Codex 分页测试历史三轮回退到一轮验证成功。
- 正式实例按用户要求保留，回退功能激活需要授权重启；代码完成和当前运行生效必须分别报告。

### 2026-10-08：Codex 点击发送后正文延迟或消失

- 现象：回执已返回、输入已清空，但正文要等消息事件才能显示；旧历史晚返回还会覆盖新收到的消息。
- 根因：发送回执和聊天事件之间没有持续回显；用户正文只认 item/started；历史加载整体替换事件。
- 修复：独立显示层按提交 ID 保留正文/附件并与正式事件去重；支持完成事件兜底；普通历史加载合并期间的实时变化，回滚仍显式替换并清理占位。仅增加前端显示衔接，保持现有队列调度、顺序及控制语义。回归与边界见 docs/session-message-delivery.md。

- 2026-10-08：会话回答完成后，顶部标签出现两个蓝色未读点；标签同时渲染 UnreadDot 与可显示未读状态的紧凑 SessionStatus。移除重复的 UnreadDot，统一由 SessionStatus 显示一个状态标记。红绿灯覆盖 Codex/Claude 完成未读仅一个点、连续完成不叠加、已读消失及运行中/待处理优先级，浏览器覆盖桌面与手机标签。

### 2026-10-08：关闭的标签在刷新或前端重开后再次出现

- 根因：多个浏览器页面共享同步 clientId 和序号，关闭被当成旧操作忽略；整份 localStorage 缓存还会覆盖其他页面未同步的关闭记录，detached 阅读目标也会被持久恢复。
- 修复：每次操作独立幂等身份、逐操作本地保存与精确确认、旧关闭记录兼容修复；临时 detached 目标不再跨刷新恢复。关闭只取消关注，保留会话、Agent 与草稿。红绿灯及多页面/离线/重启验收见 docs/session-tabs.md。

- 2026-10-08：Codex 标签刷新后缺历史/状态：`events[id]` 可能只有实时事件，不能作为已加载完整历史的判断；启动恢复须等待共享成员到达；计时变化使状态快照失效时必须补查。现以 `historyLoadedMap`、并发受控的关注历史队列和状态冲突重查处理，后台结果不得导航或聚焦输入框。回归见 `session-restoration.spec.ts` 与对应历史/状态同步单测。

- 2026-10-08：Codex 报错后输入被当作引导：旧 inProgress/currentTurnId 覆盖 systemError，漏开始事件也使终止错误无法收尾。统一主/侧输入状态判定，错误终止旧轮，新 turn/started 恢复运行；保留自动重试与跨轮隔离。后台在保留显式继续规则下允许 systemError 启动新轮。回归覆盖刷新及实际 turn/start 请求，见 docs/debug_list.md。

- 2026-10-08：多文件变更汇总撑高对话；`ThreadFileChangesSummary` 改为桌面最多 6 行、手机最多 4 行的内部滚动区。统计与确认区置于外部，所有记录保留，超限时阻止滚动传递。9 项组件测试、2 项手机/桌面浏览器测试及前端构建通过。

- 2026-10-08：会话各入口不再独立判断 running，统一 codexRuntimeState；旧轮事件/历史和跨实例响应不得复活已结束轮。审批按身份去重和确认，失败/送达不明保留内容，运行层提供全 RPC 快照。后台旧轮错误隔离，systemError 下旧队列必须显式恢复；新输入恢复不释放旧队列。详见 docs/session-state-transitions.md。原审计 ACP 关注集合项是非法测试输入，已撤销。

- 2026-10-08：经用户授权，保留异常原会话并创建完整历史的修复副本；分配新身份、同步展示事件归属，仅去除一条失败调用的异常尾部空白。原文件哈希不变，28 轮与 1,504 个可见条目逐项一致，模型配置保留，副本加入标签。分页历史经 legacy fork 会丢失展示事件，恢复验收必须比较原生 API 的 items；详见 `docs/session-message-delivery.md`。

- 2026-10-08：关注会话下拉补齐标签的状态图形；复用 SessionStatusIndicator，并使用 useFollowedSessionStates 的解析结果，避免离线仍显示旧运行圈。两行身份信息、项目消歧、内部滚动与键盘/主题浏览器回归已补充。

- 2026-10-08：浅色选中窗口提示改为 `session-selection.css` 的蓝色内侧 outline 与淡蓝标题栏，在导航样式之后加载，覆盖普通分隔线的激活边框回退；固定边框宽度、无过渡，复用既有选择状态。验收用动画帧检查几何与滚动位置。

- 2026-10-08：Session composer 高度跳变：外层限宽与条件信息/附件参与流式布局，手机最多约 327px。改为固定框体、左侧预览、悬浮队列/直接工具入口；回归包含长文/8 图/错误/模型提示，避免撤销提示被通知层挡住，并在完整编辑器关闭时显式恢复正文焦点。证据：`docs/designs/compact-composer/acceptance.md`。

- 2026-10-08 Codex 写锁交接：历史导航/补拉必须使用只读 API，不能 resume；unsubscribe ACK 不等于释放，需核对 loaded/list。卸载会结束 unified exec 后台进程，必须保护队列、待审批/回答、活动目标和子 Agent，未知资源保留。实现与隔离原生验收见 docs/session-ownership.md、scripts/session-ownership-acceptance.py；正式服务须安全切换。

- 2026-10-08：会话历史/执行权 API 同时返回 405 时，先检查运行二进制与磁盘产物是否一致。常驻 Rust 服务跨 Node 热更新复用，构建成功不代表路由已激活；使用 session:status 核对。隔离验证新程序后，只有获得明确任务中断授权才升级真实运行服务，再复核 health/read/access、会话 ID 与历史。此次已授权升级并验证接口恢复 200。

- 2026-10-08：续发队列在完成事件丢失且会话已释放/网关重连后，不能只依据 idle/notLoaded 清除 awaitingTurnId。使用只读完整历史证明原等待轮次及后续轮次均已终止；失败/中断保持暂停，未知或事件竞态不投递，5 秒限频。保留消息 ID、附件、人工暂停与送达不明保护；不使用 resume 补读。对应服务和 HTTP 适配器回归见 docs/debug_list.md。

- 2026-10-08：Codex 切换模型不要无条件应用 defaultReasoningEffort。`nextReasoningEffort` 应先检查目标 supportedReasoningEfforts，兼容偏好保留、不兼容/未指定才回退；未知模型不覆盖，新聊天自动选择也复用此判断。回归覆盖提供商切换、会话隔离、刷新和发送参数，见 `docs/session-model-selection.md`。

- 2026-10-08 项目侧栏开关：桌面顶栏必须双向切换且根据真实可见状态命名，不能只打开、让内部按钮负责收起；功能页隐藏的展开侧栏不算可见。手机模态抽屉保留内部关闭。对应 ProjectNavigationButton/AppSidebar 测试与 session-navigation-aligned 浏览器验收。

- 2026-10-08：深色窗口选中提示需要与浅色一起覆盖。`session-selection.css` 共用内侧蓝色 outline，深色提高亮度；只画窗口框，标题栏/标签保留原背景，下划线分主题用暖棕/香槟金。避免增加边框宽度或切换动画，回归逐帧几何与阅读位置；详见 docs/session-selection.md。

- 2026-10-08：Codex 协作创建只显示旧版结果卡片，子线程进入主侧栏、新版 activity 缺少任务入口。新增独立家族索引、幂等事件行、摘要和侧面板，默认主列表排除 spawn 来源；查看不改变主输入/项目或获取执行权。
- 2026-10-08：薄 active 元数据省略 activeFlags 时可触发 UI 崩溃；统一状态解析兼容缺失字段。缓存权限、旧 revision 与不可用节点不能充当当前事实，重连/换运行实例撤销旧权限与回执。补红绿灯和刷新回归。
- 2026-10-08：子任务“本轮停止”误包含旧轮运行任务，旧停止回执可能把新轮当成已停。停止按创建范围和精确 turn 捕获，服务端再次校验；未发送、回执不明、原轮 superseded 分开呈现，已停只认原轮终态。
- 2026-10-08：子输入可能把队列里旧消息的失败误当成本次提交失败；改为复用服务对精确提交 ID 的确认，共享提交锁与草稿版本，保留发送中的后续输入和附件。旧轮详情返回隐藏列表任务导致焦点丢失，同步修复历史范围与焦点归还。
- 2026-10-08：原生 request ID 在换运行实例后可能重复，单独按 request ID 回复不能确认实际归属。真实请求增加非凭证 requestToken，新网页回传完整身份，运行层按请求类型和实时待处理集合原子认领；拒绝错线程/轮次/item/旧实例/重复回复，保留送达不明不自动重发。两个原生版本均做旧标记拒绝后正确审批/回答验收。

- 2026-10-08：新增 @ 容器让固定输入区附件按钮的 first-child 样式失效，手机触控宽度变成 36px。改为首个直接按钮的类型选择，并为引用入口补足 44px；320–1440px 浏览器红绿灯验证布局与触控区域。

- 2026-10-08：独立子输入借用公共输入参数可能把主会话模型或权限设置带入子线程。子提交仅捕获可信子元数据，未知设置由原生子线程继承；补独立模型/策略参数回归，草稿与提交身份继续按子线程隔离。

- 2026-10-08：子任务兼容与恢复补验：旧 source 中的昵称/角色现归一化读取；主轮未恢复和发现不完整不显示确定的零；普通后台刷新保留上次确认状态，失败后才标未知；主摘要重新打开面板保留原检查选择。均补红绿灯或关闭/重开浏览器回归。

- 2026-10-08：异步恢复默认 Agent 偏好时，选中的 Codex 标签仍可见，但子任务面板按偏好误判为非 Codex。面板改用实际选中的关注/检查会话作为主身份，偏好仅用于无选中会话时回退；补配置恢复竞争回归。

- 2026-10-08：合并后健康接口 200 但建会话 503 时，检查新网关所需的 `/api/internal/codex/queue-holds`：旧 Rust 二进制对 POST 返回 405，网关会报执行权同步失败。`pnpm session:check`/`session:test` 不替换正式可执行文件；先 `pnpm session:build`，用 `session:status` 比较运行文件身份，隔离验证后仅在明确允许中断时切换已核对归属的旧进程。此次新进程的健康、read、access、followups 均恢复 200。

- 2026-10-08：终端管理页的品牌/模式切换与操作栏分占两行，减少终端可用高度。将导航并入 TopBar，展开与收起都保留模式切换，去掉外壳额外 48px 高度扣减；桌面显示单行，窄屏保留响应式换行。回归覆盖单行布局、菜单和折叠操作。

- 2026-10-08：会话模式刷新仍初始化终端应用并恢复完整多窗格 xterm；隐藏模式仅隐藏 DOM。终端应用改为首次进入时加载，已挂载后隐藏时暂停 xterm/连接，返回后回放恢复。会话工具终端无可靠回放，保留原连接和输出。保留布局、草稿与 VS Code iframe。

- 2026-10-08：GitLab upstream 有新代码但会话模式无提醒。原因是提醒只在按需加载的终端应用中；会话顶栏现独立读取 `/api/app-version`，只在可见时轮询并显示切换处理入口。后端双远程测试覆盖 GitLab 领先而 GitHub 不变。

- 2026-10-08：`GIT_AUTO_PULL_INTERVAL_MINUTES=15` 会被后端误判为非法配置并阻止启动。配置解析器现支持 `0|10|15|30`，避免 15 分钟 Git 检查配置触发启动失败。

- 2026-10-09：终端恢复占位一直保留时，不能仅检查 HTTP health；应检查 restore-managed 回执、tmux 控制查询、服务 FD 数量和软上限。此次服务 FD 达到 1024，确认归属后提高软上限即恢复查询；未停止 tmux/Agent。网关 PTY 清理必须在 preClose 执行，不要等网络排空后的 onClose；本机、SSH 和同步查询必须限时，仅终止本次查询进程。隔离 socket 验证重复关闭后客户端归零、pane/PID 保持；详见 docs/startup.md。

### 2026-10-09：会话模式异步归属、审批与性能复查

- ACP 取消失败仍尝试新会话、并发历史加载改变原生上下文、晚启动接纳错误 Agent：共用连接操作队列，显式中断确认，身份与选择双重校验；失败不重启、不清草稿。新增取消失败、跨项目迟到、重复点击与恢复失败红绿灯。
- ACP 后台审批覆盖当前请求、并行审批被后项覆盖：按连接/会话保存请求队列，回复精确移除 request；实际输入标题独立于残留 Codex 标签。补队列、迟到回复和标题归属用例。
- ACP 设置拒绝回滚另一会话或后来的选择、连续拒绝显示未接受的模型：字段请求串行，版本校验并回到最后确认值，待应用禁止发送；认证与新会话共用身份保护，取消失败不认证。
- ACP 当前记录先删除后创建失败、旧连接发送错误清掉新连接运行状态：运行时拒绝删除，替代创建成功才删除；发送异步准备后重核目标，错误与完成核对连接/session/Agent。
- 多会话同步导致所有标签重渲染、长历史反复扫描最新问题轮次及整体序列化：稳定事件代理和标签 memo、弱引用轮次索引、空历史探测直接复用原快照。保留消息与顺序；前后测量和抖动边界见 session-mode-optimization.md。
- 冷启动会话模式未加载终端样式，body 8px 默认边距造成底部控件裁切：工作台外壳限定重置；桌面与手机浏览器复验。

- ACP 原生目录被浏览器项目切换混淆：保存已确认的 sessionCwd，未知/不匹配时保留草稿并阻止发送；当前运行历史选择只恢复所属目录，不取消任务。
- Codex/Claude 焦点与全局偏好不一致会切换错误输入器，插件使用/自动化历史也可能留在原标签：发送器和模型绑定实际焦点，显式 Agent 导航同步项目、只读历史与标签；新增身份、导航、插件回归。
- ACP 取消通知被当成停止确认：只有替代会话成功接纳才清运行状态，刷新失败保留原身份；新增取消已送达但新会话失败红绿灯。
- 子 Agent 观察在无关更新中反复扫描父历史：不可变快照弱引用去重；新快照仍处理新事件，不扩大直接输入权限。缓存 Codex 被动历史不等待后台核对才显示正文，保持只读执行边界。

- 输入目标复查发现刚创建线程的原生占位名提前初始化会话名称，抢占首条消息命名：跟随会话前只显示目标，不初始化新名称；新增红绿灯并重新验证首条、手动改名及刷新。

- ACP 原生历史加载失败留下空正文和错误历史身份：回放失败后恢复原会话正文、身份及已知目录，保留错误门禁等待显式重试；新增失败加载恢复红绿灯。

- 会话工具终端在 StrictMode 未挂载阶段即启动，首次请求被丢弃后再次启动；首次错误及隐藏再展开会自动重试：原生 PTY 启动等待存活 xterm 挂载，失败保持原终端和显式重试；红绿灯验证重放不发 RPC、隐藏/重开不重试、迟到结果只清理自己的资源。

- 2026-10-09：手机恢复会话后发送提示“无效的消息队列请求”。服务日志定位到 cwd 绝对路径校验；恢复元数据的空字符串占位被前端原样发送。前端将空目录转为 null，后端兼容旧缓存客户端的空白 cwd，沿用原生线程目录，不回退到其他项目；相对路径、控制字符和非字符串仍拒绝，相对路径返回明确目录错误。前后端及 375px 手机发送浏览器测试先红后绿，覆盖旧客户端、入队回执、草稿清空、刷新不重复与原生调用参数；15 项前端、4 项后端、2 项浏览器测试通过。局域网 HTTPS `https://10.30.0.24:8484/?mode=session` 验证，浏览器使用隔离队列与模拟原生调用，没有向用户 Agent 发送测试消息；产物 `.dev-runtime/mobile-cwd-green/`。

- 2026-10-09：Codex历史Diff查看/Undo误使用全局项目与全文件Git回滚。保存视图捕获thread/turn/cwd和净patch，精确Undo/Reapply在服务端核对原生批次；冲突拒绝、不明及部分写入不重试，flock/持久回执防重复。完整查看主动关闭hover预览，修复叠层与窄栏标题；缺失durationMs不再显示NaN，重复快照保留已知时长。见docs/session-saved-patches.md。

- 2026-10-09：Codex流式命令替换时沿用上一条的展开状态，已知owner的缺失命令状态也会借用全局同itemId缓存。执行面板按thread/turn/item/command隔离并保留虚拟行恢复，明确owner不借用未核实全局状态；复制失败不显示成功。原包执行行与输出/真实退出footer适配，命令字段完整传递exitCode/cwd/turn；前端红绿灯及桌面/手机浅深主题浏览器验收。

- 2026-10-09：宿主指定的编辑器字体不可用时，Codex代码会退为比例字体，命令面板高度也偏离原包3px。补齐原生等宽字体回退、代码继承、执行块布局与圆角曲线；直接运行原包组件的浅深主题尺寸/font-family断言先红后绿，保留剩余图像差异，不冒充全量像素验收。

- 2026-10-10：Codex工具行仍使用查询徽章、文件不能按历史会话打开，且命令缓冲会绕过中间MCP/完成式正文、warning与checklist，改变可见顺序。连续命令在真实可见边界刷出，迟到完成更新原source；探索行使用原包文案/图标，literal路径不解码百分号或把冒号当行号，owner/cwd隔离。搜索表达式作为React文字节点，防止翻译组件把尖括号解析成标签；失败探索保留实际输出/退出码。长分组禁止flex压缩而在224px内滚动，手机文件链接与动词居中对齐。红绿灯与原包对照/浏览器验收见docs/designs/session-render-alignment/implementation.md。

- 2026-10-10：Codex 回复中的 Markdown 表格显示为竖线文本，删除线也不解析。本地新 CodexMarkdown 渲染器的自定义 remarkPlugins 仅包含文件引用转换，覆盖 Streamdown 默认 GFM 插件。现保留 defaultRemarkPlugins 并追加文件引用插件；静态/流式表格与删除线用例先失败后通过，原文件定位和数学公式保持正常。11 项相关单测、390px 手机及 1440px 桌面浏览器测试通过，表格行列/行内代码/链接正确，页面无横向溢出。局域网 HTTPS `https://10.30.0.24:8484/?mode=session` 的隔离消息夹具验证，未向真实 Agent 发送消息；截图在 `.dev-runtime/markdown-table-green/`。
  - 本次全量前端类型检查未通过：错误位于其他进行中的 NativeModelSelector、nativeToolSemantics 与 CloudTasksPanel 改动；本次表格修复相关文件未报告类型错误，未改动上述文件。

- 2026-10-10：Codex 窄分屏和手机横屏中的会话上下文落入底部 14px 行，与模型和权限按钮拥挤。原生 composer 的 840px 容器规则显式覆盖旧紧凑样式，将信息移到现有悬浮信息行左侧并省略长标题，输入区不增高；4 场景红灯复现后 12 个设备/主题整页门禁通过。
- 2026-10-10：收起侧栏的 20px 悬浮把手覆盖起于 x17 的表格首字。把手缩回 16px 正文边距，图标缩至 12px，保留展开/固定入口；真实首字符 Range 几何断言由红转绿，两主题与手机横屏重新截图。
- 2026-10-10：独立计划预览继承浏览器 body 的 8px margin，深色窗口出现白边。只在独立文档 realm 挂载时重置并在卸载时恢复 margin；文档画布使用实际原生 pane 背景并恢复原样式，避免 overscroll/resize 出现白色或主应用底色，不改变主工作台主题或全局样式；单测与四个桌面/手机两主题原生菜单场景先红后绿。
- 2026-10-10：Codex 围栏误用 Shiki 多主题色值，且旧 Prism 的 !important 覆盖原生呈现；表格、标题、列表和引用也沿用不同默认排版。核实实际原包 Markdown 使用 hljs 11.11.1 后独立实现原生围栏与表格，并限定 Codex 样式；四 profile 原包尺寸/字体/token/SVG 逐项通过，Claude 保留既有 renderer。流式结束 remount 丢失 wrap 选择，改为 thread/message 范围内持有。
- 2026-10-10：公开思考完成态未剥离标题、拒绝审查增加了原包没有的状态文案，运行/上下文 Hook 泄漏到完成统计，失败 MCP 仍按遗留 structured data 显示成功数量。分别采用实际原包 title/denied/terminal public hook 与 success-only 语义；各项先红后绿，25 文件/79 专项通过。

- 2026-10-10：新增原生服务等级和 approvalsReviewer 后，前端实际发送的队列参数被 Node 旧白名单拒绝，连 null 默认值也会收到 400。恢复有界 serviceTier、原生 reviewer 枚举、严格 granular 审批结构及 externalSandbox 的 restricted/enabled 网络语义；38 个路由/队列红绿测试与全后端 725 通过/1 已知忽略，验证参数原样送至捕获的 thread/turn，非法值在写 journal 前拒绝。
- 2026-10-10：并发 Vite 工作树共享 symlinked node_modules/.vite，某个优化器替换 chunk 后，另一个进程的内存 transform 仍引用旧资源，Mermaid 动态导入 504 并触发整个会话 ErrorBoundary。开发缓存改为 canonical 项目根 .dev-runtime/vite-cache 内按进程实例隔离，正常配置重载复用实例；没有清共享缓存或停止其他进程。3 个红绿测试、98 个脚本测试与真实 LAN Mermaid 复验通过。
- 2026-10-10：账户取消回执 notFound 被误说成取消成功。按原生 canceled/notFound 分开提示，无待取消登录时只读核对现状，不调用 onAuthenticated；专项先红后绿，47 账户测试与桌面/手机两主题 4 LAN 通过。
- 2026-10-10：Hook 详情沿用通用 512px/p24 的对话框，字号、折叠图标及初始焦点与实际原生 xwideTall 不同。改为原生 680px/92vw、最大 800px/92vh、内距 20px、统计行 12px 与原生关闭/展开图标，手机保留额外 44px 无形热区；真实原包四 profile 几何/SVG/文本/焦点复验通过。

- 2026-10-10：Mermaid 沿用默认 lavender 配色和传统 flowchart 几何，与实际插件节点、箭头、文字及布局不一致。按原包纯 ELK renderer、主题变量、开放 marker 与文本测量实现，Codex 私有 alias 不改变 Claude；四个设备/主题与中文节点、复制/缩放/真实 SVG 下载及同页隔离共 6 场景通过。隐藏 shadow 测量宿主未继承原生 font-synthesis-weight:none，另导致中文节点 227→226px、中心差 0.5px、viewBox 差 1px；局部补齐原生字体 flags 后精确对照转绿。
- 2026-10-10：Codex 中文字体会合成粗体，代码、表格、Mermaid 和 Diff 字形与原包不同。实际原包 html/:host 关闭 weight synthesis，但保留 style synthesis；Codex scoped presentation 与 Portal 补齐同样 flags，不更改 Claude 或全局 body。四 profile 原组件 computed flags、几何和真实截图门禁通过；没有用禁止全部 synthesis 消除正常斜体。
- 2026-10-10：完成动态工具组摘要丢失实际 item，只渲染 raw tool 名，并按 tool 名合并不同 namespace 与成功/失败调用。保留源 item，采用原包 leading/following 描述和 namespace/renderer/state/schema identity；2 个复现红灯、37 项相关测试与 10 个完成汇总/只读目标 LAN 场景通过，纯 helper 的原包 589 分支另行验证。中文原生 unit 列表不带分隔，原包复数文案不含数字，沿用实际规则。
- 2026-10-10：工具和自动审查展开箭头仍向右。共享 command 样式改用 data-expanded，而两个叶子仅传 is-expanded class；绑定真实展开属性后复用共享样式，原包 90°/产品 0° 的实际 LAN 红灯转绿。五种展开状态×四设备/主题共 20 状态通过；补测修正旧 120 状态对照遗漏的 computed rotation 维度。

- 2026-10-10：MCP 完成组仅累计 tools++，丢失实际集成来源；专用 cloud_threads.read 也被误归普通 integration。按原包 Ogt/Lt/Ue 将命名来源、未命名调用、REPL 命令及真实 native descriptor 分开；来源按 key 计数、保留最新公开 metadata/首次顺序/任一次 preferred hint，再按显示名去重。MCP 与 dynamic 描述共用有序集合，成功/失败状态及 foreign 门禁保留。原包 30 分类与 24 Intl 组合、48 项集成单测、10 个实际 LAN/原包场景通过；最后四张稳态截图复验与全量 1,161 项通过。早于最终 scalar 或构建触发 HMR 的失败另行保留，详见实施验收记录。

- 2026-10-10：Codex 输入区漏接桌面附件 drop，只支持相册和粘贴。按原生 enabled drop 分离图片与普通文件，在原会话捕获文件、拒绝受限子 Agent 输入、不自动发送/聚焦；本机 UTF-8 文件保存完整快照，普通文字与标签拖放保留。混合附件优先展示图片与删除入口，多文本文件按选择顺序保存，不被异步读取速度打乱。先红后绿及浏览器恢复证据见原生呈现实施记录。
- 2026-10-10：WebKit 相册选择器的 File 写入 IndexedDB 报 UnknownError（Error preparing Blob/File data to be stored in object store），导致尚未上传即失败。保存实际 ArrayBuffer 字节和文件元数据，恢复重建 File，兼容旧记录；继续在持久保存成功后上传，存储错误不绕过。真实 WebKit 手机红灯、模拟相同存储错误的红绿用例与字节一致性检查均保留。
- 2026-10-10：云快照 403/404 的能力缓存永久禁用，同账号接口恢复后“刷新账号”也无法恢复。不可用记录改为 60 秒有效；过期后的只读能力查询回到未知，不虚构可用，不自动上传或创建任务。403/404、59,999/60,000ms 边界与显式重试共 5 项单测通过；实际旧接口 404 的外部限制仍保留。

- 2026-10-10：读取/保存图片字节期间移除附件，旧回调仍在保存结束后开始 HTTP 上传。上传前和等待持久写入后都按附件 ID 核对所属草稿，已移除不启动网络；已开始上传的迟到回执仍不能复活附件。1 个真实行为红→相关 5 文件/19 项转绿，保存失败、创建迁移和重试规则保留。

- 2026-10-10：Codex 手机图片删除热区扩大为 44px 后，84×62px 缩略图中心被覆盖，点击/触摸预览会被删除按钮截获。Chromium、WebKit 的实际相同三场景失败和截图保留；图片改为 96×62px，小圆叉仍位于右上角，透明热区保留 44px，输入框不增高。新增 elementFromPoint 中心命中断言，不能用强制点击绕过遮挡。
- 2026-10-10：上下文容量把历次累计 token 当成当前上下文，长会话被误报为已满。按插件 \_ma 使用 last.totalTokens/modelContextWindow，并隔离当前 thread；未知/非法容量不虚构百分比。采用原生 12px 单色进度圆与三行用量说明，保留手机点击查看和触控尺寸。8 个实际红灯转绿；浏览器菜单与两主题几何另外验收。

- 2026-10-10：原生文件引用和 memoryCitation 未完整接入，文件范围受旧 500 行预览截断；补齐安全 Markdown 解析、协议字段和原生 pill，按原项目打开实际完整只读文件与行范围，复制/导出保留来源。引用按钮的 span role=button 又触发卡片捕获选择，现纳入交互元素排除规则，背景点击选择保持正常。原包与实际 LAN 四个设备/主题场景验证 600 行文件的 502–503 行及另一个窗口的输入/草稿不漂移。
- 2026-10-10：手机 memoryCitation 点击后被祖先滚动关闭，公开说明来不及阅读。仅触摸操作显式保持提示，仍允许再次点击、Escape 和外部点击关闭；桌面保留原生悬浮及滚动关闭规则。实际祖先滚动红灯转为 6 项单测通过；最新引用/插件六场景浏览器回执逐项记录，不把触摸适配称为插件桌面行为。
- 2026-10-10：插件 Try now 在未保存表单取消离开时仍改变会话/项目/草稿，安装后候选也未更新；先完成离开保护，再校验捕获的原目标与操作版本，并刷新已挂载输入器。原生插件 @ 名称保留独立 plugin:// 身份进入 turn/start，修复网关把其误交给严格子 Agent 引用校验的 HTTP400；子 Agent 校验、集合及计数不扩大。
- 2026-10-10：技能链接、删除和安装接受越界名称或根外符号链接，MCP 配置未遵循非默认 CODEX_HOME。隔离真实红灯后增加单段名称、scope/cwd、canonical 根和链接边界校验，删除只处理链接叶子；配置统一原生 home。Rust 工作区 172 通过/3 外部忽略，严格 clippy 与构建通过；正式运行二进制尚未启用，不能称正式接口已使用新 guard。
- 2026-10-10：360px Codex 输入器显示上下文容量时，Agent 按钮覆盖加号和权限中心。移动引用/容量到现有常驻悬浮工具条，模型允许收缩、Agent 明确宽度并为上下文预留空间；不隐藏常用功能，不增加 124px 框体高度。真实 elementFromPoint 红灯、菜单/候选几何与运行中停止/排队按钮并存逐项验收。
- 2026-10-10：WebKit 的技能候选定位和长历史挂载报 ResizeObserver undelivered notifications。实际观察记录分别定位到 Lexical 动态 caret 锚点和聊天视口尺寸回调；候选仍附着输入框，未使用的 caret 锚点保持稳定尺寸，视口回调在下一帧调度并在卸载取消。行测量保留同步，避免改变阅读锚点；两会话各 10000 条历史、延迟代码/图片与页面零异常进行真实浏览器验收。
- 2026-10-10：Session 外壳未消费非零安全区，底部控件可能落在系统保留区域。使用环境安全区 padding，浏览器零安全区几何保持原样；Chromium CDP 注入顶部44/底部34px并验证导航与发送/分支入口。此证明属于浏览器环境值，实体手机安全区与 OS 键盘仍需分别验收。
- 2026-10-10：终端验收脚本在 HTTP 写入返回后立即发送 Ctrl-U，未等待真实 tmux rename prompt；并发全套中旧窗口名未清除，独立脚本也复现12轮3次错误。改为本测试拥有的持续 WebSocket 等待新 prompt 实际输出，排除 replay，再发送编辑输入；产品输入路由和全局 tmux 配置不改。原精确名称/取消断言保持，全套并发4为728通过/1既有跳过/0失败。

- 2026-10-10：MCP 授权等待只订阅 Tauri，网页收不到完成回执且可能永久禁用操作。复用网页 Codex SSE、原服务器/URL/操作实例，完成与启动状态按最新版本只读核对；等待恢复不重新发起 OAuth，结果未知有界退出。固定 HTTP 适配器把安全 bigint 超时转换为 JSON 数值，非法范围请求前拒绝。真实管理页的 HTTP、通知、弹窗和草稿场景使用隔离夹具，实际账号回调能力另行验收。
- 2026-10-10：MCP 手机标题被操作按钮挤成两行，深色详情对比仅1.658，浅色状态文字对比仅3.020；44px 开关适配又同时应用 Tailwind translate 和 transform，圆点右边到51px、超出38px轨道边界。窄卡片分行安排身份/状态与操作，深浅配色分别修正；开关保留正常轨道和44px热区，清除重复位移。截图定位、实际颜色/几何/中心命中断言均先红后绿。
- 2026-10-10：手机 MCP 授权通知在顶部遮住返回按钮，WebKit 真正点击被 toast 截获直到超时。手机此卡片通知移至下方，一次授权更新同一通知而不叠加，离开卡片时清理本卡片通知；保留关闭入口及桌面位置。单测复现与管理页实际返回中心命中/草稿恢复验收，不通过强制点击或等待通知消失掩盖遮挡。
- 2026-10-10：WebKit 标注图片仍在 drawing.originalFile 中保存嵌套 File，虽然结果图已转为字节，IndexedDB 仍报 UnknownError，第二次上传不发生。原图与结果图均保存实际字节及元数据，读取时分别重建，保留旧格式。模拟相同错误先红后绿，真实 WebKit 验证原图像素、笔画、批注、移除/撤销及刷新后继续编辑。

- 2026-10-10：插件候选数组每次渲染都改变引用，外部草稿同步 effect 用旧 value 复写刚清空/编辑的正文；被动替换还保留已经删除的选区节点，后续引用插入失去上下文。候选数组稳定化，只有外部 value 改变才重建正文，恢复光标前检查节点仍附着；随后真实快速全选删除仍复现 DOM 已全选但 Lexical 保留旧光标。只在所属编辑器 Delete/Backspace 捕获边界同步实际非折叠 DOM 选区，保留局部选区、原子 chip、IME/composing/229。真实原序列3/8失败→8/8，相关19单测与合并 Chromium33/WebKit32通过，没有加等待或强制清空来绕开问题。

- 2026-10-10：模型菜单残差包含真实副标题透明度、11px 行高、Chevron 对齐、滑轨/旋钮边缘与端点差异。按启用的 VSIX 源码和相同宿主参数逐字段修正，四状态原包对照及相关单测通过；保留原包外框整数测量与自然高度的区别，不硬裁高度或改变全局/Claude 色值。
- 2026-10-10：手机 MCP 通知关闭按钮虽然已扩大到44px热区，Sonner rich-colors 的高优先级背景仍画出整个大圆。限定该卡片通知的选择器，触控背景透明、可见圆圈20px，保留成功/信息/错误颜色；实际 computed 背景红→绿，两引擎浅深主题与正常关闭/返回分别验收。
- 2026-10-10：横屏表单字段区的 overscroll-behavior:contain 吞掉滚动，即使字段区没有可滚范围，也无法继续把下方提交按钮滚入聊天视口。改为允许向外层聊天滚动传递；控件几何与真实浏览器滚动/中心命中先红后绿，短视口卡片仍按正常滚动阅读，不通过强制点击绕过。
- 2026-10-10：模型菜单在独立 Portal 中丢失原生字体合成规则，显式高/极高/Ultra 状态色也未按实际元数据区分。限定模型菜单继承原生字体 flags，显式高与极高使用蓝色，仅真实 maximum/ultra 使用紫色，不把最后一档或 xhigh 当作 maximum。未改全局或 Claude；真实原包六场景与三状态元数据红→绿。
- 2026-10-10：插件手机安装/使用、返回与管理标签的按钮只有28–36px，详情动作贴边且紧接正文。插件专用粗指针规则将热区扩为44px，详情采用16px侧边留白与16px正文间隔；桌面动作几何保留。实际点击完整安装/使用与原会话 typed 提交红→绿，不通过缩小功能集合规避。
- 2026-10-10：插件安装通知位于手机顶部，遮挡返回入口；普通通知在深色下仍是白色，关闭热区也只有20px。此插件通知采用当前 Session 主题，手机移至底部，20px可见圆保留44px透明热区；正常 Sonner 通知没有 data-type，按实际 data-styled 属性限定规则。安装通知仍可见时真实返回、离开保护取消及正常关闭先红后绿。
- 2026-10-10：手机图片模板翻页按钮被样式拉成32×44px椭圆，触控宽度不足；模板区域还限制纵向滚动传递。44px透明热区内保持32px圆形与原中心，纵向允许传递到聊天、横向保持图库边界。真实下一组/上一组返回原始 scroll-snap 位置，选择与请求身份不变，未触发审批或提交。
- 2026-10-10：原包/文件选择器 E2E 夹具硬编码旧 Vite deps 路径，在每实例缓存启用后导入第二份 React，报 Invalid hook call 并使选择器为空。夹具只解析当前页面实际挂载的 React/ReactDOM 资源，保留精确点击和提交断言；受影响的 review/Guardian 原包场景单批17/17通过。此为测试夹具修复，没有更改产品选择器、原包资产或正式运行服务。

- 2026-10-10：终端模式为空，正式 registry 和持久文件均为零条。以 2026-10-09 备份原子恢复 45 条原 ID，31 条本机 tmux 重新连接，2 条失效本机、2 条不可达远端与 10 条 direct PTY 保持离线/手动恢复，不重跑历史命令。补修历史文件加载异常被当作首次启动、随后空快照覆盖的风险：仅文件不存在允许初始化，损坏/不支持格式明确报错并阻止后续保存；重启捕获脚本拒绝空接口覆盖已有非空记录或损坏证据。15 项持久化测试先红后绿，38 项分组/布局测试、后端构建及实际局域网 HTTPS `https://10.30.0.24:8484/?mode=terminal` 浏览器验证通过，原会话 ID 与分组刷新关联保持。用户设备原布局仍由原浏览器存储提供，不宣称已读取该设备的存储；正式 Rust 不重启。备份、恢复结果和截图在 `.dev-runtime/terminal-recovery-20261010/`。此次空文件的具体写入来源尚未确认。

- 2026-10-10：消息虚拟行可见性要区分公开摘要内容与仅空白字符串，reasoning summary 应按 trim 判断；不可见事件不能保留行间 padding。首屏测量需使用实际尺寸，隐藏视图保留缓存，不泄露原始推理内容；40 条空白摘要回归与手机/桌面浏览器验证见 `.dev-runtime/message-spacing/`。

- 2026-10-10：Codex桌面滚动抖动的实际原因包括新挂载行160px估算、1–4px向上滚动被跟随抢回、Radix scrollbar未识别和半露出行增高被整行补偿。绘制前实测挂载高度，向上阅读立即解除跟随，补偿仅限完全位于视口上方的行；保留overscan=2和同步行尺寸回调。键盘判定排除所属编辑器、已消费事件和IME。复现/回归见 `.dev-runtime/session-render-alignment/scroll-smoothness-progress.md`。
- 2026-10-10：Codex消息大空白来自末段13px尾距、渲染为空但仍有16px虚拟占位的reasoning/plan/sleep/hookPrompt，以及桌面assistant自有动作30px超过原生22px。只调整实际展示行和局部CSS，原事件、有效摘要及手机44px入口保留；完成消息正文间距52→44px。流式消息上的自有引用/侧边追问功能保留，区别于原生空footer。证据见 `.dev-runtime/session-render-alignment/message-spacing-progress.md`。
- 2026-10-10：轮次工作投影不能逐轮filter整段rows，否则总工作量按轮次×行数增长；使用单遍process索引，保留原始消息key和轮次身份。10000事件的精确旧块与当前块对照为3056ms→15ms、25042500→52500次字段读取，输出一致；持久阅读锚点的临时自动展开需要按实际expanded切换，不能只看显式opened集合。模块基准及原生turn生命周期/恢复首击浏览器回归见 `.dev-runtime/session-render-alignment/`。

- 2026-10-10：Codex 每轮运行计时和完成过程折叠缺失。按 thread/turn 投影工作摘要，实时开始时间与原生完成耗时分离，保留最终报告、交互/错误与重连提示；折叠不删除事件，搜索自动展开，原阅读锚点保持。详见 docs/session-turn-work.md。

- 2026-10-10：WebKit 桌面助手按钮在媒体/hover/selector匹配且窗口实际聚焦时仍隐藏，CSSOM显示嵌套group utility没有产生预期可见性。仅助手fine+hover范围补展开hover/focus-within规则，要求原窗口聚焦门控才存在的class token；桌面22px与手机44px保持。两浏览器各4项真实入口/中心命中、键盘Tab及原会话草稿守卫通过，门控单测6项通过；headless WPE不能提供真实跨页失焦见证，单独记录而不冒充实机验证。

- 2026-10-10：已在底部的回复增高后仍跨帧停留在旧范围，真实正向滚轮没有scroll事件，旧following observer仅观察固定totalSize容器并等下一RAF。复现原实现RO后渲染阶段离底391px；同一observer额外观察已挂载的最后一行，正文/最后行的尺寸递送在pinned时同步使用实际有界scrollHeight定位，viewport改变仍下一帧、detached阅读保持。相同双阶段测量的定向WebKit红→绿，离底0、半露出代码增长漂移0、页面和RO错误0；不用pre-RO单个RAF样本冒充已绘制画面，后续完整专项见实施记录。

- 2026-10-10：底部回复增高后的虚拟总高度提交可能再遗留17px尾部间隔；尺寸递送设置pending标记，下一layout提交先清除标记，再仅对仍跟随底部的会话完成有界定位，卸载清理。最终Chromium/WebKit各9/9滚动与阅读专项通过，实际RO递送后离底及阅读漂移0px，相关33单测和整仓类型/构建通过；独立WebKit1500条缓存切换946ms仍未达到500ms，不将其计为通过。

- 2026-10-10：手机从Codex标签切换到Claude仍自动弹出输入焦点，同种标签测试没有覆盖这条路径。真实touch点击见证为标签选中→公共AgentComposer发送cc-input-focus-request→Claude textarea获得焦点。公共输入区的被动聚焦复用已有粗指针判定并要求Session可见；Claude listener/正文渲染保持原样。原源浏览器红及触摸/隐藏模式两条单测红后，相关9单测与Chromium/WebKit各7项手机/混合Agent回归通过，保留桌面焦点和逐会话图片/文字恢复。浏览器引擎焦点证据不冒充实体手机软键盘测试。

- 2026-10-10：虚拟列表的 getItemKey 每次组件渲染都生成新引用，未改变的 rows 也反复失效并扫描键。按 rows 引用稳定回调，真实 TanStack 缓存测试保留末行增高和等长换 key 的失效规则；浏览器同一实例/同一 rows 的 1500 行读取为1521次。最新两引擎各9项滚动/阅读通过；此修复只闭合重复扫描，WebKit缓存切换989ms仍高于500ms门槛，不能宣称总体性能已达标。

- 2026-10-10：核心保留功能E2E仍使用旧React缓存路径、filesystem文件API、完成轮次一直展开和后台resume的假设，六项复测失败。夹具改为当前已挂载React、workspace-files read/save、真实点击展开轮次和只读turns/list/read；保留文件保存期间继续编辑、失败草稿与跨项目后台未读/阅读位置/输入owner保护。WebKit重载时旧document原生网络diagnostic与JS异常分开验收：两页window error/unhandledrejection和新页pageerror必须为零；所有原报告保留，仅精确旧生命周期、原生类型、同源session地址可归为导航诊断，不要求每次拒绝都有requestfailed回执。Chromium六项单批通过，WebKit五项及后续status定向通过，未改产品刷新协议或过滤真实JS错误。

- 2026-10-09：会话无限重连也可能是网关继承 `SESSION_MODE_ENABLED=0`；检查实际进程环境与 `/api/session/health`，显式启用后重启本仓库网关，保留已有 Agent 服务。

- 2026-10-09：新 Codex 空线程不能提前 unsubscribe：首条用户消息前没有 rollout，卸载后无法 resume。ownership 在新建成功后保护实例，首条 turn/start 成功才允许正常安全释放；分页历史只针对明确未物化错误返回空历史。

### 2026-10-09：Codex 消息卡顿与“替我批准”仍弹出人工审批

- 根因：未变化的队列轮询重建 store 和消息回显，触发聊天区重复渲染；健康流式事件期间仍每 5 秒读取完整近期历史，空闲关注会话也高频查队列；消息入队后等待下一次 1 秒调度。审批模式只传 `on-request`，缺少原生 `approvalsReviewer`，Codex 默认仍交给用户审批。
- 修复：相同快照保持引用，已完成 review 回执仍纠正迟到运行状态；流式事件健康时跳过重复历史读取，静默后保留补查；空闲队列 30 秒、活动/待发送队列 5 秒，重连强制核对；提交/修改队列后立即尝试串行调度，保持幂等与执行权规则。新建、直接发送及持久队列均把“替我批准”映射到 `auto_review`，切回其他模式明确恢复 `user`，保留既有沙箱与权限范围。
- 边界：审批模式对下一次发送生效，已经产生的待审批请求不会被浏览器盲批；原生自动审查可拒绝请求，问题输入与登录不属于命令审批。开发环境仍有切换长任务与共享主机抖动，不能据此承诺所有场景零卡顿。浏览器使用隔离队列和模拟原生调用，未向用户 Agent 发送测试消息。红绿灯、性能对照及联调入口见 `docs/session-mode-optimization.md`。

- 2026-10-09：会话模式提示 Codex 忽略 13 个全局配置项。用户配置仍使用旧的 `[profiles.*]`，含未加引号的点号名称及不支持的模型属性；迁移为独立 `*.config.toml` profile 文件，保留模型、服务商与受支持的上下文/压缩设置，移除活动配置中的无效属性并备份原文件。原配置严格校验失败，迁移后主配置及 8 个 profile 设置严格校验通过；只修复本机配置，不修改实验功能开关或重启活跃 Agent。


- 2026-10-09：会话 Codex 飞书完成通知不能只监听 AgentSessionRegistry；须在 Node 后台观察原生 turn/completed，先持久化 thread/turn 与游标，再异步核对和发送。仅原成功轮次最终回复，排除 commentary/子 Agent/中断；迟到历史重试，close 后旧 worker 不再写状态，避免覆盖新网关 outbox。开关共用终端 enabled，卡片不挂依赖终端注册表的回复/记录按钮。

- 2026-10-09：Codex 运行时浏览器内存快速上涨，未关注任务的 SSE 正文和界面隐藏的命令/文件输出 delta 无限制进入全局事件缓存。正文改为仅观察关注/当前/脱离关注展示会话及其子 Agent，隐藏 payload 丢弃，最终回复取代流式副本并保留命令完整结果；退出观察范围释放内存历史及分页，取消只读历史请求且拒绝迟到回填。摘要/子 Agent 订阅收窄，Bot 活动/历史与 ACP 共用 SSE，完成历史及元数据减少冗余正文引用，旧设备缓存过滤隐藏输出；原生审批清理、任务完成通知、睡眠锁释放、磁盘历史和草稿保留。真实事件桥接压力测试同时投递约 100 MB 命令 delta 和约 100 MB 无关正文，GC 后 JS 堆增量约 0.3 MB，最终回复/命令输出仍完整，见 docs/session-mode-optimization.md。

- 2026-10-09：终端模式 Codex「完整记录」显示未找到记录，但原生 JSONL 存在。长期运行的 Codex 会重新生成 shell 快照，快照时间不再接近进程启动时间，且 rollout 采用短暂打开方式，导致活动会话定位失败。历史读取新增按 session_meta.payload.timestamp 创建时间与活动 Codex 进程启动时间匹配的兜底，只恢复已登记且同目录唯一的主会话 ID；该只读兜底不更新 registry，不用于消息投递或完成通知；不按最近修改时间猜测，子 Agent、其他目录、非 Codex 进程及多个候选均不采用该兜底。回归覆盖快照刷新、元数据时间优先级、歧义拒绝和投递隔离；现场三张终端卡片历史接口恢复正常，无需重启 Codex。

- 2026-10-09：补齐观察中 Codex 会话和单个长任务的内存回收。交错 delta 未归并、完成工具/命令状态/行状态及重复正文长期保留，原有虚拟列表不能限制 store 大小；现按消息 ID 合并，设置单会话 8→4 MiB、全局 32 MiB 预算及 5 秒定时/堆压力回收，释放旧轮次与完成工具并保留运行工具、最新回复、草稿和审批。旧记录通过原生轮次/工具分页只读恢复，不 resume；部分恢复保留实时运行状态和顺序，边界变化显式失败。浏览器持续约 48 MB 输入后 GC 堆约 31–34 MiB，单轮 500 个大工具结果也可回收；参考官方 VS Code Codex 扩展的归并、分页和虚拟列表机制，证据与预算边界见 docs/session-browser-memory.md。

- 2026-10-10：Codex 活跃标签仍易内存爆满。上一轮工具压力测试仅 completed，漏掉 started(inProgress)→completed：工具分组以 OR 累积运行标记导致完成工具永久受保护；现以后续状态覆盖，保留真正运行中的工具。回收按事件大小增量扣减并一次过滤，旧预算不再反复 JSON 序列化正文；大型工具在事件入库前限容，设备缓存先裁剪再单次编码，同 key 写入串行只保留最新待写快照，正常自动回收新增无强制 GC 压力验收。问题及测试边界见 docs/session-browser-memory.md。

- 2026-10-10：深入对照官方 VS Code Codex 扩展发现命令显示保留 started/completed 双份状态，原生历史转换又重新制造双份副本。实时完成改为按 thread/turn/item 同位置替换，历史命令仅生成一份当前快照，运行中的命令不伪造完成；助手最终回复继续分隔命令组。官方 room 刷新合并、可见性、逐 item 订阅和 React Compiler 缓存的实证与尚未迁移的差异见 docs/session-browser-memory.md；不把终端帧队列误称为聊天文本帧合并。

- 2026-10-10：用户复测仍发现 Codex 工作时标签页内存急涨。对照 Open WebUI 的每帧列表/Markdown 刷新后，定位到本项目每条流式通知都重建整段 thread rows、JSON.stringify 正在增长的完整末条消息、重跑 Markdown/送达状态扫描；现按 thread/turn/item/part 把 delta 在进入 Zustand 前合并为每帧最多一次提交，并用稳定末行 key 判断新消息。具体上游模式与 Codex 运行时自身大 diff 内存问题边界见 docs/session-browser-memory.md。

- 2026-10-10：自动预算会保护最新回复，导致单条超长 Codex 回复、计划、推理文本和轮次 diff 可绕过会话预算；合并后的流式 delta 也会无限增长。会话缓存现在将这些正文限制为 256 KiB 首尾预览并标注省略中间内容，工具输出/文件变更沿用 64 KiB 限制，原生历史不修改。超限完成消息与持续 delta 的红绿灯覆盖见 docs/session-browser-memory.md；构建通过，未据此宣称标签页总 RSS 固定。

- 2026-10-10：会话消息流把 `hook/started`、`hook/completed` 和 `sleep` item 当作普通事件显示成 JSON 折叠块，聊天记录被低价值状态噪声占据。现这些提示在行构建时隐藏，并在实时 transcript、历史缓存和预算压缩入口过滤；warning 与失败通知仍展示。回归覆盖 hook 与 sleep 被屏蔽、其他有用 warning 保留。
- 2026-10-10：会话模式完成通知能送到飞书，但回复无法继续任务。根因是原生完成卡片未保存消息与 thread 绑定，回复服务只查终端注册表。新增独立原生绑定并继承回复链，可信回复通过会话持久队列续跑；运行中排队、去重及重启恢复均有回归测试。升级前卡片不具备绑定，请回复新卡片。
- 2026-10-10：队列网关在 flock 初始化期间关闭，异步 mkdir 返回后可能留下持锁子进程。关闭必须等待初始化收束与自有锁子进程退出，并在 spawn 前检查生命周期；立即关闭回归已覆盖。


- 2026-10-10：`mtp_infra` 恢复的 `codex resume <ID>` 因 JSONL 保留原工作目录、pane 位于 `docs/`，被 cwd 校验拒绝后错误回退到卡片旧 ID。活动 Codex 命令行的精确 resume ID 现在优先用于只读历史，验证目标 rollout 存在且不是子 Agent，不用于输入路由。

- 2026-10-10：Codex 工作期间标签页堆仍增长，发现 256 KiB 上限只限制留存正文，旧累积器仍逐增量复制整段已生成字符串，超限后也重建完整首尾预览。活动输出改为 8 KiB 稳定段和有界滚动尾部；历史数组与 Markdown 渲染只在最终快照时更新。真实 Chromium 事件桥接测试输入 3.2 MiB，CDP 五批采样堆从 30.6 MiB 到 36.5 MiB，强制 GC 后为 31.5 MiB；会话 218 文件 / 845 项、`pnpm check` 通过。测试未测浏览器进程 RSS，用户任务管理器仍需长任务复测。

- 2026-10-10：截断会话工具输出仍可能让 V8 切片字符串保留整份原始数据，字符长度预算无法发现。浏览器回归复现 16×4 MiB 输出截成约 1 MiB 预览后，GC 仍保留约 64 MiB；现于预览截断和流式分段边界复制有界字符串，同工具用例 GC 堆增量约 1 MiB。覆盖 MCP/最终回复/流式预览及实际事件桥混合命令、推理、计划；不改原生历史，不强制应用 GC。上游 VS Code/Cline/Open WebUI 源码对照和采样边界见 docs/session-browser-memory.md。

- 2026-10-10：按用户要求移除 Codex 聊天中的工具调用及输出。以前仅折叠工具卡片仍会缓存日志、参数和 diff；现实时入库、原生历史转换、旧缓存读取/写入和行构建共用过滤规则，轮次内嵌工具项也移除，不再维护聊天命令状态表。任务完成/错误、助手回复、提问及审批保留；历史子 Agent 信息先送独立观察器，避免过滤影响面板发现。工具输出 96 MiB 混合事件回归确认聊天缓存中命令条数为零。

- 2026-10-10：侧边聊天 fork 的 threads 元数据不得直接保存原始 turns.items；与主聊天共用 lightweightThreadForStore，避免工具日志和回复正文通过元数据形成第二份保留引用。

- 2026-10-10：会话模式工作时与空闲时浏览器内存仍上涨。排查发现后台完整历史轮询、工具 JSON 在浏览器收包后才过滤，以及每两秒未变化快照仍广播引发整片消息重渲染。修复为事件驱动历史恢复、浏览器专用网关传输裁剪、相同项目/标签快照保持 store 身份；审批与子 Agent 元数据保留。真实浏览器采样与传输回归边界见 `docs/session-browser-memory.md`。

- 2026-10-10（现场确认／防回归）：用户明确反馈提交 `7888474` 后“内存控制住了”。确认有效的组合为浏览器接收前 `view=chat` 裁剪工具正文、按事件/轻量更新时间补读历史、相同项目/标签快照保持原 store 状态，并保留有界流式正文与字符串引用释放。已将不可退回的旧做法、协议/恢复边界、测试入口及测量证据整理为 `docs/session-memory-contract.md`，并纳入根 `AGENTS.md` 的修改前必读要求；早期仅前端过滤方案不能作为恢复原始大包的依据。用户确认与短期自动采样分开记录，大规模输入延迟仍为独立未解决项。

- 2026-10-10（不可见正文自动释放）：关注标签和子 Agent 曾一直被当成正文消费者，小于容量阈值的旧正文可长期驻留。新增实际可见消费者的 60 秒宽限期回收，并阻止休眠后的增量事件和后台历史响应重新填满正文；保留运行状态、审批、草稿、未读，重新显示时恢复最近历史。发送回执确认独立于正文挂载，避免休眠引发回执补读循环。该修复针对可确认的留存路径，不把它等同于用户现场全部增长根因已消除。

- 2026-10-10（短任务静默完成恢复）：手机宽度的原生 SSE 静默回归重复复现任务已完成却没有未读。短任务可完全落在两次状态检查之间，原生快照 idle→idle 与本地 inProgress 矛盾，旧逻辑只认 active→idle，因而漏补历史。现发现矛盾时按轮次补读一次，重复快照不重复补读；通过先红后绿单测及手机浏览器连续三次验证。

- 2026-10-10（React 开发计时留存）：30 分钟压力任务中 JS 堆回收正常，但 renderer RSS 到约 2.3 GiB。原生 dump 和本机 React 19 源码确认开发性能记录含组件属性、持续积累在浏览器时间线。新增仅开发模式、仅 React 分类记录的时间线释放，不清普通应用计时/mark；保留命名空间避免同名误删。先红后绿原生 Performance API 测试覆盖留存、应用计时保护和生产无变更；RSS 长测单独验收，不以 JS 堆代替。

- 2026-10-10（会话文件夹展开）：目录箭头被“插入路径”加号按钮覆盖，点击箭头被截走；Codex 创建/删除文件触发刷新时，文件树又清空所有子目录展开状态。现展开箭头与插入操作使用独立命中区，同项目刷新保留展开位置并重读已展开子目录，项目切换隔离旧状态。红绿灯单测及桌面/手机浏览器覆盖多级展开、收起、独立路径插入与文件变化刷新；文件编辑草稿回归保留。

- 2026-10-10（任务完成提示音资源释放）：每次完成提示音都创建新的 AudioContext，仅停止振荡器、从不关闭上下文；原生音频资源不计入 JS 堆，自动播放被阻止时音频时间还可能停住。现同时完成合并为单个提示音，连续任务复用一个上下文，每声结束断开节点，1 秒墙钟兜底停止音频；空闲 30 秒或挂起失败后关闭上下文，关闭期间不新增上下文；音频故障不阻断完成处理。新增红绿灯单测覆盖正常结束、千次重叠、挂起、异步关闭和失败；原生浏览器核对播放并发及空闲上下文归零，长期 RSS 单独验收。
- 2026-10-10（内存长测边界）：上述释放修复后，30 分钟原生 SSE 的 870 轮任务中，JS 堆自然低点仅增加 3.7 MiB、音频上下文始终只创建一个，但 renderer RSS 的末段低点较暖机早段仍增加 145.5 MiB，超过 128 MiB 保护断言。保留失败记录及原断言，不把单测、基本回收用例或短时 RSS 回落当作“整个标签页长期增长已彻底解决”的证据；对照与排除项见 `docs/session-browser-memory.md`。

- 2026-10-10（会话完成飞书通知双发）：同一原生 Codex thread/turn 会同时被会话模式 outbox 和终端历史观察器看到，旧实现按不同 sessionId 生成飞书发送身份，导致两条内容基本相同的卡片。发送器现在按真实 Codex threadId + completionId 共享进行中、短期回执和 `.dev-runtime/feishu-reply-bindings.json` 持久回执；脚本用本地子进程环境保留原生分片幂等键但不暴露到卡片或 lark-cli；绑定记录优先保留 `sessionModeThreadId`，避免回复被 terminal 记录覆盖。

- 2026-10-10（会话模式飞书重复通知）：同一 Codex thread/turn 同时被原生完成事件与终端 rollout 检测，各自以不同 Kanban session ID 发送，导致正文重复。现共用发送器按真实 thread/turn 合并并发并查持久回执，重启不重复发送已有卡片；统一分片幂等身份并保留旧原生键。回复绑定以原生目标优先，排除用户回复消息；成功缓存仅存有界回执，不保留正文。红绿灯覆盖两种触发顺序、同时触发、失败重试、重载、分片与回复目标，未向真实飞书或用户 Agent 投递测试消息。边界见 `docs/session-codex-feishu-notifications.md`。

- 2026-10-10（会话文件管理入口）：会话模式虽有基本文件接口，但工具入口仅图标／行末小菜单，上传固定项目根目录，复制直接依赖 Clipboard API，目录不能下载。新增当前目录目标、中文常用操作栏、右键及拖入上传，复用终端剪贴板兼容工具；新增有界 ZIP 与浏览器原生流式下载，避免下载 Blob 增大页面内存。切项目隔离操作目标，保留同名覆盖确认、版本校验和编辑草稿；前后端及桌面／手机回归见 `docs/session-file-management.md`。
- 2026-10-10：合并原生 UI 与远程内存修复时，整项工具过滤会丢失命令、文件变化、MCP 和 Hook 活动；直接恢复原始工具项又会引入大包与缓存增长。统一采用 Node/前端共享的有界元数据投影，保留序号、身份、状态与短描述，在传输前删除输出/结果/diff/私有推理正文；缺详情不再误报无输出或零变化。发送与队列保持原会话显式审核者及服务档位，不从 sandbox 覆盖。专项及真实网络验收结果见合并验收记录。

- 2026-10-10：迟到的命令 started 会复活已完成状态；命令终态不再被旧 started 覆盖，相同投影快照保持 store 引用。原生 Hook 的 BigInt 计数曾导致缓存 JSON 字节估算抛错并静默丢失持久化，改为只在字节估算时转十进制字符串，IndexedDB 保留精确 BigInt。旧客户端缓存读回固定 notLoaded 并移除 turn items，避免恢复过期 active/审批状态。对应状态与缓存测试已红转绿，工具正文、物理留存与预算限制保持。

- 2026-10-10：浏览器断线验收 fixture 主动结束 SSE Response 后仍保留连接，下一次心跳触发 write-after-end，掩盖实际恢复行为。断开时立即移出连接集合，所有发送前检查 destroyed/writableEnded；故障注入和恢复断言继续保留。原生答题自动换题后的旧 CSS 选择器与额外下一题点击同步改为语义提醒/实际题目状态等待，保留旧轮次不提醒、草稿与显式提交检查。

- 2026-10-10：健康探测持续失败时，短轮次可能在两次轻量列表采样之间完成，中间 active 未被采到；回执补读已保存 inProgress timing，但本地与返回的 status 同为 idle，状态相等短路使完成与未读恢复漏触发。现对同一快照/轮次的权威 idle/systemError 与 inProgress timing 冲突派发一次只读恢复；旧快照不覆盖较新轮次，同值 store 及重复终态保持稳定。35 项专项红转绿，不恢复活动静默全历史轮询。

- 2026-10-10（看板持续重连）：后端热更新加载 `codex-saved-patch.ts` 时，已声明并锁定的 `diff@8.0.3` 尚未安装，触发 `ERR_MODULE_NOT_FOUND`，网关端口 4001 无监听，前端代理持续 `ECONNREFUSED`。执行 `pnpm install --frozen-lockfile` 补齐依赖，再执行 `pnpm dev:restart` 恢复；局域网 HTTPS 入口的网关与会话健康接口均通过，原 Rust 会话运行层 PID 保持不变，未停止 Agent。更新源码新增依赖后须先安装锁文件依赖，具体启动流程见 `docs/startup.md`。

- 2026-10-10（重连防复发）：`tsx watch` 曾在新增依赖安装完成前重启网关，在线更新脚本安装失败后仍尝试重启。改为受依赖准备保护的串行 watcher：先安装锁定依赖并检查后端依赖可解析，再替换 Node 网关；失败保持旧进程并允许后续保存重试。在线更新安装失败跳过重启。回归覆盖顺序、失败保留、变更合并，以及真实隔离进程的存活/恢复/关闭；不管理 Rust 服务或 Agent。

- 2026-10-11（手机发送/粘贴不可见）：外部输入框成功投递不解除终端历史浏览位置，导致草稿清空但新输入不可见；粘贴 click 还会因键盘收起重排丢失。粘贴使用 pointerdown 与同步发送保护，API 成功按原会话触发底部跟随，覆盖输出/resize，重新滚动取消跟随。PTY/tmux 真实触摸红绿灯核对 UTF-8 到达、提交键和显示位置，测试仅使用隔离终端。

- 2026-10-10（Codex 文件变化元数据布局）：仅有投影元数据的卡片绕过原生标题、图标和列表限高，绝对路径撑满聊天窗口。统一紧凑标题和有界滚动区域，保留“详情未加载”，不将最多 16 项冒充总数或虚构增删行数；现存源文件按原 thread/cwd 打开，删除或未知归属禁用。
- 2026-10-10（Codex 正文字形与方向）：流式正文的 text-sm 覆盖导致完成时字号跳变，中文检测漏掉嵌套格式和扩展汉字，RTL 正文影响代码方向。继承统一字号、递归 Han 检测并明确代码 LTR，保留有界流式渲染和缓存保护。
- 2026-10-10（Codex 输入与提示对齐）：Alt+Enter 误发送、已选空会话提示错误、忙状态缺原生加载图标，以及上下文 tooltip 延迟/偏移/键帽不一致。按插件主包修复，保留手机固定高度、IME、发送 guard 和跨会话草稿归属；桌面/手机深浅四场景通过。
- 2026-10-10（Codex 请求卡片对齐）：题卡不能浏览未答题、输入提示未区分 Other/自由输入、网络“始终允许”藏在菜单中，错误和重连使用通用呈现。按实际插件原组件修复导航、文案、独立授权操作和 notice；错误里的 Markdown 包裹 URL 保持字面文本，原审批身份、明确提交和失败草稿保留。来源与边界见 docs/designs/session-render-alignment/ui-parity-audit-20261010.md。

- 2026-10-10：Codex Markdown 代码块的换行偏好原先局限于单条消息，开启后图标也未切换。对照 VSIX `mci/Isi`，现用独立设备级布尔偏好同步全部代码块并在刷新／流式完成后恢复；原包开启 SVG 已对照。不要改回按消息缓存，偏好不得保存正文。验收见 `docs/designs/session-render-alignment/code-wrap-progress.md`。

- 2026-10-10：Codex 代码块新增 VSIX hBi/tBi/qXn 的 SVG 图片分支，模板仅在惰性上下文规范化 xlink，经 data:image/svg+xml 的 img 渲染，不能将模型 SVG 内联进页面。保留复制原始字符串和 384px 图片限高；原生成功勾选来自 toolbar 实际 glyph，普通 tooltip 为 200ms、20px、5×12padding／18px行高，不能套 composer 紧凑提示或保留公共 Arrow。详见 `docs/designs/session-render-alignment/code-preview-controls-progress.md`。

- 2026-10-10：移除 subagents 工具标签后，未挂载的兼容摘要残留旧导航比较，阻塞 TypeScript 构建。摘要不再依赖工具标签或隐式关闭工作区，只走现有 openSubagents 只读刷新；旧运行态与未知计数的两项回归通过。不要为了编译恢复已移除的工具标签。

- 2026-10-10（Fast 闪电直接切换）：模型 catalog 同时提供 standard 与 fast 时，闪电误走服务等级子菜单，点击不能直接开关。改为只要真实支持 fast 就直接切换当前会话的 fast／默认等级；点亮表示已开启，熄灭表示标准模式，不弹出两项菜单。红绿灯覆盖开启、键盘关闭、原会话归属与不支持时隐藏。
- 本次 Fast 开关验证：相关单测 13 项、桌面/手机深浅主题专项浏览器 4 项及前端类型检查通过；旧输入区整套脚本有 4 项停在已移除的“展开编辑”断言，未计为通过。专项脚本为 `tests/e2e/session-codex-fast-toggle.spec.ts`，截图与日志在被忽略的 `.dev-runtime/fast-toggle-browser-proof`。

- 2026-10-10：Codex 表格的键盘处理应同时在原生复制按钮接入，40px 步长与 Mac Alt 页步长按 Eui；使用实际溢出尺寸避免 ResizeObserver 延迟。复制需独立 pending 锁、两秒默认成功防重和 yL 结构清理，不能直接复制 outerHTML。普通表格需要 fit-content 包裹、break-word 单元格、40/100/160 列长档位和原滚动渐隐时间线。链接颜色／500 字重与图标 1lh 居中必须以真实 Mention 组件检查，浅色参考宿主须同步 textLink 变量。见 `docs/designs/session-render-alignment/table-controls-progress.md`。

- 2026-10-10（Fast 开关真实目录补验）：上次仅识别 `serviceTiers.id=fast`，真实目录把 Fast 的 ID 返回为 `priority`，因此仍走子菜单。现优先识别 `priority` 并兼容旧 `fast`，开关写回目录给出的真实 ID；原会话归属保留。真实目录只读查询、priority 红绿灯及浏览器复查覆盖此遗漏，不用 deprecated additionalSpeedTiers 的标签代替协议值。

- 2026-10-11：NativeMarkdownTooltip 必须关闭窗口失焦与隐藏模式旧提示，blur listener 只随可见且打开的提示存活；参考原组件需包含 M1t provider，不能把缺省原组件环境中 Escape 无效当作插件行为。普通 URL 提示默认朝上，顶端自动翻转不是永久底部规则；长 URL 保留 break-word。焦点尊重 vscode-focusBorder，链接环圈画在标签 span，代码／表格按钮在自身绘制；原生 hover 取 vscode-list-hoverBackground，缺省透明。表格复制内容变化使用干净语义 HTML 比较，排除 UI aria/data 与 favicon 状态。

- 2026-10-11：LAN HTTP 不提供 crypto.randomUUID／Clipboard API，不能在会话模块加载时无条件使用。生产标识复用已有 uuid.v4；代码／表格／回复复制在 API 缺失时同步执行既有 textarea 回退，真实 copy event 写入 plain／清理后 HTML，finally 恢复焦点与选区并删除 listener。API 拒绝仍按错误处理。提示碰撞保留 8px；桌面 table hover token 规则必须位于透明缺省规则之后。原组件与产品文字 CSS 一致不代表截图像素相等，字体栅格残差独立保留。

- 2026-10-11：Cni/wni 只清理 http/https/tel/sms 中精确独立的 hotline query token，不能解码再模糊删除。自定义 Streamdown rehypePlugins 会关闭自动 allowedTags 合并，扩展 SMS 时须同时保留 citation tag schema 和原 hardening。非网站安全链接也有地球图标。Slack 富预览与 GitHub 实验门禁不同，不因直接图片 URL 就强制启用普通网站富预览。

- 2026-10-11：Slack 正文链接只显示普通 URL 提示，缺少原插件的域名／打开交互卡片。现按原组件接入固定 Slack 图标、悬停与键盘提示、上下方选择及失焦／隐藏释放；无真实连接时明确没有正文，真实账号／MCP 通路仍未实现。四种主题与窗口组合保留原包截图及严格几何／SVG 对照。

- 2026-10-11：Slack 富提示的 HoverCard 把打开链接移出 Tab 顺序，普通 Tooltip 又把正文／链接复制进隐藏的 1px 描述节点。改为可选交互 Tooltip，实际表面承载描述 ID，Tab 可进入打开链接，Escape 关闭；基础提示行为不变。新增读取控制器的红绿测试同时修复了 Escape 未取消待发预取、失败结果在一分钟内重复读取，以及 Codex Apps 封装资料被误判为不可用；旧账号迟到结果继续丢弃，当前生产 host 仍为空。

- 2026-10-11：项目搜索入口在高级模型菜单独占一行，导致原包几何对照多出 24px。保留搜索／过滤／显式自定义模型 ID，把搜索入口放进标题行；深浅主题的高级菜单原断言恢复通过，搜索与输入恢复的浏览器回归通过。

- 2026-10-11：Slack 正文 CSS 的 auto 高度动画比原插件约早一帧展开。改为与原组件相同的 Motion 高度测量、300ms 和原 easing，减少动态时立即完成；保留逐帧曲线、最终高度和正文截图证据。共享主机调度可能影响帧时间，不把一次局部动画通过等同于全区域动画／像素复刻完成。

- 2026-10-11：Slack 卡片只有受控字段控制器，生产 host 为空，无法读取真实 Codex Apps 数据。现接 TS 运行层的限定 context/read 接口，经权威账号路由、唯一 Slack 工具和目标核对，使用自己的只读临时线程并在发送浏览器前只保留匹配短字段；账号切换的旧调用退役等完成后才注销，不取得 Agent 执行权或加入关注标签。真实 HTTP/EventSource 四场景通过；正式旧服务与实际 Slack 连接仍未启用／验收。

- 2026-10-11：新预览传输在无连接状态缓存后，忽略后来出现的工具目录事件，打开的卡片需等一分钟才恢复。目录变化现在对已有正／负 context 只读重核，真实身份变化才通知并更新打开的卡片；在途目录变化合并一次后续核对。断连／恢复缺口不自动重读工具，保留原生 no-refetch-on-reconnect 语义，红绿单测与真实 SSE 账号切换回归通过。

- 2026-10-11：指南的 pnpm --filter ... audit 调用了 pnpm 内置依赖审计，立即报 Unknown option recursive，未执行运行层契约核对。改为显式 run audit；隔离注册审计实际输出原迁移契约 208/208，新预览两个接口有独立行为验收。

- 2026-10-11：预览接口直接抛出原生账号／目录异常，可能把冗长诊断带进浏览器，违背只接收短显示字段的边界。context 现在回退空连接，read 重核失败只给固定身份变化说明；原始诊断仍留在原生侧，红灯复现后全套运行层 179 项转绿。

- 2026-10-11：GitHub PR 富预览缺少原生生命周期卡片；新增受实验开关约束的展示分支与限定只读 MCP context/read 接口，按同目标优先 fetch、info 回退，并在返回浏览器前只保留匹配标题／状态。短描述改为原生内容宽度；真实原包键盘验证发现 Escape 丢失触发焦点，现关闭时恢复且不重复读取。Statsig 开关传播、真实 GitHub 连接和正式旧服务启用仍未完成，验收边界见 docs/session-github-preview.md。

- 2026-10-11：GitHub 卡片语言切换把格式化器当成新传输 host，清空缓存并关闭提示。展示格式化现与身份／读取控制器分离，打开卡片原地切换本地化状态且不重复读取；独立 i18n 实例的红绿单测验证。

- 2026-10-11：普通网站基线夹具没有 websitePreviews，被误当成 VS Code 无宿主能力；原 extension.js 实际注册 aM。现接固定只读网关接口，保留 HTTPS／公开 DNS／元数据／图片预算与原生三种图片布局；首轮浏览器发现缩略图圆角为 7px 而原包为 10px，已按原 DOM 修正。架构及公开网页／隔离 HTTP 验收边界见 docs/session-website-preview.md。

- 2026-10-11：普通 Markdown 大部分品牌只显示通用 favicon／地球。按原包实际 DOM 提取十类内置品牌 SVG 与域名边界，已有品牌不再多发 favicon，原始 URL 标签不被重新命名；20 个链接在两种宽度、深浅主题做完整 SVG／几何／颜色与截图对照。

- 2026-10-11：关闭网站图片并淘汰数据缓存后，Radix 回调的共享闭包仍保留 previewImage；data URI 图片资源及 React key 又产生缓存之外的原生留存。分离正文组件、清空旧 ref／props，图片改为卡片拥有的 Blob 并在关闭后注销，解码缓冲脱离清理闭包，大字符串不作 key。独立 CDP 三轮记录 JS／backing storage／renderer RSS，保留原阈值与失败证据；浏览器内置图片地址操作的 blob/data URI 差异仍明确记录，不能解释为长期自然 GC 全部通过。

- 2026-10-11：配对 Token 变化但网关 URL 相同时，网站能力 hook 可有一帧继承旧宿主的可用状态。能力状态现在同时核对端点与宿主身份，迟到结果不覆盖新身份，红灯复现后无旧状态帧；卡片补原包日文打开／加载与 GitHub 状态，语言切换不重新读取。

- 2026-10-11：favicon 成功解码后，正文链接与网站卡片仍把地球图标放在透明图片背后，换 URL 还可能继承已加载状态。现在按原 TNi 只在当前 src 未解码时保留 fallback，图片 object-fit 为 contain；两个独立红灯转绿，并补成功加载状态的原包截图对照。

- 2026-10-11：favicon 参数误用了完整链接，原 xNi 仅发送 HTTP origin。抽取共用 helper，路径、query、hash 和凭证不进入远程图标参数，同 origin 的不同网页复用同一图片 src；新增红绿单测，并在浏览器与原包核对实际 src、加载状态及 object-fit。

- 2026-10-11：网站传输的五分钟计时从读取结果开始，即使卡片仍打开也会通知退休。现在与共用控制器的正文可见生命周期同步，打开时暂停，关闭后才开始宽限；图片 LRU 优先淘汰不可见条目而保留当前卡片，原 32 条／24 MiB 上限不变，新增可见十分钟／关闭后回收和字节淘汰红绿用例。

- 2026-10-11：GitHub PR 实验关闭时被无条件改为 URL 提示；原 xri 仅移除 PR 参数，仍交给 Cri 的一般网站能力。现关闭／未知开关使用 NativeWebsitePreview，网站能力也缺失才回退 URL；不调用 GitHub MCP，新增注入两种传输的红绿用例和真实 HTTP／原生 D3 截图。

- 2026-10-11：工作区已接入反馈命令与反馈对话，SlashDialog 遗漏 feedback 导致 TS2345／TS2367 阻断构建。仅补齐已使用的类型成员，保留现有对话与上传实现；红灯类型检查日志保留，随后重新运行跨端构建。不以此记录声称反馈本身已完成原生 UI／远程提交验收。

- 2026-10-11：草稿配置的本地 Personality 类型漏掉原生 bindings 已声明的 none，新增默认性格入口触发 TS2345。配置类型现在直接复用原生绑定，不修改默认值、持久化或发送行为；原红灯保留，跨端 pnpm check 转绿。

- 2026-10-11：GitHub 走普通网站预览时，品牌图标继承完整前景色，圆角为 2px；原 D3 实际为 65% secondary 与 2.5px。新增品牌头部 computed-style 几何断言复现后按原包修正，保留红灯、JSON 与截图。

- 2026-10-11：原生网站参考测试直接重渲染裸 Markdown，丢失原应用键盘 Provider，造成悬停可用却 Escape 不关闭的假差异。新增渲染前 RPC 初始化 hook 并保留完整 Provider，不修改产品关闭逻辑；原失败证据保留，完整弹层／键盘与既有 Slack／Agent 隔离共 9 项浏览器回归通过。

- 2026-10-11：rich 预览上下空间不足时缺少原 J1t 横向候选，改用原同类 Floating UI 规则并校正 Radix 额外 wrapper 与 margin；关闭时释放观察器。真实原包 RPC 的 390／700 短视口完整坐标转绿，详见 docs/session-website-preview.md。

- 2026-10-11：全局 reduced-motion 的 0.01ms duration 意外插值 rich 定位 wrapper 的离屏初始 transform，computed 旧坐标无属性变化而未重核。仅 rich wrapper／外壳禁用 transition，原正文 Motion 保留；整页低高度锚点移动仍未解决，失败证据保留。

- 2026-10-11：Slack 动画夹具同步重渲染／Promise 回执起点不同，最近帧采样混入更新延迟。记录正文挂载并同时间插值后复验通过，原 340ms／12px／最终高度断言保持；旧失败与实际帧平滑度未闭合记录见 docs/session-website-preview.md。

- 2026-10-11：`/autoreview` 缺失，且聊天投影丢掉审查动作的 command，批准列表只剩「请求」。投影保留有界公开动作标签；斜杠打开批准面板并调用现有 guardian-denial，不启动回合。

- 2026-10-11：超长原生 diff 仍渲染全文。超过 100,000 字符改为「此文件过大，无法在此显示。」并提供「在编辑器中打开」。插件包未公开该字符上限。

- 2026-10-11：展开编辑的代码块语言是固定下拉。改为插件目录的可搜索选择，默认自动检测。检测规则只覆盖已从压缩包读出的部分。

- 2026-10-11：选中输入文字缺少「文本格式」。补上粗体、斜体、标题、列表和链接，结果写成 Markdown。工具条在编辑器上方。

- 2026-10-11：MCP 表单中间步骤误用「跳过」。改为「暂时跳过」，最后一步保持「跳过」。

- 2026-10-11：纯重命名 diff 写成「重命名：旧 → 新」。改为插件句「文件已重命名，内容未变更」。

- 2026-10-11：输入区缺少后台智能体摘要。补上数量、状态、模型和全部停止。单个停止仍在侧栏。

- 2026-10-11：失败排队消息菜单缺少「重试」。补上插件提示并重新入队。送达待确认仍先确认。

- 2026-10-11：计划卡片展开文案改为「展开计划概要 / 展开」。打开提示是「在新窗口中打开」。标题保留「计划」，不用「套餐」误译。

- 2026-10-11：计划增加「在侧边面板中打开计划」，右侧只读显示并可用「关闭计划侧边面板」关闭。可编辑计划标签未接。

- 2026-10-11：失败图片重试改为「重试 / 再次尝试上传」，点击重新上传。

- 2026-10-11：MCP 工具卡片补上「展开 参数」。投影只保留有界公开字段，嵌套对象和结果正文不进缓存。

- 2026-10-11：rich 内部分隔线混用外环 8% 透明度，原 border-subtle 为 5% oklab；按原 token 修正。原精简参考页／产品 Overlap 合成场景不同，匹配背景合成后正文零 RGBA 差异；未匹配场景失败仍保留，完整窗口未宣称一致，见 docs/session-website-preview.md。

- 2026-10-11：低高度 hover 回归曾用 Playwright 自动滚入视图，未解除 pinned 跟随，下一帧回底使链接离开鼠标。新增真实 wheel／mouse 与自动滚动因果对照，保留草稿／Escape／Agent 控制隔离断言；修正测试归因，不改生产跟随语义。

- 2026-10-11：Codex 反馈表单缺分类和日志选择，固定发送 bad／false，且异步提交缺少重复锁与迟到回执隔离。原包真实表单红灯后补六类、必填和原生 pending，捕获提交 owner／选项，被关闭实例不操作新表单；外观与完整宿主上传报告分开验收，后者仍未闭合。

- 2026-10-11：旧设置浏览器测试仍查已移除的 session-compact-status；打开模态面板后还通过默认 accessible role 查询被 aria-hidden 的背景计划按钮，产生假红灯。改为当前按钮、对话框可见及背景只读状态断言，保留草稿／不启动回合检查；设置与展开编辑两项通过，不修改产品计划逻辑。

- 2026-10-11：反馈默认流程等待 HTTP 才关闭表单，缺独立上传报告且未知回执可能被当作可重试失败。按原 startFeedbackUpload 补六状态、后台完成／重开及仅 failed 显式重试，捕获提交身份并释放旧工作流；红灯 HTTP 交接、原包状态矩阵和事件清理测试分别验证。
- 2026-10-11：反馈通知点击重开后，Sonner 的程序移除回调误删报告；核对当前通知实例再清理，程序隐藏与显式关闭分开，迟到回执不复活已移除任务。复制提示抢先消费 Escape，报告在捕获阶段按原语义关闭；均保留浏览器红灯与对照。

- 2026-10-11：上传报告浅色链接错误沿用深色回退色；按原 host token 与深浅主题修复。复制失败补原 clipboard.copyError 文案，并保留原按钮在回执更换时的状态及关闭后的独立错误通知；原 RPC 浏览器夹具等待实际 write 请求再注入拒绝，避免拒绝上次已完成的 Promise。

- 2026-10-11：原生通知服务同逻辑 ID 替换、程序关闭与卸载均可能触发 `onRemove`。反馈通知须先撤销旧实例删除权限，再替换或隐藏卡片，避免误删仍在上传的报告；呈现使用独立 Codex 视口，错误／进度卡片按未修改原包 Provider 做浏览器对照，计时器卸载释放。

- 2026-10-11：Codex 普通文本复制经 extension RPC，富文本复制经浏览器 Clipboard API；两种拒绝均显示原 `clipboard.copyError`，正文不额外插原始异常行。自定义通知的程序 close／自动过期仅移除，用户滑出才调用 `onUserDismiss`；custom success 不启动普通 success 的额外清理计时。MCP 真实认证流程仍待移植，切勿把通用通知卡片样例当成 OAuth 验收。

- 2026-10-11：局域网 HTTPS 入口无法打开；8484 端口仍有前端进程，但实际以 HTTP 提供页面，与 `.env` 的 `WEB_HTTPS=1` 不一致。使用 `pnpm dev:restart` 恢复 HTTPS，网关与会话健康检查返回 200，会话／终端切换、刷新和手机尺寸启动验收通过。原会话运行服务 PID 与 108 个 tmux pane 的 ID／进程均保留；恢复 31 个终端记录，10 个 direct PTY 仍需手动恢复，4 个 tmux 目标不存在或不可访问。首次冷加载超时、热更新期间的短暂连接失败及旧分组恢复测试失败保留在本机 `.dev-runtime/restart-recovery/20261011-093141/`，未修改或放宽测试。局域网地址为 `https://10.30.0.24:8484/?mode=session`，未验证另一台物理设备访问。
  最后通过真实局域网 HTTPS 页面内的原生 WebSocket 验证 `replay-complete`，读取 42,975 个帧字符，恢复接口返回 200 且 31/45 个记录在线；这项只读传输验收通过，不把此前未通过的旧分组测试算作通过。

- 2026-10-11 非云 Codex 回归：MCP 配置/ready 异步竞态、套餐与工作区身份混淆、通知 spinner/形状、菜单 null 撤销、LAN HTTP SHA-256 提交身份、复制成功图标/提示、后台智能体浮层遮挡已修复并保留红绿证据。聊天命令输出仍一律裁剪，MCP 凭证不作摘要，调用方 toolTextLimit 不得因元数据早退绕过。具体日志、计数与限制见 `docs/debug_list.md` 和 `docs/session-codex-mcp-auth.md`；30 分钟 RSS 先红后一次绿不代表长期问题根治。
- 2026-10-11：运行重启快照丢首条回复根因为立即重连后修复定时器再次物理重连。`eventStream.restart` 必须更新 repairReconnectAt，保留 onResync 的只读恢复；新增单测固定检查恰好两条连接，真实 HTTP/EventSource 三次通过，不能靠等待更长或刷新规避。
- 2026-10-11：BackgroundAgentSummary 批量停止不可硬设 current:true。复用 inParentTurn/selectStopTargets，过滤未验证目标，默认排除旧轮/未知轮次；必须确认名单，并在确认时校验根/父轮/子轮/epoch/账号工作区/连接，重复点击仅一次，取消零请求。安全测试与隔离浏览器见 docs/session-subagents.md。

### 2026-10-11：默认消息复制与公式分隔符

现象：用户默认复制得到 Markdown 源码且没有 rich payload，与原包 UserMessage 的渲染正文复制不同；助手复制沿用了用户的 1500ms 成功时长，异步写入在卸载后还会创建计时器。修复：点击时只读当前正文，按原 DOM 规则排除按钮、图标、样式和隐藏内容，保留列表、任务、表格 TSV、代码、引用及公式源；用户复制渲染纯文本，助手保留规范化源码纯文本，两者附带清理后的 HTML。助手成功提示 2000ms，用户 1500ms；卸载释放计时器并忽略迟到的成功 UI。HTTP 使用原 copy event 回退。原公式解析还区分单行 `\[y\]`（inline）和多行 bracket block，避免把单行公式改成 block 并误改数学类型。红灯证据：默认 rich payload 浏览器、助手计时及卸载单测、单行 bracket 单测；最终门禁以复制专项日志和原包双侧 payload JSON 为准，不把参考服务初始化失败算产品故障。

### 2026-10-11：反馈报告的同邮箱工作区隔离

现象：工作区 ID 已变化，但没有额外 account 通知时，旧反馈报告仍在界面并可等待旧回执。根因：原反馈生命周期只订阅账号协议通知与配对主机变化，没有订阅权威工作区命名空间。修复：仅在报告存在期间订阅账号／工作区身份；同邮箱不同工作区清空旧 UI 与重试闭包，迟到回执不复活，不取消或重发已提交请求；同一工作区仅套餐变化保持报告，移除最后一个报告即释放订阅。单测先红（1 失败／9 通过）后绿，独立 HTTP 浏览器通过；没有执行真实反馈上传。

- 2026-10-11 用户消息 Markdown 图片：原版将图片语法显示为 `!` 加链接，复刻此前展示成图片且复制载荷不同。用户文本改用单独的 AST 图片链接投影，保留后续文本，助手 Markdown 图片和真实附件放大／下载维持原流程。集成单测与原包 DOM 复制的 text/plain、text/html 精确对照先红后绿；19 项相关单测、1 项新增原包浏览器通过，证据 `/tmp/codex-user-image-link-regression.log`、`/tmp/codex-user-image-link-final.log`。

- 2026-10-11 批量停止确认失效保护：确认期间轮次／工作区／运行实例或名单变化后又回到原值，单纯比较确认瞬间的值会重新接受旧确认。新增同步且随弹窗释放的元数据订阅，范围曾变化即永久失效，须由用户重新确认；不因正文增量重复扫描名单。新增返回原值的确定性用例先红后绿，6 项安全单测通过；此前浏览器整组 47/48 的间歇失败保留，单独三次原用例通过不视为已证明其根因。

  批量停止补验：原过期确认与范围返回原值场景各三次、共6次浏览器通过；最终通知／MCP／复制／反馈／子Agent50项同批通过，原47/48失败仍保留。日志 `/tmp/codex-subagent-stop-scope-final.log`、`/tmp/codex-noncloud-image-scope-ui.log`。

- 2026-10-11 MCP 公共配置的 WebKit 验收夹具：跨端口重定向 JSON POST 会发出真实 CORS OPTIONS，请求被独立测试网关404拒绝，产品因此读不到公开配置。修复仅为夹具增加该固定 config/read 路径的204预检及明确方法／content-type允许头，生产网关未改；失败时保留公开请求／响应及网络日志。原真实 TS config handler、空参数、私有字段不外泄和提示可见断言保持。`/tmp/codex-public-config-webkit-wire.log` 红，`/tmp/codex-public-config-webkit-cors-green.log` 单项转绿。WebKit对interactive-widget的另一个浏览器错误仍单列，未过滤或冒充已修复。

- 2026-10-11 反馈弹窗圆角跨引擎差异：复刻固定使用25／12.5／15px，原包只在支持superellipse(1.5)时使用1.25倍半径，WebKit回退为20／10／12px。修复为相同的@supports分支，并在支持时应用原corner-shape；尺寸、颜色和动作流程保持。原包反馈浏览器对照先红，修复后WebKit上传交接及两尺寸×两主题六状态5项通过（`/tmp/codex-feedback-corner-webkit-green.log`）。整组跨引擎及其他兼容错误单独记录，未将专项扩大为全部验收通过。

- 2026-10-11 绘图编辑器订阅清理类型：工具和画布提示订阅直接返回Set.delete的boolean，作为useEffect清理函数时阻塞Web构建。改为执行删除后返回void，取消订阅和重复清理仍有效；两个返回值用例先红后绿，连同绘图文档回归6项通过（`/tmp/codex-drawing-dispose-contract-{red,green}.log`）。只修改清理返回值，没有覆盖其他绘图实现。最终构建和全量测试单独记录。

- 2026-10-11 WebKit用户消息操作栏：真实窗口focus、精确鼠标悬停均成立，但嵌套Tailwind group选择器没有显示编辑／复制操作；显式CSS隔离对照后原复制plain/html载荷相等。用户操作栏补齐助手已有的desktop显式hover／focus-within选择器，并继续以对应class token保留window-focus限制。真正的独立浏览器用例通过HTTP预置完成消息（首次空夹具缺消息不算产品红），移入显示／移出隐藏先红后绿，Chromium／WebKit各1项通过：`/tmp/codex-user-message-hover-{webkit-red-seeded,webkit-green,chromium-green}.log`。另一个WebKit请求访问检查错误仍未闭合，不将专项扩大为完整原包整组通过。

- 2026-10-11 MCP公共配置浏览器记录器：初始化切换身份会取消旧只读请求，response监听器却立即读取body，偶发Network.getResponseBody无数据并产生未处理Promise。记录器等待请求完成，只把明确net::ERR_ABORTED／Load request cancelled单列记录，其他HTTP／读取错误仍断言为空；继续要求有效公共config响应、原Native调用和提示可见，并把私有字段检查收紧为任何一个响应含PRIVATE_CONFIG都失败。Chromium3次／WebKit1次专项通过，产品请求／账户隔离未改，原50／51失败保留。日志 `/tmp/codex-public-config-cancel-observer-{green,webkit-green}.log`。

### 2026-10-12：Codex 稀疏正文与恢复提示

- 历史读取失败被实时 wait 等少量事件掩盖，且部分事件被误当作已加载缓存；按原插件独立错误提示恢复“无法加载消息 / 重试”，仅成功历史判断缓存，失败保留正文和草稿。真实 HTTP/EventSource 手机、桌面先红后绿。
- 首次恢复失败不进入 repairing 集合，自动重试成功及退出仍残留“同步延迟”；成功和退出清理观察服务自身的恢复状态，保留退避与事件驱动读取，未增加静默轮询。
- 原插件不显示 wait 调用，旧页面显示“等待子任务 · completed/inProgress”；聊天行过滤等待项但观察事件保持。其他协作调用改用原状态文案并默认折叠，子活动名称与文案按原 jS/LC/$w，不再显示内部状态。
- 原快照提问补回被追加到全部正文末尾，覆盖最新阅读尾部；按原 turn.items 顺序插入下一个保留项之前，保留身份、答案及协议事件。
- 输入状态绝对定位覆盖子任务栏；移入正常布局，桌面/手机相交用例先红后绿。错误卡片另保留原 corner-shape 能力分支和精确行高，Chromium/WebKit 原组件对照通过。
- 菜单测试误用 Playwright exact 参数阻塞 TS 检查，且手工输入器未清理污染后续三个格式化用例；保留原断言并修正无效参数/DOM 清理，不修改菜单产品逻辑。
- `pnpm check`、365 项相关单测、31 项浏览器回归及 4 项 WebKit 对照通过；30 分钟 soak 未启用，重显后 renderer RSS 上升仍保留记录。真实 session_main 正文可见、恢复提示清除、等待行与输入重叠消失。未停止 Agent 或刷新掩盖内存。依据、指标、边界见 [恢复修复记录](../../docs/designs/session-render-alignment/render-recovery-progress.md)。

### 2026-10-12：原生插件实验适配器与伴随扩展

- 原生 IPC 隔离曾仅排除 `~/.codex`，忽略控制进程配置的默认 `CODEX_HOME`。补齐 lexical/realpath 根、后代和别名校验；独立临时 socket 复现先红后绿，不连接正式 IPC。
- 初始化错误曾返回未初始化客户端，合并帧内 success 后立即关闭也可返回失效对象。初始化要求原生成功、已分配身份且未关闭；失败销毁连接、清理待处理请求。4 项新增红绿灯回归及完整 29 项适配器测试通过，独立复审通过。
- 仅复制伴随扩展目录未登记到 code-server 扩展索引，真实浏览器中 broker 未激活。改为自有 VSIX 独立正式安装；实测原版与伴随扩展均激活，官方宿主文件摘要保持不变。打包/安装契约有红绿灯回归；完整原型边界见原型验收文档。

- 实验宿主的 TMPDIR 曾可跟随已有符号链接，应用子目录也允许带登录/旧 socket 的非空目录；现统一拒绝符号链接、非 owned0700 和非空应用/临时目录，生成文件拒绝覆盖。独立假数据复现先红后绿。
- 伴随扩展在等待 HTTP body 前未占有窗口打开锁，两请求可并行调用原生 editor；现预先加锁，被拒绝请求不得释放他人锁。总 body 超时与原生命令超时独立，无法取消的命令超时后仍保锁直到结束；固定双面板命令使用相同锁。
- 停止启动器后，安装子进程退出仍继续创建后续宿主；自有进程登记增加不可逆 stopped 状态，跨异步阶段和每次 spawn 前检查。假 CLI 向父发送 SIGTERM 的用例先红后绿，未停止正式进程。
- LAN 实验宿主曾默认无认证，独立数据目录并不能限制完整 IDE 的主机文件/终端能力；现默认要求 owned0600 密码文件，私有 YAML 设置密码认证，argv/公开记录不含密码。无认证仅允许显式诊断开关。以上与原型宿主共27项回归及独立复审通过。

- 真实浏览器重连时，code-server保留首个extension host的broker，后续实例因EADDRINUSE激活失败。仅对该明确错误禁用新实例HTTP并保留本实例固定双面板命令，既不接管首listener也不将命令转发给它；其他bind失败仍释放自身资源并拒绝。实例metadata不覆盖首broker的ready记录。同端口两个独立VM module实例的真实HTTP回归先红后绿，宿主29项、适配器29项以及整分支补充复审通过；真实更新重连结果见原型验收。

### 2026-10-12：独立 Codex 模式

- broker listen 尚未建立时 dispose 会抑制 listening 回调；activate 须在 close/error/listening 共同结算，取消后不得打开面板/写 readiness，不能关闭其他实例 listener。
- native 同源代理须对真实 Host+协议校验 Origin，不能以 Origin 自造可信 Host；HTTPS Vite 必须传递协议。接收端分片限制与待发队列是两个边界，native 专用 receiver 限制不可影响终端；本服务不使用 WS 子协议，握手前拒绝避免上下游不一致。
- Vite WS 的 xfwd协议为wss/ws，须规范化后与HTTPS/HTTP Origin比较；仅打开101并不证明插件数据流完整。surface按官方extensionId过滤，迟到就绪清理专用loadError，后台不继续加载超时计时。
- code-server真实初始化WS消息约1257KB，native初设1MiB会1009反复重连；按实际bytes证据设独立2MiB message/queue预算，256KiB背压，>limit片段仍拒绝，不改终端receiver。握手101不足以验收数据链路。
- 原始宿主36秒稳定对照：browser→host最大6541792bytes，host→browser最大262144bytes，双登录UI且无close。最终native方向预算browser message/queue8MiB、upstream message/browserbuffer2MiB，单测须验证6.54MB完整发送及每方向超限早拒绝；握手/首消息通过仍不足证明后续资源流稳定。
- Native DOM ready/locator.isVisible不能证明实际绘制：code-server overlay父容器clip-path/overflow会裁剪自有fixediframe。只用自有可恢复container标记解除clip、设置指针边界，引用计数保留其他窗，不能改原inline/移动iframe。验收必须看截图并检查实际hit-test，不只数DOM窗口。

- 2026-10-13（原生 Codex 浏览器恢复与公共输入）：HTTPS Vite `/api` 代理漏转发实际协议，Resume 同源校验因此误判；启动遮罩 class 原位变化未更新 ready；宿主根截获原生 iframe 点击；离屏旧 webview 被当成第三列。分别补 forwarded headers、class mutation、宿主 pointer pass-through 和视口筛选，并有红绿灯回归。另修复空暂停 Session 队列阻塞原生发送，仅 queued/sending/uncertain 条目会阻止。真实浏览器唯一提交返回 409 且草稿保留、无回执文件或新 turn；可见 iframe 与 broker 当前状态仍未一致，不能声称完整 UI/发送闭环。

### 2026-10-12：原生新聊天与连接隔离

- 原插件新面板命令使用固定 URI，重复调用会被编辑器去重；自身伴随扩展采用白名单 UUID query 区分两个新聊天文档，原插件与 MessagePort 保持原样。URI、互斥、取消和独立面板调用有先红后绿回归，真实宿主已显示两个原生输入框。
- 连接复用审查发现登录类型可将任意 auth_mode 值带入运行元数据，服务环境变量也可指定 shell 初始化路径；登录类型限制为 chatgpt/apikey，拦截 shell／动态库等保留环境变量，复制只向全新私有目录写入。新增失败用例先红后绿，不读取测试中的真实凭证。

- 原生页面为透明背景，surface 隐藏 IDE 后露出工作台深色底，而原插件仍使用正确的浅色主题黑字，造成低对比度。自有 surface 保留 `.monaco-workbench` 根容器的原生主题背景绘制，其他 IDE 后代仍隐藏；主题变量仅在原 workbench 子树内，不能假设 body 具有这些变量。保持官方颜色与 CSS 不变，实际浏览器核对 theme kind、前景与背景。

- 2026-10-12（飞书回复被 bash 类型误判）：perblock 卡片绑定的 Codex thread 存活，但 registry 的 `agentKind=bash` 触发提前拒绝，三条回复记录为 `ignored_unavailable`。已绑定本地 tmux thread 可通过实际存活窗格枚举验证后投递原生 queue；禁止用缓存 ID、当前窗格或 shell 名称替代成员验证。新增双 Codex 对话连续三次回复红绿灯；保持离线/只读/无绑定/目标关闭拒绝及成功后幂等。

- 2026-10-12（会话文件引用经过目录软链接无法预览）：`xh2modelzoo/xhquant` 指向已注册兄弟项目 `xhquanttool/xhquant`，旧文件服务严格拦截任何符号链接，直接把引用路径交给读取接口便报“不能通过符号链接访问文件”。新增只读 resolve 元数据接口，将原会话内的别名解析为已注册项目中的真实 root/path；对话、原生引用、资源链接、Markdown 预览与文件树统一先解析再打开，保留行列／范围、保存版本和草稿。较晚点击不覆盖新文件；未注册目标、外部路径、断链、循环链接仍拒绝，读取／写入／下载的严格防护不放宽。示例文件已通过真实 resolve/read 内容比对；隔离桌面／手机回归见 `docs/session-file-management.md`。
- 2026-10-12（预览根目录变化触发会话界面加载失败）：文件树先打开别名，再补充解析后的项目 root，暴露 `FileViewer` 在 `??` 分支中条件调用 `useWorkspaceStore` 的 Hook 顺序错误。现始终调用两个 root 订阅，文件树存在打开回调时不再预先写入旧路径；红绿灯覆盖 root 有／无之间切换和无临时别名打开，原上传下载、展开及草稿浏览器断言保持。

- 2026-10-12（xh2modelzoo 终端 Codex 完成无飞书通知）：现场 tmux 存活且飞书已配置／开启，但 Codex 无常驻 rollout 句柄、无匹配 shell snapshot、无显式 resume ID，同目录多历史使定位返回空。完成观察新增仅只读的进程启动／原始会话创建时间唯一关联，保留目录与子 Agent 过滤、歧义拒绝，普通输入定位不变；现场已恢复真实 thread/turn 完成读取。定位／解析／发送暂时失败最多恢复 3 轮，发送失败不再被“已观察 ID”吞掉，成功仍去重；多窗格按探测轮次计预算，基线不补历史，stop/delete 清理。隔离完整链路与边界见 `docs/codex-feishu-notifications.md`，测试不向真实 Codex／飞书投递消息。
- 2026-10-13（飞书卡片回复 `ignored_unavailable`）：通知侧启动关联已找到存活 Codex thread，回复侧严格定位仍返回空。仅对私聊卡片绑定的精确 thread 增加只读存活进程／创建时间校验，然后交给原生 queue；普通输入、审批和登记保持严格，旧绑定／不可控终端拒绝，成功才幂等。隔离红绿灯与现场只读定位通过，未对真实 Agent 注入测试消息。

- 2026-10-13（Codex Resume 就绪竞态）：仅探测 code-server HTTP 使 UI 在 companion broker 未监听时提前开放 Resume 并得到 503。改为私有 broker status readiness gate 和可见模式有限轮询，未就绪时不可点击；新增服务/UI 红绿灯。
- 2026-10-13（Codex composer 目标不可见）：Codex composer 接收了 targetLabel 属性却未渲染，用户看不到当前 thread 目标。增加 compact target meta 与组件测试，保留当前单 thread followup 行为。
- 2026-10-13（Codex 项目历史 thread ID 校验）：项目 thread/list 曾接收任意非空 ID，Resume 路由只允许 UUID。列表解析与原生路由采用相同 UUID 格式校验，无效记录拒绝，红绿灯先复现后通过。
- 2026-10-13（Codex 公共输入遇到原生 writer 占用）：history Resume 打开原生窗口后仍走 Session followup，Session runtime 对已由官方插件 app-server 持有的 thread 返回 `SESSION_OWNED_ELSEWHERE`。改为 companion 版本门控的同实例 app-server `turn/start`，发送前校验原生 editor/thread/列/cwd/idle，幂等账本只存 hash 和回执不存正文。busy、待处理队列或未知回执保留草稿、不改走 Session writer、不广播；专项测试通过，真实浏览器助手回复待验收。
- 2026-10-13（Codex 公共输入浏览器验收续记）：上条记录中的首次尝试确实在生成回执前拒绝，没有产生 turn。之后在隔离一次性 thread 上重新 Resume，并从公共 Session composer 单次提交；网关返回 202，thread/read 只有一条新增 user turn 和对应已完成的精确助手回复，第 2 列未变化。测试 thread 通过原生界面归档，项目登记和浏览器目标已清除；这不扩展为 busy、重复提交或多窗口组的实浏览器验收。

- 2026-10-13（顶栏模式选择层级不一致）：新增 Codex 后仍保留会话／终端二态推杆，造成三种模式入口不并列。统一为三个同级按钮，删除拖动状态、轨道与 Codex 专用分隔；切换焦点移到新模式的选中按钮。红绿灯覆盖无二态开关、选中状态、禁用操作及隐藏工作区／草稿保留，隔离浏览器覆盖桌面与手机几何和键盘。
