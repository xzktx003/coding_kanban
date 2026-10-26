# 独立刷新宿主的显式公共工作目录

2026-10-16。继续执行[完整计划](refresh-recovery-plan.md)，候选默认关闭。此前三宿主对照需要诊断网关子类修改 runtime.projectDir 才能打开同一个项目，不能作为产品启动路径的证据。本次在自有宿主加入显式参数，随后用标准 NativeCodexGateway 验证；不修改官方 VSIX、原生页面、MessagePort、SDK 设置或消息预算。

## 启动契约

新参数 `--refresh-workspace-dir /absolute/existing/project` 只允许配合 `--restore-visible-windows` 及完整 `--refresh-service-config`、`--refresh-domain`、`--refresh-control-root` 使用。它不启动控制/native 服务，不切换已有宿主，也不自动创建 profile。按 launcher 既有约定，可从显式 `NATIVE_CODEX_REFRESH_WORKSPACE_DIR` 环境变量取值；仍必须选择受控可见窗格启动模式。沿用[宿主启动示例](../../../packages/native-codex-host/README.md)，为各自私有 runtime 配置此公共目录即可。

- `--project-dir` 继续是本 profile 内新建的独立私有空目录，旧参数、fixture 和普通宿主规则不变。
- 公共目录必须已经存在、属于当前用户、为规范绝对目录、无符号链接、无控制字符、最长4096字符且非根目录；不能与本 profile 的 runtime、控制目录、连接配置目录或显式共享登录目录交叠。
- 不允许 world-writable 目录。允许已有且用户拥有的0775开发项目；本仓库实际为此权限。首版额外拒绝 group-write，实际目录反例转红后修正，没有修改用户项目权限。
- 在创建 profile 目录前校验；安装扩展后、启动 code-server 前再核对目录，拒绝失效或变为符号链接。检查是本地路径校验，不宣称跨进程的文件系统原子保证。
- 不创建、清空、chmod、复制或导入公共项目。HOME、CODEX_HOME、用户数据、扩展、TMPDIR 和原生扩展 IPC 仍各自隔离。

code-server 的普通 folder 参数、实际启动 cwd 及运行记录 projectDir 均通过同一个 `getHostWorkspace` 取值；新增记录同时说明 refreshWorkspaceDir 和 privateProjectDir。网关继续读取所有者0600记录，不接受浏览器提供工作目录或端口，也不需要覆写 runtime。未设置新参数时三个位置仍使用原 projectDir。原生任务 cwd/账号/实例授权仍由既有桥接与控制通道核对；相同目录不授予另一个 native 域的权限。

## 红绿灯与实际验证

新 `packages/native-codex-host/test/refresh-workspace.test.mjs` 覆盖完整受控配置/启动互斥、目录字符串和边界、两独立 profile 打开同一已有目录且内容/权限不变、缺失/文件/符号链接/world-write 在任何 profile 写入前失败，以及启动前目录再次检查。`.dev-runtime/codex-refresh-20261016-client-state/workspace-red.log` 0/5；首版4/5的另一项为测试目录受主机umask变为0775，改为显式0700测试准备。随后真实0775项目兼容反例另存 workspace-owned-project-red.log；连接副本目录交叠的额外反例为 workspace-connection-profile-red.log。最终 workspace-host-typed-final.log 连同原宿主用例33/33。

全新 `.dev-runtime/codex-refresh-20261016-shared-workspace/` 使用实际 launcher 新参数、三个独立 code-server 和未继承网关子类的标准 NativeCodexGateway。公共项目与每个私有 runtime 是不同目录。workspace-records.json 核对三份真实记录的公共 projectDir/refreshWorkspaceDir 与各自 privateProjectDir；真实公共夹具目录为0700，0775兼容由最终单测验证，没有操作正式项目。

three-final/result.json 的草稿恢复 **9/9**、精确 native 接受/completed/标记各一次 **3/3**、官方页面清稿收尾 **3/3**；普通刷新至接受 **13569.60/13442.20/13658.20 ms**，两秒全部红，15项ERR_ABORTED保留、总passed=false。完成后另需195/162/81 ms页面收尾。accepted-2.png 已核对空输入与原 Send；659/430/852高度重排、iframe/父节点身份保持和触控通过。实际浏览器仍Chromium145.0.7632.6、iPhone16尺寸393×852/DPR3/触点1，不能称为物理iOS/WebKit/系统键盘或剪贴板通过。这不是180样本或长历史矩阵。

最终 native-final.log **319/319，无跳过**；check-final.log 的 pnpm check **退出0**，保留既有大chunk提示；新测试格式、宿主/launcher语法、diff与路径另核对。没有提交或推送，保留并发Session/Goal/模型/反馈改动。本参数本身不证明自动 profile 管理、并发协调、两秒恢复或完整启用。

## 并发等待的新证据

前置 `.dev-runtime/codex-refresh-20261016-client-state/` 仍为上一版诊断网关配置，不能当作新参数验收。三组新独立标记 CLIENTSTATE_1/2/3：前两组的原生输入均各一次且对应轮次 completed，但页面收尾失败；第三组一个 completed turn 含三独立输入，三端收尾通过。已知完成后才开始新独立用例，不重发旧标记。原并发红灯保持。

本次明确失败状态是正确唯一目标、可见且已空的编辑器、aria-busy=false，但 **Send=0、Stop=1、Queue=0**，15秒后仍如此。不能只检查 busy 属性，也不能以服务端 completed 或草稿为空判成空闲。精确原生事件已经到达三个客户端，不支持简单归因“桥接丢失完成事件”。

内部状态诊断失败单独保留：第一组误用会在已有错误时拒绝的 frame helper；第二组误把 iframe id 当作 frame name，两次均没有取得内部状态。第三组使用只读、固定字段的 React 私有引用观察，在4000 fiber/6000对象上限内未找到可验证的会话状态，明确 truncated；没有提高预算或把缺测当通过。该观察不写状态、不替换官方消息通道，不进入产品代码，也不用于性能验收。尚不能认定本地提交占位是已证实根因。

前置夹具最终仅3个私有thread、9个终态turn（idle7 completed、running1 failed、人工审批清理interrupt1），九个独立标记均一次；running 长时间无SSE数据的failed不计运行保护。20个已知自有进程退出、零清理错误、根/TLS删除。完整并发稳定性、原手机漏发、设置、两秒/180样本、容量、长历史/内存以及自动宿主/源管理等关卡继续执行。

最终产品路径夹具为3个thread、6个终态turn（idle4 completed、running1 failed、人工审批清理interrupt1），三个顺序标记在精确接受turn中各一次。前置/最终 Responses分别11/6次，不等同用户轮数。最终同样20个自有进程退出、零错误、根/TLS删除；测试所有者删除整个人工夹具，不是launcher清理用户项目。两批临时前端均绑定0.0.0.0、LAN **HTTPS https://10.30.0.24:5173**（端口5173），已关闭。

formal-safety-final.json 于 **2026-10-16T11:49:13.717Z** 核对正式Session/native launcher/native host仍为 **2712539/55361120、2718477/83117363、2729812/83119682**；正式 **HTTPS https://10.30.0.24:8484/?mode=codex**（端口8484）及后端/Session健康均200，session:status仍ready且磁盘/运行产物不同。未切换运行层或停止正式Agent，不宣称所有网页或网关PID不变。完整进度接[验收记录](refresh-recovery-progress-20261015.md)。
