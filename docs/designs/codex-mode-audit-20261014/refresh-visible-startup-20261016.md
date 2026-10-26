# 显式按可见窗格启动原生编辑器

本项接续 [关闭旧编辑器自动还原](refresh-editor-restore-20261016.md)。候选默认未启用，正式任务继续原路径。

仅关闭 VS Code 的编辑器序列化恢复还不够：`--auto-open-new-chats` 会按其明确含义先打开默认新聊天，网页恢复历史后留下隐藏窗口。之前隔离夹具手工关闭这个首开，因此其三端通过不能代替实际启动配置的验收。

新增 launcher 参数 `--restore-visible-windows`。它必须同时提供 `--refresh-service-config`、`--refresh-domain` 和 `--refresh-control-root`，依赖已经运行且身份核对通过的私有 native/control 服务。它与自动新聊天、自动 fixture、创建 fixture 和 threads-file 互斥，不读取登录、不创建或重启 native/control，也不修改旧宿主。新宿主仍要求新的私有目录和输出文件。

launcher 生成一个默认新聊天 UUID，记录 `panelMode=visible-windows`，伴随扩展配置 `restoreVisibleWindows=true`、`autoOpenNewChats=false`。宿主设置仍经 `buildHostSettings` 关闭旧列表自动还原。伴随扩展完成激活，但不自行创建默认编辑器。只有网页识别当前原生实例、恢复自己的布局并选定可见目标后，才调用既有精确 UUID 的 `new-beside` 或 `resume-beside`；初始默认新聊天也走该路径。后台关注集合不因此打开窗口。

网关从服务端固定的私有宿主记录读取启动模式和 UUID，并验证 native/control 代次、PID/start ticks 等元数据格式后返回公开布尔能力。缺少任一受控记录、窗口身份或 broker 信息会拒绝该模式，不回退为普通宿主。元数据格式检查本身不是存活或写入授权；后续操作继续核对精确实例与原有私有通道，CLI 实际写入继续受初始授权锚及控制代次保护。浏览器不能传路径、端口或控制身份来改变模式。

原 `--auto-open-new-chats` 的主动首开语义保持。旧 `/restore` 按启动列表的固定列替换空白编辑器，仅供原自动首开模式；新模式使用按 UUID 恢复现代窗口状态，不放宽这个旧接口的固定列、空白或 clean 校验。新聊天获得原生 threadId 后，持久窗口恢复按既有规则转换为该精确历史目标；首次发送后的真实 UI 回归须独立证明。

## 红绿灯与运行证据

证据目录 `.dev-runtime/codex-refresh-20261016-visible-startup/`。

- `host-companion-red.log`：未提供启动构建器、未识别模式、未拒绝错误配置，3 项失败。
- `server-red.log`：私有受控记录没有输出新能力，1 项失败。
- `web-corrected-red.log`：初始可见新聊天未请求打开，1 红／2 绿。最初测试还错误假设 resume 请求传 cwd 并使用重复文字定位；这些测试接线错误保留在 `web-red.log`，不计为产品缺陷。
- `host-companion-final.log` 75/75；`server-green.log` 44/44；`web-green.log` 四文件 32/32，覆盖首次目标、历史不多开、旧模式、实例/打开栅栏及页面可见性。
- 最初新用例还假设按需分组能使用旧固定列替换，实际为 400。现明确保持旧通道关闭，不扩展旧协议来绕开列身份；该迭代记录保留在 `host-companion-green.log`，不冒充旧产品根因。

初始新聊天真实三端 `initial-new-corrected/result.json` 已 **9/9、passed=true、页面错误零**，三端当前实例各只有正确默认新聊天；原生默认 UUID 在同一宿主的各客户端相同，草稿按来源与原生实例分别保存。首次脚本错误沿用了“用户新开三窗口 UUID 必须不同”的假设，在三个输入通过后失败，原 `initial-new/result.json` 保留；仅初始默认场景改用同一固定 UUID 的预期，原新开分支仍要求三 UUID 不同，三端草稿和精确实例断言保持。

后续已有历史分支 `history-new/result.json` 捕获了实际红灯：共享关注列表已经初始化为空，宿主启动较慢，本地当前历史目标先被合并逻辑删掉，因而没有发出 resume 请求，原生 tabGroups 为空。此前单测立即发布宿主身份，先发请求而掩盖竞态；补成共享快照先返回、宿主身份后发布后，`unfollowed-delayed-red.log` 稳定复现。现在共享合并保留本地各组的选中目标，不自动重新关注，也不由此打开后台编辑器；实际打开及消费者保护仍走既有可见路径。`unfollowed-visible-green.log` 四文件 **33/33**。第一版无延迟单测通过不计为复现，原记录保留。

修复后的 `history-new-fixed/result.json` 三端 **9/9、passed=true、errors=[]**，原生当前实例各恰有一个正确新聊天；与初始新聊天分支分别计数，共 18 项草稿步骤，不计为发送、审批或性能矩阵。

另新增仅接受无登录 loopback 夹具的 `codex-refresh-newchat-send-acceptance.mjs`，真实点击官方 Send 一次，以原生 thread/read 确认精确 cwd、唯一 completed turn 和受控文本，普通刷新后再核对同一 thread/turn、无重复发送。首轮在 undefined 对象字段比较失败，发送零次；修正后真实原生文本带末尾换行，严格字符串断言失败，但独立只读已确认该测试 thread 完成一次，见 `first-send-known-receipt.json`。允许受控标记的一次末尾换行，不接受其他正文；没有对未知提交重发。独立新用例各创建自己的新 thread。

