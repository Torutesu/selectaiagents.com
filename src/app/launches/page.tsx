import { LaunchRow } from "@/components/LaunchRow";
import { dayLabel } from "@/lib/format";
import { launchesByDay } from "@/lib/rankings";
import { listAgents } from "@/lib/store";
import { leaderboard, type LaunchPeriod } from "@/lib/launches";
import { Pills } from "@/components/Pills";

export const dynamic = "force-dynamic";
export const metadata = { title: "Launches" };

export default async function LaunchesPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const selected = (await searchParams).period;
  const period: LaunchPeriod =
    selected === "week" || selected === "month" ? selected : "day";
  const leaders = await leaderboard(period);
  const days = launchesByDay(await listAgents());

  return (
    <div className="space-y-10">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">Launches</h1>
        <p className="mt-1 text-muted">
          New agents, ranked by community upvotes for each launch day.
        </p>
      </header>
      <section className="space-y-4">
        <h2 className="text-xl font-semibold">Launch leaderboard</h2>
        <Pills
          active={period}
          items={(["day", "week", "month"] as const).map((p) => ({
            key: p,
            label: `This ${p}`,
            href: `/launches?period=${p}`,
          }))}
        />
        <p className="text-sm text-muted">
          Launches and votes in the current UTC calendar {period}. Ties go to
          the earlier launch. Top 3 with votes earn a live leaderboard badge.
        </p>
        {leaders.length ? (
          leaders.map((r, i) => (
            <LaunchRow
              key={r.agent.slug}
              agent={{ ...r.agent, upvotes: r.votes }}
              rank={i + 1}
              periodVotes
            />
          ))
        ) : (
          <p className="text-muted">
            No launches in this period yet. Be the first to launch.
          </p>
        )}
      </section>
      <h2 className="text-xl font-semibold">Launch archive</h2>
      {days.map(({ day, agents }) => (
        <section key={day}>
          <h2 className="mb-2 text-lg font-semibold">{dayLabel(day)}</h2>
          <div className="-mx-3">
            {agents.map((a, i) => (
              <LaunchRow key={a.slug} agent={a} rank={i + 1} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
