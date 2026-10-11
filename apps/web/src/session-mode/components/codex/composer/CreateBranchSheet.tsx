import { useState } from "react";
import { toast } from "sonner";
import { gitCreateBranch } from "@session/services/apiAdapt/git";
import { ComposerSheet } from "./v2/ComposerSheet";

export function CreateBranchSheet({
  cwd,
  onClose,
}: {
  cwd: string;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function create() {
    const branch = name.trim();
    if (!branch || busy) return;
    if (branch.endsWith("/")) {
      setError("分支名不能以“/”结尾。");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await gitCreateBranch(cwd, branch);
      toast.message(`已创建并检出 ${branch}`);
      onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  }
  return (
    <ComposerSheet
      title="创建分支"
      description="打开分支创建选项"
      onClose={onClose}
    >
      <p>填写名称后，在当前会话的工作目录创建并检出新分支。</p>
      <input
        aria-label="分支名称"
        placeholder="新分支"
        value={name}
        autoFocus
        disabled={busy}
        onChange={(event) => {
          setName(event.target.value);
          setError(null);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            void create();
          }
        }}
      />
      {error && <p role="alert">{error}</p>}
      <button type="button" disabled={busy || !name.trim()} onClick={() => void create()}>
        {busy ? "正在创建…" : "创建并检出"}
      </button>
    </ComposerSheet>
  );
}
