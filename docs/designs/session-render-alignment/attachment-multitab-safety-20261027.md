# 同浏览器多页面附件草稿保护

2026-10-27。范围是会话输入的附件草稿，不改变设备之间独立的草稿规则、发送协议或官方插件。

## 问题与修复

同源页面共用 IndexedDB，但各页面的附件数组及保存队列独立。原实现将某一页的整个 owner 数组写回；旧提交回执清理、迟到上传完成和新会话迁移会覆盖另一页新增的图片，迟到上传还会重新插入已被另一页删除的图片。

`saveAttachmentDraft(owner, items, previous)` 现在接收调用页面最后一次成功保存的不可变基线。默认空基线只表示新增，不能用于清空已存在集合。保存前仍先读取文件及标注原图字节，随后在一个真实 IndexedDB `readwrite` 事务内读取当前记录并按 ID 合并：

- 新 ID 只在不存在时插入；已有 ID 的更新只修改相对基线实际改变的字段。迟到上传的路径/状态不能顺带覆盖另一页的名称或标注。
- 删除只针对基线内被此次清理移除的 ID；未见过的其他页面附件保留。
- 更新的 ID 已不存在时不重新插入；提交后返回被移除的 ID，输入 hook 同时释放对应预览，阻止后续上传和发送继续引用该项。
- 保存成功才推进本页基线，失败保留旧基线和内存文件，后续显式重试仍提交未确认改动。

IndexedDB schema 仍为 v1，继续读取现有数组、旧 File 记录和可移植字节格式；不重建、不清空数据库。文件及标注原图仍以字节与元数据保存。字节准备和存储的 10 秒截止时间、上传的 30 秒截止时间、超时撤销事务及关闭迟到连接保持。

新会话迁移由 `moveAttachmentDraft` 在同一事务中读写两个 owner，只转移捕获的 ID；另一页后来加入的来源附件、目的地原有附件均保留。任一写入失败整笔事务回滚。hook 的两个写入队列在迁移期间共同等待；失败保留可见文件及重试状态，先完成持久迁移再保存后续上传结果。若来源首次字节保存失败，重试先保存尚未落盘的新增项，再转移。页面关闭前未成功落盘的文件仍须保留当前页面或重新选择，不能声称内存文件可以跨浏览器重启恢复。

这不是跨设备草稿同步，也不是同一附件同时编辑的通用冲突合并：同字段的并发修改仍按事务提交顺序决定。另一页新附件不会因此即时插入当前输入区；再次加载该 owner 时读取持久合并结果。

## 红绿灯与浏览器验收

修复前，`sessionAttachmentStorage.multitab.test.ts` 四项红灯实际失败：旧清理删除新附件、迟到上传复活删除项、十路并发新增只剩最后一项、未改动的旧附件覆盖另一页新名称。

最小回归：

```sh
pnpm --filter web test:session \
  src/session-mode/services/sessionAttachmentStorage.multitab.test.ts \
  src/session-mode/services/sessionAttachmentStorage.test.ts \
  src/session-mode/components/common/attachmentDrafts.multitab.test.tsx \
  src/session-mode/components/common/attachmentDrafts.persistence.test.tsx \
  src/session-mode/components/common/attachmentDrafts.failure.test.tsx
pnpm --filter web exec tsc -p tsconfig.json --noEmit
PLAYWRIGHT_SKIP_WEBSERVER=1 PLAYWRIGHT_FRONTEND_PROTOCOL=https \
  PLAYWRIGHT_BASE_URL=https://10.30.0.24:8484 \
  pnpm exec playwright test tests/e2e/session-attachments-multitab.spec.ts
```

本轮 5 个单测文件共 27 项通过，覆盖原图与标注字节、同页移除/撤销、迟到上传、十路事务并发、远端字段保留、源/目标保存失败、移动回滚与重试、超时取消。前端类型检查通过。

浏览器 2 项通过：同一 Chromium context 的两个页面使用真正 IndexedDB、当前源码 hook 和隔离输入夹具；一页旧回执清理后，另一页刷新仍具有正确附件 ID、名称和文件字节；旧页的新会话迁移不移动另一页新增附件；另一页删除上传中的图片后，原页迟到上传不能恢复持久记录或本页预览。所有上传均为 fixture，其他 API 全部拒绝，无真实 Agent 请求。该证据验证附件存储及 hook 生命周期，不代替完整 composer 视觉或真机 Safari 验收。

局域网入口为 **HTTPS `https://10.30.0.24:8484`，端口 8484**，前端继续由既有服务绑定 `0.0.0.0`。地址仅作本轮记录，测试读取环境配置；没有重启正式服务或会话运行层。
