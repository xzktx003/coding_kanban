import { create } from "zustand";
import {
  createPerFieldStorage,
  createStorageSync,
  oneOf,
} from "@session/lib/perFieldStorage";
export type ChatFont = "default" | "sans" | "serif";
export type CodeFont = "default" | "system" | "consolas";
interface Typography {
  chatFont: ChatFont;
  codeFont: CodeFont;
  textSize: number | null;
  codeSize: number | null;
}
const defaults: Typography = {
  chatFont: "default",
  codeFont: "default",
  textSize: null,
  codeSize: null,
};
const size = (value: unknown) =>
  value === null ||
  (typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 10 &&
    value <= 28 &&
    Number.isInteger(value));
const validators = {
  chatFont: oneOf("default", "sans", "serif"),
  codeFont: oneOf("default", "system", "consolas"),
  textSize: size,
  codeSize: size,
};
const storage = createPerFieldStorage<Typography>({
  legacyKey: "kanban.session.typography",
  version: 1,
  defaults,
  validators,
});
export const useTypographyStore = create<
  Typography & {
    choose: (patch: Partial<Typography>) => void;
    reset: () => void;
  }
>()((set) => ({
  ...storage.readAll(),
  choose(patch) {
    const valid = Object.fromEntries(
      Object.entries(patch).filter(
        ([key, value]) =>
          Object.hasOwn(validators, key) &&
          validators[key as keyof Typography](value),
      ),
    ) as Partial<Typography>;
    if (!Object.keys(valid).length) return;
    set(valid);
    storage.save(valid);
  },
  reset() {
    set(defaults);
    storage.save(defaults);
  },
}));
const sync = createStorageSync(() => {
  const patch = storage.changes(useTypographyStore.getState());
  if (Object.keys(patch).length) useTypographyStore.setState(patch);
}, storage.owns);
export const startTypographySync = sync.start;
import.meta.hot?.dispose(() => sync.detach());
