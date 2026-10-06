import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@session": resolve(__dirname, "src/session-mode") } },
  test: { environment: "jsdom", setupFiles: ["src/session-mode/test/setup.ts"], include: ["src/session-mode/**/*.test.{ts,tsx}"], maxWorkers: 2 },
});
