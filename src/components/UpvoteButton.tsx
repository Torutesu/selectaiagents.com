"use client";
import { useEffect, useState } from "react";
import { authClient } from "@/lib/auth-client";
import { api } from "@/lib/client-api";
export function UpvoteButton({
  slug,
  initial,
  disabled = false,
  periodCount = false,
}: {
  slug: string;
  initial: number;
  disabled?: boolean;
  /**
   * `initial` counts votes in a leaderboard period. The vote API returns
   * all-time totals, so keep the period count and only add the new vote.
   */
  periodCount?: boolean;
}) {
  const { data: session } = authClient.useSession();
  const [count, setCount] = useState(initial);
  const [voted, setVoted] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    setVoted(false);
    if (session && !disabled)
      api<{ voted: boolean; upvotes: number }>(`/api/agents/${slug}/upvote`)
        .then((r) => {
          setVoted(r.voted);
          if (!periodCount) setCount(r.upvotes);
        })
        .catch(() => {});
  }, [session?.user.id, slug, disabled, periodCount]);
  async function vote(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!session) {
      window.location.assign("/account");
      return;
    }
    setPending(true);
    setError("");
    try {
      const r = await api<{ upvotes: number }>(
        `/api/agents/${slug}/upvote`,
        "POST",
      );
      // The button is disabled once voted, so this is a new vote.
      setCount((c) => (periodCount ? c + 1 : r.upvotes));
      setVoted(true);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setPending(false);
    }
  }
  return (
    <span className="flex shrink-0 flex-col items-center gap-1">
      <button
        onClick={vote}
        disabled={disabled || pending || voted}
        aria-pressed={voted}
        aria-label={
          disabled ? "Demo listing — voting disabled" : `Upvote (${count})`
        }
        title={error || undefined}
        className={`flex w-14 flex-col items-center rounded-lg border py-1.5 text-sm font-semibold transition disabled:opacity-60 ${voted ? "border-accent bg-accent text-white" : "border-line bg-surface hover:border-accent"}`}
      >
        <span aria-hidden>▲</span>
        {count}
      </button>
      {error && (
        <span role="status" className="max-w-28 text-xs text-down">
          {error}
        </span>
      )}
    </span>
  );
}
