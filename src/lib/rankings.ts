import type { Agent, CategoryId } from "./types";

export type Period = "7d" | "30d";

export interface RankedAgent {
  agent: Agent;
  calls: number;
  /** Percent change vs the previous period, or null when the agent is new. */
  changePct: number | null;
}

function windowCalls(agent: Agent, period: Period) {
  return period === "7d"
    ? { calls: agent.stats.calls7d, prev: agent.stats.callsPrev7d }
    : { calls: agent.stats.calls30d, prev: agent.stats.callsPrev30d };
}

/** Most used agents in the trailing window, like OpenRouter's model rankings. */
export function mostUsed(
  agents: Agent[],
  period: Period,
  category?: CategoryId,
): RankedAgent[] {
  return agents
    .filter((a) => !category || a.category === category)
    .map((agent) => {
      const { calls, prev } = windowCalls(agent, period);
      return {
        agent,
        calls,
        changePct: prev > 0 ? ((calls - prev) / prev) * 100 : null,
      };
    })
    .sort((a, b) => b.calls - a.calls);
}

export interface GrowingAgent {
  agent: Agent;
  calls: number;
  prevCalls: number;
  multiple: number;
}

/** Week-over-week growth. Agents below `minCalls` are excluded to cut noise. */
export function fastestGrowing(
  agents: Agent[],
  minCalls = 10_000,
): GrowingAgent[] {
  return agents
    .filter((a) => a.stats.calls7d >= minCalls && a.stats.callsPrev7d > 0)
    .map((agent) => ({
      agent,
      calls: agent.stats.calls7d,
      prevCalls: agent.stats.callsPrev7d,
      multiple: agent.stats.calls7d / agent.stats.callsPrev7d,
    }))
    .sort((a, b) => b.multiple - a.multiple);
}

/** Product Hunt-style launches, grouped by launch day, newest day first. */
export function launchesByDay(
  agents: Agent[],
): { day: string; agents: Agent[] }[] {
  const byDay = new Map<string, Agent[]>();
  for (const a of agents) {
    byDay.set(a.launchedAt, [...(byDay.get(a.launchedAt) ?? []), a]);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([day, list]) => ({
      day,
      agents: list.sort((x, y) => y.upvotes - x.upvotes),
    }));
}

export const CATALOG_SORTS = [
  { id: "popular", label: "Most used" },
  { id: "trending", label: "Trending" },
  { id: "newest", label: "Newest" },
  { id: "price-asc", label: "Price: low to high" },
  { id: "price-desc", label: "Price: high to low" },
  { id: "latency", label: "Fastest (p50)" },
] as const;

export type CatalogSort = (typeof CATALOG_SORTS)[number]["id"];

export interface CatalogFilter {
  q?: string;
  category?: string;
  /** A pricing model id, or "paid" for anything not free. */
  pricing?: string;
  maxPrice?: number;
  sort?: CatalogSort;
}

const growth = (a: Agent) =>
  a.stats.callsPrev7d > 0 ? a.stats.calls7d / a.stats.callsPrev7d : 0;

/** Measured p50, or undefined when no successful call has been timed yet. */
const measuredP50 = (a: Agent) =>
  a.healthSamples && a.stats.p50Ms > 0 ? a.stats.p50Ms : undefined;

/** Fastest first; agents without a measured latency go last, not first. */
function byLatency(a: Agent, b: Agent) {
  const x = measuredP50(a);
  const y = measuredP50(b);
  if (x === undefined || y === undefined)
    return (x === undefined ? 1 : 0) - (y === undefined ? 1 : 0);
  return x - y;
}

/** The models-page style catalog: search, facet filters, and sort. */
export function filterAgents(agents: Agent[], f: CatalogFilter): Agent[] {
  const sorters: Record<CatalogSort, (a: Agent, b: Agent) => number> = {
    popular: (a, b) => b.stats.calls7d - a.stats.calls7d,
    trending: (a, b) => growth(b) - growth(a),
    newest: (a, b) => b.launchedAt.localeCompare(a.launchedAt),
    "price-asc": (a, b) => a.pricing.priceUsd - b.pricing.priceUsd,
    "price-desc": (a, b) => b.pricing.priceUsd - a.pricing.priceUsd,
    latency: byLatency,
  };
  return searchAgents(agents, f.q, f.category)
    .filter(
      (a) =>
        !f.pricing ||
        (f.pricing === "paid"
          ? a.pricing.model !== "free"
          : a.pricing.model === f.pricing),
    )
    .filter(
      (a) =>
        f.maxPrice === undefined ||
        Number.isNaN(f.maxPrice) ||
        a.pricing.priceUsd <= f.maxPrice,
    )
    .sort(sorters[f.sort && f.sort in sorters ? f.sort : "popular"]);
}

export function searchAgents(
  agents: Agent[],
  q?: string,
  category?: string,
): Agent[] {
  const needle = q?.trim().toLowerCase();
  return agents.filter(
    (a) =>
      (!category || a.category === category) &&
      (!needle ||
        [a.name, a.tagline, a.description, a.maker, ...a.tags].some((s) =>
          s.toLowerCase().includes(needle),
        )),
  );
}
