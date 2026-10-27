# 隐藏会话页的快捷键生命周期

## 问题与修复

Settings 次级页的 `ConversationMenu` 会在切换到终端后保持挂载。此前全局 `codex-open-keyboard-shortcuts` 和 Ctrl+/ 监听仍可修改其本地打开状态；Dialog 的可见性保护只隐藏面板，返回会话后才出现迟到的快捷键面板。原只读证据位于 `.dev-runtime/session-conversation-shortcuts-audit-20261027/`。

`ConversationMenu` 现在复用 `useSessionInteractionVisible`，会话根隐藏／inert 后注销这两个监听；回调还同步检查真实 DOM，保护可见性变化与 effect 清理之间的同一事件循环。这里使用 Session 可见性，而不是 Agent 页可见性，因为可见的 Settings 页面也有合法快捷键入口。父附加菜单关闭时的 `triggerContainer === null` 门控保持。

没有重设 `shortcutsOpen`、表单内容或 owner。已经打开的面板在模式隐藏／恢复后保留；仅忽略隐藏期间的新打开请求。没有移动 Portal、清理草稿、发送任务或改变原生插件。

## 红绿灯与浏览器

证据目录 `.dev-runtime/session-shortcut-visibility-fix-20261027/`：

- `unit-red-final.log`：旧产品两个隐藏请求用例失败，已打开面板跨隐藏保留的控制用例通过。隐藏之后立即在同一 act 分发键盘／custom event，能覆盖 observer 清理尚未执行的窗口。
- `browser-red-settled.log`：旧产品真实切换 Settings→已加载的 Terminal→分发隐藏请求→Session，返回时错误出现一个面板。所有 API／WebSocket 使用隔离夹具，不附着正式 PTY。
- `unit-green.log`：完整 ConversationMenu native 与父菜单生命周期两文件87项通过，包含上述三项。
- `browser-final.log`：1440／390px、浅／深两主题共4项通过，手机使用真实 tap 进入“更多功能→设置”及切换模式。隐藏请求不弹迟到面板、不 preventDefault；可见 Settings 的真实 Ctrl+/ 仍打开面板，Escape 关闭并返回原会话草稿，pageerror／任务写入为零。
- `browser-green.log` 中原6项父菜单回归及2项桌面新用例通过；首轮手机准备错误地寻找窄屏隐藏的顶栏 Settings 按钮，2项失败保留。准备流程改用已有手机菜单后，最终4项均通过，没有添加额外 Escape、force 点击或放宽产品断言。

初次 `browser-red.log` 使用错误的 Terminal 根选择器，不能当作缺陷红灯；修正为实际 `.app-shell-v2` 并等待加载后才得到 `browser-red-settled.log`。LAN 入口为 **HTTPS https://10.30.0.24:8484，端口8484**。这些用例证明本项目隐藏模式边界，不代替官方原组件全部菜单或完整跨 owner 表单验收。
