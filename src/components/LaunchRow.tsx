import Link from "next/link";
import { categoryLabel, priceLabel } from "@/lib/format";
import type { Agent } from "@/lib/types";
import { AgentLogo } from "./AgentLogo";
import { UpvoteButton } from "./UpvoteButton";

export function LaunchRow({
  agent,
  rank,
  periodVotes = false,
}: {
  agent: Agent;
  rank?: number;
  /** `agent.upvotes` counts only this leaderboard period, not all time. */
  periodVotes?: boolean;
}) {
  return (
    <div className="launch-row">
      {rank !== undefined && (
        <span className="launch-rank">{String(rank).padStart(2, "0")}</span>
      )}
      <Link href={`/agents/${agent.slug}`} className="launch-row-main">
        <AgentLogo name={agent.name} color={agent.color} size={42} />
        <div className="min-w-0">
          <div className="launch-row-name">{agent.name}</div>
          <div className="launch-row-tagline">{agent.tagline}</div>
          <div className="launch-row-meta">
            <span>{categoryLabel(agent.category)}</span>
            <span>{priceLabel(agent.pricing)}</span>
            {agent.demo && <span className="demo-tag">Demo</span>}
          </div>
        </div>
      </Link>
      <UpvoteButton
        slug={agent.slug}
        initial={agent.upvotes}
        disabled={agent.demo}
        periodCount={periodVotes}
      />
    </div>
  );
}
