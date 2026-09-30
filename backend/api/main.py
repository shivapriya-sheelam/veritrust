import os
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.api.routers import ask, runs, metrics, policies, health
from backend.db.store import get_policy_versions

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Check if policy_versions is empty. If so, seed.
    try:
        versions = get_policy_versions()
        if not versions:
            import subprocess
            subprocess.run(["python", "-m", "backend.db.reset", "--policies"])
    except Exception:
        pass
    yield

app = FastAPI(lifespan=lifespan)

origins = os.getenv("CORS_ORIGINS", "*").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(ask.router, prefix="/api")
app.include_router(runs.router, prefix="/api")
app.include_router(metrics.router, prefix="/api")
app.include_router(policies.router, prefix="/api")
app.include_router(health.router, prefix="/api")
