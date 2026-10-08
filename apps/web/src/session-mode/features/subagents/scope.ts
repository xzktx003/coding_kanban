import { buildUrl } from "@session/hooks/runtime";
/** Origin identifies the runtime host; tokens are deliberately absent from this key. */
export const subagentScope = () => new URL(buildUrl("/")).origin;
export const subagentStorageKey = () =>
  `kanban.session.subagent-families:${subagentScope()}`;
