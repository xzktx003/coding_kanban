import { useSessionLeaveGuard } from "@session/hooks/useSessionLeaveGuard";
import { requestSessionNavigation } from "@session/services/sessionNavigationGuard";
import { Check, Settings2, X } from "lucide-react";
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@session/components/ui/dialog";
import { Button } from "@session/components/ui/button";
import type { ModelPricing } from "./constants";
import { DEFAULT_MODEL_PRICING } from "./utils";

interface PricingEditorProps {
  pricing: Record<string, ModelPricing>;
  onSave: (p: Record<string, ModelPricing>) => void;
  onClose: () => void;
}

export function PricingEditor({
  pricing,
  onSave,
  onClose,
}: PricingEditorProps) {
  const [local, setLocal] = useState<Record<string, ModelPricing>>(() =>
    Object.fromEntries(
      Object.entries(pricing).filter(([k]) => !k.startsWith("_")),
    ),
  );
  const [newKey, setNewKey] = useState("");
  const [resetVersion, setResetVersion] = useState(0);

  const [initial] = useState(() => JSON.stringify(local));
  const [editedInputs, setEditedInputs] = useState(false);
  useSessionLeaveGuard(editedInputs || JSON.stringify(local) !== initial || Boolean(newKey));
  const requestClose = () => requestSessionNavigation(onClose);

  function setField(key: string, field: keyof ModelPricing, raw: string) {
    const val = parseFloat(raw);
    if (isNaN(val)) return;
    setLocal((p) => ({ ...p, [key]: { ...p[key], [field]: val } }));
  }

  function addModel() {
    const k = newKey.trim().toLowerCase();
    if (!k || local[k]) return;
    setLocal((p) => ({
      ...p,
      [k]: { input: 0, output: 0, cache_read: 0, cache_creation: 0 },
    }));
    setNewKey("");
  }

  function removeModel(key: string) {
    setLocal((p) => {
      const n = { ...p };
      delete n[key];
      return n;
    });
  }

  function handleSave() {
    const merged: Record<string, ModelPricing> = {};
    for (const [k, v] of Object.entries(pricing)) {
      if (k.startsWith("_")) merged[k] = v;
    }
    Object.assign(merged, local);
    onSave(merged);
    onClose();
  }

  function handleReset() {
    setResetVersion((version) => version + 1);
    setLocal(
      Object.fromEntries(
        Object.entries(DEFAULT_MODEL_PRICING).filter(
          ([k]) => !k.startsWith("_"),
        ),
      ),
    );
  }

  const cols: (keyof ModelPricing)[] = [
    "input",
    "output",
    "cache_read",
    "cache_creation",
  ];

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) requestClose();
      }}
    >
      <DialogContent
        className="session-pricing-dialog w-[min(672px,calc(100vw-32px))] max-w-[calc(100vw-32px)] gap-0 overflow-hidden p-0"
        showCloseButton={false}
      >
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3">
          <div className="flex items-center gap-2">
            <Settings2 className="h-4 w-4 text-slate-400" />
            <DialogTitle className="text-sm font-semibold">
              模型计价
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              美元 / 百万 token
            </DialogDescription>
          </div>
          <button
            onClick={requestClose}
            aria-label="关闭模型计价"
            className="text-slate-500 hover:text-slate-200 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="overflow-auto max-h-[60vh] px-5 py-3">
          <table className="w-full min-w-[580px] text-xs">
            <thead>
              <tr className="text-left text-slate-500">
                <th className="pb-2 pr-3 font-medium">模型 ID</th>
                {cols.map((c) => (
                  <th key={c} className="pb-2 pr-2 font-medium capitalize w-24">
                    {
                      {
                        input: "输入",
                        output: "输出",
                        cache_read: "缓存读取",
                        cache_creation: "缓存写入",
                      }[c]
                    }
                  </th>
                ))}
                <th className="pb-2 w-6" />
              </tr>
            </thead>
            <tbody key={resetVersion} className="divide-y divide-slate-800/50">
              {Object.entries(local).map(([key, p]) => (
                <tr key={key} className="group">
                  <td className="py-1.5 pr-3 font-mono text-slate-300 align-middle">
                    {key}
                  </td>
                  {cols.map((c) => (
                    <td key={c} className="py-1.5 pr-2 align-middle">
                      <input
                        aria-label={`${key} ${{ input: "输入", output: "输出", cache_read: "缓存读取", cache_creation: "缓存写入" }[c]}`}
                        type="number"
                        step="0.001"
                        min="0"
                        defaultValue={p[c]}
                        onChange={(e) => { setEditedInputs(true); setField(key, c, e.target.value); }}
                        className="w-full min-w-[80px] rounded-md bg-slate-800 px-2 py-1 font-mono text-xs text-slate-200 border border-slate-700 focus:outline-none focus:border-slate-500"
                      />
                    </td>
                  ))}
                  <td className="py-1.5 align-middle">
                    <button
                      aria-label={`移除计价 ${key}`}
                      onClick={() => removeModel(key)}
                      className="opacity-70 hover:opacity-100 focus-visible:opacity-100 text-slate-600 hover:text-red-400 transition-colors"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="border-t border-slate-800 px-5 py-3 flex flex-wrap items-center gap-2">
          <input
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addModel()}
            aria-label="新增计价模型 ID"
            placeholder="新增模型 ID，如 gpt-5"
            className="min-w-0 flex-1 rounded-md bg-slate-800 px-3 py-1.5 text-xs text-slate-200 border border-slate-700 focus:outline-none focus:border-slate-500 placeholder:text-slate-600"
          />
          <Button
            size="sm"
            variant="secondary"
            onClick={addModel}
            className="h-7 text-xs"
          >
            添加
          </Button>
        </div>

        <div className="border-t border-slate-800 px-5 py-3 flex items-center justify-between">
          <button
            onClick={handleReset}
            className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
          >
            恢复默认
          </button>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={requestClose}
              className="h-7 text-xs text-slate-400"
            >
              取消
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              className="h-7 text-xs bg-violet-600 hover:bg-violet-500 text-white gap-1"
            >
              <Check className="h-3 w-3" /> 保存
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
