-- Opt-in, isolated environments only. Supabase Cron (pg_cron) must already be available.
-- Apply as the database role that owns sbuild_capture_client_report_week.
do $$
begin
  if current_setting('cron.timezone', true) is null
    or current_setting('cron.timezone', true) not in ('GMT', 'UTC', 'Etc/UTC') then
    raise invalid_parameter_value using message = 'Supabase Cron must use UTC to register the weekly client report job';
  end if;
end;
$$;

-- UTC 06:00, 07:00 and 08:00 on Mondays provide two idempotent retries.
select cron.schedule(
  'sbuild-client-report-snapshots',
  '0 6,7,8 * * 1',
  $$select public.sbuild_capture_client_report_week();$$
);
