import { isAbsolute } from "node:path";
import {
  bodyObject,
  HttpError,
  isObject,
  type Json,
  type JsonObject,
} from "../core/json.js";
import type { Rpc } from "./ownership.js";

/** Only model identity leaves the native connection; never provider credentials. */
export async function readModelConfig(
  input: Json,
  request: Rpc,
): Promise<JsonObject> {
  const params = bodyObject(input);
  if (
    Object.keys(params).some((k) => k !== "cwd") ||
    (params.cwd !== undefined &&
      params.cwd !== null &&
      (typeof params.cwd !== "string" ||
        !isAbsolute(params.cwd) ||
        params.cwd.length > 4096 ||
        /[\x00-\x1f\x7f]/.test(params.cwd)))
  )
    throw new HttpError(400, "Invalid model configuration directory");
  const raw = await request("config/read", {
    ...(typeof params.cwd === "string" ? { cwd: params.cwd } : {}),
    includeLayers: false,
  });
  if (!isObject(raw) || !isObject(raw.config))
    throw new Error("Invalid native model configuration");
  const config = raw.config;
  const text = (key: string, max: number) => {
    const value = config[key];
    if (value === null || value === undefined) return null;
    if (
      typeof value !== "string" ||
      !value ||
      value.length > max ||
      /[\x00-\x1f\x7f]/.test(value)
    )
      throw new Error("Invalid native model configuration");
    return value;
  };
  return {
    status: "ready",
    model: text("model", 1024),
    modelProvider: text("model_provider", 128),
    reasoningEffort: text("model_reasoning_effort", 64),
  };
}
