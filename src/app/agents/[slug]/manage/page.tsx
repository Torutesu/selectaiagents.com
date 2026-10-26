import Link from "next/link";
import { headers } from "next/headers";
import { redirect, notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { getAgent } from "@/lib/store";
import { makerStatus } from "@/lib/maker-status";
import { ListingEditor } from "@/components/maker/ListingEditor";
import { EndpointEditor } from "./EndpointEditor";
import { localUpstreamEnabled } from "@/lib/endpoint-timeout";
export const dynamic = "force-dynamic";
export default async function ManagePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ submitted?: string }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/account");
  const agent = await getAgent((await params).slug);
  if (!agent || agent.demo || agent.ownerId !== session.user.id) notFound();
  const status = makerStatus(agent);
  const submitted = (await searchParams).submitted === "1";
  return (
    <div className="space-y-6">
      <header>
        <Link href="/maker" className="eyebrow">
          ← Maker studio
        </Link>
        <div className="maker-dashboard-heading">
          <h1>{agent.name}</h1>
          <Link href={`/agents/${agent.slug}`} className="text-link">
            View listing ↗
          </Link>
        </div>
        <div className="mt-5">
          <span className="maker-status" data-tone={status.tone}>
            {status.label}
          </span>
          <p className="mt-3 text-muted">{status.hint}</p>
        </div>
      </header>
      {submitted && (
        <div role="status" className="maker-notice">
          <strong>Your agent has been submitted.</strong>
          <p>
            The listing is now public. An operator needs to approve your
            endpoint before it can receive calls.
          </p>
        </div>
      )}
      <ListingEditor
        slug={agent.slug}
        initial={{
          name: agent.name,
          maker: agent.maker,
          tagline: agent.tagline,
          description: agent.description,
          category: agent.category,
          website: agent.website,
          tags: agent.tags.join(", "),
        }}
      />
      <EndpointEditor
        slug={agent.slug}
        allowLocalUpstream={localUpstreamEnabled()}
      />
    </div>
  );
}
