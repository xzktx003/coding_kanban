import candidate from "./vite.chatgpt-candidate.config.mjs";
import { enableChatgptDocumentGuard } from "./chatgpt-safe-candidate.mjs";

// This is a separate opt-in entry for new candidate processes. Existing
// running Vite servers and documents are intentionally not changed.
export default async (environment) =>
  enableChatgptDocumentGuard(await candidate(environment));
