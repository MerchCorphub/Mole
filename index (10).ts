// deno-lint-ignore-file no-explicit-any
// Stripe → MOLE. Add two endpoints in Stripe pointing here (see SETUP.md step 4):
// "Your account" events (STRIPE_WEBHOOK_SECRET) and "Connected accounts" events (STRIPE_CONNECT_WEBHOOK_SECRET).
import { admin, env, stripe, Stripe, money, audit, syncConnectedAccount } from "../_shared/core.ts";
import { notify, notifyStaff } from "../_shared/notify.ts";

const crypto = Stripe.createSubtleCryptoProvider();

async function verify(raw: string, sig: string) {
  const secrets = [Deno.env.get("STRIPE_WEBHOOK_SECRET"), Deno.env.get("STRIPE_CONNECT_WEBHOOK_SECRET")].filter(Boolean) as string[];
  for (const s of secrets) {
    try { return await stripe.webhooks.constructEventAsync(raw, sig, s, undefined, crypto); } catch { /* try next */ }
  }
  return null;
}

async function ownerOf(businessId: string) {
  const { data } = await admin.from("businesses").select("id, owner_id, name").eq("id", businessId).maybeSingle();
  return data;
}

async function creditWallet(s: any) {
  if (s.metadata?.kind !== "wallet" || s.payment_status !== "paid") return;
  const pi = typeof s.payment_intent === "string" ? s.payment_intent : s.payment_intent?.id;
  const method = s.payment_method_types?.[0] === "card" ? "card" : "ach";
  const { data: credited } = await admin.rpc("wallet_credit", { p_business: s.metadata.business_id, p_amount: s.amount_total, p_ref: pi, p_kind: "deposit", p_method: method });
  if (!credited) return;
  await audit(null, "wallet.deposit", "business", s.metadata.business_id, { amount_cents: s.amount_total, method, payment_intent: pi });
  const biz = await ownerOf(s.metadata.business_id);
  if (biz) await notify(biz.owner_id, { kind: "wallet_funded", title: "Reward Wallet funded", body: `${money(s.amount_total)} was added. Paused offers are live again if the balance covers them.`, link: "#wallet" });
}

async function syncPhase4(sub: any) {
  const m = sub.metadata ?? {};
  if (m.kind !== "phase4") return;
  const end = sub.current_period_end ?? sub.items?.data?.[0]?.current_period_end;
  const active = ["active", "trialing"].includes(sub.status);
  const until = active && end ? new Date(end * 1000).toISOString() : new Date().toISOString();
  await admin.from("phase4_subscriptions").upsert({
    business_id: m.business_id, offer_id: m.offer_id || null, product: m.product,
    stripe_subscription_id: sub.id, status: sub.status, current_period_end: end ? new Date(end * 1000).toISOString() : null,
  }, { onConflict: "stripe_subscription_id" });
  if (m.product === "featured") await admin.from("businesses").update({ featured_until: until }).eq("id", m.business_id);
  if (m.product === "analytics") await admin.from("businesses").update({ analytics_until: until }).eq("id", m.business_id);
  if (m.product === "sponsored" && m.offer_id) await admin.from("offers").update({ sponsored_until: until }).eq("id", m.offer_id);
}

async function handle(event: any) {
  const o = event.data.object;
  switch (event.type) {
    case "checkout.session.completed":
      if (o.mode === "payment") await creditWallet(o);
      if (o.mode === "subscription" && o.subscription) await syncPhase4(await stripe.subscriptions.retrieve(o.subscription));
      break;
    case "checkout.session.async_payment_succeeded":
      await creditWallet(o);
      break;
    case "checkout.session.async_payment_failed": {
      const biz = o.metadata?.business_id && await ownerOf(o.metadata.business_id);
      if (biz) await notify(biz.owner_id, { kind: "wallet_failed", title: "Bank deposit failed", body: `Your ${money(o.amount_total)} bank transfer didn't go through. Please try again or use a card.`, link: "#wallet", sms: true });
      break;
    }
    case "account.updated": {
      const { data: before } = await admin.from("profiles").select("id, payouts_enabled").eq("stripe_account_id", o.id).maybeSingle();
      const after = await syncConnectedAccount(o);
      if (before && !before.payouts_enabled && after.payouts_enabled)
        await notify(before.id, { kind: "payouts_active", title: "Payouts are active", body: `Rewards will be sent to your bank${after.bank_last4 ? ` ending ${after.bank_last4}` : ""} on the 15th of each month.`, link: "#payout" });
      break;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      await syncPhase4(o);
      break;
    case "invoice.payment_failed": {
      const { data: biz } = await admin.from("businesses").select("owner_id").eq("stripe_customer_id", o.customer).maybeSingle();
      if (biz) await notify(biz.owner_id, { kind: "billing_failed", title: "Payment failed", body: "We couldn't charge your card for your MOLE Grow plan. Update your payment method to keep it running.", link: "#grow", sms: true });
      break;
    }
    case "charge.dispute.created": {
      const { data: biz } = await admin.from("businesses").select("id, name").eq("stripe_customer_id", o.customer ?? "").maybeSingle();
      if (biz) {
        await admin.from("businesses").update({ status: "frozen" }).eq("id", biz.id);
        await audit(null, "business.frozen_chargeback", "business", biz.id, { dispute: o.id, amount_cents: o.amount });
      }
      await notifyStaff(["staff_finance", "staff_admin"], { kind: "chargeback", title: "Wallet chargeback", body: `${biz?.name ?? "A business"} disputed a ${money(o.amount)} deposit. Wallet frozen.`, link: "#staff/payouts", email: true });
      break;
    }
    case "transfer.reversed": {
      const pid = o.metadata?.payout_id;
      if (pid) {
        await admin.from("payouts").update({ status: "failed", error: "Transfer reversed" }).eq("id", pid);
        await admin.from("referrals").update({ status: "cleared", paid_at: null, payout_id: null }).eq("payout_id", pid);
        await audit(null, "payout.reversed", "payout", pid, { transfer: o.id });
      }
      break;
    }
  }
}

Deno.serve(async (req) => {
  const raw = await req.text();
  const event = await verify(raw, req.headers.get("stripe-signature") ?? "");
  if (!event) return new Response("Bad signature", { status: 400 });
  try { await handle(event); } catch (e) { console.error(event.type, e); return new Response("error", { status: 500 }); }
  return new Response("ok");
});
