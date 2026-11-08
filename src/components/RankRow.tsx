import Link from "next/link";
import { compact } from "@/lib/format";
import type { Agent } from "@/lib/types";
import { AgentLogo } from "./AgentLogo";

export function Change({ pct }: { pct: number | null }) {
  if (pct === null)
    return <span className="text-xs font-medium text-accent">New</span>;
  const up = pct >= 0;
  return (
    <span className={`text-xs font-medium ${up ? "text-up" : "text-down"}`}>
      {up ? "+" : ""}
      {pct.toFixed(0)}%
    </span>
  );
}

export function RankRow({
  rank,
  agent,
  primary,
  secondary,
}: {
  rank: number;
  agent: Agent;
  primary: React.ReactNode;
  secondary: React.ReactNode;
}) {
  return (
    <li>
      <Link
        href={`/agents/${agent.slug}`}
        className="flex items-center gap-3 px-3 py-3 hover:bg-bg"
      >
        <span className="w-6 text-right text-sm tabular-nums text-muted">
          {rank}
        </span>
        <AgentLogo name={agent.name} color={agent.color} size={32} />
        <div className="min-w-0 flex-1">
          <div className="font-medium">{agent.name}</div>
          <div className="truncate text-sm text-muted">{agent.tagline}</div>
        </div>
        <div className="text-right">
          <div className="text-sm font-semibold tabular-nums">{primary}</div>
          <div>{secondary}</div>
        </div>
      </Link>
    </li>
  );
}

export function callsLabel(n: number) {
  return `${compact(n)} calls`;
}
