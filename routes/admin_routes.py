from fastapi import APIRouter
from app.Models.match import WeaponLevelUpdate
from app.Http.Controllers import match_controller, gameplay_controller

router = APIRouter(prefix="/api/admin", tags=["Admin Controls"])

@router.post("/matches/{match_id}/start")
def start_match(match_id: str):
    return match_controller.admin_start_match(match_id)

@router.post("/matches/{match_id}/end")
def end_match(match_id: str):
    return match_controller.admin_end_match(match_id)

@router.delete("/matches/all")
def delete_all_matches():
    return match_controller.delete_all_matches()

@router.patch("/matches/{match_id}/weapon")
def admin_update_weapon_level(match_id: str, data: WeaponLevelUpdate):
    return gameplay_controller.admin_update_weapon_level(match_id, data)
