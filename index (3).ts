// Member payout setup with Stripe Connect Express (identity, bank, tax info).
// Body: { action: "onboard" | "status" | "dashboard" }
import { admin, serve, body, getUser, HttpError, stripe, APP_URL, audit, syncConnectedAccount } from "../_shared/core.ts";

serve(async (req) => {
  const { profile } = await getUser(req);
  const { action } = await body(req);
  let acct: string | null = profile.stripe_account_id;

  if (action === "onboard") {
    if (!acct) {
      const a = await stripe.accounts.create({
        type: "express", country: "US", email: profile.email ?? undefined, business_type: "individual",
        capabilities: { transfers: { requested: true } },
        business_profile: { product_description: "Referral rewards earned through MOLE Network" },
        metadata: { profile_id: profile.id },
      }, { idempotencyKey: `connect-${profile.id}` });
      acct = a.id;
      await admin.from("profiles").update({ stripe_account_id: acct }).eq("id", profile.id);
      await audit(profile.id, "payouts.account_created", "profile", profile.id, { stripe_account: acct });
    }
    const link = await stripe.accountLinks.create({
      account: acct, type: "account_onboarding",
      refresh_url: `${APP_URL()}/#payout`, return_url: `${APP_URL()}/#payout?done=1`,
    });
    return { url: link.url };
  }
  if (!acct) throw new HttpError(400, "Payouts aren't set up yet.");
  if (action === "status") return await syncConnectedAccount(await stripe.accounts.retrieve(acct));
  if (action === "dashboard") return { url: (await stripe.accounts.createLoginLink(acct)).url };
  throw new HttpError(400, "Unknown action.");
});
