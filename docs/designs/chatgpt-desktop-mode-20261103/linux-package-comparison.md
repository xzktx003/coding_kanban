# ChatGPT 桌面版 Mac / Linux 安装包静态对照

本文比较用户提供的 Mac 版和隔离研究使用的官方 Linux 版的 ASAR 成员路径及实际字节。两者分别是 **Mac 26.1027.61615 和 Linux 26.1027.51404**，同时跨版本与平台；观察到字节不同，不能据此归因于平台或版本，也不能声称功能增加、删除或运行行为不同。

本报告是静态字节证据，不是产品功能验收。REA 的单成员分析及其覆盖限制另见[桥接静态证据](bridge-static-evidence.md)；浏览器无宿主桥探针另见[原版前端隔离启动探针](original-renderer-probe.md)。独立 Linux 宿主运行和其他运行实验以其单独的运行记录为准，本文件不把静态匹配扩大为运行结果。

## 输入样本

- Mac：[用户提供的 app.asar](../../../third_party/ChatGPT.app/Contents/Resources/app.asar)，`26.1027.61615`、build `24141`，大小 674,615,301 字节，SHA-256 `bb88615052255e79b5977885f9a0cc212c268589587c79d4d3b7c4b46e881a95`。
- Linux：[提取的 app.asar](../../../.dev-runtime/chatgpt-linux-audit-20261103-7jyjn55e/extracted/usr/lib/chatgpt/resources/app.asar)，`26.1027.51404`，大小 670,826,973 字节，SHA-256 `1588e6a0e1dcfc615060152ef264d4adf2c3ff6bb7496986c72163b5853e2a2e`；[deb 控制信息](../../../.dev-runtime/chatgpt-linux-audit-20261103-7jyjn55e/evidence/deb-control.txt)中的架构为 `amd64`。
- [Linux deb 下载及完整性记录](../../../.dev-runtime/chatgpt-linux-audit-20261103-7jyjn55e/evidence/download-manifest.json)对应下载包 SHA-256 `46f1e22d028698fe9edaefd5847aece07c4509a30d3709e104220719d8c12822`。官方下载地址为 [OpenAI Codex Linux deb](https://persistent.oaistatic.com/codex-app-prod/linux/deb/latest/chatgpt_amd64.deb)；`latest` 的指向可随时间变化，样本身份以本次记录的版本及 SHA-256 为准。

## 覆盖、方法与边界

只读解析两个 ASAR 头及其成员列表，对打包内成员按其偏移和大小计算实际 SHA-256；`unpacked` 成员读取旁边的 `.asar.unpacked` 实体文件，再与头部的声明摘要对照。每个 ASAR 和每个 unpacked 成员在读取前后检查文件状态。ASAR 整包摘要不包含其外部 `.asar.unpacked` 文件；成员物理大小和摘要另记。

| 覆盖项 | Mac | Linux |
| --- | ---: | ---: |
| 成员总数 / 实际算得 SHA | 22,534 / 22,534 | 22,586 / 22,586 |
| unpacked 成员 | 16 | 27 |
| 实际摘要与 ASAR 头声明匹配 | 22,527 | 22,586 |
| 实际摘要与头声明不匹配 | 7，均为 unpacked | 0 |

Mac 的 7 个原生成员存在实际大小及摘要与头声明不一致的情况；它们及相关静态签名字段记录在[独立检查结果](../../../.dev-runtime/chatgpt-linux-audit-20261103-7jyjn55e/evidence/package-comparison/unpacked-integrity.json)中。出现 `LC_CODE_SIGNATURE` 不代表已完成签名验证，现有证据也无法确定差异原因或判断是否损坏。Linux 的 unpacked 成员在本次检查中全部匹配头声明。

将两侧相同相对路径对比：10,502 个路径中，10,491 个实际 SHA 相同、11 个不同，没有无法比较的路径。Mac / Linux 分别有 12,032 / 12,084 个路径在另一侧找不到完全相同路径；这不是功能缺失数量。

对未精确配对的文件名，脚本仅移除最后一段 `-` 加 12 至 64 位十六进制摘要并限定每侧名称唯一，得到 2,729 组**名称候选**，其实际 SHA 均不同；另有 3,494 个不唯一的名称键未强行配对。即使同名候选的字节不同，也不能因此认定语义不同：例如构建产物的导入名称或压缩符号变化均可能改变字节。名称候选和文件名中的功能词只是检索线索，不证明代码被加载、功能可达或跨版本等价。

精确相同的四个 `.vite/build/*preload.js` 不等于整套前端或双桥相同。两侧的 `webview/index.html` 不同；其入口 `index`、`app-shared` 以及 `connect-app-host`、`preload-bridge`、`thread-bridge` 名称候选也均不同。具体成员见下表。

## 入口和 preload：同路径

| 路径 | 对比 | Mac SHA-256 / ASAR 绝对偏移 | Linux SHA-256 / ASAR 绝对偏移 |
|---|---|---|---|
| `.vite/build/preload.js` | same_sha256 | `aa8be920fd14a9b98eca16c91d97a55105b196698fda36d5063e966620a0c54a` / 16049091 | `aa8be920fd14a9b98eca16c91d97a55105b196698fda36d5063e966620a0c54a` / 16062798 |
| `.vite/build/browser-page-preload.js` | same_sha256 | `587140ac16fa7329317f1a9fcd7044a6b4f1f7a5a8d9077361ecccfe0d96befd` / 6163464 | `587140ac16fa7329317f1a9fcd7044a6b4f1f7a5a8d9077361ecccfe0d96befd` / 6177172 |
| `.vite/build/experian-verification-preload.js` | same_sha256 | `ead037f6f49a3141182b393b6f0d3d1427b8fca41435c3124a8446989ae56887` / 15531809 | `ead037f6f49a3141182b393b6f0d3d1427b8fca41435c3124a8446989ae56887` / 15545516 |
| `.vite/build/sandbox-preload.js` | same_sha256 | `1c8196a06ba5ae10484433455620def2675f7fc50bdc2ef174ad3066f48f4685` / 16056118 | `1c8196a06ba5ae10484433455620def2675f7fc50bdc2ef174ad3066f48f4685` / 16069825 |
| `.vite/build/early-bootstrap.js` | different_sha256 | `bb8f2f467b40c583d889a52c1048865d3fa11ee123c6147606fc3087470b4c46` / 14926193 | `466efbe496786705721ae93dd7cd2be7c08d0f760d53adf984dfde77af93fecf` / 14939900 |
| `webview/index.html` | different_sha256 | `5e1cb0794f71578fce69d5a7f8c5056803b1e7f4c110718c5ca1730c202ec4cf` / 674597201 | `4337eb3638b651dce766b613d7a49a28ed3954ef151ab836431e75541376f92f` / 670808873 |
| `webview/assets/fd9b7fd80db1.css` | same_sha256 | `8cceab6badac2458d888405f0d0cbdd1b40bfefb2ba33eb74f577b4158c9d3b3` / 326343338 | `8cceab6badac2458d888405f0d0cbdd1b40bfefb2ba33eb74f577b4158c9d3b3` / 322554217 |
| `webview/assets/function-bind-context-d644fdf898e8.js` | same_sha256 | `07f25b25fb436f1484261aee2d64d72a60af0b60f192ec745e8bfe5110cb4583` / 341605741 | `07f25b25fb436f1484261aee2d64d72a60af0b60f192ec745e8bfe5110cb4583` / 337816645 |
| `webview/assets/index.client-5f0e08df5c98.js` | same_sha256 | `79a4a8662414a282f140c935b502c3f313dcf6470268eba5d3d2f45c1f0e3ba9` / 376964630 | `79a4a8662414a282f140c935b502c3f313dcf6470268eba5d3d2f45c1f0e3ba9` / 373175597 |
| `webview/assets/rolldown-runtime-428824ca0286.js` | same_sha256 | `f85e715d54a11fa37b7774ad77b536896ed01bfdfc98f485b678c81859fc8e2e` / 540104571 | `f85e715d54a11fa37b7774ad77b536896ed01bfdfc98f485b678c81859fc8e2e` / 536316089 |

## 名称候选：入口、桥接、UI 与云

每行仅为去末尾 `-hex` 后唯一匹配的候选；列出路径、实算 SHA-256、ASAR 绝对偏移。名称中的功能词仅供检索，不代表已验证功能。

| 候选名 | Mac 路径、SHA-256、偏移 | Linux 路径、SHA-256、偏移 |
|---|---|---|
| `webview/assets/index.js` | `webview/assets/index-65a34a2d8bec.js`<br>`0aa3796bf1f5068f4db6deab2d807bb62c5a175713770e72cca608039200a0d9`<br>offset 376413260 | `webview/assets/index-d6ce6adbaa97.js`<br>`1a39e28d48eadfb9e5cfac92ae5c747a32b338809748f8fb4b49fc0e9256ad7f`<br>offset 372925230 |
| `webview/assets/app-initial.js` | `webview/assets/app-initial-18b189e867e7.js`<br>`244653d55e434b27618a848bef14d6d6781569bf58e8656cf644445113ffc032`<br>offset 169973901 | `webview/assets/app-initial-fdea07eb2719.js`<br>`f1b0909638e5456b456bd2a2d6c96e6960985742fd162d932d2ecd51a067582a`<br>offset 170299081 |
| `webview/assets/app-primary.js` | `webview/assets/app-primary-75d53eef2374.js`<br>`ebaecd54561e7e3da76c08b0d900e056424d57b1b23675afad4d7d235599f80b`<br>offset 180851788 | `webview/assets/app-primary-f921a74f3eba.js`<br>`43c553113064956188f435bd0ce433aa46dad054aeb8e9919c2495b0482182a0`<br>offset 181177820 |
| `webview/assets/app-shared.js` | `webview/assets/app-shared-601019a330d7.js`<br>`02dd01d1e7c076ec44f10bb8446976f07be9eb007d1c32445adf5cda13221116`<br>offset 185894171 | `webview/assets/app-shared-b7a3bf2a8fe1.js`<br>`146e79e4da67e811def3fc69d1d090db268f756acaf916db1d0ce2ce6482390b`<br>offset 186220976 |
| `webview/assets/connect-app-host.js` | `webview/assets/connect-app-host-2c1800fa8f03.js`<br>`a3a327f26f9f068ed933e18b58db297ee424b7dae29901a384308a2e44bb239b`<br>offset 248782693 | `webview/assets/connect-app-host-a98f43cf0d03.js`<br>`5b9297cf96836c73cb3006ae78ca8894379ef47027d98f9b2bb635e47d8a59e9`<br>offset 249017991 |
| `webview/assets/preload-bridge.js` | `webview/assets/preload-bridge-69d80708290f.js`<br>`27400b43f5c44aac7c7d11d545159b35e29ea5d5156d5d27c1045209788dead8`<br>offset 513247827 | `webview/assets/preload-bridge-531d321c4778.js`<br>`c4d42457bf22cfdd727747e06cf89609964c0ff257827e1f79f225b5eac1f219`<br>offset 509459329 |
| `webview/assets/initialize-app-host-services.js` | `webview/assets/initialize-app-host-services-a3479e215e83.js`<br>`3212418ea362dbd6ca22a4f02319511dbeee19a3482ae45f40923d9a9ce856eb`<br>offset 377103634 | `webview/assets/initialize-app-host-services-bada1c61a701.js`<br>`c6efc9764c8a220bcaff8378d0bb142ad047a70b3489ad5e8cb5f13b3ab1f3fd`<br>offset 373314601 |
| `webview/assets/thread-bridge.js` | `webview/assets/thread-bridge-111bba6bbf48.js`<br>`49c31a42b0fe37375471d8a3ce116cbb96c38f23324d2f3aa11fd166d755a03e`<br>offset 614931559 | `webview/assets/thread-bridge-51d154587e1b.js`<br>`3fdd5b148758b70ab0273000e53aacd8696dafebcec23587e2bdb6ab50cf9c8a`<br>offset 611141030 |
| `webview/assets/sidebar-children.js` | `webview/assets/sidebar-children-519fed7c4e17.js`<br>`df3f4e6c87056c741d495071593ed858b5faf7a057a05c39dca4d2ec4a80d924`<br>offset 563980844 | `webview/assets/sidebar-children-51587ce440a0.js`<br>`f64ac2b13eb3868bc78f58dea7f3801b30451d95c0ef9567212851b754bf9b92`<br>offset 560229996 |
| `webview/assets/composer-entry.js` | `webview/assets/composer-entry-ad43fcf54a6e.js`<br>`8ca9a11712f3ac1d7a17f397e852e3d7c00a1293870c8efa01f783cf6a4f0c35`<br>offset 248129753 | `webview/assets/composer-entry-63e8ec830bf6.js`<br>`b10a6f47b7b9b6bd5b365f22156ea6de4d7dc2a20a3eb0cee63a3dd37e237ee3`<br>offset 248364993 |
| `webview/assets/composer-attachment-actions.js` | `webview/assets/composer-attachment-actions-b89b20d8b9f0.js`<br>`63a6568f6664b10e0981a6535bb1a15fb012f28c7892e7bf4b9860c73ac3e504`<br>offset 247336645 | `webview/assets/composer-attachment-actions-e1c2a40ce4ee.js`<br>`41f8082dbdab5fc654754a8aa3fafc646f1f33fa0e546a06a574eceaf22585f2`<br>offset 247568496 |
| `webview/assets/composer-project-picker-content.js` | `webview/assets/composer-project-picker-content-8dd99957b881.js`<br>`09c194858bb49eff0173e5f00a821570442ba6d0c963202b2d39f26eeddde732`<br>offset 248147440 | `webview/assets/composer-project-picker-content-368ac885433d.js`<br>`ee63e3608883d7fcc8b307637eba14ecbd2f9c44f1099befb806d4f6952b1f5c`<br>offset 248382680 |
| `webview/assets/composer-action-bar-run-location-dropdown.js` | `webview/assets/composer-action-bar-run-location-dropdown-e34f4046ee47.js`<br>`814c3f73425306bb6502115e879d51abbc72cf62d71d1130ca1d708d7bb9db3e`<br>offset 247318283 | `webview/assets/composer-action-bar-run-location-dropdown-edbd8885c51e.js`<br>`e7bd9ef7f6d34e6e91cf0de1d6c6540377c53c99371356f68d7087a90cb0beac`<br>offset 247550135 |
| `webview/assets/thread-app-shell-chrome.js` | `webview/assets/thread-app-shell-chrome-e7e38c7ea254.js`<br>`f3e0a96126e0b14e71ff0776ebb9d594741a84912957961893b9612090386165`<br>offset 614861993 | `webview/assets/thread-app-shell-chrome-1a582aa8a804.js`<br>`dff31959c17cfa138ed0c7d624b8e77299f7af212fff116473dc81f9d9bd4208`<br>offset 611071458 |
| `webview/assets/permissions-mode-dropdown.js` | `webview/assets/permissions-mode-dropdown-ff036d61b201.js`<br>`204816dfdb368361fb4d53da7a865be2c7eb6e769d8c1b1848925ab35536170e`<br>offset 506050376 | `webview/assets/permissions-mode-dropdown-838cdac3f164.js`<br>`a5faf00e66f5852ed905b88fbee4bf9698caaabc54931639967d29b1fb477d6b`<br>offset 502261792 |
| `webview/assets/model-and-reasoning-effort-translations.js` | `webview/assets/model-and-reasoning-effort-translations-c52b2a13d599.js`<br>`a4b5df13103028cac6efc47a4cc273594feebbd07109586ca431f196948895aa`<br>offset 448821976 | `webview/assets/model-and-reasoning-effort-translations-a72da1ea490d.js`<br>`fb997233c99493a22d6bf92817633c5507ac586541c3a2fd807f288a8aabf346`<br>offset 445041031 |
| `webview/assets/diff-preview-content.js` | `webview/assets/diff-preview-content-6331dd21103b.js`<br>`fed5ba4841d47ee6d3e2af687a5f294368420b4d81c74600c11ebb14f9df2337`<br>offset 283055691 | `webview/assets/diff-preview-content-47864be18556.js`<br>`746f984c9e2146c1fb40df5993db6bfb90feac450f8d56f7d950d00f8a5b9536`<br>offset 279267429 |
| `webview/assets/automatic-approval-review.js` | `webview/assets/automatic-approval-review-d23193183782.js`<br>`7190a2a6ef91f6371cd40838a0b1aeeb13ad4e9d68e3af80a04e5c349e866b41`<br>offset 199984438 | `webview/assets/automatic-approval-review-b219ac302747.js`<br>`9ef24aac295e6a4ad6eb6753428dfa34f6006ad9e6c74ac00c0bab6c88efc7bc`<br>offset 200297792 |
| `webview/assets/automation-dialog.js` | `webview/assets/automation-dialog-960d13d2651c.js`<br>`c951e01eed471c858d829a4eeac9b6790b5a7b91f12a1153f4f5ca87cdf6fc13`<br>offset 200009168 | `webview/assets/automation-dialog-7a515d932e05.js`<br>`d61e492c6c853110d1f61ae952aa3ca84414f3a2bc86eb5bacd0eedeca502dd7`<br>offset 200322522 |
| `webview/assets/manage-plugins-page.js` | `webview/assets/manage-plugins-page-2376741217c8.js`<br>`e6993124a49416e93062a81d65a05a28b6a653d913f5dc8d4f8deb381f815d09`<br>offset 425059153 | `webview/assets/manage-plugins-page-8962aa2c0942.js`<br>`c9a1c6681c06fd859186ce87e55dc456cd38ecbcb518c5c2113c29e34b220c66`<br>offset 421270340 |
| `webview/assets/remote-connections-settings.js` | `webview/assets/remote-connections-settings-4dd0ca54883c.js`<br>`7482aef813a976818871f69b226660c46f6c70c239c82b92e6ee5ac26a7c5183`<br>offset 533503654 | `webview/assets/remote-connections-settings-8cb3d5b8c7e8.js`<br>`66df8fccb6db35e77e5e5e4ae351ed0ab20a2ba4520e23a755e974ac3e5a5199`<br>offset 529715187 |
| `webview/assets/remote-conversation-page.js` | `webview/assets/remote-conversation-page-f909727e086c.js`<br>`665ca8d31903796db8c1260d836b6b14bf89159cb8452edbd292c290e4352ca5`<br>offset 533670291 | `webview/assets/remote-conversation-page-5256d10d3723.js`<br>`2b0149398cf7660d07179c3dad450386db2f8b496816ea3a37decd6b9d95d2f6`<br>offset 529881805 |
| `webview/assets/cloud-environment-editor.js` | `webview/assets/cloud-environment-editor-8052c3f6abcc.js`<br>`bb25ed7765abdc0ec2dfd53a2aee1d13abee8a382a18f2549b65a331a28b1bd9`<br>offset 244217767 | `webview/assets/cloud-environment-editor-4d04f9249c5a.js`<br>`410549de1816b546d0263650eefacf76d5946c64a1b03469b196f81ff3b0486f`<br>offset 244453312 |
| `webview/assets/cloud-environments-settings-page.js` | `webview/assets/cloud-environments-settings-page-b4df36cc3786.js`<br>`bab03be7912e07e3312edd6936f09e9119f7ca13be1df9be65b69754086c3615`<br>offset 244269419 | `webview/assets/cloud-environments-settings-page-71f1c9be22b0.js`<br>`2666eaf37308cf37fba8d264f653ac6c0567ec1db90a3db09e9512018ef707b8`<br>offset 244504964 |

所有上述名称候选的跨样本 SHA 均不同。Mac 与 Linux `webview/index.html` 各自直接引用的入口完整列表见下方[全量对照](#全量证据与复验)的 `left.metadata.webview_entry_assets` 和 `right.metadata.webview_entry_assets`。

## 全量证据与复验

证据位于被 Git 忽略的本地运行目录，目录权限 `0700`、文件权限 `0600`；第三方安装包及成员不提交到 Git，索引和对照不含源码正文。原始脚本、索引和对照结果已复制并核对文件 SHA。运行目录是本机研究材料，清理该目录后链接将失效。

| 文件 | 内容 | SHA-256 |
| --- | --- | --- |
| [comparison.json](../../../.dev-runtime/chatgpt-linux-audit-20261103-7jyjn55e/evidence/package-comparison/comparison.json) | 两侧相同路径、未找到同路径的路径、唯一候选、歧义键及分类；文件内的 left 为 Mac，right 为 Linux | `ca3be6bb00c9eef1e14e2865db1b0a85c4a3e98889ba8a8fe4af5ad810c4aa96` |
| [mac-index.json](../../../.dev-runtime/chatgpt-linux-audit-20261103-7jyjn55e/evidence/package-comparison/mac-index.json) | 22,534 个 Mac 成员的路径、大小、实际和声明摘要、可用时的 ASAR 绝对偏移 | `2f077a0a39bf26cd0a60dcf2efb904917028531fa95f15e4367460327b36abdd` |
| [linux-index.json](../../../.dev-runtime/chatgpt-linux-audit-20261103-7jyjn55e/evidence/package-comparison/linux-index.json) | 22,586 个 Linux 成员的对应索引 | `47a60f3c808a1f89a65b63a91be7aa67f234348021380a062cc377bf6d4bb090` |
| [summary.md](../../../.dev-runtime/chatgpt-linux-audit-20261103-7jyjn55e/evidence/package-comparison/summary.md) | 自动生成的归类摘要；每类示例仅是前几条，完整列表以 JSON 为准 | `afa086daddb2bc77040e4217db8d9ffff92311f196d4d2c2551a8a4bbe791752` |
| [unpacked-integrity.json](../../../.dev-runtime/chatgpt-linux-audit-20261103-7jyjn55e/evidence/package-comparison/unpacked-integrity.json) | Mac 全部 16 个 unpacked 文件的大小和摘要核对 | `d24fb9cedd7e43e38a45bb7acaa7fb8ea0b0b575d3c89c4a44bffad2af4901f8` |
| [compare_asar.py](../../../.dev-runtime/chatgpt-linux-audit-20261103-7jyjn55e/evidence/package-comparison/compare_asar.py) / [test_compare_asar.py](../../../.dev-runtime/chatgpt-linux-audit-20261103-7jyjn55e/evidence/package-comparison/test_compare_asar.py) | 只读索引、对比脚本和合成夹具测试 | `342836b81f6e19c3a8f8e6dc2af86d1784b80be7f48a1a4652466e0a60d769db` / `2880b2ef8ad727d3d383b3b194fbc1f06c643cb04c2da16c2f641bf4d2359c52` |
| [SHA256SUMS](../../../.dev-runtime/chatgpt-linux-audit-20261103-7jyjn55e/evidence/package-comparison/SHA256SUMS) | 上述所有文件的摘要清单 | — |

在仓库根目录验证已复制证据和脚本测试：

```bash
(
  cd .dev-runtime/chatgpt-linux-audit-20261103-7jyjn55e/evidence/package-comparison
  sha256sum --check SHA256SUMS
  PYTHONDONTWRITEBYTECODE=1 python3 -m unittest -v test_compare_asar
)
```

合成夹具测试覆盖精确路径及名称候选、多义名称、路径遍历拒绝、不覆盖现有结果，以及 unpacked 差异记录。这些测试只检查分析脚本的边界，不替代对真实产品功能、登录、云能力或 Mac 原生 UI 的验收。

如需重算，应保留两份 ASAR 及其各自 `.asar.unpacked`，从仓库根目录执行以下命令。脚本会将结果写到新建的临时目录，不覆盖原始文件与证据清单：

```bash
AUDIT_EVIDENCE="$PWD/.dev-runtime/chatgpt-linux-audit-20261103-7jyjn55e/evidence/package-comparison"
AUDIT_OUTPUT="$(mktemp -d)"
python3 "$AUDIT_EVIDENCE/compare_asar.py" index \
  --asar "$PWD/third_party/ChatGPT.app/Contents/Resources/app.asar" \
  --bundle-info "$PWD/third_party/ChatGPT.app/Contents/Info.plist" \
  --output "$AUDIT_OUTPUT/mac-index.json"
python3 "$AUDIT_EVIDENCE/compare_asar.py" index \
  --asar "$PWD/.dev-runtime/chatgpt-linux-audit-20261103-7jyjn55e/extracted/usr/lib/chatgpt/resources/app.asar" \
  --output "$AUDIT_OUTPUT/linux-index.json"
python3 "$AUDIT_EVIDENCE/compare_asar.py" compare \
  --left-index "$AUDIT_OUTPUT/mac-index.json" \
  --right-index "$AUDIT_OUTPUT/linux-index.json" \
  --output-dir "$AUDIT_OUTPUT/comparison"
```

重算结果包含本次执行时间和源文件状态字段，因此整个 JSON 文件的 SHA 不必与已保存索引一致；应逐项核对样本 SHA、成员路径、实际摘要和统计。2026-11-03 按上述命令重新索引两份样本，样本 SHA、成员统计，以及全部精确路径、未配对路径、名称候选、歧义键和分类对照均与已保存证据一致；`SHA256SUMS` 逐项通过，5 项合成夹具测试通过。
