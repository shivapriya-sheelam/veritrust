from fastapi import APIRouter, HTTPException, Query
from typing import Optional
from backend.db.store import get_runs, get_run

router = APIRouter()

@router.get("/runs")
def list_runs(
    limit: int = Query(50),
    offset: int = Query(0),
    source: Optional[str] = None
):
    return get_runs(limit=limit, offset=offset, source=source)

@router.get("/runs/{run_id}")
def get_single_run(run_id: str):
    run = get_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    return run
