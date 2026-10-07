import { useId } from "react";
import { useTranslation } from "react-i18next";
import { SESSION_NAME_LIMIT } from "../../../stores/useSessionNameStore";
import { Button } from "@session/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@session/components/ui/dialog";
import { Input } from "@session/components/ui/input";

interface RenameThreadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  renameValue: string;
  setRenameValue: (value: string) => void;
  handleRenameSubmit: () => Promise<void>;
  saving?: boolean;
  error?: string;
}

export function RenameThreadDialog({
  open,
  onOpenChange,
  renameValue,
  setRenameValue,
  handleRenameSubmit,
  saving = false,
  error,
}: RenameThreadDialogProps) {
  const { t } = useTranslation("thread");
  const inputId = useId();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-sm"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <DialogHeader>
          <DialogTitle>{t("rename.action")}</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!saving && renameValue.trim()) void handleRenameSubmit();
          }}
          className="space-y-4"
        >
          <div className="space-y-2">
            <label className="text-sm text-muted-foreground" htmlFor={inputId}>
              {t("rename.label")}
            </label>
            <Input
              id={inputId}
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              maxLength={SESSION_NAME_LIMIT}
              disabled={saving}
              autoFocus
              autoComplete="off"
            />
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={saving}
              onClick={() => onOpenChange(false)}
            >
              {t("rename.cancel")}
            </Button>
            <Button type="submit" disabled={saving || !renameValue.trim()}>
              {t(saving ? "rename.saving" : "rename.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
