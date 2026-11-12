import Stripe from "stripe";
import { credit } from "@/lib/billing";
import { checkoutCredit } from "@/lib/checkout-event";
import { handle, HttpError, textBody } from "@/lib/http";
export async function POST(req: Request) {
  return handle(async () => {
    if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET)
      throw new HttpError(503, "Payments not configured");
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    let event: Stripe.Event;
    const payload = await textBody(req, 1_000_000);
    try {
      event = stripe.webhooks.constructEvent(
        payload,
        req.headers.get("stripe-signature") ?? "",
        process.env.STRIPE_WEBHOOK_SECRET,
      );
    } catch {
      throw new HttpError(400, "Invalid webhook signature");
    }
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const decision = checkoutCredit(session);
      if (decision.action === "credit")
        await credit(
          decision.userId,
          decision.amountMicros,
          `stripe:${session.id}`,
        );
      else if (decision.action === "reject")
        throw new HttpError(400, "Payment metadata did not match");
    }
    return Response.json({ received: true });
  });
}
