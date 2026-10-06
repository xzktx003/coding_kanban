import { Button } from '@session/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@session/components/ui/dialog';
import { Input } from '@session/components/ui/input';

interface RenameThreadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  renameValue: string;
  setRenameValue: (value: string) => void;
  handleRenameSubmit: () => Promise<void>;
}

export function RenameThreadDialog({
  open,
  onOpenChange,
  renameValue,
  setRenameValue,
  handleRenameSubmit,
}: RenameThreadDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename thread</DialogTitle>
        </DialogHeader>
        <Input
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          placeholder="Thread name"
          autoFocus
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleRenameSubmit}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
