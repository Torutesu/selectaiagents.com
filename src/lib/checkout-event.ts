/** The checkout session fields the credit webhook relies on. */
export interface CheckoutSessionFields {
  id: string;
  payment_status: string;
  currency: string | null;
  amount_total: number | null;
  client_reference_id: string | null;
  metadata: Record<string, string> | null;
}

export const CREDIT_PACKS_MICROS = [10e6, 25e6, 50e6];

/**
 * Decide what a signed `checkout.session.completed` event means for credits.
 * Sessions this app did not create (no `metadata.userId`, e.g. Payment Links
 * or other products on the same Stripe account) are acknowledged and ignored:
 * rejecting them makes Stripe retry for days and can disable the webhook.
 * Sessions claiming to be ours must match exactly or are rejected.
 */
export function checkoutCredit(
  session: CheckoutSessionFields,
):
  | { action: "credit"; userId: string; amountMicros: number }
  | { action: "ignore" }
  | { action: "reject" } {
  const userId = session.metadata?.userId;
  if (!userId) return { action: "ignore" };
  const amountMicros = Number(session.metadata?.amountMicros);
  const valid =
    session.payment_status === "paid" &&
    session.currency === "usd" &&
    session.client_reference_id === userId &&
    Number.isSafeInteger(amountMicros) &&
    amountMicros === (session.amount_total ?? 0) * 10000 &&
    CREDIT_PACKS_MICROS.includes(amountMicros);
  return valid
    ? { action: "credit", userId, amountMicros }
    : { action: "reject" };
}
