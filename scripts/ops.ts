import { randomUUID } from "node:crypto";
import { db } from "../src/lib/db";
import { reviewEndpoint } from "../src/lib/endpoint-review";
import { credit, settle } from "../src/lib/billing";

async function main() {
  const [command, arg1, arg2, arg3] = process.argv.slice(2);
  if (command === "approve-endpoint") {
    if (!arg1 || !arg2)
      throw new Error(
        "Usage: npm run ops -- approve-endpoint <agent-slug> <endpoint-id> [MAKER_CREDENTIAL_ENV]",
      );
    const row = (
      await db.query(
        "SELECT review_version FROM endpoints WHERE agent_slug=$1 AND id=$2",
        [arg1, arg2],
      )
    ).rows[0];
    if (!row) throw new Error("Endpoint not found");
    await reviewEndpoint(
      arg1,
      arg2,
      {
        action: "approve",
        version: row.review_version,
        note: "Approved through the operator CLI.",
        ...(arg3 ? { credentialEnv: arg3 } : {}),
      },
      { type: "cli" },
    );
    console.log(
      "Endpoint approved and audit recorded. No upstream request was sent.",
    );
  } else if (command === "disable-endpoint") {
    if (!arg1 || !arg2)
      throw new Error(
        "Usage: disable-endpoint <agent-slug> <endpoint-id> [reason]",
      );
    const row = (
      await db.query(
        "SELECT review_version FROM endpoints WHERE agent_slug=$1 AND id=$2",
        [arg1, arg2],
      )
    ).rows[0];
    if (!row) throw new Error("Endpoint not found");
    await reviewEndpoint(
      arg1,
      arg2,
      {
        action: "disable",
        version: row.review_version,
        note:
          arg3 ||
          "Disabled through the operator CLI. Contact the operator for details.",
      },
      { type: "cli" },
    );
    console.log("Endpoint disabled and audit recorded");
  } else if (command === "credit") {
    if (process.env.NODE_ENV === "production")
      throw new Error(
        "Development credits are disabled in production; use Stripe",
      );
    const amount = Number(arg2);
    if (!arg1 || !Number.isFinite(amount) || amount <= 0 || amount > 100)
      throw new Error("Usage: npm run ops -- credit <email> <USD, max 100>");
    const user = (
      await db.query('SELECT id FROM "user" WHERE email=$1', [arg1])
    ).rows[0];
    if (!user) throw new Error("Account not found");
    await credit(user.id, Math.round(amount * 1e6), `dev:${randomUUID()}`);
    console.log("Development credits added");
  } else if (command === "stalled") {
    console.table(
      (
        await db.query(
          "SELECT id,user_id,reserved_micros,upstream_started,needs_reconciliation,created_at FROM requests WHERE status='running' AND (needs_reconciliation OR created_at<now()-interval '10 minutes')",
        )
      ).rows,
    );
  } else if (command === "resolve-stalled") {
    if (!arg1 || !["refund", "charge"].includes(arg2) || !arg3)
      throw new Error(
        "Usage: resolve-stalled <request-id> refund|charge <verified-charge-micros>; inspect provider outcome first",
      );
    const request = (
      await db.query(
        "SELECT * FROM requests WHERE id=$1 AND status='running' AND (needs_reconciliation OR created_at<now()-interval '10 minutes')",
        [arg1],
      )
    ).rows[0];
    if (!request) throw new Error("Stalled request not found");
    const charge = arg2 === "refund" ? 0 : Number(arg3);
    if (
      !Number.isSafeInteger(charge) ||
      charge < 0 ||
      charge > Number(request.reserved_micros)
    )
      throw new Error("Invalid settlement amount");
    // A verified charge means the provider did the work: record the request
    // as completed (not failed) so history and replays match the ledger debit.
    await settle(
      arg1,
      charge,
      charge > 0
        ? {
            reconciled: true,
            message:
              "An operator verified this interrupted request completed upstream and charged it. The original output is unavailable; do not automatically repeat external actions.",
            usage: { costUsd: charge / 1e6 },
          }
        : {
            error: {
              message:
                "An operator reconciled this interrupted request. Do not automatically repeat external actions.",
            },
            usage: { costUsd: 0 },
          },
      charge > 0 ? 200 : 502,
    );
    console.log("Request reconciled");
  } else if (command === "cleanup") {
    await db.query(
      "UPDATE requests SET response=NULL WHERE finished_at<now()-interval '24 hours'",
    );
    await db.query(
      "DELETE FROM rate_limits WHERE expires_at<now()-interval '1 day'",
    );
    console.log("Expired cached responses and rate limit buckets removed");
  } else
    throw new Error(
      "Commands: approve-endpoint, disable-endpoint, credit, stalled, resolve-stalled, cleanup",
    );
}
main()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(() => db.end());
