import os
from dotenv import load_dotenv

load_dotenv()

LIVEKIT_URL = "wss://your-project.livekit.cloud"
LIVEKIT_API_KEY = "your-api-key"
LIVEKIT_API_SECRET = "your-api-secret"

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY")


CORS_ORIGINS = [
    # Production - Player Portal
    "https://operationsurabaya.pipip.my.id",

    # Local development
    "http://localhost:5500",
    "http://127.0.0.1:5500",
    "http://localhost:5501",
    "http://127.0.0.1:5501",
    "http://localhost:5502",
    "http://127.0.0.1:5502",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:8000",
    "http://127.0.0.1:8000",
]

