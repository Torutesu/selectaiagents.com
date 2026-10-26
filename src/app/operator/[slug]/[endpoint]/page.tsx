import { isLoopbackEndpoint, localUpstreamEnabled } from "@/lib/endpoint-timeout";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { operatorPage } from "@/lib/operator-page";
import {
  reviewLabels,
  actionLabels,
  type ReviewStatus,
  type ReviewEvent,
} from "@/lib/review-types";
import { ReviewActions } from "@/components/operator/ReviewActions";
export const dynamic = "force-dynamic";
export default async function ReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; endpoint: string }>;
  searchParams: Promise<{ historyPage?: string }>;
}) {
  const user = await operatorPage();
  const { slug, endpoint } = await params;
  const row = (
    await db.query(
      `SELECT e.*,a.owner_id,a.data->>'name' AS name,a.data->>'maker' AS maker,
    a.data->>'description' AS description FROM endpoints e JOIN agents a ON a.slug=e.agent_slug
    WHERE e.agent_slug=$1 AND e.id=$2 AND NOT a.demo`,
      [slug, endpoint],
    )
  ).rows[0];
  if (!row) notFound();
  const page = Math.max(
    1,
    Math.min(
      10000,
      Number.parseInt((await searchParams).historyPage ?? "1", 10) || 1,
    ),
  );
  const history = (
    await db.query(
      "SELECT * FROM endpoint_reviews WHERE agent_slug=$1 AND endpoint_id=$2 ORDER BY created_at DESC,id DESC LIMIT 21 OFFSET $3",
      [slug, endpoint, (page - 1) * 20],
    )
  ).rows;
  const config = row.config;
  let host = "Invalid URL";
  try {
    host = new URL(config.url).hostname;
  } catch {}
  const allowed = (process.env.ROUTER_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .includes(host.toLowerCase());
  const credentials = Object.keys(process.env)
    .filter((k) => /^MAKER_[A-Z0-9_]+$/.test(k) && process.env[k])
    .sort();
  const path = `/operator/${encodeURIComponent(slug)}/${encodeURIComponent(endpoint)}`;
  return (
    <div className="space-y-8">
      <header>
        <Link href="/operator" className="eyebrow">
          ← Endpoint review queue
        </Link>
        <div className="maker-dashboard-heading">
          <h1>{row.name}</h1>
          <span
            className="maker-status"
            data-tone={
              row.approved
                ? "live"
                : row.review_status === "pending"
                  ? "pending"
                  : "attention"
            }
          >
            {reviewLabels[row.review_status as ReviewStatus]}
          </span>
        </div>
        <p className="mt-4 text-muted">
          {row.maker} · {endpoint} · Version {row.review_version}
        </p>
      </header>
      <section className="maker-panel">
        <div className="maker-panel-heading">
          <p className="eyebrow">Submitted connection</p>
          <h2>Review what will run.</h2>
          <p>{row.description}</p>
        </div>
        <dl className="operator-details">
          <dt>Endpoint URL</dt>
          <dd className="break-all">{config.url}</dd>
          <dt>Action</dt>
          <dd>{config.description}</dd>
          <dt>Format / contract</dt>
          <dd>
            {config.adapter} / {config.contract}
          </dd>
          {config.upstreamModel && (
            <>
              <dt>Provider model</dt>
              <dd>{config.upstreamModel}</dd>
            </>
          )}
          <dt>Price</dt>
          <dd>${(config.priceMicros / 1e6).toFixed(6)} per successful call</dd>
          <dt>Timeout</dt>
          <dd>{config.timeoutMs / 1000} seconds</dd>
          <dt>Declared external changes</dt>
          <dd>
            {config.sideEffects
              ? "Yes or uncertain"
              : "Read-only / generated content"}
          </dd>
          <dt>Host allowlist</dt>
          <dd>
            {localUpstreamEnabled() && isLoopbackEndpoint(config.url)
              ? `${host} is permitted by local development mode. Never expose this agent as a shared service.`
              : allowed
              ? `${host} is listed. DNS and network policy are rechecked on approval.`
              : `${host} is not in ROUTER_ALLOWED_HOSTS. Configure it on the server before approving.`}
          </dd>
          <dt>Current authentication</dt>
          <dd>
            {config.credentialEnv
              ? `${config.credentialEnv} (${credentials.includes(config.credentialEnv) ? "configured" : "missing on this server"})`
              : "No attached credential reference"}
          </dd>
          <dt>Last updated</dt>
          <dd>{new Date(row.updated_at).toISOString()}</dd>
        </dl>
        <div className="operator-schemas">
          {[
            ["Request schema", config.inputSchema],
            ["Response schema", config.outputSchema],
          ].map(([label, schema]) => (
            <div key={String(label)}>
              <h3>{String(label)}</h3>
              <pre>{JSON.stringify(schema, null, 2)}</pre>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted mt-5">
          These are the maker’s declarations. Approval does not contact the
          endpoint or certify its behavior.
        </p>
      </section>
      <ReviewActions
        key={row.review_version}
        slug={slug}
        endpoint={endpoint}
        version={row.review_version}
        credentials={credentials}
        currentCredential={config.credentialEnv}
        selfOwned={row.owner_id === user.id}
      />
      <section className="maker-panel">
        <div className="maker-panel-heading">
          <p className="eyebrow">Audit history</p>
          <h2>Every decision, recorded.</h2>
          <p>
            Review records are retained when a maker edits or resubmits.
            Credential references and values are excluded from configuration
            snapshots.
          </p>
        </div>
        {!history.length ? (
          <p className="text-sm text-muted">
            No review decisions recorded. Existing approvals from before this
            feature have no historical reviewer record.
          </p>
        ) : (
          <ol className="review-history">
            {history
              .slice(0, 20)
              .map(
                (
                  event: ReviewEvent & {
                    actor_id: string | null;
                    config_snapshot: unknown;
                  },
                ) => (
                  <li key={event.id}>
                    <div className="review-event-heading">
                      <strong>{actionLabels[event.action]}</strong>
                      <time>{new Date(event.created_at).toISOString()}</time>
                    </div>
                    <p className="text-sm text-muted">
                      {event.actor_name} ·{" "}
                      {event.actor_type === "cli"
                        ? "Server CLI"
                        : `Operator account ${event.actor_id ?? "deleted"}`}{" "}
                      · reviewed version {event.reviewed_version}
                    </p>
                    <p className="review-note">
                      {event.note || "No note added."}
                    </p>
                    <details className="maker-advanced">
                      <summary>Configuration at review time</summary>
                      <pre className="operator-snapshot">
                        {JSON.stringify(event.config_snapshot, null, 2)}
                      </pre>
                    </details>
                  </li>
                ),
              )}
          </ol>
        )}
        <div className="operator-pagination">
          {page > 1 && (
            <Link href={`${path}?historyPage=${page - 1}`}>
              ← Newer decisions
            </Link>
          )}
          <span>History page {page}</span>
          {history.length > 20 && (
            <Link href={`${path}?historyPage=${page + 1}`}>
              Older decisions →
            </Link>
          )}
        </div>
      </section>
    </div>
  );
}
