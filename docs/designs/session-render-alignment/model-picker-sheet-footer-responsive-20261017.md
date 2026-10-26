# 手机展开输入区的页脚布局（R28e10）

320px、390px 的展开输入区曾让长模型按钮盖住“请求批准”权限入口。本轮保留权限按钮的固有宽度，让模型使用可缩的剩余空间，Stop 与 Send 继续各占原位置。精确同 19 个专项场景已从旧 CSS 的 13 PASS / 6 几何 FAIL 转为全部通过，原四份 spec 的 26 个控制也通过；类型检查、唯一后置生产构建和只读运行状态均通过。阶段最终冻结、独立终审与放行以 Root 外置收据为准，整体 Goal 继续进行。

## 改了什么

唯一产品文件是 `apps/web/src/session-mode/session-composer-v2.css`。五条既有手机规则限定在 `max-width: 767px`、`.session-mode .session-composer-sheet.is-full > footer:has(> .session-expanded-submit)` 及其直接子按钮；三列改为 `max-content 44px minmax(0, 1fr)`。权限按钮占第一列，模型仍在第一行从第 2 到第 4 条网格线跨后两列，Stop、Send 保持第二行第 2、第 3 列。其余 11 个声明值保留，没有固定高度、额外 DOM 或按钮宽度补偿。

旧首轨可以缩到权限按钮固有宽度以下，跨后两列的长模型随之盖住权限区域。新布局先为权限保留空间，再让模型在剩余区域缩小并省略长文字。完整 CSS 从 21893B 变为 22064B，增加 171B；产品 SHA256 为 `0e1566f3c25d2f5a0e660f7a728b8f7994c60ac4c56851e25bba36301f26f0ff`。新增正式验收为 `tests/e2e/session-composer-sheet-footer.spec.mts`，123946B，SHA256 `ae9cbb2d6f9d41d920e1383eb15f71e0488fb1aa1a7242af67d695be51ddb120`。

同一展开页脚里的 custom provider 接受这项父网格调整，原有数据与业务适配保留。主输入、桌面、Side、其他 Sheet 和 standalone generic 不在这些选择器内。TypeScript、图标、提示生命周期、权限动作、model/effort/FI 和草稿逻辑未修改。原 B 阶段 667 项单测是历史基线，不计作 E10 新执行；本轮是本应用的响应式修复，不是官方移动 GUI 像素复刻。

## 实际红绿灯与几何证据

同一 V2 spec 先在原 CSS 上完整运行，得到 **13 PASS / 6 合格晚期几何 FAIL**。六例分别为两种手机宽度的长模型展开页脚，以及两种宽度的 queue/steer 运行态夹具；失败只在 Access 命中和 Access/model 相交条件。Default、桌面、主输入和 custom 两个展开控制原本已通过。旧批次 19 例的业务硬保护与清理全部完成后，才判定这六例为产品几何红灯。

Root 实际查看了自然等待 350ms 后的两张旧图及相应新图，并核对矩形和内部命中：

| 模拟宽度 | 页脚内容宽度 | 旧列宽 | 新列宽 | 旧 Access/model 相交 | 新结果 |
| --- | --- | --- | --- | --- | --- |
| 320px | 302px | 0 / 44 / 246px | 124 / 44 / 122px | 118 × 44px | 权限宽124px，间隔6px，五点命中全部归属 |
| 390px | 372px | 56.25 / 44 / 259.75px | 124 / 44 / 192px | 61.75 × 44px | 权限宽124px，间隔6px，五点命中全部归属 |

旧 19 例有 314 个状态、7529 条目标检查，其中 116 条失败；这是六例重复状态中的检查，不是 116 个独立问题。精确 CSS 晋升后，同 19 例仍为 314 个状态、7529 条目标检查，全部通过，六个原失败全部修复。只检查页面没有横向 overflow 不能替代这些相交、文字 Range 与命中证据。

Root 还实际查看了 10 张新 GREEN 和 2 张旧 RED 截图，覆盖长模型 held、较宽用途菜单、steer 完整标签、custom 两宽及桌面运行态。可见结果与 Range/命中一致；截图是用例的辅助证据，不另算测试，也不代表实体手机或官方 GUI 验收。

## 本轮已结束的验证

下表耗时为实际命令墙钟。三次浏览器批次均单 worker、零自动重试。

| 检查 | 结果 | 耗时 |
| --- | --- | --- |
| 测试先行的 web 类型检查 | exit0 | 26.946804s |
| 新专项严格 E2E 类型检查 | exit0 | 2.412495s |
| 新 19 / 原 26 的用例发现 | 均 exit0；发现不算实际通过 | 2.333691s / 2.142738s |
| 原 CSS 完整 19 例 | 13 PASS / 6 合格几何 FAIL | 253.326291s |
| 精确 CSS 后 web 类型检查 | exit0 | 27.811648s |
| 精确同 19 例的新 CSS | 19/19 PASS | 241.033691s |
| 原四份 spec 的完整 26 例控制 | 26/26 PASS | 252.128685s |
| 唯一后置 production build | exit0，保留既有 dynamic-import/chunk warnings | 72.360628s |
| 只读 session:status | exit0，正式 runtime 未替换 | 0.919364s |

原 26 例是 opened-trigger8、completion-tooltip8、full-access-confirmation8、side-chat-permissions2，原文件、动作、阈值和发现 ID 顺序保留。原超时为 18 例 30s、8 例 90s；新 19 例均 30s，未用延长等待来通过。原控制记录 334 个状态，其中 completion 的 56 条目标通过；连同新 19 是 648 个状态记录，不是额外测试。

