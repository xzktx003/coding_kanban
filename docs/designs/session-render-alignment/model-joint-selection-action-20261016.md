# 模型与推理强度的联合本地选择（2026-10-16）

跨模型 Power 预设需要把模型与推理强度作为一次明确的选择提交。本阶段在现有 config store 和 `useThreadModelSettings` 增加 `setModelSelection`，供后续消费者使用；既有菜单、快捷键、滚轮和各单项 setter 继续采用原路径。本阶段不启用预设，也不新增原生请求或授予模型／权限能力。

## 接口与状态边界

输入 `ModelSelection` 只包含 `model`、明确的 `reasoningEffort` 和可选 `serviceTier`。tier 省略或为 undefined 时保留现值，null 明确清除，字符串明确设置；不根据模型或显示值推断 tier。动作只提取这三个字段，即使运行时对象附带 provider、sandbox、approval 等字段也不会写入。

新聊天的默认配置在一个 Zustand updater 中提交模型／强度及显式 tier，并按**提交时**的当前 provider 更新 remembered model。其它 provider、权限、personality、协作模式和工作区配置不变。原始 pair 已相同且显式 tier 未变化时返回原状态，不修复 stale remembered map，也不通知订阅者。persist 中间件仍可能保存相同 JSON，本阶段不承诺持久化写次数。默认配置仍是设备级配置，没有新增每草稿一份设置。

已有线程通过一次现有 `changeThreadModel(threadId, patch)` 提交联合 patch；线程 store 算法没有修改。实际变化只产生一次本地 revision／最终通知，沿用原 pending 字段合并、notice、provider bookkeeping 以及 accepted native／observed settings 的保留规则。完全相同的原始 pair 与相同显式 tier 不改状态或 pending／notice 身份；tier-only 的明确变化仍提交。legacy entry 原来没有 `nativeSettings` 时不凭空补造。

hook 回调捕获原 thread target，之后 hook 切换到另一线程也不会把旧回调改投新线程。这是路由合同；实际菜单消费者仍须执行当前 owner／lease／可写状态检查，不能把捕获的 threadId 当作界面授权。只读 mount／rerender／unmount 不把原始 null 强度修成显示默认值；用户明确选择 medium 与存储 null 是不同意图。显示层的“重选当前档位”跳过规则由后续消费者负责。

一次本地 updater／revision 不等于原生 RPC 原子提交、ACK、CAS、账号或权限审核。本阶段没有调整发送队列、原生 writer、SSE、历史、正文缓存、关注集合或正文休眠机制。

## 红绿灯与验证

新测试只静态导入既有模块，通过 Reflection 取得新动作，并以明确的 typeof 断言检查接口可用性。旧实现实际运行 17 例：15 例在同一可用性断言失败，2 例既有 raw-null 只读／联合 thread patch 控制通过。这是**新增接口缺失的红灯**，不是既有 UI 已发生两次错误提交的证据；没有用缺失模块导入、TypeError 或 legacy setter 适配器冒充产品行为失败。

精确推广审查过的两个产品候选后，同字节 17 例全部通过。覆盖默认配置／线程各一次最终快照、tier 四种输入、tier-only、stale-map no-op、原 target 路由、已有 pending 合并、legacy settings 保留，以及拒绝附带权限字段。每例都检查其它线程、默认配置、自定义模型、文字和富草稿的值或引用保护，fetch guard 拒绝测试期间的请求；这不是通用进程或原生 IO 沙箱。

| 检查 | 实际结果 |
| --- | --- |
| 新测试推广后、产品推广前 web noEmit 类型 | 退出0，27.1027s |
| 旧产品 17 例 | 15 个新接口可用性断言红／2 个既有控制绿；Vitest 1.36s，wrapper 2.3754s |
| 同字节 17 例，新增动作后 | 17 通过；Vitest 1.24s，wrapper 2.1621s |
| 相关 store／hook／composer／权限和主题回归 | 单批33文件428例通过，零跳过；Vitest 51.18s，wrapper 52.2538s。新增17例属于428，不另相加 |
| 修改后 web noEmit 类型 | 退出0，25.5749s |
| 正式运行层只读status | 退出0，0.6017s；PID2712539保留，磁盘运行产物仍未激活 |

六条实际命令各自冻结2998条输入和 HEAD，四个源码根、选定 E2E／infra／shared 产物均无执行中漂移。与推广测试前2997条相比只新增一份测试；产品差异恰为审过的 config store／hook 两文件，未改 thread store 或旧测试。测试 SHA 为 `a81e850a3683e3869102a4e2e4cd4882a432e524771603a8813fd1bcfd7e3d26`，RED／GREEN 未变。

类型与本地回归足以验收本内部接口；本阶段没有新增可见界面或服务端类型改动，未重跑 UI 浏览器、生产构建、长期 RSS 或真实账号／原生原子设置验收。后续界面接入仍须独立红绿灯和浏览器验收，不能沿用本阶段数字冒充完成。

## 证据与后续

命令、输入快照、产品前副本、精确差异、分类与最终副本保存在被忽略的 `.dev-runtime/session-polish-round2-20261016/model-joint-selection-r28b-root/`；候选及最终独立审查分别保存在相邻目录。最终放行收据在封包之外，不修改已封材料。

现有隔离前端使用局域网 HTTP `http://10.30.0.24:48865/`，绑定 `0.0.0.0`；本阶段没有新增页面或物理设备验收，也没有替换正式运行进程或停止 Agent。原版纯 preset 派生、Default／FI 选择、完整生产 eligibility 和 UI 消费仍各自验收，整个 Goal 继续。

后续已独立验收 [内置preset及TX的纯算法](model-built-in-presets-pure-20261016.md)，没有将本动作或新算法接入生产菜单；本阶段六条命令和原运行进程结论保持。
