import type { Model } from "@session/bindings/v2";
import { useThreadModelSettings } from "@session/hooks/useThreadModelSettings";
import {
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@session/components/ui/dropdown-menu";
import { NativeComposerIcon } from "./NativeComposerIcon";

/** Main e9i Fast toggle is shown only when the real model catalog enables it. */
export function NativeServiceTierControl({
  model,
  threadId,
}: {
  model?: Model;
  threadId: string | null;
}) {
  const { serviceTier, setServiceTier } = useThreadModelSettings(threadId);
  const tiers = model?.serviceTiers ?? [];
  if (!tiers.length) return null;
  const fast = tiers.find((tier) => tier.id === "fast");
  if (fast && tiers.length === 1)
    return (
      <DropdownMenuItem
        className="session-native-service-tier"
        role="menuitemcheckbox"
        aria-checked={serviceTier === fast.id}
        aria-label={serviceTier === fast.id ? "启用标准模式" : "启用快速模式"}
        title={fast.description}
        onSelect={(event) => {
          event.preventDefault();
          setServiceTier(serviceTier === fast.id ? null : fast.id);
        }}
      >
        <span>
          <NativeComposerIcon
            name={serviceTier === fast.id ? "boltFill" : "bolt"}
          />
        </span>
      </DropdownMenuItem>
    );
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger
        className="session-native-service-tier"
        aria-label="服务等级"
        title={
          tiers.find((tier) => tier.id === serviceTier)?.description ??
          "标准模式"
        }
      >
        <NativeComposerIcon name={serviceTier ? "boltFill" : "bolt"} />
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="session-native-tier-menu">
        <DropdownMenuItem
          role="menuitemradio"
          aria-checked={!serviceTier}
          onSelect={(event) => {
            event.preventDefault();
            setServiceTier(null);
          }}
        >
          标准模式{!serviceTier && <NativeComposerIcon name="check" />}
        </DropdownMenuItem>
        {tiers.map((tier) => (
          <DropdownMenuItem
            key={tier.id}
            role="menuitemradio"
            aria-checked={serviceTier === tier.id}
            title={tier.description}
            onSelect={(event) => {
              event.preventDefault();
              setServiceTier(tier.id);
            }}
          >
            {tier.name}
            {serviceTier === tier.id && <NativeComposerIcon name="check" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
