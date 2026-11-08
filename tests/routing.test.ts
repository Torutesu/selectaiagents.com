import test from "node:test";
import assert from "node:assert/strict";
import { agentId, referenceSlug, resolve } from "../src/lib/router";
import { SEED_AGENTS } from "../src/lib/seed";

test("routing references name the agent slug the gateway must load", () => {
  assert.equal(referenceSlug("dig-labs/deepdig#run"), "deepdig");
  assert.equal(referenceSlug("dig-labs/deepdig"), "deepdig");
  assert.equal(referenceSlug("deepdig#run"), "deepdig");
  assert.equal(referenceSlug("deepdig"), "deepdig");
});

test("every reference form resolves within the agents loaded for its slug", () => {
  const agent = SEED_AGENTS[0];
  const endpoint = agent.endpoints[0].id;
  for (const ref of [
    `${agentId(agent)}#${endpoint}`,
    agentId(agent),
    `${agent.slug}#${endpoint}`,
    agent.slug,
  ]) {
    const loaded = SEED_AGENTS.filter((a) => a.slug === referenceSlug(ref));
    assert.equal(resolve(loaded, ref)?.agent.slug, agent.slug, ref);
  }
});
