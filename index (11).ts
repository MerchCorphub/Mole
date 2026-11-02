// deno-lint-ignore-file no-explicit-any
// Business Reward Wallet. Body:
//  { action: "deposit", amount_cents, method: "ach" | "card" }  → Stripe Checkout URL
//  { action: "withdraw", amount_cents }                          → refunds to original payment, less processing costs
//  { action: "set_cap", monthly_cap_cents | null }
import { admin, serve, body, getUser, HttpError, dbError, stripe, APP_URL, money, audit, ownedBusiness, ensureCustomer } from "../_shared/core.ts";
import { notifyStaff } from "../_shared/notify.ts";

// What Stripe kept on the original deposit, pro-rated to the amount withdrawn.
const processingCost = (d: any, take: number) =>
  d.method === "card" ? Math.round(take * 0.029 + (30 * take) / d.amount_cents) : Math.min(500, Math.round(take * 0.008));

serve(async (req) => {
  const { profile } = await getUser(req);
  const b = await body(req);
  const biz = await ownedBusiness(profile.id, b.business_id);
  if (biz.status !== "active") throw new HttpError(403, "This wallet is frozen. Contact MOLE support.");

  if (b.action === "deposit") {
    const { data: offers } = await admin.from("offers").select("reward_cents").eq("business_id", biz.id).in("status", ["active", "paused", "draft"]);
    const maxReward = Math.max(0, ...(offers ?? []).map((o: any) => o.reward_cents));
    const min = Math.max(5000, maxReward * 5);                // max($50, 5 rewards)
    const amount = Math.round(Number(b.amount_cents));
    if (!(amount >= min)) throw new HttpError(400, `The minimum deposit is ${money(min)}.`);
    if (amount > 2_500_000) throw new HttpError(400, "The maximum single deposit is $25,000.");
    const method = b.method === "card" ? "card" : "us_bank_account";
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer: await ensureCustomer(biz, profile.email),
      payment_method_types: [method],
      line_items: [{ quantity: 1, price_data: { currency: "usd", unit_amount: amount, product_data: { name: `MOLE Reward Wallet — ${biz.name}` } } }],
      metadata: { kind: "wallet", business_id: biz.id },
      payment_intent_data: { metadata: { kind: "wallet", business_id: biz.id } },
      success_url: `${APP_URL()}/#wallet?deposit=success`,
      cancel_url: `${APP_URL()}/#wallet`,
    });
    return { url: session.url };
  }

  if (b.action === "withdraw") {
    const amount = Math.round(Number(b.amount_cents));
    dbError((await admin.rpc("wallet_withdraw", { p_business: biz.id, p_amount: amount })).error);
    const { data: deps } = await admin.from("wallet_txns").select("*").eq("business_id", biz.id).eq("kind", "deposit")
      .not("stripe_ref", "is", null).gte("created_at", new Date(Date.now() - 170 * 864e5).toISOString()).order("created_at", { ascending: false });
    let left = amount, refunded = 0, costs = 0;
    for (const d of deps ?? []) {
      if (left <= 0) break;
      const take = Math.min(left, d.amount_cents - d.refunded_cents);
      if (take <= 0) continue;
      const cost = processingCost(d, take);
      try {
        await stripe.refunds.create({ payment_intent: d.stripe_ref, amount: take - cost, metadata: { business_id: biz.id, kind: "wallet_withdrawal" } },
          { idempotencyKey: `wd-${d.id}-${d.refunded_cents}-${take}` });
      } catch (e) { console.error("refund", e); continue; }
      await admin.from("wallet_txns").update({ refunded_cents: d.refunded_cents + take }).eq("id", d.id);
      if (cost) await admin.from("wallet_txns").insert({ business_id: biz.id, kind: "processing_cost", amount_cents: cost });
      left -= take; refunded += take - cost; costs += cost;
    }
    if (left > 0) {
      // Older or non-refundable deposits: return the rest to the wallet and alert finance to pay it out manually.
      await admin.rpc("wallet_credit", { p_business: biz.id, p_amount: left, p_ref: `withdraw-return-${crypto.randomUUID()}`, p_kind: "adjustment" });
      await notifyStaff(["staff_finance", "staff_admin"], { kind: "manual_withdrawal", title: "Manual wallet withdrawal needed",
        body: `${biz.name} asked to withdraw ${money(left)} that can't be refunded automatically.`, link: "#staff/payouts", email: true });
    }
    await audit(profile.id, "wallet.withdraw", "business", biz.id, { requested: amount, refunded, costs, manual: left });
    return { refunded_cents: refunded, processing_cost_cents: costs, manual_cents: left };
  }

  if (b.action === "set_cap") {
    const cap = b.monthly_cap_cents == null ? null : Math.max(0, Math.round(Number(b.monthly_cap_cents)));
    await admin.from("businesses").update({ monthly_cap_cents: cap }).eq("id", biz.id);
    await audit(profile.id, "wallet.set_cap", "business", biz.id, { monthly_cap_cents: cap });
    return { monthly_cap_cents: cap };
  }
  throw new HttpError(400, "Unknown action.");
});
