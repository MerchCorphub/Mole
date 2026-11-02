// deno-lint-ignore-file no-explicit-any
// Monthly payouts. Staff (finance/admin, two-step sign-in) only.
//  { action: "build", period?: "2026-11" } → builds/refreshes the draft batch
//  { action: "approve", batch_id }        → sends Stripe transfers to each member
import { admin, serve, body, requireStaff, HttpError, dbError, stripe, money, audit } from "../_shared/core.ts";
import { notify } from "../_shared/notify.ts";

serve(async (req) => {
  const { profile } = await requireStaff(req, ["staff_finance", "staff_admin"]);
  const b = await body(req);

  if (b.action === "build") {
    const period = /^\d{4}-\d{2}$/.test(b.period ?? "") ? b.period : new Date().toISOString().slice(0, 7);
    const { data: id, error } = await admin.rpc("build_payout_batch", { p_period: period });
    dbError(error);
    await audit(profile.id, "payouts.batch_built", "payout_batch", id, { period });
    return (await admin.from("payout_batches").select("*").eq("id", id).single()).data;
  }

  if (b.action === "approve") {
    const { data: batch } = await admin.from("payout_batches").update({ status: "approved", approved_by: profile.id, approved_at: new Date().toISOString() })
      .eq("id", b.batch_id).eq("status", "draft").select().maybeSingle();
    if (!batch) throw new HttpError(409, "This batch isn't waiting for approval.");
    await audit(profile.id, "payouts.batch_approved", "payout_batch", batch.id, { total_cents: batch.total_cents, count: batch.payout_count });

    const { data: payouts } = await admin.from("payouts").select("*, profiles(stripe_account_id, payouts_enabled)").eq("batch_id", batch.id).eq("status", "queued");
    let sent = 0, failed = 0;
    for (const p of payouts ?? []) {
      const now = new Date().toISOString();
      try {
        if (!p.profiles?.payouts_enabled || !p.profiles?.stripe_account_id) throw new Error("Member payouts not enabled");
        const t = await stripe.transfers.create({
          amount: p.amount_cents, currency: "usd", destination: p.profiles.stripe_account_id,
          transfer_group: `mole-${batch.period}`, metadata: { payout_id: p.id, member_id: p.member_id },
        }, { idempotencyKey: `payout-${p.id}` });
        await admin.from("payouts").update({ status: "sent", stripe_transfer_id: t.id, sent_at: now }).eq("id", p.id);
        await admin.from("referrals").update({ status: "paid", paid_at: now }).eq("payout_id", p.id);
        await notify(p.member_id, { kind: "payout_sent", title: "You've been paid", body: `${money(p.amount_cents)} is on its way to your bank. Most banks show it in 1–2 business days.`, link: "#earnings", sms: true });
        sent++;
      } catch (e: any) {
        await admin.from("payouts").update({ status: "failed", error: String(e?.message ?? e).slice(0, 300) }).eq("id", p.id);
        await admin.from("referrals").update({ payout_id: null }).eq("payout_id", p.id); // rolls into next month
        await notify(p.member_id, { kind: "payout_failed", title: "Payout delayed", body: "We couldn't send your payout. Check Payout setup; we'll retry next month.", link: "#payout" });
        failed++;
      }
    }
    await admin.from("payout_batches").update({ status: "sent", sent_count: sent, failed_count: failed }).eq("id", batch.id);
    await audit(profile.id, "payouts.batch_sent", "payout_batch", batch.id, { sent, failed });
    return { sent, failed };
  }
  throw new HttpError(400, "Unknown action.");
});
