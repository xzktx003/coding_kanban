import { useFollowupSettingsStore } from "@session/stores/useFollowupSettingsStore";

/** The three enabled main-editor variants in VSIX 26.51002.51308. */
export function ComposerEnterSettings() {
  const { enterBehavior, setEnterBehavior } = useFollowupSettingsStore();
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
    </fieldset>
  );
}
