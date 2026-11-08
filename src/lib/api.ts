import { agentId, healthyForRouting } from "./router";
import type { Agent } from "./types";

export function agentSummary(a: Agent) {
  return {
    id: agentId(a),
    name: a.name,
    demo: Boolean(a.demo),
    // Same health rule as automatic routing and fallbacks: uptime only
    // excludes an agent once it has enough measured calls.
    runnable:
      !a.demo && healthyForRouting(a) && a.endpoints.some((e) => e.available),
    description: a.tagline,
    category: a.category,
    created: a.launchedAt,
    pricing: a.pricing,
    endpoints: a.endpoints.map((e) => ({
      id: `${agentId(a)}#${e.id}`,
      price_usd: e.priceUsd,
      description: e.description,
      available: e.available ?? false,
      contract: e.contract,
      input_schema: e.inputSchema,
      output_schema: e.outputSchema,
    })),
    stats: {
      calls_7d: a.stats.calls7d,
      p50_ms: a.healthSamples ? a.stats.p50Ms : null,
      p95_ms: a.healthSamples ? a.stats.p95Ms : null,
      uptime: a.healthSamples ? a.stats.uptime : null,
      health_samples: a.healthSamples ?? 0,
    },
  };
}
