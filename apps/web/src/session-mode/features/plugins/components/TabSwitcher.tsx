import { Package2 } from "lucide-react";
import { MCP } from "@session/components/icons";
import { Button } from "@session/components/ui/button";

export function TabSwitcher<T extends string>({
  tabs,
  active,
  onChange,
  showLabel = true,
}: {
  tabs: readonly T[];
  active: T;
  onChange: (tab: T) => void;
  showLabel?: boolean;
}) {
  return (
    <div className="flex items-center gap-0.5 rounded-lg bg-muted/50 p-0.5">
      {tabs.map((t) => (
        <Button
          key={t}
          aria-label={t}
          title={t}
          variant="ghost"
          size="sm"
          onClick={() => onChange(t)}
          className={`session-plugin-touch-target h-7 ${active === t ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"}`}
        >
          {t.startsWith("Connector") ? (
            <MCP className="h-3.5 w-3.5" />
          ) : (
            <Package2 className="h-4 w-4" />
          )}
          {showLabel && ` ${t}`}
        </Button>
      ))}
    </div>
  );
}
