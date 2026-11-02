// deno-lint-ignore-file no-explicit-any
// Account housekeeping. Body:
//  { action: "touch", device_id }        → records sign-in network + device (duplicate-account checks)
//  { action: "sms_consent", phone, consent } → TCPA-style opt-in for texts
//  { action: "delete", confirm: true }  → deletes personal data; keeps anonymized financial records
import { admin, serve, body, getUser, HttpError, clientIp, audit, money } from "../_shared/core.ts";

serve(async (req) => {
  const { profile } = await getUser(req);
  const b = await body(req);

  if (b.action === "touch") {
    const id = String(b.device_id ?? "").slice(0, 64);
    const devices = id && !profile.device_ids.includes(id) ? [...profile.device_ids, id].slice(-10) : profile.device_ids;
    await admin.from("profiles").update({ last_ip: clientIp(req), device_ids: devices }).eq("id", profile.id);
    return { ok: true };
  }

  if (b.action === "sms_consent") {
    if (b.consent) {
      const phone = String(b.phone ?? "").replace(/[^\d+]/g, "");
      if (!/^\+1\d{10}$/.test(phone)) throw new HttpError(400, "Enter a US mobile number like +14045551234.");
      await admin.from("profiles").update({ phone, notify_sms: true, sms_consent_at: new Date().toISOString() }).eq("id", profile.id);
    } else await admin.from("profiles").update({ notify_sms: false, sms_consent_at: null }).eq("id", profile.id);
    await audit(profile.id, b.consent ? "sms.opt_in" : "sms.opt_out", "profile", profile.id, { ip: clientIp(req) });
    return { ok: true };
  }

  if (b.action === "delete") {
    if (b.confirm !== true) throw new HttpError(400, "Please confirm.");
    const { data: owed } = await admin.from("referrals").select("net_cents").eq("member_id", profile.id).in("status", ["pending", "held", "cleared", "disputed"]);
    const total = (owed ?? []).reduce((s: number, r: any) => s + r.net_cents, 0);
    if (total > 0 && b.forfeit !== true) throw new HttpError(409, `You have ${money(total)} in rewards still in progress. Wait for your payout, or confirm you want to give it up.`);
    await admin.from("businesses").select("id").eq("owner_id", profile.id).then(({ data }) => { if (data?.length) throw new HttpError(409, "Close or transfer your business first."); });
    await admin.from("referrals").update({ status: "reversed", reject_reason: "Account deleted" }).eq("member_id", profile.id).in("status", ["pending", "held", "cleared", "disputed"]);
    await admin.from("push_subscriptions").delete().eq("user_id", profile.id);
    await admin.from("profiles").update({ full_name: "Deleted member", email: null, phone: null, city: null, bio: null, interests: [], social_links: {}, status: "deleted", notify_push: false, notify_email: false, notify_sms: false, device_ids: [], last_ip: null }).eq("id", profile.id);
    await admin.auth.admin.deleteUser(profile.id, true);
    await audit(profile.id, "account.deleted", "profile", profile.id, { forfeited_cents: total });
    return { ok: true };
  }
  throw new HttpError(400, "Unknown action.");
});
