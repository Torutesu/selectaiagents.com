"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client-api";
import { buildAgent } from "@/lib/submission";
import { endpointConfigSchema, validateConfig } from "@/lib/endpoint-config";
import { AgentDetails, emptyDetails, type Details } from "./AgentDetails";
import { EndpointFields, newEndpoint } from "./EndpointFields";
import { isLoopbackEndpoint } from "@/lib/endpoint-timeout";

export function Onboarding({
  initialId,
  initialDetails,
  initialEndpoint,
  allowLocalUpstream = false,
}: {
  initialId?: string;
  initialDetails?: Partial<Details>;
  initialEndpoint?: unknown;
  allowLocalUpstream?: boolean;
}) {
  const router = useRouter();
  const [id, setId] = useState(initialId);
  const [details, setDetails] = useState<Details>({
    ...emptyDetails,
    ...initialDetails,
  });
  const [text, setText] = useState(
    JSON.stringify(initialEndpoint ?? newEndpoint, null, 2),
  );
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    title.current?.focus();
  }, [step]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  function changed() {
    setDirty(true);
    setMessage("");
    setError("");
  }
  function validateDetails() {
    const result = buildAgent(
      { ...details, pricingModel: "free", priceUsd: 0, unit: "call" },
      new Set(),
    );
    if ("errors" in result)
      throw new Error(Object.values(result.errors).join(" "));
  }
  function endpoint() {
    let value;
    try {
      value = JSON.parse(text);
    } catch {
      throw new Error("Fix the endpoint JSON before continuing.");
    }
    return value;
  }
  function validateEndpoint() {
    const parsed = endpointConfigSchema.safeParse(endpoint());
    if (!parsed.success)
      throw new Error(
        parsed.error.issues
          .map((i) => `${i.path.join(" ")}: ${i.message}`)
          .join(" · "),
      );
    try {
      validateConfig(parsed.data);
    } catch {
      throw new Error(
        "Check your request and response schemas. Standard chat must use the chat.v1 schemas.",
      );
    }
    const url = new URL(parsed.data.url);
    if (
      (url.protocol !== "https:" &&
        !(allowLocalUpstream && isLoopbackEndpoint(parsed.data.url))) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error(
        "Use an HTTPS endpoint URL without credentials, query parameters, or fragments.",
      );
    return parsed.data;
  }
  async function save() {
    const result = await api<{ id: string }>(
      id ? `/api/maker/drafts/${id}` : "/api/maker/drafts",
      id ? "PUT" : "POST",
      { details, endpoint: endpoint() },
    );
    setId(result.id);
    setDirty(false);
    setMessage(
      "Draft saved privately. You can resume it from your maker dashboard.",
    );
    // Keep the saved draft address current without remounting the wizard.
    if (!id)
      window.history.replaceState(null, "", `/maker/drafts/${result.id}`);
    return result.id;
  }
  async function action(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await fn();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Could not save. Your changes are still here.",
      );
    } finally {
      setBusy(false);
    }
  }
  let preview: Record<string, unknown> = {};
  try {
    preview = JSON.parse(text) ?? {};
  } catch {}
  const steps = ["Agent details", "Endpoint setup", "Review & submit"];
  return (
    <div className="maker-onboarding">
      <ol className="maker-steps" aria-label="Launch progress">
        {steps.map((label, i) => (
          <li key={label} aria-current={i === step ? "step" : undefined}>
            <span>{i < step ? "✓" : `0${i + 1}`}</span>
            {label}
          </li>
        ))}
      </ol>
      <div className="maker-workspace">
        <section className="maker-panel">
          <div className="maker-panel-heading">
            <p className="eyebrow">Step {step + 1} of 3</p>
            <h2 ref={title} tabIndex={-1}>
              {
                [
                  "Start with the essentials.",
                  "Give your agent a connection.",
                  "Ready for its first introduction?",
                ][step]
              }
            </h2>
            <p>
              {
                [
                  "Tell people what your agent makes possible. Nothing is published until you submit.",
                  "Configure one action to start. You can add more from your dashboard later.",
                  "Your listing will be public after submission. Calls stay disabled until an operator approves the endpoint.",
                ][step]
              }
            </p>
          </div>
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
          <form
            onSubmit={(e) => {
              e.preventDefault();
              action(async () => {
                if (step === 0) {
                  validateDetails();
                  await save();
                  setStep(1);
                } else if (step === 1) {
                  validateEndpoint();
                  await save();
                  setStep(2);
                } else {
                  validateDetails();
                  validateEndpoint();
                  const draftId = await save();
                  const result = await api<{ slug: string }>(
                    `/api/maker/drafts/${draftId}/submit`,
                    "POST",
                  );
                  setDirty(false);
                  router.push(`/agents/${result.slug}/manage?submitted=1`);
                  router.refresh();
                }
              });
            }}
          >
            <fieldset disabled={busy} className="min-w-0">
              {step === 0 && (
                <AgentDetails
                  value={details}
                  onChange={(v) => {
                    setDetails(v);
                    changed();
                  }}
                />
              )}
              {step === 1 && (
                <EndpointFields
                  allowLocalUpstream={allowLocalUpstream}
                  text={text}
                  onChange={(v) => {
                    setText(v);
                    changed();
                  }}
                />
              )}
              {step === 2 && (
                <div className="maker-review">
                  <div>
                    <div className="maker-review-title">
                      <span className="eyebrow">The listing</span>
                      <button type="button" onClick={() => setStep(0)}>
                        Edit details ↗
                      </button>
                    </div>
                    <h3>{details.name}</h3>
                    <p>{details.tagline}</p>
                    <p className="text-sm text-muted whitespace-pre-wrap">
                      {details.description}
                    </p>
                    <dl>
                      <dt>Maker</dt>
                      <dd>{details.maker}</dd>
                      <dt>Category</dt>
                      <dd>{details.category}</dd>
                      <dt>Website</dt>
                      <dd className="break-all">{details.website}</dd>
                      <dt>Tags</dt>
                      <dd>{details.tags || "No tags"}</dd>
                    </dl>
                  </div>
                  <div>
                    <div className="maker-review-title">
                      <span className="eyebrow">The connection</span>
                      <button type="button" onClick={() => setStep(1)}>
                        Edit endpoint ↗
                      </button>
                    </div>
                    <dl>
                      <dt>Endpoint</dt>
                      <dd className="break-all">{String(preview.url ?? "")}</dd>
                      <dt>Format</dt>
                      <dd>
                        {String(preview.adapter)} · {String(preview.contract)}
                      </dd>
                      <dt>Price</dt>
                      <dd>
                        ${(Number(preview.priceMicros) / 1e6).toFixed(6)} per
                        successful call
                      </dd>
                      <dt>Timeout</dt>
                      <dd>{Number(preview.timeoutMs) / 1000} seconds</dd>
                      <dt>External changes</dt>
                      <dd>
                        {preview.sideEffects
                          ? "Yes or uncertain — cautious fallback"
                          : "Read-only / generated content"}
                      </dd>
                    </dl>
                  </div>
                  <div className="maker-notice">
                    <strong>What happens next?</strong>
                    <p>
                      Your listing appears in the directory. An operator reviews
                      the endpoint, approved host, pricing, and credentials
                      before turning on calls. Submission does not automatically
                      approve an agent.
                    </p>
                  </div>
                </div>
              )}
              <div className="maker-actions">
                {step > 0 && (
                  <button
                    type="button"
                    className="button button-outline"
                    onClick={() => {
                      setStep(step - 1);
                      setError("");
                    }}
                  >
                    ← Back
                  </button>
                )}
                <button
                  type="button"
                  className="maker-save"
                  onClick={() =>
                    action(async () => {
                      await save();
                    })
                  }
                >
                  Save draft
                </button>
                <button className="button button-dark" type="submit">
                  {busy
                    ? "Saving…"
                    : step === 2
                      ? "Submit for review"
                      : "Save & continue"}
                  <span aria-hidden="true">↗</span>
                </button>
              </div>
            </fieldset>
          </form>
        </section>
        <aside className="maker-sidebar">
          <p className="eyebrow">Your next launch</p>
          <h3>
            Small steps.
            <br />
            Real possibilities.
          </h3>
          <p>
            Start with one clear use case and one working endpoint. Describe
            what it does today.
          </p>
          <div className="maker-sidebar-note">
            <strong>Private until you submit</strong>
            <p>
              Saved drafts are visible only to your account. Save before leaving
              to keep your changes.
            </p>
          </div>
          <Link
            href="/maker"
            onClick={(e) => {
              if (
                dirty &&
                !window.confirm("Leave without saving your latest changes?")
              )
                e.preventDefault();
            }}
          >
            Maker dashboard ↗
          </Link>
          <Link href="/docs">API documentation ↗</Link>
          <span className="text-xs text-muted">
            {dirty ? "Unsaved changes" : id ? "Saved draft" : "New draft"}
          </span>
        </aside>
      </div>
    </div>
  );
}
