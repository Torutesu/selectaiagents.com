import Ajv, { type ValidateFunction } from "ajv";
import { z } from "zod";
import { isLoopbackEndpoint, LOCAL_TIMEOUT_MS, PUBLIC_TIMEOUT_MS } from "./endpoint-timeout";

export const endpointConfigSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]{1,40}$/),
    description: z.string().min(5).max(200),
    url: z.url().max(2000),
    contract: z.string().regex(/^[a-z0-9.-]{1,80}$/),
    adapter: z.enum(["json", "openai"]).default("json"),
    upstreamModel: z.string().max(150).optional(),
    inputSchema: z.record(z.string(), z.unknown()),
    outputSchema: z.record(z.string(), z.unknown()),
    priceMicros: z.number().int().min(0).max(10_000_000),
    timeoutMs: z.number().int().min(100).max(LOCAL_TIMEOUT_MS).default(15000),
    sideEffects: z.boolean().default(true),
  })
  .strict();
export type EndpointConfig = z.infer<typeof endpointConfigSchema> & {
  credentialEnv?: string;
};
export const CHAT_INPUT = {
  type: "object",
  required: ["messages"],
  additionalProperties: false,
  properties: {
    messages: {
      type: "array",
      minItems: 1,
      maxItems: 100,
      items: {
        type: "object",
        required: ["role", "content"],
        additionalProperties: false,
        properties: {
          role: { enum: ["system", "user", "assistant"] },
          content: { type: "string", maxLength: 30000 },
        },
      },
    },
  },
};
export const CHAT_OUTPUT = {
  type: "object",
  required: ["content"],
  additionalProperties: false,
  properties: { content: { type: "string", maxLength: 200000 } },
};
// Bound retained validators and isolate schema IDs between maker configurations.
const validators = new Map<string, ValidateFunction>();
const MAX_VALIDATORS = 128;
export function compileSchema(schema: Record<string, unknown>) {
  if (JSON.stringify(schema).length > 16000 || schema.$async)
    throw new Error("Schema is too large or asynchronous");
  const key = canonical(schema);
  const cached = validators.get(key);
  if (cached) {
    validators.delete(key);
    validators.set(key, cached);
    return cached;
  }
  const validate = new Ajv({ strict: true, allErrors: false, validateFormats: false }).compile(schema);
  if (validators.size >= MAX_VALIDATORS)
    validators.delete(validators.keys().next().value!);
  validators.set(key, validate);
  return validate;
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
export function validateConfig(config: EndpointConfig) {
  if (config.timeoutMs > PUBLIC_TIMEOUT_MS && !isLoopbackEndpoint(config.url))
    throw new Error("Public endpoints have a maximum response timeout of 20 seconds.");
  compileSchema(config.inputSchema);
  compileSchema(config.outputSchema);
  if (
    config.contract === "chat.v1" &&
    (canonical(config.inputSchema) !== canonical(CHAT_INPUT) ||
      canonical(config.outputSchema) !== canonical(CHAT_OUTPUT))
  ) {
    throw new Error("chat.v1 must use the documented chat schemas");
  }
  if (
    config.adapter === "openai" &&
    (config.contract !== "chat.v1" || !config.upstreamModel)
  )
    throw new Error("OpenAI adapters require chat.v1 and upstreamModel");
}
