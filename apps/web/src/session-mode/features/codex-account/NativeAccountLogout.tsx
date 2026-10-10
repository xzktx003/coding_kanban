import { useEffect, useRef, useState } from "react";
import { LogOut } from "lucide-react";
import { useCodexStore } from "@session/components/codex/stores";
import { Button } from "@session/components/ui/button";
import {
  accountRuntime,
  beginConfirmedAccountEra,
  checkLogout,
  mutateAccount,
  publicAccount,
  samePublicAccount,
  type AccountRuntime,
  type AccountMutationRequest,
} from "./account-mutations";
export function NativeAccountLogout({
  open,
  onLoggedOut,
}: {
  open: boolean;
  onLoggedOut?: () => void;
}) {
  const account = useCodexStore((state) => state.account);
  const [owner, setOwner] = useState<AccountRuntime | null>(null);
  const [phase, setPhase] = useState<"idle" | "sending" | "uncertain">("idle");
  const [error, setError] = useState<string | null>(null);
  const request = useRef<
    (AccountMutationRequest & { operation: "logout" }) | null
  >(null);
  const lifecycle = useRef({ active: false, epoch: 0 });
  useEffect(() => {
    lifecycle.current.active = true;
    const invalidate = () => {
      lifecycle.current.epoch++;
      setOwner(null);
    };
    window.addEventListener("session-runtime-restarted", invalidate);
    return () => {
      lifecycle.current.active = false;
      lifecycle.current.epoch++;
      window.removeEventListener("session-runtime-restarted", invalidate);
    };
  }, []);
  useEffect(() => {
    let active = true;
    setOwner(null);
    if (open && account)
      void accountRuntime()
        .then((runtime) => {
          if (active && runtime.supportsMutations) setOwner(runtime);
        })
        .catch(() => {});
    return () => {
      active = false;
    };
  }, [open, account]);
  useEffect(() => {
    // An authoritative new account observation opens a new era for confirmed
    // prior logouts; pending/ambiguous receipts are deliberately retained.
    if (account) beginConfirmedAccountEra();
  }, [account]);
  function finish(captured: AccountMutationRequest & { operation: "logout" }) {
    const current = useCodexStore.getState().account;
    if (
      !lifecycle.current.active ||
      (current !== null &&
        !samePublicAccount(current, captured.expectedAccount))
    )
      return false;
    onLoggedOut?.();
    useCodexStore.getState().setAccount(null);
    return true;
  }
  async function logout() {
    if (!owner || !account || phase !== "idle") return;
    const expectedAccount = publicAccount(account),
      epoch = lifecycle.current.epoch;
    const captured: AccountMutationRequest & { operation: "logout" } = {
      operation: "logout",
      owner,
      expectedAccount,
      isCurrent: () =>
        lifecycle.current.active &&
        lifecycle.current.epoch === epoch &&
        samePublicAccount(useCodexStore.getState().account, expectedAccount),
    };
    request.current = captured;
    setPhase("sending");
    setError(null);
    const result = await mutateAccount(captured);
    if (!lifecycle.current.active) return;
    if (result.status === "complete" && finish(captured)) return;
    setPhase(
      result.status === "uncertain" || result.status === "complete"
        ? "uncertain"
        : "idle",
    );
    setError(
      result.error ?? "无法确认操作结果，请检查当前状态；不会重复发送。",
    );
  }
  async function check() {
    const captured = request.current;
    if (!captured || phase !== "uncertain") return;
    setPhase("sending");
    const result = await checkLogout(captured);
    if (!lifecycle.current.active) return;
    if (result.status === "complete" && finish(captured)) return;
    setPhase("uncertain");
    setError(
      result.error ?? "无法确认操作结果，请检查当前状态；不会重复发送。",
    );
  }
  if (!owner || !account) return null;
  return (
    <div className="space-y-1">
      <Button
        variant="ghost"
        className="w-full justify-start gap-2 max-sm:h-11"
        disabled={phase !== "idle"}
        onClick={() => void logout()}
      >
        <LogOut className="h-4 w-4" />
        退出当前 Codex 账户
      </Button>
      {error && (
        <p role="status" className="px-2 py-1 text-xs text-destructive">
          {error}
        </p>
      )}
      {phase === "uncertain" && (
        <Button
          variant="ghost"
          className="w-full justify-start max-sm:h-11"
          onClick={() => void check()}
        >
          检查退出状态
        </Button>
      )}
    </div>
  );
}
