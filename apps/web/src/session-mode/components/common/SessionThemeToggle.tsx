import { Moon, Sun } from "lucide-react";
import { useSyncExternalStore } from "react";
import { useThemeStore } from "../../stores/settings/useThemeStore";
import { DropdownMenuItem } from "../ui/dropdown-menu";
const subscribe = (notify: () => void) => {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", notify);
  return () => media.removeEventListener("change", notify);
};
const getSystemDark = () =>
  window.matchMedia("(prefers-color-scheme: dark)").matches;
function useThemeControl() {
  const theme = useThemeStore((s) => s.theme);
  const toggle = useThemeStore((s) => s.toggleTheme);
  const systemDark = useSyncExternalStore(subscribe, getSystemDark, () => true);
  const dark = theme === "system" ? systemDark : theme === "dark";
  const label = dark ? "切换为浅色模式" : "切换为深色模式";
  return { dark, label, toggle };
}
export function SessionThemeToggle() {
  const { dark, label, toggle } = useThemeControl();
  return (
    <button
      type="button"
      className="session-top-icon session-theme-toggle"
      aria-label={label}
      title={label}
      onClick={toggle}
    >
      {dark ? (
        <Sun size={17} aria-hidden="true" />
      ) : (
        <Moon size={17} aria-hidden="true" />
      )}
    </button>
  );
}
export function SessionThemeMenuItem() {
  const { dark, label, toggle } = useThemeControl();
  return (
    <DropdownMenuItem onSelect={toggle}>
      {dark ? <Sun size={17} /> : <Moon size={17} />} {label}
    </DropdownMenuItem>
  );
}
