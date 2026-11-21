-- OPERATION: SURABAYA - Base Healing Stations
-- Jalankan sekali melalui Supabase SQL Editor.
CREATE TABLE IF NOT EXISTS public.healing_stations (
    station_code TEXT PRIMARY KEY,
    station_name TEXT NOT NULL,
    team_code TEXT NOT NULL CHECK (team_code IN ('RED','BLUE','GREEN','YELLOW')),
    heal_amount INTEGER NOT NULL DEFAULT 20 CHECK (heal_amount BETWEEN 1 AND 100),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.healing_stations (station_code, station_name, team_code, heal_amount, is_active) VALUES
('BASE-RED', 'Red Team Base Healing', 'RED', 20, TRUE),
('BASE-BLUE', 'Blue Team Base Healing', 'BLUE', 20, TRUE),
('BASE-GREEN', 'Green Team Base Healing', 'GREEN', 20, TRUE),
('BASE-YELLOW', 'Yellow Team Base Healing', 'YELLOW', 20, TRUE)
ON CONFLICT (station_code) DO NOTHING;

-- QR payload: OPS-HEALING:BASE-RED / BASE-BLUE / BASE-GREEN / BASE-YELLOW
-- Ubah heal_amount sesuai kebutuhan permainan.
