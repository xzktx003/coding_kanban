# 共享原版提交的等待队列延续

固定 Mac composer-content 原件 SHA-256 为 `cf56f37714e14488239f4eb715b845067e75f8c2e98851c768c4110d3eb6fd08`。原 `x(yf)` 正确返回 `HG.submitComposer` 的 Promise；问题不是 void 回调。HG 等待模型/本地配置或附件操作时，先调用原 `onDeferred` 并正常返回；原 PG/附件队列之后直接调用 HG，不再经过 bf 的可信手势入口。旧适配器在第一次 Promise 完成时销毁票据，导致原队列续提交无法消费。

固定资源只在 HG 原 `onDeferred` 分支、原回调执行后增加标记，并传入原 composer 的 conversation/client 身份。标记仅在同一次原 bf 同步调用栈、原 lease/已提交目标仍有效且票据未被消费时生效；不修改原 options、onDeferred、输入、模型和返回值。普通正常返回不会延长授权。

明确等待的票据保留到同一次原续提交消费完毕，或原 30 秒期限、目标/lease 撤销、原回调失败；不重置期限、不合成手势、不重试。新建在项目/cwd 意图获得精确 ACK 后释放浏览器票据；已有线程在原发送意图 ACK 被消费后释放。原生侧仍独立核对同一视图、账号、daemon、项目、一次性 nonce 和真实写前权限。

若共享原 callback 正常返回，但没有消费票据或尚未进入意图流程，且没有原 HG 的明确等待标记，则以 `SHARED_COMPOSER_SUBMIT_DENIED`、固定 `no-submission` 阶段调用原错误处理器并拒绝返回 Promise。消费浏览器票据本身不表示后端取得创建票据；`intentSent` 为 true 也不等于 native 已写入或 ACK。该判断不把已发意图的未知回执改称未发送，不清空或重发草稿。

最小回归：

```sh
node --test packages/chatgpt-desktop-host/test/browser-shared-thread-submission.test.mjs packages/chatgpt-desktop-host/test/browser-shared-thread-navigation.test.mjs
CHATGPT_DESKTOP_TEST_MAC_ASAR=/absolute/path/to/app.asar node --test packages/chatgpt-desktop-host/test/shared-composer-deferral-assets.test.mjs
```

已保留等待新建/已有线程在原队列继续时被拒的红灯，以及修复后的单次消费、普通早退报错、错 client、原 callback 失败、期限及目标撤销反例。资源检查使用真实固定原件，只执行窄分支与本地 stand-in；没有连接原生 daemon、创建线程或调用模型。真实界面的本次无响应仍须主线复验，不能将这条确定的队列缺陷直接当作 UI 首因或真实收发成功。
