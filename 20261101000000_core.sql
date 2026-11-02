-- MOLE Network core schema. Program rules from Section 15 are enforced here.
create extension if not exists pgcrypto with schema extensions;

create type public.user_role as enum ('member','staff_support','staff_finance','staff_admin');
create type public.offer_type as enum ('fixed','percent','lead','signup');
create type public.offer_status as enum ('draft','active','paused','ended');
create type public.referral_status as enum ('pending','held','cleared','paid','rejected','disputed','reversed');

-- ───────── Tables ─────────
create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  full_name text, email text, phone text, city text, bio text,
  interests text[] not null default '{}',
  social_links jsonb not null default '{}',
  referral_code text unique not null,
  role public.user_role not null default 'member',
  status text not null default 'active' check (status in ('active','suspended','deleted')),
  stripe_account_id text unique,
  payouts_enabled boolean not null default false,
  bank_last4 text,
  notify_push boolean not null default true,
  notify_email boolean not null default true,
  notify_sms boolean not null default false,
  sms_consent_at timestamptz,
  last_ip inet,
  device_ids text[] not null default '{}',
  created_at timestamptz not null default now()
);

create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles on delete restrict,
  name text not null, category text not null, about text, website text, phone text,
  address text, lat double precision, lng double precision,
  verified boolean not null default false, verified_at timestamptz,
  status text not null default 'active' check (status in ('active','frozen')),
  public_key text unique not null default encode(extensions.gen_random_bytes(18),'hex'),
  stripe_customer_id text,
  wallet_balance_cents bigint not null default 0,
  wallet_held_cents bigint not null default 0,
  monthly_cap_cents bigint check (monthly_cap_cents is null or monthly_cap_cents >= 0),
  featured_until timestamptz,
  analytics_until timestamptz,
  created_at timestamptz not null default now()
);

create table public.restricted_categories (category text primary key, blocked boolean not null default true);

create table public.offers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses on delete cascade,
  title text not null, description text, terms text, landing_url text,
  type public.offer_type not null default 'fixed',
  reward_cents int not null check (reward_cents >= 500),          -- $5 minimum (for % offers: minimum payout)
  percent numeric(5,2) check (percent is null or (percent > 0 and percent <= 100)),
  monthly_cap_cents bigint,
  lead_criteria text,
  first_time_only boolean not null default false,
  status public.offer_status not null default 'draft',
  paused_reason text,
  sponsored_until timestamptz,
  created_at timestamptz not null default now(),
  check (type <> 'percent' or percent is not null)
);

create table public.referral_links (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.profiles on delete cascade,
  offer_id uuid not null references public.offers on delete cascade,
  slug text unique not null,
  promo_code text unique not null,
  created_at timestamptz not null default now(),
  unique (member_id, offer_id)
);

create table public.clicks (
  id uuid primary key default gen_random_uuid(),
  link_id uuid not null references public.referral_links on delete cascade,
  member_id uuid not null, offer_id uuid not null,
  ip inet, user_agent text,
  created_at timestamptz not null default now()
);
create index on public.clicks (link_id, created_at desc);
create index on public.clicks (created_at);

