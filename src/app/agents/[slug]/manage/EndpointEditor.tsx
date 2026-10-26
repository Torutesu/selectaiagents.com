"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client-api";
import { EndpointFields, newEndpoint } from "@/components/maker/EndpointFields";
import type { EndpointConfig } from "@/lib/endpoint-config";
import { ReviewFeedback } from "@/components/maker/ReviewFeedback";
import {
  reviewLabels,
  type ReviewStatus,
  type ReviewEvent,
} from "@/lib/review-types";
type Entry = {
  id: string;
  approved: boolean;
  config: EndpointConfig;
  review_status: ReviewStatus;
  review_version: number;
};
type Review = ReviewEvent & { endpoint_id: string };
type Response = { endpoints: Entry[]; reviews: Review[] };
export function EndpointEditor({
  slug,
  allowLocalUpstream = false,
}: {
  slug: string;
  allowLocalUpstream?: boolean;
}) {
  const router = useRouter();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [text, setText] = useState(JSON.stringify(newEndpoint, null, 2));
  const [selected, setSelected] = useState<string>();
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [dirty, setDirty] = useState(false);
  const path = `/api/agents/${slug}/endpoints`;
  useEffect(() => {
    let active = true;
    api<Response>(path)
      .then((data) => {
        if (!active) return;
        setEntries(data.endpoints);
        setReviews(data.reviews);
        if (data.endpoints[0]) {
          setSelected(data.endpoints[0].id);
          setText(JSON.stringify(data.endpoints[0].config, null, 2));
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [path]);
  function select(entry?: Entry) {
    if (dirty && !window.confirm("Discard unsaved endpoint changes?")) return;
    setSelected(entry?.id);
    setText(
      JSON.stringify(entry?.config ?? { ...newEndpoint, id: "" }, null, 2),
    );
    setDirty(false);
    setMessage("");
    setError("");
  }
  return (
    <section className="maker-panel">
      <div className="maker-panel-heading">
        <p className="eyebrow">02 / Connections & pricing</p>
        <h2>Give your agent work to do.</h2>
        <p>
          Each endpoint is one action. Saving changes disables that endpoint
          until an operator approves it again.
        </p>
      </div>
      {loading ? (
        <p>Loading endpoints…</p>
      ) : (
        <>
          <div className="maker-endpoint-tabs">
            {entries.map((e) => (
              <button
                type="button"
                disabled={busy}
                aria-pressed={selected === e.id}
                key={e.id}
                onClick={() => select(e)}
              >
                <strong>{e.id}</strong>
                <span>{reviewLabels[e.review_status]}</span>
              </button>
            ))}
            <button type="button" disabled={busy} onClick={() => select()}>
              + Add endpoint
            </button>
          </div>
          {entries
            .filter((e) => e.id === selected)
            .map((e) => (
              <ReviewFeedback
                key={e.id}
                status={e.review_status}
                version={e.review_version}
                reviews={reviews.filter((r) => r.endpoint_id === e.id)}
              />
            ))}
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              setMessage("");
              try {
                const config = JSON.parse(text);
                if (selected && config.id !== selected)
                  throw new Error(
                    "Keep the endpoint name unchanged. Use Add endpoint to create a new action.",
                  );
                if (
                  !selected &&
                  entries.some((entry) => entry.id === config.id)
                )
                  throw new Error(
                    "That endpoint already exists. Select it above to edit.",
                  );
                const result = await api<{ message: string }>(
                  path,
                  "PUT",
                  config,
                );
                setDirty(false);
                setSelected(config.id);
                setMessage(result.message);
                const data = await api<Response>(path);
                setEntries(data.endpoints);
                setReviews(data.reviews);
                router.refresh();
              } catch (e) {
                setError(
                  e instanceof Error ? e.message : "Could not save endpoint.",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            <fieldset disabled={busy}>
              <EndpointFields
                allowLocalUpstream={allowLocalUpstream}
                text={text}
                onChange={(v) => {
                  setText(v);
                  setDirty(true);
                  setMessage("");
                }}
                lockId={Boolean(selected)}
              />
              <div className="maker-actions">
                <button className="button button-dark">
                  {busy ? "Saving…" : "Save for approval"}
                  <span>↗</span>
                </button>
                <span className="text-xs text-muted">
                  {dirty ? "Unsaved changes" : "No unsaved changes"}
                </span>
              </div>
            </fieldset>
          </form>
        </>
      )}
      {error && (
        <p role="alert" className="maker-notice text-down">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="maker-notice">
          {message}
        </p>
      )}
    </section>
  );
}
