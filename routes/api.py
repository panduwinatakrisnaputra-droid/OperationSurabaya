from fastapi import APIRouter
from routes.health_routes import router as health_router
from routes.team_routes import router as team_router
from routes.player_routes import router as player_router
from routes.match_routes import router as match_router
from routes.room_routes import router as room_router
from routes.admin_routes import router as admin_router

api_router = APIRouter()

api_router.include_router(health_router)
api_router.include_router(team_router)
api_router.include_router(player_router)
api_router.include_router(match_router)
api_router.include_router(room_router)
api_router.include_router(admin_router)
