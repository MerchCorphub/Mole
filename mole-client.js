// MOLE app ↔ backend. Load after config.js:
//   <script src="app/config.js"></script>
//   <script type="module"> import * as MOLE from "./app/mole-client.js"; </script>
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cfg = window.MOLE_CONFIG;
export const sb = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, { auth: { persistSession: true, detectSessionInUrl: true } });

const home = () => location.origin + location.pathname;
const q = async (p) => { const { data, error } = await p; if (error) throw new Error(error.message); return data; };
async function fn(name, payload) {
  const { data, error } = await sb.functions.invoke(name, { body: payload });
  if (error) { let msg = error.message; try { msg = (await error.context.json()).error || msg; } catch {} throw new Error(msg); }
  return data;
}
const go = (r) => { location.assign(r.url); return r; };
const uid = async () => { const id = (await sb.auth.getSession()).data.session?.user.id; if (!id) throw new Error("Please sign in."); return id; };
const since = (days) => new Date(Date.now() - days * 864e5).toISOString();
const deviceId = () => { let d = localStorage.getItem("mole_device"); if (!d) { d = crypto.randomUUID(); localStorage.setItem("mole_device", d); } return d; };

// Same rule as the server: greater of reward × tier or $1.
export const fee = (c) => Math.max(100, Math.round(c * (c <= 10000 ? 0.2 : c <= 50000 ? 0.15 : 0.1)));
export const money = (c) => `$${(c / 100).toFixed(2)}`;
export const nextPayoutDate = () => { const d = new Date(); const p = new Date(d.getFullYear(), d.getMonth() + (d.getDate() >= 15 ? 1 : 0), 15); return p; };

// ───────── Sign up / sign in ─────────
export const auth = {
  signUp: (name, email, password) => q(sb.auth.signUp({ email, password, options: { data: { full_name: name }, emailRedirectTo: home() } })),
  signIn: (email, password) => q(sb.auth.signInWithPassword({ email, password })),
  social: (provider) => q(sb.auth.signInWithOAuth({ provider, options: { redirectTo: home() } })), // "google" | "apple" | "facebook"
  forgotPassword: (email) => q(sb.auth.resetPasswordForEmail(email, { redirectTo: home() + "#reset" })),
  setNewPassword: (password) => q(sb.auth.updateUser({ password })),
  signOut: () => q(sb.auth.signOut()),
  session: async () => (await sb.auth.getSession()).data.session,
  onChange(cb) {
    return sb.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN") fn("account", { action: "touch", device_id: deviceId() }).catch(() => {});
      cb(event, session);
    });
  },
  // Staff two-step sign-in (authenticator app)
  mfa: {
    enroll: () => q(sb.auth.mfa.enroll({ factorType: "totp", friendlyName: "MOLE staff" })), // returns { id, totp: { qr_code } }
    factors: () => q(sb.auth.mfa.listFactors()),
    verify: async (factorId, code) => { const c = await q(sb.auth.mfa.challenge({ factorId })); return q(sb.auth.mfa.verify({ factorId, challengeId: c.id, code })); },
    level: () => q(sb.auth.mfa.getAuthenticatorAssuranceLevel()),
  },
};

