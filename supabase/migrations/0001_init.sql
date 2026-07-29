create table scheduled_services (
  id                        uuid primary key default gen_random_uuid(),
  service_date              date not null,
  direction                 text not null check (direction in ('departing', 'arriving')),
  scheduled_time            timestamptz not null,
  peak_period               text not null check (peak_period in ('am_peak', 'pm_peak', 'off_peak')),
  status                    text not null default 'pending'
                              check (status in ('pending', 'on_time', 'delayed', 'cancelled')),
  observed_time             timestamptz,
  delay_minutes             integer,
  vehicle_id                text,
  last_seen_time_to_station integer,
  last_seen_at              timestamptz,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  unique (service_date, direction, scheduled_time)
);

create index scheduled_services_date_peak_idx on scheduled_services (service_date, peak_period);
create index scheduled_services_status_idx on scheduled_services (status);

alter table scheduled_services enable row level security;

create policy "anon can read scheduled_services"
  on scheduled_services
  for select
  to anon
  using (true);

-- No policy is created for insert/update/delete for anon: RLS defaults to
-- deny, so the anon key can never write. The service_role key used by the
-- poller bypasses RLS entirely (Supabase default), so it needs no policy.
