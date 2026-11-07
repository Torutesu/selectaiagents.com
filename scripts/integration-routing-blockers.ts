import assert from "node:assert/strict";
import type { Pool } from "pg";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

type Request = (
  path: string,
  method?: string,
  body?: unknown,
  headers?: Record<string, string>,
) => Promise<{ status: number; json: any }>;
export async function routingBlockerChecks({
  pool,
  request,
  bearer,
  userId,
  model,
  failedModel,
  hits,
  command,
  check,
}: {
  pool: Pool;
  request: Request;
  bearer: Record<string, string>;
  userId: string;
  model: string;
  failedModel: string;
  hits: Record<string, number>;
  command: (args: string[]) => Promise<void>;
  check: (name: string) => void;
}) {
  assert.equal(
    (await pool.query("SELECT current_database() AS name")).rows[0].name,
    "selectaiagents_test",
  );
  const call = (key: string, endpoint = model, fallbacks?: string[]) =>
    request(
      "/api/v1/run",
      "POST",
      {
        endpoint,
        input: { messages: [{ role: "user", content: "recovery check" }] },
        ...(fallbacks ? { fallbacks } : {}),
      },
      { ...bearer, "Idempotency-Key": key },
    );
  const record = async (key: string) =>
    (
      await pool.query(
        "SELECT * FROM requests WHERE user_id=$1 AND idempotency_key=$2",
        [userId, key],
      )
    ).rows[0];
  const wallet = async () =>
    (await pool.query("SELECT * FROM wallets WHERE user_id=$1", [userId]))
      .rows[0];

  await migrationUpgradeCheck(pool);
  check(
    "idempotent migration conservatively preserves legacy interrupted requests",
  );

  const before = hits["/fail"] ?? 0;
  const aliasKey = "duplicate-endpoint-alias";
  const failedSlug = failedModel.split("/")[1].split("#")[0];
  const duplicate = await call(aliasKey, failedSlug, [failedModel]);
  assert.equal(duplicate.status, 502, JSON.stringify(duplicate.json));
  assert.equal(hits["/fail"], before + 1);
  assert.equal((await record(aliasKey)).status, "failed");
  assert.equal(Number((await wallet()).reserved_micros), 0);
  assert.deepEqual(
    (await call(aliasKey, failedSlug, [failedModel])).json,
    duplicate.json,
  );
  assert.equal(hits["/fail"], before + 1);
  check(
    "endpoint aliases execute once, settle failure, and replay without locked credits",
  );

  // Fail real SQL writes, not a mocked gateway; triggers target only these requests.
  await pool.query(`CREATE FUNCTION test_interrupt_request() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.idempotency_key='interrupt-before' AND NEW.upstream_started AND NOT OLD.upstream_started THEN
      RAISE EXCEPTION 'test-only dispatch marker failure';
    END IF;
    IF NEW.idempotency_key='interrupt-settle' AND NEW.status='completed' THEN
      RAISE EXCEPTION 'test-only settlement failure';
    END IF;
    RETURN NEW; END $$;
    CREATE TRIGGER test_interrupt_request BEFORE UPDATE ON requests FOR EACH ROW EXECUTE FUNCTION test_interrupt_request();
    CREATE FUNCTION test_interrupt_log() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF EXISTS(SELECT 1 FROM requests WHERE id=NEW.request_id AND idempotency_key='interrupt-log') THEN
      RAISE EXCEPTION 'test-only call log failure';
    END IF;
    RETURN NEW; END $$;
    CREATE TRIGGER test_interrupt_log BEFORE INSERT ON call_logs FOR EACH ROW EXECUTE FUNCTION test_interrupt_log();`);
  try {
    const beforeWallet = await wallet();
    const beforeHits = hits["/ok"];
    assert.equal((await call("interrupt-before")).status, 500);
    const early = await record("interrupt-before");
    assert.equal(early.status, "failed");
    assert.equal(early.upstream_started, false);
    assert.equal(hits["/ok"], beforeHits);
    assert.equal(
      (await wallet()).reserved_micros,
      beforeWallet.reserved_micros,
    );
    assert.equal((await wallet()).balance_micros, beforeWallet.balance_micros);
    const replay = await call("interrupt-before");
    assert.equal(replay.status, 503);
    assert.equal(replay.json.error.code, "interrupted_before_dispatch");
    check(
      "pre-dispatch infrastructure failure refunds reservation and caches a non-executing failure",
    );

    for (const key of ["interrupt-log", "interrupt-settle"]) {
      const initial = await wallet();
      const count = hits["/ok"];
      assert.equal((await call(key)).status, 500);
      const pending = await record(key);
      assert.equal(pending.upstream_started, true);
      assert.equal(pending.needs_reconciliation, true);
      assert.equal(pending.status, "running");
      assert.equal((await wallet()).balance_micros, initial.balance_micros);
      assert.equal(
        Number((await wallet()).reserved_micros),
        Number(initial.reserved_micros) + 10000,
      );
      assert.equal(hits["/ok"], count + 1);
      const replay = await call(key);
      assert.equal(replay.status, 409);
      assert.equal(replay.json.error.code, "needs_reconciliation");
      assert.equal(hits["/ok"], count + 1);
      // The fixture returned successfully: operator verifies and settles once.
      await command([
        "scripts/ops.ts",
        "resolve-stalled",
        pending.id,
        "charge",
        "10000",
      ]);
      const resolved = await record(key);
      assert.equal(resolved.status, "failed");
      assert.equal(resolved.needs_reconciliation, false);
      assert.equal(Number(resolved.charged_micros), 10000);
      assert.equal(
        Number((await wallet()).balance_micros),
        Number(initial.balance_micros) - 10000,
      );
      assert.equal((await wallet()).reserved_micros, initial.reserved_micros);
      assert.equal((await call(key)).status, 502);
      assert.equal(hits["/ok"], count + 1);
      const { settle } = await import("../src/lib/billing");
      await settle(pending.id, 10000, {}, 200);
      assert.equal(
        Number((await wallet()).balance_micros),
        Number(initial.balance_micros) - 10000,
      );
      assert.equal(
        (
          await pool.query(
            "SELECT count(*)::int AS n FROM ledger WHERE reference=$1",
            [`call:${pending.id}`],
          )
        ).rows[0].n,
        1,
      );
      check(
        `${key}: uncertain execution is flagged, not retried, and reconciled exactly once`,
      );
    }
  } finally {
    await pool.query(
      "DROP TRIGGER IF EXISTS test_interrupt_request ON requests; DROP FUNCTION IF EXISTS test_interrupt_request(); DROP TRIGGER IF EXISTS test_interrupt_log ON call_logs; DROP FUNCTION IF EXISTS test_interrupt_log();",
    );
  }
}

