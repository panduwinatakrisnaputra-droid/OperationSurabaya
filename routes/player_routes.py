from fastapi import APIRouter
from app.Models.player import PlayerRegister, PlayerLogin, PlayerFaceLogin, PlayerLogout
from app.Http.Controllers import player_controller

router = APIRouter(prefix="/api/players", tags=["Players & Face Authentication"])

@router.post("/register")
def register_player(player: PlayerRegister):
    return player_controller.register_player(player)

@router.post("/face-login")
def face_login(data: PlayerFaceLogin):
    return player_controller.login_face_player(data)

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
