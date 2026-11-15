from fastapi import APIRouter
from app.Http.Controllers import match_controller

router = APIRouter(prefix="/api/admin", tags=["Admin Controls"])

@router.post("/matches/{match_id}/start")
def start_match(match_id: str):
    return match_controller.start_match(match_id)

@router.post("/matches/{match_id}/end")
def end_match(match_id: str):
    return match_controller.end_match(match_id)

@router.delete("/matches/all")
def delete_all_matches():
    return match_controller.delete_all_matches()
