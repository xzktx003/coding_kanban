# 独立桌面宿主的持久历史

显式服务配置可增加 `options.historyRoot`。默认省略时，原有启动、HOME 和挂载保持原样。已有 v15 和其用户数据不会因此改变，也不自动导入旧实例历史。

在原有完整、owned `0600` 的服务配置中增加这一项；路径由部署者选择，不能从 HTTP 请求提供：

```json
{
  "options": {
    "historyRoot": "/absolute/private/rollout-history"
  }
}
```

该目录须提前创建，规范绝对路径、当前用户拥有、权限 `0700`、非 tmpfs，首次使用为空；不能包含逗号或控制字符，也不能与登录、HOME、runtime、控制、原包、工具或项目路径交叠。它复用既有配置的固定镜像、工具 hash 和私有路径，不另开部署入口。

宿主持久化官方 CLI 自己写出的 `sessions`、`archived_sessions`；开发中的本地项目功能另在同一历史根采集受限项目元数据投影，旧 native 与容器确认退出且旧 HOME 和授权身份均可核验时，才封存最终状态用于下一代。登录快照、`config.toml`、SQLite、任务队列、插件、日志和 Electron 用户目录不迁移到这里。新实例仍使用全新私有 HOME，ChatGPT 登录快照仍须 tmpfs。项目投影的观察、最终封存与机器重启限制见 [本地项目恢复](project-persistence-20261105.md)。

目录中的 `manifest.json` 只保存格式版本和账号身份摘要。摘要复用账号同步模块对 id/access token 一致的 issuer、sub、account ID 检查；源和 tmpfs 目标均以受控 FD 有界读取。每次实际桥写入前重新检查源和目标，源登出、换账号或文件失效会阻止后续写入，同账号 token 更新不改变摘要。声明来自显式受信的本地文件，不构成 JWT 验签；这些检查是时间点门禁，不能描述成跨进程原子撤销。

容器只读挂载历史控制目录，单独以可写方式挂载 `.lease` 文件及两类 rollout 目录。所有额外挂载均校验固定来源、目标、读写权限、非递归选项及实际容器内 inode。数据目录持 FD 比较身份，不以会随正常写入变化的目录时间判断失效。

固定 coordinator 通过 `flock` 持有 `.lease`。此外，在首次 native grant 前，`owner.json` 持久记录本次已验证的容器 init PID、start ticks、namespace 和容器 ID；新实例只有在原 init 已消失或确证 PID 已复用后才允许复用历史。原 init 仍存在、归属未知或读取失败都拒绝，不停止或接管旧实例。这个额外锚防止 coordinator 先于 namespace init 退出时提前放开历史写入。关闭网页或 profile 不释放存活 native 的所有权。

恢复沿用原版连接语义：新 HOME 的 `thread/list` 能找到 rollout，但 `thread/read` 和 `thread/turns/list` 在 hydration 前可能返回空回合。用户明确点击会话、由原版合法 `thread/resume` 连接后再读取历史正文；不能把空回合判为历史丢失，不能为恢复自动创建或重发 turn。

最小检查：

```sh
node --test packages/chatgpt-desktop-host/test/persistent-history.test.mjs packages/chatgpt-desktop-host/test/initial-mode.test.mjs packages/chatgpt-desktop-host/test/container-service.test.mjs packages/chatgpt-desktop-host/test/container-host-service.test.mjs
```

该检查覆盖持久目录复用、源登出和换账号、同账号刷新、目录/挂载替换、保护路径、初始偏好、真实跨进程 flock 互斥及原 init 未退出时拒绝复用。固定官方 CLI 在无登录 loopback 中已经验证 rollout 复制至新 HOME 后经明确 resume 可读回原回复。

隔离真实账号实例已将一轮真实回复写入持久目录；将这条已完成的测试 rollout 复制到另一个独立历史目录后，在第二个原版界面明确点击会话，成功显示原回复并收到一次真实追问回复，两轮完成记录均存在。首次实例关闭宿主时返回状态未知，native 和历史锁仍存活，因此没有复用该目录。

冻结的整合版本在另一授权隔离宿主中启用历史与账号同步，原版界面选择空项目并确认信任后，真实模型首轮和追问各发送一次，两次回复与完成记录均写入同一历史根。发送前重复的夹具只读项目查询期间出现桥接结果未知；确认没有会话及发送后显式重连，未重发模型任务。该隔离网关仅供受控测试，不是当前用户入口。

另一个无登录、无网络、无任务的隔离夹具验证了修复后的宿主正常退出；明确结束该自有 native 后，第二代使用同一历史根启动并读到离线播种的合成线程元数据。该次独立只读 reader 的 resume 因挂载权限被拒绝。

后续独立夹具由固定 CLI 在首代写入一轮合成对话，确认完成并关闭自有无登录 native 后，以同一历史根启动新代；在新代的实际可写 HOME 中明确 resume，已读回完整的用户和合成助手正文，没有发送新 turn。随后原版页面实际点击该历史，显示原完整对话，并在同一线程完成一次合成续聊；连续三次核对 composer 清空、Stop/Queue 消失后，全部自有实例经 viewClosed 和任务门禁正常关闭。GUI 打开前已有诊断性 CLI hydration，不将其算作纯 GUI 冷恢复通过；完整步骤和边界见[同根换代验收](persistent-history-native-acceptance-20261105.md)。真实账号跨代自动恢复及长期续期仍待验收；生产验收不能修改或重启现有用户 native。
