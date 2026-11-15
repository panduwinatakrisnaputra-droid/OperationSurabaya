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
    player_id: str


class PlayerShootRequest(BaseModel):
    player_id: str = Field(min_length=1)
