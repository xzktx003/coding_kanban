# 多页面消息提交身份与旧回执保护

2026-10-27。修复会话模式的提交身份，不改变队列派发、占用权、审批权限或消息重发规则。

## 实际红灯

同源 Chromium 两页运行当时真实前端模块：分别编辑相同正文，各页 revision 都是 1、writeId 不同，但旧提交函数生成相同 UUID，第二条独立消息会被服务器正常幂等机制误去重。

两页同时各生成 200 个不同草稿的提交 ID，总数未达到旧 1,000 项淘汰门槛。旧整份 localStorage map 相互覆盖后，只剩 201 项；再次读取同一提交时，其中 200 项变成了新 UUID。若这些请求已被服务端接受但 HTTP 回执丢失，后续显式重试就有重复入队风险。证据位于 `.dev-runtime/submission-multiclient-20261027/shared-map-race-red.json`。

进一步复现同一个捕获编辑、相同参数值，只互换 `parameters.model/cwd` 的对象键顺序，产生两个不同 ID。证据 `key-order-red.json`。对应用例先红后绿；没有通过发送正式任务复现问题。

## 最终规则

`sessionEditIdentity.ts` 只在真正文字修改、内容合并、新增/重新添加图片或引用时生成 `edit3_<UUID>`。图片恢复、上传完成、清理、撤销以及新会话移动保留原身份，不把旧草稿伪装成新编辑。自动导入旧 `input-storage` 继续生成普通旧 UUID，必须由实际文字编辑后才取得新版本身份；自动导入不是未知消息重发的授权。

主 Composer、SideChatPanel 和 SubagentInput 均捕获正文 writeId、附件 ID、上下文 ID 与原 revision。异步创建、上传、切换目标或合并后的新草稿不能替换已经捕获的提交身份。只发附件/引用的编辑也有实际创建 ID，不再依赖空正文的 revision 0，也不把相同文件路径当作相同编辑。

`sessionSubmissionIdentity.ts` 为新编辑生成 `draft3_<SHA-256>`，输入包含 owner、revision、捕获的创建身份和完整消息 payload。对象键递归规范化，数组顺序保持。新的实际 POST payload 同样规范化，确保已有服务端 JSON fingerprint 与客户端身份相符；不修改服务端 schema 或队列存储协议。

新绑定按哈希独立保存，不再重写共享 map。相同捕获编辑在并发页面、刷新和 HTTP 回执丢失后仍得到同一 ID；不同 writeId 的同文消息得到不同 ID。标记最多保留 1,000 项，标记丢失/并发淘汰不会改变可重建的新 ID。新记录只含哈希和提交 ID，不保存正文或附件字节。

## 兼容与无法自动判别的边界

| 记录 | 处理 |
| --- | --- |
| 无编辑身份的旧草稿，原 `(owner, revision, payload)` hash 有旧 map 映射 | 保持旧 JSON.stringify 算法，沿用原 UUID；独立不可变 alias 保留该 UUID，之后旧 map 被覆盖也不改变重试身份。 |
| 本轮早期 `edit2_` / `draft_` 的精确 v2 绑定仍存在 | 原算法精确命中后沿用原 ID 和原 POST 键顺序；不静默换成 draft3。 |
| v2 payload 只改变键顺序，但对应旧绑定无法证明 | 明确拒绝新 ID，不用规范化结果猜测旧随机/确定性身份。 |
| 普通旧 UUID、旧纯附件/引用，或旧提交记录已经丢失 | 保留草稿，抛出 `MutationNotStartedError`；提示旧提交身份无法核实、尚未再次发送，先检查会话/队列。 |
| 用户核对后真正编辑正文、重新添加图片/引用 | 创建新的 edit3 身份，作为用户新消息。即使内容最终恢复相同或与某条旧 map 的同文 key 相同，也不永久阻断新编辑。 |

旧 alias 读取与新 marker 清理先冻结 `Object.keys(localStorage)` 再逐键读取，避免另一页删除较早键导致索引移位、漏掉冲突 alias。冲突旧 alias 拒绝自动选择，原记录不被覆盖。

没有全库迁移、IndexedDB 字节扫描、启动完成标记或按键额外存储记录。明确版本身份避免把升级前旧 ID、双初始化时读到的新 ID混为一谈。旧代码页面本身的既有写入行为不会因新版本存在而获得修复，须正常加载更新后的客户端；不强制刷新页面或停止任务。

旧不明身份不通过编辑器“重试”自动分配新 UUID。服务层仍保留 15 秒提交确认、最多 5 秒只读核对、unknown/uncertain 阻止重投、占用权与子 Agent 权限检查。编辑后发送属于用户显式新意图，不能称为原请求的自动恢复或 exactly-once 保证。

## 验收

本轮前端相关身份/发送/创建点单测、类型检查与浏览器日志位于 `.dev-runtime/submission-multiclient-20261027/`：

- `identity-unit-green.log`：身份模块与已有 followup 服务 3 个文件 53 项通过。新增自动旧输入迁移保护后，`identity-final-green.log` 再次覆盖身份、发送和正文草稿回归。
- `callsite-regression.log`：15 个文件 83 项通过，覆盖正文草稿、图片字节、标注、移动/撤销、旁聊、子 Agent、文件拖放、上下文更新和编辑器引用。
- `typecheck.log`：前端 TypeScript 检查通过。
- `browser-green.log` 与 `legacy-browser-green.log`：合计 10 个 Chromium 用例通过。两个同源页面和独立 browser context 使用实际提交服务、真实 Fastify `/followups/submit` 校验与磁盘队列；没有把任意 ID 都返回成功的 mock 当作后端验证。

浏览器覆盖同文独立编辑、同捕获编辑并发幂等、独立浏览器、400 项并发身份重算零变化、丢 HTTP 回执后刷新显式重试、旧身份阻断且保留输入、检查队列后编辑恢复、纯图片/引用重载和重新添加、对象键排序与实际后端 fingerprint、旧 UUID 和 v2 ID 原样重试。

浏览器夹具只允许只读 access fixture 及隔离 Fastify 队列接口，禁止其他业务 API；队列 `autoStart: false`，原生调用计数必须为零。此项是消息入队身份和回执保护验收，不等于模型实际执行、并发审批或真机 Safari 验收。

复验命令：

```sh
pnpm --filter web test:session \
  src/session-mode/services/sessionSubmissionIdentity.test.ts \
  src/session-mode/services/followupService.test.ts \
  src/session-mode/services/followupService.identity.test.ts \
  src/session-mode/stores/sessionDrafts.regression.test.ts
pnpm --filter web exec tsc -p tsconfig.json --noEmit
PLAYWRIGHT_SKIP_WEBSERVER=1 PLAYWRIGHT_FRONTEND_PROTOCOL=https \
  PLAYWRIGHT_BASE_URL=https://10.30.0.24:8484 \
  pnpm exec playwright test tests/e2e/session-submission-multitab.spec.ts
```

局域网地址为 **HTTPS `https://10.30.0.24:8484`，端口 8484**，前端仍绑定 `0.0.0.0`。地址是本轮测试环境记录，不写入产品源码。未重启正式宿主、网关或会话运行层。
