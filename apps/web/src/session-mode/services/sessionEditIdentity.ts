import { v4 as randomUUID } from "uuid";

/** Only real edits/create/re-add get an ID; hydration, completion and retry keep it. */
export const newSessionEditId = () => `edit3_${randomUUID()}`;
export const isCurrentSessionEditId = (value: unknown): value is string =>
  typeof value === "string" &&
  /^edit3_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
    value,
  );
