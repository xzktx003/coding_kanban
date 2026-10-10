import { useCallback, useEffect, useRef, useState } from "react";
import type { NativeInputMention } from "@agent-orchestrator/shared";
import {
  pluginInputMention,
  usePluginCapabilityRevision,
} from "@session/features/plugins/pluginInputs";
import type { PluginSummary, SkillMetadata } from "@session/bindings/v2";
import { fileSrc } from "@session/hooks/runtime";
import { pluginInstalled } from "@session/services";
import { codexService } from "@session/services/codexService";
import { useWorkspaceStore } from "@session/stores/useWorkspaceStore";

/**
 * Installed capability entry. Enabled VSIX plugins use @DisplayName together
 * with plugin://identity; skills retain their existing $name token.
 */
export interface MentionItem {
  /** Stable key: `plugin:<name>` or `skill:<path>`. */
  key: string;
  kind: "plugin" | "skill";
  /** Label rendered in the popup and inside the composer chip. */
  displayName: string;
  description: string | null;
  /** Visible token; inputMention preserves the native identity on submit. */
  insertText: string;
  /** Lowercased terms the typeahead filters on. */
  searchTerms: string[];
  /** `[Plugin]` / `[Skill]`, matching the TUI category tags. */
  categoryTag: string;
  /** Plugins sort before skills, as in the TUI. */
  sortRank: number;
  /** Asset URL for the composer icon, when the plugin ships one. */
  iconSrc: string | null;
  brandColor: string | null;
  /** Starter prompts from the plugin manifest (max 3). */
  defaultPrompts: string[];
  inputMention?: NativeInputMention;
}

/** Plugin config names are `<name>@<marketplace>`; codex mentions use the left half. */
function pluginConfigName(plugin: PluginSummary): string {
  return plugin.name.split("@")[0] ?? plugin.name;
}

function pluginCapabilityDescription(plugin: PluginSummary): string | null {
  return (
    plugin.interface?.shortDescription ??
    plugin.interface?.longDescription ??
    null
  );
}

function pluginIconSrc(plugin: PluginSummary): string | null {
  const local = plugin.interface?.composerIcon;
  if (local) {
    return fileSrc(local);
  }
  return plugin.interface?.composerIconUrl ?? null;
}

function toPluginMention(plugin: PluginSummary): MentionItem | null {
  const inputMention = pluginInputMention(plugin);
  if (!inputMention) return null;
  const configName = pluginConfigName(plugin);
  const displayName = plugin.interface?.displayName ?? configName;
  const searchTerms = new Set([
    configName,
    plugin.name,
    displayName,
    ...plugin.keywords,
  ]);

  return {
    key: `plugin:${plugin.name}`,
    kind: "plugin",
    displayName,
    description: pluginCapabilityDescription(plugin),
    insertText: `@${inputMention.name}`,
    inputMention,
    searchTerms: [...searchTerms].map((term) => term.toLowerCase()),
    categoryTag: "[Plugin]",
    sortRank: 0,
    iconSrc: pluginIconSrc(plugin),
    brandColor: plugin.interface?.brandColor ?? null,
    defaultPrompts: plugin.interface?.defaultPrompt ?? [],
  };
}

function skillDisplayName(skill: SkillMetadata): string {
  return skill.interface?.displayName ?? skill.name;
}

function skillIconSrc(skill: SkillMetadata): string | null {
  const local = skill.interface?.iconSmall;
  if (local) {
    return fileSrc(local);
  }
  return skill.interface?.iconSmallUrl ?? null;
}

function toSkillMention(skill: SkillMetadata): MentionItem {
  const displayName = skillDisplayName(skill);
  const defaultPrompt = skill.interface?.defaultPrompt;

  return {
    key: `skill:${skill.path}`,
    kind: "skill",
    displayName,
    description:
      skill.interface?.shortDescription ??
      skill.shortDescription ??
      skill.description,
    insertText: `$${skill.name}`,
    searchTerms: [skill.name, displayName].map((term) => term.toLowerCase()),
    categoryTag: "[Skill]",
    sortRank: 1,
    iconSrc: skillIconSrc(skill),
    brandColor: skill.interface?.brandColor ?? null,
    defaultPrompts: defaultPrompt ? [defaultPrompt] : [],
  };
}

/** Filter used by the `$` typeahead. An empty query matches everything. */
export function matchesMention(item: MentionItem, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return true;
  }
  return item.searchTerms.some((term) => term.includes(needle));
}

/**
 * Installed plugins and skills for the current workspace, merged into one
 * mention list ordered plugins-first like the TUI popup.
 */
export function useMentionItems() {
  const cwd = useWorkspaceStore((state) => state.cwd);
  const revision = usePluginCapabilityRevision((state) => state.revision);
  const [snapshot, setSnapshot] = useState<{
    cwd: string | null;
    items: MentionItem[];
  }>({ cwd, items: [] });
  const requestVersion = useRef(0);

  const refresh = useCallback(async () => {
    const request = ++requestVersion.current;
    const cwds = cwd ? [cwd] : [];

    const [pluginResult, skillResult] = await Promise.allSettled([
      pluginInstalled({ cwds }),
      codexService.listSkills(cwd),
    ]);
    if (request !== requestVersion.current) return;

    const mentions: MentionItem[] = [];

    if (pluginResult.status === "fulfilled") {
      const seen = new Set<string>();
      for (const marketplace of pluginResult.value.marketplaces) {
        for (const plugin of marketplace.plugins) {
          if (!plugin.installed || !plugin.enabled || seen.has(plugin.name)) {
            continue;
          }
          seen.add(plugin.name);
          const mention = toPluginMention(plugin);
          if (mention) mentions.push(mention);
        }
      }
    } else {
      console.error("Failed to list installed plugins:", pluginResult.reason);
    }

    if (skillResult.status === "fulfilled") {
      for (const entry of skillResult.value) {
        for (const skill of entry.skills) {
          if (skill.enabled) {
            mentions.push(toSkillMention(skill));
          }
        }
      }
    } else {
      console.error("Failed to list skills:", skillResult.reason);
    }

    mentions.sort(
      (a, b) =>
        a.sortRank - b.sortRank || a.displayName.localeCompare(b.displayName),
    );
    setSnapshot({ cwd, items: mentions });
  }, [cwd]);

  useEffect(() => {
    void refresh();
    return () => {
      requestVersion.current++;
    };
  }, [refresh, revision]);

  return { items: snapshot.cwd === cwd ? snapshot.items : [], refresh };
}

/** Entries that ship an icon, for the composer plus menu. */
export function mentionsWithIcon(items: MentionItem[]): MentionItem[] {
  return items.filter((item) => item.iconSrc);
}
