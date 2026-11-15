from fastapi import HTTPException
from config.database import supabase

def get_all_teams():
    try:
        response = supabase.table("teams").select("*").execute()
        return {
            "success": True,
            "data": response.data
        }
    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=str(error)
        )
