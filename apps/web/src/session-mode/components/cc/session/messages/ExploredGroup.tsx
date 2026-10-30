import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useTranscriptRowBoolean } from "@session/components/agent/TranscriptRowState";
import { Badge } from "@session/components/ui/badge";
import type { ToolResultBlock, ToolUseBlock } from "../../types/messages";
import { ToolCardView } from "../../presentation/cards";
import { useCardContext } from "../../presentation/CardContext";

const MAX_VISIBLE_LOADING = 5;

interface ExploredItem {
  block: ToolUseBlock;
  inlineError?: ToolResultBlock | null;
  result?: ToolResultBlock | null;
}

interface Props {
  items: ExploredItem[];
  isCompleted: boolean;
}

function ItemRow({ block, inlineError, result }: ExploredItem) {
  const context = useCardContext();
  // Read/Grep/Glob fold into this group, so the aligned cards must render
  // here too — otherwise the exploration rows keep the legacy look.
  return (
    <div className="claude-presentation">
      <ToolCardView
        block={block}
        result={result ?? inlineError ?? undefined}
        context={context}
      />
    </div>
  );
}

export function ExploredGroup({ items, isCompleted }: Props) {
  const [isExpanded, setIsExpanded] = useTranscriptRowBoolean("explored");

  const readCount = items.filter((i) => i.block.name === "Read").length;
  const searchCount = items.filter(
    (i) => i.block.name === "Grep" || i.block.name === "Glob",
  ).length;

  return (
    <AnimatePresence mode="wait" initial={false}>
      {!isCompleted ? (
        <motion.div
          key="loading"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          {items.map((item, idx) => {
            const isHidden = items.length - idx > MAX_VISIBLE_LOADING;
            return (
              <motion.div
                key={item.block.id}
                initial={{ height: 0, opacity: 0 }}
                animate={
                  isHidden
                    ? { height: 0, opacity: 0 }
                    : { height: "auto", opacity: 1 }
                }
                transition={{ duration: 0.2, ease: "easeOut" }}
                className="overflow-hidden"
              >
                <ItemRow
                  block={item.block}
                  inlineError={item.inlineError}
                  result={item.result}
                />
              </motion.div>
            );
          })}
        </motion.div>
      ) : (
        <motion.div
          key="completed"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          <button
            onClick={() => setIsExpanded((p) => !p)}
            className="flex items-center gap-1 group text-left"
          >
            <span className="text-muted-foreground group-hover:text-foreground transition-colors inline-flex">
              {isExpanded ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
            </span>
            <Badge
              variant="secondary"
              className="text-[10px] h-4 bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 border-none"
            >
              Explored
            </Badge>
            <span className="text-[10px] text-muted-foreground">
              {readCount > 0 && `Read ${readCount}`}
              {readCount > 0 && searchCount > 0 && " · "}
              {searchCount > 0 && `Searched ${searchCount}×`}
            </span>
          </button>

          <AnimatePresence>
            {isExpanded && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2, ease: "easeOut" }}
                className="overflow-hidden mt-0.5 pl-4"
              >
                {items.map((item) => (
                  <ItemRow
                    key={item.block.id}
                    block={item.block}
                    inlineError={item.inlineError}
                    result={item.result}
                  />
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
