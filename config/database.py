from supabase import create_client, Client
from config.config import SUPABASE_URL, SUPABASE_KEY, SUPABASE_ANON_KEY

if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError("Supabase credentials belum dikonfigurasi!")

# Connect Supabase Database (Service Role)
supabase: Client = create_client(
    SUPABASE_URL,
    SUPABASE_KEY
)

# Connect Supabase Authentication (Anon Key)
supabase_auth: Client = create_client(
    SUPABASE_URL,
    SUPABASE_ANON_KEY
) if SUPABASE_ANON_KEY else None
