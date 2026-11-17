from config.database import supabase
from config.config import SUPABASE_URL

def get_home_info():
    return {
        "project": "OPERATION: SURABAYA",
        "message": "Backend is running!",
        "status": "online"
    }

def get_health_status():
    return {
        "status": "healthy",
        "backend": "FastAPI"
    }

def get_db_health():
    try:
        result = supabase.table("players").select("id").limit(1).execute()
        return {
            "status": "connected",
            "database": "Supabase PostgreSQL",
            "project_url": SUPABASE_URL,
            "players_found": len(result.data)
        }
    except Exception as e:
        return {
            "status": "error",
            "message": str(e)
        }
