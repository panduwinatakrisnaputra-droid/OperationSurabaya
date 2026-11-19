-- Dynamic Team System — Operation: Surabaya
-- Jalankan di Supabase SQL Editor sebelum deploy backend/frontend.
-- Existing RED/BLUE rows and all existing player/match records are preserved.

ALTER TABLE public.matches ADD COLUMN IF NOT EXISTS winner_team_code TEXT;

-- Expand the shared team catalog. team_code is expected to be unique in the existing table.
INSERT INTO public.teams (team_code, team_name, team_color)
VALUES
  ('RED', 'RED', '#EF4444'),
  ('BLUE', 'BLUE', '#3B82F6'),
  ('GREEN', 'GREEN', '#22C55E'),
  ('YELLOW', 'YELLOW', '#EAB308'),
  ('PURPLE', 'PURPLE', '#A855F7'),
  ('ORANGE', 'ORANGE', '#F97316')
ON CONFLICT (team_code) DO UPDATE
SET team_name = EXCLUDED.team_name, team_color = EXCLUDED.team_color;

-- Room-specific configuration: a team only exists in a room when linked here.
CREATE TABLE IF NOT EXISTS public.match_teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id UUID NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE RESTRICT,
  capacity INTEGER NOT NULL CHECK (capacity BETWEEN 1 AND 50),
  team_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT match_teams_match_team_unique UNIQUE (match_id, team_id)
);
ALTER TABLE public.match_teams ADD COLUMN IF NOT EXISTS team_order INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_match_teams_match_id ON public.match_teams(match_id);

-- Backfill the old two-team room model so existing rooms remain visible/joinable.
INSERT INTO public.match_teams (match_id, team_id, capacity, team_order)
SELECT m.id, t.id,
       CASE WHEN t.team_code = 'RED' THEN GREATEST(COALESCE(m.red_capacity, 1), 1)
            ELSE GREATEST(COALESCE(m.blue_capacity, 1), 1) END,
       CASE t.team_code WHEN 'RED' THEN 1 ELSE 2 END
FROM public.matches m
CROSS JOIN public.teams t
WHERE t.team_code IN ('RED', 'BLUE')
ON CONFLICT (match_id, team_id) DO NOTHING;

-- Allow any configured catalog team as a winner/base owner.
DO $$ DECLARE c RECORD; BEGIN
  FOR c IN SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.matches'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%winner_team_code%'
  LOOP EXECUTE format('ALTER TABLE public.matches DROP CONSTRAINT %I', c.conname); END LOOP;
END $$;
ALTER TABLE public.matches ADD CONSTRAINT matches_winner_team_code_check
  CHECK (winner_team_code IS NULL OR winner_team_code IN ('RED','BLUE','GREEN','YELLOW','PURPLE','ORANGE'));

-- Expand Base Shutdown station ownership and result fields.
DO $$ DECLARE c RECORD; BEGIN
  FOR c IN SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.base_shutdown_stations'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%team_code%'
  LOOP EXECUTE format('ALTER TABLE public.base_shutdown_stations DROP CONSTRAINT %I', c.conname); END LOOP;
END $$;
ALTER TABLE public.base_shutdown_stations ADD CONSTRAINT base_shutdown_stations_team_code_check
  CHECK (team_code IN ('RED','BLUE','GREEN','YELLOW','PURPLE','ORANGE'));

DO $$ DECLARE c RECORD; BEGIN
  FOR c IN SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.base_shutdowns'::regclass AND contype = 'c'
      AND (pg_get_constraintdef(oid) ILIKE '%attacker_team_code%' OR pg_get_constraintdef(oid) ILIKE '%defender_team_code%')
  LOOP EXECUTE format('ALTER TABLE public.base_shutdowns DROP CONSTRAINT %I', c.conname); END LOOP;
END $$;
ALTER TABLE public.base_shutdowns ADD CONSTRAINT base_shutdowns_attacker_team_code_check
  CHECK (attacker_team_code IN ('RED','BLUE','GREEN','YELLOW','PURPLE','ORANGE'));
