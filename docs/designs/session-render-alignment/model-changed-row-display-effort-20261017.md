# 切换模型时继承原版显示强度（2026-10-17）

R29 修复普通 NativeModelSelector 选择另一 canonical 模型时的强度继承。当前 raw 为 null，或 raw 值已不在当前模型广告中时，原版先派生显示值 medium，再据此选择目标模型的广告；本地此前直接检查 raw，可能保存目标默认 high 或保留 max。

## 原因与修复范围

原 hCa 的 bt=Z6r(raw,gt) 经 reasoningEffort:bt 传入 lCa；普通目标行先在目标广告中找 bt，没有才取目标 default。当前菜单的 TX fallback 是另一条投影：ROW01 当前菜单可以显示高，但切换行仍应继承 bt=medium。独立审查核对 G14／G18／G19／G20 的完整载体、codepoint／UTF8 跨度与哈希，并核对本地 choose／helper；本轮没有执行完整官方 GUI。

现有 nextEffortForNativeRecord 在目标支持输入强度时返回 undefined，表示保留旧值。因此只把入参替换为 bt 仍不够；本次仅在 Selector choose 中传入派生显示强度，并在 helper 返回 undefined、目标存在且 raw 不同的情况下明确写入 bt。目标不支持 bt 时仍用目标 default，缺失目标保持旧 helper 行为。

同一当前模型行仍先跳过 model／effort／tier 写入，保留完整 raw null／max、revision 和 pending；view／focus／本地 recent bookkeeping 仍按既有流程。generic／Side／custom、shared helper、raw catalog、目标 tier 处理、owner／可见性／焦点／滚轮生命周期均不改。仍使用现有两个单项 setter，不宣称一次本地 revision 或 native 原子 RPC。

## 独立反例与实际红绿灯

| 反例 | 当前模型与 raw | 目标模型广告／默认 | 旧实现实际值 | 修复后实际值 |
| --- | --- | --- | --- | --- |
| ROW01 | raw null，广告low/high、当前默认high；菜单TX为high | low/medium/high；默认high | high | 显式medium |
| ROW02 | raw max，当前广告low/medium/high不含max | max/medium；默认max | max | 显式medium |

期望在产品候选前独立封存，正式测试与审过的候选逐字一致。web／E2E noEmit 先通过，浏览器 discovery 明确12项；旧产品实际组件 **4新失败＋6原R27控制通过**，浏览器 **8新失败＋4原R27控制通过**。全部新失败均发生在完成目录／owner／草稿／原始缓存／焦点及IO硬保护后的目标强度软断言，主位置分别为 after.reasoningEffort:282:40 与 settings.reasoningEffort:363:68；不是 availability、loader 或夹具失败。多条软断言不是额外测试数。

只推广一个 Selector 的精确产品候选后，同字节组件 **2文件10项**、浏览器 **2文件12项** 全通过，无重试或放宽断言。浏览器覆盖两种反例×主／真实展开编辑区×1440×900／390×844；原4项重选控制仍在同一批。另单批 **25文件386项** 相关回归通过，包含新4项和原6项，不与10项重复相加。它覆盖已有 canonical／generic／helper、强度命令、筛选／unknown／view、键盘／指针锁／滚轮与Side／权限弹窗等直接相关控制。

web与E2E前后类型检查、生产构建和只读status均退出0。生产构建保留既有动态／静态 import 与chunk体积提示，不称零warning。12条实际命令均核对3026项输入及HEAD前后相同；相对3024项preformal，只改变Selector并新增一个unit和一个browser文件，旧R27两文件不改。四源码根／15选定E2E与fixture／63基础设施／72shared产物均冻结；重建shared后字节仍一致。

## 界面与边界

浏览器为局域网 HTTP `http://10.30.0.24:48865/`，绑定 `0.0.0.0`。真实页面、菜单、Sheet、EventSource与可信点击按原夹具执行；四个目录读取各一次，未预期的写入／外部请求／页面错误均为空，source hash前后相同。8个新场景退出后均完成自有SSE关闭检查，红绿输出分别保存在不同目录。root实际查看了覆盖两反例、两表面、两主题与两宽度的4张最终截图，medium标题与相应slider位置可见；没有修改CSS或宣称完整原版像素相同。390宽为浏览器模拟，不是物理手机验收。

这是合成目录与已有线程本地设置的行为验收，不是认证真实账号catalog、原生接收目标强度、Lti／Pti／guardian／requiredOnModels、FI／Default／跨模型preset、跨端CAS或长期RSS的完成证明。正式PID2712539继续运行，磁盘运行层产物未激活，没有重启或停止Agent。

证据在忽略目录 `.dev-runtime/session-polish-round2-20261016/model-changed-row-display-effort-r29-root/`；独立最终复核和放行收据在root之外。后续共同偏好投影与模型动作仍继续，整个Goal未完成。

后续 [R28e3共同偏好消费者](model-picker-consumers-20261017.md) 保留本项bt继承和同当前行no-op。为不混淆默认偏好隐藏max与原ROW02反例，组件／浏览器仅在初始fixture显式启用max；原target [max,medium]、保存medium及raw／tier／owner／focus保护不变。两组件文件10项与本项8浏览器均在新投影下再次通过。
