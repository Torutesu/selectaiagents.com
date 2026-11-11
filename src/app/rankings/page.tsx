import { Pills } from "@/components/Pills";
import { Change, RankRow, callsLabel } from "@/components/RankRow";
import { UsageChart } from "@/components/UsageChart";
import { compact, dayLabel } from "@/lib/format";
import {
  fastestGrowing,
  GROWTH_MIN_CALLS,
  mostUsed,
  type Period,
} from "@/lib/rankings";
import { listAgents } from "@/lib/store";
import { stackedUsage, usageDays, usageAsOf } from "@/lib/usage";
import { CATEGORIES, type CategoryId } from "@/lib/types";

export const dynamic = "force-dynamic";
export const metadata = { title: "Rankings" };

export default async function RankingsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; category?: string }>;
}) {
  const sp = await searchParams;
  const period: Period = sp.period === "30d" ? "30d" : "7d";
  const category = CATEGORIES.some((c) => c.id === sp.category)
    ? (sp.category as CategoryId)
    : undefined;

  const agents = await listAgents(false);
  const used = mostUsed(agents, period, category);
  const growing = fastestGrowing(
    agents.filter((a) => !category || a.category === category),
  ).slice(0, 5);
  const windowTotal =
    mostUsed(agents, period, category).reduce((s, r) => s + r.calls, 0) || 1;
  // Colors follow the agent (its slot in the overall top 7), never the filtered rank.
  const stacked = stackedUsage(agents).map((s, i) => ({
    ...s,
    color: s.key === "other" ? "var(--series-other)" : `var(--series-${i + 1})`,
  }));

  const href = (p: Period, c?: string) =>
    `/rankings?period=${p}${c ? `&category=${c}` : ""}`;

  return (
    <div className="space-y-12">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">Rankings</h1>
        <p className="mt-1 text-muted">
          Which agents are developers actually calling? Ranked by routed API
          usage.
        </p>
        <p className="mt-1 text-xs text-muted">
          Usage data through {dayLabel(usageAsOf())} (UTC)
        </p>
      </header>

      <section className="space-y-3 rounded-xl border border-line bg-surface p-5">
        <div>
          <h2 className="text-xl font-semibold">Calls by agent</h2>
          <p className="text-sm text-muted">
            Daily routed calls, last 30 days — top 7 agents and everything else.
          </p>
        </div>
        <UsageChart
          days={usageDays()}
          series={stacked}
          label="Daily routed calls by agent, last 30 days"
        />
      </section>

      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-semibold">Most used agents</h2>
          <Pills
            active={period}
            items={[
              { key: "7d", label: "Last 7 days", href: href("7d", category) },
              {
                key: "30d",
                label: "Last 30 days",
                href: href("30d", category),
              },
            ]}
          />
        </div>
        <Pills
          active={category ?? "all"}
          items={[
            { key: "all", label: "All", href: href(period) },
            ...CATEGORIES.map((c) => ({
              key: c.id,
              label: c.label,
              href: href(period, c.id),
            })),
          ]}
        />
        {used.length === 0 ? (
          <p className="text-muted">No agents in this category yet.</p>
        ) : (
          <ol className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
            {used.map((r, i) => (
              <RankRow
                key={r.agent.slug}
                rank={i + 1}
                agent={r.agent}
                primary={callsLabel(r.calls)}
                secondary={
                  <span className="flex justify-end gap-2 text-xs">
                    <span className="text-muted">
                      {((r.calls / windowTotal) * 100).toFixed(1)}% share
                    </span>
                    <Change pct={r.changePct} />
                  </span>
                }
              />
            ))}
          </ol>
        )}
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold">Fastest growing</h2>
        {!growing.length && (
          <p className="text-sm text-muted">
            No agents meet the {GROWTH_MIN_CALLS.toLocaleString("en-US")}-call
            growth threshold yet.
          </p>
        )}
        <ol className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
          {growing.map((g, i) => (
            <RankRow
              key={g.agent.slug}
              rank={i + 1}
              agent={g.agent}
              primary={`${g.multiple.toFixed(1)}×`}
              secondary={
                <span className="text-xs text-muted">
                  {compact(g.calls)} vs {compact(g.prevCalls)} last week
                </span>
              }
            />
          ))}
        </ol>
      </section>

      <section className="rounded-xl border border-line bg-surface p-5 text-sm text-muted">
        <h2 className="mb-2 font-semibold text-ink">How we count</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            Each completed call routed through the Select AI Agents API counts
            once, regardless of price.
          </li>
          <li>
            Failed attempts, duplicate idempotent replays, and fictional demo
            listings do not count. Health uses all execution attempts in the
            last 30 days, including today; latency uses successful attempts.
          </li>
          <li>
            Windows are trailing 7 or 30 days ending on the latest complete UTC
            day.
          </li>
          <li>
            Fastest growing compares the last 7 days with the 7 before, for
            agents with at least {GROWTH_MIN_CALLS.toLocaleString("en-US")}{" "}
            calls in the last 7 days.
          </li>
          <li>
            Upvotes drive launch rankings; usage drives these rankings. The two
            are kept separate.
          </li>
        </ul>
      </section>
    </div>
  );
}
