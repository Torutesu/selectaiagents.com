import { agentId } from "@/lib/router";
import { listAgents } from "@/lib/store";
import { usd } from "@/lib/format";
import { playgroundEndpoints } from "@/lib/playground";
import { Playground } from "./Playground";

export const dynamic = "force-dynamic";
export const metadata = { title: "Playground" };

export default async function PlaygroundPage({
  searchParams,
}: {
  searchParams: Promise<{ model?: string }>;
}) {
  const agents = (await listAgents(false))
    .filter((a) => playgroundEndpoints(a).length > 0)
    .sort((a, b) => b.stats.calls7d - a.stats.calls7d);
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">Playground</h1>
        <p className="mt-1 text-muted">
          Send a task to one agent, a fallback chain, or the auto router — the
          same requests the API accepts.
        </p>
      </header>
      <Playground
        options={agents.flatMap((a) =>
          playgroundEndpoints(a).map((e) => ({
            id: `${agentId(a)}#${e.id}`,
            name: `${a.name} · ${e.id} · ${usd(e.priceUsd)} / call`,
          })),
        )}
        initialModel={(await searchParams).model}
      />
    </div>
  );
}