ALTER TABLE public.base_shutdowns ADD CONSTRAINT base_shutdowns_defender_team_code_check
  CHECK (defender_team_code IN ('RED','BLUE','GREEN','YELLOW','PURPLE','ORANGE'));

INSERT INTO public.base_shutdown_stations(station_code, station_name, team_code, is_active)
VALUES
 ('BASE-GREEN','Green Team Main Base','GREEN',TRUE),
 ('BASE-YELLOW','Yellow Team Main Base','YELLOW',TRUE),
 ('BASE-PURPLE','Purple Team Main Base','PURPLE',TRUE),
 ('BASE-ORANGE','Orange Team Main Base','ORANGE',TRUE)
ON CONFLICT (station_code) DO UPDATE SET station_name=EXCLUDED.station_name, team_code=EXCLUDED.team_code;


-- Healing station ownership must support the same six-team catalog.
DO $$ DECLARE c RECORD; BEGIN
  FOR c IN SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.healing_stations'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%team_code%'
  LOOP EXECUTE format('ALTER TABLE public.healing_stations DROP CONSTRAINT %I', c.conname); END LOOP;
END $$;
ALTER TABLE public.healing_stations ADD CONSTRAINT healing_stations_team_code_check
  CHECK (team_code IN ('RED','BLUE','GREEN','YELLOW','PURPLE','ORANGE'));
INSERT INTO public.healing_stations(station_code,station_name,team_code,heal_amount,is_active)
VALUES
 ('BASE-GREEN','Green Team Base Healing','GREEN',20,TRUE),
 ('BASE-YELLOW','Yellow Team Base Healing','YELLOW',20,TRUE),
 ('BASE-PURPLE','Purple Team Base Healing','PURPLE',20,TRUE),
 ('BASE-ORANGE','Orange Team Base Healing','ORANGE',20,TRUE)
ON CONFLICT (station_code) DO UPDATE SET station_name=EXCLUDED.station_name, team_code=EXCLUDED.team_code;

-- Capacity guard: serialize concurrent joins on the room row before counting members.
CREATE OR REPLACE FUNCTION public.join_match_team(p_match_id UUID, p_player_id UUID, p_team_code TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_team_id UUID; v_capacity INTEGER; v_count INTEGER; v_existing UUID; v_status TEXT;
BEGIN
  SELECT status INTO v_status FROM matches WHERE id=p_match_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pertandingan tidak ditemukan'; END IF;
  IF v_status <> 'waiting' THEN RAISE EXCEPTION 'Pertandingan sudah tidak menerima pemain'; END IF;
  SELECT t.id, mt.capacity INTO v_team_id, v_capacity
    FROM match_teams mt JOIN teams t ON t.id=mt.team_id
    WHERE mt.match_id=p_match_id AND t.team_code=p_team_code;
  IF NOT FOUND THEN RAISE EXCEPTION 'Tim ini tidak tersedia pada room tersebut'; END IF;
  SELECT id INTO v_existing FROM match_players WHERE match_id=p_match_id AND player_id=p_player_id LIMIT 1;
  IF v_existing IS NULL OR (SELECT team_id FROM match_players WHERE id=v_existing) <> v_team_id THEN
    SELECT count(*) INTO v_count FROM match_players WHERE match_id=p_match_id AND team_id=v_team_id;
    IF v_count >= v_capacity THEN RAISE EXCEPTION 'Tim sudah penuh'; END IF;
    IF v_existing IS NULL THEN
      INSERT INTO match_players(match_id,player_id,team_id,player_status,current_health,max_health,is_eliminated,is_healing)
      VALUES(p_match_id,p_player_id,v_team_id,'joined',100,100,FALSE,FALSE);
    ELSE
      UPDATE match_players SET team_id=v_team_id WHERE id=v_existing;
    END IF;
  END IF;
  RETURN jsonb_build_object('success',true,'team_id',v_team_id,'team_code',p_team_code);
END; $$;
