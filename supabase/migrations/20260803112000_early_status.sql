alter table scheduled_services drop constraint if exists scheduled_services_status_check;
alter table scheduled_services add constraint scheduled_services_status_check check (status in ('pending', 'on_time', 'early', 'delayed', 'cancelled'));

alter table scheduled_services drop constraint if exists scheduled_services_upstream_status_check;
alter table scheduled_services add constraint scheduled_services_upstream_status_check check (upstream_status in ('pending', 'on_time', 'early', 'delayed', 'cancelled'));
