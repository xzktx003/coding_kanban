# 成功未知模型的可见名称（2026-10-16）

目录明确加载成功，但找不到当前 OpenAI 模型时，触发器和简洁菜单的模型名称显示“自定义”。原始模型 ID 和已保存强度不变。该分项只对齐这两处可见名称，不代表未知模型的全部交互、tooltip 或高级列表都与原版一致。

本文保留R20当时的gate和raw状态描述验收。后续 [R22读取状态](model-commands-state-parity-20261016.md) 已替代success-only限制；[R23状态描述](model-status-theme-parity-20261016.md) 另按原Moa／toa将普通live状态改为“自定义”及标准／深度，旧status断言随之迁移。原raw ID、aria、tooltip与recent保护保持，不能将本文历史描述当作当前全部状态规则。

前端验收入口为 **HTTP `http://10.30.0.24:48865/`**，绑定 `0.0.0.0`；普通 API 与 WebSocket 由隔离 fixture 接收。390×844 为手机能力模拟，不能当成实体设备或认证 IDE 验收。

## 原版证据与修改范围

完整原 hCa 的 unknown pair 保留 raw model，modelLabel 派生为 Custom；lCa 的 fallback 经 uca／oca／B8 进入 closed Trigger，simple caption 也使用 Custom。当前官方简中资源 `zh-CN-b05cfd55c534.js` 的 `composer.mode.local.model.custom` 精确值为“自定义”，资源 SHA 为 `b4c388322e812e4b9a2fef48bbe3087ade074a0040533484867e603796b90fdb`。

原 R18 六次 closed 阶段按钮 text 含 Custom，但混有隐藏测量／effort 层，因此不能把整段当可见快照；active simple caption 确有 Custom。closed 可见层另由原源码确认。R18 原运行是显式 en-US，本分项没有新增原中文 runtime。来源及边界封存在 `.dev-runtime/session-polish-round2-20261016/menus/model-unknown-label-r20-audit/`。

[NativeModelSelector.tsx](../../../apps/web/src/session-mode/components/codex/composer/NativeModelSelector.tsx) 与 [NativeModelTrigger.tsx](../../../apps/web/src/session-mode/components/codex/composer/NativeModelTrigger.tsx) 只各改一个可见 model span，直接沿用既有 `isUnknownOpenAiModel`。必须同时为 OpenAI、raw model 非空、目录的 id／model 都未命中、loaded 为 true、非 loading、error 为 null，才显示“自定义”。known、custom、空选择、pending、partial-error 与 warm-error 都保持原分支。 这是复用的产品 gate；原版 pending／error 的完整显示与命令禁用合同尚需另核，控制通过只证明既有行为保持。

两个 identity label 声明、raw aria、tooltip、status、recent、额外 raw-ID checked 行、手输 ID、目录／cache／loader、pair／tier／权限以及 R19 视图／焦点代码均不改。保留的产品 tooltip／aria／高级额外行与原版有区别，不能把保留它们算作已完成原版一致性。

## 红绿灯与验收

[新增测试](../../../apps/web/src/session-mode/components/codex/composer/NativeModelSelector.unknown-label.test.tsx) 使用真实 useModels、缓存、thread／config stores、Trigger、Tooltip 与 Radix；只 fixture 四类外部目录读。13 例包括三种成功 unknown（空／非空无匹配目录、gpt 前缀、none／明确 null、主／展开），以及 known0／1、id-only／model-only、custom 同 ID、空字符串、pending、真实 partial／warm 失败和诊断身份控制。

| 门禁 | 实际记录 |
| --- | --- |
| 原基线 RED | **3失败／10控制通过，4.10秒，exit 1**；每个失败仅 closed 与 simple 两个 model span 的 soft 断言，之前的真实加载、owner／配置／草稿／raw／API／IO 控制全部通过 |
| 两处修复后 | **同一13例全部通过，4.18秒，exit 0**；测试字节未改 |
| 相关组件与快捷操作 | **11文件119项全部通过，13.96秒，exit 0**；13例已包含，不另相加 |
| 会话菜单 consumer | **另1文件80项全部通过，22.26秒，exit 0**；与119为两个批次，合计199项，首次13例不另相加 |
| shared／web 类型与构建 | **通过，exit 0**；Vite47.31秒，现有chunk提示保留 |
| 正式浏览器 | **单批54项全部通过，5.0分钟，exit 0**；新16＋既有unknown18／行选择20，无修改断言或重跑 |

