# 第四模式的账号快照同步：显式授权与验收边界

`packages/chatgpt-desktop-host/src/account-sync.mjs` 已接入受控服务启动流程和 supervisor 模板，**默认关闭**。它不会修改已运行的宿主；未显式启用时，账号快照仍只在启动时复制一次访问令牌，不复制刷新令牌。本功能尚未完成真实账号的长期登录验收。

## 启用与生命周期

在服务端自有的私有 supervisor 模板 `options` 中显式设置 `accountSyncGrantFile` 为授权文件的绝对规范路径，即为新代次启用；直接使用受控服务配置时，对应字段为 `options.accountSync: { "grantFile": "/absolute/private/grant" }`。路径只来自 owned `0600` 私有服务配置，不接受网页请求、环境变量或用户输入的覆盖。直接服务配置还必须同时指定 `networkMode: "bridge"`、`accountSnapshot` 和 `historyRoot`；supervisor 模板已要求固定账号源和持久历史目录。授权目录必须独立于账号源、项目、运行目录、控制目录和历史目录，满足代码的路径校验。

授权文件必须由操作者预先在 owned `0700` 目录内创建，文件 owned `0600`、不可为符号链接，内容精确为 `chatgpt-desktop-account-sync-v1` 加一个换行。授权文件不含凭据；删除或替换它撤销后续同步，重新授权需要新建受控宿主，不会自动重启现有进程。supervisor 会在分配代次前和交付配置前重新核对同一授权文件身份。

新宿主完成隔离 HOME 播种后、发布 profile 前，服务会建立同步器并执行首次同步与身份核对；首次锁忙或验证失败不发布 profile，已启动 native 的状态记为未知并保留，不停止其任务。成功后，同步循环立即检查一次，此后每次检查结束后等待固定 30 秒；原版锁忙时跳过该次检查。检测到授权撤销、账号变化、目标被外部改写或其他错误时，循环停止，新桥接写入被拒绝，服务尝试撤销自己的 profile 并关闭自己的连接；清理结果不确定时保留未知状态。native 不会因此被停止或重新发送任务。显式关闭会清除定时器，等待在途同步和自有连接清理。

要求 `historyRoot` 是为了复用现有账号绑定写入门禁：每次受控实际写入前重新检查授权源与目标快照的账号身份。授权文件的撤销由同步循环发现，并非每条写入前对授权文件做原子核对；删除文件后要等待下一次检查，遇到在途操作也可能延后。该门禁和本地同步不提供跨进程原子撤销保证。已复制的访问令牌、已发起的请求及 native 中的运行任务不会因撤销被删除或中断。

## 授权和身份

`createDesktopAccountSynchronizer({sourceFile, homeRoot, grantFile})` 只接受服务端固定的本地路径。源必须是 owned `0600` 文件及 owned `0700` 规范父目录；目标必须是已播种的 owned `0700` tmpfs HOME。创建同步器本身不启动计时器或网络请求，宿主通过 `startDesktopAccountSyncLoop()` 显式启动上述固定间隔循环。

`syncNow()` 比对源与目标的 id token、access token 中一致的 issuer、subject、account ID，以及源记录的 account ID；缺项或不一致拒绝同步。`desktopAccountIdentityDigest()` 只暴露有域分隔的身份摘要，用于其他服务对同一来源和目标做写前检查。JWT 声明来自已授权的本机私有文件，此校验并不验证 JWT 签名，也不能代替服务端的授权验证。

每次更新源 `auth.lock` 上先尝试非阻塞共享锁，目标 `auth.lock` 上尝试非阻塞独占锁；忙时返回 `busy`，不等待现有写者。已有源锁只读打开；源锁缺失则无法启用或继续同步，不创建或更改源锁文件。目标只在私有 tmpfs 写入 `0600` 临时文件，再原子替换；刷新令牌和其他源字段不会进入目标、日志或返回值。源/目标/授权文件的身份在更新前复核；目标被原生程序独立修改、退出登录或切换账号时停止覆盖。相同账号的原生独立改写报告 `TARGET_CHANGED`，不是换号结论。

调用 `close()` 后会拒绝后续同步，并等待已开始的同步结束。授权文件被删除或替换会在下一次检查前终止此同步器，不能靠重新创建文件自动恢复。删除文件与提交之间没有跨进程原子撤销保证；需要立即获得明确栅栏时必须调用并等待 `close()`。撤销只阻止后续复制，不会删除先前发出的访问令牌或中断已有任务。

## 原版缓存与隔离验证

随包 CLI `0.166.0-alpha.5.1` 的固定 SHA-256 为 `6253fb59fc4c21a9134b2f73237650eaec4a3d9380e5af12f3f1e9040dc24c14`。在无网络容器、全新 tmpfs HOME、合成账号及固定 CLI 的测试中：

1. 更换文件后，旧令牌未接近到期时，`getAuthStatus(refreshToken:false)` 仍返回旧的进程内缓存；显式 refresh 分支在发现文件变化后读取新令牌。
2. 旧令牌进入原版五分钟到期窗口，且文件已是同账号的新令牌时，`getAuthStatus(refreshToken:false)` 的原版内部路径读取并采用了新令牌。

源代码对应 [认证缓存和主动刷新判断](https://github.com/openai/codex/blob/rust-v0.166.0-alpha.5.1/codex-rs/login/src/auth/manager.rs#L2346-L2363)、[受账号约束的重读](https://github.com/openai/codex/blob/rust-v0.166.0-alpha.5.1/codex-rs/login/src/auth/manager.rs#L2985-L3003)及 [认证写锁](https://github.com/openai/codex/blob/rust-v0.166.0-alpha.5.1/codex-rs/login/src/auth/storage.rs#L159-L190)。同步器依赖这些版本的协作锁语义，非协作写入者及检查后外部撤销仍存在竞争窗口。

上述令牌轮换测试没有使用真实账号。另在冻结的隔离整合宿主中，授权真实账号的首次同步通过，并在原版界面完成项目选择及同一会话的两轮真实收发；这次没有模拟真实令牌轮换，也没有证明桌面版会在到期前及时触发读取、源登录会及时轮换或长期运行可以自行恢复。若源令牌始终不更新，同步器不能代替刷新；不得为此在生产无条件发送 `refreshToken:true`，因为文件未变化时原版可能向外部认证服务发起刷新。

直接隔离单测为 `node --test packages/chatgpt-desktop-host/test/account-snapshot.test.mjs packages/chatgpt-desktop-host/test/account-sync.test.mjs packages/chatgpt-desktop-host/test/account-sync-loop.test.mjs packages/chatgpt-desktop-host/test/service-cli.test.mjs packages/chatgpt-desktop-host/test/supervisor-config.test.mjs`。`account-sync-native.test.mjs` 仅在显式提供 `CHATGPT_SYNC_NATIVE_CLI` 且运行于只有 loopback 的网络命名空间时执行；未提供时跳过不能计作原生通过。
