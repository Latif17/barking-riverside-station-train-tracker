-- updated_at only had `default now()`, which fires on INSERT. The poller's
-- upsert path (ON CONFLICT (id) DO UPDATE) never included updated_at in its
-- payload, so PostgREST never put it in the SET clause and it stayed frozen
-- at insert time. A trigger fixes this at the DB layer instead of requiring
-- every write path in application code to remember to set it.
create extension if not exists moddatetime schema extensions;

create trigger scheduled_services_set_updated_at
  before update on scheduled_services
  for each row execute procedure extensions.moddatetime (updated_at);