当前通过的是 **45 个不同场景**。旧 CSS 19、新 CSS 同19、原26共三批 64 次实际执行，不能把复跑计为新场景。全阶段 10 条检查命令中唯一 exit1 是已资格确认的旧 CSS 红灯；各命令前后四 maps/HEAD 均一致，无编译与浏览器重叠，生产构建在三批实际浏览器结束后执行。最后 build/status 的 4493 条输入记录分别前后稳定。Root 最终源码/文档副本的数量与冻结清单以其封包为准，本文不预造最终副本数。

## 输入、清理与错误记录的边界

新 19 例每例 48 条实际源码输入前后一致，整批 4489 条 maps/HEAD 冻结。其自有 SSE 严格要求每例 accepted、finish、close、ownerEOF 各一次，实际分别 19；最终 active/errors/cleanup 均为零。最后完整 raw/runtime 保护位于 `final-main`；`finally` 是诊断状态和晚期 Default、输入、源码、SSE/资源硬检查，不能扩大为完整 raw/runtime 同口径复验，也不将 owner EOF 当成客户端已消费证明。

原 26 中只有前 24 例使用同一真实 SSE helper，旧契约是 accepted≥1 与完整 teardown，page.close 先于 stream.close。实际聚合为 **accepted24 / finish23 / close24 / ownerEOF24**，24 条均关闭、零活动连接/服务错误；一条 FullAccess 的 finish 为0、close/ownerEOF为1，按原契约保留，不改述为新19的严格各一次。Side2没有同一 helper，各有一次正向自有 fixture `thread/fork`；新19的运行态也由隔离夹具提供，本轮没有对真实 Agent 发起发送、停止或权限动作。没有业务 writes 不等于零 HTTP POST，更不能声称全45不存在正向fixture操作。

新19的19条与原控制24条 console 记录均为已知的 Vite WS 连接诊断，共43条，Side2的console为空；不称零 console。统一 JSON 的 failure、page/errors、assertionErrors、cleanupErrors 均为空；Side2沿自己的原始证据结构记录，不补造统一 SSE/源码字段。全部原始记录与早期错误保留。

V1 观察器把 Send 的 `display: contents` 包装节点当作实体命中区域，导致可能漏过实际文字裁剪；完整文本审查据此阻断 E10-F1，候选没有执行，不计产品红灯。fresh V2 的66行差分只涉及三个 reader/正向目标区域，改以实际文字 Range、祖先样式及非空完整 Send 标签核验，保留非文字 predicate、动作、1px 阈值、等待与硬保护。Root 准入 reader 另曾错用 V1 metadata key，在任何写入或候选执行前纠正 `KeyError` 并复核；该准备期读取错误不是候选或浏览器失败。这两类问题与真正旧 CSS 的六例几何红灯分别留证。

## 服务与未覆盖范围

访问地址为 **HTTP `http://10.30.0.24:48865/`**，参考页为 **HTTP `http://10.30.0.24:37575/native-goal.html`**；本轮最后只读记录均为200。隔离前端 PID217746/start112857665 与参考页 PID2973318/start111490242 继续绑定 `0.0.0.0`；正式 runtime PID2712539/start55361120 保持身份。状态命令明确提示磁盘构建与运行产物不同，新磁盘运行代码未激活，没有 restart/cutover。Vite会注入开发时间戳，HTTP index整页hash不是固定产品身份条件。

320/390为浏览器视口与输入条件模拟，尚非实体手机或同网设备验收；没有新官方移动 GUI、全部缩放/字体组合、长期 heap/RSS 或原生 CAS 证据。没有停止 Agent、复制登录数据、修改认证、原生业务调用或 Git 写操作。完整 Dca、普通 leave/c、ct 真实指针可达性继续独立推进。本阶段实际验证完成不等于最终 Root 已封存或已放行；最终阶段状态以外置 release 收据为准，整体 Goal 仍在进行。

## 证据入口

- [旧 CSS 的六例合格红灯](../../../.dev-runtime/session-polish-round2-20261016/model-picker-sheet-footer-r28e10-root/old-css-red-qualification.json)、[精确同19 GREEN资格](../../../.dev-runtime/session-polish-round2-20261016/model-picker-sheet-footer-r28e10-root/new19-green-qualification.json)。
- [原26控制的完整资格与SSE区别](../../../.dev-runtime/session-polish-round2-20261016/model-picker-sheet-footer-r28e10-root/original26-green-qualification.json)、[Root 实际查看10新图/2旧图](../../../.dev-runtime/session-polish-round2-20261016/model-picker-sheet-footer-r28e10-root/root-new19-visual-review.json)。
- [10条实际命令及各自bookends](../../../.dev-runtime/session-polish-round2-20261016/model-picker-sheet-footer-r28e10-root/command-bookend-summary.json)、[最终只读运行身份与LAN记录](../../../.dev-runtime/session-polish-round2-20261016/model-picker-sheet-footer-r28e10-root/final-owned-runtime-status.json)。
- [产品晋升限定](../../../.dev-runtime/session-polish-round2-20261016/model-picker-sheet-footer-r28e10-root/product-promotion-receipt.json)、[V2完整联合文本审查](../../../.dev-runtime/session-polish-round2-20261016/model-picker-sheet-footer-r28e10-coupled-review-v2/review.json)。
