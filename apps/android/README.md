# Coding Kanban 安卓客户端

React Native / Expo SDK 57，局域网访问 Coding Kanban 后端的手机端工作台。

- 技术栈：React Native 0.86.3、Expo SDK 57、React 19、`react-native-webview`（xterm 终端）、`react-native-sse`（会话事件流）、`zustand`、`@react-navigation/*`。
- 复用 `@agent-orchestrator/shared` 类型与既有 `/api/*` 接口。
- 功能：服务器连接配置、终端模式（看板 / 活动 / 当前会话 / 项目文件）、真实终端（xterm.js）、会话模式对话（线程、聊天、SSE、中断）、文件浏览与图片/文本预览、中英文 i18n、深色主题。
- 完整说明（架构、协议、运行/构建、验证、边界）见 `docs/android-client.md`。

## 开发

```bash
pnpm install --store-dir <工作区>/.pnpm-store --config.confirmModulesPurge=false

cd apps/android
pnpm --filter @agent-orchestrator/android run typecheck
pnpm --filter @agent-orchestrator/android run test
npx expo prebuild --platform android   # 生成原生工程（一次即可）
```

## 构建 APK（需本机 JDK17 + Android SDK）

```bash
export JAVA_HOME=$PWD/.toolchain/jdk-17.0.21+9
export ANDROID_HOME=$PWD/.toolchain/android-sdk
export ANDROID_USER_HOME=$PWD/.toolchain/android-user-home
export GRADLE_USER_HOME=$PWD/.toolchain/gradle-home
./android/gradlew -p android app:assembleDebug
```

产物：`dist/coding-kanban-debug.apk`（可安装到真机）。