create table public.payout_batches (
  id uuid primary key default gen_random_uuid(),
  period text unique not null,                 -- e.g. 2026-11 (paid on the 15th)
  cutoff timestamptz not null,
  status text not null default 'draft' check (status in ('draft','approved','sent')),
  total_cents bigint not null default 0, payout_count int not null default 0,
  sent_count int, failed_count int,
  approved_by uuid references public.profiles, approved_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.payouts (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.payout_batches,
  member_id uuid not null references public.profiles,
  amount_cents bigint not null check (amount_cents >= 2500),       -- $25 minimum
  status text not null default 'queued' check (status in ('queued','sent','failed')),
  stripe_transfer_id text, error text, sent_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.referrals (
  id uuid primary key default gen_random_uuid(),
  link_id uuid not null references public.referral_links,
  click_id uuid references public.clicks,
  member_id uuid not null references public.profiles,
  offer_id uuid not null references public.offers,
  business_id uuid not null references public.businesses,
  kind public.offer_type not null,
  order_ref text, order_amount_cents bigint, customer_hash text, customer_label text,
  reward_cents int not null, fee_cents int not null, net_cents int not null,
  status public.referral_status not null default 'pending',
  reserved boolean not null default false,
  verify_by timestamptz not null, reminder_sent boolean not null default false,
  approved_at timestamptz, hold_until timestamptz, cleared_at timestamptz, paid_at timestamptz,
  rejected_at timestamptz, reject_reason text,
  payout_id uuid references public.payouts,
  created_at timestamptz not null default now(),
  unique (business_id, order_ref)
);
create index on public.referrals (member_id, created_at desc);
create index on public.referrals (business_id, status);
create index on public.referrals (status, verify_by);
create index on public.referrals (status, hold_until);

create table public.disputes (
  id uuid primary key default gen_random_uuid(),
  referral_id uuid not null unique references public.referrals,
  member_id uuid not null references public.profiles,
  business_id uuid not null references public.businesses,
  business_reason text, reason text not null, details text not null,
  evidence_paths text[] not null default '{}',
  status text not null default 'filed' check (status in ('filed','reviewing','decided')),
  winner text check (winner in ('member','business')),
  decision_note text, decided_by uuid references public.profiles, decided_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.wallet_txns (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses,
  kind text not null check (kind in ('deposit','reserve','release','debit','withdrawal','processing_cost','adjustment')),
  amount_cents bigint not null check (amount_cents >= 0),
  method text check (method in ('card','ach')),
  stripe_ref text unique,
  refunded_cents bigint not null default 0,
  referral_id uuid references public.referrals,
  created_at timestamptz not null default now()
);
create index on public.wallet_txns (business_id, created_at desc);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles on delete cascade,
  kind text not null, title text not null, body text not null, link text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index on public.notifications (user_id, created_at desc);

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles on delete cascade,
  endpoint text unique not null, p256dh text not null, auth text not null,
  created_at timestamptz not null default now()
);

create table public.fraud_flags (
  id uuid primary key default gen_random_uuid(),
  kind text not null, dedupe_key text not null,
  member_id uuid references public.profiles, referral_id uuid references public.referrals,
  details jsonb not null default '{}',
  status text not null default 'open' check (status in ('open','cleared','actioned')),
  reviewed_by uuid references public.profiles, reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (kind, dedupe_key)
);

create table public.audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid, action text not null, target_type text not null, target_id text,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table public.phase4_subscriptions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses,
  offer_id uuid references public.offers,
  product text not null check (product in ('featured','sponsored','analytics')),
  stripe_subscription_id text unique not null,
  status text not null, current_period_end timestamptz,
  created_at timestamptz not null default now()
);

-- ───────── Helpers ─────────
-- Fee: greater of reward × tier or $1. ≤$100 → 20%, ≤$500 → 15%, above → 10%.
create function public.mole_fee(p_reward bigint) returns int language sql immutable as $$
  select greatest(100, round(p_reward * case when p_reward <= 10000 then 0.20 when p_reward <= 50000 then 0.15 else 0.10 end))::int
$$;

create function public.is_staff(p_roles text[] default array['staff_support','staff_finance','staff_admin'])
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role::text = any(p_roles) and status = 'active')
$$;

-- "Cary P." style name, for businesses and receipts
create function public.member_display(p_id uuid) returns text language sql stable security definer set search_path = public as $$
  select coalesce(split_part(full_name,' ',1) || coalesce(' ' || left(nullif(split_part(full_name,' ',2),''),1) || '.', ''), 'A MOLE member')
  from profiles where id = p_id
$$;

