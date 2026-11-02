// deno-lint-ignore-file no-explicit-any
// Called by the scheduler only (x-cron-secret). Body: { task: "hourly" | "monthly_payouts" }
import { admin, serve, body, env, HttpError, dbError, money, shortDate } from "../_shared/core.ts";
import { notify, notifyStaff } from "../_shared/notify.ts";

const owners = new Map<string, any>();
async function biz(id: string) {
  if (!owners.has(id)) owners.set(id, (await admin.from("businesses").select("owner_id, name").eq("id", id).single()).data);
  return owners.get(id);
}

serve(async (req) => {
  if (req.headers.get("x-cron-secret") !== env("CRON_SECRET")) throw new HttpError(401, "Unauthorized");
  const { task } = await body(req);
  const out: Record<string, number> = {};

  if (task === "hourly") {
    const { data: approved, error: e1 } = await admin.rpc("auto_approve"); dbError(e1);
    for (const r of approved ?? []) {
      const b = await biz(r.business_id);
      await notify(r.member_id, { kind: "referral_approved", title: "Referral approved", body: `Your ${b?.name ?? ""} referral was approved automatically. ${money(r.net_cents)} clears ${shortDate(r.hold_until)}.`, link: "#earnings" });
      if (b) await notify(b.owner_id, { kind: "auto_approved", title: "Referral auto-approved", body: "7 days passed without a decision, so it was approved.", link: "#review", email: false });
    }
    out.auto_approved = approved?.length ?? 0;

    const { data: cleared, error: e2 } = await admin.rpc("clear_holds"); dbError(e2);
    for (const r of cleared ?? []) await notify(r.member_id, { kind: "reward_cleared", title: "Reward cleared", body: `${money(r.net_cents)} is ready for the next payout on the 15th.`, link: "#earnings", email: false });
    out.cleared = cleared?.length ?? 0;

    const soon = new Date(Date.now() + 864e5).toISOString();
    const { data: due } = await admin.from("referrals").select("id, business_id, verify_by").eq("status", "pending").eq("reminder_sent", false).lte("verify_by", soon);
    for (const r of due ?? []) {
      const b = await biz(r.business_id);
      if (b) await notify(b.owner_id, { kind: "review_due", title: "1 day left to review", body: `A referral is approved automatically on ${shortDate(r.verify_by)} unless you dispute it.`, link: "#review", sms: true });
      await admin.from("referrals").update({ reminder_sent: true }).eq("id", r.id);
    }
    out.reminders = due?.length ?? 0;

    const { data: flags, error: e3 } = await admin.rpc("fraud_scan"); dbError(e3);
    out.fraud_flags = flags ?? 0;
    if (flags) await notifyStaff(["staff_support", "staff_admin"], { kind: "fraud_flags", title: `${flags} new fraud flag${flags === 1 ? "" : "s"}`, body: "Flagged members' rewards are paused until reviewed.", link: "#staff/fraud", email: true });
  }

  if (task === "monthly_payouts") {
    const period = new Date().toISOString().slice(0, 7);
    const { data: id, error } = await admin.rpc("build_payout_batch", { p_period: period }); dbError(error);
    const { data: batch } = await admin.from("payout_batches").select("*").eq("id", id).single();
    await notifyStaff(["staff_finance", "staff_admin"], { kind: "payout_batch", title: `Payout batch ready: ${money(batch.total_cents)}`, body: `${batch.payout_count} members. Approve by the 15th.`, link: "#staff/payouts", email: true });

    // Members with cleared rewards but no payout account yet
    const { data: waiting } = await admin.from("referrals").select("member_id, profiles!inner(payouts_enabled)").eq("status", "cleared").is("payout_id", null).eq("profiles.payouts_enabled", false);
    for (const m of new Set((waiting ?? []).map((w: any) => w.member_id))) await notify(m as string, { kind: "payout_setup_needed", title: "Set up payouts to get paid", body: "You have cleared rewards waiting. Add your bank in Payout setup — it takes about 5 minutes.", link: "#payout", sms: true });
    out.batch_members = batch.payout_count;
  }
  return out;
});
