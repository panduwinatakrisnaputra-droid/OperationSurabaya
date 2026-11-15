from fastapi import APIRouter
from app.Models.player import PlayerRegister, PlayerLogin, PlayerLogout
from app.Http.Controllers import player_controller

router = APIRouter(prefix="/api/players", tags=["Players"])

@router.post("/register")
def register_player(player: PlayerRegister):
    return player_controller.register_player(player)

@router.post("/login")
def login_player(player: PlayerLogin):
    return player_controller.login_player(player)

@router.post("/logout")
def logout_player(data: PlayerLogout):
    return player_controller.logout_player(data)

@router.get("")
@router.get("/")
def get_players():
    return player_controller.get_players()
