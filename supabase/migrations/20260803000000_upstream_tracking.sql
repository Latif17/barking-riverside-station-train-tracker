alter table scheduled_services 
  add column upstream_status text check (upstream_status in ('pending', 'on_time', 'delayed', 'cancelled'));

alter table scheduled_services 
  add column upstream_observed_time timestamptz;

alter table scheduled_services 
  add column upstream_delay_minutes integer;
