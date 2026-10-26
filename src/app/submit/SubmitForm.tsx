"use client";
import { Onboarding } from "@/components/maker/Onboarding";
export function SubmitForm({
  allowLocalUpstream = false,
}: {
  allowLocalUpstream?: boolean;
}) {
  return <Onboarding allowLocalUpstream={allowLocalUpstream} />;
}
