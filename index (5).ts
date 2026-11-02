// Member disputes a rejected referral. Body: { referral_id, reason, details, evidence_paths? }
// Upload evidence first to storage bucket "evidence" under <user id>/...
import { admin, serve, body, getUser, HttpError, dbError, audit } from "../_shared/core.ts";
import { notify, notifyStaff } from "../_shared/notify.ts";

serve(async (req) => {
  const { profile } = await getUser(req);
  const b = await body(req);
  const paths = (Array.isArray(b.evidence_paths) ? b.evidence_paths : []).filter((p: string) => typeof p === "string" && p.startsWith(`${profile.id}/`)).slice(0, 5);
  if (!b.reason) throw new HttpError(400, "Pick a reason.");
  const { data: d, error } = await admin.rpc("file_dispute", {
    p_member: profile.id, p_referral: b.referral_id, p_reason: String(b.reason).slice(0, 80), p_details: String(b.details ?? "").slice(0, 2000), p_evidence: paths,
  });
  dbError(error);
  await audit(profile.id, "dispute.filed", "dispute", d.id, { referral_id: b.referral_id });
  const { data: biz } = await admin.from("businesses").select("owner_id, name").eq("id", d.business_id).single();
  if (biz) await notify(biz.owner_id, { kind: "dispute_filed", title: "A member disputed your decision", body: "MOLE support will review it and decide within 5 business days.", link: "#review" });
  await notifyStaff(["staff_support", "staff_admin"], { kind: "dispute_filed", title: "New dispute", body: `${biz?.name ?? "A business"} — ${b.reason}`, link: "#staff/disputes", email: true });
  return { dispute_id: d.id, status: d.status };
});
