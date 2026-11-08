"use client";

import { useState } from "react";
import { CATEGORIES } from "@/lib/types";
import Link from "next/link";
import { authClient } from "@/lib/auth-client";

interface Option {
  id: string;
  name: string;
}

interface Turn {
  role: "user" | "assistant" | "error";
  content: string;
  meta?: {
    model: string;
    attempts: { model: string; status: string }[];
    cost?: number;
  };
}

const input =
  "w-full rounded-md border border-line bg-surface px-2 py-1.5 text-sm";

export function Playground({
  options,
  initialModel,
}: {
  options: Option[];
  initialModel?: string;
}) {
  const { data: session } = authClient.useSession();
  const [maxPrice, setMaxPrice] = useState("0.10");
  const requested = initialModel
    ? options.find(
        (o) => o.id === initialModel || o.id.split("#")[0] === initialModel,
      )
    : undefined;
  // A linked agent that cannot be called must not silently become "auto":
  // that would send a paid task to a different agent. Require a choice.
  const unavailable = Boolean(initialModel) && !requested;
  const [model, setModel] = useState(
    requested?.id ?? (unavailable ? "" : "auto"),
  );
  const [fallbacks, setFallbacks] = useState<string[]>([]);
  const [sort, setSort] = useState("usage");
  const [category, setCategory] = useState("");
  const [text, setText] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [pending, setPending] = useState(false);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim() || pending) return;
    const history = [...turns, { role: "user" as const, content: text.trim() }];
    setTurns(history);
    setText("");
    setPending(true);
    try {
      const res = await fetch("/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          model,
          models: model === "auto" ? undefined : fallbacks,
          route: {
            ...(model === "auto"
              ? { sort, category: category || undefined }
              : {}),
            maxPriceUsd: Number(maxPrice),
          },
          messages: history
            .filter((t) => t.role !== "error")
            .map(({ role, content }) => ({ role, content })),
        }),
      });
      const json = await res.json();
      setPending(false);
      setTurns((t) => [
        ...t,
        res.ok
          ? {
              role: "assistant",
              content: json.choices[0].message.content,
              meta: {
                model: json.model,
                attempts: json.routing.attempts,
                cost: json.usage.cost_usd,
              },
            }
          : {
              role: "error",
              content: json.error?.message ?? "Request failed",
              meta: json.routing && {
                model: "",
                attempts: json.routing.attempts,
              },
            },
      ]);
    } catch {
      setTurns((t) => [
        ...t,
        {
          role: "error",
          content:
            "Could not reach the server. Check recent calls in your account before repeating a task that performs actions.",
        },
      ]);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-[240px_minmax(0,1fr)]">
      <aside className="space-y-4">
        <label className="block space-y-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted">
            Agent
          </span>
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className={input}
          >
            {model === "" && (
              <option value="" disabled>
                Choose an agent
              </option>
            )}
            <option value="auto">Auto router</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name} — {o.id}
              </option>
            ))}
          </select>
        </label>
        {unavailable && model === "" && (
          <p
            role="alert"
            className="rounded-md border border-line bg-bg px-3 py-2 text-sm"
          >
            <code className="break-all">{initialModel}</code> can&apos;t be
            called from the Playground yet. It has no approved chat endpoint.
            Choose an agent or the auto router.
          </p>
        )}
        {model === "auto" ? (
          <>
            <label className="block space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted">
                Category
              </span>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className={input}
              >
                <option value="">Infer from message</option>
                {CATEGORIES.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted">
                Prefer
              </span>
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value)}
                className={input}
              >
                <option value="usage">Most used</option>
                <option value="price">Lowest price</option>
                <option value="latency">Lowest latency</option>
                <option value="uptime">Highest uptime</option>
              </select>
            </label>
          </>
        ) : (
          <label className="block space-y-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted">
              Fallbacks
            </span>
            <select
              multiple
              value={fallbacks}
              onChange={(e) =>
                setFallbacks([...e.target.selectedOptions].map((o) => o.value))
              }
              className={`${input} h-36`}
            >
              {options
                .filter((o) => o.id !== model)
                .map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
            </select>
            <span className="block text-xs text-muted">
              Tried in order if the agent is unavailable.
            </span>
          </label>
        )}
        <label className="block space-y-1">
          <span className="text-xs font-semibold uppercase text-muted">
            Maximum price per call (USD)
          </span>
          <input
            aria-label="Maximum price per call"
            type="number"
            min="0"
            max="10"
            step="0.000001"
            value={maxPrice}
            onChange={(e) => setMaxPrice(e.target.value)}
            className={input}
          />
        </label>
        <p className="text-xs text-muted">
          Calls execute real agents and spend prepaid credits on success. Only
          approved chat endpoints appear here.
        </p>
        <Link className="text-sm text-accent" href="/account">
          {session ? "Manage keys and balance →" : "Sign in to run an agent →"}
        </Link>
      </aside>

      <section className="flex min-h-[420px] flex-col rounded-xl border border-line bg-surface">
        <div className="flex-1 space-y-4 p-4">
          {turns.length === 0 && (
            <p className="text-sm text-muted">
              {options.length
                ? "Describe a task for the selected agent. Review its capabilities and price before sending."
                : "No approved chat endpoints are available yet. Launch an agent and configure its endpoint to enable real calls here."}
            </p>
          )}
          {turns.map((t, i) => (
            <div
              key={i}
              className={
                t.role === "user" ? "ml-auto max-w-[80%]" : "max-w-[90%]"
              }
            >
              <div
                className={`rounded-lg px-3 py-2 text-sm ${
                  t.role === "user"
                    ? "bg-ink text-bg"
                    : t.role === "error"
                      ? "border border-down text-down"
                      : "bg-bg"
                }`}
              >
                {t.content}
              </div>
              {t.meta && (
                <div className="mt-1 space-x-2 text-xs text-muted">
                  {t.meta.model && <code>{t.meta.model}</code>}
                  {t.meta.cost !== undefined && (
                    <span>charged ${t.meta.cost}</span>
                  )}
                  {(t.meta.attempts.length > 1 || t.role === "error") &&
                    t.meta.attempts.length > 0 && (
                      <span>
                        route:{" "}
                        {t.meta.attempts
                          .map(
                            (a) => `${a.model.split("/").pop()} (${a.status})`,
                          )
                          .join(" → ")}
                      </span>
                    )}
                </div>
              )}
            </div>
          ))}
          {pending && <p className="text-sm text-muted">Routing…</p>}
        </div>
        <form onSubmit={send} className="flex gap-2 border-t border-line p-3">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Send a task to the agent"
            className="flex-1 rounded-md border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
          />
          <button
            disabled={
              pending ||
              !model ||
              !session ||
              !options.length ||
              !text.trim() ||
              !maxPrice ||
              !Number.isFinite(Number(maxPrice)) ||
              Number(maxPrice) < 0 ||
              Number(maxPrice) > 10
            }
            className="rounded-md bg-accent px-4 text-sm font-medium text-white disabled:opacity-50"
          >
            Send
          </button>
        </form>
      </section>
    </div>
  );
}
