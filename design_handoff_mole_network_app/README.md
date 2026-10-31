# Handoff: MOLE Network Mobile App (v3)

MOLE Network™ — "It's Who You Know." A Merch Corporation company.

## Overview
A referral marketplace mobile app. Businesses list offers with a referral reward and fund a Reward Wallet. Members share offers through their own social channels and earn on **verified results only** (a sale, a qualified lead, or a sign-up). MOLE keeps a disclosed platform fee. **Members are never paid for recruiting.** Program rules are in `docs/MOLE_Referral_Revenue_Program_v1.1.docx`. All Section 15 decisions are confirmed as proposed, and **Stripe** is the processor.

## About the design files
`prototype/MOLE Network App v3.dc.html` is a **design reference built in HTML**: a clickable prototype that shows the intended look, copy, and behavior. It is not production code. Recreate it in the target stack. Recommended: React Native (Expo) or SwiftUI/Kotlin, with a Node/Postgres backend and Stripe. Open the file in a browser and keep `support.js` and `assets/` next to it. Wide screens show it inside a phone frame with a screen index; phones and touch devices show it full-screen.

## Fidelity
**High-fidelity.** Colors, type, spacing, copy, and interactions are final. Recreate them pixel-accurately. Photos are placeholders (striped boxes).

## Design tokens
| Token | Value |
|---|---|
| Green 900 (deep) | `#062A19` |
| Green 800 (primary / headers) | `#0A3B24` |
| Green 700 (active / success) | `#0F4D30` |
| Green tint | `#EEF4F0`, `#E3F0E7` |
| Gold gradient (primary CTA) | `linear-gradient(180deg,#E6BE62,#BF8C2C)`, with text `#062A19` |
| Gold light / text-on-dark | `#F3D489`, `#E6BE62` |
| Gold ink (on light) | `#9A6E1C`, `#7A5614`; tint `#FBF1D9`, `#FBF6EA` |
| Ink | `#10241A` |
| Muted | `#5E6B63`, `#7A857E`, `#9AA49E` |
| Lines | `#E3E7E4`, `#EEF0EE`, inputs `#DCE2DE` |
| App background | `#F6F5F0`; cards `#FFFFFF` |
| Error | `#B3261E`, tint `#FBE4E1` |

- **Type:** headlines use *DM Serif Display* 400 (20–46px). UI text uses *Figtree* 400–900 (body 14–15px, labels 12–13px, eyebrows 11–12px uppercase with letter-spacing .06–.1em). Inputs are 16px so iOS doesn't zoom.
- **Radius:** cards 16; buttons and inputs 12–14; pills 6; sheets 24.
- **Spacing:** 4 / 8 / 10 / 12 / 14 / 16 / 20 / 24. The screen gutter is 16.
- **Touch targets:** at least 44px. Primary CTAs are 52px tall.
- **Shadows:** cards `0 1px 2px rgba(6,42,25,.06)`, hover `0 4px 14px rgba(6,42,25,.1)`.
- **Safe areas:** the top spacer uses `env(safe-area-inset-top)`; tab bars and footers add `env(safe-area-inset-bottom)`. Heights use `100dvh`.

## Navigation
- **Bottom tabs:** Home (Dashboard), Network, Marketplace, Earnings, Profile.
- **Other screens:** use a green header with a back chevron and no tab bar.
- **Toasts:** dark pill above the tab bar, shown for 1.8s.

