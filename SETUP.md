# MOLE Network backend — step-by-step setup

This folder is the working backend for the MOLE app: real accounts, a real database, referral tracking, Stripe payments and payouts, notifications, the staff console, Phase 4 billing and 1099s. You don't need to install anything on your computer. Everything happens in websites and in your GitHub repo.

**Plan on 2–3 sessions.** Twilio text-message approval and Apple sign-in setup take a few days to come through. Start those first.

> **Test mode first.** Do every step with Stripe in **Test mode** (toggle at the top right of Stripe). Switch to live keys only after the test checklist in step 12 passes.

---

## What's in this folder

| Folder / file | What it does |
|---|---|
| `supabase/migrations/` | The database: all tables, program rules, money handling, fraud checks, security rules |
| `supabase/functions/` | 12 server functions (listed at the bottom of this guide) |
| `.github/workflows/deploy-backend.yml` | Deploys the backend automatically whenever you upload changes |
| `app/mole-client.js`, `app/config.js` | Connects the app screens to the backend |
| `sw.js`, `manifest.webmanifest`, `icons/` | Lets members "Add to Home Screen" and get push notifications |
| `business/mole-pixel.js` | Snippet businesses paste on their website to report sales |

## Accounts you'll create

| Service | What it's for | Cost |
|---|---|---|
| Supabase | Database, sign-in, server functions | Free to start; Pro $25/mo for launch (daily backups) |
| Stripe | Wallet deposits, member payouts, Phase 4 billing, 1099s | Per-transaction (rates in the program doc) |
| Resend | Email | Free up to 3,000/mo |
| Twilio | Text messages | ~$0.008 per text + one-time 10DLC registration fee |
| Apple Developer | "Continue with Apple" | $99/yr |
| Google Cloud, Meta for Developers | Google & Facebook sign-in | Free |

---

## Step 1 — Upload this folder to GitHub

1. Open **github.com/MerchCorphub/Mole**.
2. Click **Add file → Upload files**. Drag in everything inside `mole-backend/` **except** the `.github` folder. The folders should land at the repo root, next to `index.html`.
3. Mac hides folders that start with a dot, so add the workflow by hand. Click **Add file → Create new file**, type the name `.github/workflows/deploy-backend.yml`, paste in the contents of that file, then **Commit**.

## Step 2 — Create the Supabase project

1. Go to **supabase.com → New project**. Name: `mole-network`. Region: **East US (North Virginia)**, the closest to Georgia.
2. Save the **database password** in a password manager.
3. Once it's created, open **Project Settings → General** and copy the **Reference ID** (for example `abcd1234efgh`).
4. Open **Project Settings → API** and copy the **Project URL**, the **anon public** key and the **service_role** key. Keep the service_role key secret.
5. Click your avatar → **Account → Access Tokens → Generate new token**. Name it `github-deploy` and copy it.

## Step 3 — Connect GitHub to Supabase

1. In the GitHub repo, open **Settings → Secrets and variables → Actions → New repository secret**. Add these three:
   - `SUPABASE_PROJECT_REF`: the Reference ID
   - `SUPABASE_DB_PASSWORD`: the database password
   - `SUPABASE_ACCESS_TOKEN`: the access token
2. Open the **Actions** tab → **Deploy MOLE backend** → **Run workflow**. In about 2 minutes it should show a green check. Your database and server functions are now live.
   - If it shows red, click it, copy the error and send it to me.

## Step 4 — Stripe

