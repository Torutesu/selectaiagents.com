import test from "node:test";
import assert from "node:assert/strict";
import { api } from "../src/lib/client-api";
import { filterAgents } from "../src/lib/rankings";
import { SEED_AGENTS } from "../src/lib/seed";
import type { Agent } from "../src/lib/types";

const timed = (slug: string, p50Ms: number, healthSamples: number): Agent => ({
  ...SEED_AGENTS[0],
  slug,
  healthSamples,
  stats: { ...SEED_AGENTS[0].stats, p50Ms },
});

test("fastest sort puts measured agents first and unmeasured agents last", () => {
  const sorted = filterAgents(
    [
      timed("never-called", 0, 0),
      timed("slow", 900, 40),
      timed("only-failures", 0, 5),
      timed("fast", 120, 40),
    ],
    { sort: "latency" },
  ).map((a) => a.slug);
  assert.deepEqual(sorted.slice(0, 2), ["fast", "slow"]);
  assert.deepEqual(
    new Set(sorted.slice(2)),
    new Set(["never-called", "only-failures"]),
  );
});

test("client API errors use the status message when the body is not JSON", async (t) => {
  const responses: Response[] = [
    new Response("<html>Bad Gateway</html>", { status: 502 }),
    new Response(
      JSON.stringify({ error: { message: "Sign in to continue" } }),
      {
        status: 401,
      },
    ),
    new Response(null, { status: 204 }),
  ];
  t.mock.method(globalThis, "fetch", async () => responses.shift()!);
  await assert.rejects(api("/x"), {
    message: "Request failed. Please try again.",
  });
  await assert.rejects(api("/x"), { message: "Sign in to continue" });
  assert.deepEqual(await api("/x"), {});
});
