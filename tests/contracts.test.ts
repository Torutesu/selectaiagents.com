import test from "node:test";
import assert from "node:assert/strict";
import {
  canonical,
  CHAT_INPUT,
  CHAT_OUTPUT,
  endpointConfigSchema,
  validateConfig,
  compileSchema,
} from "../src/lib/endpoint-config";
import { publicAddress, targetAddresses } from "../src/lib/upstream";
import { chatSchema, runSchema } from "../src/lib/request-schema";
import { buildAgent } from "../src/lib/submission";
import { dailyUsage, usageDays, usageAsOf } from "../src/lib/usage";
import { SEED_AGENTS } from "../src/lib/seed";

test("private, mapped, link-local and loopback addresses cannot be upstreams", () => {
  for (const address of [
    "127.0.0.1",
    "10.0.0.1",
    "172.16.1.1",
    "192.168.0.1",
    "169.254.169.254",
    "0.0.0.0",
    "100.64.0.1",
    "::1",
    "fe80::1",
    "fc00::1",
    "::ffff:127.0.0.1",
  ])
    assert.equal(publicAddress(address), false, address);
  assert.equal(publicAddress("8.8.8.8"), true);
  assert.equal(publicAddress("2606:4700:4700::1111"), true);
});
test("unsafe upstream protocols, credentials and unapproved destinations are rejected", async () => {
  process.env.ALLOW_LOCAL_UPSTREAM = "false";
  process.env.ROUTER_ALLOWED_HOSTS = "example.com";
  for (const url of [
    "http://example.com/run",
    "https://user:pass@example.com/run",
    "https://example.com:9443/run",
    "https://unapproved.example/run",
    "https://example.com/run#fragment",
  ]) {
    await assert.rejects(targetAddresses(url));
  }
});
test("chat and structured requests reject unsupported or ambiguous input", () => {
  const valid = {
    model: "maker/agent",
    messages: [{ role: "user", content: "hello" }],
  };
  assert.equal(chatSchema.safeParse(valid).success, true);
  for (const extra of [
    { stream: true },
    { temperature: 0.5 },
    { messages: [] },
    { route: { sort: "random" } },
    { route: { maxPriceUsd: -1 } },
    { messages: [{ role: "tool", content: "x" }] },
  ])
    assert.equal(chatSchema.safeParse({ ...valid, ...extra }).success, false);
  assert.equal(runSchema.safeParse({ endpoint: "auto" }).success, false);
  assert.equal(
    runSchema.safeParse({
      endpoint: "auto",
      input: {},
      fallbacks: Array(9).fill("x"),
    }).success,
    false,
  );
});
test("chat contracts reject schema drift, and structured contracts validate both directions", () => {
  const config = endpointConfigSchema.parse({
    id: "run",
    description: "Test chat agent",
    url: "https://example.com/run",
    contract: "chat.v1",
    inputSchema: CHAT_INPUT,
    outputSchema: CHAT_OUTPUT,
    priceMicros: 10000,
  });
  validateConfig(config);
  assert.throws(() =>
    validateConfig({ ...config, outputSchema: { type: "object" } }),
  );
  assert.equal(
    compileSchema(CHAT_INPUT)({
      messages: [{ role: "user", content: "hello" }],
    }),
    true,
  );
  assert.equal(
    compileSchema(CHAT_INPUT)({ messages: [{ role: "user", content: 5 }] }),
    false,
  );
  assert.equal(compileSchema(CHAT_OUTPUT)({ content: "ok" }), true);
  assert.equal(compileSchema(CHAT_OUTPUT)({ text: "ok" }), false);
  assert.equal(
    canonical({ b: 2, a: { d: 1, c: 2 } }),
    canonical({ a: { c: 2, d: 1 }, b: 2 }),
  );
});
test("measured daily usage never falls back to synthetic seed totals", () => {
  const days = usageDays();
  const agent = { ...SEED_AGENTS[0], dailyCalls: { [days.at(-1)!]: 3 } };
  assert.equal(
    dailyUsage(agent).reduce((a, b) => a + b, 0),
    3,
  );
  assert.deepEqual(dailyUsage({ ...agent, dailyCalls: {} }), Array(30).fill(0));
});
test("listing rejects unusable maker ids and oversized prices", () => {
  const input = {
    name: "Example",
    tagline: "An example agent",
    description: "An agent with a sufficiently long description",
    category: "research",
    maker: "Maker",
    website: "https://example.com",
    pricingModel: "per_call",
    priceUsd: "0.01",
  };
  assert.ok("agent" in buildAgent(input, new Set()));
  assert.ok("errors" in buildAgent({ ...input, maker: "###" }, new Set()));
  assert.ok(
    "errors" in buildAgent({ ...input, priceUsd: "Infinity" }, new Set()),
  );
  assert.ok("errors" in buildAgent({ ...input, priceUsd: 11 }, new Set()));
});

test("usage date advances at UTC midnight without a process restart", () => {
  assert.equal(usageAsOf(Date.parse("2026-10-25T23:59:59Z")), "2026-10-24");
  assert.equal(usageAsOf(Date.parse("2026-10-26T00:00:00Z")), "2026-10-25");
});

test("schema IDs can be reused across reloads and independent configurations", () => {
  const schema = { $id: "https://example.test/shared", type: "string" };
  const first = compileSchema(schema);
  for (let i = 0; i < 100; i++) {
    const loaded = compileSchema(JSON.parse(JSON.stringify(schema)));
    assert.equal(loaded, first);
    assert.equal(loaded("ok"), true);
    assert.equal(loaded(1), false);
  }
  const changed = compileSchema({ ...schema, type: "number" });
  assert.equal(changed(1), true);
  assert.equal(changed("ok"), false);
});

test("validator cache evicts old schemas instead of retaining every configuration", () => {
  const schema = { type: "string", const: "eviction-target" };
  const first = compileSchema(schema);
  for (let i = 0; i < 130; i++)
    compileSchema({ type: "string", const: `value-${i}` });
  const reloaded = compileSchema(schema);
  assert.notEqual(reloaded, first);
  assert.equal(reloaded("eviction-target"), true);
  assert.equal(reloaded("other"), false);
});
