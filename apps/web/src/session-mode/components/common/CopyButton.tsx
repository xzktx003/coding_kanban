import { Check, Copy } from 'lucide-react';
import { Button } from '@session/components/ui/button';
import { useNativeCopyFeedback } from '../codex/presentation/useNativeCopyFeedback';

type CopyButtonProps = {
  text: string;
  className?: string;
};

export const CopyButton = ({ text, className }: CopyButtonProps) => {
  const { copied, copyPending, copy } = useNativeCopyFeedback([text], {
    feedbackMs: 2000,
  });

  const handleCopy = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (!text.length) return;
    // Blur immediately so the button doesn't hold focus and keep the parent
    // group in a hover-like visible state after the mouse leaves.
    (e.currentTarget as HTMLButtonElement).blur();
    copy(text);
  };

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={handleCopy}
      disabled={!text.length || copyPending || copied}
      aria-busy={copyPending || undefined}
      aria-label={copied ? 'Copied' : 'Copy'}
      className={className ?? 'h-6 w-6 text-muted-foreground'}
    >
      {copied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
    </Button>
  );
};
