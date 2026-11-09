# 接手用 AgentTeams profile

产物：[`cordis.patch.yml`](cordis.patch.yml)、[可复制启动 prompt](resume-prompt.md)、[完整交接](../handoff-20261105.md)。本轮只生成文档与配置，未安装／热加载插件、未修改实际 Harness profile、未启动团队或继续产品开发。

## 格式与来源

按 [NanmiCoder/dsh-agent-teams](https://github.com/NanmiCoder/dsh-agent-teams) 的命名多角色 profile 生成，核对版本为 `0.1.28`、固定源码提交 `cc43ee3ae7ddf58107215762d55dc15c3d79a003`。来源是该提交的 [usage](https://github.com/NanmiCoder/dsh-agent-teams/blob/cc43ee3ae7ddf58107215762d55dc15c3d79a003/docs/usage.md)、[profile schema／normalizer](https://github.com/NanmiCoder/dsh-agent-teams/blob/cc43ee3ae7ddf58107215762d55dc15c3d79a003/src/profiles.ts) 和 [bundle patch](https://github.com/NanmiCoder/dsh-agent-teams/blob/cc43ee3ae7ddf58107215762d55dc15c3d79a003/cordis.patch.yml)。未来默认分支可能变化，实际启用时核对安装版本，不绕过兼容检查。

配置采用 `taskPlanning: captain`，提供6名成员与交付规则，由队长按实际状态生成最小任务图。没有预埋庞大的固定DAG，也没有把 `kind`、`inScope`、`verify` 等任务字段错误塞进 profile 成员。质量任务由队长创建时声明真实合同和依赖。

成员默认继承队长当前 provider/model/思考强度；没有写死模型、provider或不存在的fallback，也未配置未知工具ID。`memberProvider: spawn` 是子代理后端，不是LLM provider。`memberMaxDepth: 0` 避免成员继续无界套娃；6名成员不包含队长。

## 怎么装入你的 Harness

1. 通过 Harness 官方插件管理安装并启用 AgentTeams，选择与你实际宿主兼容的版本。不要为配置热加载重启有任务的 Harness；本机现有 Harness 默认 HTTPS 3080 不变。
2. 配置文件是**完整插件挂载模板**。如果已安装的 profile 已经包含 `id: agent-teams`，只把模板中 `insert[0].config` 下的设置合并到该现有插件条目，保留其他命名 profiles 和已有配置；**不要再 insert 第二份插件**，也不要覆盖整个宿主配置。
3. 若使用全新独立 Harness profile，此模板可作为该插件的单一挂载层，前提是包已由官方管理器安装并可解析。具体配置存放／加载方式跟随实际宿主，不能只把文件放进 Coding Kanban 的 docs 就认为已生效。
4. 确认新 profile `chatgpt-codex-delivery` 出现在 AgentTeams 可选列表，再复制 [resume-prompt.md](resume-prompt.md) 发送给队长。DSH 的 `dsh --profile <宿主profile>` 与聊天中的 `/agent-teams --profile chatgpt-codex-delivery` 是两层不同的 profile。
5. `.agent-teams` 下含团队状态与邮箱，不要提交到 Git；复用已有团队必须通过原生 status/resume/reassign 工具，不能手改其状态文件，不能让两个 DSH 进程同时管理同一团队。

普通 `/agent-teams` 默认先生成待审计划。本次提供的 prompt 明确要求沿用已授权任务立即启动，供支持 `approval: automatic` 的版本使用；该设置属于创建工具，不是 YAML profile 字段。若实际宿主仍要求一次 Approve & Run，按正常界面完成，不修改插件绕过。

## 团队如何协作

| 成员 | 首批实际工作 | 后续范围 |
| --- | --- | --- |
| runtime-engineer | 核对在线native，解决输入／模型连接，提供可运行候选 | 项目、历史与恢复 |
| frontend-engineer | 修HTTP/2，接正确在线broker，打通浏览器真实画面 | 第四模式产品集成 |
| bridge-engineer | 仅以新证据实现有界桥修复，不重复无收益实验 | Mac资源主链、共享、SSH／云协议 |
| ux-engineer | 修CJK字体和实际中文输入 | Mac UI与自由分屏公共输入 |
| test-engineer | 修夹具、唯一GUI操作者，真正两轮收发 | 核心及完整一期验收 |
| reviewer | 独立检查最新代码、权限、范围与真实证据 | 审查修复与交付结论 |

队长持续整合与运行，不等所有成员结束；任何成员申请GUI操作权后，都必须明确交还给test-engineer。不要同时让两个Agent在同一个VNC桌面输入。

任务状态与成员工具过滤不能代替OS沙箱或原生写入授权。`requiredReviewers: [reviewer]` 也不能代替实际创建、完成并核对独立review任务；质量失败不解锁下游，修复任务不要依赖failed review。队长应使用当前 `attempt_id`，并分别给出“核心阶段通过”和“完整一期通过”的证据。

## 校验边界

生成时检查YAML结构、插件条目、成员上限、唯一成员名、质量策略及命名profile字段，并使用固定上游纯函数 `resolveTeamProfile` 校验；校验结果见 [`validation.json`](validation.json)。这是配置校验，不是实际宿主挂载、团队调度、模型权限或产品功能通过。本次未为此启动模型任务。
