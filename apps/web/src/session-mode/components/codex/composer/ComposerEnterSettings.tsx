import { useFollowupSettingsStore } from "@session/stores/useFollowupSettingsStore";

/** The three enabled main-editor variants in VSIX 26.51002.51308. */
export function ComposerEnterSettings() {
  const {
    enterBehavior,
    setEnterBehavior,
    persistenceError,
    retryPersistence,
  } = useFollowupSettingsStore();
  return (
    <fieldset
      className="session-native-enter-settings"
      aria-label="Enter 发送设置"
    >
      <legend>Enter 发送设置</legend>
      {(
        [
          ["enter", "Enter 发送，Shift Enter 换行"],
          ["cmdIfMultiline", "多行时使用 Ctrl/⌘ Enter 发送"],
          ["cmdAlways", "始终使用 Ctrl/⌘ Enter 发送"],
        ] as const
      ).map(([value, label]) => (
        <label key={value}>
          <input
            type="radio"
            name="composer-enter-behavior"
            checked={enterBehavior === value}
            onChange={() => setEnterBehavior(value)}
          />
          <span>{label}</span>
        </label>
      ))}
      <p>运行中 Ctrl/⌘ Shift Enter 临时切换排队与引导。</p>
      {persistenceError && (
        <div role="alert">
          <p>
            {persistenceError}。当前页面继续使用所选偏好；关闭前请重试保存。
          </p>
          <button type="button" onClick={retryPersistence}>
            重试保存偏好
          </button>
        </div>
      )}
    </fieldset>
  );
}
