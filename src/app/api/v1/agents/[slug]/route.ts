import { NextResponse } from "next/server";
import { agentSummary } from "@/lib/api";
import { getAgent } from "@/lib/store";

// inspect: free. Full detail for one agent, including endpoints and pricing.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const agent = await getAgent((await params).slug);
  if (!agent)
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  return NextResponse.json({
    data: {
      ...agentSummary(agent),
      description: agent.description,
      tags: agent.tags,
    },
  });
}
