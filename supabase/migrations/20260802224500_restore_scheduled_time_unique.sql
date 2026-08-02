-- In the Hybrid model, missing trains are instantly marked as cancelled and
-- have NO rtt_uid. We must drop the NOT NULL constraint and restore the
-- (service_date, direction, scheduled_time) unique constraint.

ALTER TABLE scheduled_services DROP CONSTRAINT IF EXISTS scheduled_services_service_date_direction_rtt_uid_key;
ALTER TABLE scheduled_services ALTER COLUMN rtt_uid DROP NOT NULL;
ALTER TABLE scheduled_services ADD CONSTRAINT scheduled_services_service_date_direction_scheduled_time_key UNIQUE (service_date, direction, scheduled_time);
