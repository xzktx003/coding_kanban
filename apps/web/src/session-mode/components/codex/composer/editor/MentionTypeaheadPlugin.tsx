import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  LexicalTypeaheadMenuPlugin,
  MenuOption,
  useBasicTypeaheadTriggerMatch,
} from "@lexical/react/LexicalTypeaheadMenuPlugin";
import {
  $createTextNode,
  COMMAND_PRIORITY_CRITICAL,
  type TextNode,
} from "lexical";
import { useCallback, useMemo, useState } from "react";
import { Blocks, BookOpen } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ComposerSuggestionPopover } from "../ComposerSuggestionPanel";
import { type MentionItem, matchesMention } from "../mentions";
import { $createMentionChipNode } from "./MentionChipNode";
import { pluginInputDrafts } from "@session/features/plugins/pluginInputs";
import { sessionPortalContainer } from "@session/session-dom";

class MentionOption extends MenuOption {
  item: MentionItem;

  constructor(item: MentionItem) {
    super(item.key);
    this.item = item;
  }
}

/** `$` typeahead that inserts an atomic mention chip. */
export function MentionTypeaheadPlugin({
  items,
  trigger = "$",
  owner,
}: {
  items: MentionItem[];
  trigger?: "@" | "$";
  owner?: string;
}) {
  const { t } = useTranslation("thread");
  const [editor] = useLexicalComposerContext();
  const [query, setQuery] = useState<string | null>(null);

  const triggerFn = useBasicTypeaheadTriggerMatch(trigger, {
    minLength: 0,
    maxLength: 128,
    punctuation: "",
  });

  const options = useMemo(
    () =>
      items
        .filter((item) => matchesMention(item, query ?? ""))
        .map((i) => new MentionOption(i)),
    [items, query],
  );

  const onSelectOption = useCallback(
    (
      option: MentionOption,
      nodeToReplace: TextNode | null,
      closeMenu: () => void,
    ) => {
      editor.update(() => {
        if (owner && option.item.inputMention)
          pluginInputDrafts.add(owner, option.item.inputMention);
        const chip = $createMentionChipNode({
          insertText: option.item.insertText,
          displayName: option.item.displayName,
          iconSrc: option.item.iconSrc,
          brandColor: option.item.brandColor,
        });
        const space = $createTextNode(" ");
        if (nodeToReplace) {
          nodeToReplace.replace(chip);
        }
        chip.insertAfter(space);
        space.select();
        closeMenu();
      });
    },
    [editor, owner],
  );

  return (
    <LexicalTypeaheadMenuPlugin<MentionOption>
      parent={sessionPortalContainer() ?? undefined}
      anchorClassName="session-native-typeahead-anchor"
      onQueryChange={setQuery}
      onSelectOption={onSelectOption}
      triggerFn={triggerFn}
      options={options}
      commandPriority={COMMAND_PRIORITY_CRITICAL}
      menuRenderFn={(
        anchorElementRef,
        { selectedIndex, selectOptionAndCleanUp, setHighlightedIndex },
      ) => {
        if (!anchorElementRef.current || options.length === 0) {
          return null;
        }
        return (
          <ComposerSuggestionPopover
            anchor={
              editor
                .getRootElement()
                ?.closest<HTMLElement>("[data-composer-suggestion-anchor]") ??
              editor.getRootElement()?.parentElement ??
              null
            }
            kind="mentions"
            count={options.length}
          >
            {options.map((option, index) => (
              <button
                key={option.key}
                type="button"
                role="option"
                aria-selected={index === selectedIndex}
                ref={option.setRefElement}
                data-selected={index === selectedIndex}
                className="composer-suggestion-option"
                onMouseEnter={() => setHighlightedIndex(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => selectOptionAndCleanUp(option)}
              >
                <span className="composer-suggestion-icon" aria-hidden="true">
                  {option.item.iconSrc ? (
                    <img src={option.item.iconSrc} alt="" />
                  ) : option.item.kind === "plugin" ? (
                    <Blocks />
                  ) : (
                    <BookOpen />
                  )}
                </span>
                <span className="composer-suggestion-text">
                  <span className="composer-suggestion-name">
                    {option.item.displayName}
                  </span>
                  {option.item.description && (
                    <span
                      title={option.item.description}
                      className="composer-suggestion-description"
                    >
                      {option.item.description}
                    </span>
                  )}
                </span>
                <span className="composer-suggestion-tag">
                  {t(`suggestions.${option.item.kind}`)}
                </span>
              </button>
            ))}
          </ComposerSuggestionPopover>
        );
      }}
    />
  );
}