pending 由未决读形成，partial 由真实目录读 reject，warm 由 public refreshProviders 的第二次 provider 读失败形成，没有手设 ready／error。空字符串控制经真实 changeThreadModel 建立，不能用会忽略空值的 hydrate 伪造。诊断控制只有显式 ArrowRight 允许当前 owner 的 effort 变 high，recent 的 model 与 label 仍为 raw；其余打开检查均只读。

忽略目录 `model-unknown-label-r20-red-plan/` 的候选原封保留；正式测试只移除头两条准备注释，SHA 为 `e8d9d95e141f3e01083e3de63f041bc58aabda47482cf025cdd5267803140ae9`。RED 时 Selector／Trigger 仍为 R19／R18 原字节；应用后分别为 `b2fe2e718f9be2ea075d2efdeff0e20eab6b25b7988e262da3318b3ddad7ddf7` 与 `687e6e1a260c2e89ffde658fff63825b1676dba3b02f79b78a6dfc150288452a`，精确等于候选两span补丁。

源码与执行收据的独立审查已封存在 `model-unknown-label-r20-implementation-review/`，seal为 `ed4efa271a1d903f2f9194d6110a0603892fea9c191a1e096f8634afd9e0b67e`；125项源／旧证据核验及73项最终收据核验分别通过，不是浏览器测试数。`round20-model-unknown-label-source-manifest.json` SHA为 `fc3533a836a7ebede64c76c3005fab894d95b585681f63ee916c25cd3d643abd`，冻结2945条输入，相对R19仅两产品及新增unit／E2E变化。浏览器准备seal为 `dcbe7a5c6ddb1b32786e6854ac9edfd1e14705f25eb813e88a78fd7ab51c3761`，新16例list／定向tsc均实际exit 0，29输入副本一致；不将准备通过计为浏览器运行通过。

本轮没有重新执行原包、原生 CLI、SDK seed 或真实账号调用，没有重启正式运行服务或 Agent。原 Goal 附件注册外部改动仍按 [Goal 边界](goal-parity-acceptance-20261016.md) 待核对；整体目标保持未完成。

浏览器实际完成后，root重新核对2945条冻结输入全部稳定；`round20-model-unknown-label-source-verification.json` SHA为 `58639a8588c72dfac1fc7598a1f892d9e047d64253236bdc9447b51f1aa9f86d`。new16记录真实viewport并配置mobile／hasTouch，但没有实测coarse字段；只有旧行选择20采集了该字段，不能将其外推到全54。

实际54例的独立审计已封存：`model-unknown-label-r20-browser/actual-verification/seal.json` SHA为 `a48336ec9d67d4ab97d54f2fd8e1d5e8086432ba5a19c045dc547191b91758b6`。54份终态JSON及54份附件副本、174张PNG、638份状态记录完整，27160项离线证据检查无失败；该数不计为浏览器用例。审计实际查看16张代表图，root另查看桌面主输入与手机展开图，两者可能重合，不相加声称18张。238次模型目录读取包含58次只读model/list POST及6次预期provider 500；控制台原始60条为54条Vite诊断及这6条预期失败，非预期console／page error与业务写入均为零。

最终root收据 `round20-model-unknown-label-final-receipt.json` SHA为 `0d62b6f408d5435ceefda63f3ea07876f5058a83c84e64999299501d0fc43f15`，重新核对全部2945条输入与2971份封存文件无漂移，只确认R20分项完成。局域网HTTP夹具地址为 `http://10.30.0.24:48865/`；不代表物理设备、已登录官方IDE、正式运行产物启用或整体Goal完成。反馈生产入口／授权预检、原版pending／error菜单和快捷键规则及普通unknown consumer仍分别待核实。
