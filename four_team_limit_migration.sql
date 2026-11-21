-- Operation: Surabaya — limit new room configurations to RED/BLUE/GREEN/YELLOW.
-- Safe follow-up for databases where the previous six-team migration was already run.
-- Historical PURPLE/ORANGE team rows are intentionally retained to avoid breaking old records.

-- Do not allow legacy PURPLE/ORANGE base QR stations to be used in new gameplay.
UPDATE public.base_shutdown_stations
SET is_active = FALSE
WHERE team_code IN ('PURPLE', 'ORANGE');

UPDATE public.healing_stations
SET is_active = FALSE
WHERE team_code IN ('PURPLE', 'ORANGE');

-- Ensure the four supported base stations exist and are active.
INSERT INTO public.base_shutdown_stations(station_code, station_name, team_code, is_active)
VALUES
  ('BASE-RED', 'Red Team Main Base', 'RED', TRUE),
  ('BASE-BLUE', 'Blue Team Main Base', 'BLUE', TRUE),
  ('BASE-GREEN', 'Green Team Main Base', 'GREEN', TRUE),
  ('BASE-YELLOW', 'Yellow Team Main Base', 'YELLOW', TRUE)
ON CONFLICT (station_code) DO UPDATE
SET station_name = EXCLUDED.station_name,
    team_code = EXCLUDED.team_code,
    is_active = TRUE;

INSERT INTO public.healing_stations(station_code, station_name, team_code, heal_amount, is_active)
VALUES
  ('BASE-RED', 'Red Team Base Healing', 'RED', 20, TRUE),
  ('BASE-BLUE', 'Blue Team Base Healing', 'BLUE', 20, TRUE),
  ('BASE-GREEN', 'Green Team Base Healing', 'GREEN', 20, TRUE),
  ('BASE-YELLOW', 'Yellow Team Base Healing', 'YELLOW', 20, TRUE)
ON CONFLICT (station_code) DO UPDATE
SET station_name = EXCLUDED.station_name,
    team_code = EXCLUDED.team_code,
    is_active = TRUE;

-- PURPLE/ORANGE catalog entries remain in public.teams only for historical references.
-- The updated FastAPI catalog and request validation prevent their selection in new rooms.
