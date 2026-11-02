// deno-lint-ignore-file no-explicit-any
// Records a sale, lead, or sign-up. Two ways in:
//  • Business website / checkout: header x-mole-key: <business public key>, body { click_id | promo_code, ... }
//  • Business owner in the app ("Record a sale"): signed in, body { business_id, promo_code, ... }
// Body: { click_id?, promo_code?, order_ref?, amount_cents?, customer_email?, customer_label? }
import { admin, serve, body, getUser, HttpError, dbError, sha256, money, shortDate } from "../_shared/core.ts";
import { notify } from "../_shared/notify.ts";

serve(async (req) => {
  const b = await body(req);
  const key = req.headers.get("x-mole-key");
  let business: any = null;
  if (key) business = (await admin.from("businesses").select("*").eq("public_key", key).maybeSingle()).data;
  else {
    const { profile } = await getUser(req);
    business = (await admin.from("businesses").select("*").eq("owner_id", profile.id).eq("id", b.business_id).maybeSingle()).data;
  }
  if (!business) throw new HttpError(403, "Unknown business.");
  if (!business.verified || business.status !== "active") throw new HttpError(403, "This business isn't verified yet.");

  // Attribution: last click wins; promo code is the fallback.
  let click: any = null, link: any = null;
  if (b.click_id && /^[0-9a-f-]{36}$/i.test(b.click_id)) {
    click = (await admin.from("clicks").select("*").eq("id", b.click_id).maybeSingle()).data;
    if (click) link = (await admin.from("referral_links").select("*").eq("id", click.link_id).single()).data;
  }
  const viaCode = !link && !!b.promo_code;
  if (viaCode) link = (await admin.from("referral_links").select("*").eq("promo_code", String(b.promo_code).trim().toUpperCase()).maybeSingle()).data;
  if (!link) throw new HttpError(404, "No matching referral link or promo code.");

  const { data: offer } = await admin.from("offers").select("*").eq("id", link.offer_id).single();
  if (offer.business_id !== business.id) throw new HttpError(400, "That code belongs to a different business.");
  if (offer.status !== "active") throw new HttpError(409, "This offer is paused.");

  const windowDays = offer.type === "lead" ? 7 : 30;
  if (!viaCode && Date.now() - Date.parse(click.created_at) > windowDays * 864e5)
    throw new HttpError(409, `This referral is outside the ${windowDays}-day window.`);
  if (viaCode) click = (await admin.from("clicks").select("id").eq("link_id", link.id).order("created_at", { ascending: false }).limit(1).maybeSingle()).data;

  const customerHash = b.customer_email ? await sha256(String(b.customer_email).trim().toLowerCase()) : null;
  if (offer.first_time_only && customerHash) {
    const { count } = await admin.from("referrals").select("id", { count: "exact", head: true })
      .eq("business_id", business.id).eq("customer_hash", customerHash).not("status", "in", "(rejected,reversed)");
    if (count) throw new HttpError(409, "This offer is for first-time customers only.");
  }

  const amount = Math.round(Number(b.amount_cents) || 0);
  if (offer.type === "percent" && amount <= 0) throw new HttpError(400, "Order amount is required for percentage offers.");
  const reward = offer.type === "percent" ? Math.max(offer.reward_cents, Math.round((amount * Number(offer.percent)) / 100)) : offer.reward_cents;

  const { data: ref, error } = await admin.rpc("create_referral", {
    p_link: link.id, p_click: click?.id ?? null, p_reward: reward,
    p_order_ref: b.order_ref ? String(b.order_ref).slice(0, 120) : null, p_amount: amount || null,
    p_customer_hash: customerHash, p_customer_label: b.customer_label ? String(b.customer_label).slice(0, 80) : null,
  });
  if ((error as any)?.code === "23505") throw new HttpError(409, "This order was already recorded.");
  dbError(error);

  await notify(link.member_id, {
    kind: "referral_new", title: "New referral recorded",
    body: `${business.name} recorded a referral from you. You'll earn ${money(ref.net_cents)} once it's verified.`, link: "#tracking",
  });
  await notify(business.owner_id, {
    kind: "review_needed", title: "Referral to review",
    body: `Approve or dispute by ${shortDate(ref.verify_by)}. After that it's approved automatically.`, link: "#review",
  });
  return { referral_id: ref.id, status: ref.status, reward_cents: ref.reward_cents };
});
