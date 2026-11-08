/** Integration tests own the local selectaiagents_test database, never the app database. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, open } from "node:fs/promises";
import { Pool } from "pg";
import OpenAI from "openai";
import Stripe from "stripe";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { CHAT_INPUT, CHAT_OUTPUT } from "../src/lib/endpoint-config";
import { onboardingChecks } from "./integration-onboarding";

import { routingBlockerChecks } from "./integration-routing-blockers";

const origin = "http://127.0.0.1:3200";
const database =
  process.env.TEST_DATABASE_URL || "postgresql://localhost/selectaiagents_test";
const environment = {
  ...process.env,
  DATABASE_URL: database,
  BETTER_AUTH_URL: origin,
  BETTER_AUTH_SECRET: randomUUID() + randomUUID(),
  NODE_ENV: "development" as const,
  NEXT_DIST_DIR: ".next-integration",
  SHOW_DEMO_AGENTS: "true",
  ALLOW_LOCAL_UPSTREAM: "true",
  ROUTER_ALLOWED_HOSTS: "",
  OPERATOR_USER_IDS: "",
  MAKER_TEST_TOKEN: "local-fixture-token",
  STRIPE_SECRET_KEY: "sk_test_local_fixture",
  STRIPE_WEBHOOK_SECRET: "whsec_local_fixture",
};
Object.assign(process.env, environment);
const pool = new Pool({ connectionString: database });
let app: ChildProcess | undefined;
let passed = 0;
const check = (name: string) => {
  passed++;
  console.log(`PASS ${name}`);
};
const hits: Record<string, number> = {};
const upstream = createServer(async (req, res) => {
  const path = req.url ?? "/";
  hits[path] = (hits[path] ?? 0) + 1;
  let body = "";
  for await (const chunk of req) body += chunk;
  if (req.headers.authorization !== "Bearer local-fixture-token") {
    res.writeHead(401).end();
    return;
  }
  if (path === "/fail") {
    res.writeHead(503).end();
    return;
  }
  if (path === "/timeout") {
    setTimeout(() => res.end(JSON.stringify({ content: "late" })), 400);
    return;
  }
  if (path === "/redirect") {
    res
      .writeHead(302, { location: "http://169.254.169.254/latest/meta-data" })
      .end();
    return;
  }
  res.setHeader("Content-Type", "application/json");
  const input = JSON.parse(body);
  if (path === "/bad") {
    res.end(JSON.stringify({ wrong: "schema" }));
    return;
  }
  if (path === "/slow") await new Promise((r) => setTimeout(r, 300));
  const content = `Fixture: ${input.messages?.at(-1)?.content ?? input.question ?? "ok"}`;
  res.end(
    JSON.stringify(
      path === "/openai"
        ? { choices: [{ message: { content } }] }
        : { content },
    ),
  );
});
async function command(args: string[]) {
  const child = spawn(process.execPath, ["--import", "tsx", ...args], {
    env: environment,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (d) => (output += d));
  child.stderr.on("data", (d) => (output += d));
  const [code] = await once(child, "exit");
  if (code !== 0) throw new Error(`Command failed: ${args[0]}\n${output}`);
}
async function request(
  path: string,
  method = "GET",
  body?: unknown,
  headers: Record<string, string> = {},
) {
  const response = await fetch(origin + path, {
    method,
    headers: {
      Origin: origin,
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    json = { text: text.slice(0, 300) };
  }
  return { status: response.status, json, headers: response.headers };
}
async function account(name: string) {
  const credentials = {
    name,
    email: `${name.toLowerCase()}@example.test`,
    password: "integration-password-123",
  };
  let response = await request("/api/auth/sign-up/email", "POST", credentials);
  // Fast runners can exhaust the real sign-up limiter while creating fixtures.
  // Respect its delay once; never disable auth protection or retry other errors.
  if (response.status === 429) {
    const delay = response.headers.get("X-Retry-After");
    const seconds = Number(delay);
    assert.ok(
      delay !== null &&
        Number.isFinite(seconds) &&
        seconds >= 0 &&
        seconds <= 60,
    );
    console.log(`Account fixture rate limited; retrying after ${seconds}s`);
    await new Promise((resolve) => setTimeout(resolve, seconds * 1000 + 100));
    response = await request("/api/auth/sign-up/email", "POST", credentials);
  }
  assert.equal(response.status, 200, JSON.stringify(response.json));
  const cookie = response.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  assert.ok(cookie);
  return { id: response.json.user.id as string, cookie };
}
async function key(cookie: string) {
  const r = await request(
    "/api/account",
    "POST",
    { name: "Integration" },
    { Cookie: cookie },
  );
  assert.equal(r.status, 201, JSON.stringify(r.json));
  return r.json.key as string;
}
async function launch(name: string, cookie: string) {
  const r = await request(
    "/api/agents",
    "POST",
    {
      name,
      tagline: "A local integration fixture",
      description:
        "A local agent fixture used to verify routing and accounting.",
      category: "research",
      maker: "Fixture Maker",
      website: "https://example.test",
      pricingModel: "per_call",
      priceUsd: "0.01",
      unit: "call",
    },
    { Cookie: cookie },
  );
  assert.equal(r.status, 201, JSON.stringify(r.json));
  return r.json.slug as string;
}
async function configure(
  slug: string,
  cookie: string,
  path: string,
  options: Record<string, unknown> = {},
) {
  const address = upstream.address();
  assert.ok(address && typeof address !== "string");
  const config = {
    id: "run",
    description: "Integration fixture",
    url: `http://127.0.0.1:${address.port}${path}`,
    contract: "chat.v1",
    adapter: "json",
    inputSchema: CHAT_INPUT,
    outputSchema: CHAT_OUTPUT,
    priceMicros: 10000,
    timeoutMs: 2000,
    sideEffects: false,
    ...options,
  };
  const r = await request(`/api/agents/${slug}/endpoints`, "PUT", config, {
    Cookie: cookie,
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  await command([
    "scripts/ops.ts",
    "approve-endpoint",
    slug,
    String(config.id),
    "MAKER_TEST_TOKEN",
  ]);
  return config;
}
async function main() {
  assert.equal(
    (await pool.query("SELECT current_database() AS name")).rows[0].name,
    "selectaiagents_test",
  );
  await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
  await command(["scripts/migrate.ts"]);
  await command(["scripts/seed.ts"]);
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  await mkdir(".data", { recursive: true });
  const log = await open(".data/integration-server.log", "w");
  app = spawn(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      "dev",
      "--hostname",
      "127.0.0.1",
      "--port",
      "3200",
    ],
    { env: environment, stdio: ["ignore", log.fd, log.fd] },
  );
  await log.close();
  let ready = false;
  for (let i = 0; i < 120; i++) {
    if (app.exitCode !== null)
      throw new Error("Test app exited. Inspect .data/integration-server.log");
    try {
      if ((await fetch(origin + "/api/v1/models")).ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  assert.ok(ready, "Test server did not start");
  const alice = await account("Alice");
  const bob = await account("Bob");
  const apiKey = await key(alice.cookie);
  const bearer = { Authorization: `Bearer ${apiKey}` };
  check("email/password signup, persisted sessions and API key creation");
  assert.equal((await request("/api/account")).status, 401);
  assert.equal(
    (
      await request(
        "/api/account",
        "POST",
        { name: "evil" },
        { Cookie: alice.cookie, Origin: "https://evil.example" },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await request(
        "/api/v1/run",
        "POST",
        { endpoint: "auto", input: {} },
        { Authorization: "Bearer anything" },
      )
    ).status,
    401,
  );
  check("account isolation, CSRF protection and rejection of fake keys");
  const slug = await launch("Live Agent", alice.cookie);
  const model = `fixture-maker/${slug}#run`;
  await Promise.all(
    Array.from({ length: 8 }, () =>
      request(`/api/agents/${slug}/upvote`, "POST", undefined, {
        Cookie: alice.cookie,
      }),
    ),
  );
  assert.equal(
    (
      await request(`/api/agents/${slug}/upvote`, "GET", undefined, {
        Cookie: alice.cookie,
      })
    ).json.upvotes,
    1,
  );
  assert.equal(
    (
      await request(`/api/agents/${slug}/upvote`, "POST", undefined, {
        Cookie: bob.cookie,
      })
    ).json.upvotes,
    2,
  );
  assert.equal(
    (
      await request(
        `/api/agents/${slug}/comments`,
        "POST",
        { body: "Useful agent" },
        { Cookie: alice.cookie },
      )
    ).status,
    201,
  );
  assert.equal(
    (await request(`/api/agents/${slug}/comments`)).json.comments.length,
    1,
  );
  check("concurrent one-vote-per-user enforcement and authenticated comments");
  const config = await configure(slug, alice.cookie, "/ok");
  assert.equal(
    (
      await request(`/api/agents/${slug}/endpoints`, "PUT", config, {
        Cookie: bob.cookie,
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await request(
        `/api/agents/${slug}/endpoints`,
        "PUT",
        { ...config, credentialEnv: "MAKER_OTHER_ACCOUNT" },
        { Cookie: alice.cookie },
      )
    ).status,
    400,
  );
  const inspect = (await request(`/api/v1/agents/${slug}`)).json;
  assert.ok(!JSON.stringify(inspect).includes("local-fixture-token"));
  assert.ok(!JSON.stringify(inspect).includes("credentialEnv"));
  check("maker ownership and private upstream credential configuration");
  const chat = { model, messages: [{ role: "user", content: "hello" }] };
  assert.equal(
    (await request("/api/v1/chat/completions", "POST", chat, bearer)).status,
    402,
  );
  assert.equal(hits["/ok"] ?? 0, 0);
  const { credit, wallet } = await import("../src/lib/billing");
  await credit(alice.id, 1_000_000, "initial-test-credit");
  const invalid = await request(
    "/api/v1/run",
    "POST",
    { endpoint: model, input: { wrong: "schema" } },
    bearer,
  );
  assert.equal(invalid.status, 400);
  assert.equal(hits["/ok"] ?? 0, 0);
  check("credit and schema checks happen before upstream execution");
  const sdk = new OpenAI({
    baseURL: origin + "/api/v1",
    apiKey,
    maxRetries: 0,
  });
  const reply = await sdk.chat.completions.create(chat as any, {
    headers: { "Idempotency-Key": "sdk-001" },
  });
  assert.equal(reply.choices[0].message.content, "Fixture: hello");
  const balance = (await wallet(alice.id)).balanceUsd;
  const replay = await request("/api/v1/chat/completions", "POST", chat, {
    ...bearer,
    "Idempotency-Key": "sdk-001",
  });
  assert.equal(replay.json.id, reply.id);
  assert.equal((await wallet(alice.id)).balanceUsd, balance);
  assert.equal(hits["/ok"], 1);
  assert.equal(
    (
      await request(
        "/api/v1/chat/completions",
        "POST",
        { ...chat, messages: [{ role: "user", content: "different" }] },
        { ...bearer, "Idempotency-Key": "sdk-001" },
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await request(
        "/api/v1/chat/completions",
        "POST",
        { ...chat, stream: true },
        bearer,
      )
    ).status,
    400,
  );
  assert.equal(
    (await sdk.models.list()).data.some(
      (m) => m.id === `fixture-maker/${slug}`,
    ),
    true,
  );
  check(
    "OpenAI SDK execution, metering, idempotent replay and conflict handling",
  );
  await configure(slug, alice.cookie, "/slow", { id: "slow" });
  const beforeDuplicate = await wallet(alice.id);
  const duplicates = await Promise.all(
    Array.from({ length: 2 }, () =>
      request(
        "/api/v1/chat/completions",
        "POST",
        { ...chat, model: `fixture-maker/${slug}#slow` },
        { ...bearer, "Idempotency-Key": "concurrent-same-task" },
      ),
    ),
  );
  assert.equal(duplicates.filter((r) => r.status === 200).length, 1);
  assert.equal(duplicates.filter((r) => r.status === 409).length, 1);
  assert.equal(hits["/slow"], 1);
  assert.equal(
    (await wallet(alice.id)).balanceUsd,
    Number((beforeDuplicate.balanceUsd - 0.01).toFixed(6)),
  );
  check("simultaneous idempotent requests execute and charge exactly once");
  const sessionCall = await request("/api/v1/chat/completions", "POST", chat, {
    Cookie: alice.cookie,
  });
  assert.equal(sessionCall.status, 200);
  check("playground session uses the same billed execution path");
  const failed = await launch("Fail Agent", alice.cookie);
  await configure(failed, alice.cookie, "/fail");
  const fallback = await request(
    "/api/v1/chat/completions",
    "POST",
    { ...chat, model: `fixture-maker/${failed}`, models: [model] },
    bearer,
  );
  assert.equal(fallback.status, 200, JSON.stringify(fallback.json));
  assert.ok(
    fallback.json.routing.attempts.some((a: any) => a.status === "failed"),
  );
  const health = (await request(`/api/v1/agents/${failed}`)).json.data;
  assert.equal(health.stats.uptime, 0);
  const second = await request(
    "/api/v1/chat/completions",
    "POST",
    { ...chat, model: `fixture-maker/${failed}`, models: [model] },
    bearer,
  );
  assert.equal(second.status, 200);
  assert.equal(hits["/fail"], 2);
  check(
    "real upstream failure fallback without excluding a new agent after one failure",
  );
  await configure(failed, alice.cookie, "/ok");
  const recovered = await request(
    "/api/v1/chat/completions",
    "POST",
    { ...chat, model: `fixture-maker/${failed}` },
    bearer,
  );
  assert.equal(recovered.status, 200);
  check("a newly approved agent recovers after its first failed call");
  await configure(failed, alice.cookie, "/fail");
  await routingBlockerChecks({
    pool,
    request,
    bearer,
    userId: alice.id,
    model,
    failedModel: `fixture-maker/${failed}#run`,
    hits,
    command,
    check,
  });
  const side = await launch("Action Agent", alice.cookie);
  await configure(side, alice.cookie, "/fail", { sideEffects: true });
  const before = hits["/ok"];
  const moneyBefore = (await wallet(alice.id)).balanceUsd;
  const action = await request(
    "/api/v1/chat/completions",
    "POST",
    { ...chat, model: `fixture-maker/${side}`, models: [model] },
    bearer,
  );
  assert.equal(action.status, 502);
  assert.equal(hits["/ok"], before);
  assert.equal((await wallet(alice.id)).balanceUsd, moneyBefore);
  assert.equal((await wallet(alice.id)).reservedUsd, 0);
  check("side-effect failure stops fallback and releases reserved credits");
  const timeout = await launch("Timeout Agent", alice.cookie);
  await configure(timeout, alice.cookie, "/timeout", { timeoutMs: 100 });
  assert.equal(
    (
      await request(
        "/api/v1/chat/completions",
        "POST",
        { ...chat, model: `fixture-maker/${timeout}`, models: [model] },
        bearer,
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await pool.query("SELECT status FROM call_logs WHERE agent_slug=$1", [
        timeout,
      ])
    ).rows[0].status,
    "timeout",
  );
  const bad = await launch("Bad Output Agent", alice.cookie);
  await configure(bad, alice.cookie, "/bad");
  const beforeBad = (await wallet(alice.id)).balanceUsd;
  assert.equal(
    (
      await request(
        "/api/v1/chat/completions",
        "POST",
        { ...chat, model: `fixture-maker/${bad}` },
        bearer,
      )
    ).status,
    502,
  );
  assert.equal((await wallet(alice.id)).balanceUsd, beforeBad);
  check("timeouts, output schema validation and failure refunds");
  const openai = await launch("OpenAI Adapter", alice.cookie);
  await configure(openai, alice.cookie, "/openai", {
    adapter: "openai",
    upstreamModel: "fixture-model",
  });
  assert.equal(
    (
      await request(
        "/api/v1/chat/completions",
        "POST",
        { ...chat, model: `fixture-maker/${openai}` },
        bearer,
      )
    ).json.choices[0].message.content,
    "Fixture: hello",
  );
  const auto = await request(
    "/api/v1/chat/completions",
    "POST",
    {
      ...chat,
      model: "auto",
      route: { category: "research", sort: "price", maxPriceUsd: 0.02 },
    },
    bearer,
  );
  assert.equal(auto.status, 200, JSON.stringify(auto.json));
  assert.equal(
    (
      await request(
        "/api/v1/run",
        "POST",
        { endpoint: "auto", input: { messages: chat.messages } },
        bearer,
      )
    ).status,
    400,
  );
  check("OpenAI upstream adapter and bounded automatic routing");
  const structuredInput = {
    type: "object",
    required: ["question"],
    additionalProperties: false,
    properties: { question: { type: "string" } },
  };
  await configure(slug, alice.cookie, "/ok", {
    id: "aaa-structured",
    contract: "question.v1",
    inputSchema: structuredInput,
  });
  const bare = await request(
    "/api/v1/chat/completions",
    "POST",
    { ...chat, model: `fixture-maker/${slug}` },
    bearer,
  );
  assert.equal(bare.status, 200);
  assert.ok(bare.json.model.endsWith("#run"));
  const structured = await request(
    "/api/v1/run",
    "POST",
    {
      endpoint: "auto",
      route: {
        contract: "question.v1",
        category: "research",
        maxPriceUsd: 0.02,
      },
      input: { question: "structured question" },
    },
    bearer,
  );
  assert.equal(structured.status, 200);
  assert.equal(structured.json.output.content, "Fixture: structured question");
  const incompatible = await request(
    "/api/v1/run",
    "POST",
    {
      endpoint: "missing",
      fallbacks: [`fixture-maker/${slug}#aaa-structured`, model],
      route: { contract: "chat.v1" },
      input: { messages: chat.messages },
    },
    bearer,
  );
  assert.equal(incompatible.status, 200);
  assert.ok(
    incompatible.json.routing.attempts.some(
      (a: any) => a.status === "incompatible",
    ),
  );
  check(
    "multiple endpoints, structured auto routing and incompatible fallback rejection",
  );
  const redirect = await launch("Redirect Agent", alice.cookie);
  await configure(redirect, alice.cookie, "/redirect");
  assert.equal(
    (
      await request(
        "/api/v1/chat/completions",
        "POST",
        { ...chat, model: `fixture-maker/${redirect}` },
        bearer,
      )
    ).status,
    502,
  );
  check(
    "upstream redirects are rejected without following a private destination",
  );
  const bobKey = await key(bob.cookie);
  await credit(bob.id, 30000, "bob-test-credit");
  const parallel = await Promise.all(
    Array.from({ length: 6 }, (_, i) =>
      request("/api/v1/chat/completions", "POST", chat, {
        Authorization: `Bearer ${bobKey}`,
        "Idempotency-Key": `parallel-${i}`,
      }),
    ),
  );
  assert.equal(parallel.filter((r) => r.status === 200).length, 3);
  assert.equal(parallel.filter((r) => r.status === 402).length, 3);
  assert.equal((await wallet(bob.id)).balanceUsd, 0);
  assert.equal((await wallet(bob.id)).reservedUsd, 0);
  check("concurrent requests cannot overspend prepaid balance");
  const client = new Client({ name: "integration", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(
    new URL(origin + "/api/mcp"),
    { requestInit: { headers: bearer } },
  );
  await client.connect(transport);
  assert.deepEqual((await client.listTools()).tools.map((t) => t.name).sort(), [
    "discover",
    "inspect",
    "run",
  ]);
  assert.equal(
    (await client.callTool({ name: "inspect", arguments: { slug } })).isError,
    undefined,
  );
  const mcpRun = await client.callTool({
    name: "run",
    arguments: { endpoint: model, input: { messages: chat.messages } },
  });
  assert.equal(mcpRun.isError, false, JSON.stringify(mcpRun));
  await client.close();
  const publicClient = new Client({
    name: "public-integration",
    version: "1.0.0",
  });
  await publicClient.connect(
    new StreamableHTTPClientTransport(new URL(origin + "/api/mcp")),
  );
  assert.equal(
    (
      await publicClient.callTool({
        name: "discover",
        arguments: { category: "research" },
      })
    ).isError,
    undefined,
  );
  assert.equal(
    (
      await publicClient.callTool({
        name: "run",
        arguments: { endpoint: model, input: { messages: chat.messages } },
      })
    ).isError,
    true,
  );
  await publicClient.close();
  check("official MCP client discovery, inspection and metered execution");
  const stripe = new Stripe("sk_test_local_fixture");
  const event = {
    id: "evt_fixture",
    object: "event",
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_fixture",
        object: "checkout.session",
        payment_status: "paid",
        currency: "usd",
        amount_total: 1000,
        client_reference_id: alice.id,
        metadata: { userId: alice.id, amountMicros: "10000000" },
      },
    },
  };
  const payload = JSON.stringify(event);
  const signature = stripe.webhooks.generateTestHeaderString({
    payload,
    secret: environment.STRIPE_WEBHOOK_SECRET,
  });
  const beforeCredit = (await wallet(alice.id)).balanceUsd;
  const webhook = () =>
    fetch(origin + "/api/billing/webhook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "stripe-signature": signature,
      },
      body: payload,
    });
  const deliveries = await Promise.all([webhook(), webhook()]);
  assert.ok(deliveries.every((r) => r.status === 200));
  assert.equal(
    (await wallet(alice.id)).balanceUsd,
    Number((beforeCredit + 10).toFixed(6)),
  );
  assert.equal(
    (
      await fetch(origin + "/api/billing/webhook", {
        method: "POST",
        headers: { "stripe-signature": "bad" },
        body: payload,
      })
    ).status,
    400,
  );
  check(
    "signed Stripe webhook validation and exactly-once credit on duplicate delivery",
  );
  await pool.query(
    "UPDATE call_logs SET created_at=date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'-interval '1 hour'",
  );
  const rankings = (await request("/api/v1/rankings?period=7d")).json;
  const successes = (
    await pool.query(
      "SELECT count(*)::int AS n FROM call_logs WHERE status='success' AND agent_slug=$1",
      [slug],
    )
  ).rows[0].n;
  assert.equal(
    rankings.mostUsed.find((r: any) => r.slug === slug).calls,
    successes,
  );
  assert.ok(!rankings.mostUsed.some((r: any) => r.slug === "deepdig"));
  check("rankings aggregate successful real calls and exclude seeded figures");
  await pool.query(
    "UPDATE requests SET finished_at=now()-interval '25 hours' WHERE user_id=$1 AND idempotency_key='sdk-001'",
    [alice.id],
  );
  const expiryHits = hits["/ok"];
  assert.equal(
    (
      await request("/api/v1/chat/completions", "POST", chat, {
        ...bearer,
        "Idempotency-Key": "sdk-001",
      })
    ).status,
    410,
  );
  assert.equal(hits["/ok"], expiryHits);
  check("expired cached responses cannot re-execute an old task");
  const accountData = (
    await request("/api/account", "GET", undefined, { Cookie: alice.cookie })
  ).json;
  await request(
    "/api/account",
    "DELETE",
    { id: accountData.keys[0].id },
    { Cookie: alice.cookie },
  );
  assert.equal(
    (await request("/api/v1/chat/completions", "POST", chat, bearer)).status,
    401,
  );
  check("revoked keys immediately stop working");
  // Operator review regression uses local fixture endpoints only; no task is forwarded.
  const reviewSlug = await launch("Review Agent", alice.cookie);
  const reviewConfig = await configure(reviewSlug, alice.cookie, "/ok");
  const reviewPath = `/api/operator/endpoints/${reviewSlug}/run`;
  const version = async () =>
    (
      await pool.query(
        "SELECT review_version FROM endpoints WHERE agent_slug=$1 AND id='run'",
        [reviewSlug],
      )
    ).rows[0].review_version as number;
  const beforeReview = await version();
  assert.equal(
    (
      await request(
        reviewPath,
        "POST",
        { action: "disable", version: beforeReview, note: "Review fixture" },
        { Cookie: bob.cookie },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await request(
        reviewPath,
        "POST",
        { action: "disable", version: beforeReview, note: "Review fixture" },
        { Cookie: alice.cookie, Origin: "https://evil.example" },
      )
    ).status,
    403,
  );
  assert.equal(await version(), beforeReview);
  const { reviewEndpoint } = await import("../src/lib/endpoint-review");
  const previousOperators = process.env.OPERATOR_USER_IDS;
  const operator = { type: "operator" as const, id: bob.id, name: "Bob" };
  try {
    await assert.rejects(
      reviewEndpoint(
        reviewSlug,
        "run",
        { action: "disable", version: beforeReview, note: "Review fixture" },
        operator,
      ),
      /Operator access/,
    );
    process.env.OPERATOR_USER_IDS = `${alice.id},${bob.id}`;
    await assert.rejects(
      reviewEndpoint(
        reviewSlug,
        "run",
        { action: "approve", version: beforeReview, note: "" },
        { type: "operator", id: alice.id, name: "Alice" },
      ),
      /another operator/,
    );
    await reviewEndpoint(
      reviewSlug,
      "run",
      {
        action: "request_changes",
        version: beforeReview,
        note: "Explain what data this action sends to the provider.",
      },
      operator,
    );
    await assert.rejects(
      reviewEndpoint(
        reviewSlug,
        "run",
        { action: "approve", version: beforeReview, note: "" },
        operator,
      ),
      /changed after/,
    );
    let feedback = (
      await request(`/api/agents/${reviewSlug}/endpoints`, "GET", undefined, {
        Cookie: alice.cookie,
      })
    ).json;
    assert.equal(feedback.endpoints[0].review_status, "changes_requested");
    assert.equal(feedback.endpoints[0].approved, false);
    assert.equal(feedback.endpoints[0].config.credentialEnv, undefined);
    assert.equal(feedback.reviews[0].actor_name, "Bob");
    assert.match(feedback.reviews[0].note, /Explain what data/);
    assert.equal(feedback.reviews[0].config_snapshot, undefined);
    assert.equal(
      (
        await request(`/api/agents/${reviewSlug}/endpoints`, "GET", undefined, {
          Cookie: bob.cookie,
        })
      ).status,
      404,
    );
    const reviewed = await version();
    assert.equal(
      (
        await request(
          `/api/agents/${reviewSlug}/endpoints`,
          "PUT",
          reviewConfig,
          { Cookie: alice.cookie },
        )
      ).status,
      200,
    );
    assert.equal(await version(), reviewed + 1);
    await assert.rejects(
      reviewEndpoint(
        reviewSlug,
        "run",
        { action: "approve", version: reviewed, note: "" },
        operator,
      ),
      /changed after/,
    );
    const pending = await version();
    const approval = {
      action: "approve" as const,
      version: pending,
      note: "Contract and local fixture reviewed.",
      credentialEnv: "MAKER_TEST_TOKEN",
    };
    const competing = await Promise.allSettled([
      reviewEndpoint(reviewSlug, "run", approval, operator),
      reviewEndpoint(reviewSlug, "run", approval, operator),
    ]);
    assert.equal(competing.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(competing.filter((r) => r.status === "rejected").length, 1);
    await reviewEndpoint(
      reviewSlug,
      "run",
      {
        action: "disable",
        version: await version(),
        note: "Fixture review complete; leave this endpoint disabled.",
      },
      operator,
    );
    feedback = (
      await request(`/api/agents/${reviewSlug}/endpoints`, "GET", undefined, {
        Cookie: alice.cookie,
      })
    ).json;
    assert.equal(feedback.endpoints[0].review_status, "disabled");
    assert.equal(feedback.endpoints[0].approved, false);
    const audit = (
      await pool.query(
        "SELECT * FROM endpoint_reviews WHERE agent_slug=$1 ORDER BY created_at",
        [reviewSlug],
      )
    ).rows;
    assert.equal(audit.length, 4); // CLI approval, request changes, approval, disable.
    assert.equal(audit.filter((r) => r.actor_id === bob.id).length, 3);
    assert.ok(
      audit.every((r) => r.config_snapshot.credentialEnv === undefined),
    );
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM call_logs WHERE agent_slug=$1",
          [reviewSlug],
        )
      ).rows[0].n,
      0,
    );
    check(
      "operator access, owner feedback, stale/concurrent decisions, resubmission and atomic audit history",
    );
  } finally {
    if (previousOperators === undefined) delete process.env.OPERATOR_USER_IDS;
    else process.env.OPERATOR_USER_IDS = previousOperators;
  }
  // Price edits must not fall back to the stale listing JSON while pending.
  const priceOwner = await account("PriceOwner");
  const priceSlug = await launch("Price Regression", priceOwner.cookie);
  const priceConfig = await configure(priceSlug, priceOwner.cookie, "/ok");
  const priceSummary = async () => {
    const result = await request(`/api/v1/agents?q=Price%20Regression`);
    assert.equal(result.status, 200);
    return result.json.data.find(
      (a: { id: string }) => a.id === `fixture-maker/${priceSlug}`,
    );
  };
  assert.equal((await priceSummary()).pricing.priceUsd, 0.01);
  const savePrice = async (priceMicros: number) => {
    const result = await request(
      `/api/agents/${priceSlug}/endpoints`,
      "PUT",
      { ...priceConfig, priceMicros },
      { Cookie: priceOwner.cookie },
    );
    assert.equal(result.status, 200, JSON.stringify(result.json));
  };
  await savePrice(20000);
  let priced = await priceSummary();
  assert.equal(
    priced.pricing.priceUsd,
    0.02,
    "pending edit must replace the original listing price",
  );
  assert.equal(priced.endpoints[0].price_usd, 0.02);
  assert.equal(
    priced.runnable,
    false,
    "displaying a submitted price must not enable routing",
  );
  const filtered = await request(
    `/api/v1/agents?q=Price%20Regression&max_price=0.015`,
  );
  assert.equal(
    filtered.json.data.length,
    0,
    "price filters must use the edited price",
  );
  for (const route of [
    "/maker",
    `/agents?q=Price%20Regression`,
    `/agents/${priceSlug}`,
  ]) {
    const page = await fetch(origin + route, {
      headers: { Cookie: priceOwner.cookie },
    });
    assert.equal(page.status, 200);
    assert.ok(
      (await page.text()).includes("$0.02"),
      `${route} must show the updated price`,
    );
  }
  await configure(priceSlug, priceOwner.cookie, "/ok", {
    id: "other",
    priceMicros: 30000,
  });
  assert.equal(
    (await priceSummary()).pricing.priceUsd,
    0.03,
    "approved price takes precedence over cheaper pending prices",
  );
  await command([
    "scripts/ops.ts",
    "approve-endpoint",
    priceSlug,
    "run",
    "MAKER_TEST_TOKEN",
  ]);
  assert.equal(
    (await priceSummary()).pricing.priceUsd,
    0.02,
    "use the cheapest approved endpoint",
  );
  await command(["scripts/ops.ts", "disable-endpoint", priceSlug, "other"]);
  await savePrice(0);
  priced = await priceSummary();
  assert.equal(priced.pricing.priceUsd, 0);
  assert.equal(priced.pricing.model, "free");
  assert.equal(priced.runnable, false);
  await savePrice(12345);
  assert.equal((await priceSummary()).pricing.priceUsd, 0.012345);
  const detail = await fetch(origin + `/agents/${priceSlug}`);
  assert.ok(
    (await detail.text()).includes("$0.012345"),
    "display must preserve microdollar precision",
  );
  check(
    "edited endpoint prices, approval precedence, free pricing, filters and rendered price precision",
  );
  const fixtureAddress = upstream.address();
  assert.ok(fixtureAddress && typeof fixtureAddress !== "string");
  await onboardingChecks({
    origin,
    pool,
    account,
    request,
    command,
    check,
    upstreamUrl: `http://127.0.0.1:${fixtureAddress.port}/ok`,
  });
  for (const route of [
    "/",
    "/agents",
    "/rankings",
    "/launches?period=week",
    "/launches?period=month",
    "/docs",
    "/playground",
    "/account",
    `/agents/${slug}`,
    `/makers/${alice.id}`,
  ])
    assert.equal((await fetch(origin + route)).status, 200, route);
  check(
    "server-rendered catalog, launch boards, maker profile, docs and account screens",
  );
  console.log(
    `\n${passed} integration checks passed. Fixture traffic and payments only; no external provider was charged.`,
  );
}
main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (app && app.exitCode === null && app.signalCode === null) {
      app.kill("SIGTERM");
      await once(app, "exit").catch(() => {});
    }
    upstream.closeAllConnections();
    upstream.close();
    await pool.end();
    const { db } = await import("../src/lib/db");
    await db.end();
  });
