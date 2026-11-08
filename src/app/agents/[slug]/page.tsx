import Link from "next/link";
import { notFound } from "next/navigation";
import { AgentListRow } from "@/components/AgentListRow";
import { AgentLogo } from "@/components/AgentLogo";
import { CopyButton } from "@/components/CopyButton";
import { Pills } from "@/components/Pills";
import { Change } from "@/components/RankRow";
import { UpvoteButton } from "@/components/UpvoteButton";
import { UsageChart } from "@/components/UsageChart";
import {
  categoryLabel,
  compact,
  dayLabel,
  duration,
  priceLabel,
  usd,
} from "@/lib/format";
import { agentId } from "@/lib/router";
import { playgroundEndpoints } from "@/lib/playground";
import { getAgent, listAgents } from "@/lib/store";
import { dailyUsage, usageDays } from "@/lib/usage";
import { Comments } from "@/components/Comments";
import { badges } from "@/lib/launches";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "activity", label: "Activity" },
  { key: "api", label: "API" },
] as const;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const agent = await getAgent((await params).slug);
  return {
    title: agent?.name ?? "Agent not found",
    description: agent?.tagline,
  };
}

const Code = ({ children }: { children: string }) => (
  <pre className="overflow-x-auto rounded-xl bg-[#1c1917] p-4 text-sm text-[#fafaf9]">
    {children}
  </pre>
);

