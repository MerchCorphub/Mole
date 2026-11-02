// deno-lint-ignore-file no-explicit-any
// Referral link: https://<project>.supabase.co/functions/v1/r?s=<slug>
// Logs the click, then sends the visitor to the business with ?mole_click=<id> for attribution.
import { admin, APP_URL, clientIp } from "../_shared/core.ts";

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const slug = url.searchParams.get("s") ?? url.pathname.split("/").filter(Boolean).pop() ?? "";
  const fallback = APP_URL();
  if (!/^[a-f0-9]{10}$/.test(slug)) return Response.redirect(fallback, 302);

  const { data: link } = await admin.from("referral_links").select("id, member_id, offer_id").eq("slug", slug).maybeSingle();
  if (!link) return Response.redirect(fallback, 302);
  const { data: offer } = await admin.from("offers").select("id, status, landing_url, businesses(website)").eq("id", link.offer_id).single();

  const ua = req.headers.get("user-agent") ?? "";
  const isBot = /bot|crawl|spider|preview|facebookexternalhit|slackbot|whatsapp|twitterbot|discord/i.test(ua);
  let clickId = "";
  if (!isBot && offer?.status === "active") {
    const { data: click } = await admin.from("clicks")
      .insert({ link_id: link.id, member_id: link.member_id, offer_id: link.offer_id, ip: clientIp(req), user_agent: ua.slice(0, 400) })
      .select("id").single();
    clickId = click?.id ?? "";
  }

  const target = offer?.status === "active" ? (offer.landing_url || (offer as any).businesses?.website) : null;
  const dest = new URL(target || `${fallback}/#offer/${link.offer_id}`);
  if (clickId) dest.searchParams.set("mole_click", clickId);
  dest.searchParams.set("mole_ref", slug);
  return new Response(null, { status: 302, headers: { Location: dest.toString(), "Cache-Control": "no-store" } });
});
