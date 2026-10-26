# 模型菜单已知强度数量修复（2026-10-16）

本批修复 `NativeModelSelector` 将已知模型的空／单项强度列表扩成通用五项的问题。修复只调整选项派生：已经找到对应 OpenAI 模型时保留其目录数组；未找到模型或使用自定义提供商时保留既有通用 fallback。打开菜单不改模型、强度或服务等级，也不增加目录读取。下文未知五档是 R15 当时保留的历史行为；后续成功未知 OpenAI 的六档及只读显示回退见 [独立修复](model-menu-unknown-efforts-20261016.md)，custom 五档仍独立。

这是有效协议输入的源码对照与产品回归，**没有读取或声称真实账号当前目录存在空／单项模型**。初次打开的原版焦点已由后续 [独立初焦点对照](model-menu-initial-focus-parity-20261016.md) 完成四例实际观察及产品 16 项浏览器验证；本批没有据此修改焦点、菜单关闭、350ms timer 或 owner 保护。

## 原版来源与有效输入

参考为 `third_party/openai.chatgpt-26.51007.21434-linux-x64/extension`，实装为 `26.1007.21434`。只读记录含 **33 个精确源码片段**，分别保存 0 基 Python codepoint、UTF-8 byte、UTF-16 code unit 半开区间及 SHA256；其中 **13 个有界原始函数／相邻声明片段与实装逐字一致**，不是整个 VSIX 字节相等声明。官方包未修改，也未在本批导入或执行原 ESM。

原链路为 Native `rU/iU` 的实际 `model/list` 查询与 select → Main `FJr` 归一化 → hCa 的可用性 wrapper、`dQ/gJr/pJr/yCa/jca` → 最终 power selections。关键区别是：

- `FJr` 按可用性、用户启用强度和 ultra gate 过滤，但不以 0／1 数量拒绝模型，也不将这些列表扩成通用多项。
- `dQ` 只有未找到模型才生成通用列表。`gJr` 对已知模型没有有效非 persistent 项时补一个 medium 显示占位；该占位不代表支持所有通用强度。
- 同模型 fallback 的 `yCa` 只追加 index，`jca` 返回实际列表或 xhigh 过滤列表。hCa 最终使用 `jt.length < 2 ? 'advanced' : m`，不是直接检查 wire 数组长度。

已有离线导出来自同一官方 CLI `0.162.0-alpha.17.2`，原 bin SHA256 为 `73b73b048546993298234a295de01ef2424e7a8b29def9d0ecb1ca7cb77500d4`。其 Model schema 要求 `supportedReasoningEfforts` 为数组，**没有 minItems**；每项必需 `reasoningEffort` 和 `description`。完整 Model 的 `[]`、`[{reasoningEffort:'medium',description:'medium effort'}]` 都是有效形状，实际原生查询 select 和 `FJr` 也按上述链路接收。缺字段、null 或对象不作为“未知模型”的替代输入。

原始证据保存在忽略目录 `.dev-runtime/session-polish-round2-20261016/menus/model-effort-cardinality-read-review/`：`source-evidence.json`、`installed-equivalence.json`、`protocol-schema.json`、`exact-input-examples.json` 与 `input-integrity.json`。24 个读取输入在该次只读审查前后哈希一致。该 schema 为既有离线产物，本批未启动 native 或读取账号。

## 同模型 fallback 的数量边界

下表限定普通、已加载、非锁定／非 Aeon／非 Copilot 路径，选中测试 ID 不匹配原跨模型预设，并使用有效且通过原过滤的强度。不能把该表推广成“原始数组少于两项时，所有原生分支都必须 advanced”。

| 选中模型信息 | 原版该路径 | 修改前产品 | 修复后产品 |
| --- | --- | --- | --- |
| 已知，空数组 | 单个 medium 占位，advanced，无强度滑条 | 通用五项，simple | 保留空数组，advanced，无强度滑条 |
| 已知，单项 medium | 单项，advanced，无强度滑条 | 通用五项，simple，可选未广告强度 | 保留单项，advanced，无强度滑条 |
| 已知，两项 low／medium | 两项，simple | 两项，simple | 保持两项，只能在两项内调整 |
| 已知，三项以上 | 由过滤后实际 power selections 决定 | 使用目录数组 | 保持本批之前的目录选项行为 |
| 成功读取后仍未找到选中 ID | 独立的未知模型 fallback | 既有通用五项 | 保持原产品 fallback |
| 自定义提供商 | 不据本表宣称原版全分支一致 | 既有通用五项 | 保持原产品 fallback，即使 OpenAI 目录有同 ID 单项模型 |