export default async function AgentPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const agent = await getAgent((await params).slug);
  if (!agent) notFound();
  const tabParam = (await searchParams).tab;
  const tab = TABS.find((t) => t.key === tabParam)?.key ?? "overview";

  const id = agentId(agent);
  const base = `${process.env.BETTER_AUTH_URL || "http://localhost:3000"}/api/v1`;
  const { stats } = agent;
  const awards = agent.demo ? [] : await badges(agent.slug);
  const session = await auth.api.getSession({ headers: await headers() });
  const change =
    stats.callsPrev7d > 0
      ? ((stats.calls7d - stats.callsPrev7d) / stats.callsPrev7d) * 100
      : null;
  const alternatives = (await listAgents())
    .filter((a) => a.category === agent.category && a.slug !== agent.slug)
    .sort((a, b) => a.pricing.priceUsd - b.pricing.priceUsd)
    .slice(0, 3);

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-start gap-5">
        <AgentLogo name={agent.name} color={agent.color} size={64} />
        <div className="min-w-0 flex-1">
          <h1 className="text-3xl font-bold tracking-tight">{agent.name}</h1>
          <div className="mt-1 flex items-center gap-2">
            <code className="text-sm text-muted">{id}</code>
            <CopyButton text={id} />
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
            <Link
              href={`/agents?category=${agent.category}`}
              className="hover:text-ink"
            >
              {categoryLabel(agent.category)}
            </Link>
            {agent.ownerId ? (
              <Link href={`/makers/${agent.ownerId}`}>by {agent.maker}</Link>
            ) : (
              <span>by {agent.maker}</span>
            )}
            <span>Launched {dayLabel(agent.launchedAt)}</span>
            <a
              href={agent.website}
              target="_blank"
              rel="noreferrer"
              className="hover:text-ink"
            >
              Website ↗
            </a>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {playgroundEndpoints(agent).length > 0 && (
            <Link
              href={`/playground?model=${encodeURIComponent(id)}`}
              className="rounded-md bg-ink px-3 py-2 text-sm font-medium text-bg"
            >
              Try in Playground
            </Link>
          )}
          <UpvoteButton
            slug={agent.slug}
            initial={agent.upvotes}
            disabled={agent.demo}
          />
        </div>
      </header>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="rounded-full border border-line px-3 py-1">
          {agent.demo
            ? "Demo — fictional listing"
            : agent.endpoints.some((e) => e.available)
              ? "Endpoint configured"
              : "Listed — endpoint setup pending"}
        </span>
        {awards.map((label) => (
          <span
            className="rounded-full bg-accent/10 px-3 py-1 text-accent"
            key={label}
          >
            {label}
          </span>
        ))}
        {session?.user.id === agent.ownerId && (
          <Link className="text-accent" href={`/agents/${agent.slug}/manage`}>
            Configure endpoints →
          </Link>
        )}
      </div>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          {
            label: "Calls (7d)",
            value: compact(stats.calls7d),
            extra: <Change pct={change} />,
          },
          { label: "Pricing", value: priceLabel(agent.pricing) },
          {
            label: "Latency p50 / p95",
            value: agent.healthSamples
              ? `${duration(stats.p50Ms)} / ${duration(stats.p95Ms)}`
              : "Not measured",
          },
          {
            label: "Uptime (30d)",
            value: agent.healthSamples
              ? `${stats.uptime.toFixed(1)}% (${agent.healthSamples} calls)`
              : "Not measured",
          },
        ].map((s) => (
          <div
            key={s.label}
            className="rounded-xl border border-line bg-surface p-4"
          >
            <div className="text-xs text-muted">{s.label}</div>
            <div className="mt-1 font-semibold">{s.value}</div>
            {s.extra}
          </div>
        ))}
      </section>

      <Pills
        active={tab}
        items={TABS.map((t) => ({
          ...t,
          href: `/agents/${agent.slug}?tab=${t.key}`,
        }))}
      />

      {tab === "overview" && (
        <div className="space-y-8">
          <p className="max-w-3xl leading-relaxed">{agent.description}</p>
          <section>
            <h2 className="mb-3 text-xl font-semibold">Endpoints</h2>
            <div className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
              {agent.endpoints.map((e) => (
                <div
                  key={e.id}
                  className="flex flex-wrap items-center gap-3 p-4"
                >
                  <code className="rounded bg-line/60 px-1.5 py-0.5 text-xs">
                    {e.method}
                  </code>
                  <code className="text-sm">
                    {id}#{e.id}
                  </code>
                  <span className="flex-1 text-sm text-muted">
                    {e.description}
                  </span>
                  <span className="text-xs text-muted">
                    {e.available ? e.contract : "Not configured"}
                  </span>
                  <span className="text-sm font-medium">{usd(e.priceUsd)}</span>
                </div>
              ))}
            </div>
          </section>
          {alternatives.length > 0 && (
            <section>
              <h2 className="mb-1 text-xl font-semibold">Alternatives</h2>
              <p className="mb-3 text-sm text-muted">
                Other {categoryLabel(agent.category).toLowerCase()} agents,
                cheapest first. Fallbacks require matching endpoint contracts.
              </p>
              <ul className="divide-y divide-line border-y border-line">
                {alternatives.map((a) => (
                  <AgentListRow key={a.slug} agent={a} />
                ))}
              </ul>
            </section>
          )}
          <div className="flex flex-wrap gap-2">
            {agent.tags.map((t) => (
              <Link
                key={t}
                href={`/agents?q=${encodeURIComponent(t)}`}
                className="rounded-full border border-line px-3 py-1 text-sm text-muted hover:text-ink"
              >
                #{t}
              </Link>
            ))}
          </div>
          {!agent.demo && <Comments slug={agent.slug} />}
        </div>
      )}

      {tab === "activity" && (
        <section className="space-y-3 rounded-xl border border-line bg-surface p-5">
          <div>
            <h2 className="text-xl font-semibold">
              Daily calls to {agent.name}
            </h2>
            <p className="text-sm text-muted">
              {compact(stats.calls30d)} routed calls in the last 30 days.
            </p>
          </div>
          <UsageChart
            days={usageDays()}
            series={[
              {
                key: agent.slug,
                label: agent.name,
                values: dailyUsage(agent),
                color: "var(--series-1)",
              },
            ]}
            label={`Daily calls to ${agent.name}, last 30 days`}
          />
        </section>
      )}

      {tab === "api" && (
        <div className="space-y-6">
          <p className="text-muted">
            For approved chat.v1 endpoints, point the OpenAI SDK at{" "}
            <code>{base}</code> and use <code>{id}</code> as the model. Add{" "}
            <code>models</code> to fall back to alternatives.
          </p>
          <section className="space-y-2">
            <h3 className="font-semibold">curl</h3>
            <Code>{`curl ${base}/chat/completions \\
  -H "Authorization: Bearer $SAA_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "${id}",
    "models": [${alternatives
      .filter((a) =>
        a.endpoints.some((e) => e.available && e.contract === "chat.v1"),
      )
      .map((a) => `"${agentId(a)}"`)
      .join(", ")}],
    "messages": [{"role": "user", "content": "..."}]
  }'`}</Code>
          </section>
          <section className="space-y-2">
            <h3 className="font-semibold">Python (OpenAI SDK)</h3>
            <Code>{`from openai import OpenAI

client = OpenAI(base_url="${base}", api_key="<SAA_API_KEY>")

res = client.chat.completions.create(
    model="${id}",
    messages=[{"role": "user", "content": "..."}],
)
print(res.choices[0].message.content)`}</Code>
          </section>
          <section className="space-y-2">
            <h3 className="font-semibold">TypeScript (OpenAI SDK)</h3>
            <Code>{`import OpenAI from "openai";

const client = new OpenAI({ baseURL: "${base}", apiKey: process.env.SAA_API_KEY });

const res = await client.chat.completions.create({
  model: "${id}",
  messages: [{ role: "user", content: "..." }],
});`}</Code>
          </section>
          <section className="space-y-2">
            <h3 className="font-semibold">Structured call to one endpoint</h3>
            <Code>{`curl -X POST ${base}/run \\
  -H "Authorization: Bearer $SAA_API_KEY" \\
  -d '{"endpoint": "${id}#${agent.endpoints[0]?.id}", "input": {}}'`}</Code>
          </section>
        </div>
      )}
    </div>
  );
}
