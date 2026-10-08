import { Ellipsis, Pencil } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { RenameThreadDialog } from "../codex/thread/RenameThreadDialog";
import { renameSession } from "../../services/sessionNames";
import type { SessionKind } from "../../stores/useSessionNameStore";

/** Keep the rename dialog mounted after the transient menu closes. */
export function SessionRowMenu({
  children,
  rename,
}: {
  children: ReactNode;
  rename?: { kind: SessionKind; id: string; title: string };
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const [renaming, setRenaming] = useState(false);
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const [error, setError] = useState<string>();
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            ref={trigger}
            type="button"
            className="session-row-menu"
            aria-label="会话操作"
            title="会话操作"
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <Ellipsis size={15} aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          onCloseAutoFocus={(e) => {
            if (renaming) e.preventDefault();
          }}
        >
          {rename && (
            <DropdownMenuItem
              onSelect={() => {
                setValue(rename.title);
                setError(undefined);
                setRenaming(true);
              }}
            >
              <Pencil size={14} />
              重命名
            </DropdownMenuItem>
          )}
          {children}
        </DropdownMenuContent>
      </DropdownMenu>
      {rename && (
        <RenameThreadDialog
          open={renaming}
          onOpenChange={(open) => {
            if (busy.current) return;
            setRenaming(open);
            if (!open) requestAnimationFrame(() => trigger.current?.focus());
          }}
          renameValue={value}
          setRenameValue={setValue}
          saving={saving}
          error={error}
          handleRenameSubmit={async () => {
            if (busy.current || !value.trim()) return;
            busy.current = true;
            setSaving(true);
            setError(undefined);
            try {
              await renameSession(rename.kind, rename.id, value.trim());
              setRenaming(false);
              requestAnimationFrame(() => trigger.current?.focus());
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            } finally {
              busy.current = false;
              setSaving(false);
            }
          }}
        />
      )}
    </>
  );
}
