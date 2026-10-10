export type Json = null | boolean | number | string | Json[] | JsonObject;
export interface JsonObject {
  [key: string]: Json;
}

export function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function object(value: unknown): JsonObject {
  return isObject(value) ? value : {};
}

export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

export function bodyObject(value: unknown): JsonObject {
  if (!isObject(value)) throw new HttpError(400, "Expected a JSON object");
  return value;
}

export function stringField(value: JsonObject, key: string): string {
  const field = value[key];
  if (typeof field !== "string" || !field || /[\x00-\x1f]/.test(field))
    throw new HttpError(400, `Invalid ${key}`);
  return field;
}
