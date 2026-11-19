from typing import Optional
from pydantic import BaseModel, Field

class TeamSelection(BaseModel):
    player_id: str
    team_code: str = Field(pattern="^(RED|BLUE)$")


class LeaveTeamRequest(BaseModel):
    player_id: str


class HealthUpdate(BaseModel):
    player_id: str
    action: str = Field(pattern="^damage$")
    amount: int = Field(gt=0, le=100)


class PlayerHealRequest(BaseModel):
    player_id: str = Field(min_length=1)
    qr_payload: Optional[str] = Field(default=None, max_length=300)
    pose_verified: bool = False


class PlayerShootRequest(BaseModel):
    player_id: str = Field(min_length=1)


class BaseShutdownRequest(BaseModel):
    player_id: str = Field(min_length=1)
    qr_payload: str = Field(min_length=1, max_length=300)


class GhostModeScanRequest(BaseModel):
    player_id: str = Field(min_length=1)
    qr_payload: str = Field(min_length=1, max_length=300)


class WeaponLevelUpdate(BaseModel):
    player_id: str = Field(min_length=1)
    weapon_level: int = Field(ge=1, le=4)


class WeaponUpgradeScanRequest(BaseModel):
    player_id: str = Field(min_length=1)
    qr_payload: str = Field(min_length=1, max_length=300)


class CreateRoomRequest(BaseModel):
    match_name: str = Field(min_length=3, max_length=100)
    host_player_id: str
    team_code: str = Field(pattern="^(RED|BLUE)$")
    red_capacity: int = Field(ge=1, le=50)
    blue_capacity: int = Field(ge=1, le=50)
    duration_hours: float = Field(gt=0, le=24)
    arena_name: str = Field(min_length=2, max_length=100)


class JoinRoomByCodeRequest(BaseModel):
    room_code: str = Field(min_length=8, max_length=8)
    player_id: str
    team_code: str = Field(pattern="^(RED|BLUE)$")
