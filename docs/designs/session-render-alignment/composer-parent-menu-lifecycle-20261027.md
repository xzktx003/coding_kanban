# 附加菜单与会话动作的父层生命周期（2026-10-27）

## 问题与最小修复

完整工作台的“附加文件”Popover 内嵌 `ConversationMenu variant="item"`。从其菜单选择“用户消息导航”后，子 DropdownMenu 关闭，但父附加层仍 expanded；在 390px 手机视口，父层的 `.session-agent-mentions` 直接挡住消息导航按钮。原真实失败保存在 `.dev-runtime/session-thread-workflows-entry-20261027/browser.log`，dark/light 两例都是正常 click 被父层截获，不是目标定位失败。

不能只向菜单项传 `close()`：`ConversationMenu` 原先挂在 `PopoverContent` 子树，关闭父层会卸载它拥有的归档、删除、文件搜索、Git 等 dialogs/sheets。也不能 forceMount 一个关闭的 Popover 来保存表单，这会延长焦点/事件层的生命周期。

现在 `ComposerMenu` 提供一个触发器槽位及稳定的菜单组件位置。`ConversationMenu` 本体挂在 `PopoverContent` 外，仅把自己的 Trigger portal 到父菜单原位置；父层关闭时触发器卸载，组件拥有的表单仍在。只有实际启用的菜单项执行原 `onSelect` 且没有 `event.defaultPrevented` 时，才通知父层关闭；原异步任务、失败处理及执行参数不改。Escape、禁用项不触发动作完成回调。

父 Popover 对带自身标识的子菜单 portal 保留内部交互，避免将子菜单指针/焦点误判为外部点击。动作关闭时抑制父层自动抢焦点，让新导航/弹窗接管。触发器容器卸载后控制子 DropdownMenu 关闭；菜单全局快捷键只在原入口存在时注册，没有因为稳定挂载而扩大后台快捷键范围。

本轮没有新增 owner key、表单 reset、隐式清稿或目标重绑定；原 `draftOwner`/`composerRef` 和动作捕获参数保留。主草稿保持。**没有据此声称所有局部表单已具备跨 owner 未保存保护。** 检查到 `ComposerSheet` 的通用 hook 处理浏览器 Back，不能把它等同于所有显式表单的 leave guard；跨 owner 表单行为属于另外的审计边界。

## 验证

独立证据目录 `.dev-runtime/session-composer-parent-menu-20261027/`：

- `red.log`：旧实现归档 sheet 打开后父按钮仍 `aria-expanded=true`，明确红灯；同时原工作流的两项手机导航遮挡红灯保留。
- 自有首轮导航 fixture 漏加入关注集合，正文消费者未挂载而找不到导航条目。该失败不是遮挡的复现，不计产品红灯；随后补齐真实关注目标和同源历史，未加 Escape、force 点击或降低指针可达断言。
- `green.log`：**6/6** 真实浏览器用例通过。390px 使用真正 `tap`，1440px 使用 `click`：打开导航后直接点击第 59 条消息；父附加层关闭、无可见 Popover；归档确认保持到显式“返回”并可再次打开；Escape 逐层关闭子菜单/父层并将焦点分别交还两级 trigger。原 owner 主草稿保持，未发 turn/archive/delete 请求。
- `navigation-390.png` / `navigation-1440.png`：完成动作后的工作台截图。
- `unit.log`：原有菜单/文件选择回归与新增生命周期测试共 198 项，初轮只有新增测试在 modal 把 trigger 标为 aria-hidden 后按 accessible name 查询失败；DOM 当时已经 `aria-expanded=false`。改为保存同一原 trigger DOM 引用，不放宽状态断言。
- `unit-parent-green.log`：新增 **3/3** 通过，覆盖确认表单挂载与焦点、会议笔记局部 buffer 在父关闭及显式取消/重开后的保留、禁用项和 Escape 不冒充动作。
- `types-final.log`：前端类型检查通过；`e2e-types-green.log`：独立浏览器用例类型检查通过。首次独立命令错误使用 ES2022 导致既有 fixture `findLast` lib 报错，改用 ES2023，未改产品或删除类型断言。

LAN 验收地址为 `https://10.30.0.24:8484`（HTTPS :8484）。所有业务请求经隔离 route fixture，未连接真实任务、执行归档或删除，未重启正式服务。该记录证明父/子层生命周期及可达性，不宣称整个 composer 与官方原组件像素全等。
