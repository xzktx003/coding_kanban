# Git 写操作与无 hover 菜单验收（2026-11-07）

独立 HTTPS **8531** 的原版 Changes 已完成单文件 **Stage → Unstage → 再 Stage → Commit**。同一 native 核对：提交仅含目标文件，index 清空，另一个文件保持未暂存、未提交，本地 bare remote 未推进；外层仓库 index/HEAD/config 哈希保持一致。建立测试会话的一次真实模型回复已完成，工具调用为零。

私有 HTTPS **8537** 修复了 `hover:none` 环境的菜单入口：原 CSS 把 action overlay 的可见性与命中放在 `hover:hover` 媒体规则下。仅在自有 v4 scope 为无 hover 环境保留行内按钮；真实鼠标、触控及键盘均打开原版 Git 菜单。官方 ASAR/CSS、原事件与权限检查保持原样；Mac 实机 hover 行为仍待独立验收。

计数无需修改：summary 使用原 `branch-diff-stats` 分支基准，fixture 相对 `origin/main` 为 **+2/-2**；Unstaged 为 **+1/-1**，均与真实 Git 一致。以上结果绑定独立候选，8484 本轮未改动。[脱敏结果](artifacts/git-write-gui-20261107.json)。

最小复现：

1. 在已忽略的 `.dev-runtime` 内创建全新私有 Git fixture，设置 dummy author、初始提交及本地 bare remote，再修改两个 tracked 文件。
2. 经原 Add project、目录选择与 Trust folder 进入该 fixture；打开 `New tab → Changes → Unstaged`，只 Stage 目标文件，再到 Staged 将其 Unstage。每次用同一 native 的只读 `git diff --cached --name-only` 核对。
3. 在该 fixture 已完成的测试会话中再 Stage 目标文件；原 Git 菜单进入 Commit，手填消息，**取消 Include unstaged changes**，选择 Commit。空聊天需要先通过原 composer 建立一次测试会话，并核对真实回复、清稿及 Stop/Queue 结束。核对 HEAD 的 parent、变更文件、空 index，以及保留文件的工作区状态。
4. 在 [8537 候选](https://10.30.0.26:8537/?mode=chatgpt&view=agent) 打开同一测试会话，分别用鼠标、触控及 Enter 打开原 Git 菜单；本步骤不发送消息或执行 Git 写入。

完整私有回执：[Git 写操作](/data01/home/xing.hu/.cg-git-write-gui-5x9eksva/real-git-write-gui-result.json)、[菜单修复与基准语义](/data01/home/xing.hu/.cg-git-pointer-1z6cy_df/real-git-menu-css-result.json)。源码及原始会话正文未复制进公开结果。
