import { createHash, randomUUID } from "node:crypto";
import { db } from "./db";
import { reserve, settle, interruptRequest } from "./billing";
import {
  canonical,
  compileSchema,
  type EndpointConfig,
} from "./endpoint-config";
import { HttpError, limit } from "./http";
import {
  agentId,
  autoCandidates,
  healthyForRouting,
  noRouteMessage,
  referenceSlug,
  resolve,
} from "./router";
import { agentsBySlug, routableAgents } from "./store";
import { forward } from "./upstream";
import type { RunBody, ChatBody } from "./request-schema";
export { runSchema, chatSchema } from "./request-schema";

type Attempt = { model: string; status: string };

export async function execute(
  userId: string,
  body: RunBody | ChatBody,
  mode: "run" | "chat",
  key: string = randomUUID(),
) {
  if (!/^[\w.:-]{1,128}$/.test(key))
    throw new HttpError(400, "Invalid Idempotency-Key");
  await limit(`run:${userId}`, 60);
  const fingerprint = createHash("sha256")
    .update(canonical({ mode, body }))
    .digest("hex");
  const previous = (
    await db.query(
      "SELECT fingerprint,status,needs_reconciliation,response,response_status,finished_at FROM requests WHERE user_id=$1 AND idempotency_key=$2",
      [userId, key],
    )
  ).rows[0];
  if (previous) {
    if (previous.fingerprint !== fingerprint)
      throw new HttpError(
        409,
        "Idempotency key was used with a different request",
      );
    if (previous.status === "running")
      throw new HttpError(
        409,
        previous.needs_reconciliation
          ? "Request needs operator reconciliation; do not repeat the action"
          : "Request is already running; retry this key later",
        previous.needs_reconciliation ? "needs_reconciliation" : "in_progress",
      );
    if (
      !previous.response ||
      new Date(previous.finished_at).getTime() < Date.now() - 86400000
    )
      throw new HttpError(410, "Cached response expired");
    return {
      body: previous.response,
      status: previous.response_status as number,
    };
  }
  const chat = mode === "chat" ? (body as ChatBody) : undefined;
  const run = mode === "run" ? (body as RunBody) : undefined;
  const model = chat?.model ?? run!.endpoint;
  const fallbacks = chat?.models ?? run?.fallbacks ?? [];
  const input = chat ? { messages: chat.messages } : run!.input;
  let contract = chat ? "chat.v1" : body.route?.contract;
  if (model === "auto" && !contract)
    throw new HttpError(400, "Structured auto routing requires route.contract");
  // Load only the agents this request can reach, not the whole catalog: the
  // auto-routing pool for the contract, or the agents an explicit chain names.
  const agents =
    model === "auto" && contract
      ? await routableAgents(contract)
      : await agentsBySlug([model, ...fallbacks].map(referenceSlug));
  const configs = (
    await db.query(
      "SELECT agent_slug,id,config,approved FROM endpoints WHERE agent_slug = ANY($1::text[])",
      [agents.map((a) => a.slug)],
    )
  ).rows;
  const configMap = new Map(
    configs.map((row) => [`${row.agent_slug}#${row.id}`, row]),
  );
  const autoPool = agents.filter(
    (a) =>
      healthyForRouting(a) &&
      a.endpoints.some((e) => e.available && e.contract === contract),
  );
  let chain = [
    ...new Set(
      model === "auto"
        ? autoCandidates(autoPool, {
            ...body.route,
            query: chat?.messages.filter((m) => m.role === "user").at(-1)
              ?.content,
          }).flatMap((id) =>
            autoPool
              .find((a) => agentId(a) === id)!
              .endpoints.filter((e) => e.available && e.contract === contract)
              .map((e) => `${id}#${e.id}`),
          )
        : [model, ...fallbacks],
    ),
  ];
  if (model === "auto" && body.route?.sort === "price")
    chain = chain.sort(
      (a, b) =>
        (resolve(agents, a)?.endpoint.priceUsd ?? Infinity) -
        (resolve(agents, b)?.endpoint.priceUsd ?? Infinity),
    );
  const attempts: Attempt[] = [];
  const seen = new Set<string>();
  const candidates: { slug: string; model: string; config: EndpointConfig }[] =
    [];
  for (const reference of chain) {
    let hit = resolve(agents, reference);
    if (!hit) {
      attempts.push({ model: reference, status: "not_found" });
      continue;
    }
    // A bare agent reference means "this agent", not its alphabetically first
    // endpoint: prefer an approved endpoint for the contract, then any approved one.
    if (!reference.includes("#")) {
      const approved = hit.agent.endpoints.filter((e) => e.available);
      const endpoint =
        approved.find((e) => contract && e.contract === contract) ??
        approved[0];
      if (endpoint) hit = { agent: hit.agent, endpoint };
    }
    const row = configMap.get(`${hit.agent.slug}#${hit.endpoint.id}`);
    if (!row?.approved) {
      attempts.push({ model: reference, status: "not_configured" });
      continue;
    }
    const identity = `${hit.agent.slug}#${hit.endpoint.id}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    const config = row.config as EndpointConfig;
    // The explicit primary establishes a contract even when currently unhealthy.
    contract ??= config.contract;
    if (config.contract !== contract) {
      attempts.push({ model: reference, status: "incompatible" });
      continue;
    }
    if (config.priceMicros > (body.route?.maxPriceUsd ?? 10) * 1e6) {
      attempts.push({ model: reference, status: "over_budget" });
      continue;
    }
    if (
      !healthyForRouting(hit.agent) &&
      (model === "auto" || reference !== model)
    ) {
      attempts.push({ model: reference, status: "unavailable" });
      continue;
    }
    if (!compileSchema(config.inputSchema)(input)) {
      attempts.push({ model: reference, status: "invalid_input" });
      continue;
    }
    // Validate output schemas before reserving credits or contacting a maker.
    compileSchema(config.outputSchema);
    candidates.push({
      slug: hit.agent.slug,
      model: `${agentId(hit.agent)}#${config.id}`,
      config,
    });
    if (candidates.length === 9) break;
  }
  if (!candidates.length)
    return {
      status: attempts.some((a) => a.status === "invalid_input") ? 400 : 503,
      body: {
        error: {
          message: noRouteMessage(attempts),
          code: "no_route",
        },
        routing: { attempts },
      },
    };
  const reservation = await reserve(
    userId,
    key,
    fingerprint,
    Math.max(...candidates.map((c) => c.config.priceMicros)),
  );
  if (reservation.replay) return reservation.replay;
  let result: unknown;
  let status = 502;
  let charge = 0;
  try {
    // Durable dispatch marker: recovery must distinguish a safe refund from an
    // uncertain external action, even if the worker or database later fails.
    const started = await db.query(
      "UPDATE requests SET upstream_started=true WHERE id=$1 AND status='running' AND NOT needs_reconciliation RETURNING id",
      [reservation.id],
    );
    if (!started.rowCount) throw new Error("Request is no longer executable");
    for (const candidate of candidates) {
      const start = Date.now();
      let output: unknown;
      let outcome = "success";
      try {
        output = await forward(candidate.config, input, reservation.id);
        if (!compileSchema(candidate.config.outputSchema)(output))
          outcome = "invalid_output";
      } catch (error) {
        outcome =
          error instanceof Error &&
          ["TimeoutError", "AbortError"].includes(error.name)
            ? "timeout"
            : "failed";
      }
      await db.query(
        "INSERT INTO call_logs(id,request_id,agent_slug,endpoint_id,status,latency_ms) VALUES($1,$2,$3,$4,$5,$6)",
        [
          randomUUID(),
          reservation.id,
          candidate.slug,
          candidate.config.id,
          outcome,
          Date.now() - start,
        ],
      );
      attempts.push({ model: candidate.model, status: outcome });
      if (outcome === "success") {
        charge = candidate.config.priceMicros;
        status = 200;
        result = chat
          ? {
              id: `gen-${reservation.id}`,
              object: "chat.completion",
              created: Math.floor(Date.now() / 1000),
              model: candidate.model,
              choices: [
                {
                  index: 0,
                  finish_reason: "stop",
                  message: {
                    role: "assistant",
                    content: (output as { content: string }).content,
                  },
                },
              ],
              usage: { cost_usd: charge / 1e6 },
              routing: { attempts },
            }
          : {
              id: `run_${reservation.id}`,
              endpoint: candidate.model,
              output,
              usage: { costUsd: charge / 1e6 },
              routing: { attempts },
            };
        break;
      }
      // A timeout or error does not prove the maker did not perform an action.
      if (candidate.config.sideEffects) {
        attempts.push({
          model: candidate.model,
          status: "fallback_stopped_side_effect_risk",
        });
        break;
      }
    }
    result ??= {
      error: {
        message: "Agent execution failed; no credits were charged",
        code: "upstream_error",
      },
      routing: { attempts },
    };
    await settle(reservation.id, charge, result, status);
    return { body: result, status };
  } catch (error) {
    // If persistence is down, the durable dispatch marker and existing stale
    // request CLI remain the recovery path once the database is available.
    await interruptRequest(reservation.id).catch(() => {});
    throw error;
  }
}
