# 会话模式对齐第六批验收（2026-10-27）

本批处理四项当前可复现差异：最新完成原生助手回复操作条被 hover 隐藏；Settings 等次级页隐藏时仍接收快捷键；菜单切换表单后 owner/cwd 漂移或草稿串用；菜单与对话框交接后 body 指针锁残留。逐项边界见[助手动作](latest-assistant-actions-20261027.md)、[隐藏快捷键](hidden-shortcut-visibility-20261027.md)、[owner表单](conversation-menu-owner-audit-20261027.md)、[菜单层生命周期](session-menu-layer-lifecycle-20261027.md)。

## 修复

- 对照26.51007.21434真实 `isMostRecentTurn`、`assistantItem` 分组和 `cx`，仅对最近原生轮次的唯一目标行常显按钮；hover/键盘仍能显示历史消息动作，未改发送、fork与写入权限。
- 隐藏Session时注销Settings快捷键监听，回调同步检查`hidden`/`inert`，已开面板与草稿保留。
- owner表单打开时捕获thread、project、title、draft owner与读写scope。切换后仍显示并编辑原会话表单；小字段本页按owner暂存，主Composer卸载后可恢复；脏内容不因容量限制被逐出。明确提示刷新不会恢复。
- Session有打开的Dialog时，closed Dropdown层即时卸载，避免已关闭的Radix模态层遗留body指针锁；不写全局body样式。普通菜单单独关闭动画不变。

## 验收结果

- `pnpm check`：共享包、session-runtime、server/web类型和生产构建通过，`.dev-runtime/session-parity-r6-20261027/check.log`。构建没有替换活跃的旧Session runtime。
- 会话UI全量Vitest：591文件、3659项通过，`.dev-runtime/session-parity-r6-20261027/session-vitest.log`。
- owner表单：14项真实workbench浏览器，覆盖390/1440和浅/深两主题；1440px正常点击，390px全部使用真实tap。5文件114单测、web tsc通过。8个写请求都由隔离fixture模拟，PR无外链访问，正式mutation为0；结果见`.dev-runtime/session-conversation-owner-audit-20261027/acceptance/final-summary.json`。
- hidden Settings快捷键：两尺寸×浅深4项浏览器、87项相关单测通过。
- 助手动作：5项浏览器，包含真实未修改cx/split和两尺寸×两主题；35项相关单测和web tsc通过，见`.dev-runtime/session-latest-message-actions-20261027/`。
- owner表单真实HMR：自有临时Vite/LAN HTTP副本3/3浏览器、strict test类型检查通过；验证模块替换交接字段/修订/回执、旧引用释放/新引用保留、scope撤销、容量拒绝及真实reload不恢复。pageerror与API请求均为0，两份产品输入前后SHA一致，临时目录均清理。此Vite副本测试说明模块生命周期，不代表8484正式页面HMR。
- 正式前端仍为HTTPS LAN `https://10.30.0.24:8484`，端口8484；正式Session runtime PID2712539及前端PID1415274保持。`codex:status`只读结果为broker-ready，不据此声称已验证模型对话。没有向正式会话发任务或执行Git/PR/归档/删除操作。

## 完整目标仍开放

附件SVG浅色角点像素差在独立浏览器及同进程重复对照中仍无可证实CSS原因；证据 `.dev-runtime/session-queue-repeat-20261027/README.md`。未放宽阈值。

## 后续补充：PR 表单窄屏排版（2026-10-27）

PR 创建表单原先把无标签的输入框和短文本区直接排在 sheet 正文中；390px 与 1440px 真实浏览器均测得标题框只有24px高。现使用垂直表单、可见标题/描述标签、44px标题框、128px描述区，以及移动端整行 GitHub 按钮。`session-conversation-owner-forms.spec.ts` 新增几何断言，覆盖390px真实tap视口和1440px桌面、浅/深两主题：标签与输入不重叠、触控尺寸达标、表单与sheet正文无横向溢出。修复前两项失败，修复后14项owner浏览器回归通过；原owner scope、草稿和链接保护断言仍通过，未访问 GitHub。`pnpm check` 随后通过，日志见`.dev-runtime/session-pr-form-layout-20261027/pnpm-check.log`。

其它未关闭项仍按[批准方案](plan.md)继续核对：原生模型正式gate/ACK、完整Message/Tool/Request/Diff/MCP/Plan状态、所有视口/横屏/安全区/主题矩阵、10,000事件与阅读锚点、多项目切换及此前的30分钟renderer RSS红灯。本批不代表P0–P4完成。