// ───────── Member ─────────
export const member = {
  profile: async () => q(sb.from("profiles").select("*").eq("id", await uid()).single()),
  update: async (patch) => q(sb.from("profiles").update(patch).eq("id", await uid()).select().single()), // name, city, bio, interests, social_links, notify_*
  async shareLink(offerId) {
    const l = await q(sb.rpc("get_or_create_link", { p_offer: offerId }));
    return { ...l, url: `${cfg.shareBase || cfg.supabaseUrl + "/functions/v1/r?s="}${l.slug}` };
  },
  referrals: async (days = 30) => q(sb.from("referrals").select("*, offers(title), disputes(id, status, winner)").eq("member_id", await uid()).gte("created_at", since(days)).order("created_at", { ascending: false })),
  clicks: async (days = 30) => q(sb.from("clicks").select("id, offer_id, created_at").eq("member_id", await uid()).gte("created_at", since(days))),
  async earnings() {
    const rows = await q(sb.from("referrals").select("status, net_cents").eq("member_id", await uid()));
    const sum = (...s) => rows.filter((r) => s.includes(r.status)).reduce((a, r) => a + r.net_cents, 0);
    const pending = sum("pending", "disputed"), approved = sum("held", "cleared"), paid = sum("paid");
    return { pending, approved, paid, total: pending + approved + paid, nextPayout: nextPayoutDate() };
  },
  payouts: async () => q(sb.from("payouts").select("*").eq("member_id", await uid()).order("created_at", { ascending: false })),
  payoutSetup: () => fn("connect", { action: "onboard" }).then(go),
  payoutStatus: () => fn("connect", { action: "status" }),
  payoutDashboard: () => fn("connect", { action: "dashboard" }).then(go),
  async dispute(referralId, reason, details, files = []) {
    const me = await uid(); const paths = [];
    for (const f of files.slice(0, 5)) {
      const path = `${me}/${referralId}/${Date.now()}-${f.name.replace(/[^\w.-]/g, "_")}`;
      await q(sb.storage.from("evidence").upload(path, f)); paths.push(path);
    }
    return fn("dispute", { referral_id: referralId, reason, details, evidence_paths: paths });
  },
  smsOptIn: (phone) => fn("account", { action: "sms_consent", phone, consent: true }),
  smsOptOut: () => fn("account", { action: "sms_consent", consent: false }),
  deleteAccount: (forfeit = false) => fn("account", { action: "delete", confirm: true, forfeit }),
  displayName: (id) => q(sb.rpc("member_display", { p_id: id })),
};

// ───────── Marketplace (works signed out) ─────────
export const market = {
  offers({ category, search, sort = "top", limit = 50 } = {}) {
    let p = sb.from("marketplace_offers").select("*").limit(limit);
    if (category) p = p.eq("category", category);
    if (search) p = p.or(`title.ilike.%${search}%,business_name.ilike.%${search}%`);
    p = sort === "newest" ? p.order("created_at", { ascending: false }) : p.order("featured", { ascending: false }).order("reward_cents", { ascending: false });
    return q(p);
  },
  offer: (id) => q(sb.from("marketplace_offers").select("*").eq("id", id).maybeSingle()),
  business: (id) => q(sb.from("marketplace_offers").select("*").eq("business_id", id)),
  // Client-side distance filter (miles) for "Nearest" + 5/10/25 mi
  near(list, lat, lng, miles) {
    const d = (o) => { const R = 3959, r = Math.PI / 180, a = Math.sin(((o.lat - lat) * r) / 2) ** 2 + Math.cos(lat * r) * Math.cos(o.lat * r) * Math.sin(((o.lng - lng) * r) / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(a)); };
    return list.filter((o) => o.lat != null).map((o) => ({ ...o, miles: d(o) })).filter((o) => !miles || o.miles <= miles).sort((a, b) => a.miles - b.miles);
  },
};

// ───────── Business ─────────
export const business = {
  mine: async () => q(sb.from("businesses").select("*").eq("owner_id", await uid()).order("created_at").limit(1).maybeSingle()),
  create: async (b) => q(sb.from("businesses").insert({ ...b, owner_id: await uid() }).select().single()), // name, category, about, website, phone, address, lat, lng
  update: (id, patch) => q(sb.from("businesses").update(patch).eq("id", id).select().single()),
  offers: (businessId) => q(sb.from("offers").select("*").eq("business_id", businessId).order("created_at", { ascending: false })),
  postOffer: (o) => q(sb.from("offers").insert(o).select().single()), // business_id, title, type, reward_cents (≥500), percent?, monthly_cap_cents?, lead_criteria?, first_time_only, terms, landing_url, status: "active"
  updateOffer: (id, patch) => q(sb.from("offers").update(patch).eq("id", id).select().single()),
  reviewQueue: (businessId, kind) => { let p = sb.from("referrals").select("*").eq("business_id", businessId).eq("status", "pending").order("verify_by"); if (kind === "leads") p = p.eq("kind", "lead"); if (kind === "sales") p = p.neq("kind", "lead"); return q(p); },
  referrals: (businessId, days = 30) => q(sb.from("referrals").select("*").eq("business_id", businessId).gte("created_at", since(days)).order("created_at", { ascending: false })),
  approve: (id) => fn("review", { referral_id: id, action: "approve" }),
  reject: (id, reason) => fn("review", { referral_id: id, action: "reject", reason }),
  refund: (id, reason) => fn("review", { referral_id: id, action: "refund", reason }),
  recordSale: (p) => fn("conversion", p), // { business_id, promo_code, amount_cents?, order_ref?, customer_email?, customer_label? }
  wallet: {
    txns: (businessId) => q(sb.from("wallet_txns").select("*").eq("business_id", businessId).order("created_at", { ascending: false }).limit(100)),
    deposit: (amount_cents, method = "ach") => fn("wallet", { action: "deposit", amount_cents, method }).then(go),
    withdraw: (amount_cents) => fn("wallet", { action: "withdraw", amount_cents }),
    setCap: (monthly_cap_cents) => fn("wallet", { action: "set_cap", monthly_cap_cents }),
  },
  grow: (product, offerId) => fn("billing", { action: "subscribe", product, offer_id: offerId }).then(go), // featured | sponsored | analytics
  billingPortal: () => fn("billing", { action: "portal" }).then(go),
  plans: (businessId) => q(sb.from("phase4_subscriptions").select("*").eq("business_id", businessId)),
};

