# 刷新恢复：显式 CLI 桥接授权绑定

后续已增加 [native 代次的持久授权锚](refresh-native-authority.md)：创建时独立观察账号边界，manager/bridge 重建仍确认不可改绑的初始锚；实际官方发送 guard 同步检查撤销文件，不仅等待观察连接关闭。缺失旧记录不静默补写，观察进程失联拒绝接入，原 native 任务继续运行。

2026-10-15。隔离组件已实现，默认启动未启用；不代表完整阶段 1–3、官方 UI 或两秒验收完成。原 VSIX、Webview/MessagePort 和官方 JSONL 请求 ID 保持。

## 接入与身份

已有 `--refresh-service-config`、`--refresh-domain` 可增加 **`--refresh-control-root /absolute/private/control`**。该目录必须是所有者已经显式启动的 [独立管理进程](refresh-control-process.md)，不能由浏览器指定；单独传控制目录、相对目录或错误 native scope 均失败。启动核对发生在登录副本导入/扩展安装之前。

`prepareRefreshHost` 在新 wrapper 固定 native domain/generation/PID/start ticks，以及控制进程 generation/PID/start ticks。只嵌入这两个身份和目录，不复制控制能力令牌；后续 wrapper 读取私有控制记录并做实际连接验证。控制代次变化，即使 native 仍是原实例，也不回退到新控制进程；`--version` 同样拒绝旧身份，失败时不输出版本成功文本。

普通旧宿主没有该参数时保留原路径，不重启或接管现有 Agent。后续自动 profile 创建必须统一接入这一身份链；目前未实现自动注册或宣称所有存量客户端均已纳入。

## 原生账号绑定

`authorization-boundary.mjs` 的共享 tracker 由 manager 和新的 `bridge-authorization.mjs` 复用：

1. 每个连接只允许一次初始 `account/updated`；`account/login/completed`、`account/gatewayOAuth/changed` 或第二次账号更新立即撤销。同值的第二次确认也不能沿用旧授权。
2. ChatGPT 身份必须收到原生初始账号通知，两次 `account/read(refreshToken:false)` 的用户/工作区/backend/routing 摘要一致，且第二次读取期间没有账号边界。无 OpenAI 认证 provider 仍要求实际 `account:null, requiresOpenaiAuth:false`。
3. 只保留 domain/generation 范围内的 kind/摘要，无 email、账号响应或凭证缓存。无关 turn 生命周期不作为账号版本变化；它们仍用于原生回收写入的状态版本保护。

控制通道新增私有 `authorization({})`，仅返回已绑定 manager 的 `{kind,fingerprint}`。该方法不出现在浏览器路由，页面保护接口仍只接受 hello/visible。

每个受控 wrapper 新建一个**独立初始化的原生只读观察连接**，不借用官方连接的 initialize 或 RPC ID。它自己的两次账号读取必须与前后两次 manager 摘要一致，并保持完整 native scope 一致。官方连接随后仍按原样发送自己的 initialize、通知和请求。观察连接不读取正文、不发 thread RPC、用户输入或审批答案。

控制连接丢失、观察连接丢失、实际账号边界或取消会撤销本地 grant，关闭自身连接；不发送 native shutdown、turn interrupt，也不重放提交。正常 owner SIGTERM/SIGINT 作为客户端关闭收尾，授权失效仍以失败退出；两者均不构成提交成功回执。

## 实际发送边界

`connectStdio` 增加同步 `beforeSend`，每条 JSONL 在真正 `ws.send` 前运行，包括同一输入块的第二条消息和恢复背压后的消息。guard 必须同步返回 void；返回 Promise 的 guard 不能授权发送。结束/失效后停止解析剩余输入，迟到 send 回调不再恢复 stdin。

这些核对基于原生实际通知和当前连接状态；不声称 native 提供跨所有 socket 的原子账号条件写入。原生已接受请求仍由原生运行；旧连接关闭后的未知回执不重试。对真实 ChatGPT、OAuth/组织切换、全部官方 GUI 操作及其他未纳入客户端的完整验收仍待补齐。

## 资源与诊断

资源缺测时只对 `REFRESH_RESOURCES_UNAVAILABLE` 在当前操作内最多完整复测三次，间隔 25 ms。每次仍遍历完整 owned 树，检查代次、身份和五秒新鲜度；持续缺测继续暂停新增空闲保温，活动观察保持。账号在复测间隙失效会在下一次测量之前退出。没有背景采样轮询、TTL、放宽 RSS/数量阈值或重试 native RPC。

私有控制失败仅额外保留固定资源错误码和操作名，未知错误仍为固定 unavailable，不传异常文本。控制启动失败写私有 `0600 control-startup.json`，只有 state/stage/code/category 枚举；不覆盖已有文件，也不保留原始异常、配置文本或账号数据。错误阶段分类是诊断线索，不是根因证明。

## 已有证据与边界

- 红绿灯：重复初始通知、无关 turn 误撤销、逐条实际写入、异步 guard、控制 scope、绑定中取消、原生观察失联、私有诊断脱敏、资源复测与权限撤销。
- 固定 CLI 的真实测试直接运行生成 wrapper，两个原生客户端复用请求 ID 7 却分别得到各自正确 thread；关闭一个连接后另一个继续；控制进程退出撤销旧 wrapper，native 的原运行 turn 保持。
- 在全新无登录 HOME/loopback provider 中，真实 `account/logout` 产生账号边界，摘要仍属无认证 provider 也撤销旧 CLI。原运行 turn 在控制退出和账号撤销后仍 active，释放模型夹具后原 turn ID 完成，模型总调用两次（running/idle 各一次）。这不代表真实 ChatGPT token 注销/刷新、组织切换或官方 GUI 验收。
- `--version` 对不匹配控制代次不产生成功输出；本地 owner 显式取消正常退出，其他连接继续。
- 手机仍按用户确认使用 iPhone 16 393×852/DPR 3 尺寸模拟。平台通道浏览器测试与真实 CLI 测试分别记录，不能拼接成尚未执行的官方 UI 端到端。

阶段结果、保留的早期失败及尚未闭合的性能、资源与完整矩阵见 [持续进度](refresh-recovery-progress-20261015.md)。正式候选仍不启用。

**下一项必须补齐的边界：**现有 manager 的授权在其自身生命期内不可恢复，但新 manager 再次附着同一个 native 时，还缺少该 native 代次最初账号的持久授权锚及撤销记录。因此不能把新 manager 的当前账号核对视作跨重建账号隔离证明，不能据本批开启正式候选。下一步须在原生代次的所有者记录上绑定/撤销初始授权，并验证新账号不能继承旧 loaded contexts；这与后续自动 profile/资源注册和完整 ChatGPT 验收共同保留在目标范围内。
