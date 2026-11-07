import test from "node:test";
import assert from "node:assert/strict";
import { healthyForRouting } from "../src/lib/router";
import { SEED_AGENTS } from "../src/lib/seed";
test("health excludes degraded agents only after sufficient measured calls", () => {
  const agent = {
    ...SEED_AGENTS[0],
    stats: { ...SEED_AGENTS[0].stats, uptime: 0 },
  };
  assert.equal(healthyForRouting({ ...agent, healthSamples: 1 }), true);
  assert.equal(healthyForRouting({ ...agent, healthSamples: 19 }), true);
  assert.equal(healthyForRouting({ ...agent, healthSamples: 20 }), false);
  assert.equal(
    healthyForRouting({
      ...agent,
      healthSamples: 20,
      stats: { ...agent.stats, uptime: 98 },
    }),
    true,
  );
});
