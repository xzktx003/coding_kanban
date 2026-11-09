# 项目模态框中的目录选择焦点

原版 Create project 模态框打开自有目录选择器后，会把选择器中的键盘焦点拉回项目名称；输入路径可能改变项目名，选择器仍提示路径为空。目录选择器现在挂在触发它的原模态范围内，并在支持时使用顶层 popover 显示；原模态或选择器被移除时，撤销该次 native 选择请求。普通无模态目录选择和原生 Trust、目录验证保持不变。

无登录、network-none 的原版界面使用两个独立私有 Git 目录验证了输入完整路径、Trust 和创建项目；没有发送模型消息。最终记录 `/tmp/cg-create-project-research-20261105/fixture-git-trust-create-final.json`，截图同目录。Mac 固定原资源的静态分析 Evidence 为 `ev_e88432eae4db87fc92e63f725d87a8ae1d048f197d848f9e18f73ab87bd92e4f`，不代替真实 UI 观察。

8502 此前“Failed to create project”的异常正文未保存，该次选择了根目录快捷按钮，无法认定由焦点问题引起。本次修复尚未部署到运行中的 8503。
