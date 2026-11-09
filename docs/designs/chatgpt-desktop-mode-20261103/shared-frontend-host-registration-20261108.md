# 共享宿主接入原前端管理器

真实 v11 点击已到原 `se.consume`，但在创建授权前被原 `Jh` 拒绝。安全首错指向固定 `app-initial-18b189e867e7.js:203:97616`、`:203:97898`：原 `Uh` 没有共享 host，原前端管理器因而未建立对应 `Gh.client`。原 native connection/executionHost/manager ready 和菜单可选，不能代替这层注册。

固定 `initialize-app-host-services-a3479e215e83.js` 的 `WE` 仍通过原 `dm -> im -> tm` 工厂建立管理器。在原 `Yh` 安装后，`bindAppServerHosts(scope, Uh)` 根据同一文档有效 activation 和受控 native 的 ready 通知追加共享 host。原 `tm` 自行订阅真实 `AppHost.appServerManagers`；只有原 ready 回调才发布客户端。桥接不制造客户端，也不回退 local。

失效、卸载或 source unavailable 时先注销回调，仅从当前数组移除本绑定添加的项；期间新增的其他宿主和原本存在的条目保留。已退役 token 不因同值通知重新生效。真实写入和审批继续走原 scope、intent、账号及最终 guard。

原 ASAR 与 app-initial 不变。仅原 provider 的固定适配输出变为 SHA256 `042ffb31e3e56766c356e23b45f99ae712a12a6b25aa53b4fc98d54543ebe1cd`，208015B，原 512KiB 预算保持。定向原函数回归验证注册与撤销；实际创建、模型回复及续聊仍由主线程单独验收，离线检查不能计作收发成功。

v12 真实验证仍被同一 `Jh` 错误拒绝，尚未进入 create intent；不能据离线回归认定原 WE 挂钩在实际页面执行，或认定其 scope 与 composer 相同。当前改为读取自有页面的实际 binding、Uh 和 scope 身份定位，保留原失败草稿且不重发。证据位于私有 `shared-click-v12-host-9g0xlpmg/first-submit-errors-early.json`；8484 仍使用已验证的免密码本地版本，未切换此共享候选。

随后只读现场证据确认 hook 已执行、owned/current/sourceReady 均有效，provider 与 composer 的 Uh 指向同一实际 store，但 shared 已被后续原列表更新移除。绑定补充原 hostsAtom 的 watch，在原有效条件下维持自有注册；同步重入最多四次复核，异常明确失败，释放先停 watch 再移除 owned 项。source unavailable、文档失效或 closed 后不得重新添加或读取旧 scope。修复后的真实收发由 v13 新消息验证，未重发 v12。
