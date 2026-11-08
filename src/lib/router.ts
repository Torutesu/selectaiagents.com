import { searchAgents } from "./rankings";
import type { Agent, Endpoint } from "./types";

// Agent IDs follow OpenRouter's `author/slug` shape, e.g. `dig-labs/deepdig`.
// An endpoint is addressed as `author/slug#endpoint`; without `#endpoint` the
// agent's first endpoint is used.

export function makerSlug(maker: string): string {
  return maker
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function agentId(agent: Agent): string {
  return `${makerSlug(agent.maker)}/${agent.slug}`;
}

export type SortBy = "price" | "latency" | "uptime" | "usage";

export interface RouteRequest {
  /** An agent id, a bare slug, `<id>#<endpoint>`, or `auto`. */
  model: string;
  /** Fallbacks tried in order when `model` is unavailable. */
  models?: string[];
  /** Used by `auto` to pick candidates. */
  category?: string;
  query?: string;
  sort?: SortBy;
}

/** Auto routing and fallbacks require enough observations before excluding an agent. */
export const MIN_UPTIME = 98;
export const MIN_HEALTH_SAMPLES = 20;
export function healthyForRouting(agent: Agent) {
  return (
    (agent.healthSamples ?? 0) < MIN_HEALTH_SAMPLES ||
    agent.stats.uptime >= MIN_UPTIME
  );
}

/** The agent slug a reference points at: `maker/slug#endpoint`, `maker/slug` or `slug`. */
export function referenceSlug(ref: string): string {
  const id = ref.split("#")[0];
  return id.includes("/") ? id.split("/")[1] : id;
}

export function resolve(
  agents: Agent[],
  ref: string,
): { agent: Agent; endpoint: Endpoint } | undefined {
  const [id, endpointId] = ref.split("#");
  const slug = referenceSlug(ref);
  const agent = agents.find(
    (a) => a.slug === slug && (!id.includes("/") || agentId(a) === id),
  );
  const endpoint = endpointId
    ? agent?.endpoints.find((e) => e.id === endpointId)
    : agent?.endpoints[0];
  return agent && endpoint ? { agent, endpoint } : undefined;
}

function sortAgents(list: Agent[], sort: SortBy = "usage"): Agent[] {
  const key: Record<SortBy, (a: Agent) => number> = {
    price: (a) => a.pricing.priceUsd,
    latency: (a) =>
      a.healthSamples ? a.stats.p50Ms : Number.POSITIVE_INFINITY,
    uptime: (a) => -a.stats.uptime,
    usage: (a) => -a.stats.calls7d,
  };
  return [...list].sort((a, b) => key[sort](a) - key[sort](b));
}

/** Candidate list for `auto`: agents matching the category and/or query, best first. */
export function autoCandidates(
  agents: Agent[],
  req: Pick<RouteRequest, "category" | "query" | "sort">,
): string[] {
  let pool = searchAgents(agents, undefined, req.category);
  const words = (req.query ?? "").toLowerCase().match(/[a-z0-9]{4,}/g) ?? [];
  const scored = pool
    .map((a) => ({
      a,
      score: words.filter((w) => searchAgents([a], w).length).length,
    }))
    .filter((x) => x.score > 0);
  if (scored.length) {
    const best = Math.max(...scored.map((x) => x.score));
    pool = scored.filter((x) => x.score === best).map((x) => x.a);
  }
  return sortAgents(pool, req.sort).map(agentId);
}
