import type {
  McpElicitationPrimitiveSchema,
  McpElicitationStringSchema,
  McpServerElicitationRequestParams,
} from "@session/bindings/v2";
import { z } from "zod";

type NativeOption = { const: string; title: string; description?: string };
type NativeStringSchema = McpElicitationStringSchema & {
  enum?: string[];
  enumNames?: string[];
  oneOf?: NativeOption[];
  anyOf?: NativeOption[];
  pattern?: string;
  "x-openai-suggestions"?: NativeOption[];
};
type NativeArraySchema = {
  type: "array";
  title?: string;
  description?: string;
  minItems?: bigint | number;
  maxItems?: bigint | number;
  default?: string[];
  uniqueItems?: boolean;
  items: NativeStringSchema | { anyOf: NativeOption[] };
};
export type NativeImagePickerSchema = {
  type: "openai/imagePicker";
  title?: string;
  description?: string;
  items: Array<{ id: string; title: string; image: string }>;
  file?: { title?: string; accept?: string[] };
};
type NativePrimitiveSchema =
  | Exclude<McpElicitationPrimitiveSchema, { type: "string" | "array" }>
  | NativeStringSchema
  | NativeArraySchema
  | NativeImagePickerSchema;
type NativeFormSchema = {
  type: "object";
  properties: Record<string, NativePrimitiveSchema | undefined>;
  required?: string[];
};
const metadata = {
  title: z.string().optional(),
  description: z.string().optional(),
};
const optionSchema = z
  .object({
    const: z.string(),
    title: z.string(),
    description: z.string().optional(),
  })
  .strict();
const count = z.number().finite().int().nonnegative().optional();
const stringSchema = z
  .object({
    ...metadata,
    type: z.literal("string"),
    minLength: count,
    maxLength: count,
    format: z.enum(["email", "uri", "date", "date-time"]).optional(),
    default: z.string().optional(),
    enum: z.array(z.string()).optional(),
    enumNames: z.array(z.string()).optional(),
    oneOf: z.array(optionSchema).optional(),
    anyOf: z.array(optionSchema).optional(),
    "x-openai-suggestions": z.array(optionSchema).optional(),
    pattern: z
      .string()
      .refine((value) => {
        try {
          new RegExp(value);
          return true;
        } catch {
          return false;
        }
      })
      .optional(),
  })
  .strict();
const primitiveSchema = z.union([
  z
    .object({
      ...metadata,
      type: z.literal("openai/imagePicker"),
      items: z.array(
        z
          .object({
            id: z.string().trim().min(1),
            title: z.string().trim().min(1),
            image: z
              .string()
              .regex(
                /^data:image\/[a-zA-Z0-9.+-]+;base64,[a-zA-Z0-9+/]+={0,2}$/,
              ),
          })
          .strict(),
      ),
      file: z
        .object({
          title: z.string().optional(),
          accept: z.array(z.string().trim().min(1)).optional(),
        })
        .strict()
        .optional(),
    })
    .strict()
    .refine(
      (schema) =>
        (schema.file != null || schema.items.length > 0) &&
        new Set(schema.items.map((item) => item.id)).size ===
          schema.items.length,
    ),
  stringSchema,
  z
    .object({
      ...metadata,
      type: z.enum(["number", "integer"]),
      minimum: z.number().finite().optional(),
      maximum: z.number().finite().optional(),
      default: z.number().finite().optional(),
    })
    .strict(),
  z
    .object({
      ...metadata,
      type: z.literal("boolean"),
      default: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      ...metadata,
      type: z.literal("array"),
      minItems: count,
      maxItems: count,
      uniqueItems: z.boolean().optional(),
      default: z.array(z.string()).optional(),
      items: z.union([
        stringSchema,
        z.object({ anyOf: z.array(optionSchema) }).strict(),
      ]),
    })
    .strict(),
]);
const openaiFormSchema = z
  .object({
    $schema: z.string().optional(),
    type: z.literal("object"),
    properties: z.record(primitiveSchema),
    required: z.array(z.string()).optional(),
    additionalProperties: z.boolean().optional(),
  })
  .strict();

