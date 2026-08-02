-- Replace the moddatetime trigger with a custom function to freeze updated_at
-- when a train is delayed or cancelled, so the timestamp reflects when we
-- FIRST knew about the delay or cancellation.

CREATE OR REPLACE FUNCTION set_custom_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  -- If transitioning INTO delayed or cancelled from a different state, update it.
  IF NEW.status IN ('delayed', 'cancelled') AND OLD.status IS DISTINCT FROM NEW.status THEN
    NEW.updated_at = now();
  -- If staying in delayed or cancelled, freeze it.
  ELSIF NEW.status IN ('delayed', 'cancelled') AND OLD.status = NEW.status THEN
    NEW.updated_at = OLD.updated_at;
  -- Otherwise (e.g. pending, on_time), always update it.
  ELSE
    NEW.updated_at = now();
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop the old trigger that used moddatetime
DROP TRIGGER IF EXISTS scheduled_services_set_updated_at ON scheduled_services;

-- Create the new trigger
CREATE TRIGGER scheduled_services_set_updated_at
  BEFORE UPDATE ON scheduled_services
  FOR EACH ROW EXECUTE PROCEDURE set_custom_updated_at();
