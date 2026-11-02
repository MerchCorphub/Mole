// deno-lint-ignore-file no-explicit-any
// Staff console actions. Every action needs a staff role + two-step sign-in, and is written to the audit log.
import { admin, serve, body, requireStaff, HttpError, dbError, audit, StaffRole } from "../_shared/core.ts";
import { notify } from "../_shared/notify.ts";

const ACCESS: Record<string, StaffRole[]> = {
  verify_business: ["staff_support", "staff_admin"],
  decide_dispute: ["staff_support", "staff_admin"],
  resolve_flag: ["staff_support", "staff_admin"],
  suspend_user: ["staff_support", "staff_admin"],
  reverse_referral: ["staff_finance", "staff_admin"],
  unfreeze_business: ["staff_finance", "staff_admin"],
  set_role: ["staff_admin"],
  set_category: ["staff_admin"],
};

serve(async (req) => {
  const b = await body(req);
  const roles = ACCESS[b.action];
  if (!roles) throw new HttpError(400, "Unknown action.");
  const { profile } = await requireStaff(req, roles);
  const me = profile.id;

  switch (b.action) {
    case "verify_business": {
      const approve = b.approve !== false;
      const { data: biz } = await admin.from("businesses").update(approve ? { verified: true, verified_at: new Date().toISOString() } : { verified: false })
        .eq("id", b.business_id).select("id, owner_id, name").single();
      await audit(me, approve ? "business.verified" : "business.declined", "business", b.business_id, { note: b.note ?? null });
      await notify(biz.owner_id, approve
        ? { kind: "business_verified", title: "Your business is verified", body: `${biz.name} can now publish offers. Fund your Reward Wallet to go live.`, link: "#business" }
        : { kind: "business_declined", title: "Verification needs more info", body: b.note || "Please check your business details and contact MOLE support.", link: "#business" });
      break;
    }
    case "decide_dispute": {
      const { data: d } = await admin.from("disputes").select("*").eq("id", b.dispute_id).single();
      if (!d || d.status === "decided") throw new HttpError(409, "This dispute is already decided.");
      const winner = b.winner === "member" ? "member" : "business";
      if (winner === "member") dbError((await admin.rpc("approve_referral", { p_id: d.referral_id })).error);
      else dbError((await admin.rpc("reject_referral", { p_id: d.referral_id, p_reason: d.business_reason })).error);
      await admin.from("disputes").update({ status: "decided", winner, decision_note: b.note ?? null, decided_by: me, decided_at: new Date().toISOString() }).eq("id", d.id);
      await audit(me, "dispute.decided", "dispute", d.id, { winner, note: b.note ?? null });
      const msg = winner === "member" ? "Decision: in your favor. The reward is approved and in its hold period." : "Decision: the business's decision stands.";
      await notify(d.member_id, { kind: "dispute_decided", title: "Dispute decided", body: `${msg}${b.note ? ` ${b.note}` : ""}`, link: "#earnings" });
      const { data: biz } = await admin.from("businesses").select("owner_id").eq("id", d.business_id).single();
      await notify(biz.owner_id, { kind: "dispute_decided", title: "Dispute decided", body: winner === "member" ? "MOLE approved the member's reward." : "Your decision was upheld.", link: "#review" });
      break;
    }
    case "resolve_flag": {
      const outcome = b.outcome === "actioned" ? "actioned" : "cleared";
      const { data: f } = await admin.from("fraud_flags").update({ status: outcome, reviewed_by: me, reviewed_at: new Date().toISOString() }).eq("id", b.flag_id).select().single();
      if (outcome === "actioned" && f.referral_id) await admin.rpc("reverse_referral", { p_id: f.referral_id, p_reason: "Failed fraud review" });
      if (outcome === "actioned" && b.suspend && f.member_id) await admin.from("profiles").update({ status: "suspended" }).eq("id", f.member_id);
      await audit(me, "fraud.resolved", "fraud_flag", f.id, { outcome, suspend: !!b.suspend });
      break;
    }
    case "suspend_user": {
      const status = b.restore ? "active" : "suspended";
      await admin.from("profiles").update({ status }).eq("id", b.user_id);
      await audit(me, `user.${status}`, "profile", b.user_id, { note: b.note ?? null });
      break;
    }
    case "reverse_referral":
      dbError((await admin.rpc("reverse_referral", { p_id: b.referral_id, p_reason: b.reason ?? "Reversed by MOLE" })).error);
      await audit(me, "referral.reverse", "referral", b.referral_id, { reason: b.reason ?? null });
      break;
    case "unfreeze_business":
      await admin.from("businesses").update({ status: "active" }).eq("id", b.business_id);
      await audit(me, "business.unfrozen", "business", b.business_id, { note: b.note ?? null });
      break;
    case "set_role": {
      const allowed = ["member", "staff_support", "staff_finance", "staff_admin"];
      if (!allowed.includes(b.role)) throw new HttpError(400, "Unknown role.");
      if (b.user_id === me) throw new HttpError(400, "You can't change your own role.");
      await admin.from("profiles").update({ role: b.role }).eq("id", b.user_id);
      await audit(me, "staff.role_changed", "profile", b.user_id, { role: b.role });
      break;
    }
    case "set_category":
      await admin.from("restricted_categories").upsert({ category: String(b.category).trim(), blocked: !!b.blocked });
      await audit(me, "category.set", "category", String(b.category), { blocked: !!b.blocked });
      break;
  }
  return { ok: true };
});