**跨模型预设例外：**单项模型若恰好参与原 `pJr` 匹配的至少三项预设，仍可能显示 simple，因为该滑条同时选择模型和强度。此次修复不实现跨模型预设，也不新增未知模型的通用选项对齐或用户强度过滤功能。

## 产品改动与红绿灯

产品的 `listModels → useModels.load` 只检查响应顶层 `data` 是数组，并原样缓存完整 Model。主／展开输入都调用同一 selector。原选项派生以 `catalogOptions.length > 1` 决定是否使用目录，将明确的 0／1 项与未知模型合并为通用五项，进而使 `canAdjust` 为真。

修复只替换为以下条件，复用现有 `!canAdjust` 的 advanced 分支；没有在打开菜单时补写默认强度：

```tsx
const options =
  settings.modelProvider === "openai" && model
    ? catalogOptions
    : GENERIC_REASONING_OPTIONS;
```

[正式数量回归](../../../apps/web/src/session-mode/components/codex/composer/NativeModelSelector.cardinality.test.tsx) 保留真实 `useModels.load` 和共享缓存，仅以完整合法响应替代四个外部 API 读取，设置回调用于核对无写入。两个缓存对照验证 0／1 项 Model 与数组原样穿透；两个行为用例要求自然进入 advanced、无 slider／强度项、普通方向导航不调用设置回调；另有 known2、unknown、custom 三项对照。每项都核对全局 fetch 未调用，没有真实网络或原生请求。

| 本批 R15 验证 | 结果 |
| --- | --- |
| 首次正式 RED | 7 项中 **2 失败／5 对照通过**，exit 1；known0／1 均实际显示 simple、缺少模型 radio、仍有 slider／强度项。没有夹具或启动失败，无重试 |
| 最小修复后新用例 | **7／7 通过**，2.36 秒；`round15-model-cardinality-green.log` |
| 四份模型菜单单测 | **4 文件／49 项通过**，5.44 秒；`round15-model-cardinality-final-unit.log`，包含新 7 项及已有键盘／owner／指针锁回归 |
| web 类型与生产构建 | `pnpm --filter web run build` 通过，包含 shared 编译、web tsc 与 Vite；Vite build 46.39 秒，既有 chunk 提示保留；`round15-model-cardinality-web-build.log` |
| 8 项专门浏览器验收 | **8／8 通过，41.0 秒**；1440／390 × 主／展开输入 × known0／1，`run-corrected.log`；独立复算 352 项全部通过 |

红灯及精确新测试补丁在 `.dev-runtime/session-polish-round2-20261016/menus/model-effort-cardinality-red/`。根线程收到正式红灯后才修改选项派生；该后续差分单列为 `root-post-red-only.patch`，反向替换此片段即可还原整个基线 selector 哈希。新正式测试哈希未变，旧测试与 server 等其余七个读取输入保持原字节，不把后续实施算成未解释的基线漂移。

实际浏览器验收复用绑定 `0.0.0.0` 的 **HTTP `http://10.30.0.24:48865/`**，业务 API／WebSocket 均由既有隔离 fixture 拦截。正式入口为 [session-model-menu-cardinality.spec.ts](../../../tests/e2e/session-model-menu-cardinality.spec.ts)，根线程执行 `81559` 退出 0，日志为 `.dev-runtime/session-polish-round2-20261016/menus/model-effort-cardinality-browser/run-corrected.log`，八份 JSON 与截图在同目录 `run-corrected/`。

