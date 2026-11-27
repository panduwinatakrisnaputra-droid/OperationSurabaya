import os
from dotenv import load_dotenv

load_dotenv()

LIVEKIT_URL = os.getenv("LIVEKIT_URL")
LIVEKIT_API_KEY = os.getenv("LIVEKIT_API_KEY")
LIVEKIT_API_SECRET = os.getenv("LIVEKIT_API_SECRET")

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY")


APP_DOMAIN = os.getenv("APP_DOMAIN", "https://operationsurabaya.pipip.my.id")

# Frontend (player-app & admin-dashboard) disajikan dari domain yang sama,
# jadi cukup satu origin: https://operationsurabaya.pipip.my.id
CORS_ORIGINS = [
    APP_DOMAIN,
]
