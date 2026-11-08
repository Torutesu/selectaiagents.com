import { cache } from "react";
import { db, transaction } from "./db";
import type { Agent, Endpoint } from "./types";

const showDemo = () => process.env.SHOW_DEMO_AGENTS === "true";

/**
 * Listings with measured stats, votes and endpoints: every agent when $2 is
 * null, otherwise only agent $2. Every figure is computed per agent, so the
 * single-agent row equals that agent's row in the full catalog.
 * UTC calendar windows match the published rankings methodology.
 */
async function queryAgents(
  includeDemo: boolean,
  slug: string | null,
): Promise<Agent[]> {
  const { rows } = await db.query(
    `WITH boundaries AS (
    SELECT date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' AS day
  ), logs AS (
    SELECT agent_slug,
      count(*) FILTER(WHERE status='success' AND created_at >= day-interval '168 hours' AND created_at < day)::int AS c7,
      count(*) FILTER(WHERE status='success' AND created_at >= day-interval '336 hours' AND created_at < day-interval '168 hours')::int AS p7,
      count(*) FILTER(WHERE status='success' AND created_at >= day-interval '720 hours' AND created_at < day)::int AS c30,
      count(*) FILTER(WHERE status='success' AND created_at < day-interval '720 hours')::int AS p30,
      percentile_cont(0.5) WITHIN GROUP(ORDER BY latency_ms) FILTER(WHERE status='success' AND created_at>now()-interval '720 hours') AS p50,
      percentile_cont(0.95) WITHIN GROUP(ORDER BY latency_ms) FILTER(WHERE status='success' AND created_at>now()-interval '720 hours') AS p95,
      count(*) FILTER(WHERE created_at>now()-interval '720 hours')::int AS samples,
      100.0*count(*) FILTER(WHERE status='success' AND created_at>now()-interval '720 hours') / NULLIF(count(*) FILTER(WHERE created_at>now()-interval '720 hours'),0) AS uptime
    FROM call_logs CROSS JOIN boundaries WHERE created_at >= day-interval '1440 hours'
      AND ($2::text IS NULL OR agent_slug=$2) GROUP BY agent_slug
  ), daily AS (
    SELECT agent_slug,jsonb_object_agg(day,calls) AS calls FROM (
      SELECT agent_slug,to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD') AS day,count(*)::int AS calls
      FROM call_logs WHERE status='success' AND created_at>now()-interval '744 hours'
        AND ($2::text IS NULL OR agent_slug=$2) GROUP BY agent_slug,day
    ) d GROUP BY agent_slug
  ) SELECT a.*,l.*,d.calls AS daily_calls,
    (SELECT count(*)::int FROM votes v WHERE v.agent_slug=a.slug) AS votes,
    (SELECT jsonb_agg(jsonb_build_object('id',e.id,'contract',e.config->'contract','available',e.approved,'reviewStatus',e.review_status,
      'method','POST','path','/v1/run','description',e.config->'description','priceUsd',(e.config->>'priceMicros')::numeric/1000000,
      'inputSchema',e.config->'inputSchema','outputSchema',e.config->'outputSchema') ORDER BY e.id) FROM endpoints e WHERE e.agent_slug=a.slug) AS configured_endpoints
    FROM agents a LEFT JOIN logs l ON l.agent_slug=a.slug LEFT JOIN daily d ON d.agent_slug=a.slug
    WHERE ($1 OR NOT a.demo) AND ($2::text IS NULL OR a.slug=$2) ORDER BY a.created_at DESC`,
    [includeDemo, slug],
  );
  return rows.map((row) => {
    const agent = row.data as Agent;
    const endpoints: Endpoint[] =
      row.configured_endpoints ??
      agent.endpoints.map((e) => ({ ...e, available: false }));
    const active = endpoints.filter((e) => e.available);
    // Prefer callable prices. When none are approved, show current submitted
    // prices instead of the original listing snapshot (which may be stale).
    // Legacy/demo listings without configured endpoints retain their pricing.
    const priced = active.length ? active : (row.configured_endpoints ?? []);
    const price = priced.length
      ? Math.min(...priced.map((e: Endpoint) => e.priceUsd))
      : agent.pricing.priceUsd;
    return {
      ...agent,
      demo: row.demo,
      ownerId: row.owner_id ?? undefined,
      endpoints,
      pricing: priced.length
        ? {
            model: price === 0 ? ("free" as const) : ("per_call" as const),
            priceUsd: price,
            unit: "call",
          }
        : agent.pricing,
      stats: {
        calls7d: row.c7 ?? 0,
        callsPrev7d: row.p7 ?? 0,
        calls30d: row.c30 ?? 0,
        callsPrev30d: row.p30 ?? 0,
        p50Ms: Math.round(row.p50 ?? 0),
        p95Ms: Math.round(row.p95 ?? 0),
        uptime: Number(row.uptime ?? 100),
      },
      upvotes: row.votes,
      dailyCalls: row.daily_calls ?? {},
      healthSamples: row.samples ?? 0,
    };
  });
}

// React cache() deduplicates identical calls within one server render, such as
// an agent page's generateMetadata and body or its three badge leaderboards.
// Outside a render (route handlers, scripts) it calls straight through, so no
// data is shared between requests. Callers must not mutate returned agents.
const cachedAgents = cache((includeDemo: boolean) =>
  queryAgents(includeDemo, null),
);
const cachedAgent = cache(
  async (slug: string, includeDemo: boolean) =>
    (await queryAgents(includeDemo, slug))[0],
);

export function listAgents(includeDemo = showDemo()): Promise<Agent[]> {
  return cachedAgents(includeDemo);
}
export function getAgent(slug: string): Promise<Agent | undefined> {
  return cachedAgent(slug, showDemo());
}
export async function addAgent(agent: Agent, ownerId: string) {
  await db.query("INSERT INTO agents(slug,owner_id,data) VALUES($1,$2,$3)", [
    agent.slug,
    ownerId,
    agent,
  ]);
}
export async function upvote(
  slug: string,
  userId: string,
): Promise<number | undefined> {
  return transaction(async (c) => {
    const agent = await c.query(
      "SELECT slug FROM agents WHERE slug=$1 AND NOT demo",
      [slug],
    );
    if (!agent.rowCount) return undefined;
    await c.query(
      "INSERT INTO votes(agent_slug,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
      [slug, userId],
    );
    return (
      await c.query(
        "SELECT count(*)::int AS count FROM votes WHERE agent_slug=$1",
        [slug],
      )
    ).rows[0].count as number;
  });
}
