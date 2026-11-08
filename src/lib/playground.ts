import type { Agent } from "./types";

/**
 * Endpoints the Playground can call: approved chat.v1 endpoints of real
 * (non-demo) agents. The agent page uses the same rule to decide whether to
 * offer "Try in Playground", so the link never points at an agent the
 * Playground cannot select.
 */
export function playgroundEndpoints(agent: Agent) {
  return agent.demo
    ? []
    : agent.endpoints.filter((e) => e.available && e.contract === "chat.v1");
}
