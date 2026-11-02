// Phase 4 add-ons billed as monthly Stripe subscriptions.
// Body: { action: "subscribe", product: "featured" | "sponsored" | "analytics", offer_id? } or { action: "portal" }
import { admin, serve, body, getUser, HttpError, env, stripe, APP_URL, ownedBusiness, ensureCustomer, audit } from "../_shared/core.ts";

const PRICE_ENV: Record<string, string> = { featured: "STRIPE_PRICE_FEATURED", sponsored: "STRIPE_PRICE_SPONSORED", analytics: "STRIPE_PRICE_ANALYTICS" };

serve(async (req) => {
  const { profile } = await getUser(req);
  const b = await body(req);
  const biz = await ownedBusiness(profile.id, b.business_id);
  const customer = await ensureCustomer(biz, profile.email);

  if (b.action === "portal") {
    const s = await stripe.billingPortal.sessions.create({ customer, return_url: `${APP_URL()}/#grow` });
    return { url: s.url };
  }
  const priceKey = PRICE_ENV[b.product];
  if (!priceKey) throw new HttpError(400, "Unknown product.");
  if (!biz.verified) throw new HttpError(403, "Your business needs to be verified first.");
  if (b.product === "sponsored") {
    const { data: o } = await admin.from("offers").select("id").eq("id", b.offer_id).eq("business_id", biz.id).maybeSingle();
    if (!o) throw new HttpError(400, "Pick one of your offers to sponsor.");
  }
  const meta = { kind: "phase4", product: b.product, business_id: biz.id, offer_id: b.offer_id ?? "" };
  const session = await stripe.checkout.sessions.create({
    mode: "subscription", customer,
    line_items: [{ price: env(priceKey), quantity: 1 }],
    subscription_data: { metadata: meta }, metadata: meta,
    success_url: `${APP_URL()}/#grow?subscribed=${b.product}`, cancel_url: `${APP_URL()}/#grow`,
  });
  await audit(profile.id, "billing.checkout_started", "business", biz.id, { product: b.product });
  return { url: session.url };
});