## Screens (prototype number → purpose)
1. **Welcome:** logo; eyebrow "No fees · No inventory · No recruiting"; headline "Get paid when your recommendation becomes a customer."; 2×2 live offers showing the member's **net** amount and its unit. Primary CTA Browse the Marketplace, secondary Join free, link Sign in. Footer "A Merch Corporation company".
2. **Join / Login:** one screen with a Create account / Sign in toggle. Fields: name (join only), email, password (6+ characters). Google, Facebook, and Apple sign-in. Copy "Free forever for members." If the user arrived from an offer, show that offer card at the top.
2b. **Onboarding:** step 1 asks "What do your friends ask you about?" (multi-select). Step 2 shows three matching offers with net earnings and a Share button on each. Skip is always available.
3. **My Profile:** avatar, name, referral code. Rows: Personal info, Social links, My business, Payout setup (Stripe), Notifications, Privacy, Program rules, Staff console (staff only). Sign out.
4. **Dashboard:** earnings card ($ total; Pending, Approved, Paid; next payout date). First-earning progress strip: Joined → First share → First click → First earning. Then "Recommended for you", four stats (Offers shared, Verified results, Qualified leads, Link clicks), quick actions, and a "List your business free" card. The bell opens the inbox and shows an unread dot.
5. **My Network:** tabs for My Connections and **My Circle**. My Circle shows which offers connections are sharing (never their earnings). Persistent note: "You earn only on your own referrals."
6. **Marketplace:** search, sort/filter bottom sheet (Top paying, Nearest, Newest; 5, 10 or 25 mi), and category chips. "Top-paying this week" and "New near you" carousels. The full list shows a verified badge, distance, on-time payout rate, and a "You earn $X" pill.
7. **Business Profile:** cover, Follow, rating, and About, Products and Offers tabs. The offer card shows the reward, the fee split (reward, MOLE fee, member net), and **Offer terms**: what qualifies, referral window, holding period, first-time-customers-only, and the 7-day verify window.
8. **Post an Offer (business):** three steps — Details, Offer, Review. Reward type is fixed, %, per lead, or per sign-up. Includes the amount, monthly cap, and lead criteria (lead offers only). A live split preview shows "You pay / Member receives / MOLE fee". The **$5 minimum reward** is enforced. Restricted categories (Real Estate, Insurance, Legal) can list without a reward. Review shows the minimum wallet deposit, max($50, 5× reward).
9. **Share & Earn:** offer card, three ready-made posts with "#ad – I may earn a reward" built in, the referral link with Copy, and the personal promo code. Share to Facebook, Instagram, WhatsApp, Text, or Email.
10. **Referral Tracking:** 7, 30 or 90-day ranges and stats. Each referral shows a stepper (Clicked → Action → Verified → Hold → Paid) with dates and a plain-language note.
11. **My Earnings:** total; Pending, Approved, Paid; payout-progress card (Stripe status); filters for All, Pending, Approved and Rejected. Each item shows its expected pay date. Rejected items show a **Dispute** button.
12. **Business Dashboard:** ranges, stats, a "Referrals to review" count, Rewards paid / MOLE fee / Cost per customer, the Reward Wallet with a low-balance alert, a best-converting offers list, a link-clicks chart, and a Phase 4 "Grow" entry.
13. **Customer Confirmation:** order summary, "Recommended by Cary P. (with permission)", and "Paid with Visa •• 4242 · Secured by Stripe". Also the "Love HavSum? Recommend it…" join card, which goes to Join with the offer preloaded.
14. **Payout Setup:** Stripe Connect Express onboarding — identity, bank account, W-9. After setup it shows "Payouts active · bank ending 6789". No fees to members.
15. **Personal Information:** name, email, mobile, city, bio, and interests, all editable.
16. **Social Links:** connect or disconnect each platform. Note: MOLE never reads friend lists.
17. **Notification Settings:** grouped toggles.
18. **Privacy & Security:** toggles (show my name to customers, circle visibility, 2-step verification), change password, download data, delete account, and the privacy statement (draft).
19. **Program Rules:** the confirmed v1.1 terms (see below).
20. **Notifications inbox:** tapping an item deep-links to the relevant screen. Includes Mark all read.
21. **Referrals to Review (business):** All, Sales or Leads. Each card shows Approve or Dispute and a countdown ("Verify by Oct 26 · 3 days left"; red when 1 day remains).
22. **Reward Wallet:** balance and held amount; add funds ($50, $100 or $250; ACH or card via Stripe); monthly cap stepper; withdraw unused funds; transaction list.
23. **Dispute a Reward:** shows the business's reason, a reason picker, details (10+ characters), and an evidence upload. After submitting, it shows a status timeline (Filed → Reviewing → Decision within 14 days).
24. **Grow (Phase 4):** Featured listing, Sponsored offer, and Advanced analytics, each with a waitlist button.
25. **MOLE Staff Console:** tabs for Verify businesses, Disputes, Payouts (Nov 15 batch with Stripe cost breakdown and Approve batch), Fraud flags, and restricted Categories toggles.