// ───────── Inbox + push ─────────
export const inbox = {
  list: async () => q(sb.from("notifications").select("*").eq("user_id", await uid()).order("created_at", { ascending: false }).limit(100)),
  unread: async () => (await sb.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", await uid()).is("read_at", null)).count ?? 0,
  markRead: (id) => q(sb.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", id)),
  markAllRead: async () => q(sb.from("notifications").update({ read_at: new Date().toISOString() }).eq("user_id", await uid()).is("read_at", null)),
  live: async (onNew) => sb.channel("inbox").on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${await uid()}` }, (p) => onNew(p.new)).subscribe(),
  // iPhone: only works after "Add to Home Screen" (iOS 16.4+).
  async enablePush() {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) throw new Error("This browser doesn't support notifications. On iPhone, add MOLE to your Home Screen first.");
    if ((await Notification.requestPermission()) !== "granted") throw new Error("Notifications are blocked in your browser settings.");
    const reg = await navigator.serviceWorker.ready;
    const key = Uint8Array.from(atob(cfg.vapidPublicKey.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (cfg.vapidPublicKey.length % 4)) % 4)), (c) => c.charCodeAt(0));
    const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }));
    const j = sub.toJSON();
    return q(sb.from("push_subscriptions").upsert({ user_id: await uid(), endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth }, { onConflict: "endpoint" }));
  },
};

// ───────── Staff console ─────────
export const staff = {
  unverifiedBusinesses: () => q(sb.from("businesses").select("*").eq("verified", false).order("created_at")),
  disputes: () => q(sb.from("disputes").select("*, referrals(reward_cents, net_cents, kind, order_ref)").neq("status", "decided").order("created_at")),
  evidenceUrl: async (path) => (await q(sb.storage.from("evidence").createSignedUrl(path, 600))).signedUrl,
  flags: () => q(sb.from("fraud_flags").select("*").eq("status", "open").order("created_at", { ascending: false })),
  batches: () => q(sb.from("payout_batches").select("*").order("period", { ascending: false }).limit(12)),
  batchPayouts: (batchId) => q(sb.from("payouts").select("*").eq("batch_id", batchId)),
  categories: () => q(sb.from("restricted_categories").select("*").order("category")),
  auditLog: (limit = 200) => q(sb.from("audit_log").select("*").order("created_at", { ascending: false }).limit(limit)),
  buildBatch: (period) => fn("payouts", { action: "build", period }),
  approveBatch: (batchId) => fn("payouts", { action: "approve", batch_id: batchId }),
  verifyBusiness: (id, approve = true, note) => fn("admin", { action: "verify_business", business_id: id, approve, note }),
  decideDispute: (id, winner, note) => fn("admin", { action: "decide_dispute", dispute_id: id, winner, note }),
  resolveFlag: (id, outcome, suspend = false) => fn("admin", { action: "resolve_flag", flag_id: id, outcome, suspend }),
  suspendUser: (id, restore = false) => fn("admin", { action: "suspend_user", user_id: id, restore }),
  reverseReferral: (id, reason) => fn("admin", { action: "reverse_referral", referral_id: id, reason }),
  unfreezeBusiness: (id) => fn("admin", { action: "unfreeze_business", business_id: id }),
  setRole: (userId, role) => fn("admin", { action: "set_role", user_id: userId, role }),
  setCategory: (category, blocked) => fn("admin", { action: "set_category", category, blocked }),
};

// Install the offline/push service worker
if ("serviceWorker" in navigator) navigator.serviceWorker.register(cfg.serviceWorker || "./sw.js").catch(() => {});
