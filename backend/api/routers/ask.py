import asyncio
import json
import threading
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from backend.graph.run import run_pipeline
from backend.db.store import save_run
from backend.contracts import ABSTAIN_MESSAGE

router = APIRouter()
is_busy = False

class AskRequest(BaseModel):
    question: str
    chaos: bool = False

async def event_generator(req: AskRequest, request: Request):
    queue = asyncio.Queue()
    loop = asyncio.get_running_loop()
    
    def callback(event_name: str, data: Any):
        if hasattr(data, "model_dump"):
            d = data.model_dump()
        else:
            d = data
        asyncio.run_coroutine_threadsafe(queue.put((event_name, d)), loop)
        
    def worker():
        try:
            result = run_pipeline(
                question=req.question,
                chaos=req.chaos,
                callback=callback,
            )
            save_run(result, source="live")
        except Exception as e:
            asyncio.run_coroutine_threadsafe(queue.put(("exception", str(e))), loop)
        finally:
            asyncio.run_coroutine_threadsafe(queue.put((None, None)), loop)
            
    thread = threading.Thread(target=worker)
    thread.start()
    
    started = False
    rid = None
    
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
                if started:
                    yield f"event: final\ndata: {json.dumps({'answer': ABSTAIN_MESSAGE, 'status': 'ABSTAINED', 'abstain_reason': 'SYSTEM_ERROR'})}\n\n"
                    rr = {
                        "run_id": rid, "question": req.question, "chaos": req.chaos,
                        "draft": "", "claims": [], "final_draft": "", "final_claims": [],
                        "final_answer": ABSTAIN_MESSAGE,
                        "final_status": "ABSTAINED", "abstain_reason": "SYSTEM_ERROR",
                        "retries": 0, "latency_ms": {}, "tokens": {}, "policy_versions": {},
                        "created_at": datetime.now(timezone.utc).isoformat()
                    }
                    yield f"event: run_finished\ndata: {json.dumps({'result': rr})}\n\n"
                break

            if event_name == "run_started":
                started = True
                rid = data.get("run_id")

            yield f"event: {event_name}\ndata: {json.dumps(data)}\n\n"
    finally:
        pass

@router.post("/ask")
async def ask_endpoint(req: AskRequest, request: Request):
    global is_busy
    
    if is_busy:
        async def busy_generator():
            run_id = str(uuid.uuid4())
            yield f"event: run_started\ndata: {json.dumps({'run_id': run_id, 'question': req.question, 'chaos': req.chaos})}\n\n"
            yield f"event: error\ndata: {json.dumps({'code': 'BUSY', 'message': 'Another run is in progress. Try again shortly.'})}\n\n"
            yield f"event: final\ndata: {json.dumps({'answer': ABSTAIN_MESSAGE, 'status': 'ABSTAINED', 'abstain_reason': 'SYSTEM_ERROR'})}\n\n"
            rr = {
                "run_id": run_id, "question": req.question, "chaos": req.chaos,
                "draft": "", "claims": [], "final_draft": "", "final_claims": [],
                "final_answer": ABSTAIN_MESSAGE,
                "final_status": "ABSTAINED", "abstain_reason": "SYSTEM_ERROR",
                "retries": 0, "latency_ms": {}, "tokens": {}, "policy_versions": {},
                "created_at": datetime.now(timezone.utc).isoformat()
            }
            yield f"event: run_finished\ndata: {json.dumps({'result': rr})}\n\n"
        return StreamingResponse(busy_generator(), media_type="text/event-stream")
        
    is_busy = True
    
    async def wrapped_generator():
        global is_busy
        try:
            async for chunk in event_generator(req, request):
                yield chunk
        finally:
            is_busy = False
            
    return StreamingResponse(wrapped_generator(), media_type="text/event-stream")
