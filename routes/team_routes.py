from fastapi import APIRouter
from app.Http.Controllers import team_controller

router = APIRouter(prefix="/api/teams", tags=["Teams"])

@router.get("")
@router.get("/")
def get_teams():
    return team_controller.get_all_teams()
