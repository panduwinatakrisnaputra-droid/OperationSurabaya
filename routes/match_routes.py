from fastapi import APIRouter
from app.Models.match import (
    TeamSelection,
    LeaveTeamRequest,
    HealthUpdate,
    PlayerHealRequest,
    PlayerShootRequest,
    BaseShutdownRequest,
    GhostModeScanRequest,
    WeaponUpgradeScanRequest,
)
from app.Http.Controllers import match_controller, gameplay_controller

router = APIRouter(prefix="/api/matches", tags=["Matches & Gameplay"])

# Match lifecycle & lobby
@router.get("/waiting")
def get_waiting_match():
    return match_controller.get_waiting_match()

@router.get("/current")
def get_current_match():
    return match_controller.get_current_match()

@router.post("/{match_id}/join")
def join_match(match_id: str, data: TeamSelection):
    return match_controller.join_match(match_id, data)

@router.post("/{match_id}/leave")
def leave_team(match_id: str, data: LeaveTeamRequest):
    return match_controller.leave_team(match_id, data)

@router.get("/{match_id}/lobby")
def get_lobby_status(match_id: str):
    return match_controller.get_lobby_status(match_id)

@router.get("/{match_id}/timer")
def get_match_timer(match_id: str):
    return gameplay_controller.get_match_timer(match_id)

# Match gameplay & health
@router.get("/{match_id}/health")
def get_match_health(match_id: str):
    return gameplay_controller.get_match_health(match_id)

@router.post("/{match_id}/health/update")
def update_player_health(match_id: str, data: HealthUpdate):
    return gameplay_controller.update_player_health(match_id, data)

@router.post("/{match_id}/heal")
async def heal_player(match_id: str, data: PlayerHealRequest):
    return await gameplay_controller.heal_player(match_id, data)

@router.post("/{match_id}/shoot")
def shoot_player(match_id: str, data: PlayerShootRequest):
    return gameplay_controller.shoot_player(match_id, data)

# QR Tactical Objectives
@router.post("/{match_id}/base-shutdown/start")
def start_base_shutdown(match_id: str, data: BaseShutdownRequest):
    return gameplay_controller.start_base_shutdown(match_id, data)

@router.post("/{match_id}/base-shutdown/complete")
def complete_base_shutdown(match_id: str, data: BaseShutdownRequest):
    return gameplay_controller.complete_base_shutdown(match_id, data)

@router.post("/{match_id}/ghost-mode/scan")
def activate_ghost_mode_qr(match_id: str, data: GhostModeScanRequest):
    return gameplay_controller.activate_ghost_mode_qr(match_id, data)

# Weapon Upgrades
@router.get("/{match_id}/weapon/{player_id}")
def get_player_weapon(match_id: str, player_id: str):
    return gameplay_controller.get_player_weapon(match_id, player_id)

@router.post("/{match_id}/weapon/upgrade/scan")
def scan_weapon_upgrade_qr(match_id: str, data: WeaponUpgradeScanRequest):
    return gameplay_controller.scan_weapon_upgrade_qr(match_id, data)

# Match events & analytics
@router.get("/{match_id}/events")
def get_match_events(match_id: str, limit: int = 50):
    return gameplay_controller.get_match_events(match_id, limit)

@router.delete("/{match_id}/events")
def clear_match_events(match_id: str):
    return gameplay_controller.clear_match_events(match_id)

@router.get("/{match_id}/analytics")
def get_match_analytics(match_id: str):
    return gameplay_controller.get_match_analytics(match_id)
