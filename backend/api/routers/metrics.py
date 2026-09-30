from fastapi import APIRouter
from backend.db.store import get_metrics

router = APIRouter()

@router.get("/metrics")
def metrics():
    return get_metrics()
