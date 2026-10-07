import {
  isAgentInteractionVisible,
  useAgentInteractionVisible,
  sessionPortalContainer,
  listenInSessionMode,
} from "@session/session-dom";
import { X } from "lucide-react";
import type { CSSProperties } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { SkillsListEntry } from "@session/bindings/v2/SkillsListEntry";
import type { ComposerEditorRef } from "@session/components/common/useComposerPopover";
import {
  applyEditorReplacement,
  detectWordBoundaryTrigger,
  replaceAtTrigger,
} from "@session/components/common/useComposerPopover";
import { Button } from "@session/components/ui/button";
import { Switch } from "@session/components/ui/switch";
import { skillsConfigWrite } from "@session/services";
import { codexService } from "@session/services/codexService";
import { useWorkspaceStore } from "@session/stores/useWorkspaceStore";

type SkillWithEnabled = SkillsListEntry["skills"][number] & {
  enabled?: boolean;
};

const detectDollar = detectWordBoundaryTrigger("$");

interface SkillsInputPopoverProps {
  input: string;
  setInputValue: (v: string) => void;
  editorRef: ComposerEditorRef;
  triggerElement: HTMLElement | null;
}

export function SkillsInputPopover({
  input,
  setInputValue,
  editorRef,
  triggerElement,
}: SkillsInputPopoverProps) {
  const { cwd } = useWorkspaceStore();
  const interactionVisible = useAgentInteractionVisible();
  const [open, setOpen] = useState(false);
  const [skillsList, setSkillsList] = useState<SkillsListEntry[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);

  // Detect `$` trigger
  useEffect(() => {
    if (!interactionVisible) {
      setOpen(false);
      return;
    }
    const { open: shouldOpen } = detectDollar(input);
    setOpen(shouldOpen);
  }, [input, interactionVisible]);

  useEffect(() => {
    if (!open || !interactionVisible) return;
    codexService.listSkills(cwd).then(setSkillsList).catch(console.error);
  }, [open, cwd, interactionVisible]);

  const handleClose = useCallback(() => {
    const newValue = replaceAtTrigger(input, "$", "");
    const cleaned = (newValue ?? input).replace(/^\s+/, "").trimEnd();
    applyEditorReplacement(cleaned, setInputValue, editorRef);
    setOpen(false);
  }, [input, setInputValue, editorRef]);

  // Close on outside click
  useEffect(() => {
    if (!open || !interactionVisible) return;
    const handleMouseDown = (e: MouseEvent) => {
      if (!isAgentInteractionVisible()) return;
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        handleClose();
      }
    };
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [open, handleClose, interactionVisible]);

  // Close on Escape
  useEffect(() => {
    if (!open || !interactionVisible) return;
    const handler = (e: KeyboardEvent) => {
      if (!isAgentInteractionVisible()) return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        handleClose();
      }
    };
    const stopHandlerForSession = listenInSessionMode(
      document,
      "keydown",
      handler,
      true,
    );
    return () => stopHandlerForSession();
  }, [open, handleClose, interactionVisible]);

  if (!open || !interactionVisible || typeof document === "undefined")
    return null;

  const rect = triggerElement?.getBoundingClientRect();

  return createPortal(
    <div
      ref={containerRef}
      style={
        {
          position: "fixed",
          top: rect?.top ?? 0,
          left: rect?.left ?? 0,
          transform: "translateY(calc(-100% - 8px))",
        } as CSSProperties
      }
      className="z-[9999] w-96 max-w-[600px] max-h-96 overflow-y-auto rounded-md border bg-popover text-popover-foreground shadow-md p-3"
    >
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-muted-foreground">Skills</span>
        <Button
          variant="ghost"
          size="icon"
          className="h-5 w-5"
          onClick={handleClose}
        >
          <X className="h-3 w-3" />
        </Button>
      </div>
      <div className="space-y-4">
        <h4 className="font-medium leading-none mb-2 text-sm text-muted-foreground">
          Available Skills
        </h4>
        {skillsList.flatMap((e) => e.skills).length === 0 ? (
          <div className="text-sm text-muted-foreground p-2">
            No skills found.
          </div>
        ) : (
          <div className="grid gap-2">
            {skillsList
              .flatMap((entry) => entry.skills)
              .map((skill, i) => {
                const typedSkill = skill as SkillWithEnabled;
                return (
                  <div
                    key={`${skill.name}-${i}`}
                    className="flex justify-between gap-2 border-b pb-2 last:border-0 last:pb-0"
                  >
                    <span className="flex gap-2">
                      <div className="font-medium text-sm">{skill.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {skill.shortDescription || skill.description}
                      </div>
                    </span>
                    <span className="flex gap-2">
                      <div className="text-xs text-muted-foreground">
                        {skill.scope}
                      </div>
                      <Switch
                        checked={typedSkill.enabled ?? false}
                        onCheckedChange={(checked) => {
                          skillsConfigWrite(skill.path, checked).catch(
                            console.error,
                          );
                          setSkillsList((prev) =>
                            prev.map((entry) => {
                              if (
                                entry.skills.some((s) => s.path === skill.path)
                              ) {
                                return {
                                  ...entry,
                                  skills: entry.skills.map((s) =>
                                    s.path === skill.path
                                      ? ({
                                          ...s,
                                          enabled: checked,
                                        } as SkillWithEnabled)
                                      : s,
                                  ),
                                };
                              }
                              return entry;
                            }),
                          );
                        }}
                      />
                    </span>
                  </div>
                );
              })}
          </div>
        )}
      </div>
    </div>,
    sessionPortalContainer() ?? document.body,
  );
}