此后 `first-send-final/result.json` 又捕获真实恢复错误：本次新 thread 为 `01a14391-9305-7ea0-b2c1-8a941f5c4ad6`，刷新后原生 tabGroups 却打开上一测试 thread `01a14390-6f16-77e3-bbd2-00fa0d49ffd8`。窗口列表转换了新聊天 UUID，分屏树未转换，存在其他历史时选错目标；只有一个窗口的旧单测掩盖了问题。重复 thread 元数据先出现时，还会在跳过重复窗口时漏掉别名。

`sent-selection-corrected-red.log` 以两个有效用例稳定复现选错旧项及分组丢失；最初第二例缺常量导入的接线错误另保留在 `sent-selection-red.log`。现在有效窗口先记录 new→thread 别名，再对分屏树 keys/selected 递归转换并去重，保留组身份、方向、比例和 activeGroupId。`sent-selection-green.log` 三文件 **17/17**，真实发送刷新结果接后续记录。

最终 `first-send-selection-fixed/result.json` **passed=true、三步骤通过、页面错误零**：只点击一次官方 Send，thread `01a14395-437f-78a2-a53d-d260ebe7726d` 的 turn `01a14395-495b-7732-b04f-c8ef90f6d077` 已完成；普通刷新后原生 composer、历史和本地所选项均为相同精确 thread，原生仍只有同一轮。该轮使用官方真实 UI、本地 DOM、实际桥接和独立控制，不伪造提交或截断历史；截图为 `first-send-selection-fixed/first-send-recovered.png`。它是桌面功能验收，未量到两秒或覆盖三端并发审批。

`native-final.json` 只读核对整个私有项目：四个测试 thread（初始 seed、已完成的文本断言失败、恢复目标失败、最终成功各一个），每个恰一轮 completed，UUID/turn ID 与各自证据对应，原 native/授权锚代次保持。模型 fixture 实际记录 **7 次** Responses 调用，全为 idle 分支；这是模型调用数，不等于用户 turn 数，不根据当前只含 mode/afterTool 的记录推断额外调用的用途。没有把独立新用例算作未知提交重试。

测试结束先按持有的 PID/start ticks 关闭本轮宿主、网关、Vite、控制/native/观察进程，`cleanup-final.json` 确认已知所有者活进程零、清理错误零，随后删除私有根和 TLS。临时 **HTTPS https://10.30.0.24:5173**（端口 5173、前端 0.0.0.0）已关闭，不是长期入口。未主动切换正式 Session/native 运行实例，最后整组检查和正式安全核对接持续进度。

新建全新私有 HOME 和项目，固定未修改 VSIX/匹配 CLI，以已有 loopback Responses fixture 提供模型；未复制账号、登录数据或正式历史。native 原始授权锚、独立 control、实际 CLI 包装器和同源可见页面通道均使用真实实现。宿主实际使用新参数，未手改 companion 配置或 settings。诊断内存预算为 8 GiB，不视为生产预算定标或资源关卡完成。

草稿阶段的原生夹具模型名为 acceptance-model，不是 UI 目录中的模型，截图可能显示 Loading model，草稿通过不计可发送。发送测试前通过该私有 native 的真实 config/value/write 选择其 model/list 给出的默认模型 gpt-6.1-sol，并以 config/read 确认；provider 仍是无认证的本地 loopback，没有调用外部模型、修改官方 feature flag 或更换 native/授权代次。选择记录为 `fixture-model-selection.json`。

浏览器的初始新聊天用 `NATIVE_CODEX_REFRESH_INITIAL_NEW=1`，原新聊天脚本继续保留已有历史后新开的分支。`NATIVE_CODEX_REFRESH_VISIBLE_ONLY_EVIDENCE=1` 要求每页当前原生实例的真实 tabGroups 恰有一个正确目标。结果、清理和最终检查接后续记录；不能把等待输入框出现或模型 fixture 的成功当作两秒接受回执。

手机按用户确认采用 iPhone 16 尺寸模拟，393×852、DPR 3、移动触控；当前 Chromium 引擎和 Safari UA 分开记录。组合事件、视口与 DOM 操作不等同于 iOS 系统键盘或硬件剪贴板。真实 ChatGPT/OAuth、自动 profile/持久来源、全部宿主资源准入、完整多端交互、长历史、180 次两秒矩阵和 30 分钟长测仍在计划范围内。


最终 native/adapter **282/282、无跳过**，Codex 前端 **22 文件/142 项**，网关 **44/44**；pnpm check **退出 0**。最终正式 Session/native 三组 PID/start ticks 保持、LAN 及健康 HTTP 200；运行产物与磁盘不同，没有激活新运行层。全仓测试不由定向结果代替；最终性能和长测未通过。详见 [持续进度](refresh-recovery-progress-20261015.md#显式可见启动未关注恢复与首次发送目标修复2026-10-16)。

复核还补充损坏持久状态的反例：两个原始 new UUID 相同却声称不同 thread 时，旧 seen 只记转换后的 ID，别名可被覆盖。duplicate-new-id-red.log 为 1 红／7 绿。现单独校验原始 ID 集合，重复直接走原安全回退；合法重复 thread 的别名仍保留。这是校验缺陷，不推断已经发生重复发送。最终前端和构建复验另接持续进度。

最新 web-postreview.log 为 **22 文件/143 项通过**，check-postreview.log 为 **pnpm check 退出 0**；它们包含后补的重复原始身份防护，替代此前 142 项作为当前前端检查结果。282 项原生/适配器与 44 项网关仍按各自原日志计数，不与定向用例相加。