/** Legacy wire forms include imagePicker; modern resource inputs are rejected by the native legacy parser. */
export function elicitationSchema(
  request: McpServerElicitationRequestParams,
): NativeFormSchema | null {
  if (request.mode === "form") return request.requestedSchema;
  if (request.mode !== "openai/form") return null;
  const parsed = openaiFormSchema.safeParse(request.requestedSchema);
  if (
    !parsed.success ||
    parsed.data.required?.some(
      (id) => !Object.hasOwn(parsed.data.properties, id),
    )
  )
    return null;
  return parsed.data as NativeFormSchema;
}

export function unsupportedElicitationField(
  request: McpServerElicitationRequestParams,
): { field: string; kind: string } | null {
  if (request.mode !== "openai/form" || elicitationSchema(request)) return null;
  const raw = request.requestedSchema;
  if (
    raw &&
    typeof raw === "object" &&
    !Array.isArray(raw) &&
    raw.properties &&
    typeof raw.properties === "object" &&
    !Array.isArray(raw.properties)
  ) {
    for (const [field, value] of Object.entries(raw.properties)) {
      if (primitiveSchema.safeParse(value).success) continue;
      const schema =
        value && typeof value === "object" && !Array.isArray(value)
          ? value
          : {};
      const input = schema["x-openai-input"];
      const inputType =
        input &&
        typeof input === "object" &&
        !Array.isArray(input) &&
        typeof input.type === "string"
          ? input.type
          : "";
      return {
        field,
        kind: input
          ? `x-openai-input${inputType ? `/${inputType}` : ""}`
          : typeof schema.type === "string"
            ? schema.type === "string" && typeof schema.format === "string"
              ? `string/${schema.format}`
              : schema.type
            : "schema",
      };
    }
  }
  return { field: "requestedSchema", kind: "schema" };
}

export type ElicitationField = {
  id: string;
  label: string;
  description?: string;
  required: boolean;
  schema: NativePrimitiveSchema;
};
export type ElicitationFieldError = {
  kind:
    | "required"
    | "number"
    | "integer"
    | "boolean"
    | "minimum"
    | "maximum"
    | "minLength"
    | "maxLength"
    | "enum"
    | "minItems"
    | "maxItems"
    | "format"
    | "pattern"
    | "uniqueItems";
  params?: Record<string, string | number>;
};
export type ElicitationValues = Record<string, unknown>;

export function elicitationFields(
  request: McpServerElicitationRequestParams,
): ElicitationField[] {
  const schema = elicitationSchema(request);
  if (!schema) return [];
  return Object.entries(schema.properties ?? {}).flatMap(([id, property]) =>
    property
      ? [
          {
            id,
            label:
              property.title ??
              id.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]/g, " "),
            description: property.description,
            required: schema.required?.includes(id) === true,
            schema: property,
          },
        ]
      : [],
  );
}

export function elicitationFieldOptions(
  field: ElicitationField,
): { value: string; label: string; description?: string }[] {
  const schema =
    field.schema.type === "array" ? field.schema.items : field.schema;
  if ("type" in schema && schema.type === "openai/imagePicker")
    return schema.items.map((item) => ({ value: item.id, label: item.title }));
  const options =
    "oneOf" in schema && schema.oneOf != null
      ? schema.oneOf
      : "anyOf" in schema && schema.anyOf != null
        ? schema.anyOf
        : "x-openai-suggestions" in schema &&
            schema["x-openai-suggestions"] != null
          ? schema["x-openai-suggestions"]
          : null;
  if (options)
    return options.map((option) => ({
      value: option.const,
      label: option.title,
      description: option.description,
    }));
  if ("enum" in schema && schema.enum != null)
    return schema.enum.map((value, index) => ({
      value,
      label:
        "enumNames" in schema ? (schema.enumNames?.[index] ?? value) : value,
    }));
  return [];
}