首轮八例失败属于两处**测试夹具问题**，不作为产品红灯：真实 `buildUrl` 将 adapter 路径加上 `/api/session` 前缀，而新 spec 的等号匹配漏接，回退到既有 fixture 的两模型目录；本机 Playwright 1.58.2 的 `waitForFunction` 又将异步谓词返回的 Promise 当作真值，未等待三模型前提。原始 JSON 实际记录 simple 视图及 ArrowLeft 将 medium 临时改成 low，不能称其 DOM／键盘通过。修正仅限新 spec 的路径匹配与共用只读 getter 的 `expect.poll`，保留真实请求断言，并在操作前核对完整目录；未修改产品、旧 fixture 或手工写模型缓存。首轮 `run/`、诊断及精确 Playwright 片段保留在 `harness-route-correction/`，本页产品红灯仍是上表的两项真实组件失败。

复验每例均实际发出一次 `POST /api/session/api/codex/model/list`，body 为 `{cursor:null,limit:100}`；缓存完整保留三个合法 Model，强度数量为 `[3,0或1,3]`，选中第二个模型。自然打开为 advanced，第二个 radio checked，无 slider／强度项；四个普通方向键均未改变设置、正文草稿、另一 owner 的草稿或设置。Escape 返回原输入，四个展开用例再通过真实返回按钮回到主输入。每例 12 个输入的前后及当前 SHA256 均一致，共 96 对；业务执行／Goal 写入、pageerrors、截图错误均为 0。每例另保留一条 fixture 主动关闭 Vite WebSocket 后的控制台诊断，未称控制台零错误。

独立只读复算输出为同目录 `actual-verification/verification.json`，352 项核对全部通过，并实际查看 1440／390 主／展开的四张代表截图。菜单宽度均为 254px，未横向溢出或越出视口；390 用例记录 coarse pointer、44px 模型行。**390 为视口／触控／mobile 模拟，不是物理手机验收**，本批也未测长时 soak、正式运行层启用或真实账号目录。此前 R14 的全量 510 文件／2649 项不是 R15 新源码的全量结果。随后完整 hCa 的 P／Enter／ArrowDown／自然 advanced Enter 四次隔离观察均已完成；独立实际审计为 141／141，产品另批 16 项浏览器和四文件 57 单测通过，详见 [初焦点对照](model-menu-initial-focus-parity-20261016.md)。这些不是本页八项浏览器，也不作为完整 IDE 声明。

## 相关回归与测试前提

根线程在同一 LAN fixture 另批通过 Goal／侧聊天 **16／16（1.8 分钟）** 和菜单动效／键盘／模态锁 **16／16（1.8 分钟）**，各自日志为 `round15-goal-side-browser.log` 与 `round15-model-menu-final-browser.log`；连同新 8 项及既有 many-sessions 单例 10.1 秒，共 41 项分批通过，不称单批冻结 41 项。没有跳过对照或放宽行为断言。

旧 pointer-lock 用例原先拿单项 fixture-model 测 simple→advanced；真实一例等不到“选择模型”而超时，旁边 motion 对照通过。现在只在该 spec 的三个 seed 位置选择现有目录三档的 fixture-next，并先确认原触发器显示“接替模型”；原 Back／Escape／独立模态锁与草稿断言全部保留，六项已转绿。共享 fixture、目录 API 和产品未为测试更改。many-sessions 曾被静态怀疑，但完整三视口实际通过：已有 thread 的设置不由全局 seed 直接推导，原测试保持。15 个匹配 spec 的只读库存保存在 `menus/model-cardinality-existing-e2e-inventory/`。

新增的定向 E2E 类型检查读出旧 motion 测量中的 AnimationEffect/getKeyframes 类型错误。仅给 CSSAnimation 的 effect 添加 KeyframeEffect|null 类型收窄，未改测量或断言；按原 R14 哈希精确重建的旧测试与最终测试，TypeScript 擦除类型后 JS 字节完全相同，SHA256 `322c883d658e3eabba4ca551a337048d081992dd2570133607afce817d55db3c`。五份直接依赖 spec/fixture 的定向 tsc 最终退出 0，失败与最终日志、等值证据均在 `menus/model-menu-final-typecheck/`。

该批没有替换正式运行服务。2026-10-17 补正：当时只确认 server/app.ts 缺少 Goal 附件注册，没有并行删除或待用户许可的证据；后续 [R29 实际验收](goal-attachment-registration-20261017.md) 已补齐接线。R15 前端 API fixture 仍不替代真实网关证据，本页历史计数和当时源码冻结边界保持。R16 新增的初焦点基线单测是后续测试变更，不倒写为 R15 构建时的相同源码。
