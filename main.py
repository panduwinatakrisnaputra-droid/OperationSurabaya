import socketio
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from config.config import CORS_ORIGINS
from routes.api import api_router
from routes.comms_routes import sio

fastapi_app = FastAPI(
    title="OPERATION: SURABAYA API",
    description="Backend API for AI Tactical Game + Tactical Comms",
    version="1.0.0"
)

fastapi_app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"]
)

fastapi_app.include_router(api_router)

fastapi_app.mount("/static/comms", StaticFiles(directory="resources/views/comms"), name="comms_static")
fastapi_app.mount("/player-app", StaticFiles(directory="resources/views/player-app", html=True), name="player_app")
fastapi_app.mount("/admin-dashboard", StaticFiles(directory="resources/views/admin-dashboard", html=True), name="admin_dashboard")
fastapi_app.mount("/referee-cam", StaticFiles(directory="resources/views/referee-cam", html=True), name="referee_cam")

app = socketio.ASGIApp(sio, other_asgi_app=fastapi_app)