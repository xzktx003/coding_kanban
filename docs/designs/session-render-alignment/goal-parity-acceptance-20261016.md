# Goal 官方对照与验收记录（2026-10-16）

本轮补齐会话模式的 Goal 行为和 UI，并继续修复两项有实际官方证据的会话模式差异。源码实现和隔离验收分别交付；没有重启正式 Agent，也没有以构建成功代替运行层切换。完整行为约定见 [Goal](../../session-goals.md)。

后续同日补齐了实际浏览器→私有 HTTP 网关→当前 TS 运行层→匹配原生 CLI 的 Goal 闭环：真实点击暂停／继续、原生完成、一次完成清理、GET null 与卡片消失通过。没有 mock Goal 回应；私有无登录 fake-provider、单进程浏览器、idle owner 竞争未执行 clear 的分支与原跨客户端 CAS 红灯各自记录，见 [后续验收](session-polish-acceptance-20261016.md#浏览器到真实原生-goal-闭环)。这关闭此前 UI 和协议只有分开证据的缺口，不能代替认证宿主或正式运行产物启用。

## 对照来源

| 来源            | 本轮身份及作用                                                                                      |
| --------------- | --------------------------------------------------------------------------------------------------- |
| 仓库官方 VSIX   | `third_party/openai.chatgpt-26.51007.21434-linux-x64/extension`                                     |
| 已安装官方扩展  | `openai.chatgpt-26.1007.21434`；29 个相关函数在资源哈希归一化后与仓库包相同，未断言整个 bundle 相同 |
| 历史对照        | `26.51002.51308` 不是本轮 Goal oracle                                                               |
| 实际 native CLI | `0.162.0-alpha.17.2`，SHA256 `73b73b048546993298234a295de01ef2424e7a8b29def9d0ecb1ca7cb77500d4`     |

入口资源版本和 SHA256 固定在 [reference-assets.json](../../../tests/fixtures/codex-goal-reference/reference-assets.json)；[函数索引](../../../tests/fixtures/codex-goal-reference/function-index.json)记录原函数偏移、长度及哈希，[安装版比较](../../../tests/fixtures/codex-goal-reference/installed-vs-reference-goal-functions.json)保留逐函数结论。旧索引 offset 使用 Unicode codepoint 序号，不是 UTF-8 字节或 JavaScript UTF-16 code unit，不能直接用于 JS slice。索引中的 `.dev-runtime` extract 是本轮原始证据路径；函数本身可按原 bundle、对应单位的偏移和哈希核对。

按用户调用的 `reverse-engineer-anything` 技能执行了静态来源核对、REA 聚焦解析、原组件浏览器执行及独立审计。REA evidence `ev_d5735808f127b0443225f0e28a685405d29e1ed651acf713e6e589161fb395c4` 只覆盖字节一致的 side-panel chunk，不是完整原生运行或全部应用语义。关键业务结论另外来自下列原 bundle 和真实 native RPC。

| 规则                                  | 原函数／调用链                                                           |
| ------------------------------------- | ------------------------------------------------------------------------ |
| 卡片、六状态、计数和编辑              | `oFi`（实际导出 `Cu`）、`rFi/lFi/uFi/dFi`、`bCi/_Ci`                     |
| Goal 草稿入口、Plan 退出、footer 标签 | `uDa/eCa/awa/rwa`                                                        |
| 已有线程与新线程顺序                  | `$Pa/YPa/ZPa`、`_wa`、`N0t/P0t/F0t`、`Rbn/zbn`                           |
| 替换和可选恢复确认                    | `gPi/_Pi/CTn`；两版全 JS 扫描为 0 个 true、3 个显式 false 调用点         |
| 目标文件和附件                        | `z0t/U0t/G0t/W0t/K0t/Q0t`                                                |
| 本地只读 `/goal` 展示记录             | `Vbn/Bbn/Bjt`，原生 turn ID 为 null                                      |
| 完成通知和清理                        | `ETn` 的 goal 分支、`clearThreadGoal`；实际 wire clear 仅有 `{threadId}` |
| 完成轮次和助手耗时标记                | `Fp/lx`，只取符合时间边界的最后一轮且该轮必须 completed                  |

## 红灯与实现收敛

- Goal 旧 GET／clear ACK、同值新通知和运行实例切换先补失败用例，再加入完整目标、createdAt、修订和 epoch 隔离。`clear:false` 保留卡片。超时／非法回执进入 unknown fence，合法当前小 GET 前禁止重复提交；不靠 SSE 同值解除。
- 同 UUID 账号范围变化补失败用例：同值通知取消旧动作但保留只读 Goal；真实 namespace／类型／登录变化清旧范围并重读。有效当前账号回复才能确认自动清理授权，运行层重启另做一次事件驱动账号读取。
- 新线程首轮已接受、随后 GoalSet 拒绝的用例验证：首轮不重发，已发送草稿清除，已引用附件保留。图片准备／迁移之后和实际设置之前均核对捕获的线程和运行范围。
- 真实 DOM 验证发现 Goal Portal submit 会传播到公共 composer，已同时 `preventDefault` 和 `stopPropagation`。保存目标不发送未提交的普通草稿；busy 时取消、Escape 和编辑均被阻止。
- 原生首轮 ACK 后立即设置 Goal 的真实红灯为 rollout 暂空。运行层只对本实例精确首轮和精确暂空错误最多预检 5 秒；只读重试不会重复原生写入。
- 原生 complete 通知先于当前 turn 完成。专用 clear 等待准确 turn 的 completion，并在实际 stdin 前检查已有 owner、generation、epoch、完整 Goal、revision；断开取消信号从网关贯穿到底层，禁止迟到写入。
- 官方卡片 33px 被已有通用按钮 `min-height/padding` 意外撑高，已修正限定样式优先级。另修正官方 focus outline、图标、弹窗圆角、模糊和确认内容样式。触控保持独立 44px 门槛；最初在进入动画中测量的失败通过等待实际稳定尺寸闭合，没有降低门槛。
- 人工看图另发现 Goal 遮罩仍是通用黑色 50%。原 `oFi → UR → I3n → P3n`、当前安装版相同 CSS 和实测证明原生使用编辑区底色 80%；已给共享 Dialog 增加可选遮罩样式，仅 Goal 使用原生遮罩。新断言先红于 `[0,0,0,128]` 对 `[255,255,255,204]`，修复后编辑／替换两种弹窗四矩阵通过。对照宿主同时修正为真实切换 Session 主题；textarea 两边本来均允许纵向缩放，未改产品该行为。

## 浏览器与构建

隔离前端绑定 `0.0.0.0`，本轮实际入口为 **HTTP `http://10.30.0.24:48865/`**。浏览器通过该 LAN 地址加载，自有 fixture 拦截全部测试写入；没有向真实用户会话发送验收任务。未在另一台物理设备上验证连通性，也未把视口模拟等同物理 iOS。

官方组件夹具以原始 JS/CSS 渲染实际卡片、编辑框和确认框；`awa/lx` 是原函数体绑定原生 primitive 的提取夹具，分别没有冒充完整 composer 和助手宿主。服务只读、无账号、无 CLI IPC。最新固定哈希入口为 **HTTP `http://10.30.0.24:37575/native-goal.html`**；启动时版本或资源哈希不符直接失败。

已完成 Goal 独立浏览器组 **14/14**：四个桌面／窄屏、深浅主题矩阵逐项比较六状态文字、图标 path、卡片和编辑／替换弹窗的实际几何；其余覆盖新旧提交、替换、草稿隔离、只读恢复、late clear ACK、纯工具完成 fallback、320／390px 触控及横向溢出。完成 badge 的实际宽高、字体、间距、颜色、分隔线和 SVG 与原 `lx` DOM 完全相等。卡片、弹窗和手机截图已人工查看。

完整会话／原生模式 Vitest 一轮 **490 files / 2444 tests** 通过；随后账号重启读取、Plan 复制与附件错误的新增回归分别验证。`pnpm check` 通过，包含 shared、runtime、server 和 web 类型／生产构建；Vite 原有大 chunk 提示保留。最终冻结源码的全量日志和统一浏览器批次位于本轮 `.dev-runtime/goal-parity-20261016/`，最终结果在文件末尾追加。

运行层全套 **261** 项、Goal 定向 **56** 项、网关直接相关 **16** 项、API **6** 项通过。15 files／137 tests 的 Goal 完成、账号和状态组另行通过。新增原生验收入口的 **3** 项契约测试先红后绿。

## 真实原生隔离验收

可复现入口和环境条件见 [脚本 README](../../../scripts/fixtures/session-goal-native/README.md)。每次使用新私有 HOME／CODEX_HOME、允许列表环境、自己创建的 stdio app-server 和 loopback 假 Responses provider；Linux seccomp 监督逐次限制 native connect，不允许外网或默认 CLI IPC。没有复制 auth、登录、调用真实模型或终止正式 Agent。

提升到仓库入口后的 `all` 汇总位于 `.dev-runtime/goal-parity-20261016/promoted-native/goal-native-odftx9v5/summary.json`：

| 场景          | 结果和证明范围                                                                                                                                                |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| metadata      | 通过；已加载／未加载／外部 writer 的只读 GoalGet、预算更新、clear true/false，无模型 turn，writer lock 保持                                                   |
| active        | 通过；首 `/goal` turn 接受先于 GoalSet，已有空闲 GoalSet 自动启动，pause 后不继续，三轮 blocker 后 blocked，显式恢复和真实 advertised `update_goal(complete)` |
| runtime-clear | 通过；运行当前仓库 Ownership／StdioRpc，精确 turn 完成事件顺序 58，clear stdin 顺序 65，单次清理；同秒旧完整 Goal 与旧 generation 不清新目标                  |
| CAS 假设      | **失败，原样保留**；捕获 A 后设置不同完成目标 B，raw clear 的 `ifGoalUnchanged:A` 被 native 忽略，返回 `cleared:true` 并删除 B                                |

因此 `--scenario all` 实际退出 **1**，不是全绿；`--scenario runtime-clear` 独立通过。无 CLI 的显式 skipped／passed:false 也不算原生验收。最终独立 runtime 样本仅 3 次本地 provider 请求，auth、遗留自有 native task 和 network audit 错误均为空。

本地 full-goal／revision／owner guard 比官方裸 clear 多了一层保护，但不是跨进程原子 CAS。`usageLimited` 的恢复来自原生 API 显式播种状态，未验证真实额度耗尽；pause／blocked 的安静窗口为 1.25／0.75 秒，不替代长测。

## 内存和原有恢复

保留 [会话内存约定](../../session-memory-contract.md)的原阈值。SSE／历史仍在浏览器接收前裁剪工具正文，没有新增空闲完整历史轮询。Goal 公告有界且随原 60 秒不可见正文释放；完成/审批/未读和草稿独立保留。

首轮外围组 22/26 通过，四个 20-tabs 用例失败于旧 `.session-sync-notice` 选择器。真实 trace 和状态确认 503 已命中，`historyError` 有值，当前原生“无法加载消息／重试”可见，通用提示按既有产品规则被抑制。仅修测试：503 验原生提示及实际只读重试；另以真实 EventSource 断线验证原 8 秒、absolute、82% 透明度、<60px 和 viewport 不变门槛。四矩阵定向 **4/4** 通过，没有恢复双提示或放宽断言。

原生 HTTP → 网关 → 浏览器 EventSource 传输样本：上游 **100,669,814 bytes**，浏览器 SSE 正文 **6,178** 字符，最大事件 **317** 字符，GC 后堆增量 **35,964 bytes**；序号、审批和最终答复保留。自动恢复无强制 GC 的 24 个堆样本约 34.9–81.5MB；无关正文突发后堆增量 175,312 bytes。原 60 秒正文休眠、只读重显和草稿／审批保护另有浏览器验收。

这些是本轮短时回归，不是长期 RSS 稳定证明。原标准 30 分钟 renderer RSS 红灯继续保留，本轮未重跑／未放宽。完整认证官方宿主、真实额度／OAuth、所有桌面插件能力和物理手机也未计作通过。

## 继续润色的两项差异

独立只读审计按当前安装版再次核对原 `H → yk/zGt/NKi` 和 `MNa/NNa → UNa.C`，发现并修复：

1. 计划复制原先没有 pending 去重，失败仅 console，成功反馈 1400ms。现在同次在途不重复写，pending 使用官方 `aria-busy/aria-disabled`，成功移除 onClick 并显示原生 Copy／Copied 图标及 2000ms 反馈；错误经官方本地化通知，点击按原 `NKi` 阻止向祖先传播。复制原 Plan Markdown，不套助手 citation 清理；复用 HTTP fallback 保留焦点／选区，旧线程回执不改变新计划。定向 **14** 单测、真实浏览器 **2/2** 通过。
2. 文件选择器、超过 10MiB 和旧图片上传 fallback 失败原先只有控制台日志。现在显示官方 title-only“无法打开文件选择器”，不展示原生没有的错误详情，不重试上传、不制造附件；取消保持安静。定向 **9** 单测通过，真实选择 11MiB 与上传 HTTP 503 的浏览器 **2/2** 通过，原草稿保持。

快捷键双弹窗只是静态候选，没有证明正常导航实际同时挂载两份菜单，未据此修改代码。没有将可疑项冒充已证实 bug。

## 复验和实际运行边界

```sh
pnpm check
pnpm --filter web exec vitest run --config vitest.session.config.ts
node --test scripts/session-goal-native-acceptance.test.mjs
node scripts/codex-goal-reference-server.mjs --host 0.0.0.0 --port 0
```

从最后一条命令输出取得 HTTP LAN URL，按 [夹具说明](../../../tests/fixtures/codex-goal-reference/README.md)配置 `CODEX_GOAL_REFERENCE_URL` 和隔离前端 `PLAYWRIGHT_BASE_URL`；没有 reference URL 的跳过不计对照通过。真实 CLI 始终显式指定：

```sh
python3 scripts/session-goal-native-acceptance.py \
  --codex /absolute/path/to/codex \
  --output-dir .dev-runtime/goal-native-acceptance --scenario runtime-clear
```

本轮 `pnpm session:status` 确认服务 PID 2712539 仍健康，并明确报告运行二进制与磁盘产物不同，**新的运行层尚未激活**。这不能被类型／构建／隔离原生通过覆盖；没有因本任务关闭活跃 Agent。完整正式启用、长期内存和整个会话模式的所有能力仍是独立完成条件，不能称整个会话模式已经“完美”。

## 最终批次追加

- 遮罩与复制冒泡修复后的全量单测 **490 files / 2457 tests** 全绿，`final-dialog-units.log`；最终 web 类型检查和生产构建通过（`final-web-build.log`）。跨 shared／runtime／server／web 的完整 `pnpm check` 也已通过，运行服务未切换。
- 稳定源码统一浏览器 **44/44**（5.4 分钟）通过，日志 `frozen-final-browser.log`，包含 Goal 14、复制／选择器 4、内存／传输／后台恢复 26。无关正文突发最终堆增量为 193,244 bytes；原生网络投影仍为上游 100,669,814 bytes／浏览器 6,178 字符／最大事件 317 字符／回收后 35,964 bytes。
- 随后为遮罩和复制停止冒泡补了实际红灯，最新加强浏览器 **13/13**（1.3 分钟）通过，日志 `overlay-and-plan-final.log`，包含完整 Goal 四矩阵及编辑／替换遮罩、七项 Goal 操作与触控、两项 Plan 复制。此小范围 UI 修复没有替换前一批内存和协议结论。
- 最新浅色窄屏编辑框 360×392 的组件截图观察：141,120 像素中 138,475 个完全相等，RGB 平均绝对差各约 0.31／255。它只是本次固定宿主裁剪的观察，不是所有字体／设备／完整宿主零像素差的门槛或证明。
- 实际匹配 CLI 在全新私有 HOME、禁止网络／IPC connect 的 `features list` 中返回 `goals stable true`；没有为本任务改写用户全局配置，也不据此承诺其他版本或显式禁用配置的行为。
- `git diff --check` 通过，`.env` 保持忽略，`.env.example` 为已有可跟踪文件；没有提交或推送。已关闭本轮过期的两个自有对照监听器，仅保留上述固定哈希原组件入口和隔离前端供复验。

## 原函数索引单位补充核对

闭合复核将旧索引的 17 个 extract 各只去掉保存时附加的一个末尾 LF，均在当前固定官方资产中唯一匹配；原文件、函数内容和三种单位切片的 SHA256 一致。17 个旧 offset 均为 codepoint，其中 12 个不同于 JavaScript UTF-16 序号。这是定位单位澄清，不是原函数内容漂移，也没有修改旧索引或原始 extract。

| 函数 | 旧 codepoint 起点 | JavaScript UTF-16 [起点, 终点) | UTF-8 bytes [起点, 终点) |
| ---- | ----------------- | ------------------------------ | ------------------------ |
| oFi  | 5212698           | [5212699, 5221416)             | [5213247, 5221964)       |
| gPi  | 5197001           | [5197002, 5199178)             | [5197550, 5199726)       |
| Rbn  | 4522133           | [4522535, 4523215)             | [4559626, 4560306)       |

完整逐项映射与独立复算位于忽略证据目录 `.dev-runtime/session-polish-round2-20261016/menus/goal-current-closure-review/function-index-offset-corrections.json`。当前正式 `session-goal-control-style-source.ts` 已使用正确的 oFi／gPi UTF-16 区间；该索引不作为运行时截取输入，不改变既有组件、样式或验收结果。本次仅核对源码和已保存证据，没有重跑浏览器、单测、构建、长测或原生协议。
