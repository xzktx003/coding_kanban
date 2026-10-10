import { parentPort, workerData } from "node:worker_threads";
import { NativeInsightsScanner } from "./insights.js";
import type { JsonObject } from "../core/json.js";
const scanner = new NativeInsightsScanner(workerData.env, workerData.ttl);
parentPort!.on(
  "message",
  async ({
    id,
    method,
    filters,
  }: {
    id: number;
    method: "heatmaps" | "rankings" | "options";
    filters: JsonObject;
  }) => {
    try {
      const value =
        method === "options"
          ? await scanner.options()
          : await scanner[method](filters);
      parentPort!.postMessage({ id, value });
    } catch (error) {
      parentPort!.postMessage({ id, error: (error as Error).message });
    }
  },
);
