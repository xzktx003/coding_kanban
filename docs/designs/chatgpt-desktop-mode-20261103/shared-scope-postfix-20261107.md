# 原 node 绑定修复后的真实发送前验证

按原 node 对象绑定选择状态后，在全新自有空 composer 的原界面重新选择共享。实际加载的 helper SHA 为 `141a724944191fc65a0999d51fd3ef950220dc5d58dc923b23b83823f7fd7f65`。本轮依然用实际 CDP RemoteObject 的严格相等检查，未调用 resolver、SDK 或提交方法。

菜单后的 wr 和 content 都实际重绘：包装器与菜单不同、原 node 相同，且 `selectedOwners.has(scope.node)` 和 active owner 均为 true。进一步在原函数赋值后读取实际局部值，`wr.W`、`content.Wi` 与 `content.Ri` 都为 `kanban-shared-cli`，同时原 `yt.hostId` 仍为 local。原 Registrar commit 中 `owners.get(record.owner)===record`，其 target.hostId 为共享且 poisoned=false。精简回执见 [shared-scope-postfix-receipt-20261107.json](shared-scope-postfix-receipt-20261107.json)。

这是实际界面的共享宿主发送前条件，不是模型收发成功。观测0发送、0模型、0注入状态，没有进入单字符键盘触发分支。探针自身未完成动作/CDP等待后的正常清理；只终止了精确归属的 observer 进程，后续只读客户端连接超时。原始11条观测和清理首因保存在 `/data01/home/xing.hu/.cg-scope-post-tkkbjt8w/`，由主线程独占恢复该 target 的 Debugger 并复核空稿；不能用该失败清理过程冒充正常 detach。

实际 shared thread/start、turn/start、完整模型回复与继续对话由主线程在恢复后的同一自有页面验收，先前 private 回复仍不计入共享结果。
