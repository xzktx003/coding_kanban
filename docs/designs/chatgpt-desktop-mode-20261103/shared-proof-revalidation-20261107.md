# 共享配置证明的显式重核验（2026-11-07）

真实共享宿主曾在 manager ready 后因 providerReadCurrent=false 退休，账号、独立 observer 与容器仍有效。配置文件闭包包含大小、mtime/ctime，合法文件变更也会使旧证明失效；此前把这项执行证明同时用于只读 session，导致下一条无关全局通知就关闭整个 source。目录身份只包含 dev/ino/uid/gid/mode，普通项目文件新增不会触发目录撤销。现存文件元数据无法倒推首次变更时间，隔离回归以自有配置变更复现该失败条件。

仅 preserve-native-cli 模式区分读取与执行：读取继续核对固定 daemon、独立账号/native 观察修订、容器和持有的账号/项目目录身份；实际 binding、最小 resume、新建、发送和审批仍要求原强度的执行证明。Full App Tools 的外部等价回调保持原规则。不会移除文件闭包检查或把旧证明当当前证明。

只有原 native 明确连接会话或新建 scope 操作可以重新核验。服务端验证固定项目/cwd、账号修订、同一 owned view、signal 和绝对 deadline 后，重新执行全部固定项目的真实 config/read 与 configRequirements/read 双读、完整配置/requirements digest、稳定文件闭包；不发送 thread/start/resume/turn，也不重试任务。构造期 coordinator 尚未发布 native 账号修订时允许先捕获独立配置证明，之后绑定必须核对实际已发布修订。

重核验开始就轮转不透明 proof 版本并撤销旧执行 binding；只有整个新证明成功才能恢复该版本的执行准入。绑定与创建回执跨 await 固定原版本，clientId 一次性使用；新建 ticket 同时固定 proof 版本和一次性 nonce。旧意图、已分派请求、迟到回执、取消/过期操作及旧 ticket 不会因新证明成功而复活。失败关闭候选/旧证明并继续禁止写入，之后只能由新的明确手势重核验。

该改动保留同一只读元数据连接；不会自动升级旧执行 binding、重新 resume 正在运行的任务或假造回复。失效的执行会话须经明确选择重新建立权限。没有账号/实例证明时读取与写入仍拒绝。

最小回归为 shared-execution-domain-proof.test.mjs、owned-shared-thread-authority.test.mjs、owned-shared-desktop-source.test.mjs：旧实现自有配置变更后只读 false 的红灯；修改后同一 owned Unix desktop 连接仍能 config/read，纯读取不自动重核验；明确新建 scope 重核验后旧 nonce 拒绝，新 scope 可授权但不执行 start，随后同一源仅发送一次原最小 resume。还覆盖初始账号修订 null→1、旧绑定/在途回执、取消/期限、账号/view 变化、不稳定双读、全部固定根和 FD 清理。

上述协议 peer 与组件回归不能替代真实原 SDK、正式账号或模型收发。当前运行 snapshot 不因补丁改变，需主线程冻结新 source 后通过真实 UI 验收；未自动升级 8484。
