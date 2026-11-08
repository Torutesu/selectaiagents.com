import test from "node:test";
import assert from "node:assert/strict";
import { agentSummary } from "../src/lib/api";
import { playgroundEndpoints } from "../src/lib/playground";
import { healthyForRouting } from "../src/lib/router";
import { SEED_AGENTS } from "../src/lib/seed";
import type { Agent, Endpoint } from "../src/lib/types";

const endpoint = (overrides: Partial<Endpoint>): Endpoint => ({
  ...SEED_AGENTS[0].endpoints[0],
  available: true,
  contract: "chat.v1",
  ...overrides,
});

const agent = (overrides: Partial<Agent> = {}): Agent => ({
  ...SEED_AGENTS[0],
  demo: false,
  endpoints: [endpoint({ id: "chat" })],
  ...overrides,
});

const withHealth = (samples: number, uptime: number) =>
  agent({
    healthSamples: samples,
    stats: { ...SEED_AGENTS[0].stats, uptime },
  });

test("discovery runnable uses the same health rule as routing", () => {
  for (const [samples, uptime] of [
    [0, 100],
    [1, 0], // one early failure must not hide an agent the router still uses
    [19, 50],
    [20, 97.9],
    [20, 98],
    [500, 99.9],
  ]) {
    const a = withHealth(samples, uptime);
    assert.equal(
      agentSummary(a).runnable,
      healthyForRouting(a),
      `samples=${samples} uptime=${uptime}`,
    );
  }
  assert.equal(agentSummary(withHealth(1, 0)).runnable, true);
  assert.equal(agentSummary(withHealth(20, 97.9)).runnable, false);
});

test("discovery runnable still requires a real agent with an approved endpoint", () => {
  assert.equal(agentSummary(agent({ demo: true })).runnable, false);
  assert.equal(
    agentSummary(agent({ endpoints: [endpoint({ available: false })] }))
      .runnable,
    false,
  );
});

test("playground only offers approved chat endpoints of real agents", () => {
  const mixed = agent({
    endpoints: [
      endpoint({ id: "chat" }),
      endpoint({ id: "pending", available: false }),
      endpoint({ id: "structured", contract: "extract.v1" }),
    ],
  });
  assert.deepEqual(
    playgroundEndpoints(mixed).map((e) => e.id),
    ["chat"],
  );
  assert.deepEqual(playgroundEndpoints({ ...mixed, demo: true }), []);
  assert.deepEqual(
    playgroundEndpoints(agent({ endpoints: [endpoint({ available: false })] })),
    [],
  );
});
