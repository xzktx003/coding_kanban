# 侧边 fork 返回设置的水合与迟到回执

2026-10-16，Round 14。隔离浏览器入口沿用 **HTTP `http://10.30.0.24:48865/`**，绑定 `0.0.0.0`。本次修复前端对已返回设置的消费；不增加 read、resume、接管、发送或原生权限写入。

## 问题及原版依据

`createSideChat` 直接调用 fork adapter，原先只水合 model／provider／effort。fork 已返回的 sandbox、approvalPolicy、approvalsReviewer、serviceTier 被丢弃，新侧边会话因而采用全局或 UNKNOWN 默认值。实际 `followupParameters` 会把这些值放入下一次拟提交参数，不能依靠以后可能到达的 settings 通知补救。

普通 `codexService.threadFork` 已复用 `nativeThreadSettings`；侧边路径绕开它。网关、adapter、thread/started 和仅含模型的历史元数据都不能保证补全有效权限。原官方 Core 的 v1／eOn／gTn 同样消费 fork **响应**的有效权限和服务等级，不是只复制父会话模型。逐层代码及原函数片段见忽略目录 `.dev-runtime/session-polish-round2-20261016/menus/fork-settings-readonly-audit/`。

侧边路径现复用该 normalizer，保留原有三个模型字段的稀疏响应兼容。源线程权限不作为 fallback；fork 请求仍只有原 threadId，主会话选择和源草稿保持原流程。

## 本地状态规则

简单无条件水合完整 ACK 会让迟到回执覆盖已收到的新值；仅保存已见 key，又无法保留因用户 pending 而尚未投影的原生值。`ThreadModelEntry` 因而增加可选 `nativeSettings`，累计现有 normalizer 支持的设置值。它只含设置白名单，不含 thread／turn／正文；policy 仍使用现有 clone 和完整 roots／network／tmp 字段。

这是本地已接纳规范化设置的缓存。既有调用者可能传模型兼容 fallback，它不是新的原生权限、账号、父子关系或 writer 能力证据，也不构成跨客户端版本号。

- 普通水合保留现有 observed 快照、pending 投影与 revision guard；即使值因 pending 未投影，也累计其设置。首次明确返回 provider／null effort 与早先推断值相同，仍记录来源变化；真正重复的快照不通知订阅者。
- 只有侧边 fork 使用 `initialOnly`。目标不存在时正常水合；已有目标优先采用本地较后接纳的规范化值，补充未见设置，并保留用户 pending、notice 和原 observed 快照。ACK 不被当作用户选择已经生效的确认。
- sandbox／完整 policy／联网标记作为一组；reviewer 与现有派生能力作为一组。较新不完整 sandbox 组不从旧 ACK 拼接完整策略。任一相关用户待确认字段保护整组。
- 显式 `sandboxPolicy:null` 表示用户清空旧策略，即使之后 sparse metadata 已清掉 pending，也不通过 fork ACK 恢复旧 policy。正常明确原生水合继续按原规则确认。
- 旧持久 entry 缺少该缓存时，不从默认值猜测字段来源；初始 ACK 保守保留旧设置。一次 sparse 水合或本地选择不会把 legacy entry 偷换为“已知来源”的新 entry；本次不实施自动迁移。

这个规则按本地已接纳顺序保守合并，不证明真实 HTTP／SSE 的所有到达顺序，更不能替代运行实例或跨客户端 CAS。命名 permission profile、runtimeWorkspaceRoots、instructionSources 等更广元数据支持不在本次修复中；其中 policy.writableRoots 仍按已有支持完整保留。

## 红绿灯边界

新增正式测试使用真实 createSideChat、设置 store、normalizer 和 followupParameters，只把 fork 与其它 I/O 接口替换为禁止外联的夹具。源设置、全局默认和响应故意不同。稳定初始基线 **16 项中 9 红、7 绿**，复现四字段丢失、较新元数据回退和 pending／空值顺序；第一次夹具的 structuredClone action 函数及 undefined 属性断言问题另档保留，不计产品红灯。

最初四个相关文件修复后 **30 项通过**；删除补齐路径中会合成 observed 快照的赋值后，模型／人格／队列／权限／fork 边界共 **11 文件、78 项通过**。随后补充模式／联网单字段不完整组、保持旧 observed 引用三项回归；新增文件最终 **19 项通过**，最后相关组合为 **11 文件、81 项通过，8.44 秒**。后补三项不倒写成初始产品红灯。

shared／web 类型检查及前端生产构建通过，Vite 43.24 秒。同一冻结源码的浏览器组合 **18 项通过，零跳过，2.1 分钟**：Goal 创建／保存／完成清理、主／展开模型菜单六条路径，以及 1440／390px 侧边聊天各一例。

浏览器通过正常更多菜单创建侧边聊天，fork 夹具响应故意与主会话和默认值不同。初始侧边实际 store 保留完整 writableRoots、network／tmp 字段、on-request、user、null effort 与 fast；七个权限阶段保留服务等级，主会话／默认值／选中目标／全局焦点计数和两边草稿不变。每例只有一次精确 fork 请求，没有 turn/start／steer／interrupt、followup 提交／停止或删除；未向真实 native 写权限。

两尺寸同时重验空闲、长模型通知和身份告警三种底栏：间距 +4px、输入区 62px、该批可见底栏按钮至少 44px，没有横向溢出或正文裁切，主 frame 指标不变。核对按钮可见但未在本批点击，未覆盖运行中 stop 按钮；不扩大先前 CSS 的验收范围。

`round14-fork-settings-final-verification.json` 重新枚举 **2836 源码、22 个测试／夹具输入、3 个基础设施、72 个 shared 产物**，文件集合和 SHA256 全部不变；两份浏览器证据各自核对 20 个输入前后一致，页面／console 错误为空。相对 Round 13 仅两个产品文件改变、新增一个单测文件；侧边 E2E 和可选 fork 响应夹具同步更新。原正式服务与 Agent 没有重启，新运行层未激活；此前 30 分钟内存结果属于此前冻结源码，不改写为本批结果。

独立只读复查核对了全部 2933 个清单项和最终 guard，在本轮补齐语义内未发现新增可证实回归，报告为 `menus/fork-settings-independent-review/README.md`。浏览器 reviewer=user 与默认相同，该字段有区分力的 auto_review／guardian_subagent 证据来自正式单测；不将两份浏览器快照单独当作 reviewer 修复的证明。legacy 经本地选择、全新纯用户 pending entry 和 user-only reviewer 的全部组合仅核对源码 guard，没有追加运行验收声明。普通 hydration 对已确认 reviewer 能力的保留沿用原语义，user 选择不等于能力撤销。