const constrainedString = (
  schema: NativePrimitiveSchema | NativeArraySchema["items"],
) =>
  ("oneOf" in schema && schema.oneOf != null) ||
  ("anyOf" in schema && schema.anyOf != null) ||
  ("enum" in schema && schema.enum != null);
export const isElicitationSingleChoice = (field: ElicitationField) =>
  field.schema.type === "string" &&
  (constrainedString(field.schema) ||
    field.schema["x-openai-suggestions"] != null);
export const allowsElicitationCustomValue = (field: ElicitationField) =>
  field.schema.type === "array"
    ? !constrainedString(field.schema.items)
    : field.schema.type === "string" &&
      field.schema["x-openai-suggestions"] != null &&
      !constrainedString(field.schema);

/** Mirrors the native Dpt/Opt defaults. Single choices require an explicit selection. */
export function initialElicitationValues(
  fields: ElicitationField[],
): ElicitationValues {
  return Object.fromEntries(
    fields.flatMap((field) => {
      const schema = field.schema;
      if (schema.type === "openai/imagePicker") return [];
      if (isElicitationSingleChoice(field)) return [];
      let value: unknown = schema.default;
      if (schema.type === "array") {
        const allowed = elicitationFieldOptions(field).map(
          (option) => option.value,
        );
        value =
          (allowsElicitationCustomValue(field)
            ? schema.default
            : schema.default?.filter((item) => allowed.includes(item))) ?? [];
      } else if (value == null && schema.type !== "boolean") value = "";
      return value == null ? [] : [[field.id, value]];
    }),
  );
}

