import { useEffect, useState } from "react";
import { toast } from "sonner";
import { isPhone } from "../hooks/runtime";
import { readWithDeadline } from "../services/sessionReadQueue";
import { loadRemoteSettings, loadSettings } from "./settings";

const noticeId = "session-display-name-sync";

/** Display names hydrate independently of the mounted conversation and composer. */
export function useSessionSettings() {
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void readWithDeadline(
      async (signal) => {
        if (isPhone() && (await loadRemoteSettings(signal))) return;
        await loadSettings(signal);
      },
      10_000,
      controller.signal,
    )
      .then(() => {
        if (!controller.signal.aborted) toast.dismiss(noticeId);
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        toast.warning("会话名称暂未同步，已保留本机名称", {
          id: noticeId,
          action: {
            label: "重试",
            onClick: () => setAttempt((value) => value + 1),
          },
        });
      });
    return () => {
      controller.abort();
      toast.dismiss(noticeId);
    };
  }, [attempt]);
}
