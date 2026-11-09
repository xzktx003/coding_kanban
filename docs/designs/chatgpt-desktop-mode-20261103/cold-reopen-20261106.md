# 两个真实会话后的冷开反例（2026-11-06）

8484 保持[已交付的单会话核心版](main-8484-core-20261106.md)，以下实验均未替换其网关、native 或资源快照。

| 阶段 | 实际结果 |
| --- | --- |
| 新 native 的完整逐写守卫减耗，HTTPS 8518，真实仓库项目 | A 会话三轮、B 会话两轮，共五次真实模型完成；切换分屏后公共输入目标正确，composer 清空且 Stop/Queue 结束。 |
| 同一 native 保留上述两会话，关闭自有页面后以新 context 登录 8518 | `BRIDGE_QUEUE_FULL / waiting_count`。32 个 port post 在途、232 个等待，produced 795、received 406；本次没有发送模型消息。 |
| HTTPS 8519：完整 fast/v4/图片租约组合，加浏览器交付回执窗口，显式服务端选择 v4 | 仍为同一错误。32 在途、232 等待，produced 763、received 394，native deferred 7、浏览器未确认交付 7；本次未发模型消息，也未选择图片。 |
| HTTPS 8520：上一组合加同目标元数据更新时保留原 footer 子树 | 仍为同一错误。32 在途、232 等待，produced 795、received 410，native deferred 6。React 重挂问题已有独立红绿且已合入源码，但不是已证实的冷开首因；本次未发模型消息或图片。 |
| HTTPS 8521：同一 native、两会话和传输源码，仅服务端配方切为 v2 | 同样失败，produced 787、received 416。由此不能把共同初始化错误仅归因于 v4。未发模型消息。 |
| HTTPS 8523：v2 加仅八槽全满时的进度逃生，已交付项下一轮独立确认 | 仍失败，produced 738、received 370、native deferred 7。正常请求和 ROP 记账仍积压到原计数上限；本次没有模型消息或图片。停止继续调整同类窗口调度。 |

第二个组合包含真实生效的八槽交付窗口：只有 socket 写回调与当前 view 的精确交付回执均成立才释放，SDK 数据有 FIFO 和有界进度逃生，真实 post 返回继续处理，字节和数量预算未放宽。它仍未解决真实冷开，不能将其离线红绿或八槽生效称为修复。附件租约修复也仍只有离线证据，尚未验证原版预览和模型读取图片。

停止调整同类窗口和节流参数。后续先核对固定原版 SDK 的请求生产来源，以及 v4 footer/portal 是否重复挂载 consumer；没有新增证据不重复开启相同失败页面。失败自有 context 已关闭，native、历史和已完成轮次保留，未知发送不重试。

随后在 HTTPS 8522 对同一 v2 只加入有界、固定词表的 ROP 计数。失败前主端口 725 条，包含 push 261、pull 231、release 188、resolve 45；其中末方法标签为 subscribe 的 push 有 126 条。第二端口只有 5 条，未出现 reject。计数未读取目标、参数或动态路径，不能据 subscribe 标签数推定独立或活跃观察器数量。原包静态核对表明这些 opcode 可属于正常管线与引用记账，没有原 ROP 控制消息批处理入口；暂未确证重复订阅或循环。两个端口本身也不证明重复主连接。

已有交付窗口的具体调度前提已在私有候选修正：拥塞时六七条延迟数据尚未占满八槽，等待真实 post 返回；只有全八槽数据挡住有序 reader 时才使用既有逃生。该实测仍失败，不继续调整同类节流数值。后续需重新评估合法 ROP 初始化突发、客户端计数上限和完整逐写成本之间的可行性，不能暗改服务端、原生并发或字节与授权边界。原 `.native` realpath 私有优化只在本地 guard 组合减少约 16.5% 耗时，未据此再启动 native 或宣布冷开修复。

私有原始证据：

- `/data01/home/xing.hu/.cg-native-cold-4fsyxmus/five-turns-and-cold-result.json`：五轮精确发送台账及首个冷开反例。
- `/data01/home/xing.hu/.cg-image-lease-3xctgcbs/cold-first-result.json`、`candidate-last-browser-state.json`：完整组合的首因计数。
- `/data01/home/xing.hu/.cg-footer-xd5iorhx/cold-first-result.json`：同目标 footer 生命周期修复后的真实反例。修复与权限边界见[独立记录](split-footer-lifecycle-20261106.md)。
- `/data01/home/xing.hu/.cg-v2-cold-n8_ti0gm/cold-first-result.json`、`/data01/home/xing.hu/.cg-rop-trace-0ytwzuj9/rop-first-result.json`：v2 配方对照及固定 ROP 计数。
- `/data01/home/xing.hu/.cg-full-window-3i9rj8c6/cold-first-result.json`：仅满八槽逃生修正后的首个真实结果；源码 `bf5dcea85d0e3cb1227a6a9a875782f805c8ac9da84f06f6cd4f1dc13ae16dc0`。
- 同目录 `frozen-manifest.json` 的 SHA-256 为 `49ed4cf82044641cd9fcfd4b53a23b2079a63a5b8ee4249d37f576a555cda565`，记录 4555 文件冻结清单及固定 v4 选择。凭证保留在私有部署目录，不写入本记录。