create function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
declare base text; code text;
begin
  base := upper(regexp_replace(coalesce(split_part(coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'),' ',1), split_part(new.email,'@',1), ''), '[^A-Za-z]', '', 'g'));
  base := coalesce(nullif(left(base, 6), ''), 'MOLE');
  loop
    code := base || lpad(floor(random() * 10000)::int::text, 4, '0');
    exit when not exists (select 1 from profiles where referral_code = code);
  end loop;
  insert into profiles (id, full_name, email, referral_code)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'), new.email, code);
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- Signed-in users can't change money, role, or verification fields directly.
create function public.protect_profile() returns trigger language plpgsql as $$
begin
  if current_user in ('authenticated','anon') and (
     new.role is distinct from old.role or new.status is distinct from old.status or new.referral_code is distinct from old.referral_code
     or new.stripe_account_id is distinct from old.stripe_account_id or new.payouts_enabled is distinct from old.payouts_enabled
     or new.bank_last4 is distinct from old.bank_last4 or new.last_ip is distinct from old.last_ip
     or new.device_ids is distinct from old.device_ids or new.sms_consent_at is distinct from old.sms_consent_at
     or new.email is distinct from old.email or new.id is distinct from old.id) then
    raise exception 'protected_field';
  end if;
  return new;
end $$;
create trigger protect_profile before update on public.profiles for each row execute function public.protect_profile();

create function public.protect_business() returns trigger language plpgsql as $$
begin
  if current_user in ('authenticated','anon') then
    if tg_op = 'INSERT' then
      new.verified := false; new.verified_at := null; new.status := 'active';
      new.wallet_balance_cents := 0; new.wallet_held_cents := 0; new.stripe_customer_id := null;
      new.featured_until := null; new.analytics_until := null; new.monthly_cap_cents := null;
    elsif new.verified is distinct from old.verified or new.verified_at is distinct from old.verified_at or new.status is distinct from old.status
       or new.public_key is distinct from old.public_key or new.stripe_customer_id is distinct from old.stripe_customer_id
       or new.wallet_balance_cents is distinct from old.wallet_balance_cents or new.wallet_held_cents is distinct from old.wallet_held_cents
       or new.monthly_cap_cents is distinct from old.monthly_cap_cents or new.featured_until is distinct from old.featured_until
       or new.analytics_until is distinct from old.analytics_until or new.owner_id is distinct from old.owner_id then
      raise exception 'protected_field';
    end if;
  end if;
  return new;
end $$;
create trigger protect_business before insert or update on public.businesses for each row execute function public.protect_business();

create function public.guard_offer() returns trigger language plpgsql as $$
declare b businesses;
begin
  select * into b from businesses where id = new.business_id;
  if exists (select 1 from restricted_categories where category = b.category and blocked) then raise exception 'restricted_category'; end if;
  if current_user in ('authenticated','anon') then
    if tg_op = 'UPDATE' and new.sponsored_until is distinct from old.sponsored_until then raise exception 'protected_field'; end if;
    if tg_op = 'INSERT' then new.sponsored_until := null; end if;
  end if;
  if new.status = 'active' and (tg_op = 'INSERT' or old.status <> 'active') then
    if not b.verified then raise exception 'business_not_verified'; end if;
    if b.wallet_balance_cents < new.reward_cents then new.status := 'paused'; new.paused_reason := 'wallet_low'; end if;
  end if;
  if new.status = 'active' then new.paused_reason := null; end if;
  return new;
end $$;
create trigger guard_offer before insert or update on public.offers for each row execute function public.guard_offer();

create function public.audit_immutable() returns trigger language plpgsql as $$ begin raise exception 'audit_log is append-only'; end $$;
create trigger audit_immutable before update or delete on public.audit_log for each row execute function public.audit_immutable();

-- ───────── Referral links ─────────
create function public.get_or_create_link(p_offer uuid) returns public.referral_links
language plpgsql security definer set search_path = public as $$
declare l referral_links; me profiles; o offers;
begin
  select * into me from profiles where id = auth.uid();
  if me.id is null or me.status <> 'active' then raise exception 'not_signed_in'; end if;
  select * into l from referral_links where member_id = me.id and offer_id = p_offer;
  if found then return l; end if;
  select * into o from offers where id = p_offer and status = 'active';
  if not found then raise exception 'offer_unavailable'; end if;
  if exists (select 1 from businesses where id = o.business_id and owner_id = me.id) then raise exception 'self_referral'; end if;
  insert into referral_links (member_id, offer_id, slug, promo_code)
  values (me.id, p_offer, substr(md5(gen_random_uuid()::text), 1, 10), left(me.referral_code, 6) || '-' || upper(substr(md5(gen_random_uuid()::text), 1, 4)))
  returning * into l;
  return l;
end $$;

-- ───────── Wallet ─────────
create function public.reserve_reward(p_id uuid) returns void language plpgsql security definer set search_path = public as $$
declare r referrals; bal bigint;
begin
  select * into r from referrals where id = p_id;
  if r.reserved then return; end if;
  update businesses set wallet_balance_cents = wallet_balance_cents - r.reward_cents, wallet_held_cents = wallet_held_cents + r.reward_cents
    where id = r.business_id returning wallet_balance_cents into bal;
  insert into wallet_txns (business_id, kind, amount_cents, referral_id) values (r.business_id, 'reserve', r.reward_cents, r.id);
  update referrals set reserved = true where id = r.id;
  -- Auto-pause any offer the wallet can no longer cover
  update offers set status = 'paused', paused_reason = 'wallet_low' where business_id = r.business_id and status = 'active' and reward_cents > bal;
end $$;

create function public.release_reward(p_id uuid) returns void language plpgsql security definer set search_path = public as $$
declare r referrals;
begin
  select * into r from referrals where id = p_id;
  if not r.reserved then return; end if;
  update businesses set wallet_balance_cents = wallet_balance_cents + r.reward_cents, wallet_held_cents = wallet_held_cents - r.reward_cents where id = r.business_id;
  insert into wallet_txns (business_id, kind, amount_cents, referral_id) values (r.business_id, 'release', r.reward_cents, r.id);
  update referrals set reserved = false where id = r.id;
  perform unpause_offers(r.business_id);
end $$;

create function public.unpause_offers(p_business uuid) returns void language sql security definer set search_path = public as $$
  update offers o set status = 'active', paused_reason = null
  from businesses b where b.id = p_business and o.business_id = b.id and o.status = 'paused' and o.paused_reason = 'wallet_low' and o.reward_cents <= b.wallet_balance_cents
$$;

-- Idempotent: the Stripe reference can only be credited once.
create function public.wallet_credit(p_business uuid, p_amount bigint, p_ref text, p_kind text default 'deposit', p_method text default null)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  insert into wallet_txns (business_id, kind, amount_cents, method, stripe_ref) values (p_business, p_kind, p_amount, p_method, p_ref)
  on conflict (stripe_ref) do nothing;
  if not found then return false; end if;
  update businesses set wallet_balance_cents = wallet_balance_cents + p_amount where id = p_business;
  perform unpause_offers(p_business);
  return true;
end $$;

create function public.wallet_withdraw(p_business uuid, p_amount bigint) returns bigint language plpgsql security definer set search_path = public as $$
declare bal bigint;
begin
  select wallet_balance_cents into bal from businesses where id = p_business for update;
  if p_amount <= 0 or p_amount > bal then raise exception 'insufficient_funds'; end if;
  update businesses set wallet_balance_cents = wallet_balance_cents - p_amount where id = p_business returning wallet_balance_cents into bal;
  insert into wallet_txns (business_id, kind, amount_cents) values (p_business, 'withdrawal', p_amount);
  update offers set status = 'paused', paused_reason = 'wallet_low' where business_id = p_business and status = 'active' and reward_cents > bal;
  return bal;
end $$;

-- ───────── Referral lifecycle ─────────
create function public.create_referral(p_link uuid, p_click uuid, p_reward int, p_order_ref text, p_amount bigint, p_customer_hash text, p_customer_label text)
returns public.referrals language plpgsql security definer set search_path = public, extensions as $$
declare l referral_links; o offers; b businesses; m profiles; r referrals; used bigint; fee int;
begin
  select * into l from referral_links where id = p_link;
  select * into o from offers where id = l.offer_id;
  select * into b from businesses where id = o.business_id for update;
  select * into m from profiles where id = l.member_id;
  if m.status <> 'active' then raise exception 'member_inactive'; end if;
  if p_reward < 500 then raise exception 'reward_below_minimum'; end if;
  if b.owner_id = m.id
     or (p_customer_hash is not null and m.email is not null and p_customer_hash = encode(digest(lower(trim(m.email)), 'sha256'), 'hex')) then
    insert into fraud_flags (kind, dedupe_key, member_id, details)
    values ('self_referral', m.id || ':' || o.id || ':' || coalesce(p_order_ref, now()::text), m.id, jsonb_build_object('offer_id', o.id, 'order_ref', p_order_ref))
    on conflict do nothing;
    raise exception 'self_referral';
  end if;
  if o.monthly_cap_cents is not null then
    select coalesce(sum(reward_cents), 0) into used from referrals
      where offer_id = o.id and created_at >= date_trunc('month', now()) and status not in ('rejected','reversed');
    if used + p_reward > o.monthly_cap_cents then raise exception 'monthly_cap'; end if;
  end if;
  if b.monthly_cap_cents is not null then
    select coalesce(sum(reward_cents), 0) into used from referrals
      where business_id = b.id and created_at >= date_trunc('month', now()) and status not in ('rejected','reversed');
    if used + p_reward > b.monthly_cap_cents then raise exception 'monthly_cap'; end if;
  end if;
  fee := mole_fee(p_reward);
  insert into referrals (link_id, click_id, member_id, offer_id, business_id, kind, order_ref, order_amount_cents, customer_hash, customer_label,
                         reward_cents, fee_cents, net_cents, verify_by)
  values (l.id, p_click, m.id, o.id, b.id, o.type, p_order_ref, p_amount, p_customer_hash, p_customer_label,
          p_reward, fee, p_reward - fee, now() + interval '7 days')
  returning * into r;
  perform reserve_reward(r.id);
  select * into r from referrals where id = r.id;
  return r;
end $$;

-- Approve → hold starts: 30 days (14 for leads).
create function public.approve_referral(p_id uuid) returns public.referrals language plpgsql security definer set search_path = public as $$
declare r referrals;
begin
  select * into r from referrals where id = p_id for update;
  if r.status not in ('pending','disputed','rejected') then raise exception 'not_reviewable'; end if;
  if not r.reserved then perform reserve_reward(r.id); end if;
  update referrals set status = 'held', approved_at = now(), reject_reason = null,
    hold_until = now() + case when r.kind = 'lead' then interval '14 days' else interval '30 days' end
  where id = p_id returning * into r;
  return r;
end $$;

create function public.reject_referral(p_id uuid, p_reason text) returns public.referrals language plpgsql security definer set search_path = public as $$
declare r referrals;
begin
  select * into r from referrals where id = p_id for update;
  if r.status not in ('pending','disputed') then raise exception 'not_reviewable'; end if;
  perform release_reward(r.id);
  update referrals set status = 'rejected', rejected_at = now(), reject_reason = coalesce(p_reason, reject_reason) where id = p_id returning * into r;
  return r;
end $$;

-- Refund or chargeback during the hold reverses the reward.
create function public.reverse_referral(p_id uuid, p_reason text) returns public.referrals language plpgsql security definer set search_path = public as $$
declare r referrals;
begin
  select * into r from referrals where id = p_id for update;
  if r.status not in ('pending','held') then raise exception 'not_reversible'; end if;
  perform release_reward(r.id);
  update referrals set status = 'reversed', reject_reason = p_reason where id = p_id returning * into r;
  return r;
end $$;

create function public.has_open_flag(p_member uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from fraud_flags where member_id = p_member and status = 'open')
$$;

-- 7 days without a decision → approved automatically (skipped while a fraud flag is open).
create function public.auto_approve() returns setof public.referrals language plpgsql security definer set search_path = public as $$
declare r referrals;
begin
  for r in select * from referrals where status = 'pending' and verify_by <= now() and not has_open_flag(member_id) order by verify_by limit 2000 loop
    return next approve_referral(r.id);
  end loop;
end $$;

-- Hold ends → reward leaves the business wallet and is owed to the member.
create function public.clear_holds() returns setof public.referrals language plpgsql security definer set search_path = public as $$
declare r referrals;
begin
  for r in select * from referrals where status = 'held' and hold_until <= now() and not has_open_flag(member_id) order by hold_until limit 2000 for update skip locked loop
    update businesses set wallet_held_cents = wallet_held_cents - r.reward_cents where id = r.business_id;
    insert into wallet_txns (business_id, kind, amount_cents, referral_id) values (r.business_id, 'debit', r.reward_cents, r.id);
    update referrals set status = 'cleared', cleared_at = now() where id = r.id returning * into r;
    return next r;
  end loop;
end $$;

-- Monthly batch: rewards cleared before the 1st, $25+ per member, payouts set up, no open flags.
create function public.build_payout_batch(p_period text) returns uuid language plpgsql security definer set search_path = public as $$
declare bid uuid; st text; cut timestamptz := date_trunc('month', now()); rec record; pid uuid;
begin
  select id, status into bid, st from payout_batches where period = p_period;
  if bid is null then insert into payout_batches (period, cutoff) values (p_period, cut) returning id into bid;
  elsif st <> 'draft' then raise exception 'batch_locked'; end if;
  for rec in
    select r.member_id, sum(r.net_cents) as total from referrals r join profiles p on p.id = r.member_id
    where r.status = 'cleared' and r.payout_id is null and r.cleared_at < cut and p.payouts_enabled and p.status = 'active' and not has_open_flag(r.member_id)
    group by r.member_id having sum(r.net_cents) >= 2500
  loop
    insert into payouts (batch_id, member_id, amount_cents) values (bid, rec.member_id, rec.total) returning id into pid;
    update referrals set payout_id = pid where member_id = rec.member_id and status = 'cleared' and payout_id is null and cleared_at < cut;
  end loop;
  update payout_batches set total_cents = (select coalesce(sum(amount_cents),0) from payouts where batch_id = bid and status = 'queued'),
    payout_count = (select count(*) from payouts where batch_id = bid and status = 'queued') where id = bid;
  return bid;
end $$;

create function public.file_dispute(p_member uuid, p_referral uuid, p_reason text, p_details text, p_evidence text[])
returns public.disputes language plpgsql security definer set search_path = public as $$
declare r referrals; d disputes;
begin
  select * into r from referrals where id = p_referral and member_id = p_member for update;
  if not found then raise exception 'not_found'; end if;
  if r.status <> 'rejected' then raise exception 'not_disputable'; end if;
  if r.rejected_at < now() - interval '30 days' then raise exception 'dispute_window_closed'; end if;
  if length(trim(coalesce(p_details, ''))) < 10 then raise exception 'details_too_short'; end if;
  insert into disputes (referral_id, member_id, business_id, business_reason, reason, details, evidence_paths)
  values (r.id, p_member, r.business_id, r.reject_reason, p_reason, trim(p_details), coalesce(p_evidence, '{}'))
  returning * into d;
  update referrals set status = 'disputed' where id = r.id;
  return d;
end $$;

-- ───────── Fraud scan (runs hourly) ─────────
create function public.fraud_scan() returns int language plpgsql security definer set search_path = public as $$
declare n int := 0; c int;
begin
  -- More than 50 clicks on one link in an hour
  insert into fraud_flags (kind, dedupe_key, member_id, details)
  select 'click_spike', l.id || ':' || to_char(now(), 'YYYYMMDDHH24'), l.member_id, jsonb_build_object('link_id', l.id, 'clicks_last_hour', count(*))
  from clicks k join referral_links l on l.id = k.link_id where k.created_at > now() - interval '1 hour'
  group by l.id, l.member_id having count(*) > 50 on conflict do nothing;
  get diagnostics c = row_count; n := n + c;

  -- Conversion under 30 seconds after the click
  insert into fraud_flags (kind, dedupe_key, member_id, referral_id, details)
  select 'instant_conversion', r.id::text, r.member_id, r.id, jsonb_build_object('seconds', round(extract(epoch from r.created_at - k.created_at)))
  from referrals r join clicks k on k.id = r.click_id
  where r.created_at > now() - interval '2 hours' and r.created_at - k.created_at < interval '30 seconds' on conflict do nothing;
  get diagnostics c = row_count; n := n + c;

  -- Member clicked their own link (same network address as their last sign-in)
  insert into fraud_flags (kind, dedupe_key, member_id, referral_id, details)
  select 'self_click', r.id::text, r.member_id, r.id, jsonb_build_object('ip', host(k.ip))
  from referrals r join clicks k on k.id = r.click_id join profiles p on p.id = r.member_id
  where r.created_at > now() - interval '2 hours' and k.ip is not null and k.ip = p.last_ip on conflict do nothing;
  get diagnostics c = row_count; n := n + c;

  -- Duplicate accounts: same device or phone on more than one active account
  insert into fraud_flags (kind, dedupe_key, member_id, details)
  select 'shared_device', d, (array_agg(p.id order by p.created_at))[1], jsonb_build_object('accounts', array_agg(p.id))
  from profiles p, unnest(p.device_ids) d where p.status = 'active' group by d having count(distinct p.id) > 1 on conflict do nothing;
  get diagnostics c = row_count; n := n + c;

  insert into fraud_flags (kind, dedupe_key, member_id, details)
  select 'shared_phone', p.phone, (array_agg(p.id order by p.created_at))[1], jsonb_build_object('accounts', array_agg(p.id))
  from profiles p where p.status = 'active' and p.phone is not null group by p.phone having count(*) > 1 on conflict do nothing;
  get diagnostics c = row_count; n := n + c;

  -- Same customer credited to 3+ different members in a week
  insert into fraud_flags (kind, dedupe_key, details)
  select 'repeat_customer', r.customer_hash || ':' || to_char(now(), 'IYYY-IW'), jsonb_build_object('members', array_agg(distinct r.member_id), 'referrals', count(*))
  from referrals r where r.customer_hash is not null and r.created_at > now() - interval '7 days'
  group by r.customer_hash having count(distinct r.member_id) >= 3 on conflict do nothing;
  get diagnostics c = row_count; n := n + c;

  -- 10+ conversions in a day with a conversion rate above 60%
  insert into fraud_flags (kind, dedupe_key, member_id, details)
  select 'high_conversion', x.member_id || ':' || to_char(now(), 'YYYYMMDD'), x.member_id, jsonb_build_object('referrals', x.refs, 'clicks', x.clks)
  from (select r.member_id, count(*) refs, (select count(*) from clicks k where k.member_id = r.member_id and k.created_at > now() - interval '1 day') clks
        from referrals r where r.created_at > now() - interval '1 day' group by r.member_id) x
  where x.refs >= 10 and x.refs > 0.6 * greatest(x.clks, 1) on conflict do nothing;
  get diagnostics c = row_count; n := n + c;
  return n;
end $$;

-- ───────── Public marketplace view (safe columns only) ─────────
create view public.marketplace_offers as
select o.id, o.business_id, o.title, o.description, o.terms, o.type, o.reward_cents, o.percent, o.lead_criteria, o.first_time_only, o.created_at,
  public.mole_fee(o.reward_cents) as fee_cents, o.reward_cents - public.mole_fee(o.reward_cents) as member_net_cents,
  coalesce(o.sponsored_until > now(), false) as sponsored,
  b.name as business_name, b.category, b.about, b.website, b.address, b.lat, b.lng,
  coalesce(b.featured_until > now(), false) as featured
from public.offers o join public.businesses b on b.id = o.business_id
where o.status = 'active' and b.verified and b.status = 'active'
  and not exists (select 1 from public.restricted_categories rc where rc.category = b.category and rc.blocked);
grant select on public.marketplace_offers to anon, authenticated;

-- ───────── Row-level security ─────────
alter table public.profiles enable row level security;
alter table public.businesses enable row level security;
alter table public.restricted_categories enable row level security;
alter table public.offers enable row level security;
alter table public.referral_links enable row level security;
alter table public.clicks enable row level security;
alter table public.referrals enable row level security;
alter table public.disputes enable row level security;
alter table public.wallet_txns enable row level security;
alter table public.payout_batches enable row level security;
alter table public.payouts enable row level security;
alter table public.notifications enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.fraud_flags enable row level security;
alter table public.audit_log enable row level security;
alter table public.phase4_subscriptions enable row level security;

create function public.owns_business(p_business uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from businesses where id = p_business and owner_id = auth.uid())
$$;

create policy "read own profile" on public.profiles for select using (id = auth.uid() or public.is_staff());
create policy "edit own profile" on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());

create policy "read own business" on public.businesses for select using (owner_id = auth.uid() or public.is_staff());
create policy "create business" on public.businesses for insert with check (owner_id = auth.uid());
create policy "edit own business" on public.businesses for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy "read categories" on public.restricted_categories for select using (true);

create policy "read own offers" on public.offers for select using (public.owns_business(business_id) or public.is_staff());
create policy "create offers" on public.offers for insert with check (public.owns_business(business_id));
create policy "edit own offers" on public.offers for update using (public.owns_business(business_id)) with check (public.owns_business(business_id));

create policy "read own links" on public.referral_links for select using (member_id = auth.uid());
create policy "read clicks" on public.clicks for select using (member_id = auth.uid() or public.is_staff());

create policy "read referrals" on public.referrals for select using (member_id = auth.uid() or public.owns_business(business_id) or public.is_staff());
create policy "read disputes" on public.disputes for select using (member_id = auth.uid() or public.owns_business(business_id) or public.is_staff());
create policy "read wallet" on public.wallet_txns for select using (public.owns_business(business_id) or public.is_staff(array['staff_finance','staff_admin']));
create policy "read batches" on public.payout_batches for select using (public.is_staff(array['staff_finance','staff_admin']));
create policy "read payouts" on public.payouts for select using (member_id = auth.uid() or public.is_staff(array['staff_finance','staff_admin']));

create policy "read own notifications" on public.notifications for select using (user_id = auth.uid());
create policy "mark read" on public.notifications for update using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "own push subs" on public.push_subscriptions for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "staff read flags" on public.fraud_flags for select using (public.is_staff());
create policy "admin read audit" on public.audit_log for select using (public.is_staff(array['staff_admin']));
create policy "read own phase4" on public.phase4_subscriptions for select using (public.owns_business(business_id) or public.is_staff());

-- Lock money functions to the server. Only these are callable from the app:
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.get_or_create_link(uuid) to authenticated;
grant execute on function public.member_display(uuid) to authenticated;
grant execute on function public.mole_fee(bigint) to anon, authenticated;
grant execute on function public.is_staff(text[]) to anon, authenticated;
grant execute on function public.owns_business(uuid) to anon, authenticated;

-- ───────── File storage ─────────
insert into storage.buckets (id, name, public) values ('evidence', 'evidence', false), ('media', 'media', true) on conflict do nothing;
create policy "upload own evidence" on storage.objects for insert to authenticated
  with check (bucket_id = 'evidence' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "read evidence" on storage.objects for select to authenticated
  using (bucket_id = 'evidence' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_staff()));
create policy "upload own media" on storage.objects for insert to authenticated
  with check (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "manage own media" on storage.objects for delete to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);

-- Live inbox updates
alter publication supabase_realtime add table public.notifications;
