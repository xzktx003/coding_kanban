# Git/Diff 只读 GUI 验收（2026-11-07）

独立 **8525** 候选的原 Mac 界面 `Changes → Uncommitted` 已显示真实 diff：66 个 tracked 文件，**+1,914 / -244**，与同一已核实 native 内的只读 Git numstat 精确一致。原 `DIFFS-CONTAINER` 的开放 ShadowRoot 内 `code` 确已显示源码，未以 `body.innerText` 代替渲染证据。原版“Showing tracked changes only”及跳过 **450** 个 untracked 文件的提示保留，`gitWrites=0`。

本轮沿用原 Git worker、原 Diff/Changes 组件及既有桥接通道，生产 Git 桥保持原样。固定原包专项回归已随当前源码整合并通过，验收结果绑定同一已核实容器和精确线程。

本次不覆盖主 **8484**，其仍为旧 fixture 项目。默认 Branch 仍显示 “Couldn't load changes”，原因未核定；不能据此宣称所有比较基准或 Git 读写可用。

最小复现：

1. 在独立 8525 选中私有结果记录的精确线程及项目，打开原版 Changes，选择 Uncommitted；不操作 Stage、Unstage、Revert 等写入口。
2. 在同一已核实 native 内，对同一项目执行只读命令：

   ```sh
   GIT_OPTIONAL_LOCKS=0 git --no-optional-locks --no-pager -C '<已核实项目目录>' -c core.fsmonitor=false diff HEAD --numstat --no-ext-diff --no-textconv
   ```

3. 按同一时点核对文件数及增删行数，并检查原 `DIFFS-CONTAINER.shadowRoot` 内的 `code` 渲染。

本机私有证据：[完整结果](/data01/home/xing.hu/.cg-git-ui-adjtvg11/real-git-ui-result.json)、[numstat 摘要](/data01/home/xing.hu/.cg-git-ui-adjtvg11/native-diff-numstat-summary.json)、[截图](/data01/home/xing.hu/.cg-git-ui-adjtvg11/inspect-4.png)。完整线程身份及源码内容不复制到文档。
