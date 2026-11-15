from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from config.config import CORS_ORIGINS
from routes.api import api_router

# Inisialisasi FastAPI Application
app = FastAPI(
    title="OPERATION: SURABAYA API",
    description="Backend API for AI Tactical Game (Laravel-style MVC Architecture)",
    version="1.0.0"
)

# CORS Middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"]
)

# Register routes (routes/api.py)
app.include_router(api_router)
