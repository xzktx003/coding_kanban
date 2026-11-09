import { postJsonWithOptions } from "./apiAdapt/shared";
import { readWithDeadline } from "./sessionReadQueue";

export interface NewChatModelConfig {
  status: "ready";
  model: string | null;
  modelProvider: string | null;
  reasoningEffort: string | null;
}
export async function readNewChatModelConfig(
  cwd: string,
): Promise<NewChatModelConfig> {
  let value: NewChatModelConfig;
  try {
    value = await readWithDeadline(
      (signal) =>
        postJsonWithOptions<NewChatModelConfig>(
          "/api/codex/model/config/read",
          { cwd },
          { signal, suppressToast: true },
        ),
      5000,
    );
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "status" in error &&
      [404, 405, 501].includes(Number(error.status))
    )
      throw new Error(
        "当前运行服务不支持读取模型配置；请手动选择模型，或在维护窗口更新运行服务。",
      );
    throw new Error("无法核实 Codex 模型配置，请刷新后重试。");
  }
  if (
    !value ||
    value.status !== "ready" ||
    !["model", "modelProvider", "reasoningEffort"].every((key) => {
      const v = value[key as keyof NewChatModelConfig];
      return (
        v === null ||
        (typeof v === "string" &&
          v.length > 0 &&
          v.length <= 1024 &&
          !/[\x00-\x1f\x7f]/.test(v))
      );
    })
  )
    throw new Error("运行服务返回的模型配置无效。");
  return {
    status: "ready",
    model: value.model,
    modelProvider: value.modelProvider,
    reasoningEffort: value.reasoningEffort,
  };
}
export function resolveNewChatModelConfig<
  T extends {
    model: string;
    modelProvider: string;
    reasoningEffort: string | null;
  },
>(saved: T, config: NewChatModelConfig) {
  return {
    ...saved,
    model: config.model,
    modelProvider: config.modelProvider,
    reasoningEffort: config.reasoningEffort,
  };
}