1. Create an account at **stripe.com** as **Merch Corporation** (Georgia).
2. **Connect:** Dashboard → **Connect → Get started**. Choose **Marketplace / Platform**, accounts type **Express**, country **United States**. Under **Connect → Settings → Branding**, add the MOLE logo and colors (#0A3B24 / #E6BE62).
3. **1099s:** **Connect → Tax reporting** (or Settings → Connect → Tax forms) → turn on **1099-NEC** for Express accounts and choose **Stripe files with the IRS** plus **state filing (Georgia)** where offered. Stripe collects each member's tax info (W-9 details) during payout setup and delivers their 1099 electronically.
   - The 1099 threshold for payments made in 2026 is **$2,000** (raised from $600). Confirm this with your accountant before January.
4. **Bank account payments:** Settings → Payment methods → turn on **ACH Direct Debit** and **Cards**.
5. **Phase 4 prices:** Products → **Add product** three times. Each one is **Recurring, Monthly**:
   - *MOLE Featured listing*
   - *MOLE Sponsored offer*
   - *MOLE Advanced analytics*

   Set your prices, then copy each **price ID** (starts with `price_`).
6. **Customer portal:** Settings → Billing → **Customer portal** → turn on "cancel subscriptions" and "update payment method".
7. **Webhooks:** Developers → **Webhooks → Add endpoint**:
   - URL: `https://YOUR-REF.supabase.co/functions/v1/stripe-webhook`
   - **Endpoint A**, "Events on your account": `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`, `charge.dispute.created`, `transfer.reversed`. Copy its **signing secret** (`whsec_…`).
   - **Endpoint B**, same URL, "Events on Connected accounts": `account.updated`. Copy its signing secret too.
8. Developers → **API keys**: copy the **Secret key** (`sk_test_…` for now).

## Step 5 — Resend (email)

1. Sign up at **resend.com** → **Domains → Add domain** (for example `molenetwork.com`). Add the DNS records it shows at your domain registrar, then wait for **Verified**.
2. **API Keys → Create**. Copy the key.
3. Your sender will be something like `MOLE Network <hello@molenetwork.com>`.

## Step 6 — Twilio (texts). Start this early.

1. Sign up at **twilio.com** → buy a **local Georgia number** (404/470/678 area codes).
2. **Messaging → Regulatory compliance → A2P 10DLC**. Register **Merch Corporation** as the brand and create a campaign:
   - Use case: "Account notifications".
   - Sample message: `MOLE: You've been paid. $42.50 is on its way to your bank. Reply STOP to opt out.`
   - Opt-in description: "Members opt in on the Notifications screen by entering their mobile number and checking a consent box."
   - Approval takes 3–10 days.
3. **Messaging → Services → Create** → add your number. Copy the **Messaging Service SID** (`MG…`), plus the **Account SID** and **Auth Token** from the console home.

## Step 7 — Push notification keys

1. Open **vapidkeys.com** (or any "VAPID key generator") and generate a pair.
2. Copy the **public** and **private** keys.
3. Push works on Android/desktop right away. On iPhone it works after the member taps **Share → Add to Home Screen** (iOS 16.4+).

## Step 8 — Social sign-in

1. In Supabase, open **Authentication → URL Configuration**:
   - Site URL: `https://merchcorphub.github.io/Mole/`
   - Add the same address under Redirect URLs.
2. Open **Authentication → Providers** and set up each one. Each provider page in Supabase shows the exact "Callback URL" to paste into Google, Apple or Facebook.
   - **Google:** console.cloud.google.com → APIs & Services → Credentials → **OAuth client ID (Web)**. Paste the callback URL. Copy the Client ID and Secret into Supabase.
   - **Apple:** developer.apple.com → Identifiers → **Services ID** (Sign in with Apple, add the callback URL) and **Keys → Sign in with Apple key**. Enter the Services ID, Team ID, Key ID and .p8 key in Supabase.
   - **Facebook:** developers.facebook.com → **Create app → Consumer → Facebook Login**. Add the callback URL. Copy the App ID and Secret into Supabase. Switch the app to **Live** when you launch.
3. **Authentication → Providers → Email:** keep "Confirm email" **on**.
4. **Authentication → Emails → SMTP:** use Resend's SMTP settings so sign-up emails come from your domain.

## Step 9 — Server secrets

In Supabase, open **Edge Functions → Secrets** and add each line below (name → value):

```
APP_URL                       https://merchcorphub.github.io/Mole
SUPPORT_EMAIL                 support@molenetwork.com
EMAIL_FROM                    MOLE Network <hello@molenetwork.com>
STRIPE_SECRET_KEY             sk_test_…
STRIPE_WEBHOOK_SECRET         whsec_…   (endpoint A)
STRIPE_CONNECT_WEBHOOK_SECRET whsec_…   (endpoint B)
STRIPE_PRICE_FEATURED         price_…
STRIPE_PRICE_SPONSORED        price_…
STRIPE_PRICE_ANALYTICS        price_…
RESEND_API_KEY                re_…
TWILIO_ACCOUNT_SID            AC…
TWILIO_AUTH_TOKEN             …
TWILIO_MESSAGING_SERVICE_SID  MG…
VAPID_PUBLIC_KEY              …
VAPID_PRIVATE_KEY             …
CRON_SECRET                   (make up a long random password)
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are added automatically.

Next, connect the scheduler. Open **SQL Editor → New query**, paste the following (with your values) and click **Run**:

```sql
select vault.create_secret('https://YOUR-REF.supabase.co', 'project_url');
select vault.create_secret('THE-SAME-CRON_SECRET-AS-ABOVE', 'cron_secret');
```

The scheduler then runs every hour: it auto-approves referrals after 7 days, releases finished holds, sends reminders and runs the fraud scan. On the 12th of each month it builds the payout batch.

## Step 10 — Make yourself the first admin

1. Sign up in the app with your own email.
2. In Supabase **SQL Editor**, run:

```sql
update public.profiles set role = 'staff_admin' where email = 'you@yourcompany.com';
```

3. Open the Staff console and set up **two-step sign-in** with an authenticator app (Google Authenticator, 1Password, etc.). Staff actions are refused without it.
4. From then on, add other staff from the console. There are three roles:
   - **staff_support:** verify businesses, decide disputes, review fraud flags.
   - **staff_finance:** approve payout batches, reverse rewards, unfreeze wallets.
   - **staff_admin:** everything, plus staff roles and restricted categories.

Every staff action is recorded permanently in the audit log, and the log can't be edited.

## Step 11 — Point the app at the backend

1. Open `app/config.js` in GitHub (pencil icon) and fill in the Project URL, the anon key and the VAPID public key. Commit.
2. Add these lines inside `<head>` of `index.html`:

```html
<link rel="manifest" href="manifest.webmanifest">
<meta name="theme-color" content="#0A3B24">
<link rel="apple-touch-icon" href="icons/mole-192.png">
<script src="app/config.js"></script>
```

> ⚠️ **Not done yet:** the prototype screens still run on sample data. The next step is connecting each screen to `app/mole-client.js`. Ask me to build **v4** and I'll do it.

## Step 12 — Test checklist (Stripe test mode)

Use test card `4242 4242 4242 4242` (any future date, any CVC). For bank payments, use Stripe's test bank "Success" account.

1. ☐ Sign up with email, confirm the email, sign in. Repeat with Google, Apple and Facebook.
2. ☐ Create a business. In the Staff console, verify it. You should get an "Your business is verified" email.
3. ☐ Fund the Reward Wallet with $100 by card. The balance updates within seconds.
4. ☐ Post a $10 offer. It appears in the Marketplace.
5. ☐ Sign in as a second member, open the offer, tap Share and copy the link. Open the link in a private window. A click is logged.
6. ☐ As the business, record a sale with the member's promo code. The member gets a "New referral" notification and $10 moves to "held" in the wallet.
7. ☐ Approve it. The member sees "Approved" with a clear date 30 days out.
8. ☐ To test faster without waiting 30 days, run this in SQL Editor, then wait for the next hourly run:
   `update referrals set hold_until = now() where status = 'held';`
9. ☐ As the member, complete Payout setup (Stripe test identity `000-00-0000`, test bank `110000000` / `000123456789`).
10. ☐ Staff console → Payouts → **Build batch** → **Approve**. Members under $25 roll forward. Members at $25 or more get "You've been paid".
11. ☐ Reject a referral, dispute it as the member with evidence, then decide it in the Staff console.
12. ☐ Try to share your own business's offer. It's blocked as a self-referral.
13. ☐ Subscribe to Featured listing. The business shows as featured, and cancelling in the billing portal removes it.
14. ☐ Turn on push notifications on a phone, enable texts with your number, then trigger any of the events above.

## Step 13 — Go live

1. In Stripe, switch to **Live mode**, complete business verification, then repeat step 4 (webhooks, prices) with live keys. Update the Stripe secrets in Supabase.
2. Upgrade Supabase to **Pro** for daily backups.
3. Facebook app → **Live**. Twilio campaign → **Approved**.

---

## Georgia & legal — get attorney sign-off before launch

- **Money flow:** business deposits and member payouts move through Stripe Connect, and MOLE never holds funds in its own bank account. Have your attorney confirm this keeps Merch Corporation outside Georgia money-transmitter licensing (O.C.G.A. § 7-1-680 et seq.).
- **Terms of Service, Privacy Policy, Referral Program Terms:** must exist before launch. The app links to them from Program rules and sign-up.
- **Texts:** consent is recorded with a timestamp and IP address, and every text includes "Reply STOP". Your attorney should approve the consent wording (TCPA).
- **FTC endorsement rules:** "#ad – I may earn a reward" is built into every share template. Keep it.
- **Taxes:** Stripe files the 1099-NEC forms. Confirm the threshold and the Georgia filing with your accountant.
- **Data:** customer emails are stored only as one-way hashes. Deleting an account removes personal data but keeps anonymized payout records for tax purposes.

---

## How the program rules are enforced (for your dev team)

| Rule | Where |
|---|---|
| $5 minimum reward | `offers.reward_cents >= 500` constraint |
| Fee tiers (20/15/10%, $1 min) | `mole_fee()` in the database; mirrored in `app/mole-client.js` |
| 30-day window (7 for leads), last click, promo-code fallback | `conversion` function |
| No self-referrals | `get_or_create_link()`, `create_referral()`, fraud scan |
| 7-day verification then auto-approve | `verify_by` + `auto_approve()` hourly |
| 30-day hold (14 for leads); reversal on refund | `approve_referral()`, `clear_holds()`, `reverse_referral()` |
| $25 payout minimum, paid on the 15th | `build_payout_batch()` + staff approval in `payouts` |
| Wallet minimum max($50, 5 rewards); auto-pause when low | `wallet` function, `reserve_reward()` |
| Withdrawals less processing costs | `wallet` function (refunds to original payment) |
| Members never pay fees | MOLE absorbs Stripe costs; transfers send the full net |
| Monthly caps (per offer and per business) | `create_referral()` |
| Restricted categories | `guard_offer()`, `marketplace_offers` view |
| Fraud: self-click, instant conversion, click spikes, shared device/phone, repeat customer, high conversion | `fraud_scan()` hourly; flagged members' rewards pause until reviewed |

**Server functions:**
- `r`: referral link redirect.
- `conversion`: records a sale, lead or sign-up.
- `review`: business approve, reject or refund.
- `dispute`: member disputes a rejection.
- `connect`: payout setup.
- `wallet`: deposits, withdrawals and caps.
- `stripe-webhook`: receives Stripe events.
- `payouts`: builds and approves monthly payout batches.
- `jobs`: the hourly and monthly scheduler.
- `admin`: Staff console actions.
- `billing`: Phase 4 subscriptions.
- `account`: device check-in, text consent and account deletion.

None of this has been run against live services yet. Run the step 12 checklist in test mode before taking real money.
