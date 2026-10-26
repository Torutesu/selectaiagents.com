import { randomUUID } from "node:crypto";
import { transaction } from "./db";
import { HttpError } from "./http";
import {
  canonical,
  endpointConfigSchema,
  validateConfig,
} from "./endpoint-config";
import { targetAddresses } from "./upstream";
import { isOperator } from "./operator-access";
import { validateExecutionTimeout } from "./endpoint-timeout";

import { reviewDecisionSchema, type ReviewDecision } from "./review-decision";
export { reviewDecisionSchema } from "./review-decision";
export type ReviewActor =
  { type: "operator"; id: string; name: string } | { type: "cli" };

/** Both the UI and CLI use the same validation, row lock and atomic audit write. */
export async function reviewEndpoint(
  slug: string,
  endpointId: string,
  decision: ReviewDecision,
  actor: ReviewActor,
) {
  decision = reviewDecisionSchema.parse(decision);
  if (actor.type === "operator" && !isOperator(actor.id))
    throw new HttpError(403, "Operator access required");
  return transaction(async (c) => {
    // Keep contract compatibility checks race-safe across separate endpoints.
    await c.query("SELECT pg_advisory_xact_lock(72190422)");
    const row = (
      await c.query(
        `SELECT e.*,a.owner_id,a.demo FROM endpoints e JOIN agents a ON a.slug=e.agent_slug
      WHERE e.agent_slug=$1 AND e.id=$2 FOR UPDATE OF e`,
        [slug, endpointId],
      )
    ).rows[0];
    if (!row || row.demo) throw new HttpError(404, "Endpoint not found");
    if (row.review_version !== decision.version)
      throw new HttpError(
        409,
        "This endpoint changed after you opened it. Reload and review the latest version.",
      );
    if (
      actor.type === "operator" &&
      actor.id === row.owner_id &&
      decision.action === "approve"
    )
      throw new HttpError(
        403,
        "Ask another operator to approve your own agent.",
      );
    const { credentialEnv: previousCredential, ...snapshot } = row.config;
    void previousCredential;
    let config = snapshot;
    if (decision.action === "approve") {
      try {
        config = endpointConfigSchema.parse(snapshot);
        validateConfig(config);
        validateExecutionTimeout(config);
      } catch {
        throw new HttpError(
          400,
          "The endpoint schema or adapter is invalid. Request changes from the maker.",
        );
      }
      try {
        await targetAddresses(config.url);
      } catch {
        throw new HttpError(
          400,
          "Host validation failed. Configure the exact ROUTER_ALLOWED_HOSTS entry and check public HTTPS/DNS before approval.",
        );
      }
      if (decision.credentialEnv && !process.env[decision.credentialEnv])
        throw new HttpError(
          400,
          "The selected maker credential is not configured on this server.",
        );
      const others = (
        await c.query(
          "SELECT config FROM endpoints WHERE approved AND config->>'contract'=$1 AND NOT(agent_slug=$2 AND id=$3)",
          [config.contract, slug, endpointId],
        )
      ).rows;
      if (
        others.some(
          (r) =>
            canonical(r.config.inputSchema) !== canonical(config.inputSchema) ||
            canonical(r.config.outputSchema) !== canonical(config.outputSchema),
        )
      )
        throw new HttpError(
          400,
          "Schemas conflict with an approved endpoint using this contract. Request a new versioned contract.",
        );
      if (decision.credentialEnv)
        config = { ...config, credentialEnv: decision.credentialEnv };
    }
    const status = {
      approve: "approved",
      request_changes: "changes_requested",
      disable: "disabled",
    }[decision.action];
    await c.query(
      `UPDATE endpoints SET approved=$3,review_status=$4,review_version=review_version+1,
      config=$5,updated_at=now() WHERE agent_slug=$1 AND id=$2`,
      [slug, endpointId, decision.action === "approve", status, config],
    );
    await c.query(
      `INSERT INTO endpoint_reviews(id,agent_slug,endpoint_id,reviewed_version,action,actor_id,actor_name,actor_type,note,config_snapshot)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        randomUUID(),
        slug,
        endpointId,
        decision.version,
        decision.action,
        actor.type === "operator" ? actor.id : null,
        actor.type === "operator" ? actor.name : "Operator CLI (server access)",
        actor.type,
        decision.note,
        snapshot,
      ],
    );
    return { status, version: decision.version + 1 };
  });
}