## Confirmed program rules (implement server-side)
- **Fee:** greater of (reward × tier) or $1.00. Tiers: up to $100 → 20%; $100.01–$500 → 15%; over $500 → 10%. Member net = reward − fee. The business pays exactly the reward.
- **Minimum reward:** $5.00 per offer.
- **Referral window:** 30 days for sales and sign-ups, 7 days for leads. Last-click attribution, with a promo-code fallback. No self-referrals. First-time-customer limit is optional per offer.
- **Business verification:** 7 days, then automatic approval.
- **Hold:** 30 days after approval (14 for leads). Rewards reverse on refund or chargeback during the hold.
- **Payouts:** monthly on the 15th for rewards cleared by the end of the prior month. $25 minimum (smaller balances roll forward). Stripe Connect standard payouts. W-9 before first payout; 1099 when required.
- **Wallet:** minimum deposit max($50, 5 rewards). The offer auto-pauses when the balance is below one reward. Unused funds can be withdrawn, less processing costs.
- **Processing costs:** paid from MOLE's fee. Never charged to members or added to rewards.
- **No recruiting compensation of any kind.** My Circle is tracking only.
- **Disclosure tag:** "#ad – I may earn a reward" on every share.
- **Restricted categories:** real estate, insurance, lending, legal and medical. Rewards are off until an attorney approves; listing is allowed.
- **Disputes:** members file within 30 days; MOLE decides within 14 days.

## Stripe integration
- **Payouts:** Connect Express accounts for members (identity, bank, and tax collected in Stripe-hosted onboarding).
- **Wallet deposits:** PaymentIntents. ACH Direct Debit is the default (0.8%, $5 cap); cards cost 2.9% + 30¢.
- **Platform-held funds:** reward funds are held as a platform balance. After the hold, use Transfers to members' connected accounts and standard payouts on the 15th.
- **Webhooks:** `payment_intent.succeeded`, `charge.refunded`, `charge.dispute.created` (reverse reward), `account.updated` (payout readiness), `payout.paid`, `payout.failed`.
- **Small-reward economics:** a $2 reward leaves MOLE a $1.00 fee before Stripe costs. Encourage ACH deposits and keep the $5 minimum.

## State and data (suggested entities)
User/Member, Business, Offer (type, amount, cap, criteria, first-time flag, category, status), ReferralLink and PromoCode, Click, Referral (stage, dates, attribution), Reward (status Pending → Approved → Paid, or Rejected/Disputed/Reversed), Dispute, WalletTransaction, Payout, Notification, FraudFlag, and RestrictedCategory.

## Interactions to preserve
- **Form validation:** email format; password of 6+ characters; payout and profile required fields; dispute details of 10+ characters.
- **Toasts:** confirm every action (copy link, approve, deposit, and so on).
- **Unread dot:** the bell dot clears when all notifications are read.
- **Prototype persistence:** the prototype saves state to `localStorage` key `mole-v3`. This is a demo convenience only.

## Assets
- `prototype/assets/mole-logo.png`: the MOLE Network logo with tagline, on a white background. Get a transparent SVG version for production.
- **Placeholders needed:** business photos, product images, and member avatars.

## Screenshots
`screenshots/01-welcome.png` … `26-staff-console.png` — one per screen, in prototype order (2b Onboarding is 03).

## Files
- `prototype/MOLE Network App v3.dc.html`: the full clickable prototype (template markup and logic class in one file).
- `prototype/support.js`: the runtime needed to open the prototype in a browser.
- `docs/MOLE_Referral_Revenue_Program_v1.1.docx`: the source program rules.
