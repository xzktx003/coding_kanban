# 刷新启动的重复原包校验

接续 [真实生命周期和失败计时](refresh-official-lifecycle-20261016.md)。本批修复启动链路的一项重复工作，完整两秒和正式启用关卡仍未通过。证据目录 `.dev-runtime/codex-refresh-20261016-startup-profile/`。

## 根因与实现

全新无登录 HOME、固定原 VSIX/匹配 CLI，真实 native/control/授权锚、生成桥接、可见启动和 Vite HTTPS/WSS，模型仍是无认证 loopback fixture。没有读取正式账号、连接默认 IPC 或修改官方包。

原 runBridge 先通过 verifyBridgeConfig 完整验证 CLI/VSIX 的固定 SHA-256 和 CLI 版本，随后受控分支 attachPrivateService 又完整验证一次。两文件实际为 **294451848 和 370048599 bytes**，每次重复扫描约 664.5 MB。bridge-verification-cost.json 三轮单次完整校验约 **0.66–0.76 秒**。

新增 attachPrivateServiceFromConfig({configPath, scope})，本次先通过原 verifyBridgeConfig 完整验证配置及原包，再按完整 domain/generation/PID/start ticks 核对服务，返回本次已核对的 descriptor。runBridge 复用这个结果，同次启动只验证一遍。每次新启动仍完整重验，没有跨启动缓存、mtime 快捷判断、公开 alreadyVerified 开关或可重用凭证；原 metadata 入口继续完整验证。

固定控制代次、初始授权锚、独立账号观察、连接打开后的身份复查、每条协议实际写入前的同步 guard 及未知回执不重放均保持。首版仅以 domain 附着，可能在拒绝旧 scope 前读取变更记录中的 PID；完整回归复现不存在 PID 的 ENOENT。现在先比较完整固定 scope，再访问记录中的进程，保留原 generation/scope 断言，并补必定不存在的 Linux PID 反例，避免 PID 复用/回绕偶然掩盖顺序问题。

## 红绿灯

- redundant-verification-red.log：**3 绿/1 红**，真实受控 runBridge --version 对 CLI/VSIX 各读 **2 次**，期望各一次。
- redundant-verification-green.log：**7/7、无跳过**，包括真实创建者退出及原控制/服务回归。
- 后补同进程连续启动两次，累计每文件恰两次完整扫描；换成私有伪 VSIX 后拒绝且版本输出为零，防止未来变成跨启动缓存或跳过验证。
- native-final.log：首版 **280/281、1 失败**，旧 PID 反例未过，未进入其后嵌套用例，不能记为 282 项。
- 完整 scope 修正后的 native-scope-final.log：**282/282、无跳过**。后补确定性缺失 PID 的 scope-missing-pid-final.log 同样通过。显式固定 NATIVE_CODEX_REFRESH_CLI，未用默认跳过代替验收。

## 实际启动与 CPU 诊断

原生官方日志从 native-launch 到 native-initialize，修复前三个实例为 **1672、1595、1588 ms**，首版修复后为 **794、751、771 ms**。这是该段实测对照，不据整体计时变化推断全部延迟都来自校验。

profile-run/ 与 profile-after/ 均经真实官方 Send，两个刷新样本分别向原 thread 接受并完成新 turn。前两次 navigation→原生接受为 **13851.40、11553.80 ms**，优化后为 **11866.90、12332.50 ms**。它们开启诊断 Profiler，样本少且有启动/缓存差异，不作为受控整页性能提升、iPhone 或 180 次矩阵证据。最终 scope 版本的普通三端无 Profiler 结果另记持续进度。

CPU 文件只保留脚本 basename、函数位置/名字和数值采样，排除 URL 查询参数及协议正文。首轮把 (idle)/(program) 等内建分类变成 unlabeled，该轮不能追溯区分这类原生时间。修正后重新采样，两轮 (program) 为 **6.80/2.87 秒**、(idle) 为 **3.37/4.42 秒**；program 不能直接解释为纯 JS 编译时间，各 frame 的 long-task 也不能相加作为总 CPU。

只读 window message 监听未在官方 document.open/write 后取得 RPC 时刻，该子项取证无效，不据空数组判断没有协议等待。自有 companion 的官方激活约 0.2–0.36 秒只覆盖它报告的激活段，不代表 Webview 完整就绪。EMFILE watch 告警仍保留，资源关卡未通过。

## 构建与边界

构建中并发新增模型菜单测试的可选 fixture 字段触发 TS2322。只捕获实际值为局部常量并明确缩窄，保留七个原例子、期望及生产行为，model-fixture-type-green.log **7/7**。check-typed-final.log 为 **pnpm check 退出 0**，保留既有大 chunk 提示。

本批未修改前端产品逻辑、网关、共享类型或会话正文通道，不据旧结果声称重跑这些整组。最终真实三端发送、正式身份/健康及私有清理见 [持续进度](refresh-recovery-progress-20261015.md)。完整目标和此前未通过关卡保持，候选未启用。


最终无 Profiler 的两桌面/iPhone 16 模拟三端实际发送为 **14284.10、14469.10、14037.70 ms**，草稿9/9、正确原生接受/完成3/3，但17项请求取消及全部两秒红灯保留。私有3线程/10轮均终态，12个已知自有进程清理、根/TLS删除；正式三组运行身份保持、健康200，运行层未切换。完整原始结果与边界接持续进度。
