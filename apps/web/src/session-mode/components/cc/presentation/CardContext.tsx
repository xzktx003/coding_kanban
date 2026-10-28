/**
 * Supplies the tool cards with their host capabilities, standing in for the
 * official webview's `ctx.fileOpener`.
 *
 * Divergence from the official extension: it opens content in a real VS Code
 * editor tab. In the browser we reveal on-disk files through the existing
 * editor panel, and show arbitrary tool text in a dialog — there is no editor
 * tab to own a transient buffer. The affordance, its gating and its aria hint
 * stay identical.
 *
 * Reference: docs/designs/claude-render-alignment/tool-card-contract-20261027.md §2
 */

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@session/components/ui/dialog";
import { useEditorStore } from "@session/stores/useEditorStore";
import { useLayoutStore } from "@session/stores";
import type { ToolCardContext } from "./ToolCard";

const CardContext = createContext<ToolCardContext | undefined>(undefined);

/** The capabilities a tool card may use. Undefined outside the provider. */
export function useCardContext(): ToolCardContext | undefined {
  return useContext(CardContext);
}

interface OpenText {
  title: string;
  text: string;
}

export function ClaudeCardProvider({
  children,
  /** The session's working directory, used to resolve relative paths. */
  cwd,
}: {
  children: ReactNode;
  cwd?: string | null;
}) {
  const [openText, setOpenText] = useState<OpenText | null>(null);

  const context = useMemo<ToolCardContext>(
    () => ({
      openContent: (text, title) => setOpenText({ text, title }),
      openFile: (path, options) => {
        // Only absolute paths can be revealed; a relative one needs the cwd.
        const resolved =
          path.startsWith("/") || !cwd
            ? path
            : `${cwd.replace(/\/$/, "")}/${path}`;
        useEditorStore
          .getState()
          .revealFile(
            resolved,
            cwd ?? undefined,
            options?.startLine,
            undefined,
            options?.endLine,
          );
        useLayoutStore.getState().setActiveRightPanelTab("files");
        useLayoutStore.getState().setRightPanelOpen(true);
      },
    }),
    [cwd],
  );

  return (
    <CardContext.Provider value={context}>
      {children}
      <Dialog
        open={!!openText}
        onOpenChange={(open) => {
          if (!open) setOpenText(null);
        }}
      >
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{openText?.title}</DialogTitle>
          </DialogHeader>
          <pre className="claude-tool-full-text">{openText?.text}</pre>
        </DialogContent>
      </Dialog>
    </CardContext.Provider>
  );
}
