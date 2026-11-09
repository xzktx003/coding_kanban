# 配置变化后的既有会话只读流（2026-11-07）

只保留共享 socket 不够：隔离 Unix peer 中实际完成最小 resume 与 follow ACK 后，turn/started 已送达原 view；修改自有 config 后，delta、最终 item 和 turn/completed 全部静默丢失，source 本身仍 live。原因是 source 的 threadCurrent、provenance 与 bounded follower 继续使用已失效的执行 binding 作为读取权限。

provider 现保留独立只读 scope，write map 只引用同一小 entry 的子集，总 entry 上限仍为 8192。读取始终核对原八字段、daemon/账号修订、同一 owned view 和 held 项目/账号目录；配置证明失效或显式重核验只撤销写权限。账号/daemon/view/根身份失效会永久移除两种权限，旧写权限不会因读取仍合法或新证明建立而复活。Full App Tools 的外部等价回调保留原拒绝规则。

来源 authority、真实创建回执 provenance 与 follower 以该只读 scope 继续投递原有界通知。创建来源仍须先消费真实 start 回执和完整执行证明才能建立，序列化 token 或恒真回调不能造来源。没有现有真实 binding/follower 的线程仍按原规则丢弃；不自动绑定、连接、重核验或发送。

审批提示可在同一只读 scope 下观察，审批回复仍核对强写 binding、原 execution proof、request/turn/item/attempt/action 身份，并经过原实际写前 guard。source 的 reply gate 单独重查可写线程；工具准入 verifyConnectedThreadSync 也继续要求强写权限，不能从一个只读 follower 获得工具执行权。最小 resume、新建、turn/start 与所有未知回执规则保持。

原事件队列 64 项、原字节池、分块与 ACK 预算不变。测试覆盖配置变化后原 view 唯一收到最终文字、item/completed、turn/completed 和审批提示，同时审批 accept 明确被拒且无上游回复；原 source 继续 live，配置读取次数未增加，也无自动 resume/start/turn。另覆盖真实创建 provenance 的只读完成事件、read follower 不授予工具、元组/view/root/账号变化撤销及旧写权限不复活。

这项回归使用自有 Unix 协议 peer，其文字是夹具内容，不是模型输出。它证明实际 binding/follow 和有界路由行为；真实原 SDK/模型的持续对话及线上启用仍由主线程独立验收。当前运行 snapshot 不因代码合入而改变。

部署边界：本轮已合入 canonical 并通过定向集成；正在用于 GUI 的 jw33o6m7 宿主仍保持原冻结 bundle。本改动须随下一次新 native wrapper 发布，不能把当前页面行为记作已启用。
