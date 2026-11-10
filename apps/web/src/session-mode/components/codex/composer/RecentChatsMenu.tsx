import { useEffect, useMemo, useRef, useState } from "react";
import { codexService } from "@session/services/codexService";
import { useCodexStore } from "@session/components/codex/stores/useCodexStore";

export function RecentChatsMenu() {
  const threads = useCodexStore((state) => state.threads);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return threads.filter((thread) => !thread.parentThreadId && (!needle || thread.preview.toLocaleLowerCase().includes(needle))).slice(0, 20);
  }, [query, threads]);
  const close = () => {
    setQuery("");
    setOpen(false);
  };
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) {
        setQuery("");
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setQuery("");
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);
  return (
    <div ref={root} className="session-recent-chats">
      <button ref={trigger} type="button" aria-label="最近聊天" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        最近聊天
      </button>
      {open && (
        <div role="menu" aria-label="搜索最近聊天" className="session-recent-chats-menu">
          <input aria-label="搜索最近聊天" value={query} placeholder="搜索最近聊天" onChange={(event) => setQuery(event.target.value)} />
          {visible.length === 0 ? <p>{query.trim() ? "还没有匹配的聊天" : "还没有聊天"}</p> : visible.map((thread) => (
            <button key={thread.id} type="button" onClick={() => { close(); void codexService.setCurrentThread(thread.id); }}>{thread.preview || "新聊天"}</button>
          ))}
        </div>
      )}
    </div>
  );
}
