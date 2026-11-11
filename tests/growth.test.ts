import test from "node:test";
import assert from "node:assert/strict";
import { fastestGrowing, GROWTH_MIN_CALLS } from "../src/lib/rankings";
import { SEED_AGENTS } from "../src/lib/seed";
import type { Agent } from "../src/lib/types";

const weekly = (slug: string, calls7d: number, callsPrev7d: number): Agent => ({
  ...SEED_AGENTS[0],
  slug,
  stats: { ...SEED_AGENTS[0].stats, calls7d, callsPrev7d },
});

test("fastest growing ranks agents at the threshold, not only very large ones", () => {
  const ranked = fastestGrowing([
    weekly("tripled", GROWTH_MIN_CALLS * 3, GROWTH_MIN_CALLS),
    weekly("doubled", GROWTH_MIN_CALLS, GROWTH_MIN_CALLS / 2),
    weekly("too-small", GROWTH_MIN_CALLS - 1, 1),
    weekly("brand-new", GROWTH_MIN_CALLS * 5, 0),
  ]).map((g) => g.agent.slug);
  assert.deepEqual(ranked, ["tripled", "doubled"]);
  assert.ok(GROWTH_MIN_CALLS < 10_000);
});
