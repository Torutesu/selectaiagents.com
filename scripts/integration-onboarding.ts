import assert from "node:assert/strict";
import type { Pool } from "pg";
import { CHAT_INPUT, CHAT_OUTPUT } from "../src/lib/endpoint-config";

interface Account {
  id: string;
  cookie: string;
}
interface Harness {
  origin: string;
  pool: Pool;
  account(name: string): Promise<Account>;
  request(
    path: string,
    method?: string,
    body?: unknown,
    headers?: Record<string, string>,
  ): Promise<{ status: number; json: any }>;
  command(args: string[]): Promise<void>;
  check(name: string): void;
  upstreamUrl: string;
}

/** Runs through real HTTP routes and PostgreSQL in the existing isolated suite. */
export async function onboardingChecks(h: Harness) {
  const { pool, request, check } = h;
  assert.equal(
    (await pool.query("SELECT current_database() AS name")).rows[0].name,
    "selectaiagents_test",
  );
  const owner = await h.account("DraftOwner");
  const stranger = await h.account("DraftStranger");
  const invalidOwner = await h.account("InvalidDraftOwner");
  const details = {
    name: "Private Draft Fixture",
    maker: "Draft Maker",
    tagline: "Private draft marker before publication",
    description: "A private fixture for testing maker onboarding persistence.",
    category: "research",
    website: "https://example.test",
    tags: "onboarding, fixture",
  };
  const endpoint = {
    id: "run",
    description: "Read-only local onboarding fixture",
    url: h.upstreamUrl,
    adapter: "json",
    contract: "chat.v1",
    inputSchema: CHAT_INPUT,
    outputSchema: CHAT_OUTPUT,
    priceMicros: 12345,
    timeoutMs: 2000,
    sideEffects: false,
  };
  const body = { details, endpoint };
  const create = async (user: Account, value: unknown) => {
    const result = await request("/api/maker/drafts", "POST", value, {
      Cookie: user.cookie,
    });
    assert.equal(result.status, 201, JSON.stringify(result.json));
    assert.match(result.json.id, /^[0-9a-f-]{36}$/);
    return result.json.id as string;
  };
  const save = (id: string, value: unknown, user = owner) =>
    request(`/api/maker/drafts/${id}`, "PUT", value, { Cookie: user.cookie });
  const submit = (id: string, user = owner) =>
    request(`/api/maker/drafts/${id}/submit`, "POST", undefined, {
      Cookie: user.cookie,
    });
  const row = async (id: string) =>
    (await pool.query("SELECT * FROM maker_drafts WHERE id=$1", [id])).rows[0];
  const page = async (path: string, user?: Account) => {
    const response = await fetch(h.origin + path, {
      headers: user ? { Cookie: user.cookie } : {},
      redirect: "manual",
    });
    return { response, html: await response.text() };
  };
  const id = await create(owner, {
    details: { name: details.name },
    endpoint: null,
  });

  // An authenticated account must not be able to read, overwrite or publish
  // another maker's draft, even when it knows the UUID.
  for (const [path, method, value] of [
    ["/api/maker/drafts", "POST", body],
    [`/api/maker/drafts/${id}`, "PUT", body],
    [`/api/maker/drafts/${id}/submit`, "POST", undefined],
  ] as const) {
    assert.equal((await request(path, method, value)).status, 401);
    assert.equal(
      (
        await request(path, method, value, {
          Cookie: owner.cookie,
          Origin: "https://evil.example",
        })
      ).status,
      403,
    );
  }
  const original = await row(id);
  assert.equal((await save(id, body, stranger)).status, 404);
  assert.equal((await submit(id, stranger)).status, 404);
  assert.deepEqual(await row(id), original);
  const foreignPage = await page(`/maker/drafts/${id}`, stranger);
  // Next may stream a not-found boundary with HTTP 200; verify the boundary
  // and absence of private data as well as the response status.
  assert.ok(
    foreignPage.response.status === 404 ||
      foreignPage.html.includes("NEXT_HTTP_ERROR_FALLBACK;404"),
  );
  assert.ok(!foreignPage.html.includes(details.name));
  assert.ok(!(await page("/maker", stranger)).html.includes(details.name));
  const anonymousPage = await page(`/maker/drafts/${id}`);
  assert.equal(anonymousPage.response.status, 307);
  assert.equal(anonymousPage.response.headers.get("location"), "/account");
  check(
    "onboarding: draft ownership, unauthenticated access and same-origin protection",
  );

  assert.equal((await save(id, body)).status, 200);
  const saved = await row(id);
  assert.deepEqual(saved.details, details);
  assert.deepEqual(saved.endpoint, endpoint);
  assert.equal(saved.published_slug, null);
  const resumed = await page(`/maker/drafts/${id}`, owner);
  assert.equal(resumed.response.status, 200);
  assert.ok(resumed.html.includes(details.name));
  assert.ok(resumed.html.includes(details.tagline));
  assert.ok((await page("/maker", owner)).html.includes(`/maker/drafts/${id}`));
  assert.deepEqual(
    (await request("/api/v1/agents?q=Private%20Draft%20Fixture")).json.data,
    [],
  );
  assert.ok(
    !JSON.stringify((await request("/api/v1/models")).json).includes(
      "private-draft-fixture",
    ),
  );
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM agents WHERE owner_id=$1",
        [owner.id],
      )
    ).rows[0].n,
    0,
  );
  check(
    "onboarding: saved details and endpoint survive resume without entering discovery",
  );

  const results = await Promise.all(
    Array.from({ length: 3 }, () => submit(id)),
  );
  for (const result of results)
    assert.equal(result.status, 200, JSON.stringify(result.json));
  const slug = results[0].json.slug as string;
  assert.ok(slug);
  for (const result of results) assert.equal(result.json.slug, slug);
  const replay = await submit(id);
  assert.equal(replay.status, 200);
  assert.equal(replay.json.slug, slug);
  assert.equal((await row(id)).published_slug, slug);
  const counts = await pool.query(
    `SELECT (SELECT count(*)::int FROM agents WHERE owner_id=$1) AS agents,
      (SELECT count(*)::int FROM endpoints WHERE agent_slug=$2) AS endpoints`,
    [owner.id, slug],
  );
  assert.deepEqual(counts.rows[0], { agents: 1, endpoints: 1 });
  const published = await row(id);
  assert.equal(
    (
      await save(id, {
        ...body,
        details: { ...details, name: "Overwrite attempt" },
      })
    ).status,
    404,
  );
  assert.deepEqual(await row(id), published);
  const submittedPage = await page(`/maker/drafts/${id}`, owner);
  assert.equal(submittedPage.response.status, 307);
  assert.equal(
    submittedPage.response.headers.get("location"),
    `/agents/${slug}/manage`,
  );
  check(
    "onboarding: simultaneous submission and replay publish exactly one listing and endpoint",
  );

  const assertUnpublished = async (draftId: string) => {
    assert.equal((await row(draftId)).published_slug, null);
    const result = await pool.query(
      `SELECT (SELECT count(*)::int FROM agents WHERE owner_id=$1) AS agents,
        (SELECT count(*)::int FROM endpoints e JOIN agents a ON a.slug=e.agent_slug WHERE a.owner_id=$1) AS endpoints`,
      [invalidOwner.id],
    );
    assert.deepEqual(result.rows[0], { agents: 0, endpoints: 0 });
  };
  for (const value of [
    { details: { ...details, name: "Missing Endpoint" }, endpoint: null },
    {
      details: { ...details, name: "Invalid Details", description: "short" },
      endpoint,
    },
    {
      details: { ...details, name: "Invalid Contract" },
      endpoint: { ...endpoint, outputSchema: { type: "number" } },
    },
  ]) {
    const invalidId = await create(invalidOwner, value);
    const before = await row(invalidId);
    assert.equal((await submit(invalidId, invalidOwner)).status, 400);
    assert.deepEqual(await row(invalidId), before);
    await assertUnpublished(invalidId);
  }
  check(
    "onboarding: incomplete details, missing endpoint and invalid contracts leave no published records",
  );

  // Force failure AFTER the listing insert, proving rollback rather than
  // merely testing validation that happens before any database write.
  const rollbackId = await create(invalidOwner, {
    details: { ...details, name: "Onboarding Rollback Fixture" },
    endpoint,
  });
  await pool.query(`CREATE FUNCTION onboarding_fail_endpoint() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.agent_slug = 'onboarding-rollback-fixture' THEN
        RAISE EXCEPTION 'Intentional onboarding test failure';
      END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER onboarding_fail_endpoint BEFORE INSERT ON endpoints
      FOR EACH ROW EXECUTE FUNCTION onboarding_fail_endpoint()`);
  try {
    assert.equal((await submit(rollbackId, invalidOwner)).status, 500);
    await assertUnpublished(rollbackId);
  } finally {
    await pool.query(
      "DROP TRIGGER onboarding_fail_endpoint ON endpoints; DROP FUNCTION onboarding_fail_endpoint()",
    );
  }
  assert.equal((await submit(rollbackId, invalidOwner)).status, 200);
  check(
    "onboarding: endpoint insert failure rolls back the listing and allows a clean retry",
  );

  const collisionBody = {
    details: { ...details, name: "Draft Name Collision" },
    endpoint,
  };
  const collisionIds = [
    await create(stranger, collisionBody),
    await create(stranger, collisionBody),
  ];
  const collisions = await Promise.all(
    collisionIds.map((draftId) => submit(draftId, stranger)),
  );
  assert.deepEqual(collisions.map((r) => r.status).sort(), [200, 409]);
  const loser = collisionIds[collisions.findIndex((r) => r.status === 409)];
  assert.equal((await row(loser)).published_slug, null);
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM agents WHERE owner_id=$1",
        [stranger.id],
      )
    ).rows[0].n,
    1,
  );
  assert.equal(
    (
      await save(
        loser,
        {
          ...collisionBody,
          details: { ...details, name: "Renamed Collision Fixture" },
        },
        stranger,
      )
    ).status,
    200,
  );
  assert.equal((await submit(loser, stranger)).status, 200);
  check(
    "onboarding: competing drafts with the same name conflict safely and remain editable",
  );

  const endpointRow = async () =>
    (
      await pool.query(
        "SELECT * FROM endpoints WHERE agent_slug=$1 AND id='run'",
        [slug],
      )
    ).rows[0];
  assert.equal((await endpointRow()).approved, false);
  await h.command([
    "scripts/ops.ts",
    "approve-endpoint",
    slug,
    "run",
    "MAKER_TEST_TOKEN",
  ]);
  const approved = await endpointRow();
  assert.equal(approved.approved, true);
  assert.equal(approved.config.credentialEnv, "MAKER_TEST_TOKEN");
  const edited = {
    ...endpoint,
    priceMicros: 20000,
    description: "Updated read-only fixture action",
  };
  const edit = await request(`/api/agents/${slug}/endpoints`, "PUT", edited, {
    Cookie: owner.cookie,
  });
  assert.equal(edit.status, 200);
  const pending = await endpointRow();
  assert.equal(pending.approved, false);
  assert.equal(pending.review_status, "pending");
  assert.equal(pending.review_version, approved.review_version + 1);
  assert.equal(pending.config.credentialEnv, undefined);
  assert.deepEqual(pending.config, edited);
  const discovery = (
    await request("/api/v1/agents?q=Private%20Draft%20Fixture")
  ).json.data[0];
  assert.equal(discovery.runnable, false);
  assert.equal(discovery.endpoints[0].available, false);
  const listedModel = (await request("/api/v1/models")).json.data.find(
    (model: { id: string }) => model.id === `draft-maker/${slug}`,
  );
  assert.equal(listedModel.runnable, false);
  const blockedCall = await request(
    "/api/v1/chat/completions",
    "POST",
    {
      model: `draft-maker/${slug}#run`,
      messages: [
        { role: "user", content: "This unapproved endpoint must not execute" },
      ],
    },
    { Cookie: owner.cookie },
  );
  assert.equal(blockedCall.status, 503);
  assert.equal(blockedCall.json.routing.attempts[0].status, "not_configured");
  check(
    "onboarding: endpoint edits revoke approval, clear credentials and remove routing eligibility",
  );
}
