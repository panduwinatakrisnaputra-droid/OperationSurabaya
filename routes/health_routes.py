from fastapi import APIRouter
from app.Http.Controllers import health_controller

router = APIRouter(tags=["Health & System"])

@router.get("/")
def home():
    return health_controller.get_home_info()

@router.get("/health")
def health():
    return health_controller.get_health_status()

@router.get("/health/db")
def health_db():
    return health_controller.get_db_health()
