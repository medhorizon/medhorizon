"""Research Graph FastAPI module service — bind loopback only."""

from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.config import get_settings
from backend.db.sqlite import get_store
from backend.routers import ai, artifacts, experiments, gepa, graphs

settings = get_settings()
Path(settings.data_dir).mkdir(parents=True, exist_ok=True)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    get_store(settings.sqlite_path)
    yield


app = FastAPI(title="Research Graph", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(graphs.router)
app.include_router(experiments.router)
app.include_router(gepa.router)
app.include_router(ai.router)
app.include_router(artifacts.router)


def main() -> None:
    import uvicorn

    uvicorn.run(
        "backend.main:app",
        host=settings.backend_host,
        port=settings.backend_port,
        reload=settings.app_env == "development",
    )


if __name__ == "__main__":
    main()
