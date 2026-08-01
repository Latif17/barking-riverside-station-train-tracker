-- Drop the old constraint
ALTER TABLE scheduled_services
  DROP CONSTRAINT IF EXISTS scheduled_services_service_date_direction_scheduled_time_key;

-- Remove rows without rtt_uid as they can't be uniquely identified anymore
DELETE FROM scheduled_services WHERE rtt_uid IS NULL;

-- Deduplicate existing rows that have the same rtt_uid
DELETE FROM scheduled_services a USING (
    SELECT ctid, row_number() over (partition by service_date, direction, rtt_uid order by updated_at desc) as rn
    FROM scheduled_services
) b
WHERE a.ctid = b.ctid AND b.rn > 1;

-- Make rtt_uid NOT NULL
ALTER TABLE scheduled_services ALTER COLUMN rtt_uid SET NOT NULL;

-- Add the new constraint
ALTER TABLE scheduled_services
  ADD CONSTRAINT scheduled_services_service_date_direction_rtt_uid_key UNIQUE (service_date, direction, rtt_uid);
