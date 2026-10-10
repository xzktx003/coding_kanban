import type { ReactNode } from "react";
import { toast, type ExternalToast } from "sonner";
import "./components/plugin-touch.css";

type PluginNotice = {
  title?: ReactNode;
  description?: ReactNode;
  variant?: "default" | "destructive";
  id?: string | number;
};

export function pluginNotice({
  title,
  description,
  variant,
  id,
}: PluginNotice) {
  const compact =
    typeof window !== "undefined" &&
    window.matchMedia("(max-width: 767px), (pointer: coarse)").matches;
  const options: ExternalToast = {
    description,
    className: "session-plugin-notice",
    position: compact ? "bottom-center" : "top-right",
    ...(id === undefined ? {} : { id }),
  };
  const notify = variant === "destructive" ? toast.error : toast;
  const noticeId = notify(title, options);
  return { id: noticeId, dismiss: () => toast.dismiss(noticeId) };
}
