-- Migrates scheduled_services from the TfL-vehicle-matching model to the
-- RTT model: vehicle_id becomes a plain RTT service reference id, and the
-- TfL-specific "last seen countdown" columns (only needed for the old
-- vehicle-matching heuristics) are dropped.

alter table scheduled_services
  rename column vehicle_id to rtt_uid;

alter table scheduled_services
  drop column last_seen_time_to_station,
  drop column last_seen_at;
