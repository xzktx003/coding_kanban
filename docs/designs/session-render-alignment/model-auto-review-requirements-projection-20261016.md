# 自动审查要求的有界只读投影（2026-10-16）

本轮仅补齐后续跨模型 Power 预设所需的数据前置：既有 `/api/codex/config/requirements/read` 在同一次 `configRequirements/read(null)` 中保留 `autoReview.requiredOnModels`。没有新增预设菜单、读取订阅、缓存、账号预检或权限设置；正式运行进程不因源码或类型检查改变。

## 原始依据与范围

固定 VSIX `26.51007.21434` 的 `F_t` 按 `requirements.autoReview.requiredOnModels.includes(G_t(target))` 判断自动审查要求，缺省和 null 不命中；`G_t` 对不含斜杠的 canonical model 原样返回，所以 Terra/Sol 同样可能命中。相关精确原文、源 hash 及跨度见忽略目录 `model-built-in-presets-r28-capability-audit/source-evidence.json` 的 N001–N008；另有独立合同审查 `model-built-in-presets-r28-requirements-contract-review/`。

既有运行层投影服务于权限 allowlist，只保留五项；该原用途没有被本次审查证明发生新回归。若直接复用它实现跨模型预设，则无法区分原字段确实缺省与旧投影丢失字段。本轮新增有版本的最小元数据，只解决这一数据缺口，仍不足以授予任何账号、线程或目录权限。

## 投影合同

原五项权限投影保持。`requirements:null` 保留；对象新增 `autoReview`：上层 absent/null 规范化为 null；autoReview 对象的 requiredOnModels absent/null 规范化为 `{requiredOnModels:null}`；完整合法列表原样复制，保留大小写、Unicode、空白、顺序和重复，不 trim、去重、归一化、filter 或截断。任何畸形成员或超限令整项 `unavailable/invalid`，此时 null 只作不可用占位，不代表没有要求。

顶层 `projection` 包含 version:1、source:configRequirements/read、scope:runtime-global、内部服务实例、known/unavailable 与七种来源。仅函数两参数兼容调用时实例为 null；HTTP route 必须传服务自身实例，调用者 body 仍只能为 `{}`。native-null、auto-review-absent/null、required-models-absent/null/list 和 invalid 各自保留来源。

本地防护上限为256项、每项非空 UTF-8≤512bytes、列表原始字符串 UTF-8字节之和≤65536，拒绝 C0/DEL；这些不是原协议 schema 上限。C1未被此校验拒绝。native RPC unsupported 仍精确返回HTTP501，其它读取错误照旧拒绝，无补充读取或重试。

前端DTO的新字段均可选，用于保留旧运行服务的类型兼容；原raw/throwing读取helper不变。本轮没有新增decoder/readstate/cache/consumer。后续消费者必须以自己的红绿灯验证版本、来源、status、数据一致性与独立捕获的实例；旧DTO缺marker、实例缺失或不匹配、unsupported/error均不能清除模型要求。marker不替代原host/auth、managed/lock、可用模型、enabled effort或ultra等门槛。

## 红绿灯与最小验收

| 范围 | 实际结果 |
| --- | --- |
| 新测试首次运行前，运行层整体类型检查 | 退出0，4.1696s |
| 旧实现：28个protocol＋9个Fastify HTTP注入用例 | 29个目标断言失败／8个控制通过；Node693.54ms，wrapper1.5113s |
| 修复后：同字节37例＋既有14例 | 单批51通过，零跳过／取消；Node1080.66ms，wrapper1.7610s。37例属于51，不额外相加 |
| 运行层／Node网关／web类型检查 | 均退出0；4.1059／5.4149／28.1864s，均为noEmit |
| 正式运行层只读status | 退出0，0.6395s；保留PID2712539，明确磁盘产物未激活 |

旧实现的28个失败来自缺少投影元数据，另1个直接显示autoReview列表被丢弃；均为预期源码行的AssertionError，未将导入、编译或夹具失败当成红灯。RPC次数／method／params、原负载不变与隐私保护先于目标断言；HTTP参数拒绝、精确unsupported与其它错误／畸形全量DTO控制各自独立运行。after hook在目标失败时同样核对零writer、空ownership，并关闭自有Fastify/service。

合法列表覆盖空数组、canonical Terra/Sol、重复、大小写／空白／前缀和新数组引用；坏字段整组不可用；256／257项、512／513 UTF-8 bytes与累计65536／65537均测实际边界。请求body中的cwd、threadId、instance或projection均在原生dispatch之前被拒绝；整个测试只stub已有raw RPC，不连接真实Codex进程。error保持单次传播，不把500误作501，不重试或读取账号。

两个新正式测试SHA分别为 `04c4089d391e58b41d767666f2846bd6e433437930a80d9f3ba5e8282c0360e6` 与 `e0af469528b478a4ed2508ba65c84f8597841e336d70bcbd2edbfbd35863221a`；RED与GREEN不改字节。产品只含protocol、单处route内部实例参数与兼容DTO三个文件。七次命令各自冻结2994输入／HEAD，范围含四个源码根、14份选定E2E／fixture、42份infra与72份shared产物；不冒称全部E2E树。与测试推广前2992输入相比仅新增两份正式测试，另三处产品修改均与审过的候选完全一致。

测试v2准备曾把空字符串列作合法、静态计数也有误；在任何执行／正式推广前已改为v3的invalid反例，保留旧封包。独立审查分别封存产品候选、测试候选；先真实RED，再推广产品，最后同测试GREEN。没有修改原测试、放宽预算或增加fixture就绪捷径。本阶段为协议数据前置，未新增界面行为，未重跑UI浏览器或生产构建；类型检查不等于运行产物已部署。

证据封存在忽略目录 `.dev-runtime/session-polish-round2-20261016/model-requirements-projection-r28a-root/`，包含命令收据、精确源差异、RED分类、51例摘要、逐命令前后哈希与最终副本；收尾独立审查及放行收据保存在root外。不用初步审阅代替最终收尾，整个Goal继续。

## 运行与未完成项

前端既有隔离入口为局域网 HTTP `http://10.30.0.24:48865/`，绑定0.0.0.0；本轮没有新增前端页面或物理手机验收。所有HTTP案例为自有Fastify与raw RPC夹具，不是原生账号/真实目录或官方完整GUI验收。现有正式会话与Agent继续运行，当前旧服务不能从新源码自动获得此marker。跨模型预设、联合pair action、Default/FI、生产准入与安全启用仍分别进行。

后续已单独完成 [联合本地pair动作](model-joint-selection-action-20261016.md) 的接口验收；它未启用预设UI，不改变本阶段七条命令或正式运行进程的结论。

后续 R28d1 已完成 [纯数据解码与模型 predicate](model-auto-review-requirements-decoder-20261017.md)：独立实例匹配后区分六种 known 来源与 unavailable，合法 native-null／缺省只形成数据查询 false，不启用 reviewer。新51例、5文件99例及385次原函数比较已通过；既有 raw helper 和本阶段三个产品文件保持原字节，正式运行进程未激活新产物。
