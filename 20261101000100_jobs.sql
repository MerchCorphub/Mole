-- Scheduled jobs. They call the `jobs` server function using two secrets you add
-- once in the SQL editor (see SETUP.md step 9): project_url and cron_secret.
create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function public.call_jobs(p_task text) returns void language sql security definer set search_path = public as $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/jobs',
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
    body := jsonb_build_object('task', p_task),
    timeout_milliseconds := 60000
  );
$$;
revoke execute on function public.call_jobs(text) from public, anon, authenticated;

-- Every hour: auto-approve after 7 days, release finished holds, verify-by reminders, fraud scan.
select cron.schedule('mole-hourly', '5 * * * *', $$ select public.call_jobs('hourly') $$);
-- The 12th at 9:00 ET: build the payout batch so staff can approve it before the 15th.
select cron.schedule('mole-payout-batch', '0 14 12 * *', $$ select public.call_jobs('monthly_payouts') $$);