function validFormat(value: string, format: string): boolean {
  if (format === "email") return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  if (format === "uri") {
    try {
      return Boolean(new URL(value).protocol);
    } catch {
      return false;
    }
  }
  if (format === "date") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00Z`);
    return (
      Number.isFinite(date.getTime()) &&
      date.toISOString().slice(0, 10) === value
    );
  }
  if (format === "date-time") {
    const match =
      /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.exec(
        value,
      );
    return Boolean(
      match &&
      validFormat(match[1], "date") &&
      Number(match[2]) < 24 &&
      Number(match[3]) < 60 &&
      Number(match[4]) < 60 &&
      Number.isFinite(Date.parse(value)),
    );
  }
  return false;
}

/** Keeps raw numeric drafts until submit and omits optional empty values, as native kpt does. */
export function validateElicitationValues(
  fields: ElicitationField[],
  values: ElicitationValues,
) {
  const entries: [string, unknown][] = [];
  const errors: Record<string, ElicitationFieldError> = {};
  for (const field of fields) {
    const schema = field.schema;
    const options = elicitationFieldOptions(field);
    let value = Object.hasOwn(values, field.id) ? values[field.id] : undefined;
    if ((schema.type === "number" || schema.type === "integer") && value === "")
      value = undefined;
    const optionalEmpty =
      !field.required &&
      (value === "" || (Array.isArray(value) && value.length === 0)) &&
      !(
        (schema.type === "string" || schema.type === "array") &&
        (schema.default?.length ?? 0) > 0
      );
    if (value == null || optionalEmpty) {
      if (field.required)
        Object.defineProperty(errors, field.id, {
          value: { kind: "required" },
          enumerable: true,
          configurable: true,
        });
      continue;
    }
    let error: ElicitationFieldError | undefined;
    switch (schema.type) {
      case "openai/imagePicker": {
        let file = false;
        if (
          schema.file &&
          typeof value === "string" &&
          value.startsWith("file://")
        ) {
          try {
            file = new URL(value).protocol === "file:";
          } catch {
            /* reject invalid URL */
          }
        }
        if (
          typeof value !== "string" ||
          (!schema.items.some((item) => item.id === value) && !file)
        )
          error = { kind: "enum" };
        break;
      }
      case "number":
      case "integer": {
        const number =
          typeof value === "number" ||
          (typeof value === "string" && value.trim() !== "")
            ? Number(value)
            : NaN;
        if (!Number.isFinite(number)) error = { kind: "number" };
        else if (schema.type === "integer" && !Number.isInteger(number))
          error = { kind: "integer" };
        else if (schema.minimum != null && number < schema.minimum)
          error = { kind: "minimum", params: { minimum: schema.minimum } };
        else if (schema.maximum != null && number > schema.maximum)
          error = { kind: "maximum", params: { maximum: schema.maximum } };
        value = number;
        break;
      }
      case "boolean":
        if (typeof value !== "boolean") error = { kind: "boolean" };
        break;
      case "string":
        if (
          typeof value !== "string" ||
          (constrainedString(schema) &&
            !options.some((option) => option.value === value))
        )
          error = { kind: "enum" };
        else if (
          "minLength" in schema &&
          schema.minLength != null &&
          value.length < schema.minLength
        )
          error = {
            kind: "minLength",
            params: { minLength: schema.minLength },
          };
        else if (
          "maxLength" in schema &&
          schema.maxLength != null &&
          value.length > schema.maxLength
        )
          error = {
            kind: "maxLength",
            params: { maxLength: schema.maxLength },
          };
        else if (
          "format" in schema &&
          schema.format &&
          !validFormat(value, schema.format)
        )
          error = { kind: "format", params: { format: schema.format } };
        else if (schema.pattern && !new RegExp(schema.pattern).test(value))
          error = { kind: "pattern", params: { pattern: schema.pattern } };
        break;
      case "array":
        if (
          !Array.isArray(value) ||
          value.some(
            (item) =>
              typeof item !== "string" ||
              (!allowsElicitationCustomValue(field) &&
                !options.some((option) => option.value === item)),
          )
        )
          error = { kind: "enum" };
        else if (
          allowsElicitationCustomValue(field) &&
          "type" in schema.items &&
          schema.items.type === "string"
        ) {
          const invalid = (value as string[])
            .map((item) =>
              validateElicitationValues(
                [
                  {
                    ...field,
                    required: true,
                    schema: schema.items as NativeStringSchema,
                  },
                ],
                { [field.id]: item },
              ),
            )
            .find((result) => result.content === null);
          if (invalid) error = invalid.errors[field.id];
        }
        if (
          !error &&
          Array.isArray(value) &&
          schema.uniqueItems &&
          new Set(value).size !== value.length
        )
          error = { kind: "uniqueItems" };
        if (
          !error &&
          Array.isArray(value) &&
          schema.minItems != null &&
          value.length < Number(schema.minItems)
        )
          error = {
            kind: "minItems",
            params: { minItems: Number(schema.minItems) },
          };
        else if (
          !error &&
          Array.isArray(value) &&
          schema.maxItems != null &&
          value.length > Number(schema.maxItems)
        )
          error = {
            kind: "maxItems",
            params: { maxItems: Number(schema.maxItems) },
          };
        break;
    }
    if (error)
      Object.defineProperty(errors, field.id, {
        value: error,
        enumerable: true,
        configurable: true,
      });
    else entries.push([field.id, value]);
  }
  return {
    content:
      Object.keys(errors).length === 0 ? Object.fromEntries(entries) : null,
    errors,
  };
}

export type ElicitationCustomDraft = { text: string; selected: boolean };
/** Native kn merges a selected custom array draft once, immediately before validation. */
export function elicitationDraftValues(
  fields: ElicitationField[],
  values: ElicitationValues,
  customDrafts: Record<string, ElicitationCustomDraft>,
) {
  return Object.fromEntries(
    fields.flatMap((field) => {
      const custom = Object.hasOwn(customDrafts, field.id)
        ? customDrafts[field.id]
        : undefined;
      const value = Object.hasOwn(values, field.id)
        ? values[field.id]
        : undefined;
      if (
        field.schema.type === "array" &&
        allowsElicitationCustomValue(field) &&
        custom?.selected &&
        custom.text.length > 0
      )
        return [
          [field.id, [...(Array.isArray(value) ? value : []), custom.text]],
        ];
      return value === undefined ? [] : [[field.id, value]];
    }),
  );
}
