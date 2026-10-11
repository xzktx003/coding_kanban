import { useState } from "react";
import { toast } from "sonner";
import { writeFile } from "@session/services/apiAdapt/filesystem";
import { useWorkspaceStore } from "@session/stores/useWorkspaceStore";
import { ComposerSheet } from "./v2/ComposerSheet";

function skillSlug(name: string) {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return slug || "recorded-skill";
}

/** Plugin "Record a skill" has no local screen recorder. Capture the workflow as SKILL.md. */
export function RecordSkillDialog({ onClose }: { onClose: () => void }) {
  const cwd = useWorkspaceStore((state) => state.cwd);
  const [name, setName] = useState("");
  const [steps, setSteps] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <ComposerSheet
      title="录制技能"
      description="把这次工作流写成当前项目的技能。浏览器不能录制屏幕，步骤由你填写。"
      onClose={onClose}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!cwd || busy) return;
          const title = name.trim();
          const body = steps.trim();
          if (!title || !body) return;
          const slug = skillSlug(title);
          const path = `${cwd}/.agents/skills/${slug}/SKILL.md`;
          setBusy(true);
          void writeFile(
            path,
            `---\nname: ${slug}\ndescription: ${title}\n---\n\n${body}\n`,
          )
            .then(() => {
              toast.success(`已保存技能 ${slug}`);
              onClose();
            })
            .catch((error) => toast.error(String(error)))
            .finally(() => setBusy(false));
        }}
      >
        <label>
          技能名称
          <input
            aria-label="技能名称"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="例如：检查当前改动"
          />
        </label>
        <label>
          工作流步骤
          <textarea
            aria-label="工作流步骤"
            value={steps}
            onChange={(event) => setSteps(event.target.value)}
            placeholder="按顺序写下要重复执行的步骤"
          />
        </label>
        <button type="submit" disabled={busy || !cwd || !name.trim() || !steps.trim()}>
          保存技能
        </button>
        {!cwd && <p role="status">先选择项目，再录制技能。</p>}
      </form>
    </ComposerSheet>
  );
}
