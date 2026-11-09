# 共享 composer 的原事件调度

实际第四模式中，共享节点选择及 W/Wi/Ri/committed target 已核实一致；按钮和下一次独立 Enter 仍分别明确拒绝，均为 0 native write、0 新线程。保留失败草稿和首因，不重发。

原适配只包 React 根 bubble；嵌套事件容器可以先处理并停止传播。旧 Enter 被动捕获又在微任务清理帧，而原生事件分发可在监听器之间执行微任务。因此改为同 document 的 passive capture，同时覆盖 click 与编辑器 Enter，不调用 `root.addEventListener`，避免触碰 createRoot 临时登记拦截。

准入仍要求原探针已登记的精确 `#root`、同文档连接状态、真实事件、包含该 root 的有界 composedPath、活跃 committed composer 与 editor。Enter 必须来自该 editor；原 pinned submit 回调才可消费，一次消费后不可重复，普通代码调用不能生成授权。事件的 `eventPhase` 必须保持 1/2/3，分发结束为 0 时立即拒绝；零延时任务只回收引用，不能延长可提交时间。dispose 移除两个监听器并回收计时器。

不提前等待授权、不重建输入、不调用合成 submit。原 callback 同步开始以捕获点击时草稿和设置；后续 context 消费及 native intent / binding / 写前 guard 保持。首个拒绝只输出固定枚举 `CHATGPT_SHARED_COMPOSER_DENIED <phase>`，不含正文、路径或账号。

定向回归先红后绿，包含无外层 bubble、监听器之间微任务、分发结束后拒绝，以及未登记 root／不可信事件／错误路径拒绝。使用 Node 事件 stand-in，不计作真实浏览器或模型通过；真实原 GUI click 与完整收发仍由主线程验收。私有失败／通过日志及 patch 位于 `.cg-submit-event-zr59hfco`，本轮没有浏览器操作、模型调用或默认 daemon 连接。
