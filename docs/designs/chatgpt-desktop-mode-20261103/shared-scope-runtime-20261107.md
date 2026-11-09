# 共享选择的原运行时 scope 身份证据

实际原界面在选择“Codex CLI（共享）”后曾静默创建 private 线程。前两次真实模型回复不计为共享通道成功，已有线程保留，不重发。

本轮在全新自有空 composer 中使用一个 CDP Debugger session。先验证实际 helper 源码 SHA 为 `50ead9544498297060f8a93d45fd4de5a5c4f6a83bb6728325159846cd7daf24`，再在菜单完成选择及消费者 resolver 断点保留 RemoteObject，通过 `Runtime.callFunctionOn` 的严格 `===` 比较实际对象；没有向页面注入全局变量或修改 scope。只读取 scope 的身份元数据和调用栈，不读取提示词、历史或凭证。

| 实际 caller | 捕获阶段 | scope === menu.scope | scope.node === menu.node | 旧 selectedOwners.has(scope) |
| --- | --- | --- | --- | --- |
| 菜单 select | 写入选择后 | true | true | true |
| wr / codex-composer-adapter | 菜单前原 render | false | true | false |
| Uq / composer-content | 菜单后实际 render | false | true | false |

菜单选择后消费者未立即重绘。按明确授权，仅在仍为空的自有 composer 中正常键入 `x` 再 Backspace，确认恢复为空；这触发 content 的实际 render，但 wr 没有新暂停。wr 的比较因此明确来自菜单前保留的原对象，不冒充菜单后结果。观测到的 scope 为 new/home，不能根据项目标签推定它必为 pending local。

首因是原组件拿到不同 scope 包装器，而它们持有严格相同的原 node；将 records 和 selectedOwners 按包装器保存会分裂订阅与选择状态。修复应以实际原 node 对象作为共享身份，并拒绝缺少 node 的输入，不能用 client ID 字符串推定对象相同。

原始私有证据位于 `/data01/home/xing.hu/.cg-scope-runtime-z9pgmvz0/{receipt.json,scope-observations.jsonl}`；可提交的精简回执为 [shared-scope-runtime-receipt-20261107.json](shared-scope-runtime-receipt-20261107.json)。探针0发送、0模型调用，未关闭原页面或 context。严格提交断点未命中，真实 shared thread/start、turn/start、完整回复与继续对话仍需修复后的实际验收。
