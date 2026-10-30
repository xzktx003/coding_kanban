import {
  useTypographyStore,
  type ChatFont,
  type CodeFont,
} from "@session/stores/settings/useTypographyStore";
const sizes = [10, 11, 12, 13, 14, 15, 16, 18, 20, 22, 24, 28];
const control =
  "h-8 rounded-md border border-input bg-background px-2 text-xs min-w-32";
export function TypographySettings() {
  const { chatFont, codeFont, textSize, codeSize, choose, reset } =
    useTypographyStore();
  return (
    <section className="space-y-3" aria-label="字体与字号">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h3 className="text-sm font-medium">字体与字号</h3>
          <p className="text-xs text-muted-foreground">
            仅保存在此设备，立即应用于聊天正文和代码。
          </p>
        </div>
        <button
          type="button"
          className="rounded-md px-2 py-1 text-xs hover:bg-accent"
          onClick={reset}
        >
          恢复默认字体
        </button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 rounded-lg border p-4">
        <label className="flex items-center justify-between gap-3 text-sm">
          聊天字体
          <select
            className={control}
            aria-label="聊天字体"
            value={chatFont}
            onChange={(event) =>
              choose({ chatFont: event.target.value as ChatFont })
            }
          >
            <option value="default">默认字体</option>
            <option value="sans">系统无衬线</option>
            <option value="serif">衬线字体</option>
          </select>
        </label>
        <label className="flex items-center justify-between gap-3 text-sm">
          正文字号
          <select
            className={control}
            aria-label="正文字号"
            value={textSize ?? ""}
            onChange={(event) =>
              choose({
                textSize:
                  event.target.value === "" ? null : Number(event.target.value),
              })
            }
          >
            <option value="">默认字号</option>
            {sizes.map((size) => (
              <option key={size} value={size}>
                {size} px
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center justify-between gap-3 text-sm">
          代码字体
          <select
            className={control}
            aria-label="代码字体"
            value={codeFont}
            onChange={(event) =>
              choose({ codeFont: event.target.value as CodeFont })
            }
          >
            <option value="default">默认等宽字体</option>
            <option value="system">系统等宽字体</option>
            <option value="consolas">Consolas / Liberation Mono</option>
          </select>
        </label>
        <label className="flex items-center justify-between gap-3 text-sm">
          代码字号
          <select
            className={control}
            aria-label="代码字号"
            value={codeSize ?? ""}
            onChange={(event) =>
              choose({
                codeSize:
                  event.target.value === "" ? null : Number(event.target.value),
              })
            }
          >
            <option value="">默认字号</option>
            {sizes.map((size) => (
              <option key={size} value={size}>
                {size} px
              </option>
            ))}
          </select>
        </label>
      </div>
    </section>
  );
}
