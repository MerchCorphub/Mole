// deno-lint-ignore-file no-explicit-any
import { createClient } from "npm:@supabase/supabase-js@2";
import Stripe from "npm:stripe@17";

export const env = (k: string) => {
  const v = Deno.env.get(k);
  if (!v) throw new Error(`Missing secret ${k}`);
  return v;
};

export const admin = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
export const stripe = new Stripe(env("STRIPE_SECRET_KEY"), { httpClient: Stripe.createFetchHttpClient() });
export { Stripe };
export const APP_URL = () => env("APP_URL").replace(/\/$/, "");

export const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-mole-key, x-cron-secret",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

// Database exceptions → plain-language messages for the app
const DB_ERRORS: Record<string, [number, string]> = {
  self_referral: [403, "You can't earn on your own purchases or your own business."],
  monthly_cap: [409, "This offer has reached its monthly cap."],
  member_inactive: [403, "The referring member's account isn't active."],
  reward_below_minimum: [400, "Rewards must be at least $5.00."],
  not_reviewable: [409, "This referral has already been reviewed."],
  not_reversible: [409, "This reward has already cleared and can't be reversed."],
  not_disputable: [409, "Only rejected referrals can be disputed."],
  dispute_window_closed: [409, "Disputes must be filed within 30 days of the decision."],
  details_too_short: [400, "Please add at least 10 characters of detail."],
  insufficient_funds: [400, "That's more than your available wallet balance."],
  batch_locked: [409, "This payout batch is already approved."],
  restricted_category: [403, "This category isn't allowed on MOLE right now."],
  business_not_verified: [403, "Your business needs to be verified before offers go live."],
  offer_unavailable: [404, "This offer isn't available."],
  protected_field: [403, "That field can't be changed here."],
  not_found: [404, "Not found."],
};
export function dbError(e: { message?: string } | null | undefined) {
  if (!e) return;
  const hit = Object.entries(DB_ERRORS).find(([k]) => e.message?.includes(k));
  if (hit) throw new HttpError(hit[1][0], hit[1][1]);
  throw new Error(e.message ?? "Database error");
}

export function serve(fn: (req: Request) => Promise<unknown>) {
  Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
    try {
      return json(await fn(req));
    } catch (e: any) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error(e);
      return json({ error: status === 500 ? "Something went wrong. Please try again." : e.message }, status);
    }
  });
}

export async function body<T = Record<string, any>>(req: Request): Promise<T> {
  try { return await req.json(); } catch { return {} as T; }
}

export async function getUser(req: Request) {
  const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new HttpError(401, "Please sign in.");
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, "Please sign in.");
  const { data: profile } = await admin.from("profiles").select("*").eq("id", data.user.id).single();
  if (!profile || profile.status !== "active") throw new HttpError(403, "This account isn't active.");
  return { user: data.user, profile, token };
}

function claims(token: string) {
  const p = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
  return JSON.parse(atob(p + "=".repeat((4 - (p.length % 4)) % 4)));
}

export type StaffRole = "staff_support" | "staff_finance" | "staff_admin";
// Staff must have the role AND have signed in with two-step verification.
export async function requireStaff(req: Request, roles: StaffRole[]) {
  const ctx = await getUser(req);
  if (!roles.includes(ctx.profile.role)) throw new HttpError(403, "You don't have access to this.");
  if (claims(ctx.token).aal !== "aal2") throw new HttpError(403, "Two-step sign-in is required for staff.");
  return ctx;
}

export async function ownedBusiness(userId: string, businessId?: string) {
  let q = admin.from("businesses").select("*").eq("owner_id", userId);
  if (businessId) q = q.eq("id", businessId);
  const { data } = await q.order("created_at").limit(1).maybeSingle();
  if (!data) throw new HttpError(403, "No business found on your account.");
  return data;
}

export async function audit(actorId: string | null, action: string, targetType: string, targetId: string | null, details: Record<string, unknown> = {}) {
  const { error } = await admin.from("audit_log").insert({ actor_id: actorId, action, target_type: targetType, target_id: targetId, details });
  if (error) console.error("audit", error);
}

export async function sha256(s: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const money = (c: number) => `$${(c / 100).toFixed(2)}`;
export const shortDate = (d: string | Date) => new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });
export const clientIp = (req: Request) => req.headers.get("x-forwarded-for")?.split(",")[0].trim() || null;

export async function ensureCustomer(biz: any, ownerEmail?: string | null) {
  if (biz.stripe_customer_id) return biz.stripe_customer_id as string;
  const c = await stripe.customers.create({ name: biz.name, email: ownerEmail ?? undefined, metadata: { business_id: biz.id } });
  await admin.from("businesses").update({ stripe_customer_id: c.id }).eq("id", biz.id);
  return c.id;
}

export async function syncConnectedAccount(a: any) {
  const bank = a.external_accounts?.data?.[0];
  const patch = { payouts_enabled: !!(a.details_submitted && a.payouts_enabled), bank_last4: bank?.last4 ?? null };
  await admin.from("profiles").update(patch).eq("stripe_account_id", a.id);
  return { ...patch, details_submitted: !!a.details_submitted, requirements_due: a.requirements?.currently_due ?? [] };
}
