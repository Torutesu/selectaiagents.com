import test from "node:test";
import assert from "node:assert/strict";
import {
  checkoutCredit,
  type CheckoutSessionFields,
} from "../src/lib/checkout-event";
import { makerStatus } from "../src/lib/maker-status";
import { SEED_AGENTS } from "../src/lib/seed";
import type { Agent } from "../src/lib/types";

const session = (
  overrides: Partial<CheckoutSessionFields> = {},
): CheckoutSessionFields => ({
  id: "cs_test_1",
  payment_status: "paid",
  currency: "usd",
  amount_total: 1000,
  client_reference_id: "user-1",
  metadata: { userId: "user-1", amountMicros: "10000000" },
  ...overrides,
});

test("checkouts this app created are credited exactly", () => {
  assert.deepEqual(checkoutCredit(session()), {
    action: "credit",
    userId: "user-1",
    amountMicros: 10_000_000,
  });
});

test("checkouts from other Stripe products are acknowledged, not rejected", () => {
  assert.deepEqual(checkoutCredit(session({ metadata: null })), {
    action: "ignore",
  });
  assert.deepEqual(
    checkoutCredit(session({ metadata: { campaign: "payment-link" } })),
    { action: "ignore" },
  );
});

test("sessions claiming to be ours must match or are rejected", () => {
  for (const bad of [
    session({ amount_total: 999 }),
    session({ client_reference_id: "someone-else" }),
    session({ currency: "eur" }),
    session({ payment_status: "unpaid" }),
    session({
      amount_total: 1500,
      metadata: { userId: "user-1", amountMicros: "15000000" },
    }),
  ])
    assert.deepEqual(checkoutCredit(bad), { action: "reject" });
});

const live = (healthSamples: number, uptime: number): Agent => ({
  ...SEED_AGENTS[0],
  demo: false,
  healthSamples,
  stats: { ...SEED_AGENTS[0].stats, uptime },
  endpoints: [
    {
      ...SEED_AGENTS[0].endpoints[0],
      contract: "chat.v1",
      available: true,
      reviewStatus: "approved",
    },
  ],
});

test("maker status only reports paused routing when the router pauses it", () => {
  assert.equal(makerStatus(live(1, 0)).label, "Live");
  assert.equal(makerStatus(live(19, 50)).label, "Live");
  assert.equal(makerStatus(live(20, 97)).label, "Needs attention");
  assert.equal(makerStatus(live(20, 99)).label, "Live");
});
