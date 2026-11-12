import { healthyForRouting } from "./router";
import type { Agent } from "./types";
export type MakerStatus =
  "Draft" | "Awaiting approval" | "Live" | "Needs attention";
export function makerStatus(agent: Agent): {
  label: MakerStatus;
  hint: string;
  tone: string;
} {
  const configured = agent.endpoints.filter((e) => e.contract);
  const approved = configured.filter((e) => e.available);
  const attention = configured.filter(
    (e) =>
      e.reviewStatus === "changes_requested" || e.reviewStatus === "disabled",
  );
  if (!configured.length)
    return {
      label: "Needs attention",
      hint: "Your listing is public. Add an endpoint to enable calls.",
      tone: "attention",
    };
  if (!approved.length)
    return {
      label: attention.length ? "Needs attention" : "Awaiting approval",
      hint: attention.length
        ? "An operator requested changes or disabled an endpoint. Open Manage agent to read the feedback."
        : "Endpoint saved. An operator must approve it before calls are enabled.",
      tone: attention.length ? "attention" : "pending",
    };
  // Same rule as the router: low uptime only pauses routing after enough calls.
  if (!healthyForRouting(agent))
    return {
      label: "Needs attention",
      hint: "Measured uptime is below 98%, so routing is paused. Contact the operator to review failures.",
      tone: "attention",
    };
  const pending = configured.filter(
    (e) => !e.available && !attention.includes(e),
  ).length;
  return {
    label: "Live",
    hint: attention.length
      ? `${approved.length} approved endpoint(s); ${attention.length} need changes or are disabled${pending ? `; ${pending} awaiting approval` : ""}. Open Manage agent for feedback.`
      : pending
        ? `${approved.length} approved endpoint(s); ${pending} additional endpoint(s) awaiting approval.`
        : (agent.healthSamples ?? 0) > 0
          ? "Approved for routing. Health is based on measured calls."
          : "Approved for routing. No calls have been measured yet.",
    tone: "live",
  };
}