export async function migrationUpgradeCheck(pool: Pool) {
  assert.equal(
    (await pool.query("SELECT current_database() AS name")).rows[0].name,
    "selectaiagents_test",
  );
  // Exercise an upgrade with an existing interrupted request, isolated from public.
  const migration = await readFile(
    new URL("../db/001_platform.sql", import.meta.url),
    "utf8",
  );
  const client = await pool.connect();
  const schema = `migration_${randomUUID().replaceAll("-", "")}`;
  try {
    await client.query("BEGIN");
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET LOCAL search_path TO ${schema}`);
    await client.query('CREATE TABLE "user" (id text PRIMARY KEY)');
    await client.query(migration.split("-- Additive and idempotent")[0]);
    await client.query(`INSERT INTO "user" VALUES('legacy-user')`);
    const insert =
      "INSERT INTO requests(id,user_id,idempotency_key,fingerprint,status,reserved_micros) VALUES($1,'legacy-user',$2,'test','running',0)";
    await client.query(insert, [randomUUID(), "legacy"]);
    await client.query(migration);
    await client.query(insert, [randomUUID(), "new"]);
    await client.query(migration);
    const flags = (
      await client.query(
        "SELECT idempotency_key,upstream_started FROM requests ORDER BY idempotency_key",
      )
    ).rows;
    assert.deepEqual(flags, [
      { idempotency_key: "legacy", upstream_started: true },
      { idempotency_key: "new", upstream_started: false },
    ]);
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
}
