import { pickBrowserFiles, uploadBrowserFile } from "@session/browser-dialog";
import { Image as ImageIcon, Plus } from "lucide-react";
import { useState } from "react";
import { SelectFilesMenuItem } from "@session/components/codex/composer/ComposerMenu";
import { Button } from "@session/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@session/components/ui/popover";
import { cn } from "@session/lib/utils";
import { useInputStore } from "@session/stores/useInputStore";

interface CCAttachmentButtonProps {
  onImageFilesSelected?: (files: File[]) => void;
  onImagesSelected?: (paths: string[]) => void;
  onFilesSelected?: (paths: string[]) => void;
}

export function CCAttachmentButton({
  onImageFilesSelected,
  onImagesSelected,
  onFilesSelected,
}: CCAttachmentButtonProps) {
  const [openState, setOpen] = useState(false);
  const { appendFileLinks } = useInputStore();

  const handleSelectFiles = (paths: string[]) => {
    try {
      (onFilesSelected ?? appendFileLinks)(paths);
      setOpen(false);
    } catch (error) {
      console.error("Failed to select files:", error);
    }
  };

  const handleSelectImages = async () => {
    try {
      const selected = await pickBrowserFiles({
        multiple: true,
        accept: "image/*",
        filters: [
          {
            name: "Images",
            extensions: ["jpg", "jpeg", "png", "gif", "webp"],
          },
        ],
      });
      if (selected) {
        if (onImageFilesSelected) onImageFilesSelected(selected);
        else
          onImagesSelected?.(
            await Promise.all(selected.map(uploadBrowserFile)),
          );
        setOpen(false);
      }
    } catch (error) {
      console.error("Failed to select images:", error);
    }
  };

  return (
    <Popover open={openState} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8 text-muted-foreground hover:text-foreground"
          title="添加附件与上下文"
          aria-label="添加附件与上下文"
        >
          <Plus className={`h-4 w-4 ${openState ? "text-primary" : ""}`} />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" side="top" className="w-44 p-1">
        <div className="flex flex-col gap-1">
          <Button
            variant="ghost"
            className={cn(
              "min-h-11 justify-start gap-2 px-2 h-8 w-full text-xs hover:bg-accent hover:text-accent-foreground transition-colors",
            )}
            onClick={handleSelectImages}
          >
            <ImageIcon className="w-4 h-4" />
            <span>上传图片</span>
          </Button>
          <SelectFilesMenuItem
            onFilesSelected={handleSelectFiles}
            onAfterSelect={() => setOpen(false)}
            className="h-8 w-full text-xs"
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}
