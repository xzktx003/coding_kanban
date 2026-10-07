import { Pencil } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { RenameThreadDialog } from "../codex/thread/RenameThreadDialog";
import { renameSession } from "../../services/sessionNames";
import {
  type SessionKind,
  useSessionName,
} from "../../stores/useSessionNameStore";

export function RenameSessionButton({
  kind,
  id,
  title,
  className = "",
}: {
  kind: SessionKind;
  id: string;
  title: string;
  className?: string;
}) {
  const { t } = useTranslation("thread");
  const name = useSessionName(kind, id, title);
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(name);
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const [error, setError] = useState<string>();
  const save = async () => {
    if (busy.current || !value.trim()) return;
    busy.current = true;
    setSaving(true);
    setError(undefined);
    try {
      await renameSession(kind, id, value);
      setOpen(false);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      busy.current = false;
      setSaving(false);
    }
  };
  return (
    <>
      <button
        type="button"
        className={`inline-flex shrink-0 items-center justify-center size-6 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring ${className}`}
        onKeyDown={(event) => event.stopPropagation()}
        aria-label={t("rename.action")}
        title={t("rename.action")}
        onClick={(event) => {
          event.stopPropagation();
          setValue(name);
          setError(undefined);
          setOpen(true);
        }}
      >
        <Pencil className="size-3.5" />
      </button>
      <RenameThreadDialog
        open={open}
        onOpenChange={(value) => {
          if (!busy.current) setOpen(value);
        }}
        renameValue={value}
        setRenameValue={setValue}
        handleRenameSubmit={save}
        saving={saving}
        error={error}
      />
    </>
  );
}
