import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { Onboarding } from "@/components/maker/Onboarding";
import { localUpstreamEnabled } from "@/lib/endpoint-timeout";
export const dynamic = "force-dynamic";
export default async function DraftPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/account");
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const draft = (
    await db.query("SELECT * FROM maker_drafts WHERE id=$1 AND owner_id=$2", [
      id.data,
      session.user.id,
    ])
  ).rows[0];
  if (!draft) notFound();
  if (draft.published_slug) redirect(`/agents/${draft.published_slug}/manage`);
  return (
    <div>
      <header>
        <p className="eyebrow">Maker studio / Draft</p>
        <h1>Finish your introduction.</h1>
        <p className="mt-3 text-muted">
          Pick up where you left off. Your draft is private.
        </p>
      </header>
      <Onboarding
        allowLocalUpstream={localUpstreamEnabled()}
        initialId={draft.id}
        initialDetails={draft.details}
        initialEndpoint={draft.endpoint}
      />
    </div>
  );
}
