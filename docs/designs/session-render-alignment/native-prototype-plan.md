# 原生 Codex 插件适配原型实施计划

基线：b560106，tag checkpoint/codex-replica-20261012。用户已授权在保存检查点后尝试基于未修改原插件适配和开发。Spec为 native-extension-interfaces.md 及用户要求：保留官方插件字节，保留独立升级属性，将外层窗口/输入能力通过宿主与owner/follower衔接。

## 全局约束

- 本分支隔离实现；不修改主工作区/官方VSIX、不推送、不重启正式服务，不连接默认CODEX_HOME的IPC，不接管现有thread。
- 官方包、code-server路径以及宿主/网关端口/目录均由参数或环境配置，不把主机地址、机器路径、Token写入源码。
- 新测试先红后绿；仅mock通过不能计真实原生联调。无现有登录的隔离CLI home允许显示未登录，不复制凭证。不得为测试登录退出正式账号。
- 支持只读先验：独立CLI home、项目、扩展和用户数据；线程仅在此home创建，无真实模型turn/审批/停止默认行为。发送能力后续须显式UI范围和准确owner确认。
- 适配器默认只开放owner发现与只读模型设置，未知版本/非拥有socket拒绝。禁止通用任意方法HTTP代理。
- 不改云任务；标签关闭、hide不隐式停止Agent。

## Task 1：版本化本地IPC适配器

在 packages/native-codex-adapter 创建无外部依赖的Node模块/测试/README：显式socket与隔离home输入；原length-prefix JSON初始化及request discovery/response；bounded frame/timeout/close清理；查找host+thread owner并读取model settings，保留targetClientId和method versions。package scripts含node --test。测试真实独立临时socket，验证切帧、请求归属、版本、超时、重复/错误回复和释放，不连接用户socket。检查原包HR019-025的精确frame，避免凭猜测实现。新包不引入默认自动发送。

## Task 2：未修改原插件的独立宿主与伴随扩展

在 packages/native-codex-host 创建可配置原型launcher与自身伴随扩展；只向独立扩展目录安装官方VSIX和我们自己的包；子code-server绑定0.0.0.0独立端口/用户数据/项目/CODEX_HOME，不读取或复制正式凭证。伴随扩展暴露范围受控的打开本原型线程URI和编辑器分栏操作，传入捕获线程，不执行任意commands；接口凭证在忽略数据目录且不进入浏览器或日志。优先通过独立临时CLI app-server创建2个没有turn的本地线程、关闭其自有服务后让原插件只读加载。先测试启动输入/目录/端口归属和会话URI校验，再实际浏览器检查插件是否激活/两个线程面板是否加载；不因为只读fixture成功声称模型可用。

## Task 3：真实联调、复评和记录

主线程使用Task1连接Task2的独立IPC：owner discovery、read-model-settings；记录真正回应的原版client identity和只读能力。验证不同面板/隐藏再现与插件文件摘要；运行专项/相关构建，检查JS堆+renderer RSS观测边界。若登录/宿主API/初始化阻塞，保留具体失败证据并修复可控适配层，不补丁官方插件。docs/func_list.md、project-overview.md、原型文档标记实验与限制；bug记录按AGENTS维护。原型LAN地址实际可访问后交付，完整发送/附件/升级性能不凭此自动完成。
