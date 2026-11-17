-- OPERATION: SURABAYA
-- Player ID numerik unik secara global (1-999).
-- Jalankan satu kali di Supabase SQL Editor.

ALTER TABLE public.players
ADD COLUMN IF NOT EXISTS player_number INTEGER;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'players_player_number_range_check'
          AND conrelid = 'public.players'::regclass
    ) THEN
        ALTER TABLE public.players
        ADD CONSTRAINT players_player_number_range_check
        CHECK (player_number IS NULL OR (player_number BETWEEN 1 AND 999));
    END IF;
END $$;

-- Partial unique index: nomor baru wajib unik, sedangkan akun lama
-- yang belum memiliki nomor tetap dapat dipertahankan sampai diperbarui.
CREATE UNIQUE INDEX IF NOT EXISTS players_player_number_unique_idx
ON public.players (player_number)
WHERE player_number IS NOT NULL;
