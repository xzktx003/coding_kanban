# 模型选择消费者回归：按实际操作入口验证通知

2026-10-27。本项仅迁移 `tests/e2e/session-models.spec.ts` 的过时断言，没有修改产品源码、通知策略或发送协议。入口依据是[原组件行为验收](model-change-notice-behavior-20261027.md)：普通模型 radio 只改选择，不发警告；明确最近模型操作在已有历史时触发短生命周期 toast。旧测试把 radio 变化误当成持久 `.session-model-change-notice` 卡片，因此两个尺寸均在查找旧卡片时失败，原日志保留于 `.dev-runtime/session-parity-batch-20261027-r4/models-browser.log`。

替代回归保留原完整消费者流程，并加强入口与设备验证：

- A 的初始 Astra/high 经普通 radio 选择 Sol/high、Luna/high，验证强度没有被模型默认值覆盖，toast 调用为零、旧持久栏不存在。
- 只读取 A 的有界设置元数据，核对模型、强度、pending/pendingFields、精确 notice from/to 和已保存 ready 状态；不再用旧卡片证明待生效设置。
- 为 A 提供已完成的历史 fixture，通过真实“打开最近使用的模型”入口选择先前记录的 Sol/high。包装通知入口仅计数并原样转发，验证精确 A 通知 ID 仅调用一次、toast 文案指向此前 Luna。关闭后普通 radio 恢复 Luna/high，调用次数仍为一。
- 验证 toast 完整进入视口且动画结束后的上下左右边界、页面无横向溢出。原生关闭控件的定义是 24 CSS px，因此精确检查 computed width/height 为 24px；它不是旧持久卡片的 44px 按钮。375px 使用真实 `hasTouch/isMobile` 上下文，通过最近项和关闭按钮实际 tap，另保留主模型按钮至少 44×44px 的触控尺寸断言。
- B 仍使用 Sol/low，并检查实际隔离 HTTP submit 的 threadId、正文和 model/effort；切回 A 保留原草稿和 Luna/high。两次刷新保持选择与草稿，均不重现 toast。最后 A 的真实 fixture HTTP submit 仍携带原草稿、ux-0、Luna/high，B 的模型与强度不变。

本测试的 HTTP 请求由隔离 route fixture 处理，不向原生 CLI 发送模型任务。状态元数据不包含消息全文；历史 fixture 仅用于明确“已有会话”的通知前置条件。

最终两尺寸 **2/2 通过（37.4 秒）**，日志为 `settled-browser.log`。375px toast 稳定边界为 x=8、top=8、right=367、bottom=89；1440px 为 x=395.515625、top=8、right=1044.46875、bottom=50。两边关闭按钮稳定尺寸均为24×24、y=17，通知调用各1次，页面错误各0，九个产品输入前后SHA一致。本次与另一组20标签普通回归有并行，不作为性能证据；结束时已通知该组，未进入其50标签最终性能阶段。

验收入口为局域网 **HTTPS `https://10.30.0.24:8484`，端口 8484**。最终结果及每尺寸 `model-entry-<width>.json` 位于 `.dev-runtime/session-models-entry-20261027/`；JSON 记录通知精确计数、稳定几何、A/B 实际提交参数、九个相关产品源码的前后 SHA 和页面错误。中间一次严格 DOMRect 等于24的断言遇到浮点表示误差，随后改为控件定义本身的精确 CSS 尺寸检查，没有增加像素容差。另一次落盘几何取于入场动画中，最终增加完整视口与动画完成等待后再测量，不能使用中间动态几何作为稳定布局证据。

```sh
PLAYWRIGHT_SKIP_WEBSERVER=1 PLAYWRIGHT_BASE_URL=https://10.30.0.24:8484 \
  pnpm exec playwright test tests/e2e/session-models.spec.ts --workers=1
```
