# Mac 原版分屏真实收发与重开阻塞（2026-11-06）
> 后续重开反例：在全新、合法受信任的浏览器上下文中，8515 原 v4 和 8516 图片组合版均出现 `BRIDGE_QUEUE_FULL / waiting_count`，且均未发送模型消息。因此五轮和分屏结果仍成立，但 8515 尚不能称为稳定可用交付；当前继续修复通用冷启动桥接。

接续 `deepseek-harness/session-87af675b-9e9d-445d-8bc5-f88bf4f47d14` 的后续结果：**Mac 原资源 v4 在两个真实线程完成 5 轮收发，分屏公共输入的切换、调整比例及关闭后台窗格已经实测。文件工具执行尚未通过，不能把本版称为完整编程工作区。** 此前 [8512 单会话交付](core-mac-usable-20261106.md)保持运行。

## 访问与复现

- HTTPS 局域网地址：**https://10.30.0.26:8515/?mode=chatgpt&view=agent**；前端绑定 `0.0.0.0`。点击“登录工作台”，使用本机私有文件 `/data01/home/xing.hu/.cg-split-web-wf3udoqr/auth/access-token` 的工作台口令，或使用同目录 `open-url.txt` 的私有登录链接。不要把凭证复制到仓库、聊天或截图。
- 进入第四 ChatGPT 模式，选择原版项目 `coding_kanban`，点击项目的新聊天入口，发送纯文字消息并继续追问。
- 打开两个会话后，悬停会话顶部的窗格栏，用左右箭头拆分；点击会话标签切换公共输入目标。当前输入框只有一个，输入目标在其上方显示。
- 拖动分隔线调整比例；关闭后台窗格应保留当前输入框和未发送草稿。关闭窗格只改变展示，不停止 native 任务。

## 真实验证结果

固定参考为 Mac **26.1027.61615**，ASAR 摘要与前次交付一致；运行宿主仍是隔离 Linux native，未执行 Mac ARM64 程序。实际订阅模型为 `gpt-6.1-sol`。

原版创建真实仓库项目并确认 Trust folder 后，线程 A 完成两轮，线程 B 完成两轮。将 B 向右拆分，两边均显示各自真实正文；点击 A 的标签后，公共原版 composer 再发送一条不含答案的追问。native 记录确认该条进入 A，最终 **A 3 轮 / B 2 轮，5 次 started / 5 次 completed、0 次工具调用**。每次实际发送只有一次手势；阻挡点击的原版首次使用提示通过其 Dismiss 按钮关闭，没有强制穿透覆盖层。

分屏中只有一个可见 composer，原 ProseMirror 文档已清空，Stop/Queue 已结束。实际拖动使左窗格从 627.5 px 变为 740.4375 px，composer 节点保持相同；关闭后台 B 窗格仍保留同一输入节点和准确草稿，随后仅清除本次测试草稿。native 实例和此前正式服务均未重启。

- [脱敏的线程与界面证据](artifacts/mac-split-five-turns-20261106.json)
- [两个真实会话的五轮回复截图](artifacts/mac-split-five-turns-20261106.png)
- 原始单次发送台账、native JSONL、界面与首因证据位于本机私有目录 `/data01/home/xing.hu/.cg-repo-native-a7hrrqzl`。

## 当前阻塞与范围

首次要求实际读取根目录 `package.json` 时，原生工具因找不到 bwrap 失败，随后原版提出沙箱外执行审批。本次明确拒绝，保留该轮原生失败回复，没有把它记作文件读取成功。独立无登录容器补入官方静态 bwrap 后，又实际复现 namespace 创建返回 `EPERM`。未批准绕过沙箱、未更改存量 Docker/主机安全策略；因此当前文件读取和写入均不能宣布可用。证据分别在上述目录的 `sandbox-first-failure.json` 和独立私有目录 `/data01/home/xing.hu/.cgbwrap-test-Hbuh2lXq`。

图片接线在另一冻结候选验收，尚未取得真实模型识图结果；共享 CLI 线程、SSH、云、刷新后分屏布局恢复和长期资源表现继续实施。本次通过仅覆盖本文列出的实际行为，不代表完整桌面 1:1。

## 运行与源码

8515 的自有网关及前端 unit 为 `cg-split-web-wf3udoqr-gateway.service` / `cg-split-web-wf3udoqr-web.service`，冻结运行快照位于 `/data01/home/xing.hu/.cg-split-web-wf3udoqr/stage`；native 为 `cg-repo-native-a7hrrqzl.service`。不要修改运行快照、删除启动收据或用旧配置重试。现有 8484、8505、8512 和其他存量服务未替换。

分屏关闭与指针收束的三项运行源码已合回 `packages/chatgpt-desktop-host/src`，逐字节匹配之前通过专项检查和本轮实际运行版本。仅显式 `splitPane: true` 选择 v4；默认 v2 配方保持。登录表单及未认证入口也已合回 canonical，普通开发启动仍不自动启用原生宿主。

## 2026-11-08 至 11-09 bwrap 隔离兼容探针

全新无账号探针保留只读根、非 root、`cap-drop=ALL`、`no-new-privileges`、独立 seccomp/AppArmor 和 `network none`。真实 strace 现已确认 namespace clone、根传播、`/tmp` tmpfs、`/tmp/newroot` 自绑定和 `pivot_root(/tmp,/tmp/oldroot)` 成功；下一条精确 `mount(/oldroot,/newroot,MS_BIND|MS_REC|MS_SILENT)` 在基线 seccomp 下返回 EPERM，加入仅匹配该 flags 的 seccomp 等值规则后返回 EACCES。profile v9 仅新增对应 `/oldroot/`→`/newroot/` rbind AppArmor 规则，`apparmor_parser -Q -K -T` 语法检查通过，尚未加载/复验；是否等效隔离仍须看完整 bwrap 序列及负向测试。

8484 当前运行镜像内仍缺 bwrap；真实原版 UI 请求读取隔离项目文件时尝试申请沙箱外 `cat`，已明确拒绝并保留首因回执。官方静态 bwrap 离线闭包校验通过，初次构建因 BuildKit 对 digest-qualified 本地基础镜像发起 registry HEAD 而超时；改用临时本地 tag 并再次核对同一基础 image ID 后，`--pull=false --network=none` 构建成功，受保护 image config 未变，临时 tag 已移除。在新镜像中按生产入口和 no-network/read-only/non-root/cap-drop/NNP 配置运行 `bwrap --version` 成功；这还不证明 namespace/mount 序列或 CLI 文件读取可用。兼容探针不使用账号、项目挂载、网络或正式服务，不改 Docker 默认 profile；未证明完整等效隔离前，文件工具不得启用。

2026-11-09 在 8484 原版 Codex UI 中实际走通 Projects→New project→Add folder→Trust folder，隔离项目显示为当前项目；随后原生读取请求因 bwrap 缺失失败，沙箱外审批已拒绝，未读取文件内容、未改文件，也未重发。私有回执 `project-ui-context-test-20261109.json` 记录了状态。该轮验证只覆盖项目创建/信任 UI，不代表本地文件工具或模型文件上下文可用。
