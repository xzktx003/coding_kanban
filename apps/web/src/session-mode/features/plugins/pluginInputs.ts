import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  validNativeInputMention,
  type NativeInputMention,
} from "@agent-orchestrator/shared";
import type { PluginSummary } from "@session/bindings/v2/PluginSummary";
export function pluginInputMention(
  plugin: Pick<PluginSummary, "id" | "name" | "interface">,
): NativeInputMention | null {
  const mention = {
    name: plugin.interface?.displayName?.trim() || plugin.name.split("@")[0],
    path: `plugin://${plugin.id}`,
  };
  return validNativeInputMention(mention) ? Object.freeze(mention) : null;
}
export const usePluginInputDrafts = create<{
  drafts: Record<string, NativeInputMention[]>;
}>()(
  persist(() => ({ drafts: {} }), {
    name: "kanban.session.plugin-inputs",
    version: 1,
  }),
);
const mentionsInText = (
  text: string,
  mentions: readonly NativeInputMention[],
) =>
  mentions.filter((mention) => {
    const token = "@" + mention.name;
    let at = text.indexOf(token);
    while (at >= 0) {
      const before = text[at - 1],
        after = text[at + token.length];
      if (
        (!before || /\s/.test(before)) &&
        (!after || /\s|[.,!?;:，。！？；：]/.test(after))
      )
        return true;
      at = text.indexOf(token, at + token.length);
    }
    return false;
  });
export const pluginInputDrafts = {
  read: (owner: string, text?: string) => {
    const raw = usePluginInputDrafts.getState().drafts[owner],
      mentions = Array.isArray(raw)
        ? raw.filter(
            (mention) =>
              validNativeInputMention(mention) &&
              mention.path.startsWith("plugin://"),
          )
        : [];
    return text === undefined ? mentions : mentionsInText(text, mentions);
  },
  add: (owner: string, mention: NativeInputMention) => {
    if (
      !owner ||
      !mention.path.startsWith("plugin://") ||
      !validNativeInputMention(mention)
    )
      return;
    const captured = Object.freeze({ ...mention });
    usePluginInputDrafts.setState((state) => ({
      drafts: {
        ...state.drafts,
        [owner]: [
          ...(state.drafts[owner] ?? []).filter(
            (item) => item.path !== captured.path,
          ),
          captured,
        ],
      },
    }));
  },
  clear: (owner: string, sent: readonly NativeInputMention[]) =>
    usePluginInputDrafts.setState((state) => ({
      drafts: {
        ...state.drafts,
        [owner]: (state.drafts[owner] ?? []).filter(
          (item) => !sent.includes(item),
        ),
      },
    })),
  move: (from: string, to: string) => {
    if (from === to) return;
    const entries = pluginInputDrafts.read(from);
    if (!entries.length) return;
    usePluginInputDrafts.setState((state) => ({
      drafts: {
        ...state.drafts,
        [from]: [],
        [to]: [
          ...(state.drafts[to] ?? []).filter(
            (item) => !entries.some((entry) => entry.path === item.path),
          ),
          ...entries,
        ],
      },
    }));
  },
  prune: (owner: string, text: string) => {
    const before = pluginInputDrafts.read(owner),
      after = mentionsInText(text, before);
    if (before.length !== after.length)
      pluginInputDrafts.clear(
        owner,
        before.filter((item) => !after.includes(item)),
      );
  },
};
export const usePluginCapabilityRevision = create<{ revision: number }>(() => ({
  revision: 0,
}));
export function invalidatePluginCapabilities() {
  usePluginCapabilityRevision.setState((state) => ({
    revision: state.revision + 1,
  }));
}
