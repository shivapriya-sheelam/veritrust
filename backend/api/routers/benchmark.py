import json
import asyncio
from typing import List, Optional
from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from backend.db.store import _get_conn, get_policy_versions
from backend.eval.run_benchmark import run_benchmark
from backend.api.routers import ask

router = APIRouter()

class BenchmarkRequest(BaseModel):
    modes: List[str]

@router.post("/benchmark/run")
async def run_benchmark_endpoint(req: BenchmarkRequest, request: Request):
    if ask.is_busy:
        raise HTTPException(status_code=429, detail="BUSY")
        
    for p in get_policy_versions():
        if p["version"] != "v1":
            raise HTTPException(status_code=400, detail=f"Policy {p['name']} is not at seed v1.")

    ask.is_busy = True

    async def event_generator():
        queue = asyncio.Queue()
        loop = asyncio.get_running_loop()
        
        def callback(case_id, category, draft_good, final_status, final_good, elapsed, mode):
            data = {
                "case_id": case_id,
                "category": category,
                "draft_good": draft_good,
                "final_status": final_status,
                "final_good": final_good,
                "elapsed": elapsed,
                "mode": mode
            }
            asyncio.run_coroutine_threadsafe(queue.put(("case_result", data)), loop)
            
        def worker():
            try:
                res = run_benchmark(req.modes, limit=None, callback=callback)
                asyncio.run_coroutine_threadsafe(queue.put(("summary", res)), loop)
            except Exception as e:
                asyncio.run_coroutine_threadsafe(queue.put(("exception", str(e))), loop)
            finally:
                asyncio.run_coroutine_threadsafe(queue.put((None, None)), loop)
                
        import threading
        thread = threading.Thread(target=worker)
        thread.start()
        
        try:
            while True:
                if await request.is_disconnected():
                    break
                    
                try:
                    event_name, data = await asyncio.wait_for(queue.get(), timeout=1.0)
                except asyncio.TimeoutError:
                    continue
                    
                if event_name is None:
                    break
                    
                if event_name == "exception":
                    yield f"event: error\ndata: {json.dumps({'code': 'INTERNAL', 'message': data})}\n\n"
                    break
                    
                yield f"event: {event_name}\ndata: {json.dumps(data)}\n\n"
        finally:
            ask.is_busy = False

    return StreamingResponse(event_generator(), media_type="text/event-stream")

@router.get("/benchmark/latest")
async def get_latest_benchmark():
    conn = _get_conn()
    try:
        cur = conn.execute("SELECT id, started_at, finished_at, modes, summary_json FROM benchmark_runs WHERE finished_at IS NOT NULL ORDER BY id DESC LIMIT 1")
        row = cur.fetchone()
        if row:
            return {
                "id": row[0],
                "started_at": row[1],
                "finished_at": row[2],
                "modes": json.loads(row[3]),
                "summary_json": json.loads(row[4])
            }
        raise HTTPException(status_code=404, detail="No benchmark runs found")
    finally:
        conn.close()
