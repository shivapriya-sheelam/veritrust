from fastapi import APIRouter
import httpx
import os
import sqlite3
import chromadb
from backend.config import OLLAMA_HOST, DB_PATH, CHROMA_DIR, MAKER_MODEL, JUDGE_MODEL, EMBED_MODEL

router = APIRouter()

@router.get("/health")
async def health_check():
    ollama_ok = False
    models_present = []
    
    # Check Ollama
    try:
        async with httpx.AsyncClient(timeout=2.0) as client:
            resp = await client.get(f"{OLLAMA_HOST}/api/tags")
            if resp.status_code == 200:
                ollama_ok = True
                data = resp.json()
                models = [m["name"] for m in data.get("models", [])]
                for req in [MAKER_MODEL, JUDGE_MODEL, EMBED_MODEL]:
                    # Some models have :latest implicit
                    if req in models or f"{req}:latest" in models:
                        models_present.append(req)
    except Exception:
        pass

    # Check DB
    db_ok = False
    try:
        if os.path.exists(DB_PATH):
            conn = sqlite3.connect(DB_PATH)
            conn.execute("SELECT 1 FROM runs LIMIT 1")
            conn.close()
            db_ok = True
    except Exception:
        pass

    # Check Chroma
    chroma_ok = False
    try:
        if os.path.exists(CHROMA_DIR):
            c = chromadb.PersistentClient(path=CHROMA_DIR)
            c.heartbeat()
            chroma_ok = True
    except Exception:
        pass

    return {
        "ollama": ollama_ok,
        "models_present": models_present,
        "db": db_ok,
        "chroma": chroma_ok
    }
