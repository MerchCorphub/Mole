// deno-lint-ignore-file no-explicit-any
// Business reviews a referral. Body: { referral_id, action: "approve" | "reject" | "refund", reason? }
import { admin, serve, body, getUser, HttpError, dbError, audit, money } from "../_shared/core.ts";
import { notify } from "../_shared/notify.ts";

serve(async (req) => {
  const { profile } = await getUser(req);
  const b = await body(req);
  const { data: r } = await admin.from("referrals").select("*, businesses!inner(owner_id, name)").eq("id", b.referral_id).maybeSingle();
  if (!r || (r as any).businesses.owner_id !== profile.id) throw new HttpError(404, "Referral not found.");
  const biz = (r as any).businesses.name;
  const reason = String(b.reason ?? "").trim();

  if (b.action === "approve") {
    if (r.status !== "pending") throw new HttpError(409, "This referral has already been reviewed.");
    dbError((await admin.rpc("approve_referral", { p_id: r.id })).error);
    await audit(profile.id, "referral.approve", "referral", r.id);
    await notify(r.member_id, { kind: "referral_approved", title: "Referral approved",
      body: `${biz} approved your referral. ${money(r.net_cents)} clears after the ${r.kind === "lead" ? 14 : 30}-day hold.`, link: "#earnings" });
  } else if (b.action === "reject") {
    if (r.status !== "pending") throw new HttpError(409, "This referral has already been reviewed.");
    if (reason.length < 5) throw new HttpError(400, "Please tell the member why.");
    dbError((await admin.rpc("reject_referral", { p_id: r.id, p_reason: reason })).error);
    await audit(profile.id, "referral.reject", "referral", r.id, { reason });
    await notify(r.member_id, { kind: "referral_rejected", title: "Referral not approved",
      body: `${biz}: "${reason}". You can dispute this within 30 days.`, link: `#dispute/${r.id}` });
  } else if (b.action === "refund") {
    if (!["pending", "held"].includes(r.status)) throw new HttpError(409, "This reward has already cleared and can't be reversed.");
    dbError((await admin.rpc("reverse_referral", { p_id: r.id, p_reason: reason || "Customer refund or chargeback" })).error);
    await audit(profile.id, "referral.reverse", "referral", r.id, { reason });
    await notify(r.member_id, { kind: "referral_reversed", title: "Reward reversed",
      body: `${biz} reported a refund or chargeback, so this ${money(r.net_cents)} reward was reversed.`, link: "#earnings" });
  } else throw new HttpError(400, "Unknown action.");
  return { ok: true };
});
