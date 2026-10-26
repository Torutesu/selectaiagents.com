import { SubmitForm } from "./SubmitForm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { localUpstreamEnabled } from "@/lib/endpoint-timeout";

export const metadata = { title: "Launch an agent" };

export default async function SubmitPage() {
  if (!(await auth.api.getSession({ headers: await headers() })))
    redirect("/account");
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">Launch an agent</h1>
        <p className="mt-1 text-muted">
          Start with a private draft. Add your endpoint, review the details, and
          submit when you’re ready. Calls require operator approval.
        </p>
      </header>
      <SubmitForm allowLocalUpstream={localUpstreamEnabled()} />
    </div>
  );
}
