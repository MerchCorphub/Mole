// deno-lint-ignore-file no-explicit-any
// One call sends to the in-app inbox + push + email (+ SMS when flagged), honoring each user's settings.
import webpush from "npm:web-push@3.6.7";
import { admin, env, APP_URL } from "./core.ts";

export type Note = { kind: string; title: string; body: string; link?: string; email?: boolean; sms?: boolean };

let vapidReady = false;
function vapid() {
  if (vapidReady) return;
  webpush.setVapidDetails(`mailto:${env("SUPPORT_EMAIL")}`, env("VAPID_PUBLIC_KEY"), env("VAPID_PRIVATE_KEY"));
  vapidReady = true;
}

export async function notify(userId: string, n: Note) {
  const { data: p } = await admin.from("profiles")
    .select("email, phone, notify_push, notify_email, notify_sms, sms_consent_at, status").eq("id", userId).single();
  if (!p || p.status === "deleted") return;
  await admin.from("notifications").insert({ user_id: userId, kind: n.kind, title: n.title, body: n.body, link: n.link ?? null });
  const jobs: Promise<unknown>[] = [];
  if (p.notify_push) jobs.push(sendPush(userId, n));
  if (n.email !== false && p.notify_email && p.email) jobs.push(sendEmail(p.email, n.title, n.body, n.link));
  if (n.sms && p.notify_sms && p.sms_consent_at && p.phone) jobs.push(sendSms(p.phone, `MOLE: ${n.title}. ${n.body} Reply STOP to opt out.`));
  for (const r of await Promise.allSettled(jobs)) if (r.status === "rejected") console.error("notify", r.reason);
}

export async function notifyStaff(roles: string[], n: Note) {
  const { data } = await admin.from("profiles").select("id").in("role", roles).eq("status", "active");
  for (const s of data ?? []) await notify(s.id, { ...n, sms: false });
}

async function sendPush(userId: string, n: Note) {
  const { data: subs } = await admin.from("push_subscriptions").select("*").eq("user_id", userId);
  if (!subs?.length) return;
  vapid();
  for (const s of subs) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify({ title: n.title, body: n.body, link: n.link ?? "" }));
    } catch (e: any) {
      if (e?.statusCode === 404 || e?.statusCode === 410) await admin.from("push_subscriptions").delete().eq("id", s.id);
      else throw e;
    }
  }
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

export async function sendEmail(to: string, subject: string, text: string, link?: string) {
  const url = link ? `${APP_URL()}/${link.replace(/^\//, "")}` : APP_URL();
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;color:#10241A">
<div style="background:#0A3B24;color:#E6BE62;padding:18px 24px;font-weight:800;letter-spacing:.24em;font-size:13px">MOLE NETWORK</div>
<div style="padding:24px;background:#ffffff"><h2 style="margin:0 0 12px;font-size:20px;color:#0A3B24">${esc(subject)}</h2>
<p style="font-size:15px;line-height:1.55;margin:0 0 20px">${esc(text)}</p>
<a href="${url}" style="display:inline-block;background:#0F4D30;color:#ffffff;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:700">Open MOLE</a>
<p style="font-size:12px;color:#5E6B63;margin:24px 0 0">You're getting this because of your MOLE notification settings. Change them in Profile → Notifications.<br>Merch Corporation · Georgia, USA</p></div></div>`;
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env("RESEND_API_KEY")}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: env("EMAIL_FROM"), to, subject, html, text: `${text}\n\n${url}` }),
  });
  if (!r.ok) throw new Error(`Resend ${r.status}: ${await r.text()}`);
}

export async function sendSms(to: string, text: string) {
  const sid = env("TWILIO_ACCOUNT_SID");
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: { Authorization: "Basic " + btoa(`${sid}:${env("TWILIO_AUTH_TOKEN")}`), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ To: to, MessagingServiceSid: env("TWILIO_MESSAGING_SERVICE_SID"), Body: text }),
  });
  if (!r.ok) throw new Error(`Twilio ${r.status}: ${await r.text()}`);
}
