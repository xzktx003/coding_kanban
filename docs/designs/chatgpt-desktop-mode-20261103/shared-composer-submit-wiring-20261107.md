# 原版 composer 的显式共享提交接线

本批提供源代码接线，真实账号、模型回复与8484上线验收由集成阶段执行。单元测试和静态资源HTTP返回不代表核心对话已经通过。

原版 `composer-content-b926d24ef280.js` 的 `bf=x(yf)` 是本次入口。自有wrapper在相同可信事件栈中立即调用原bf，让原组件按自己的方式捕获文字和模型设置；续聊授权等待放到原handleSubmitLocal已经收到完整context之后。点击后、ACK等待期间继续编辑的新文字或模型选择不能替换本次context。对ProseMirror先于React冒泡处理的Enter，仅使用被动capture括住同次可信事件；没有合成提交或拦截按键。

唯一已commit的原Registrar提供host/conversation/client标识和editor。普通编辑scope只用于身份核对；native和服务端仍分别校验实例、账号、项目、真实followed binding及同一writer最终写入。

新建沿原ie→Tt→startConversation路径。请求前的真实项目ID与cwd来自原projectAssignment和resolved cwd，原客户端别名来自原Xt；host选择来自用户显式选择的共享执行位置。native创建后，真实UUID通过品牌上下文adopt并follow，首轮继续同一原SDK调用，不自动resume。新建的两个内部marker在生成restoreMessage前被剔除，用户文字和设置保持原样。

续聊沿原lEs→getTurnCoordinator().sendMessage路径；context中的一次send marker由自有native coordinator包装器消费并移除，原message/options/callback继续原路径。单独包装manager.startTurn不能替代这条路径。无点击、非可信事件、错误目标、失效scope和重复marker均不得建立发送授权。

共享选择保留原AppHost项目ID和目录；服务端按已注册目录映射自己的canonical source项目ID，不能要求UI伪造服务端ID。已有真实线程保留原manager host。选择失效保留共享host意图，render使用无抛错resolver；真正提交仍用strict resolver阻止发送，并可在原菜单重新选择，不回落到另一台执行主机。原cs的unknown配置展示可能回本机默认，不能据此声称它已取得共享执行配置；实际writer目标仍由明确host ID、已注册manager和服务端guard核对。

新增适配成员原大小541834 bytes，原SHA256 `cf56f37714e14488239f4eb715b845067e75f8c2e98851c768c4110d3eb6fd08`。该成员采用精确原字节数与SHA、唯一源码片段和固定输出SHA；输出上界550026 bytes。通用512KiB成员上界与总4MiB响应预算不变，额外成员只允许完整固定recipe。原Mac ASAR不写入。location-menu的独立共享选择适配与最终固定recipe由同批集成。

静态证据来自固定Mac ASAR `bb88615052255e79b5977885f9a0cc212c268589587c79d4d3b7c4b46e881a95`。REA composer摘录parent `ev_e8932097cad43e87db779a227d9785ff1b980ad3734218bd1b33f1fb722a19fa`；content摘录parent `ev_312d77e2e460b7e806877426a62e4729c8ab2dbfeb7f4efe0f1fb1d45f036b71`。这是惰性静态分析，content语义图有覆盖上限，不代表观察了原版运行。原ASAR未打包native companion已有完整性矛盾，不能把该树整体称为完整性通过；本适配另外严格核对packed JS成员。

最小回归包括：旧wrapper延迟bf的点击快照红灯与修正后的绿灯；可信点击/Enter、拒绝程序调用、目标变化；真实router与固定IPC模块的create→adopt/follow→first turn→continue合成；固定原资源的SHA/语法/HTTP recipe；native固定Linux chunk的完整pin chain。原SDK请求对象的undefined可选字段按JSON缺省语义投影为不存在，已定义的权限、配置及未知字段仍拒绝。没有调用真实模型或默认daemon。

实际验收应从原UI新聊天开始：通过原Add project选择允许的真实目录，再显式选“Codex CLI（共享）”，确认原committed host为kanban-shared-cli；发送唯一提示，观察真实thread/start和turn/start、同一新UUID的模型回复，再发送第二轮证明上下文延续。不能先用CLI造线程替代新建证据。刷新及切换模式不能自动start/resume/send。文件工具namespace验证和云功能不因本批接线而计为通过。

项目 pending local/main/null-conversation 也必须保持真实共享目标。原 `Ui=Dt!=null||an?yt.hostId:Ri` 与 `Wi=worktree?Ui:Ri` 可在 Ri 已选共享时把最终 host 改回 local；仅修 Ri 不够。共享配方在最终 Wi 再解析同一个选择，并在 bf 读取发送模型时严格复核。原同一个 Registrar 的 pending scope 保留 client/conversation/isMain，仅使 host 跟随 W；共享配方的编译缓存增加独立 W 依赖（265槽），普通配方仍264槽。选择失效通过原错误处理明确拒绝，不进入旧 local callback。

`shared-pending-composer-host.test.mjs` 使用实际固定 ASAR 的 Wi、Registrar 与 aR 表达式验证 pending/worktree/原 yt.local 的反例和修复；`browser-shared-thread-submission.test.mjs` 补充失效选择错误报告。两项不是原界面真实模型共享验收；新冻结版本仍须验证源通道真实 thread/start、turn/start、模型回复及继续对话。

### 真实 GUI 复验仍未通过

8549 已实核加载 content `1a4c4d88…` / wrapper `7c91bf9c…`，原版点击发送得到真实 Sol 回复，但新线程 `01a1b639-634d-70b1-8e79-65366e397bd2` 仍只在隔离 history 中，默认 CLI 同 UUID 无记录，共享侧无 start/turn。此前 `01a1b623-cb57-75b1-91b8-480359f4e05f` 相同；两条均完成且未重发。故原表达式红绿不能作为共享成功，当前转向 CDP 实际菜单与 composer scope 对象绑定核对。随后 jw 测试 profile 被撤销，现场保留，原因尚未确认；不手改恢复，换新自有宿主后继续。8484 免密码宿主仍 ready，未替换它。私有首因位于 `.cg-ui-8535-av3NXthY/*/actual-local-fallback-first-cause.json` 与 `observation-probe-incident.json`。

后续核对发现，最终 Wi 之外，原 Ui 还供给 YU 的配置／requirements host、localConfigTarget 和 ld→mK→HG executionOptions。共享配方现在在 Ui 计算后同样应用同 node 的明确选择，保持上述原路径一致；已有 conversation 与未选择的 composer 保留原值。测试直接运行固定成员的 Ui/Wi、YU、ld、mK options 表达式，核对权限与 roots 原对象没有变化。此次修复只证明确定的宿主配置不一致；v6 点击后 0 写入的实际首因仍未确认，真实共享收发仍未通过。
