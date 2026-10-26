import { z } from "zod";
import {
  endpointConfigSchema,
  validateConfig,
  type EndpointConfig,
} from "./endpoint-config";
import { buildAgent, type SubmissionInput } from "./submission";
import { HttpError } from "./http";
import { validateExecutionTimeout } from "./endpoint-timeout";

export const draftSchema = z
  .object({
    details: z
      .object({
        name: z.string().max(40).optional(),
        tagline: z.string().max(80).optional(),
        description: z.string().max(1000).optional(),
        category: z.string().max(40).optional(),
        maker: z.string().max(60).optional(),
        website: z.string().max(2000).optional(),
        tags: z.string().max(300).optional(),
      })
      .strict(),
    endpoint: endpointConfigSchema
      .extend({ url: z.string().max(2000) })
      .nullable(),
  })
  .strict();

export function reviewedEndpoint(value: unknown): EndpointConfig {
  const config = endpointConfigSchema.parse(value);
  try {
    validateConfig(config);
    validateExecutionTimeout(config);
  } catch {
    throw new HttpError(
      400,
      "Check the endpoint schemas and adapter. Chat endpoints must use the standard chat contract.",
    );
  }
  const url = new URL(config.url);
  if (url.username || url.password || url.search || url.hash)
    throw new HttpError(
      400,
      "Use an endpoint URL without credentials, query parameters, or fragments. An operator attaches secrets separately.",
    );
  const local =
    process.env.NODE_ENV !== "production" &&
    process.env.ALLOW_LOCAL_UPSTREAM === "true" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(local && url.protocol === "http:"))
    throw new HttpError(400, "Use an HTTPS endpoint URL.");
  return config;
}

export function listingForSubmission(
  details: Partial<SubmissionInput>,
  config: EndpointConfig,
) {
  const result = buildAgent(
    {
      ...details,
      pricingModel: config.priceMicros === 0 ? "free" : "per_call",
      priceUsd: config.priceMicros / 1e6,
      unit: "call",
    },
    new Set(),
  );
  if ("errors" in result)
    throw new HttpError(400, Object.values(result.errors).join(" "));
  return result.agent;
}
