# 原生队列拖动与退出生命周期

沿用已批准方案及未修改的官方 `26.51007.21434`，本轮修复单条/混合状态仍能拖动、缺少悬停手柄、HTML5 拖放与原生指针手势不同的问题。项目的菜单上移/下移入口保留；不改任务派发或原生执行权限。

## 原包与真实操作

`queued-message-list-172645190dd2.js` SHA-256 为 `b624ccec075695445cd1d86d6fc534388591948187f1800428fecb9aa3a10fbb`。复用保留的 REA 单文件证据 `ev_5e7b044873c133ac128b682e6c7eff3b9b958a23dfaa9824996ad658c3f8fb66`；该证据不包含所有导入实现，也不代表运行观察。导入映射另按实际 `app-initial-c4ebaa710049.js` 核对：`Dk=Psr` 是 PointerSensor，`Lk=Xar` 是 useSensors，`Ok=bsr` 是 closestCenter；`Sl`/`Tl` 分别约束首个滚动祖先和垂直轴。

实际 `Be` 只有 `!isReorderDisabled && messages.length > 1 && messages.every(He)` 才提供手柄；`He` 允许没有 submission 或状态明确 queued。`qe` 只注册 PointerSensor，distance=6，未注册 KeyboardSensor。**此前“还需补原生键盘排序”是未验证假设，现不能再当作官方功能缺口。** 原库默认支持哪些传感器与此组件显式启用哪些传感器必须区分，参见 [dnd-kit legacy sensors](https://dndkit.com/legacy/api-documentation/sensors/)。

自有 LAN 只读参考 HTTP `http://10.30.0.24:45439/native-goal.html` 中，真实挂载官方 QueuedMessageList：单条与含 sending 条目均无手柄，全 queued 两条有两个手柄；Space/ArrowDown/Enter 不产生回调，5px 未激活、7px 激活，Escape 取消无排序/发送回调。手柄 24×16px、起始侧 -10px margin 与 10px padding，六点图标 14×14px、hover 后 opacity=1。原始 DOM、SVG 与操作结果保存在 `.dev-runtime/session-queue-sort-20261027/native-probe.json`，没有修改官方包或连接正式任务。

## 实现与所有权

显式固定 `@dnd-kit/core 6.3.1`、sortable 10.0.0、modifiers 9.0.0、utilities 3.2.2，使用与原包相同的指针传感器、碰撞和竖向列表策略。原 HTML5 拖放入口移除，外部 `application/x-followup` 数据不再能触发队列变更。所有条目 queued 且没有编辑/忙碌/错误时才可排序，单条或手机折叠只显示一条时没有拖动入口；菜单移动也遵守状态限制。按已批准手机例外，详情页手柄为44×44px且六点常显，仅手柄设置touch-action:none，正文与滚动区不受影响；真实Chrome触控事件验证一次原队列reorder，未声称实体手机验收。

pointerdown 捕获原 thread/revision 和精确可见 ID 顺序。drop 前重新比较这些身份及交互可见性；修改修订/条目、切换目标、退出 rail/模式、失焦、隐藏、取消和卸载只终止自有手势。无手势时不重挂列表，编辑节点、焦点和选区保留。正常排序只提交原有 reorder 元数据动作，不发送/中断任务。

实际库 6.3.1 的 DndContext 卸载不会自行释放活跃 PointerSensor 的 document 拦截器。独立审查在 blur 重挂和卸载后观察到普通点击仍被吞，两条有效红灯。自有 QueuePointerSensor 用固定版本的内部 `handleCancel` 生命周期入口释放自身实例；正常 end/cancel 清除注册，pending 手势也可释放。不修改库、不向全局派发合成取消事件；升级依赖必须重新验证这个内部入口及生命周期测试。

另一真实浏览器红灯：document pointerup 监听中的微任务可能早于库的后续监听器执行，提前清掉手势，导致库报告 drop 但队列未收到动作。现使用公开 `onDragAbort` 清理阈值前结束，正常动作只在 onDragEnd 清理；该浏览器事件顺序不能仅由 jsdom 单测证明。

## 验证记录

原实现六项失败后转绿：单条、三类混合状态、手柄可聚焦及外部拖放拒绝。独立真实库 lifecycle 19 项通过，含正常结束后不再取消旧实例、pending 卸载、同文档同 ID 双队列隔离及无手势修订更新保留选区。结合原预览/恢复/plugin 回归，五文件 50 项通过；只在 enabled 可交互时监听窗口事件的版本另复验 25 项通过。

`browser-r2.log` 保留上述真实 drop 被提前清理的红灯；修正后 `browser-r3.log` 三项通过，比较真实原组件的阈值、Escape、键盘和最终排序回调，同时验证本地 owner/revision 变化不写出。初轮紧接释放重启手势未等待原库 50ms click suppression，以及列表重挂时立即读取 boundingBox 的夹具失败单列，不计产品反例。原 HTML5 单测改为检查外部拖放不能写出，原 owner/revision/精确顺序断言转由真实指针浏览器验证，未移除该行为要求。

两主题 hover 手柄的几何、六个circle和完整PNG字节一致。20条长队列真实拖动自动滚动到底，精确原目标顺序与原组件一致；早期夹具遗漏相同主题/宿主body margin且native root继承height:100%造成滚动范围不同，修正自有host后通过，没有更改产品滚动预算。手机44px热区先红后绿，`touch-green.log`通过。最终联合结果见[第三批验收](session-parity-batch-r3-20261027.md)；不据以上几项声明整个 composer 或全矩阵完成。正式前端 HTTPS `https://10.30.0.24:8484`、独立 Session 运行层均保留。


最终桌面rail的overscroll从contain对齐原组件auto，确定CSS反例先红后绿，手机/详情保护保留。8项排序浏览器用例全部通过，包含真实触控和20条自动滚动；全量553文件3348项与构建通过。此修正消除绘制坐标额外平移，但附件两项精确像素检查仍失败，不能把滚动行为通过视为附件像素闭合。
